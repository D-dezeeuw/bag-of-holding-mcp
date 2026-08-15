// Revisions on the shelf — the registry's revision ladder and how the
// playthrough layer pins against it.
//
// The load-bearing promises: get() means revision 0 forever; latest is
// selected explicitly and only at the begin/browse boundary; a running
// campaign pinned at rN keeps replaying rN after r(N+1) is published; a
// broken chain (gap or base-digest mismatch) truncates the ladder and the
// world keeps serving its last coherent resolution.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { bakeCartridge, makeRevision, makePatch, resolvedDigest, applyRevision } from '@zeeuw/bag-of-holding-client';
import { createWorlds } from '../src/worlds.js';
import { createMemoryStore } from '../src/memory/store.js';
import { createPlaythroughs } from '../src/playthroughs.js';

const tmp = [];
const tmpdir = (label) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), label)); tmp.push(d); return d; };
after(() => { for (const d of tmp) fs.rmSync(d, { recursive: true, force: true }); });

const patch = (target, cellPath, to) => makePatch({
  turn: 0, target, scope: 'world', kind: 'canon', path: cellPath, to,
  because: 'rev', source: 'revision',
});

let cart, dir, r1, r2;
before(async () => {
  cart = await bakeCartridge(1234);
  dir = tmpdir('boh-rev-worlds-');
  fs.writeFileSync(path.join(dir, 'world-1234.json'), JSON.stringify(cart));
  fs.mkdirSync(path.join(dir, 'revisions'));

  const p0 = cart.data.provinces[0];
  r1 = makeRevision({
    worldId: 'world-1234', revision: 1,
    base: { revision: 0, digest: cart.c },
    ledger: [patch(p0, 'node', { ...cart.data.geo.nodes[p0], name: 'Saltmarch' })],
    notes: 'the south reach renamed',
  });
  const afterR1 = applyRevision(cart.data, r1.data.ledger);
  r2 = makeRevision({
    worldId: 'world-1234', revision: 2,
    base: { revision: 1, digest: resolvedDigest(afterR1) },
    ledger: [patch(cart.data.lore.crowns[0].id, 'crown.legitimacy', 'usurped')],
    notes: 'the throne turned',
  });
});

const shelf = (files) => {
  for (const [name, artifact] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, 'revisions', name), JSON.stringify(artifact));
  }
  return createWorlds({ dir });
};
const clearShelf = () => { for (const f of fs.readdirSync(path.join(dir, 'revisions'))) fs.unlinkSync(path.join(dir, 'revisions', f)); };

test('a bare base has ladder [0]; revisions climb it; the catalog carries both', () => {
  clearShelf();
  const bare = createWorlds({ dir });
  assert.deepEqual(bare.revisionsOf('world-1234'), [0]);
  assert.equal(bare.latest('world-1234'), 0);
  assert.equal(bare.revisionsOf('world-9'), null);

  const w = shelf({ 'world-1234.r1.json': r1, 'world-1234.r2.json': r2 });
  assert.deepEqual(w.revisionsOf('world-1234'), [0, 1, 2]);
  const row = w.list()[0];
  assert.deepEqual(row.revisions, [0, 1, 2]);
  assert.equal(row.latest, 2);
  assert.deepEqual(w.errors, []);
});

test('resolve: revision 0 IS the pristine envelope; the chain lands revision by revision', () => {
  clearShelf();
  const w = shelf({ 'world-1234.r1.json': r1, 'world-1234.r2.json': r2 });
  const r0 = w.resolve('world-1234', 0);
  assert.equal(r0.digest, cart.c);
  assert.equal(r0.data, w.resolve('world-1234', 0).data, 'cached, not recomputed');

  const at1 = w.resolve('world-1234', 1);
  const p0 = cart.data.provinces[0];
  assert.equal(at1.data.geo.nodes[p0].name, 'Saltmarch');
  assert.equal(at1.digest, r2.data.base.digest, 'r1 resolves to exactly what r2 was authored against');

  const latest = w.resolve('world-1234');
  assert.equal(latest.revision, 2);
  assert.equal(latest.data.lore.crowns[0].legitimacy, 'usurped');
  // get() is still revision 0 — pinning would be meaningless otherwise.
  assert.notEqual(w.get('world-1234').lore.crowns[0].legitimacy, 'usurped');

  // cell() at a revision feeds replay the revised content.
  assert.equal(w.cell('world-1234', p0, 1).node.name, 'Saltmarch');
  assert.notEqual(w.cell('world-1234', p0, 0).node.name, 'Saltmarch');
});

test('a gap or a wrong base digest truncates the ladder; the base keeps serving', () => {
  clearShelf();
  const gapped = shelf({ 'world-1234.r2.json': r2 });   // no r1
  assert.deepEqual(gapped.revisionsOf('world-1234'), [0]);
  assert.ok(gapped.errors.some(e => /stranded above a gap/.test(e)));

  clearShelf();
  const forged = { ...r1, data: { ...r1.data, base: { revision: 0, digest: 'deadbeef' } } };
  const broken = shelf({ 'world-1234.r1.json': forged, 'world-1234.r2.json': r2 });
  assert.equal(broken.resolve('world-1234'), null, 'the forged rung refuses');
  assert.ok(broken.errors.some(e => /revision-base-mismatch/.test(e)));
  assert.equal(broken.latest('world-1234'), 0, 'after refusal the ladder is truncated');
  assert.equal(broken.resolve('world-1234').revision, 0, 'and latest resolves to the base again');
});

test('an orphan revision file (no base on the shelf) is reported, not mounted', () => {
  clearShelf();
  const orphan = shelf({ 'world-9999.r1.json': r1 });
  assert.ok(orphan.errors.some(e => /no base cartridge world-9999\.json/.test(e)));
  assert.equal(orphan.revisionsOf('world-9999'), null);
});

test('replay says so when the pinned revision can no longer be resolved', () => {
  clearShelf();
  const w1 = shelf({ 'world-1234.r1.json': r1 });
  const dataDir = tmpdir('boh-rev-lost-');
  const pt1 = createPlaythroughs(w1, createMemoryStore({ dataDir, tokenHashes: [] }));
  pt1.begin(undefined, 'doomed', 'world-1234');   // pinned at r1

  // The shelf loses the revision file; a fresh registry over the same disk.
  clearShelf();
  const w2 = createWorlds({ dir });
  const pt2 = createPlaythroughs(w2, createMemoryStore({ dataDir, tokenHashes: [] }));
  assert.throws(() => pt2.replay(undefined, 'doomed'), /revision 1, which this shelf can no longer resolve/);
});

test('pinning: a running campaign stays at its revision while a new one takes latest', () => {
  clearShelf();
  const w1 = shelf({ 'world-1234.r1.json': r1 });
  const dataDir = tmpdir('boh-rev-store-');
  const pt1 = createPlaythroughs(w1, createMemoryStore({ dataDir, tokenHashes: [] }));

  const early = pt1.begin(undefined, 'early-fen', 'world-1234');
  assert.equal(early.revision, 1, 'a new campaign defaults to latest');
  const pinned0 = pt1.begin(undefined, 'archive-fen', 'world-1234', { revision: 0 });
  assert.equal(pinned0.revision, 0, 'an explicit revision pins that rung');
  assert.throws(() => pt1.begin(undefined, 'no-fen', 'world-1234', { revision: 7 }), /no servable revision 7/);

  // r2 is published; the shelf reloads (new registry over the same disk).
  fs.writeFileSync(path.join(dir, 'revisions', 'world-1234.r2.json'), JSON.stringify(r2));
  const w2 = createWorlds({ dir });
  const pt2 = createPlaythroughs(w2, createMemoryStore({ dataDir, tokenHashes: [] }));

  assert.equal(pt2.pin(undefined, 'early-fen').revision, 1, 'the pin did not move');
  const replay = pt2.replay(undefined, 'early-fen');
  assert.equal(replay.revision, 1);
  const p0 = cart.data.provinces[0];
  pt2.commit(undefined, 'early-fen', [{ turn: 1, target: p0, path: 'node.mood', to: 'wary' }]);
  const folded = pt2.replay(undefined, 'early-fen');
  assert.equal(folded.state[p0].node.name, 'Saltmarch', 'replay folds over the PINNED revision\'s content');
  assert.equal(folded.state[p0].node.mood, 'wary');

  const fresh = pt2.begin(undefined, 'late-reach', 'world-1234');
  assert.equal(fresh.revision, 2, 'only the NEW campaign takes the new latest');
  assert.equal(fresh.digest, resolvedDigest(w2.resolve('world-1234', 2).data));
});
