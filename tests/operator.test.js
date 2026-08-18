import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMemoryStore } from '../src/memory/store.js';
import { createOperatorStore, createOperatorPurge } from '../src/operator.js';

// The operator surface reads what the memory store writes, so these tests
// drive the real store rather than hand-building directories — a layout change
// that broke the pair would otherwise pass here and fail in the panel.

const tmpDirs = [];
function mkPair() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boh-operator-'));
  tmpDirs.push(dir);
  return {
    dir,
    store: createMemoryStore({ dataDir: dir, tokenHashes: [] }),
    op: createOperatorStore({ dataDir: dir }),
    purge: createOperatorPurge({ dataDir: dir }),
  };
}
after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

test('an empty or absent data directory reads as empty, not as an error', () => {
  const { op } = mkPair();
  assert.deepEqual(op.listNamespaces(), []);

  const missing = createOperatorStore({ dataDir: path.join(os.tmpdir(), 'boh-does-not-exist-xyz') });
  assert.deepEqual(missing.listNamespaces(), []);
  assert.deepEqual(missing.namespaceOverview('local').campaigns, []);
  assert.equal(missing.namespaceOverview('local').exists, false);
});

test('listNamespaces sees every tenant the store wrote, and reports sizes', () => {
  const { store, op } = mkPair();
  store.record('alice', 'fen', { type: 'note', text: 'a' });
  store.record('bob', 'keep', { type: 'note', text: 'b' });
  store.record(undefined, 'solo', { type: 'note', text: 'c' });

  const namespaces = op.listNamespaces();
  assert.equal(namespaces.length, 3);
  for (const row of namespaces) {
    assert.equal(row.campaigns, 1);
    assert.ok(row.bytes > 0, 'a namespace with a record is not zero bytes');
    assert.ok(row.lastActivityAt > 0);
  }
  // The shared local shelf and two hashed tenants — opaque by construction.
  const names = namespaces.map((n) => n.ns).sort();
  assert.equal(names.filter((n) => /^t-[0-9a-f]{16}$/.test(n)).length, 2);
  assert.ok(names.includes('local'));
});

test('a namespace overview counts records, state, ledger and world', async () => {
  const { store, op } = mkPair();
  store.record('alice', 'fen', { type: 'note', text: 'one' });
  const second = store.record('alice', 'fen', { type: 'npc', text: 'two' });
  store.record('alice', 'fen', { type: 'note', text: 'three' });
  store.forget('alice', 'fen', second.id);
  store.stateSave('alice', 'fen', 'party', { hp: 7 });
  store.stateSave('alice', 'fen', 'initiative', [1, 2]);

  const ns = store.info('alice').namespace;
  const overview = op.namespaceOverview(ns);
  assert.equal(overview.exists, true);
  assert.equal(overview.campaigns.length, 1);

  const fen = overview.campaigns[0];
  assert.equal(fen.campaign, 'fen');
  assert.equal(fen.records, 2, 'the forgotten record is folded out');
  assert.equal(fen.stateKeys, 2);
  assert.equal(fen.corruptLinesSkipped, 0);
  assert.equal(fen.truncatedTail, false);
  assert.equal(fen.ledgerEntries, 0);
  assert.equal(fen.world, null);
  assert.equal(fen.imageGate, null);
  assert.ok(fen.bytes > 0);
  assert.ok(fen.lastPlayedAt > 0);
  assert.equal(overview.lastActivityAt, fen.lastPlayedAt);
});

test('campaigns come back newest-played first', () => {
  const { store, op } = mkPair();
  store.record('alice', 'older', { type: 'note', text: 'a' });
  store.record('alice', 'newer', { type: 'note', text: 'b' });
  const ns = store.info('alice').namespace;
  // mtimes can land in the same millisecond; force a gap rather than sleep.
  const dir = path.join(op.dataDir, ns, 'older');
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(path.join(dir, 'memory.jsonl'), old, old);
  fs.utimesSync(dir, old, old);

  const names = op.namespaceOverview(ns).campaigns.map((c) => c.campaign);
  assert.deepEqual(names, ['newer', 'older']);
});

test('a torn trailing line is reported, not thrown and not silently dropped', () => {
  const { store, op } = mkPair();
  store.record('alice', 'fen', { type: 'note', text: 'complete' });
  const ns = store.info('alice').namespace;
  const file = path.join(op.dataDir, ns, 'fen', 'memory.jsonl');
  // What a reader sees when the server is mid-append.
  fs.appendFileSync(file, '{"op":"record","id":"m-2","text":"tor', 'utf8');

  const fen = op.namespaceOverview(ns).campaigns[0];
  assert.equal(fen.records, 1);
  assert.equal(fen.corruptLinesSkipped, 1);
  assert.equal(fen.truncatedTail, true, 'the panel shows "being written", not a missing record');
});

test('a corrupt line in the middle is counted without a torn tail', () => {
  const { store, op } = mkPair();
  store.record('alice', 'fen', { type: 'note', text: 'a' });
  const ns = store.info('alice').namespace;
  const file = path.join(op.dataDir, ns, 'fen', 'memory.jsonl');
  fs.appendFileSync(file, 'not json\n', 'utf8');
  store.record('alice', 'fen', { type: 'note', text: 'b' });

  const fen = op.namespaceOverview(ns).campaigns[0];
  assert.equal(fen.records, 2);
  assert.equal(fen.corruptLinesSkipped, 1);
  assert.equal(fen.truncatedTail, false);
});

test('the image gate is visible to the operator but never in an export', () => {
  const { store, op } = mkPair();
  store.record('alice', 'fen', { type: 'note', text: 'a' });
  store.imageGateSave('alice', 'fen', {
    enabled: true, tier: 'patron', budget: 40, spent: 3, renders: 11, windowStart: 1, lastRenderAt: 2,
  });
  const ns = store.info('alice').namespace;

  const fen = op.namespaceOverview(ns).campaigns[0];
  assert.deepEqual(fen.imageGate, { enabled: true, tier: 'patron', budget: 40, spent: 3, renders: 11 });

  // A budget is deployment policy, not campaign story; importing one
  // elsewhere would smuggle spend state between deployments.
  const dump = op.exportCampaign(ns, 'fen');
  assert.ok(!('imageGate' in dump));
  assert.ok(!JSON.stringify(dump).includes('patron'));
});

test('a partial image gate file reads with defaults rather than undefined', () => {
  const { store, op } = mkPair();
  store.record('alice', 'fen', { type: 'note', text: 'a' });
  const ns = store.info('alice').namespace;
  fs.writeFileSync(path.join(op.dataDir, ns, 'fen', 'image-gate.json'), '{}', 'utf8');
  assert.deepEqual(op.namespaceOverview(ns).campaigns[0].imageGate, {
    enabled: false, tier: null, budget: null, spent: 0, renders: 0,
  });
});

test('a corrupt gate or world file degrades to null instead of throwing', () => {
  const { store, op } = mkPair();
  store.record('alice', 'fen', { type: 'note', text: 'a' });
  const ns = store.info('alice').namespace;
  const dir = path.join(op.dataDir, ns, 'fen');
  fs.writeFileSync(path.join(dir, 'image-gate.json'), '{ torn', 'utf8');
  fs.writeFileSync(path.join(dir, 'world.json'), '{ torn', 'utf8');
  fs.writeFileSync(path.join(dir, 'world-observed.json'), '{ torn', 'utf8');

  const fen = op.namespaceOverview(ns).campaigns[0];
  assert.equal(fen.imageGate, null);
  assert.equal(fen.world, null);
  assert.equal(fen.observedKeys, 0);
});

test('exportCampaign matches the memory_export shape, so the files interchange', () => {
  const { store, op } = mkPair();
  store.record('alice', 'fen', { type: 'note', text: 'kept' });
  const gone = store.record('alice', 'fen', { type: 'note', text: 'gone' });
  store.forget('alice', 'fen', gone.id);
  store.stateSave('alice', 'fen', 'party', { hp: 3 });
  const ns = store.info('alice').namespace;

  const viaTool = store.exportAll('alice', 'fen');
  const viaOperator = op.exportCampaign(ns, 'fen');
  assert.equal(viaOperator.campaign, viaTool.campaign);
  assert.deepEqual(viaOperator.records, viaTool.records);
  assert.deepEqual(viaOperator.state, viaTool.state);
  assert.deepEqual(viaOperator.world, viaTool.world);
  assert.equal(viaOperator.corruptLinesSkipped, viaTool.corruptLinesSkipped);

  // And it round-trips back in through the ordinary import path.
  const back = store.importAll('carol', 'restored', viaOperator.records, { state: viaOperator.state });
  assert.equal(back.imported, 1);
  assert.equal(store.recent('carol', 'restored').records[0].text, 'kept');
});

test('exportCampaign carries the world playthrough when there is one', () => {
  const { store, op } = mkPair();
  const pin = { worldId: 'world-1234', digest: 'abc', setting: 'sundermark', start: { node: 'gate' } };
  store.worldBind('alice', 'fen', pin);
  store.worldAppend('alice', 'fen', [{ id: 'p-1', op: 'set', path: 'a', value: 1 }]);
  store.worldObserve('alice', 'fen', [{ id: 'node:gate', path: 'name', turn: 3 }]);
  const ns = store.info('alice').namespace;

  const dump = op.exportCampaign(ns, 'fen');
  assert.deepEqual(dump.world.pin, pin);
  assert.equal(dump.world.ledger.length, 1);
  assert.deepEqual(dump.world.observed, { 'node:gate': { paths: ['name'], turn: 3 } });

  const overview = op.namespaceOverview(ns).campaigns[0];
  assert.equal(overview.ledgerEntries, 1);
  assert.equal(overview.observedKeys, 1);
  assert.deepEqual(overview.world, {
    worldId: 'world-1234', setting: 'sundermark', digest: 'abc', start: { node: 'gate' },
  });
});

test('a world pin missing its optional fields reads as nulls, not undefined', () => {
  const { store, op } = mkPair();
  store.record('alice', 'fen', { type: 'note', text: 'a' });
  const ns = store.info('alice').namespace;
  fs.writeFileSync(path.join(op.dataDir, ns, 'fen', 'world.json'), JSON.stringify({}), 'utf8');
  assert.deepEqual(op.namespaceOverview(ns).campaigns[0].world, {
    worldId: null, setting: null, digest: null, start: null,
  });
});

test('a torn state checkpoint is skipped, like a torn memory line', () => {
  const { store, op } = mkPair();
  store.record('alice', 'fen', { type: 'note', text: 'a' });
  store.stateSave('alice', 'fen', 'good', { ok: true });
  const ns = store.info('alice').namespace;
  fs.writeFileSync(path.join(op.dataDir, ns, 'fen', 'state', 'bad.json'), '{ torn', 'utf8');

  const dump = op.exportCampaign(ns, 'fen');
  assert.deepEqual(Object.keys(dump.state), ['good']);
  assert.equal(op.namespaceOverview(ns).campaigns[0].stateKeys, 2, 'the file is still there, it just will not parse');
});

test('a campaign with a ledger but no memory log still reads', () => {
  const { store, op } = mkPair();
  store.worldBind('alice', 'fen', { worldId: 'w', digest: 'd' });
  const ns = store.info('alice').namespace;
  const fen = op.namespaceOverview(ns).campaigns[0];
  assert.equal(fen.records, 0);
  assert.equal(fen.corruptLinesSkipped, 0);
  const dump = op.exportCampaign(ns, 'fen');
  assert.deepEqual(dump.records, []);
});

test('exportCampaign refuses a campaign that is not there', () => {
  const { store, op } = mkPair();
  store.record('alice', 'fen', { type: 'note', text: 'a' });
  const ns = store.info('alice').namespace;
  assert.throws(() => op.exportCampaign(ns, 'nope'), /No campaign "nope"/);
});

test('names that would walk out of the data directory are refused', () => {
  const { op } = mkPair();
  for (const bad of ['..', '../etc', 'a/b', '', '-leading', 'x'.repeat(65)]) {
    assert.throws(() => op.namespaceOverview(bad), /Invalid namespace/, `namespace ${JSON.stringify(bad)}`);
    assert.throws(() => op.exportCampaign('local', bad), /Invalid campaign/, `campaign ${JSON.stringify(bad)}`);
  }
  assert.throws(() => op.namespaceOverview(undefined), /Invalid namespace/);
  assert.throws(() => op.exportCampaign(42, 'fen'), /Invalid namespace/);
});

test('stray files beside campaign directories are ignored', () => {
  const { store, op } = mkPair();
  store.record('alice', 'fen', { type: 'note', text: 'a' });
  const ns = store.info('alice').namespace;
  fs.writeFileSync(path.join(op.dataDir, ns, 'README'), 'not a campaign', 'utf8');
  fs.writeFileSync(path.join(op.dataDir, 'loose-file'), 'not a namespace', 'utf8');

  assert.deepEqual(op.namespaceOverview(ns).campaigns.map((c) => c.campaign), ['fen']);
  assert.deepEqual(op.listNamespaces().map((n) => n.ns), [ns]);
});

test('the default data directory follows the same resolution as the store', () => {
  const previous = process.env.BOH_DATA_DIR;
  try {
    process.env.BOH_DATA_DIR = '/tmp/boh-operator-env-check';
    assert.equal(createOperatorStore().dataDir, '/tmp/boh-operator-env-check');
    delete process.env.BOH_DATA_DIR;
    assert.equal(createOperatorStore().dataDir, path.join(os.homedir(), '.bag-of-holding'));
  } finally {
    if (previous === undefined) delete process.env.BOH_DATA_DIR;
    else process.env.BOH_DATA_DIR = previous;
  }
});

test('the operator surface is read-only, and that is the contract', () => {
  const { op } = mkPair();
  // Not a style assertion: the panel provisions tenants by writing the
  // registry file and must never reach into campaign data. If a write method
  // is ever added here, this is the test that should stop it.
  assert.deepEqual(
    Object.keys(op).sort(),
    ['dataDir', 'exportCampaign', 'listNamespaces', 'namespaceOverview']
  );
});

test('the operator module loads without the MCP SDK or the engine', async () => {
  // The point of the subpath export: a dashboard importing this should not
  // acquire the whole server. Asserted by reading the source rather than by
  // trusting the import graph to stay this way.
  const source = fs.readFileSync(new URL('../src/operator.js', import.meta.url), 'utf8');
  const imports = [...source.matchAll(/^import[^;]*from '([^']+)';/gm)].map((m) => m[1]);
  for (const spec of imports) {
    assert.ok(
      spec.startsWith('node:') || spec.startsWith('./'),
      `operator.js must import only node: builtins and local files, found ${spec}`
    );
  }
});

// ---- the destructive surface ----------------------------------------------
//
// Kept as a separate factory so the read surface's "no write methods exist"
// contract stays literally true. These tests are about two things: that it
// deletes exactly what it says, and that it cannot be aimed anywhere else.

test('deleting a campaign removes it and leaves the tenant\'s others alone', () => {
  const { store, op, purge } = mkPair();
  store.record('alice', 'doomed', { type: 'note', text: 'goodbye' });
  store.stateSave('alice', 'doomed', 'party', { hp: 1 });
  store.record('alice', 'kept', { type: 'note', text: 'still here' });
  const ns = store.info('alice').namespace;

  const destroyed = purge.deleteCampaign(ns, 'doomed');
  assert.equal(destroyed.campaign, 'doomed');
  assert.equal(destroyed.records, 1, 'the audit summary is captured before the delete');
  assert.equal(destroyed.stateKeys, 1);
  assert.ok(destroyed.bytes > 0);

  assert.deepEqual(op.namespaceOverview(ns).campaigns.map((c) => c.campaign), ['kept']);
  assert.equal(store.recent('alice', 'kept').records.length, 1, 'the surviving campaign still reads');
});

test('deleting a namespace removes every campaign and nobody else\'s', () => {
  const { store, op, purge } = mkPair();
  store.record('alice', 'one', { type: 'note', text: 'a' });
  store.record('alice', 'two', { type: 'note', text: 'b' });
  store.record('bob', 'his-own', { type: 'note', text: 'untouched' });
  const alice = store.info('alice').namespace;
  const bob = store.info('bob').namespace;

  const destroyed = purge.deleteNamespace(alice);
  assert.deepEqual(destroyed.campaigns.sort(), ['one', 'two']);
  assert.equal(destroyed.records, 2);
  assert.ok(destroyed.bytes > 0);

  assert.equal(op.namespaceOverview(alice).exists, false);
  assert.deepEqual(op.listNamespaces().map((n) => n.ns), [bob]);
  assert.equal(store.recent('bob', 'his-own').records.length, 1);
});

test('deleting something that is not there is an error, not a silent success', () => {
  // A double-submitted form should say so rather than report a second delete.
  const { store, purge } = mkPair();
  store.record('alice', 'fen', { type: 'note', text: 'a' });
  const ns = store.info('alice').namespace;
  assert.throws(() => purge.deleteCampaign(ns, 'never-existed'), /No campaign "never-existed"/);
  purge.deleteCampaign(ns, 'fen');
  assert.throws(() => purge.deleteCampaign(ns, 'fen'), /No campaign "fen"/);
  purge.deleteNamespace(ns);
  assert.throws(() => purge.deleteNamespace(ns), /No namespace/);
});

test('nothing can be aimed outside the data directory', () => {
  // rmSync(recursive) pointed one level too high deletes every tenant on the
  // box, so the guard is asserted rather than assumed.
  const { store, purge, dir } = mkPair();
  store.record('alice', 'fen', { type: 'note', text: 'a' });
  const ns = store.info('alice').namespace;

  for (const bad of ['..', '../..', '/etc', 'a/b', '', '.', '-lead']) {
    assert.throws(() => purge.deleteNamespace(bad), /Invalid namespace/, `ns ${JSON.stringify(bad)}`);
    assert.throws(() => purge.deleteCampaign(ns, bad), /Invalid campaign/, `campaign ${JSON.stringify(bad)}`);
  }
  assert.throws(() => purge.deleteNamespace(undefined), /Invalid namespace/);
  // And the data directory itself survives all of that.
  assert.ok(fs.existsSync(dir));
  assert.ok(fs.existsSync(path.join(dir, ns)));
});

test('the purge surface is exactly two operations', () => {
  // If a third appears, it should be a deliberate decision with its own test —
  // this factory is the one place in the package that destroys data.
  const { purge } = mkPair();
  assert.deepEqual(Object.keys(purge).sort(), ['dataDir', 'deleteCampaign', 'deleteNamespace']);
});

test('the read surface still has no write methods', () => {
  // The whole reason deletion is a separate factory.
  const { op } = mkPair();
  assert.deepEqual(Object.keys(op).sort(),
    ['dataDir', 'exportCampaign', 'listNamespaces', 'namespaceOverview']);
});

test('the purge factory resolves its data directory the same way', () => {
  const previous = process.env.BOH_DATA_DIR;
  try {
    process.env.BOH_DATA_DIR = '/tmp/boh-purge-env-check';
    assert.equal(createOperatorPurge().dataDir, '/tmp/boh-purge-env-check');
    delete process.env.BOH_DATA_DIR;
    assert.equal(createOperatorPurge().dataDir, path.join(os.homedir(), '.bag-of-holding'));
  } finally {
    if (previous === undefined) delete process.env.BOH_DATA_DIR;
    else process.env.BOH_DATA_DIR = previous;
  }
});

test('the relay budget survives a campaign delete and dies with the namespace', () => {
  // The one cross-feature invariant the inference relay adds to this surface.
  // Deleting a campaign must NOT refill a tenant's token allowance — that
  // would make "start a new campaign" the cheapest way to buy inference — so
  // the budget deliberately sits beside the campaign directories rather than
  // inside one. Deleting the tenant, on the other hand, must take it: a
  // reissued namespace starting on last month's spend would be a table that
  // cannot play.
  const { store, purge } = mkPair();
  store.record('alice', 'doomed', { type: 'note', text: 'goodbye' });
  store.relayBudgetSave('alice', { v: 1, tier: 'free', spent: 120_000, windowStart: 1, calls: 40, tokens: 120_000 });
  const ns = store.info('alice').namespace;

  purge.deleteCampaign(ns, 'doomed');
  assert.equal(store.relayBudgetLoad('alice').spent, 120_000, 'a new campaign is not a fresh allowance');

  purge.deleteNamespace(ns);
  assert.equal(store.relayBudgetLoad('alice'), null);
});
