import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMemoryStore } from '../src/memory/store.js';
import { imageTools } from '../src/tools/images.js';
import { memoryTools } from '../src/tools/memory.js';
import { IMAGE_TIERS } from '@zeeuw/bag-of-holding-client';
import { parse } from './_helpers.js';

// Like the memory tools, these close over the store rather than the session
// registry — the budget is per campaign on disk, not per engine session. The
// clock and the provider are injected so the tests never sleep and never call
// out; nothing here touches a real image model.
const tmpDirs = [];
const PIXEL = 'iVBORw0KGgoAAAANSUhEUg==';

function harness({ env = {}, tokenHashes = [], render, pinned, registry } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boh-imgtools-'));
  tmpDirs.push(dir);
  let registryFile;
  if (registry) {
    registryFile = path.join(dir, 'tenants.json');
    fs.writeFileSync(registryFile, JSON.stringify({ version: 1, tenants: registry }), 'utf8');
  }
  const store = createMemoryStore({ dataDir: dir, tokenHashes, registryFile });
  let clock = 1_700_000_000_000;
  const calls = [];
  const tools = imageTools(store, pinned, {
    env,
    now: () => clock,
    render: render ?? (async (config, prompt) => {
      calls.push({ config, prompt });
      return { ok: true, model: config.model, mimeType: 'image/png', data: PIXEL, bytes: 18 };
    }),
  });
  const byName = new Map(tools.map((t) => [t.name, t]));
  return {
    dir, store, tools, calls,
    raw: async (name, args = {}) => byName.get(name).handler(args),
    run: async (name, args = {}) => parse(await byName.get(name).handler(args)),
    advance: (ms) => { clock += ms; return clock; },
    at: () => clock,
  };
}
after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

const SCENE = 'The tide is out and the chapel stands in the mud, its bells still swinging.';
const SERVER_ENV = { BOH_IMAGE_API_KEY: 'sk-test', BOH_IMAGE_MODEL: 'test/image-model' };

test('the image surface is complete', () => {
  const { tools } = harness();
  assert.deepEqual(tools.map((t) => t.name),
    ['image_status', 'image_enable', 'image_disable', 'image_observe']);
});

test('images are off until the player asks, and status never spends', async () => {
  const { run } = harness({ env: SERVER_ENV });

  const cold = await run('image_status', { campaign: 'fen' });
  assert.equal(cold.data.enabled, false);
  assert.equal(cold.data.ready, false);
  assert.equal(cold.data.reason, 'disabled');
  assert.equal(cold.data.tier, 'free');
  assert.equal(cold.data.renderer, 'server');
  assert.equal(cold.data.model, 'test/image-model');

  const refused = await run('image_observe', { campaign: 'fen', scene: SCENE });
  assert.equal(refused.data.granted, false);
  assert.equal(refused.data.reason, 'disabled');
  assert.match(refused.data.hint, /let the player ask/);
  assert.equal(refused.data.spent, 0, 'a refusal costs nothing');

  const on = await run('image_enable', { campaign: 'fen' });
  assert.equal(on.data.enabled, true);
  assert.equal(on.data.changed, 'enabled');
  assert.equal(on.data.remaining, IMAGE_TIERS.free.budget);

  // Reading the status twice must not move the budget.
  await run('image_status', { campaign: 'fen' });
  const still = await run('image_status', { campaign: 'fen' });
  assert.equal(still.data.remaining, IMAGE_TIERS.free.budget);
  assert.equal(still.data.ready, true);
});

test('a rendered observe returns a real image block and one spent render', async () => {
  const h = harness({ env: SERVER_ENV });
  await h.run('image_enable', { campaign: 'fen' });

  const result = await h.raw('image_observe', {
    campaign: 'fen', scene: SCENE, subject: 'the bell tower', tone: 'grim', style: 'ink and wash',
  });
  const [image, text] = result.content;
  assert.equal(image.type, 'image');
  assert.equal(image.mimeType, 'image/png');
  assert.equal(image.data, PIXEL);
  assert.equal(text.type, 'text');
  assert.ok(!text.text.includes(PIXEL), 'the base64 body is not repeated in the text block');

  const data = result.structuredContent;
  assert.equal(data.rendered, true);
  assert.equal(data.granted, true);
  assert.equal(data.model, 'test/image-model');
  assert.equal(data.spent, 1);
  assert.equal(data.remaining, IMAGE_TIERS.free.budget - 1);
  assert.equal(data.retryInSeconds, IMAGE_TIERS.free.cooldownMs / 1000);

  // The prompt the provider saw is the composed art direction, not raw args.
  assert.equal(h.calls.length, 1);
  assert.match(h.calls[0].prompt, /Scene: The tide is out/);
  assert.match(h.calls[0].prompt, /Focus on: the bell tower/);
  assert.match(h.calls[0].prompt, /Style: ink and wash/);
  assert.equal(h.calls[0].config.key, 'sk-test');
});

test('the cooldown and the window budget both hold, and both explain themselves', async () => {
  const h = harness({ env: SERVER_ENV });
  await h.run('image_enable', { campaign: 'fen' });
  await h.run('image_observe', { campaign: 'fen', scene: SCENE });

  const tooSoon = await h.run('image_observe', { campaign: 'fen', scene: SCENE });
  assert.equal(tooSoon.data.granted, false);
  assert.equal(tooSoon.data.reason, 'cooldown');
  assert.equal(tooSoon.data.retryInSeconds, IMAGE_TIERS.free.cooldownMs / 1000);
  assert.equal(h.calls.length, 1, 'a refused observe never reaches the provider');

  // Burn the rest of the window's budget.
  for (let i = 1; i < IMAGE_TIERS.free.budget; i++) {
    h.advance(IMAGE_TIERS.free.cooldownMs);
    const ok = await h.run('image_observe', { campaign: 'fen', scene: SCENE });
    assert.equal(ok.data.granted, true, `render ${i + 1} should pass`);
  }
  h.advance(IMAGE_TIERS.free.cooldownMs);
  const dry = await h.run('image_observe', { campaign: 'fen', scene: SCENE });
  assert.equal(dry.data.granted, false);
  assert.equal(dry.data.reason, 'budget');
  assert.equal(dry.data.remaining, 0);
  assert.ok(dry.data.resetsInSeconds > 0);
  assert.equal(h.calls.length, IMAGE_TIERS.free.budget);

  // …and it comes back on the clock, not on a toggle.
  h.advance(IMAGE_TIERS.free.windowMs);
  const refilled = await h.run('image_observe', { campaign: 'fen', scene: SCENE });
  assert.equal(refilled.data.granted, true);
  assert.equal(refilled.data.spent, 1);
  assert.equal(refilled.data.rendersAllTime, IMAGE_TIERS.free.budget + 1);
});

test('toggling off and on again does not refill the budget', async () => {
  const h = harness({ env: SERVER_ENV });
  await h.run('image_enable', { campaign: 'fen', budget: 2 });
  await h.run('image_observe', { campaign: 'fen', scene: SCENE });
  h.advance(IMAGE_TIERS.free.cooldownMs);
  await h.run('image_observe', { campaign: 'fen', scene: SCENE });

  const off = await h.run('image_disable', { campaign: 'fen' });
  assert.equal(off.data.enabled, false);
  assert.equal(off.data.changed, 'disabled');
  assert.equal(off.data.spent, 2, 'disabling keeps the spend');

  const back = await h.run('image_enable', { campaign: 'fen', budget: 2 });
  assert.equal(back.data.spent, 2);
  assert.equal(back.data.remaining, 0);

  h.advance(IMAGE_TIERS.free.cooldownMs);
  const denied = await h.run('image_observe', { campaign: 'fen', scene: SCENE });
  assert.equal(denied.data.reason, 'budget');
});

test('image_enable can only tighten the tier allowance', async () => {
  const h = harness({ env: SERVER_ENV });
  const capped = await h.run('image_enable', { campaign: 'fen', budget: 999 });
  assert.equal(capped.data.budget, IMAGE_TIERS.free.budget);
  const tight = await h.run('image_enable', { campaign: 'fen', budget: 1 });
  assert.equal(tight.data.budget, 1);
});

test('a keyless server grants instead of rendering', async () => {
  const h = harness({ env: {} });
  const status = await h.run('image_status', { campaign: 'fen' });
  assert.equal(status.data.renderer, 'host');
  assert.equal(status.data.model, undefined);

  await h.run('image_enable', { campaign: 'fen' });
  const result = await h.raw('image_observe', { campaign: 'fen', scene: SCENE });
  assert.equal(result.content.length, 1, 'nothing was rendered, so there is no image block');
  const { data } = parse(result);
  assert.equal(data.granted, true);
  assert.equal(data.rendered, undefined);
  assert.match(data.prompt, /Scene: The tide is out/);
  assert.equal(data.grant.prompt, data.prompt);
  assert.equal(data.grant.expiresAt - data.grant.issuedAt, 5 * 60 * 1000);
  assert.equal(data.spent, 1, 'a grant is a spent render — it cannot be hoarded for free');
});

test('a failed render is refunded, not charged', async () => {
  let fail = true;
  const h = harness({
    env: SERVER_ENV,
    render: async (config, prompt) => (fail
      ? { ok: false, error: 'Image provider failed: 429 rate limited' }
      : { ok: true, model: config.model, mimeType: 'image/png', data: PIXEL, bytes: 18, prompt }),
  });
  await h.run('image_enable', { campaign: 'fen' });

  const failed = await h.run('image_observe', { campaign: 'fen', scene: SCENE });
  assert.equal(failed.data.granted, false);
  assert.equal(failed.data.reason, 'render-failed');
  assert.match(failed.data.error, /429/);
  assert.equal(failed.data.spent, 0, 'the player was not charged for a picture they never got');
  assert.equal(failed.data.retryInSeconds, 0, 'and the cooldown was rolled back too');

  fail = false;
  const ok = await h.run('image_observe', { campaign: 'fen', scene: SCENE });
  assert.equal(ok.data.rendered, true, 'the retry is possible immediately');
  assert.equal(ok.data.spent, 1);
});

test('the budget is per campaign and per namespace', async () => {
  const h = harness({ env: SERVER_ENV });
  await h.run('image_enable', { campaign: 'fen' });
  await h.run('image_observe', { campaign: 'fen', scene: SCENE });

  const other = await h.run('image_status', { campaign: 'reach' });
  assert.equal(other.data.enabled, false, 'a second campaign starts shut');

  const tenant = await h.run('image_status', { campaign: 'fen', token: 'someone-elses-table' });
  assert.equal(tenant.data.enabled, false);
  assert.equal(tenant.data.spent, 0);
});

test('a pinned token hides the token parameter, as it does for memory', async () => {
  const { tools, run } = harness({ env: SERVER_ENV, pinned: 'tenant-1', tokenHashes: [] });
  for (const tool of tools) {
    assert.ok(!('token' in tool.input), `${tool.name} must not offer the model a token field`);
  }
  const status = await run('image_status', { campaign: 'fen' });
  assert.equal(status.data.enabled, false);
  await run('image_enable', { campaign: 'fen' });
  assert.equal((await run('image_status', { campaign: 'fen' })).data.enabled, true);
});

test('the gate survives a restart and lives outside the state vault', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boh-imggate-'));
  tmpDirs.push(dir);
  const store = createMemoryStore({ dataDir: dir, tokenHashes: [] });
  let clock = 1_700_000_000_000;
  const build = () => {
    const tools = imageTools(store, undefined, { env: SERVER_ENV, now: () => clock, render: async (c) => ({ ok: true, model: c.model, mimeType: 'image/png', data: PIXEL, bytes: 18 }) });
    const byName = new Map(tools.map((t) => [t.name, t]));
    return async (name, args = {}) => parse(await byName.get(name).handler(args));
  };

  const first = build();
  await first('image_enable', { campaign: 'fen' });
  await first('image_observe', { campaign: 'fen', scene: SCENE });

  const restarted = build();
  const status = await restarted('image_status', { campaign: 'fen' });
  assert.equal(status.data.enabled, true, 'the toggle survived');
  assert.equal(status.data.spent, 1, 'and so did the spend');

  // The state vault must not see it — otherwise state_save could rewrite the
  // budget, and the ceiling would be decorative.
  const stateRun = (() => {
    const byName = new Map(memoryTools(store).map((t) => [t.name, t]));
    return async (name, args = {}) => parse(await byName.get(name).handler(args));
  })();
  const keys = await stateRun('state_list', { campaign: 'fen' });
  assert.deepEqual(keys.data.keys, []);
  assert.ok(fs.existsSync(path.join(dir, 'local', 'fen', 'image-gate.json')));

  // A hand-edited gate cannot mint budget either.
  fs.writeFileSync(path.join(dir, 'local', 'fen', 'image-gate.json'),
    JSON.stringify({ enabled: true, budget: 9999, spent: 0, cooldownMs: 0, windowMs: 1 }), 'utf8');
  const tampered = await restarted('image_status', { campaign: 'fen' });
  assert.equal(tampered.data.budget, IMAGE_TIERS.free.budget);
  assert.equal(tampered.data.cooldownSeconds, IMAGE_TIERS.free.cooldownMs / 1000);

  // A corrupt gate heals to "off" — the safe direction.
  fs.writeFileSync(path.join(dir, 'local', 'fen', 'image-gate.json'), '{ not json', 'utf8');
  const healed = await restarted('image_status', { campaign: 'fen' });
  assert.equal(healed.data.enabled, false);
});

test('a broken scene is rejected before it can cost anything', async () => {
  const h = harness({ env: SERVER_ENV });
  await h.run('image_enable', { campaign: 'fen' });
  const bad = await h.run('image_observe', { campaign: 'fen', scene: '        ' });
  assert.equal(bad.isError, true);
  assert.match(bad.message, /needs a `scene`/);
  assert.equal((await h.run('image_status', { campaign: 'fen' })).data.spent, 0);
});

test('storage errors surface as tool errors, not crashes', async () => {
  const h = harness({ env: SERVER_ENV });
  for (const name of ['image_status', 'image_enable', 'image_disable', 'image_observe']) {
    const bad = await h.run(name, { campaign: '../escape', scene: SCENE });
    assert.equal(bad.isError, true, `${name} should refuse a traversal-shaped campaign name`);
    assert.match(bad.message, /campaign/i);
  }
});

test('with nothing injected it runs on the wall clock and the real renderer', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boh-imgdefault-'));
  tmpDirs.push(dir);
  const store = createMemoryStore({ dataDir: dir, tokenHashes: [] });
  // Only the environment is pinned (so a developer with BOH_IMAGE_API_KEY
  // exported can't make this test call a real provider); the clock and the
  // renderer are the module's own defaults.
  const byName = new Map(imageTools(store, undefined, { env: {} }).map((t) => [t.name, t]));
  const run = async (name, args = {}) => parse(await byName.get(name).handler(args));

  const before = Date.now();
  await run('image_enable', { campaign: 'fen' });
  const status = await run('image_status', { campaign: 'fen' });
  assert.equal(status.data.enabled, true);
  assert.equal(status.data.ready, true);
  assert.equal(status.data.resetsInSeconds, IMAGE_TIERS.free.windowMs / 1000,
    'the window only starts when the first render is asked for, not when images are switched on');

  // Keyless, so this takes the grant path — no provider is called, and the
  // timestamps come from the real clock rather than an injected one.
  const observed = await run('image_observe', { campaign: 'fen', scene: SCENE });
  assert.equal(observed.data.granted, true);
  assert.ok(observed.data.grant.issuedAt >= before && observed.data.grant.issuedAt <= Date.now());
  assert.equal(store.imageGateLoad(undefined, 'fen').spent, 1);
});

test('the server tier is the server\'s to set, and no tool takes one', async () => {
  const h = harness({ env: { ...SERVER_ENV, BOH_IMAGE_TIER: 'patron' } });
  const on = await h.run('image_enable', { campaign: 'fen' });
  assert.equal(on.data.tier, 'patron');
  assert.equal(on.data.budget, IMAGE_TIERS.patron.budget);
  for (const tool of h.tools) assert.ok(!('tier' in tool.input), `${tool.name} must not let the model pick a tier`);

  const nonsense = harness({ env: { ...SERVER_ENV, BOH_IMAGE_TIER: 'legendary' } });
  assert.equal((await nonsense.run('image_status', { campaign: 'fen' })).data.tier, 'free');
});

test('a tenant plays on the tier its registry entry names', async () => {
  // The point of the whole tenancy slice: two tokens on one deployment, two
  // different allowances, neither of them chosen by the model.
  const { createHash } = await import('node:crypto');
  const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
  const h = harness({
    env: SERVER_ENV,
    registry: {
      [sha256('paid')]: { tier: 'studio', status: 'active' },
      [sha256('plain')]: { status: 'active' },
    },
  });

  const paid = await h.run('image_enable', { campaign: 'fen', token: 'paid' });
  assert.equal(paid.data.tier, 'studio');
  assert.equal(paid.data.budget, IMAGE_TIERS.studio.budget);

  // Same server, same env, different tenant: no registry tier, so the
  // deployment default applies.
  const plain = await h.run('image_enable', { campaign: 'fen', token: 'plain' });
  assert.equal(plain.data.tier, SERVER_ENV.BOH_IMAGE_TIER ?? 'free');
  assert.notEqual(plain.data.budget, IMAGE_TIERS.studio.budget);
});

test('a downgrade clamps a budget already written to disk', async () => {
  // The gate is persisted per campaign, so a tier change has to reach through
  // stored state rather than only applying to fresh gates.
  const { createHash } = await import('node:crypto');
  const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boh-imgtools-'));
  tmpDirs.push(dir);
  const registryFile = path.join(dir, 'tenants.json');
  const write = (tier) => fs.writeFileSync(registryFile, JSON.stringify({
    version: 1, tenants: { [sha256('tok')]: { tier, status: 'active' } },
  }), 'utf8');
  write('studio');

  let clock = 1_700_000_000_000;
  const store = createMemoryStore({
    dataDir: dir, tokenHashes: [], registryFile,
    registryTtlMs: 10, now: () => clock, warn: () => {},
  });
  const mk = () => new Map(imageTools(store, undefined, {
    env: {}, now: () => clock, render: async () => ({ ok: false, reason: 'no' }),
  }).map((t) => [t.name, t]));

  const big = parse(await mk().get('image_enable').handler({ campaign: 'fen', token: 'tok' }));
  assert.equal(big.data.budget, IMAGE_TIERS.studio.budget);

  write('free');
  clock += 50;
  const small = parse(await mk().get('image_status').handler({ campaign: 'fen', token: 'tok' }));
  assert.equal(small.data.tier, 'free');
  assert.equal(small.data.budget, IMAGE_TIERS.free.budget,
    'the persisted studio budget must not survive the downgrade');
});

test('grant ids are unguessable, because this server mints them for many tenants', async () => {
  // The client library's default id is `g-<renders>-<now>`, which is
  // deterministic on purpose and forgeable the moment more than one tenant is
  // involved: renders and clock are both guessable from the outside.
  const h = harness({ env: {} });   // keyless server, so observe returns a grant
  await h.run('image_enable', { campaign: 'fen' });
  const first = await h.run('image_observe', { campaign: 'fen', scene: SCENE });
  h.advance(IMAGE_TIERS.free.cooldownMs);
  const second = await h.run('image_observe', { campaign: 'fen', scene: SCENE });

  for (const grant of [first.data.grant, second.data.grant]) {
    assert.match(grant.id, /^g-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  }
  assert.notEqual(first.data.grant.id, second.data.grant.id);
  assert.ok(!first.data.grant.id.includes(String(h.at())), 'the clock must not be recoverable from the id');
});
