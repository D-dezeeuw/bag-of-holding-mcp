// Playthroughs + the store's world-binding methods — the persistence half of
// "the campaign name is the playthrough id". The tool-level flows live in
// tests/worlds.test.js and tests/http.test.js; this file pins the layer
// underneath: pin lifecycle, ledger discipline, observation merging, and the
// honest failure modes (corrupt files, a shelf that lost a cartridge).

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { bakeCartridge } from '@zeeuw/bag-of-holding-client';
import { createWorlds } from '../src/worlds.js';
import { createMemoryStore } from '../src/memory/store.js';
import { createPlaythroughs } from '../src/playthroughs.js';

let worldsDir, worlds;
const tmpDirs = [];
const freshStore = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boh-ptu-'));
  tmpDirs.push(dir);
  return createMemoryStore({ dataDir: dir, tokenHashes: [] });
};

before(async () => {
  worldsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boh-ptu-worlds-'));
  tmpDirs.push(worldsDir);
  fs.writeFileSync(path.join(worldsDir, 'world-1234.json'), JSON.stringify(await bakeCartridge(1234)));
  worlds = createWorlds({ dir: worldsDir });
});
after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

test('commit and replay refuse an unbound campaign with a pointer at world_begin', () => {
  const pt = createPlaythroughs(worlds, freshStore());
  assert.throws(() => pt.commit(undefined, 'unbound', [{ turn: 1, target: 'npc.x', path: 'a', to: 1 }]),
    /world_begin first/);
  assert.equal(pt.replay(undefined, 'unbound'), null);
  // observeRead on an unbound campaign is a silent no-op — reads must never throw.
  pt.observeRead(undefined, 'unbound', 'continent-0');
});

test('replay says so loudly when the shelf no longer mounts the pinned world', () => {
  const store = freshStore();
  const pt = createPlaythroughs(worlds, store);
  pt.begin(undefined, 'fen', 'world-1234');
  // "The worlds dir changed under a pinned campaign": an empty registry.
  const emptied = createPlaythroughs(createWorlds({ dir: null }), store);
  assert.throws(() => emptied.replay(undefined, 'fen'), /no longer mounts/);
});

test('a corrupt pin reads as unbound, and worldBind still refuses to overwrite the file', () => {
  const store = freshStore();
  const pt = createPlaythroughs(worlds, store);
  pt.begin(undefined, 'fen', 'world-1234');
  const pinFile = path.join(store.dataDir, 'local', 'fen', 'world.json');
  fs.writeFileSync(pinFile, '{ not json', 'utf8');
  assert.equal(store.worldPin(undefined, 'fen'), null, 'corrupt pin reads as unbound');
  // …but the FILE still exists, so begin cannot silently pave over a campaign.
  assert.throws(() => pt.begin(undefined, 'fen', 'world-1234'), /already bound/);
});

test('the ledger skips corrupt lines and unknown ops without losing the campaign', () => {
  const store = freshStore();
  const pt = createPlaythroughs(worlds, store);
  pt.begin(undefined, 'fen', 'world-1234');
  pt.commit(undefined, 'fen', [{ turn: 1, target: 'npc.vera', path: 'mood', to: 'wary' }]);
  const ledgerFile = path.join(store.dataDir, 'local', 'fen', 'world-ledger.jsonl');
  fs.appendFileSync(ledgerFile, 'torn wr\n{"op":"compact","future":true}\n', 'utf8');
  const { patches, corruptLinesSkipped } = store.worldLedger(undefined, 'fen');
  assert.equal(patches.length, 1, 'the good patch survives; the unknown op is ignored');
  assert.equal(corruptLinesSkipped, 1);
  assert.equal(pt.replay(undefined, 'fen').applied, 1);
});

test('worldAppend with an empty batch touches nothing', () => {
  const store = freshStore();
  assert.deepEqual(store.worldAppend(undefined, 'fen', []), { appended: 0 });
  assert.ok(!fs.existsSync(path.join(store.dataDir, 'local', 'fen', 'world-ledger.jsonl')));
});

test('observations merge upward and never narrow', () => {
  const store = freshStore();
  // Path lists grow…
  store.worldObserve(undefined, 'fen', [{ id: 'continent-0.province-1', path: 'outline', turn: 3 }]);
  store.worldObserve(undefined, 'fen', [{ id: 'continent-0.province-1', path: 'node', turn: 5 }]);
  let obs = store.worldObserved(undefined, 'fen');
  assert.deepEqual(obs['continent-0.province-1'], { paths: ['node', 'outline'], turn: 3 });
  // …'*' swallows them…
  store.worldObserve(undefined, 'fen', [{ id: 'continent-0.province-1' }]);
  obs = store.worldObserved(undefined, 'fen');
  assert.equal(obs['continent-0.province-1'].paths, '*');
  // …and nothing narrows '*' back down.
  store.worldObserve(undefined, 'fen', [{ id: 'continent-0.province-1', path: 'slice' }]);
  obs = store.worldObserved(undefined, 'fen');
  assert.equal(obs['continent-0.province-1'].paths, '*');
  // Junk entries are skipped; empty batches are no-ops.
  store.worldObserve(undefined, 'fen', [{ id: '' }, { id: 42 }]);
  assert.deepEqual(store.worldObserve(undefined, 'fen', []), {});
  // A corrupt observed file heals to empty rather than throwing.
  fs.writeFileSync(path.join(store.dataDir, 'local', 'fen', 'world-observed.json'), 'nope', 'utf8');
  assert.deepEqual(store.worldObserved(undefined, 'fen'), {});
});

test('worldRebind appends its audit trail and refuses an unbound campaign', () => {
  const store = freshStore();
  const pt = createPlaythroughs(worlds, store);
  pt.begin(undefined, 'fen', 'world-1234');
  const pin = store.worldPin(undefined, 'fen');
  const rebound = store.worldRebind(undefined, 'fen', { ...pin, digest: 'ffffffff' },
    { from: pin.digest, to: 'ffffffff', at: 0 });
  assert.equal(rebound.digest, 'ffffffff');
  assert.equal(rebound.upgrades.length, 1);
  assert.deepEqual(store.worldPin(undefined, 'fen').upgrades[0].to, 'ffffffff');
  assert.throws(() => store.worldRebind(undefined, 'elsewhere', pin, {}), /not bound/);
});

test('worldBindings lists only pinned campaigns, per namespace', () => {
  const store = freshStore();
  const pt = createPlaythroughs(worlds, store);
  pt.begin('token-a', 'fen', 'world-1234');
  store.record('token-a', 'unpinned', { type: 'note', text: 'a campaign with no world at all.' });
  pt.begin('token-b', 'reach', 'world-1234');
  const a = store.worldBindings('token-a');
  assert.deepEqual(a.map((b) => b.campaign), ['fen']);
  assert.equal(a[0].pin.worldId, 'world-1234');
  assert.deepEqual(store.worldBindings('token-b').map((b) => b.campaign), ['reach']);
  assert.deepEqual(store.worldBindings('token-untouched'), []);
});

test('commit stamps observations for what it touched', () => {
  const store = freshStore();
  const pt = createPlaythroughs(worlds, store);
  const pId = worlds.get('world-1234').provinces[0];
  pt.begin(undefined, 'fen', 'world-1234');
  pt.commit(undefined, 'fen', [
    { turn: 4, target: pId, scope: 'regional', kind: 'canon', path: 'node.mood', to: 'uneasy' },
  ]);
  const obs = store.worldObserved(undefined, 'fen');
  assert.deepEqual(obs[pId], { paths: ['node'], turn: 4 }, 'the first path segment — the cell — is what was observed');
});

test('world_node-style read observation marks the node whole once bound', () => {
  const store = freshStore();
  const pt = createPlaythroughs(worlds, store);
  pt.begin(undefined, 'fen', 'world-1234');
  pt.observeRead(undefined, 'fen', 'continent-0');
  assert.equal(store.worldObserved(undefined, 'fen')['continent-0'].paths, '*');
  // The pin passthrough is the layer's own read — same record as the store's.
  assert.equal(pt.pin(undefined, 'fen').worldId, 'world-1234');
  assert.equal(pt.pin(undefined, 'never-begun'), null);
});

test('a world with no port still lands somewhere deterministic', () => {
  // The skeleton always mints the first province as a port, so this needs a
  // stub registry: the fallback is first-province, then null — never a throw.
  const store = freshStore();
  const stub = {
    get: (id) => (id === 'world-flat'
      ? { provinces: ['p-0', 'p-1'], geo: { nodes: { 'p-0': {}, 'p-1': {} } }, digest: 'd', settingId: null }
      : null),
    cell: () => ({}),
  };
  const pt = createPlaythroughs(stub, store);
  assert.equal(pt.begin(undefined, 'flat', 'world-flat').start, 'p-0');
  assert.throws(() => pt.begin(undefined, 'flat2', 'nowhere'), /unknown world/);
});
