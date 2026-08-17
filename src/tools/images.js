// Scene-image tools — `/observe` for the table.
//
// The rules kernel has never had an opinion about pictures, and this server
// still doesn't generate them on its own initiative. What it adds is a
// *control plane*: images are off until someone turns them on, and every render
// is one deliberate call against a budget that refills on the clock.
//
// Why the gate exists at all: a model holding an image tool with no ceiling
// illustrates every paragraph. Given ten minutes of play that is forty pictures
// nobody asked for, at roughly forty-seven times the cost of a text turn each.
// The pacing rules live in the client toolkit (`llm/imagegate.js`), pure and
// shared, so the browser host and this server cannot drift into two different
// answers about whether a picture is allowed.
//
// The division of labour, per tool call:
//   image_status   read the gate       — never spends, never writes
//   image_enable   the player's yes    — may tighten the budget, never raise it
//   image_disable  the player's no     — keeps the spend counters
//   image_observe  the one that costs  — spends first, renders second, refunds
//                                        the spend if the render fails
//
// Whether `image_observe` returns pixels or a grant depends on deployment (see
// src/images.js): a server with an image key renders inline; one without hands
// back the prompt and a one-shot grant for the client that owns the pixels.
//
// Tiering is the server's call, never the model's — `tierFor` reads the
// deployment's config, and no tool takes a `tier` parameter. That is the seam
// where "tokens that have paid for tier X" will land.

import { z } from 'zod';
import {
  emptyImageGate, normalizeImageGate, imageGateStatus,
  enableImages, disableImages, spendImageRender, refundImageRender,
  composeImagePrompt, IMAGE_TIERS,
} from '@zeeuw/bag-of-holding-client';
import { toolResult, toolError, imageResult } from '../_result.js';
import { tenantFields } from './_tenant.js';
import { resolveImageConfig, tierFor, renderImage } from '../images.js';

const CampaignField = z.string().describe(
  'Campaign name, e.g. "curse-of-the-fen" — the same one you pass to memory_record. The image budget is per campaign.'
);

const seconds = (ms) => Math.ceil(ms / 1000);

/** Shape the pure gate status into the payload every image tool returns. */
function statusPayload(gate, now, renderer, model) {
  const s = imageGateStatus(gate, now);
  return {
    enabled: s.enabled,
    ready: s.ready,
    reason: s.reason,
    tier: s.tier,
    budget: s.budget,
    spent: s.spent,
    remaining: s.remaining,
    windowSeconds: seconds(s.windowMs),
    resetsInSeconds: seconds(s.resetsInMs),
    cooldownSeconds: seconds(s.cooldownMs),
    retryInSeconds: seconds(s.retryInMs),
    rendersAllTime: s.renders,
    // 'server' — this deployment holds an image key and returns pixels.
    // 'host'   — it doesn't; image_observe returns a prompt + grant instead.
    renderer,
    ...(model ? { model } : {}),
  };
}

// Why a refusal is not `isError`: a spent budget or a running cooldown is a
// correct, expected answer, and a model that sees an error tends to retry. A
// plain payload with `granted: false` and a `hint` reads as "not now" and
// terminates the loop.
// `reason` comes last: the status payload carries the gate's own verdict, and
// on a failed render ("the gate said yes, the provider said no") the refusal's
// reason is the one that explains the answer.
const refusal = (reason, hint, payload) => toolResult({ granted: false, ...payload, reason, hint });

const REASON_HINTS = Object.freeze({
  disabled: 'Images are off for this campaign. Do not turn them on yourself — say so, and let the player ask; then call image_enable.',
  budget: 'This window\'s image budget is spent. Tell the player when it refills; keep narrating in the meantime.',
  cooldown: 'A picture was just rendered. Play on in prose and let the player ask again after the cooldown.',
});

/**
 * Build the image tool descriptors.
 *
 * @param store        memory store — holds the per-campaign gate (outside the
 *                     state vault, so no other tool can rewrite the budget)
 * @param pinnedToken  when set (HTTP transport), the tenant is fixed and the
 *                     `token` parameter vanishes from every schema, exactly as
 *                     it does for the memory tools
 * @param deps         `{ env, now, render }` — injection seams for tests
 */
export function imageTools(store, pinnedToken, deps = {}) {
  const { env = process.env, now = () => Date.now(), render = renderImage } = deps;
  const { tokenField, tokenOf } = tenantFields(pinnedToken);

  const config = resolveImageConfig(env);
  const renderer = config ? 'server' : 'host';
  const model = config?.model ?? null;

  /**
   * Load + heal the campaign's gate, with the tier the server says applies.
   *
   * The tier comes from the allowlist entry, not from the caller: a tenant
   * cannot ask for a bigger budget, and the model has no `tier` parameter to
   * fill in. `normalizeImageGate` then clamps a persisted budget down to the
   * tier ceiling, so a downgrade takes effect on the next call rather than
   * leaving yesterday's allowance on disk.
   */
  const gateOf = (token, campaign) =>
    normalizeImageGate(store.imageGateLoad(token, campaign) ?? emptyImageGate(), {
      tier: tierFor(store.tenantMeta(token), env),
    });

  return [
    {
      name: 'image_status',
      description: 'Is scene-image generation on for this campaign, and how much of the budget is left? Reading costs nothing. Check this before promising the player a picture — and before assuming you may make one.',
      input: { ...tokenField, campaign: CampaignField },
      handler: async (args) => {
        try {
          const token = tokenOf(args);
          return toolResult(statusPayload(gateOf(token, args.campaign), now(), renderer, model));
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'image_enable',
      description: 'Turn scene images on for this campaign. Call this ONLY when the player asks for it in as many words — never on your own initiative, and never to "make the scene better". Images stay on until image_disable or a new campaign. The budget is capped by the server\'s tier; `budget` can only lower it, so a player who wants three pictures tonight can say so.',
      input: {
        ...tokenField,
        campaign: CampaignField,
        budget: z.number().int().min(1).optional().describe('Optional tighter ceiling for one window. Values above the tier\'s allowance are clamped down to it; omit for the full tier budget.')
      },
      handler: async (args) => {
        try {
          const token = tokenOf(args);
          const gate = enableImages(gateOf(token, args.campaign), { budget: args.budget });
          store.imageGateSave(token, args.campaign, gate);
          return toolResult({ ...statusPayload(gate, now(), renderer, model), changed: 'enabled' });
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'image_disable',
      description: 'Turn scene images off for this campaign. Spend counters are kept, so switching off and on again is not a way to refill the budget — it refills on the clock.',
      input: { ...tokenField, campaign: CampaignField },
      handler: async (args) => {
        try {
          const token = tokenOf(args);
          const gate = disableImages(gateOf(token, args.campaign));
          store.imageGateSave(token, args.campaign, gate);
          return toolResult({ ...statusPayload(gate, now(), renderer, model), changed: 'disabled' });
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'image_observe',
      description: 'Render ONE picture of what the players can see right now — the deliberate "/observe" call. Rules of use: only when the player asks for it (they said observe, look, show me, draw this); one per moment, never per paragraph; never to open a scene you have not narrated yet. Describe the scene as it stands — present tense, what is visible, no plot the players have not learned. Refusals (images off, budget spent, cooldown running) are normal answers: relay them and keep narrating in prose. A server with an image model returns the picture inline; one without returns the prompt and a one-shot grant for the app to render.',
      input: {
        ...tokenField,
        campaign: CampaignField,
        scene: z.string().min(8).describe('What is in front of the players, present tense, 1-3 sentences. Concrete and visible: light, weather, architecture, who is standing where. No secrets the party has not seen.'),
        subject: z.string().optional().describe('Optional focus when the scene is broad, e.g. "the drowned bell tower" or "Maela\'s face as she lies".'),
        tone: z.string().optional().describe('Campaign mood, e.g. "grim", "wondrous", "folkloric" — usually the world\'s tone from world_overview.'),
        style: z.string().optional().describe('Override the house art style — e.g. "ink and wash", "woodcut", "storybook watercolour". Omit for the client library\'s default look. Only when the player asks for a look.')
      },
      handler: async (args) => {
        try {
          const token = tokenOf(args);
          const { campaign, scene, subject, tone, style } = args;
          const at = now();
          const gate = gateOf(token, campaign);

          // Compose before spending: an unusable prompt should cost nothing.
          const prompt = composeImagePrompt({ scene, subject, tone, style });

          const spend = spendImageRender(gate, at, { prompt });
          if (!spend.ok) {
            return refusal(spend.reason, REASON_HINTS[spend.reason], statusPayload(gate, at, renderer, model));
          }
          store.imageGateSave(token, campaign, spend.gate);

          // No key here: hand the prompt and the grant to whoever owns the
          // pixels. The budget is still spent — the grant IS the render, and it
          // expires (see GRANT_TTL_MS) so it cannot be hoarded. The hint
          // matters: on a keyless server this is the DEFAULT outcome of
          // "show me", and a model with no instructions here tends to paste
          // the grant JSON at the player and move on.
          if (!config) {
            return toolResult({
              granted: true,
              grant: spend.grant,
              prompt,
              hint: 'This server has no image model, so no picture was rendered here. Do not show the grant object to the player. Describe the scene vividly in prose, and mention that an art prompt is ready — a player using an app with its own image key can redeem it, or they can paste the prompt into any image tool they like.',
              ...statusPayload(spend.gate, at, renderer, model),
            });
          }

          const out = await render(config, prompt);
          if (!out.ok) {
            // A picture that never arrived must not cost the player a render.
            const refunded = refundImageRender(spend.gate, spend.grant);
            store.imageGateSave(token, campaign, refunded);
            return refusal('render-failed', 'The image model failed; the render was refunded. Narrate the moment in prose and offer to try again.', {
              error: out.error,
              ...statusPayload(refunded, at, renderer, model),
            });
          }

          return imageResult(out, {
            granted: true,
            rendered: true,
            prompt,
            model: out.model,
            mimeType: out.mimeType,
            bytes: out.bytes,
            ...statusPayload(spend.gate, at, renderer, out.model),
          });
        } catch (err) { return toolError(err); }
      }
    }
  ];
}

// Re-exported for hosts and tests that want the allowance table without
// reaching through to the client package.
export { IMAGE_TIERS };
