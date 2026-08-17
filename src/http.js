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

import { createServer as createHttpServer } from 'node:http';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createServer } from './server.js';
import { createSessions } from './sessions.js';
import { createMemoryStore } from './memory/store.js';
import { createWorlds } from './worlds.js';

const JSON_HEADERS = { 'content-type': 'application/json' };

function send(res, status, payload) {
  res.writeHead(status, JSON_HEADERS);
  res.end(JSON.stringify(payload));
}

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
    let registry = tenantSessions.get(token);
    if (!registry) {
      registry = createSessions();
      tenantSessions.set(token, registry);
    }
    return registry;
  }

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

  async function handler(req, res) {
    const { pathname } = new URL(req.url, 'http://localhost');

    // Open, unauthenticated liveness check — the container
    // healthcheck and the post-deploy smoke test need something to
    // hit before any secret is in play. It reveals nothing but
    // "a server is here".
    if (pathname === '/health') {
      return send(res, 200, { ok: true });
    }

    const token = tokenFromPath(pathname);
    // Unknown token and wrong path get the SAME 404: a distinct 401
    // would confirm that a guessed URL had the right *shape*, and
    // turn the endpoint into an oracle for token brute-forcing.
    if (token === null || !store.isAuthorized(token)) {
      // A token that WAS authorised and now isn't has been revoked or
      // suspended in the registry. Drop its engine sessions on the way
      // out: they hold a seeded RNG and a roll log for a table that can
      // no longer reach them, and nothing else ever evicts this map.
      if (token !== null) tenantSessions.delete(token);
      return send(res, 404, { error: 'Not found' });
    }

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
    return { code: 0, server };
  } catch (err) {
    out.error(`FATAL: ${err.message}`);
    return { code: 2, server: null };
  }
}
