import { test } from 'node:test';
import assert from 'node:assert/strict';
import { srdTools } from '../src/tools/srd.js';
import { setup } from './_helpers.js';

test('srd_list returns the ids in a registry', async () => {
  const { run } = setup(srdTools);
  const { data } = await run('srd_list', { kind: 'species' });
  assert.equal(data.kind, 'species');
  assert.ok(Array.isArray(data.ids));
  assert.ok(data.ids.length > 0);
});

test('srd_list error path (unknown session)', async () => {
  const { run } = setup(srdTools);
  const r = await run('srd_list', { kind: 'species', session: 'no' });
  assert.equal(r.isError, true);
});

test('srd_get returns found:false for an unknown id (does not throw)', async () => {
  const { run } = setup(srdTools);
  const { data } = await run('srd_get', { kind: 'species', id: 'absolutely-not-a-species' });
  assert.equal(data.found, false);
});

test('srd_get returns found:true with the record when present', async () => {
  const { run } = setup(srdTools);
  const list = await run('srd_list', { kind: 'classes' });
  const id = list.data.ids[0];
  const { data } = await run('srd_get', { kind: 'classes', id });
  assert.equal(data.found, true);
  assert.ok(data.record);
});

test('srd_get error path', async () => {
  const { run } = setup(srdTools);
  const r = await run('srd_get', { kind: 'species', id: 'x', session: 'no' });
  assert.equal(r.isError, true);
});

test('srd_dump returns every record in a registry', async () => {
  const { run } = setup(srdTools);
  const { data } = await run('srd_dump', { kind: 'items' });
  assert.ok(Object.keys(data.records).length > 0);
});

test('srd_dump error path', async () => {
  const { run } = setup(srdTools);
  const r = await run('srd_dump', { kind: 'items', session: 'no' });
  assert.equal(r.isError, true);
});
