// Campaign lifecycle tools — the session-start surface: list to resume,
// delete with the two-key turn, and the export→import hand-off that moves a
// whole campaign (memory + state + playthrough) between servers or hosts.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { bakeCartridge } from '@zeeuw/bag-of-holding-client';
import { createWorlds } from '../src/worlds.js';
import { createMemoryStore } from '../src/memory/store.js';
import { createPlaythroughs } from '../src/playthroughs.js';
import { campaignTools } from '../src/tools/campaigns.js';
import { memoryTools } from '../src/tools/memory.js';
import { parse } from './_helpers.js';

let worldsDir, worlds;
const tmpDirs = [];
function harness() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boh-camp-'));
  tmpDirs.push(dir);
  const store = createMemoryStore({ dataDir: dir, tokenHashes: [] });
  const pt = createPlaythroughs(worlds, store);
  const byName = new Map([...campaignTools(store), ...memoryTools(store)].map((t) => [t.name, t]));
  return {
    store, pt,
    run: async (name, args = {}) => parse(await byName.get(name).handler(args)),
  };
}

before(async () => {
  worldsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boh-camp-worlds-'));
  tmpDirs.push(worldsDir);
  fs.writeFileSync(path.join(worldsDir, 'world-1234.json'), JSON.stringify(await bakeCartridge(1234)));
  worlds = createWorlds({ dir: worldsDir });
});
after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

test('campaign_list presents the resume screen: bindings, sizes, recency order', async () => {
  const h = harness();
  const empty = await h.run('campaign_list', {});
  assert.deepEqual(empty.data.campaigns, []);
  assert.match(empty.data.hint, /world_begin/);

  h.store.record(undefined, 'old-fen', { type: 'note', text: 'an old campaign, played first.' });
  h.pt.begin(undefined, 'old-fen', 'world-1234');
  h.pt.commit(undefined, 'old-fen', [{ turn: 1, target: 'npc.tally', path: 'mood', to: 'wary' }]);
  h.store.record(undefined, 'fresh-reach', { type: 'note', text: 'a new campaign, touched last.' });

  const r = await h.run('campaign_list', {});
  assert.deepEqual(r.data.campaigns.map((c) => c.campaign), ['fresh-reach', 'old-fen'],
    'newest activity first — the resume screen leads with where the table left off');
  const fen = r.data.campaigns.find((c) => c.campaign === 'old-fen');
  assert.equal(fen.world.worldId, 'world-1234');
  assert.ok(fen.world.start, 'the landing is on the card');
  assert.equal(fen.records, 1);
  assert.equal(fen.ledgerLength, 1, 'the world ledger shows on the card');
  assert.equal(r.data.campaigns.find((c) => c.campaign === 'fresh-reach').world, null,
    'a campaign with no world binding says so instead of inventing one');
  assert.match(r.data.hint, /Resume/);
});

test('campaign_delete needs the two-key turn, then removes everything', async () => {
  const h = harness();
  h.store.record(undefined, 'doomed', { type: 'note', text: 'soon gone.' });
  h.pt.begin(undefined, 'doomed', 'world-1234');

  const refused = await h.run('campaign_delete', { campaign: 'doomed', confirm: 'domed' });
  assert.equal(refused.isError, true);
  assert.match(refused.message, /does not match/);
  assert.equal((await h.run('campaign_list', {})).data.campaigns.length, 1, 'a typo deletes nothing');

  const done = await h.run('campaign_delete', { campaign: 'doomed', confirm: 'doomed' });
  assert.deepEqual(done.data, { deleted: 'doomed' });
  assert.deepEqual((await h.run('campaign_list', {})).data.campaigns, []);
  assert.equal(h.pt.pin(undefined, 'doomed'), null, 'the playthrough went with it');

  const missing = await h.run('campaign_delete', { campaign: 'doomed', confirm: 'doomed' });
  assert.equal(missing.isError, true);
  assert.match(missing.message, /campaign_list shows what exists/);
});

test('export → import moves a whole campaign: memory, state, playthrough', async () => {
  const h = harness();
  h.store.record(undefined, 'fen', { type: 'npc', text: 'Met Tally beneath the sluice-gates.', entities: ['Tally'] });
  h.store.stateSave(undefined, 'fen', 'party', { pcs: [{ name: 'Bren', hp: 11 }] });
  h.pt.begin(undefined, 'fen', 'world-1234');
  h.pt.commit(undefined, 'fen', [{ turn: 1, target: 'npc.tally', path: 'mood', to: 'wary' }]);

  const dump = (await h.run('memory_export', { campaign: 'fen' })).data;
  assert.equal(dump.records.length, 1);
  assert.deepEqual(Object.keys(dump.state), ['party']);
  assert.equal(dump.world.pin.worldId, 'world-1234');
  assert.equal(dump.world.ledger.length, 1);
  assert.ok(dump.world.observed['npc.tally'], 'observations travel too');

  // Into a fresh campaign on a DIFFERENT store — "continue it elsewhere".
  const other = harness();
  const imported = (await other.run('memory_import', {
    campaign: 'fen-moved', records: dump.records, state: dump.state, world: dump.world,
  })).data;
  assert.deepEqual(imported, { imported: 1, stateKeys: 1, world: true, campaign: 'fen-moved' });

  const replay = other.pt.replay(undefined, 'fen-moved');
  assert.equal(replay.applied, 1);
  assert.equal(replay.state['npc.tally'].mood, 'wary');
  assert.equal(replay.digest, dump.world.pin.digest, 'same pin, same world, same fold');
  assert.deepEqual(other.store.stateLoad(undefined, 'fen-moved', 'party').data.pcs[0], { name: 'Bren', hp: 11 });

  // A playthrough never paves over an existing binding.
  const clash = await other.run('memory_import', {
    campaign: 'fen-moved', records: [], world: dump.world,
  });
  assert.equal(clash.isError, true);
  assert.match(clash.message, /already has a world/);
});
