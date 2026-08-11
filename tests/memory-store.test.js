import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createMemoryStore, MEMORY_TYPES } from '../src/memory/store.js';

// Each test gets an isolated temp root so nothing leaks between
// cases or into the developer's real ~/.bag-of-holding.
const tmpDirs = [];
function mkStore(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boh-store-'));
  tmpDirs.push(dir);
  return { store: createMemoryStore({ dataDir: dir, tokenHashes: [], ...opts }), dir };
}
after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

test('record → search round-trips a memory with entities, tags and importance', () => {
  const { store } = mkStore();
  const rec = store.record(undefined, 'fen', {
    type: 'npc',
    text: 'Met Maela Thrice-Lit; she keeps a warm lamp-glass shard.',
    entities: ['Maela Thrice-Lit'],
    tags: ['lamp-row'],
    importance: 4
  });
  assert.equal(rec.id, 'm-1');
  assert.ok(Number.isInteger(rec.ts));
  const { hits, searched, total } = store.search(undefined, 'fen', { query: 'maela shard' });
  assert.equal(total, 1);
  assert.equal(searched, 1);
  assert.equal(hits[0].id, 'm-1');
  assert.ok(hits[0].score > 0);
});

test('empty campaigns read as empty, not as errors', () => {
  const { store } = mkStore();
  assert.deepEqual(store.search(undefined, 'nothing', { query: 'x' }), { hits: [], searched: 0, total: 0 });
  assert.deepEqual(store.recent(undefined, 'nothing'), { records: [], total: 0 });
  assert.deepEqual(store.campaigns(undefined), []);
  assert.deepEqual(store.stateList(undefined, 'nothing'), { keys: [] });
});

test('nothing touches the disk until the first write', () => {
  const { store, dir } = mkStore();
  store.search(undefined, 'ghost', { query: 'x' });
  store.info(undefined);
  assert.deepEqual(fs.readdirSync(dir), []);
  store.record(undefined, 'real', { type: 'note', text: 'first write' });
  assert.deepEqual(fs.readdirSync(dir), ['local']);
});

test('search filters by type and by entity (case-insensitive; entity-less records excluded)', () => {
  const { store } = mkStore();
  store.record(undefined, 'fen', { type: 'npc', text: 'Tally keeps the books', entities: ['Tally'] });
  store.record(undefined, 'fen', { type: 'event', text: 'Tally hid the books in a cellar', entities: ['Tally'] });
  store.record(undefined, 'fen', { type: 'event', text: 'the books were mentioned at the market' });
  const byType = store.search(undefined, 'fen', { query: 'books', type: 'event' });
  assert.deepEqual(byType.hits.map((h) => h.id).sort(), ['m-2', 'm-3']);
  assert.equal(byType.searched, 2);
  const byEntity = store.search(undefined, 'fen', { query: 'books', entities: ['tally'] });
  assert.deepEqual(byEntity.hits.map((h) => h.id).sort(), ['m-1', 'm-2']);
  const byLimit = store.search(undefined, 'fen', { query: 'books', limit: 1 });
  assert.equal(byLimit.hits.length, 1);
});

test('search with no query matches nothing rather than everything', () => {
  const { store } = mkStore();
  store.record(undefined, 'fen', { type: 'note', text: 'quiet day' });
  assert.deepEqual(store.search(undefined, 'fen', {}).hits, []);
});

test('recent returns newest first, honours limit and type filter', () => {
  const { store } = mkStore();
  store.record(undefined, 'fen', { type: 'event', text: 'first' });
  store.record(undefined, 'fen', { type: 'session-summary', text: 'second' });
  store.record(undefined, 'fen', { type: 'event', text: 'third' });
  assert.deepEqual(store.recent(undefined, 'fen', { limit: 2 }).records.map((r) => r.text), ['third', 'second']);
  assert.deepEqual(
    store.recent(undefined, 'fen', { type: 'session-summary' }).records.map((r) => r.text),
    ['second']
  );
});

test('forget tombstones without rewriting history; double-forget and unknown ids throw', () => {
  const { store, dir } = mkStore();
  store.record(undefined, 'fen', { type: 'note', text: 'wrong fact', entities: ['Brine'] });
  store.record(undefined, 'fen', { type: 'note', text: 'right fact', entities: ['Brine'] });
  assert.deepEqual(store.forget(undefined, 'fen', 'm-1'), { forgotten: 'm-1' });
  assert.deepEqual(store.search(undefined, 'fen', { query: 'fact brine' }).hits.map((h) => h.id), ['m-2']);
  // Append-only on disk: 3 lines (2 records + 1 tombstone).
  const raw = fs.readFileSync(path.join(dir, 'local', 'fen', 'memory.jsonl'), 'utf8').trim().split('\n');
  assert.equal(raw.length, 3);
  assert.throws(() => store.forget(undefined, 'fen', 'm-1'), /already-forgotten/);
  assert.throws(() => store.forget(undefined, 'fen', 'm-99'), /Unknown/);
  // Ids never recycle: the next record accounts for the tombstone line.
  assert.equal(store.record(undefined, 'fen', { type: 'note', text: 'later' }).id, 'm-4');
});

test('corrupt and unknown-op lines are skipped, counted, and never fatal', () => {
  const { store, dir } = mkStore();
  store.record(undefined, 'fen', { type: 'note', text: 'kept' });
  fs.appendFileSync(
    path.join(dir, 'local', 'fen', 'memory.jsonl'),
    'this is not json\n{"op":"future-op","id":"x"}\n',
    'utf8'
  );
  const dump = store.exportAll(undefined, 'fen');
  assert.equal(dump.records.length, 1);
  assert.equal(dump.corruptLinesSkipped, 1);
});

test('export → import restores into a fresh campaign with fresh ids and original timestamps', () => {
  const { store } = mkStore();
  store.record(undefined, 'fen', { type: 'lore', text: 'the charter lapsed', importance: 5 });
  store.record(undefined, 'fen', { type: 'note', text: 'colour', importance: 1 });
  store.forget(undefined, 'fen', 'm-2');
  const dump = store.exportAll(undefined, 'fen');
  assert.equal(dump.records.length, 1);

  const result = store.importAll(undefined, 'fen-restored', dump.records);
  assert.deepEqual(result, { imported: 1, campaign: 'fen-restored' });
  const restored = store.exportAll(undefined, 'fen-restored').records;
  assert.equal(restored[0].id, 'm-1');
  assert.equal(restored[0].ts, dump.records[0].ts);
  assert.equal(restored[0].text, 'the charter lapsed');

  assert.throws(() => store.importAll(undefined, 'fen', { not: 'an array' }), /array of records/);
  assert.throws(() => store.importAll(undefined, 'fen', [{ type: 'nope', text: 'x' }]), /Invalid memory type/);
});

test('record input validation names each broken field', () => {
  const { store } = mkStore();
  const rec = (input) => () => store.record(undefined, 'fen', input);
  assert.throws(rec({ type: 'banana', text: 'x' }), /Invalid memory type/);
  assert.throws(rec({ type: 'note', text: '' }), /non-empty string/);
  assert.throws(rec({ type: 'note', text: 42 }), /non-empty string/);
  assert.throws(rec({ type: 'note', text: 'x', entities: 'Maela' }), /entities must be an array/);
  assert.throws(rec({ type: 'note', text: 'x', entities: [1] }), /entities must be an array/);
  assert.throws(rec({ type: 'note', text: 'x', tags: [{}] }), /tags must be an array/);
  assert.throws(rec({ type: 'note', text: 'x', importance: 0 }), /integer from 1/);
  assert.throws(rec({ type: 'note', text: 'x', importance: 6 }), /integer from 1/);
  assert.throws(rec({ type: 'note', text: 'x', importance: 2.5 }), /integer from 1/);
  assert.equal(MEMORY_TYPES.includes('session-summary'), true);
});

test('campaign names and state keys are traversal-proof', () => {
  const { store } = mkStore();
  for (const bad of ['../evil', 'a/b', '', 'x'.repeat(65), 42, '-starts-wrong']) {
    assert.throws(() => store.record(undefined, bad, { type: 'note', text: 'x' }), /Invalid campaign/);
  }
  assert.throws(() => store.stateSave(undefined, 'fen', '../key', { a: 1 }), /Invalid state key/);
});

test('tokens namespace storage; the raw token never appears on disk', () => {
  const { store, dir } = mkStore();
  const token = 'super-secret-token-string';
  store.record(token, 'fen', { type: 'note', text: 'alpha world' });
  store.record('other-token', 'fen', { type: 'note', text: 'beta world' });
  store.record(undefined, 'fen', { type: 'note', text: 'local world' });
  // Empty-string token means "no token" → local namespace.
  assert.equal(store.recent('', 'fen').total, 1);

  assert.equal(store.search(token, 'fen', { query: 'alpha' }).total, 1);
  assert.equal(store.search(token, 'fen', { query: 'beta' }).hits.length, 0);
  assert.deepEqual(store.campaigns(token), [{ campaign: 'fen', records: 1, stateKeys: 0 }]);

  const namespaces = fs.readdirSync(dir);
  assert.ok(namespaces.includes('local'));
  assert.ok(namespaces.includes(`t-${sha256(token).slice(0, 16)}`));
  for (const ns of namespaces) assert.ok(!ns.includes(token));
});

test('closed mode (token allowlist) rejects missing and unlisted tokens', () => {
  const goodToken = 'issued-by-the-billing-site';
  const { store } = mkStore({ tokenHashes: [sha256(goodToken).toUpperCase()] });
  assert.equal(store.authRequired, true);
  assert.throws(() => store.record(undefined, 'fen', { type: 'note', text: 'x' }), /allowlist/);
  assert.throws(() => store.record('wrong-token', 'fen', { type: 'note', text: 'x' }), /allowlist/);
  const rec = store.record(goodToken, 'fen', { type: 'note', text: 'authorised' });
  assert.equal(rec.id, 'm-1');
  assert.equal(store.info(goodToken).authRequired, true);
});

test('dataDir and allowlist resolve from the environment when not passed', () => {
  const oldDir = process.env.BOH_DATA_DIR;
  const oldHashes = process.env.BOH_MEMORY_TOKEN_HASHES;
  try {
    process.env.BOH_DATA_DIR = '/env/boh-root';
    process.env.BOH_MEMORY_TOKEN_HASHES = ` ${sha256('env-token')} , ,`;
    const store = createMemoryStore();
    assert.equal(store.dataDir, '/env/boh-root');
    assert.equal(store.authRequired, true);
    assert.throws(() => store.info('nope'), /allowlist/);
    assert.equal(store.info('env-token').namespace, `t-${sha256('env-token').slice(0, 16)}`);

    delete process.env.BOH_DATA_DIR;
    delete process.env.BOH_MEMORY_TOKEN_HASHES;
    const fallback = createMemoryStore();
    assert.equal(fallback.dataDir, path.join(os.homedir(), '.bag-of-holding'));
    assert.equal(fallback.authRequired, false);
  } finally {
    if (oldDir === undefined) delete process.env.BOH_DATA_DIR; else process.env.BOH_DATA_DIR = oldDir;
    if (oldHashes === undefined) delete process.env.BOH_MEMORY_TOKEN_HASHES; else process.env.BOH_MEMORY_TOKEN_HASHES = oldHashes;
  }
});

test('state vault: save/load/list/delete lifecycle with honest errors', () => {
  const { store, dir } = mkStore();
  const saved = store.stateSave(undefined, 'fen', 'party', { pcs: [{ name: 'Bren', hp: 11 }] });
  assert.equal(saved.key, 'party');
  assert.ok(saved.bytes > 0);
  assert.deepEqual(store.stateLoad(undefined, 'fen', 'party').data, { pcs: [{ name: 'Bren', hp: 11 }] });

  // Last write per key wins.
  store.stateSave(undefined, 'fen', 'party', { pcs: [] });
  assert.deepEqual(store.stateLoad(undefined, 'fen', 'party').data, { pcs: [] });

  // A stray non-json file is not a checkpoint.
  fs.writeFileSync(path.join(dir, 'local', 'fen', 'state', 'README.txt'), 'not state', 'utf8');
  const { keys } = store.stateList(undefined, 'fen');
  assert.deepEqual(keys.map((k) => k.key), ['party']);
  assert.ok(keys[0].bytes > 0);
  assert.ok(Number.isInteger(keys[0].savedAt));

  assert.throws(() => store.stateSave(undefined, 'fen', 'bad', undefined), /JSON-serialisable/);
  assert.throws(() => store.stateLoad(undefined, 'fen', 'missing'), /No saved state/);
  assert.throws(() => store.stateDelete(undefined, 'fen', 'missing'), /No saved state/);
  assert.deepEqual(store.stateDelete(undefined, 'fen', 'party'), { deleted: 'party' });
  assert.deepEqual(store.stateList(undefined, 'fen').keys, []);
});

test('campaigns lists directories only and counts records and state keys', () => {
  const { store, dir } = mkStore();
  store.record(undefined, 'alpha', { type: 'note', text: 'one' });
  store.record(undefined, 'alpha', { type: 'note', text: 'two' });
  store.stateSave(undefined, 'alpha', 'party', { a: 1 });
  store.record(undefined, 'beta', { type: 'note', text: 'three' });
  fs.writeFileSync(path.join(dir, 'local', 'stray-file'), 'not a campaign', 'utf8');

  const campaigns = store.campaigns(undefined).sort((a, b) => a.campaign.localeCompare(b.campaign));
  assert.deepEqual(campaigns, [
    { campaign: 'alpha', records: 2, stateKeys: 1 },
    { campaign: 'beta', records: 1, stateKeys: 0 }
  ]);

  const info = store.info(undefined);
  assert.equal(info.namespace, 'local');
  assert.equal(info.authRequired, false);
  assert.equal(info.campaigns.length, 2);
});
