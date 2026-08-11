import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldTools } from '../src/tools/world.js';
import { parse } from './_helpers.js';

const tools = worldTools();
const byName = new Map(tools.map((t) => [t.name, t]));
const run = async (name, args = {}) => parse(await byName.get(name).handler(args));

test('world_list advertises the bundled packs', async () => {
  const { data } = await run('world_list');
  assert.ok(data.worlds.some((w) => w.id === 'greyfen-march' && w.setting === 'Sundermark'));
  for (const w of data.worlds) assert.ok(w.tagline && w.levelBand);
});

test('world_overview is player-safe: orientation without a single gm leak', async () => {
  const { data } = await run('world_overview', { world: 'greyfen-march' });
  assert.equal(data.regions.length, 5);
  assert.equal(data.factions.length, 6);
  assert.equal(data.gettingStarted.openers.length, 3);
  assert.ok(data.timeline.length >= 5);
  assert.equal(JSON.stringify(data).includes('"gm"'), false);
  assert.equal('secrets' in data, false);
});

test('world_region / world_faction / world_npc layer their gm material behind layer:"gm"', async () => {
  for (const [tool, args, gmField] of [
    ['world_region', { world: 'greyfen-march', region: 'wickmere' }, 'secret'],
    ['world_faction', { world: 'greyfen-march', faction: 'hollow-choir' }, 'weakness'],
    ['world_npc', { world: 'greyfen-march', npc: 'old-nod' }, 'leverage']
  ]) {
    const publicCut = await run(tool, args);
    assert.equal('gm' in publicCut.data, false, `${tool} public`);
    const gmCut = await run(tool, { ...args, layer: 'gm' });
    assert.ok(gmCut.data.gm[gmField], `${tool} gm.${gmField}`);
  }
});

test('lookups fail with a pointer at valid ids', async () => {
  const cases = [
    ['world_overview', { world: 'narnia' }, /Unknown world/],
    ['world_region', { world: 'greyfen-march', region: 'atlantis' }, /Unknown region.*wickmere/s],
    ['world_faction', { world: 'greyfen-march', faction: 'illuminati' }, /Unknown faction.*relicwardens/s],
    ['world_npc', { world: 'greyfen-march', npc: 'gandalf' }, /Unknown npc.*maela-thrice-lit/s],
    ['world_hooks', { world: 'greyfen-march', region: 'atlantis' }, /Unknown region/],
    ['world_secrets', { world: 'narnia' }, /Unknown world/],
    ['world_search', { world: 'narnia', query: 'lamp' }, /Unknown world/]
  ];
  for (const [name, args, message] of cases) {
    const result = await run(name, args);
    assert.equal(result.isError, true, name);
    assert.match(result.message, message, name);
  }
});

test('world_hooks pools openers with region hooks and filters by region', async () => {
  const all = await run('world_hooks', { world: 'greyfen-march' });
  const openers = all.data.hooks.filter((h) => h.source === 'opener');
  assert.equal(openers.length, 3);
  assert.ok(all.data.hooks.length > 12);

  const scoped = await run('world_hooks', { world: 'greyfen-march', region: 'peat-holds' });
  const sources = new Set(scoped.data.hooks.map((h) => h.source));
  assert.deepEqual([...sources].sort(), ['opener', 'peat-holds']);
});

test('world_secrets serves the GM ladder with running notes, filterable by tier', async () => {
  const all = await run('world_secrets', { world: 'greyfen-march' });
  assert.equal(all.data.secrets.length, 6);
  assert.ok(all.data.runningNotes.length >= 3);
  const core = await run('world_secrets', { world: 'greyfen-march', tier: 3 });
  assert.ok(core.data.secrets.length >= 1);
  assert.ok(core.data.secrets.every((s) => s.tier === 3));
});

test('world_search finds canon by name on the public layer', async () => {
  const { data } = await run('world_search', { world: 'greyfen-march', query: 'tollgate corporal' });
  assert.ok(data.hits.length > 0);
  assert.ok(data.hits.some((h) => h.name === 'Corporal Brine' || h.name === 'The Tollgate of Teeth'));
  const limited = await run('world_search', { world: 'greyfen-march', query: 'tollgate corporal', limit: 1 });
  assert.equal(limited.data.hits.length, 1);
});

test('world_search only surfaces secret material on the gm layer', async () => {
  const query = { world: 'greyfen-march', query: 'god-seed gestating contraction' };
  const publicHits = await run('world_search', query);
  assert.ok(publicHits.data.hits.every((h) => !h.kind.includes('secret')));
  const gmHits = await run('world_search', { ...query, layer: 'gm' });
  assert.ok(gmHits.data.hits.some((h) => h.kind === 'secret' || h.kind.endsWith('-secret')));
  assert.ok(gmHits.data.searched > publicHits.data.searched);
});
