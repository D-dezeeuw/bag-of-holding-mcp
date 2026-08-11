import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createMemoryStore } from '../src/memory/store.js';
import { memoryTools } from '../src/tools/memory.js';
import { parse } from './_helpers.js';

// memoryTools closes over a store rather than the session registry
// (memory outlives engine sessions), so these tests wire their own
// mini-harness instead of `setup()`.
const tmpDirs = [];
function harness(opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boh-memtools-'));
  tmpDirs.push(dir);
  const tools = memoryTools(createMemoryStore({ dataDir: dir, tokenHashes: [], ...opts }));
  const byName = new Map(tools.map((t) => [t.name, t]));
  return { tools, run: async (name, args = {}) => parse(await byName.get(name).handler(args)) };
}
after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

test('the memory/state surface is complete', () => {
  const { tools } = harness();
  assert.deepEqual(tools.map((t) => t.name), [
    'memory_status', 'memory_record', 'memory_search', 'memory_recent',
    'memory_forget', 'memory_export', 'memory_import',
    'state_save', 'state_load', 'state_list', 'state_delete'
  ]);
});

test('a full campaign loop through the tools: record, search, recap, correct, back up', async () => {
  const { run } = harness();

  const status = await run('memory_status', {});
  assert.equal(status.data.namespace, 'local');
  assert.deepEqual(status.data.campaigns, []);

  const rec = await run('memory_record', {
    campaign: 'fen', type: 'npc',
    text: 'Met Corporal Brine at the Tollgate of Teeth; his manifests do not add up.',
    entities: ['Corporal Brine', 'Tollgate of Teeth'], importance: 4
  });
  assert.equal(rec.data.id, 'm-1');

  await run('memory_record', { campaign: 'fen', type: 'session-summary', text: 'Session one: the party reached the tollgate.' });

  const found = await run('memory_search', { campaign: 'fen', query: 'brine manifests' });
  assert.equal(found.data.hits[0].id, 'm-1');

  const recap = await run('memory_recent', { campaign: 'fen', type: 'session-summary' });
  assert.equal(recap.data.records.length, 1);

  const wrong = await run('memory_record', { campaign: 'fen', type: 'note', text: 'wrong fact' });
  const gone = await run('memory_forget', { campaign: 'fen', id: wrong.data.id });
  assert.deepEqual(gone.data, { forgotten: 'm-3' });

  const dump = await run('memory_export', { campaign: 'fen' });
  assert.equal(dump.data.records.length, 2);

  const imported = await run('memory_import', { campaign: 'fen-copy', records: dump.data.records });
  assert.deepEqual(imported.data, { imported: 2, campaign: 'fen-copy' });
});

test('state tools checkpoint and reload the numbers', async () => {
  const { run } = harness();
  const saved = await run('state_save', { campaign: 'fen', key: 'party', data: { pcs: [{ name: 'Bren', hp: 11 }] } });
  assert.ok(saved.data.bytes > 0);
  const loaded = await run('state_load', { campaign: 'fen', key: 'party' });
  assert.deepEqual(loaded.data.data.pcs[0], { name: 'Bren', hp: 11 });
  const listed = await run('state_list', { campaign: 'fen' });
  assert.deepEqual(listed.data.keys.map((k) => k.key), ['party']);
  const deleted = await run('state_delete', { campaign: 'fen', key: 'party' });
  assert.deepEqual(deleted.data, { deleted: 'party' });
});

test('every tool returns a structured error instead of throwing across the wire', async () => {
  const { run } = harness();
  const cases = [
    ['memory_record', { campaign: '../evil', type: 'note', text: 'x' }, /Invalid campaign/],
    ['memory_search', { campaign: '../evil', query: 'x' }, /Invalid campaign/],
    ['memory_recent', { campaign: '../evil' }, /Invalid campaign/],
    ['memory_forget', { campaign: 'fen', id: 'm-99' }, /Unknown/],
    ['memory_export', { campaign: '../evil' }, /Invalid campaign/],
    ['memory_import', { campaign: 'fen', records: [{ type: 'nope', text: 'x' }] }, /Invalid memory type/],
    ['state_save', { campaign: 'fen', key: '../k', data: {} }, /Invalid state key/],
    ['state_load', { campaign: 'fen', key: 'missing' }, /No saved state/],
    ['state_list', { campaign: '../evil' }, /Invalid campaign/],
    ['state_delete', { campaign: 'fen', key: 'missing' }, /No saved state/]
  ];
  for (const [name, args, message] of cases) {
    const result = await run(name, args);
    assert.equal(result.isError, true, `${name} should error`);
    assert.match(result.message, message, name);
  }
});

test('closed mode surfaces the allowlist refusal through every entry point', async () => {
  const token = 'issued-token';
  const hash = createHash('sha256').update(token, 'utf8').digest('hex');
  const { run } = harness({ tokenHashes: [hash] });

  const denied = await run('memory_status', {});
  assert.equal(denied.isError, true);
  assert.match(denied.message, /allowlist/);

  const allowed = await run('memory_status', { token });
  assert.equal(allowed.data.authRequired, true);
  assert.match(allowed.data.namespace, /^t-[0-9a-f]{16}$/);

  const rec = await run('memory_record', { token, campaign: 'fen', type: 'note', text: 'authorised write' });
  assert.equal(rec.data.id, 'm-1');
});
