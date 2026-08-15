// World tools — cartridges mounted, playthroughs over immutable bases,
// playback.
//
// Bakes a real cartridge with the client (dev-linked, same as the engine) into
// a temp dir, then drives the registry and the tool handlers directly — the
// same no-transport pattern every other tool test here uses. Playthroughs
// persist through a memory store rooted in another temp dir.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { bakeCartridge } from '@zeeuw/bag-of-holding-client';
import { createWorlds } from '../src/worlds.js';
import { createMemoryStore } from '../src/memory/store.js';
import { createPlaythroughs } from '../src/playthroughs.js';
import { worldsTools } from '../src/tools/worlds.js';
import { createServer } from '../src/server.js';

let dir, worlds, tools;
const tool = (name) => tools.find(t => t.name === name).handler;
const freshTools = (w) => worldsTools(w,
  createPlaythroughs(w, createMemoryStore({ dataDir: mkdtempSync(join(tmpdir(), 'boh-pt-')), tokenHashes: [] })));

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'boh-worlds-'));
  const cart = await bakeCartridge(1234);
  writeFileSync(join(dir, 'world-1234.json'), JSON.stringify(cart));
  worlds = createWorlds({ dir });
  tools = freshTools(worlds);
});

test('world_catalog lists mounted cartridges with their digest identity', async () => {
  const r = await tool('world_catalog')({});
  assert.equal(r.structuredContent.worlds.length, 1);
  const w = r.structuredContent.worlds[0];
  assert.equal(w.id, 'world-1234');
  assert.equal(typeof w.digest, 'string');
  assert.ok(w.provinces >= 4);
  assert.deepEqual(worlds.errors, []);
});

test('world_begin binds the campaign at the first port; unknown worlds error', async () => {
  const r = await tool('world_begin')({ campaign: 'fen-begin', world: 'world-1234' });
  const { campaign, digest, start } = r.structuredContent;
  assert.equal(campaign, 'fen-begin');
  assert.equal(digest, worlds.get('world-1234').digest);
  assert.ok(worlds.get('world-1234').geo.nodes[start].port);
  const bad = await tool('world_begin')({ campaign: 'fen-bad', world: 'world-9' });
  assert.equal(bad.isError, true);
  // One campaign, one world: beginning twice is refused, not silently rebound.
  const twice = await tool('world_begin')({ campaign: 'fen-begin', world: 'world-1234' });
  assert.equal(twice.isError, true);
  assert.match(twice.content[0].text, /already bound/);
});

test('world_node serves the tree record, slice, crown, and bound legends', async () => {
  const w = worlds.get('world-1234');
  const pId = w.provinces.find(p => w.geo.nodes[p].port);
  const r = await tool('world_node')({ world: 'world-1234', node: pId });
  const out = r.structuredContent;
  assert.equal(out.node.id, pId);
  assert.equal(out.slice.climate, w.geo.nodes[pId].climate);
  assert.equal(out.crown.id, `${pId}.crown`);
  // the explorer's dividend guarantees the first port carries a legend
  assert.ok(out.legends.length >= 1, 'first port must be legend-bound');
});

test('world_lineage walks root-down', async () => {
  const w = worlds.get('world-1234');
  const pId = w.provinces[0];
  const r = await tool('world_lineage')({ world: 'world-1234', node: pId });
  const lineage = r.structuredContent.lineage;
  assert.equal(lineage.length, 1);
  assert.equal(lineage[0].kind, 'continent');
});

test('world_commit + world_replay: the ledger over the base is the campaign', async () => {
  await tool('world_begin')({ campaign: 'fen-play', world: 'world-1234' });
  const committed = (await tool('world_commit')({ campaign: 'fen-play', patches: [
    { turn: 1, target: 'npc.vera', scope: 'local', kind: 'canon', path: 'mood', to: 'wary' },
    { turn: 2, target: 'npc.vera', scope: 'local', kind: 'mechanical', path: 'hp', to: 7 },
    { turn: 3, target: 'npc.vera', scope: 'local', kind: 'canon', path: 'mood', to: 'grateful' },
  ]})).structuredContent;
  assert.equal(committed.appended, 3);
  assert.deepEqual(committed.rejected, []);
  const full = (await tool('world_replay')({ campaign: 'fen-play' })).structuredContent;
  assert.equal(full.applied, 3);
  assert.equal(full.state['npc.vera'].mood, 'grateful');
  assert.equal(full.state['npc.vera'].hp, 7);
  const early = (await tool('world_replay')({ campaign: 'fen-play', upToTurn: 1 })).structuredContent;
  assert.equal(early.applied, 1);
  assert.equal(early.state['npc.vera'].mood, 'wary');
  assert.equal(early.state['npc.vera'].hp, undefined);
  // the cartridge base was never touched
  assert.equal(worlds.get('world-1234').digest, full.digest);
});

test('replay folds cartridge entities over their REAL content, not over {}', async () => {
  const w = worlds.get('world-1234');
  const pId = w.provinces[0];
  await tool('world_begin')({ campaign: 'fen-fold', world: 'world-1234' });
  await tool('world_commit')({ campaign: 'fen-fold', patches: [
    { turn: 1, target: pId, scope: 'regional', kind: 'canon', path: 'node.mood', to: 'uneasy' },
  ]});
  const r = (await tool('world_replay')({ campaign: 'fen-fold' })).structuredContent;
  // The patch landed…
  assert.equal(r.state[pId].node.mood, 'uneasy');
  // …ON the cartridge's own record, which is still all there.
  assert.equal(r.state[pId].node.name, w.geo.nodes[pId].name);
  assert.equal(r.state[pId].slice.climate, w.slices[pId].climate);
});

test('world_commit validates each patch and keeps the good ones', async () => {
  await tool('world_begin')({ campaign: 'fen-valid', world: 'world-1234' });
  const r = (await tool('world_commit')({ campaign: 'fen-valid', patches: [
    { turn: 1, target: 'npc.tally', path: 'mood', to: 'watchful' },
    { turn: 1, target: 'npc.tally', path: '__proto__.polluted', to: 1 },
    { turn: 2, target: 'not a legal id!', path: 'mood', to: 'x' },
    { turn: 2, target: 'npc.tally', kind: 'mechanical', path: 'hp', to: 4 },
    { turn: 3, target: 'npc.tally', kind: 'canon', path: 'hp', to: 99 },
  ]})).structuredContent;
  assert.equal(r.appended, 2, 'the two clean patches landed');
  assert.equal(r.rejected.length, 3);
  assert.match(r.rejected[0].reason, /forbidden/);
  assert.match(r.rejected[1].reason, /invalid target/);
  assert.match(r.rejected[2].reason, /mechanical/);
  const replay = (await tool('world_replay')({ campaign: 'fen-valid' })).structuredContent;
  assert.equal(replay.state['npc.tally'].hp, 4, 'canon never overwrote mechanical truth');
});

test('a playthrough survives a fresh registry + store over the same disk', async () => {
  const ptDir = mkdtempSync(join(tmpdir(), 'boh-pt-restart-'));
  const build = () => worldsTools(createWorlds({ dir }),
    createPlaythroughs(createWorlds({ dir }), createMemoryStore({ dataDir: ptDir, tokenHashes: [] })));
  const first = build();
  await first.find(t => t.name === 'world_begin').handler({ campaign: 'fen-restart', world: 'world-1234' });
  await first.find(t => t.name === 'world_commit').handler({ campaign: 'fen-restart', patches: [
    { turn: 1, target: 'npc.vera', path: 'mood', to: 'wary' },
  ]});
  // "The server restarted": everything rebuilt from disk.
  const second = build();
  const r = (await second.find(t => t.name === 'world_replay').handler({ campaign: 'fen-restart' })).structuredContent;
  assert.equal(r.applied, 1);
  assert.equal(r.state['npc.vera'].mood, 'wary');
  assert.equal(r.worldId, 'world-1234');
});

test('createServer registers the world tools and world:// resources', () => {
  const { tools: all, worlds: w } = createServer({
    worldsDir: dir,
    memory: { dataDir: mkdtempSync(join(tmpdir(), 'boh-srv-')), tokenHashes: [] },
  });
  for (const name of ['world_catalog', 'world_begin', 'world_node', 'world_lineage', 'world_commit', 'world_replay']) {
    assert.ok(all.some(t => t.name === name), name);
  }
  assert.equal(w.list().length, 1);
});

test('a server started without a worlds dir stays calm', async () => {
  const empty = createWorlds({ dir: null });
  const r = await freshTools(empty).find(t => t.name === 'world_catalog').handler({});
  assert.deepEqual(r.structuredContent.worlds, []);
});

// ─── Settings ────────────────────────────────────────────────────────────────
//
// A catalog of several worlds is unreadable without the setting: 'heroic,
// water riot' and 'heroic, undead plague' are the same row to a host that
// cannot see one is a sealed shelter and the other a fantasy kingdom. And a
// host mounting a world it did not bake needs to know the genre BEFORE it
// writes a line of prose about it.

test('the catalog and world_begin both name the setting a world was baked under', async () => {
  const themed = mkdtempSync(join(tmpdir(), 'boh-worlds-themed-'));
  const cart = await bakeCartridge(4242, {
    setting: {
      id: 'deep-shelter',
      syllables: {
        continentPrefixes: ['Tess', 'Ander', 'Corr', 'Vale', 'Marn', 'Hess', 'Dol', 'Karn'],
        continentSuffixes: ['erume', 'sende', 'olar', 'itum', 'anor', 'ellum', 'ayen', 'orra'],
        provincePrefixes:  ['Dolm', 'Karn', 'Cass', 'Vent', 'Reth', 'Sull', 'Bram', 'Ferr', 'Halt', 'Mord'],
        provinceSuffixes:  ['hold', 'lock', 'walk', 'deck', 'ward', 'gate', 'rung', 'span', 'tier', 'bay'],
      },
      hooks: ['the archive lists it twice, differently'],
    },
  });
  writeFileSync(join(themed, 'world-4242.json'), JSON.stringify(cart));
  const w2 = createWorlds({ dir: themed });
  const t2 = freshTools(w2);

  const cat = await t2.find(t => t.name === 'world_catalog').handler({});
  assert.equal(cat.structuredContent.worlds[0].setting, 'deep-shelter');

  const begun = await t2.find(t => t.name === 'world_begin').handler({ campaign: 'shelter', world: 'world-4242' });
  assert.equal(begun.structuredContent.setting, 'deep-shelter');

  // The world really is in that setting's vocabulary, not just labelled.
  const node = await t2.find(t => t.name === 'world_node').handler({
    world: 'world-4242', node: begun.structuredContent.start,
  });
  assert.match(node.structuredContent.node.name, /^(Dolm|Karn|Cass|Vent|Reth|Sull|Bram|Ferr|Halt|Mord)/);
  assert.equal(node.structuredContent.node.hook, 'the archive lists it twice, differently');
});

test('a cartridge baked without a setting reports null rather than guessing', async () => {
  const r = await tool('world_catalog')({});
  assert.equal(r.structuredContent.worlds[0].setting, null);
  const b = await tool('world_begin')({ campaign: 'fen-setting', world: 'world-1234' });
  assert.equal(b.structuredContent.setting, null);
});
