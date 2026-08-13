// Scene-image rendering — the optional half of the image feature.
//
// The gate (permission + budget) always works; *rendering* is what needs an
// image model, and this server may or may not have one. Two deployments,
// both legitimate:
//
//   • configured — BOH_IMAGE_API_KEY (+ optionally URL/MODEL) is set, so the
//     server calls the image model itself and hands the MCP host an image
//     content block. `/observe` shows a picture inside the chat, whatever the
//     host is, with no key on the player's machine.
//   • unconfigured — the server holds no key and renders nothing. `image_observe`
//     then returns the composed prompt plus a one-shot grant, and whoever owns
//     the pixels (the browser client, with the player's own key) redeems it.
//
// That is the same posture memory search takes toward its sidecars: degrade,
// say so in the payload, never pretend. Nothing here throws on a provider
// failure — a missing picture must not end a scene.
//
// Tiering: the tier is resolved by the *server* (env today, per-token lookup
// when there is a billing story), never by the model or the player. `tierFor`
// is that seam — one function to change when tokens start naming tiers.

import { generateImage, IMAGE_TIERS, DEFAULT_IMAGE_TIER } from '@zeeuw/bag-of-holding-client';

export const DEFAULT_IMAGE_MODEL = 'google/gemini-2.5-flash-image';
export const DEFAULT_IMAGE_BASE_URL = 'https://openrouter.ai/api/v1';

/**
 * Read the image configuration out of an environment.
 *
 * Returns `null` when no key is configured — the honest "this server cannot
 * render" answer, which the tools surface as `renderer: "host"`. The key is
 * never echoed back into any tool payload; only the model id and base URL are,
 * because those are public facts a player may reasonably want to see.
 *
 * @param {Record<string, string|undefined>} [env]
 */
export function resolveImageConfig(env = process.env) {
  const key = env.BOH_IMAGE_API_KEY;
  if (typeof key !== 'string' || key.trim() === '') return null;
  return {
    key: key.trim(),
    baseUrl: env.BOH_IMAGE_URL || DEFAULT_IMAGE_BASE_URL,
    model: env.BOH_IMAGE_MODEL || DEFAULT_IMAGE_MODEL,
  };
}

/**
 * Which tier this caller plays on. Today: one server-wide setting
 * (`BOH_IMAGE_TIER`), defaulting to `free`. Tomorrow: a lookup keyed by the
 * memory token — the token already *is* the tenant, so a billing site that
 * mints tokens can name the tier alongside the hash, and the only change is
 * inside this function.
 *
 * @param {string|undefined} _token  the caller's memory token (unused today)
 */
export function tierFor(_token, env = process.env) {
  const named = env.BOH_IMAGE_TIER;
  return typeof named === 'string' && Object.hasOwn(IMAGE_TIERS, named) ? named : DEFAULT_IMAGE_TIER;
}

/**
 * Split a data-URI into the parts an MCP image content block wants.
 * Returns null for anything that isn't one, so a provider returning a bare URL
 * (some do) is treated as "no image" rather than shipped as broken base64.
 */
export function splitDataUri(uri) {
  const m = typeof uri === 'string' ? uri.match(/^data:([^;,]+);base64,(.+)$/s) : null;
  return m ? { mimeType: m[1], data: m[2] } : null;
}

/**
 * Render one prompt. Resolves to `{ ok: true, mimeType, data, bytes, model }`
 * or `{ ok: false, error }` — never rejects, so the caller's only job on
 * failure is to refund the budget and pass the reason along.
 *
 * `generateImage` (from the client toolkit) owns the provider-shape mess: five
 * different places a model can hide an image in an OpenAI-compatible response.
 *
 * @param {{ key: string, baseUrl: string, model: string }} config
 * @param {string} prompt
 * @param {{ generate?: typeof generateImage }} [deps]  injection seam for tests
 */
export async function renderImage(config, prompt, { generate = generateImage } = {}) {
  if (!config) return { ok: false, error: 'This server has no image model configured (set BOH_IMAGE_API_KEY).' };
  let uri;
  try {
    uri = await generate({ key: config.key, baseUrl: config.baseUrl }, { prompt, model: config.model });
  } catch (err) {
    // generateImage swallows transport errors itself; this catches the
    // pathological case (a broken injected generator) so a render failure
    // stays a refund rather than a crashed tool call.
    return { ok: false, error: `Image provider failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  const parts = splitDataUri(uri);
  if (!parts) {
    return { ok: false, error: 'The image model returned no image (rate limit, refusal, or a response shape with no image in it).' };
  }
  return {
    ok: true,
    model: config.model,
    mimeType: parts.mimeType,
    data: parts.data,
    bytes: Math.floor(parts.data.length * 3 / 4),   // base64 → rough decoded size
  };
}
