// The pure half of the inference relay: which tier a tenant relays on, which
// models that buys, what gets forwarded upstream, and when a call is refused.
//
// The wire half (routes, CORS, streaming, charging) is exercised over a real
// socket in relay-http.test.js.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveRelayConfig, relayTierFor, modelsForTier, allowedModels,
  upstreamBody, usageTokens, planCompletion, modelsPayload, statusPayload,
  budgetForTier, chargeCall, DEFAULT_RELAY_BASE_URL, RELAY_MARKER,
} from '../src/relay.js';
import { FREE_MODELS, PAID_MODELS, RELAY_TIERS, emptyRelayBudget, chargeRelay } from '@zeeuw/bag-of-holding-client';

const T0 = 1_700_000_000_000;
const MESSAGES = [{ role: 'user', content: 'Narrate the fen.' }];

describe('deployment config', () => {
  it('is null without a key — the honest "this server sells no inference"', () => {
    assert.equal(resolveRelayConfig({}), null);
    assert.equal(resolveRelayConfig({ BOH_LLM_API_KEY: '   ' }), null);
  });

  it('defaults the provider and trims the key', () => {
    const cfg = resolveRelayConfig({ BOH_LLM_API_KEY: ' sk-test ' });
    assert.equal(cfg.key, 'sk-test');
    assert.equal(cfg.baseUrl, DEFAULT_RELAY_BASE_URL);
  });

  it('takes the operator\'s provider and app title, without a trailing slash', () => {
    const cfg = resolveRelayConfig({
      BOH_LLM_API_KEY: 'k', BOH_LLM_URL: 'https://llm.internal/v1/', BOH_LLM_APP_TITLE: 'my-table',
    });
    assert.equal(cfg.baseUrl, 'https://llm.internal/v1');
    assert.equal(cfg.appTitle, 'my-table');
  });
});

describe('tier resolution', () => {
  it('prefers the registry, then the deployment default, then free', () => {
    assert.equal(relayTierFor({ tier: 'studio' }, {}), 'studio');
    assert.equal(relayTierFor({ tier: null }, { BOH_LLM_TIER: 'patron' }), 'patron');
    assert.equal(relayTierFor(null, {}), 'free');
  });

  it('an unknown tier name is never an upgrade, from either source', () => {
    assert.equal(relayTierFor({ tier: 'legendary' }, {}), 'free');
    assert.equal(relayTierFor(null, { BOH_LLM_TIER: 'legendary' }), 'free');
    assert.equal(relayTierFor({ tier: 'toString' }, {}), 'free', 'prototype keys are not tiers');
  });

  it('does not read the image tier — one generous setting must not become two', () => {
    assert.equal(relayTierFor(null, { BOH_IMAGE_TIER: 'studio' }), 'free');
  });
});

describe('what a tier may reach', () => {
  it('free gets the free ids, paid tiers the paid ones', () => {
    assert.equal(modelsForTier('free'), FREE_MODELS);
    assert.equal(modelsForTier('patron'), PAID_MODELS);
    assert.equal(modelsForTier('studio'), PAID_MODELS);
  });

  it('free cannot reach a paid model, however it asks', () => {
    const free = allowedModels('free', {});
    assert.equal(free.has(FREE_MODELS.medium), true);
    assert.equal(free.has(PAID_MODELS.medium), false);
    assert.equal(free.has(PAID_MODELS.image), false, 'no free image generation on the operator\'s key');
  });

  it('includes the fallback chains, so a rate-limited tenant can still walk them', () => {
    const free = allowedModels('free', {});
    assert.equal(free.has('openai/gpt-oss-20b:free'), true);
  });

  it('BOH_LLM_MODEL_ALLOW adds ids but never lifts a tier', () => {
    const extra = allowedModels('free', { BOH_LLM_MODEL_ALLOW: 'local/llama-9000, local/tiny' });
    assert.equal(extra.has('local/llama-9000'), true);
    assert.equal(extra.has('local/tiny'), true);
    assert.equal(extra.has(PAID_MODELS.medium), false);
  });
});

describe('the upstream body', () => {
  it('forwards the fields a completion needs and drops everything else', () => {
    const out = upstreamBody({
      model: 'ignored — the plan decides', messages: MESSAGES, temperature: 0.7, max_tokens: 400,
      response_format: { type: 'json_object' },
      n: 50, logprobs: true, provider: { order: ['expensive'] }, user: 'someone-else',
    }, 'a/b');
    assert.deepEqual(out, {
      model: 'a/b', messages: MESSAGES, temperature: 0.7, max_tokens: 400,
      response_format: { type: 'json_object' },
    });
  });

  it('forces usage reporting on a stream — an uncharged call is a free call', () => {
    const out = upstreamBody({ messages: MESSAGES, stream: true }, 'a/b');
    assert.deepEqual(out.stream_options, { include_usage: true });
    assert.equal(upstreamBody({ messages: MESSAGES }, 'a/b').stream_options, undefined);
  });
});

describe('usage', () => {
  it('reads a reported total and refuses to invent one', () => {
    assert.equal(usageTokens({ usage: { total_tokens: 1234 } }), 1234);
    for (const shape of [null, {}, { usage: {} }, { usage: { total_tokens: 0 } }, { usage: { total_tokens: -5 } }]) {
      assert.equal(usageTokens(shape), 0);
    }
  });
});

describe('planning a completion', () => {
  const plan = (body, opts = {}) => planCompletion({
    tier: 'free', body, budget: emptyRelayBudget(), env: {}, now: T0, ...opts,
  });

  it('serves the tier\'s medium slot when no model is named', () => {
    const out = plan({ messages: MESSAGES });
    assert.equal(out.status, 200);
    assert.equal(out.model, FREE_MODELS.medium);
  });

  it('refuses a model the tier may not use — as a 400, so the client re-tries another', () => {
    const out = plan({ messages: MESSAGES, model: PAID_MODELS.medium });
    assert.equal(out.status, 400, 'the client library treats 400 as model-swappable and walks its chain');
    assert.equal(out.body.error.type, 'model_not_allowed');
    assert.match(out.body.error.message, /not available on tier 'free'/);
    assert.match(out.body.error.message, new RegExp(FREE_MODELS.medium.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')),
      'the refusal names what the tenant CAN use');
  });

  it('lets a paid tier through to a paid model', () => {
    const out = plan({ messages: MESSAGES, model: PAID_MODELS.medium }, { tier: 'studio' });
    assert.equal(out.status, 200);
    assert.equal(out.model, PAID_MODELS.medium);
  });

  it('refuses a spent budget as 402, not 429', () => {
    // 429 is the client's signal to walk the fallback chain, and every entry
    // would fail the same per-tenant check — three more requests, three more
    // refusals, one more confused player.
    const spent = chargeRelay(emptyRelayBudget(), RELAY_TIERS.free.budget, T0);
    const out = plan({ messages: MESSAGES }, { budget: spent });
    assert.equal(out.status, 402);
    assert.equal(out.body.error.type, 'budget_exhausted');
    assert.equal(out.body.error.resets_in_seconds, 24 * 60 * 60);
    assert.equal(out.body.error.tier, 'free');
  });

  it('refuses a body that is not a completion request', () => {
    for (const body of [null, 'text', [], {}, { messages: [] }, { messages: 'hi' }]) {
      const out = plan(body);
      assert.equal(out.status, 400, `expected 400 for ${JSON.stringify(body)}`);
      assert.equal(out.body.error.type, 'invalid_request');
    }
  });
});

describe('payloads a tenant may read', () => {
  it('/v1/models is catalog-shaped, so the client\'s model healer can use it', () => {
    const payload = modelsPayload('free', {});
    assert.equal(payload.object, 'list');
    const ids = payload.data.map((m) => m.id);
    assert.ok(ids.includes(FREE_MODELS.medium));
    assert.ok(!ids.includes(PAID_MODELS.medium));
    assert.deepEqual(ids, [...ids].sort(), 'stable order — a catalog is not a set of surprises');
  });

  it('/v1/status carries the marker, the tier, the models and the budget', () => {
    const budget = chargeRelay(emptyRelayBudget({ tier: 'patron' }), 900, T0);
    const s = statusPayload({ tier: 'patron', budget, version: '9.9.9', enabled: true, env: {} });
    assert.equal(s.relay, RELAY_MARKER);
    assert.equal(s.version, '9.9.9');
    assert.equal(s.relayEnabled, true);
    assert.equal(s.tier, 'patron');
    assert.equal(s.models, PAID_MODELS);
    assert.equal(s.budget.spent, 900);
    assert.equal(s.budget.budget, RELAY_TIERS.patron.budget);
  });

  it('/v1/status says so when the deployment relays nothing, and offers no models', () => {
    const s = statusPayload({ tier: 'free', budget: null, version: '9.9.9', enabled: false, env: {} });
    assert.equal(s.relay, RELAY_MARKER, 'still identifiably a relay — the token IS valid');
    assert.equal(s.relayEnabled, false);
    assert.equal(s.models, null);
    assert.equal(s.budget, null);
    assert.match(s.hint, /your own provider key/);
  });

  it('never leaks the provider key', () => {
    const s = statusPayload({
      tier: 'free', budget: emptyRelayBudget(), version: '1', enabled: true,
      env: { BOH_LLM_API_KEY: 'sk-secret', BOH_LLM_URL: 'https://llm.internal/v1' },
    });
    assert.ok(!JSON.stringify(s).includes('sk-secret'));
    assert.equal(s.provider, 'https://llm.internal/v1', 'the provider URL is a public fact');
  });
});

describe('budget bookkeeping', () => {
  it('heals a stored budget to the tier that applies now', () => {
    const stored = chargeRelay(emptyRelayBudget({ tier: 'free' }), 100_000, T0);
    const upgraded = budgetForTier(stored, 'studio');
    assert.equal(upgraded.tier, 'studio');
    assert.equal(upgraded.budget, RELAY_TIERS.studio.budget);
    assert.equal(upgraded.spent, 100_000, 'the spend follows the tenant across the upgrade');
  });

  it('a missing file starts a fresh window on the current tier', () => {
    const fresh = budgetForTier(null, 'patron');
    assert.equal(fresh.tier, 'patron');
    assert.equal(fresh.spent, 0);
  });

  it('charging accumulates in the window and for all time', () => {
    const b = chargeCall(chargeCall(budgetForTier(null, 'free'), 500, T0), 700, T0 + 1_000);
    assert.equal(b.spent, 1_200);
    assert.equal(b.tokens, 1_200);
    assert.equal(b.calls, 2);
  });
});
