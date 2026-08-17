// Inference relay — the tenant token as a way to *pay* for a turn.
//
// Until now a tenant token bought storage: a namespace for campaigns, a shelf
// of worlds, and an image tier the server renders against its own key. Text
// inference was always somebody else's problem, because every host that wanted
// prose held a provider key of its own. That is true of a desktop MCP host (the
// model is the host) and false of the one deployment shape people actually ask
// about: a browser game, where the player has no key and the operator does.
//
// So this module lets the token spend, against exactly the same tier the image
// gate reads, through the smallest surface that works: an OpenAI-compatible
// relay. No new protocol and no client library changes — `chat/completions` and
// `models` are the two endpoints the client toolkit already speaks, so pointing
// its `baseUrl` at `/mcp/<token>/v1` is the entire integration.
//
// Three rules, none of them the caller's to choose:
//
//   • the tier comes from the tenant registry (`tierFor` in ./images.js), never
//     from the request — same as images;
//   • the tier names which model ids are reachable, so a free tenant cannot
//     spend the operator's money on a frontier model by asking for it;
//   • every call is checked against the tier's token budget before it starts
//     and charged with what the provider actually reported after it finishes.
//
// The budget math lives in the client toolkit (`llm/relaygate.js`), pure and
// shared, for the same reason the image gate does: two hosts must not drift
// into two different answers about whether something may cost money.
//
// What this is NOT: an open proxy. It is reachable only under a path that
// already proved a live token, it forwards a fixed set of fields (never the
// caller's own headers), and it will not relay a model the tier does not name.

import {
  FREE_MODELS, PAID_MODELS, FREE_FALLBACKS,
  RELAY_TIERS, DEFAULT_RELAY_TIER,
  canRelay, chargeRelay, normalizeRelayBudget,
} from '@zeeuw/bag-of-holding-client';

export const DEFAULT_RELAY_BASE_URL = 'https://openrouter.ai/api/v1';

/** Upstream deadline. Longer than a chat turn needs, shorter than a hung socket. */
export const RELAY_TIMEOUT_MS = 120_000;

/** The marker `/status` returns, so a client can tell a relay from any other 200. */
export const RELAY_MARKER = 'bag-of-holding-mcp';

/**
 * Read the relay configuration out of an environment.
 *
 * Returns `null` when no key is configured — the honest "this deployment does
 * not sell inference" answer, which `/status` reports as `relayEnabled: false`
 * so a host can fall back to asking the player for their own key instead of
 * discovering the gap on the first turn. The key is never echoed anywhere.
 *
 * @param {Record<string, string|undefined>} [env]
 */
export function resolveRelayConfig(env = process.env) {
  const key = env.BOH_LLM_API_KEY;
  if (typeof key !== 'string' || key.trim() === '') return null;
  return {
    key: key.trim(),
    baseUrl: (env.BOH_LLM_URL || DEFAULT_RELAY_BASE_URL).replace(/\/$/, ''),
    // Identifies the deployment to the provider. Not a secret, and not the
    // player's referer — a browser's Origin says nothing about which tenant
    // spent the tokens, and forwarding it would leak one player's host to
    // another's bill.
    appTitle: env.BOH_LLM_APP_TITLE || 'bag-of-holding-mcp',
  };
}

/**
 * Which tier this tenant relays on: the registry's tier if it named one, else
 * the deployment-wide `BOH_LLM_TIER`, else `free`.
 *
 * Deliberately its own function rather than `tierFor` from ./images.js. The
 * vocabularies coincide today, but the fallbacks must not: a deployment that
 * hands every image-tierless tenant `patron` pictures has said nothing about
 * how many *tokens* they may spend, and quietly reading `BOH_IMAGE_TIER` here
 * would turn one generous setting into two.
 *
 * An unknown tier name is never an upgrade, from either source — same rule as
 * the image gate, for the same reason: a name this build does not know means
 * the panel and the server are out of step, and falling back beats handing out
 * an allowance nobody priced.
 *
 * @param {{ tier?: string|null } | null | undefined} meta  `store.tenantMeta(token)`
 */
export function relayTierFor(meta, env = process.env) {
  const assigned = meta?.tier;
  if (typeof assigned === 'string' && Object.hasOwn(RELAY_TIERS, assigned)) return assigned;
  const named = env.BOH_LLM_TIER;
  return typeof named === 'string' && Object.hasOwn(RELAY_TIERS, named) ? named : DEFAULT_RELAY_TIER;
}

/**
 * The model map a tier may reach: the free ids for `free`, the paid ones for
 * anything the registry priced above it.
 *
 * These are the client toolkit's own tables, so the ids a relayed host is told
 * to use are the same ids a BYOK host would have picked, healed by the same
 * catalog check. `tts`/`stt` are null in both tables (the default provider
 * hosts no speech models), which is why this relay carries no audio path — a
 * deployment wanting speech points BOH_LLM_URL at a provider that has it and
 * the shape of this module does not change.
 */
export function modelsForTier(tier) {
  return tier === 'free' ? FREE_MODELS : PAID_MODELS;
}

/**
 * Every model id this tier may ask for: the tier's own slots plus the fallback
 * chains the client walks on a rate limit. Without the chains a rate-limited
 * free tenant would walk straight into a 400 from us, which is a worse outage
 * than the one the chain exists to survive.
 *
 * `BOH_LLM_MODEL_ALLOW` (comma-separated) adds ids for a deployment running a
 * private or self-hosted catalog. It only ever *adds*: there is no env var that
 * lets a free tenant reach a paid model, because that decision belongs to the
 * registry the admin panel writes.
 */
export function allowedModels(tier, env = process.env) {
  const ids = new Set();
  for (const id of Object.values(modelsForTier(tier))) if (id) ids.add(id);
  for (const chain of Object.values(FREE_FALLBACKS)) for (const id of chain) ids.add(id);
  const extra = env.BOH_LLM_MODEL_ALLOW;
  if (typeof extra === 'string') {
    for (const id of extra.split(',').map((s) => s.trim()).filter(Boolean)) ids.add(id);
  }
  return ids;
}

/**
 * Shape a relay refusal the way the client library reads statuses.
 *
 *   400  a model this tier may not use — the client's fallback walk treats 400
 *        as model-swappable, so it retries with an id that IS allowed rather
 *        than ending the turn.
 *   402  the tier's budget is spent. Deliberately NOT 429: the client walks the
 *        fallback chain on a rate limit, and every entry would fail the same
 *        per-tenant check, so three more requests would buy three more refusals.
 *   503  this deployment sells no inference at all.
 */
export function relayError(status, message, type, extra = {}) {
  return { status, body: { error: { message, type, ...extra } } };
}

/** Fields a caller may set on a relayed completion. Everything else is dropped. */
const FORWARDED = Object.freeze([
  'messages', 'temperature', 'top_p', 'max_tokens', 'stream',
  'response_format', 'stop', 'seed', 'presence_penalty', 'frequency_penalty',
]);

/**
 * Build the upstream request body from the caller's.
 *
 * An allowlist rather than a passthrough: `{...body}` would forward provider
 * knobs nobody here has priced (`n: 50`, `logprobs`, a second `model`, another
 * deployment's routing preferences) under the operator's key.
 *
 * `stream_options.include_usage` is forced on for streams, because a stream
 * without it reports no usage at all — and a call whose cost never arrives is a
 * call the budget cannot charge.
 */
export function upstreamBody(body, model) {
  const out = { model };
  for (const field of FORWARDED) {
    if (body[field] !== undefined) out[field] = body[field];
  }
  if (out.stream === true) out.stream_options = { include_usage: true };
  return out;
}

/**
 * Total tokens from a completion or a streamed usage frame. Returns 0 when the
 * provider reported nothing — a call charged 0 is honest; an estimate is not.
 */
export function usageTokens(payload) {
  const n = payload?.usage?.total_tokens;
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/**
 * Decide whether a completion may be relayed, and against what.
 *
 * Pure: takes the tier, the caller's body, and the tenant's stored budget;
 * returns either a refusal (ready to serialize) or the upstream body to send.
 * The I/O half lives in ./http.js so this stays unit-testable.
 */
export function planCompletion({ tier, body, budget, env = process.env, now = Date.now() }) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return relayError(400, 'Request body must be a JSON object.', 'invalid_request');
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return relayError(400, 'A completion needs a non-empty `messages` array.', 'invalid_request');
  }

  const models = modelsForTier(tier);
  // No model named: serve the tier's medium slot rather than refusing — a host
  // that trusts the deployment to pick is the normal case for a relay. A null
  // slot needs no separate guard: the allowlist below holds no null either, so
  // it refuses with the message that names what the tier CAN use.
  const asked = typeof body.model === 'string' && body.model.trim() !== ''
    ? body.model.trim()
    : models.medium;
  if (!allowedModels(tier, env).has(asked)) {
    return relayError(
      400,
      `Model '${asked}' is not available on tier '${tier}'. Available: ${[...allowedModels(tier, env)].sort().join(', ')}.`,
      'model_not_allowed',
      { tier },
    );
  }

  const verdict = canRelay(budget, now);
  if (!verdict.ok) {
    return relayError(
      402,
      `This tenant's inference budget for the current window is spent. It refills in ${Math.ceil(verdict.resetsInMs / 1000)}s.`,
      'budget_exhausted',
      { tier, resets_in_seconds: Math.ceil(verdict.resetsInMs / 1000) },
    );
  }

  return { status: 200, model: asked, upstream: upstreamBody(body, asked) };
}

/** The `/v1/models` payload for a tier, in the shape a catalog reader expects. */
export function modelsPayload(tier, env = process.env) {
  return {
    object: 'list',
    data: [...allowedModels(tier, env)].sort().map((id) => ({
      id, object: 'model', owned_by: 'relay',
    })),
  };
}

/**
 * The `/v1/status` payload: everything a setup wizard needs to decide whether
 * this token can play, and nothing a tenant should not see. No key, no other
 * tenant, no deployment internals beyond the version already in every MCP
 * handshake.
 */
export function statusPayload({ tier, budget, version, enabled, env = process.env }) {
  return {
    relay: RELAY_MARKER,
    version,
    relayEnabled: enabled,
    tier,
    models: enabled ? modelsForTier(tier) : null,
    // The raw budget object, not a formatted status: the client toolkit owns the
    // presentation (`relayBudgetStatus`) and applying it twice would be drift.
    budget: enabled ? normalizeRelayBudget(budget, { tier }) : null,
    ...(enabled ? {} : {
      hint: 'This deployment relays no inference (no BOH_LLM_API_KEY). Use your own provider key.',
    }),
    ...(enabled && env.BOH_LLM_URL ? { provider: env.BOH_LLM_URL } : {}),
  };
}

/**
 * The stored budget healed to the tier that applies *now*.
 *
 * Always go through this rather than handing a raw file to the gate: the tenant
 * registry reloads under the server's feet, so the tier on disk is a snapshot
 * from whenever the last charge was written. Passing that through would mean a
 * tenant upgraded an hour ago still playing on last hour's allowance.
 */
export function budgetForTier(raw, tier) {
  return normalizeRelayBudget(raw, { tier });
}

/** Charge a finished call. Thin wrapper so ./http.js imports one relay surface. */
export function chargeCall(budget, tokens, now) {
  return chargeRelay(budget, tokens, now);
}
