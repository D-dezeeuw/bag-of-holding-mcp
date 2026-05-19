import { test } from 'node:test';
import assert from 'node:assert/strict';
import { beatsTools } from '../src/tools/beats.js';
import { setup } from './_helpers.js';

test('beats_archetype_roles returns the SRD-adjacent role vocabulary', async () => {
  const { run } = setup(beatsTools);
  const { data } = await run('beats_archetype_roles', {});
  assert.ok(data.roles.includes('antagonist'));
});

test('beats_archetype_roles error path', async () => {
  const { run } = setup(beatsTools);
  const r = await run('beats_archetype_roles', { session: 'no' });
  assert.equal(r.isError, true);
});

test('beats_validate accumulates all errors so an authoring UI can show them at once', async () => {
  const { run } = setup(beatsTools);
  const r = await run('beats_validate', { beat: {} });
  assert.equal(r.data.valid, false);
  assert.ok(r.data.errors.length >= 1);
});

test('beats_validate error path', async () => {
  const { run } = setup(beatsTools);
  const r = await run('beats_validate', { beat: {}, session: 'no' });
  assert.equal(r.isError, true);
});

test('beats_make_empty returns an intentionally-invalid skeleton (forces dramaticPurpose)', async () => {
  const { run } = setup(beatsTools);
  const { data } = await run('beats_make_empty', { id: 'intro' });
  assert.equal(data.id, 'intro');
  assert.equal(data.dramaticPurpose, '');
});

test('beats_make_empty error path', async () => {
  const { run } = setup(beatsTools);
  const r = await run('beats_make_empty', { id: 'x', session: 'no' });
  assert.equal(r.isError, true);
});

test('beats thread_create + current + is_ready + is_complete + advance walk a thread end-to-end', async () => {
  const { run } = setup(beatsTools);
  const b1 = (await run('beats_make_empty', { id: 'b1' })).data;
  b1.dramaticPurpose = 'open';
  b1.setRequiredFlags = ['opened'];
  const b2 = (await run('beats_make_empty', { id: 'b2' })).data;
  b2.dramaticPurpose = 'close';
  b2.setRequiredFlags = ['closed'];
  const thread = (await run('beats_thread_create', { beats: [b1, b2] })).data;
  const cur = (await run('beats_thread_current', { thread })).data;
  assert.equal(cur.beat.id, 'b1');
  const ready = (await run('beats_is_ready', { beat: b1, state: { flags: {} } })).data;
  assert.equal(ready.ready, true);
  const incomplete = (await run('beats_is_complete', { beat: b1, state: { flags: {} } })).data;
  assert.equal(incomplete.complete, false);
  const complete = (await run('beats_is_complete', { beat: b1, state: { flags: { opened: true } } })).data;
  assert.equal(complete.complete, true);
  const advanced = (await run('beats_thread_advance', { thread, state: { flags: { opened: true } } })).data;
  assert.equal(advanced.advanced, true);
  const cur2 = (await run('beats_thread_current', { thread: advanced.thread })).data;
  assert.equal(cur2.beat.id, 'b2');
});

test('beats_thread_create error path', async () => {
  const { run } = setup(beatsTools);
  const r = await run('beats_thread_create', { beats: [], session: 'no' });
  assert.equal(r.isError, true);
});

test('beats_thread_current error path', async () => {
  const { run } = setup(beatsTools);
  const r = await run('beats_thread_current', { thread: {}, session: 'no' });
  assert.equal(r.isError, true);
});

test('beats_is_ready error path', async () => {
  const { run } = setup(beatsTools);
  const r = await run('beats_is_ready', { beat: {}, state: {}, session: 'no' });
  assert.equal(r.isError, true);
});

test('beats_is_complete error path', async () => {
  const { run } = setup(beatsTools);
  const r = await run('beats_is_complete', { beat: {}, state: {}, session: 'no' });
  assert.equal(r.isError, true);
});

test('beats_thread_advance error path', async () => {
  const { run } = setup(beatsTools);
  const r = await run('beats_thread_advance', { thread: {}, state: {}, session: 'no' });
  assert.equal(r.isError, true);
});
