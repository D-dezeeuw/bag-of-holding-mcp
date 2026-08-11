// World tools — cartridges mounted, sessions over immutable bases, playback.
//
// Bakes a real cartridge with the client (dev-linked, same as the engine) into
// a temp dir, then drives the registry and the tool handlers directly — the
// same no-transport pattern every other tool test here uses.

import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { bakeCartridge } from '@zeeuw/bag-of-holding-client';
import { createWorlds } from '../src/worlds.js';
import { worldsTools } from '../src/tools/worlds.js';
import { createServer } from '../src/server.js';

let dir, worlds, tools;
const tool = (name) => tools.find(t => t.name === name).handler;

before(async () => {
  dir = mkdtempSync(join(tmpdir(), 'boh-worlds-'));
  const cart = await bakeCartridge(1234);
  writeFileSync(join(dir, 'world-1234.json'), JSON.stringify(cart));
  worlds = createWorlds({ dir });
  tools = worldsTools(worlds);
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

test('world_begin starts a fresh session at the first port; unknown worlds error', async () => {
  const r = await tool('world_begin')({ world: 'world-1234' });
  const { session, digest, start } = r.structuredContent;
  assert.match(session, /^ws-/);
  assert.equal(digest, worlds.get('world-1234').digest);
  assert.ok(worlds.get('world-1234').geo.nodes[start].port);
  const bad = await tool('world_begin')({ world: 'world-9' });
  assert.equal(bad.isError, true);
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
  const { session } = (await tool('world_begin')({ world: 'world-1234' })).structuredContent;
  await tool('world_commit')({ session, patches: [
    { turn: 1, target: 'npc.vera', scope: 'local', kind: 'canon', path: 'mood', to: 'wary' },
    { turn: 2, target: 'npc.vera', scope: 'local', kind: 'mechanical', path: 'hp', to: 7 },
    { turn: 3, target: 'npc.vera', scope: 'local', kind: 'canon', path: 'mood', to: 'grateful' },
  ]});
  const full = (await tool('world_replay')({ session })).structuredContent;
  assert.equal(full.applied, 3);
  assert.equal(full.state['npc.vera'].mood, 'grateful');
  assert.equal(full.state['npc.vera'].hp, 7);
  const early = (await tool('world_replay')({ session, upToTurn: 1 })).structuredContent;
  assert.equal(early.applied, 1);
  assert.equal(early.state['npc.vera'].mood, 'wary');
  assert.equal(early.state['npc.vera'].hp, undefined);
  // the cartridge base was never touched
  assert.equal(worlds.get('world-1234').digest, full.digest);
});

test('createServer registers the world tools and world:// resources', () => {
  const { tools: all, worlds: w } = createServer({ worldsDir: dir });
  for (const name of ['world_catalog', 'world_begin', 'world_node', 'world_lineage', 'world_commit', 'world_replay']) {
    assert.ok(all.some(t => t.name === name), name);
  }
  assert.equal(w.list().length, 1);
});

test('a server started without a worlds dir stays calm', async () => {
  const empty = createWorlds({ dir: null });
  const r = await worldsTools(empty).find(t => t.name === 'world_catalog').handler({});
  assert.deepEqual(r.structuredContent.worlds, []);
});
