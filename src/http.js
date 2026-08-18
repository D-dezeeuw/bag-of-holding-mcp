// Streamable-HTTP surface for the MCP server.
//
// `bin/cli.js`'s stdio path is unchanged and still what a desktop
// host spawns locally. This module exposes the *same* tool surface
// over HTTP for clients that only take a URL — Claude Desktop's
// "Add custom connector" dialog is Title + URL (+ optional OAuth
// client id/secret), with no field for a bearer token. Standing up
// an OAuth authorization server for a handful of tables isn't worth
// it, so the secret lives in the URL path instead:
//
//     https://<host>/mcp/<token>
//
// That token is not just a door key — it IS the tenant. It hashes
// to the storage namespace the memory store already uses, so one
// deployment serves many tables with no shared state, and the
// model never sees the token at all (the `token` parameter is
// stripped from every memory tool when the transport pins it).
// Rotate per table; treat a leaked URL as a leaked campaign.
//
// Requests are served in stateless mode — a fresh MCP server per
// request, no session ids, nothing cached between calls except the
// per-tenant engine registry. That is the right trade here: the
// tool surface is pure request/response (no subscriptions, no
// sampling, no server-initiated notifications), so sessions would
// buy nothing while adding cross-tenant state to get wrong, plus
// state to lose on every redeploy.

import { createRequire } from 'node:module';
import { createServer as createHttpServer } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './server.js';
import { createSessions } from './sessions.js';
import { createMemoryStore } from './memory/store.js';
import { createWorlds } from './worlds.js';
import { listenUi } from './ui-server.js';
import {
  resolveRelayConfig, relayTierFor, planCompletion, modelsPayload, statusPayload,
  budgetForTier, chargeCall, usageTokens, RELAY_TIMEOUT_MS,
} from './relay.js';

const SERVER_VERSION = createRequire(import.meta.url)('../package.json').version;

const JSON_HEADERS = { 'content-type': 'application/json' };

function send(res, status, payload, extra = {}) {
  res.writeHead(status, { ...JSON_HEADERS, ...extra });
  res.end(JSON.stringify(payload));
}

// CORS for the relay endpoints only.
//
// The MCP path is spoken by desktop hosts, which are not browsers and do not
// preflight; the relay exists precisely so a *page* can reach it, and a page
// cannot send `Authorization` cross-origin without one. `*` is the honest
// origin list: the credential is the token in the URL, not a cookie, so there
// is no ambient authority for an origin check to protect — a page that does not
// know the token gets a 404 from any origin, and one that does is already the
// tenant. `Retry-After` is exposed because a budget refusal that a page cannot
// read the timing off is a refusal it has to guess about.
const CORS_HEADERS = Object.freeze({
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'authorization, content-type, accept, http-referer, x-title',
  'access-control-expose-headers': 'retry-after',
  'access-control-max-age': '86400',
});

/** Body cap for a relayed completion. A scope packet is large; a stream of them is an attack. */
const MAX_RELAY_BODY_BYTES = 2 * 1024 * 1024;

/**
 * Build the HTTP request handler plus the store it serves.
 *
 * Split out from `listen` so tests can drive it over a real socket
 * without the process-level fail-closed checks and signal handling
 * in `main()`.
 *
 * @param {{ memory?: import('../index.js').MemoryStoreOptions,
 *           memoryStore?: ReturnType<typeof createMemoryStore> }} [opts]
 */
export function createHttpHandler(opts = {}) {
  const store = opts.memoryStore ?? createMemoryStore(opts.memory ?? {});
  // ONE worlds registry for the process, like the store. Without this,
  // the per-request createServer below fell back to a fresh createWorlds()
  // every call — re-reading and re-mounting every cartridge from disk per
  // request, and (before playthroughs were persisted) losing every world
  // session the moment the response closed. The registry is read-only and
  // cartridge files are immutable, so sharing it across tenants leaks
  // nothing: tenancy lives in the store, not the shelf.
  const worlds = opts.worlds ?? createWorlds({ dir: opts.worldsDir ?? process.env.BOH_WORLDS_DIR ?? null });

  // Engine sessions (seeded RNG + rollLog) are keyed by a host-chosen
  // id like "curse-of-the-fen", so a single shared registry would let
  // two tenants collide on the same name — and silently share dice.
  // One registry per tenant, cached across requests because
  // `engine_create_session` in one call must still exist for the
  // `dice_roll` in the next. Bounded by the token allowlist.
  const tenantSessions = new Map();
  function sessionsFor(token) {
    let entry = tenantSessions.get(token);
    if (!entry) {
      entry = { registry: createSessions(), lastUsed: Date.now() };
      tenantSessions.set(token, entry);
    }
    entry.lastUsed = Date.now();
    return entry.registry;
  }

  // Idle eviction: a tenant registry (engines + rollLogs) that nobody
  // has touched for a day is a table that went home — free it. The
  // capacity audit found "nothing ever expires" made every memory
  // ceiling monotonic with uptime. A campaign loses nothing real:
  // durable state lives in the store; the next request just mints a
  // fresh registry (hosts already re-run engine_create_session per
  // sitting per the quickstart guide). Timer is unref'd so it never
  // holds the process open; TTL 0 disables the sweep.
  const sessionTtlMs = Math.max(0, Number(opts.sessionTtlHours ?? process.env.BOH_SESSION_TTL_HOURS ?? 24)) * 3_600_000;
  const sweep = (now = Date.now()) => {
    if (sessionTtlMs <= 0) return;
    const cutoff = now - sessionTtlMs;
    for (const [token, entry] of tenantSessions) {
      if (entry.lastUsed < cutoff) tenantSessions.delete(token);
    }
  };
  const sweepTimer = sessionTtlMs > 0 ? setInterval(sweep, Math.min(sessionTtlMs, 3_600_000)) : null;
  if (sweepTimer?.unref) sweepTimer.unref();

  const env = opts.env ?? process.env;
  const now = opts.now ?? (() => Date.now());
  // Resolved once: the key cannot change without a redeploy, and re-reading the
  // environment per request would let a mid-flight edit serve two policies.
  const relayConfig = opts.relayConfig ?? resolveRelayConfig(env);
  const relayFetch = opts.relayFetch ?? fetch;

  /**
   * Extract the token from `/mcp/<token>`. Returns null for any
   * other path so the caller can 404 uniformly. Trailing slashes
   * are stripped first, so an exactly-three-part split guarantees a
   * non-empty token — bare `/mcp/` splits to two parts and is
   * rejected with everything else.
   */
  function tokenFromPath(pathname) {
    const parts = pathname.replace(/\/+$/, '').split('/');
    if (parts.length !== 3 || parts[0] !== '' || parts[1] !== 'mcp') return null;
    return decodeURIComponent(parts[2]);
  }

  /**
   * The relay endpoints live *under* the tenant path — `/mcp/<token>/v1/...` —
   * so one URL is one tenant whichever surface is being spoken, and a leaked
   * URL leaks exactly one tenant either way.
   *
   * Returns `{ token, endpoint }` or null. Only the three endpoints below are
   * routed: an unrecognised tail is not a relay path, so it 404s with
   * everything else rather than becoming a general-purpose proxy prefix.
   */
  const RELAY_ENDPOINTS = new Set(['chat/completions', 'models', 'status']);
  function relayFromPath(pathname) {
    const parts = pathname.replace(/\/+$/, '').split('/');
    if (parts.length < 5 || parts[0] !== '' || parts[1] !== 'mcp' || parts[3] !== 'v1') return null;
    const endpoint = parts.slice(4).join('/');
    if (!RELAY_ENDPOINTS.has(endpoint)) return null;
    return { token: decodeURIComponent(parts[2]), endpoint };
  }

  /** Read a JSON body under a size cap. Returns `{ body }` or `{ error }`. */
  async function readJsonBody(req) {
    const chunks = [];
    let bytes = 0;
    for await (const chunk of req) {
      bytes += chunk.length;
      if (bytes > MAX_RELAY_BODY_BYTES) return { error: 'Request body too large.' };
      chunks.push(chunk);
    }
    if (bytes === 0) return { error: 'Request body is empty.' };
    try {
      return { body: JSON.parse(Buffer.concat(chunks).toString('utf8')) };
    } catch {
      return { error: 'Request body is not valid JSON.' };
    }
  }

  /**
   * The tenant's budget, healed to the tier the registry currently says.
   * Loaded per request: the registry reloads under this server's feet (that is
   * the point of the file), so a tier change must land on the next call.
   */
  function budgetOf(token, tier) {
    return budgetForTier(store.relayBudgetLoad(token), tier);
  }

  /**
   * Serve one relay request.
   *
   * Everything here has already proved a live token — the caller checked the
   * allowlist — so failures from this point can be specific about *why*
   * without becoming an oracle about which tokens exist.
   */
  async function relayHandler(req, res, { token, endpoint }) {
    // Preflight. A page cannot send `Authorization` cross-origin without this,
    // and the browser sends it before it will send the real request.
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS_HEADERS);
      return res.end();
    }

    const tier = relayTierFor(store.tenantMeta(token), env);
    const enabled = relayConfig !== null;

    if (endpoint === 'status') {
      // The one endpoint that answers even with no relay configured: a wizard
      // asking "can this token play?" needs "yes, but bring your own key" as a
      // distinct answer from "that token is not ours".
      return send(res, 200, statusPayload({
        tier, budget: enabled ? budgetOf(token, tier) : null,
        version: SERVER_VERSION, enabled, env,
      }), CORS_HEADERS);
    }

    if (!enabled) {
      return send(res, 503, {
        error: {
          message: 'This deployment relays no inference (no BOH_LLM_API_KEY configured). Use your own provider key.',
          type: 'relay_unconfigured',
        },
      }, CORS_HEADERS);
    }

    if (endpoint === 'models') {
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return send(res, 405, { error: { message: 'Use GET for /v1/models.', type: 'invalid_request' } }, CORS_HEADERS);
      }
      return send(res, 200, modelsPayload(tier, env), CORS_HEADERS);
    }

    // endpoint === 'chat/completions'
    if (req.method !== 'POST') {
      return send(res, 405, { error: { message: 'Use POST for /v1/chat/completions.', type: 'invalid_request' } }, CORS_HEADERS);
    }
    const read = await readJsonBody(req);
    if (read.error) {
      return send(res, 400, { error: { message: read.error, type: 'invalid_request' } }, CORS_HEADERS);
    }

    const plan = planCompletion({ tier, body: read.body, budget: budgetOf(token, tier), env, now: now() });
    if (plan.status !== 200) {
      const retry = plan.body?.error?.resets_in_seconds;
      return send(res, plan.status, plan.body, {
        ...CORS_HEADERS,
        ...(retry ? { 'retry-after': String(retry) } : {}),
      });
    }

    // Charging is the last thing that happens on every path out of here,
    // including the ones where the player hung up mid-stream: the tokens were
    // spent upstream whether or not anybody read the answer.
    const charge = (tokens) => {
      try {
        store.relayBudgetSave(token, chargeCall(budgetOf(token, tier), tokens, now()));
      } catch {
        // A budget that could not be written is a lost charge, not a failed
        // turn. Refusing the response the player already paid for would be
        // the worse of the two outcomes.
      }
    };

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), RELAY_TIMEOUT_MS);
    // The player's Stop button closes this socket; stop pulling from upstream
    // rather than paying for prose nobody will read.
    res.on('close', () => ctl.abort());

    let upstream;
    try {
      upstream = await relayFetch(`${relayConfig.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${relayConfig.key}`,
          'x-title': relayConfig.appTitle,
        },
        body: JSON.stringify(plan.upstream),
        signal: ctl.signal,
      });
    } catch (err) {
      clearTimeout(timer);
      if (res.writableEnded || res.destroyed) return undefined;
      return send(res, 502, {
        error: {
          message: `The inference provider could not be reached: ${err instanceof Error ? err.message : String(err)}`,
          type: 'provider_unreachable',
        },
      }, CORS_HEADERS);
    }

    if (!upstream.ok) {
      clearTimeout(timer);
      const text = await upstream.text().catch(() => '');
      // Pass the provider's status through: the client library's fallback walk
      // reads 429/400/404 as "try another model", and rewriting them here would
      // break a recovery that already works.
      return send(res, upstream.status, {
        error: { message: text.slice(0, 500) || 'The inference provider refused the call.', type: 'provider_error' },
      }, CORS_HEADERS);
    }

    if (plan.upstream.stream === true) {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
        ...CORS_HEADERS,
      });
      const reader = upstream.body.getReader();
      const decoder = new TextDecoder();
      let tokens = 0;
      let partial = '';
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);                       // forward the bytes untouched
          // …and read a copy for the usage frame. `include_usage` puts it in the
          // last frame before [DONE], so a stream that dies early charges what
          // it saw, which is 0 — the honest number when nothing reported a cost.
          const text = partial + decoder.decode(value, { stream: true });
          const lines = text.split('\n');
          partial = lines.pop();
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data: ')) continue;
            const data = trimmed.slice(6);
            if (data === '[DONE]') continue;
            try {
              const n = usageTokens(JSON.parse(data));
              if (n > 0) tokens = n;
            } catch { /* malformed SSE line — skip */ }
          }
        }
      } catch { /* upstream died or the player hung up: end cleanly, charge what we saw */ }
      clearTimeout(timer);
      charge(tokens);
      if (!res.writableEnded) res.end();
      return undefined;
    }

    let payload;
    try {
      payload = await upstream.json();
    } catch {
      clearTimeout(timer);
      return send(res, 502, {
        error: { message: 'The inference provider returned a body that is not JSON.', type: 'provider_error' },
      }, CORS_HEADERS);
    }
    clearTimeout(timer);
    charge(usageTokens(payload));
    return send(res, 200, payload, CORS_HEADERS);
  }

  async function handler(req, res) {
    const { pathname } = new URL(req.url, 'http://localhost');

    // Open, unauthenticated liveness check — the container
    // healthcheck and the post-deploy smoke test need something to
    // hit before any secret is in play. It reveals nothing but
    // "a server is here".
    if (pathname === '/health') {
      return send(res, 200, { ok: true });
    }

    const relay = relayFromPath(pathname);
    const token = relay ? relay.token : tokenFromPath(pathname);
    // Unknown token and wrong path get the SAME 404: a distinct 401
    // would confirm that a guessed URL had the right *shape*, and
    // turn the endpoint into an oracle for token brute-forcing.
    if (token === null || !store.isAuthorized(token)) {
      // A token that WAS authorised and now isn't has been revoked or
      // suspended in the registry. Drop its engine sessions on the way
      // out: they hold a seeded RNG and a roll log for a table that can
      // no longer reach them. The idle sweep above would get there
      // eventually; this makes revocation immediate, which is the point
      // of revocation.
      if (token !== null) tenantSessions.delete(token);
      return send(res, 404, { error: 'Not found' });
    }

    if (relay) return relayHandler(req, res, relay);

    const { server } = createServer({
      sessions: sessionsFor(token),
      memoryStore: store,
      memoryToken: token,
      worlds
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    // Tie both to the response: stateless means this pair exists
    // only for this exchange, and leaking one per request would be
    // a slow memory leak in a long-lived container. allSettled
    // rather than await + catch: teardown races (a client that hung
    // up mid-stream) are expected and uninteresting, and nothing
    // downstream is waiting on the result.
    res.on('close', () => { Promise.allSettled([transport.close(), server.close()]); });
    await server.connect(transport);
    await transport.handleRequest(req, res);
  }

  return {
    store,
    /** Run one idle-eviction pass now (tests; ops tooling). */
    sweepSessions: sweep,
    /** Node request listener; errors become a 500 rather than a hang. */
    handler: (req, res) => handler(req, res).catch((err) => {
      if (!res.headersSent) {
        send(res, 500, { error: 'Internal error', detail: err.message });
      } else {
        res.end();
      }
    })
  };
}

/**
 * Start the HTTP server. Fail-closed: without a token allowlist
 * this endpoint would serve any campaign to anyone who found the
 * URL, so refuse to boot rather than serve openly.
 */
export async function listen({ port, host = '0.0.0.0', ...opts } = {}) {
  const { store, handler } = createHttpHandler(opts);
  if (!store.authRequired) {
    throw new Error(
      'Refusing to serve MCP over HTTP with no token allowlist: set BOH_MEMORY_TOKEN_HASHES to the SHA-256 hashes of the tokens you have issued (openssl rand -hex 32 | tee /dev/stderr | tr -d "\\n" | sha256sum).'
    );
  }
  const httpServer = createHttpServer(handler);
  return new Promise((resolve) => {
    httpServer.listen(port, host, () => resolve(httpServer));
  });
}

/**
 * The container entrypoint's whole boot sequence: read the port,
 * listen, announce — or report why not.
 *
 * Returns `{ code, server }` instead of calling `process.exit`, so
 * bin/http.js is a single branchless line and every decision here
 * is exercised in-process by the suite. Exit code 2 (not 1) marks
 * the fail-closed refusal, matching the deploy scripts' convention
 * for "misconfigured, don't retry me".
 */
export async function main({ env = process.env, out = console, ...opts } = {}) {
  const port = Number.parseInt(env.BOH_HTTP_PORT ?? '8091', 10);
  try {
    const server = await listen({ port, ...opts });
    // stdout, not stderr: this is the healthy path, and the
    // container log should open with proof of which surface is up.
    out.log(`bag-of-holding-mcp listening on :${port} (POST /mcp/<token>, GET /health)`);
    // The browser pages, on their own port, after the MCP surface is up
    // — it is the product, this is a convenience. `listenUi` returns null
    // when BOH_UI_PORT is unset (every path but the container) and
    // reports-and-skips when the client package has no pages to serve,
    // so neither can keep a table's server from starting.
    const ui = await listenUi({ env, out });
    return { code: 0, server, ui };
  } catch (err) {
    out.error(`FATAL: ${err.message}`);
    return { code: 2, server: null, ui: null };
  }
}
