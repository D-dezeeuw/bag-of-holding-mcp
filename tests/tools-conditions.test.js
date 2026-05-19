import { test } from 'node:test';
import assert from 'node:assert/strict';
import { conditionsTools } from '../src/tools/conditions.js';
import { setup } from './_helpers.js';

test('conditions_list reflects extras passed to the session', async () => {
  const { sessions, run } = setup(conditionsTools);
  sessions.create({ id: 'g', extras: { extraConditions: ['blessed'] } });
  const { data } = await run('conditions_list', { session: 'g' });
  assert.ok(data.conditions.includes('blinded'));
  assert.ok(data.conditions.includes('blessed'));
});

test('conditions_list error path', async () => {
  const { run } = setup(conditionsTools);
  const r = await run('conditions_list', { session: 'no' });
  assert.equal(r.isError, true);
});

test('conditions_apply returns a new actor record', async () => {
  const { run } = setup(conditionsTools);
  const { data } = await run('conditions_apply', { actor: { id: 'x' }, condition: 'prone' });
  assert.ok(data.actor.conditions.includes('prone'));
});

test('conditions_apply error path (unknown condition throws in engine)', async () => {
  const { run } = setup(conditionsTools);
  const r = await run('conditions_apply', { actor: {}, condition: 'unknown-thing' });
  assert.equal(r.isError, true);
});

test('conditions_remove is idempotent', async () => {
  const { run } = setup(conditionsTools);
  const applied = await run('conditions_apply', { actor: { id: 'x' }, condition: 'prone' });
  const removed = await run('conditions_remove', { actor: applied.data.actor, condition: 'prone' });
  assert.ok(!(removed.data.actor.conditions ?? []).includes('prone'));
  const again = await run('conditions_remove', { actor: removed.data.actor, condition: 'prone' });
  assert.ok(!(again.data.actor.conditions ?? []).includes('prone'));
});

test('conditions_remove error path', async () => {
  const { run } = setup(conditionsTools);
  const r = await run('conditions_remove', { actor: {}, condition: 'prone', session: 'no' });
  assert.equal(r.isError, true);
});

test('conditions_has returns booleans', async () => {
  const { run } = setup(conditionsTools);
  const applied = await run('conditions_apply', { actor: { id: 'x' }, condition: 'prone' });
  const yes = await run('conditions_has', { actor: applied.data.actor, condition: 'prone' });
  const no = await run('conditions_has', { actor: {}, condition: 'prone' });
  assert.equal(yes.data.has, true);
  assert.equal(no.data.has, false);
});

test('conditions_has error path', async () => {
  const { run } = setup(conditionsTools);
  const r = await run('conditions_has', { actor: {}, condition: 'prone', session: 'no' });
  assert.equal(r.isError, true);
});

test('conditions_exhaustion_gain caps at 6', async () => {
  const { run } = setup(conditionsTools);
  const r = await run('conditions_exhaustion_gain', { actor: { exhaustion: 5 }, amount: 10 });
  assert.equal(r.data.actor.exhaustion, 6);
});

test('conditions_exhaustion_gain default amount is +1', async () => {
  const { run } = setup(conditionsTools);
  const r = await run('conditions_exhaustion_gain', { actor: {} });
  assert.equal(r.data.actor.exhaustion, 1);
});

test('conditions_exhaustion_gain error path', async () => {
  const { run } = setup(conditionsTools);
  const r = await run('conditions_exhaustion_gain', { actor: {}, session: 'no' });
  assert.equal(r.isError, true);
});

test('conditions_exhaustion_reduce floors at 0', async () => {
  const { run } = setup(conditionsTools);
  const r = await run('conditions_exhaustion_reduce', { actor: { exhaustion: 1 }, amount: 5 });
  assert.equal(r.data.actor.exhaustion, 0);
});

test('conditions_exhaustion_reduce default amount is -1', async () => {
  const { run } = setup(conditionsTools);
  const r = await run('conditions_exhaustion_reduce', { actor: { exhaustion: 3 } });
  assert.equal(r.data.actor.exhaustion, 2);
});

test('conditions_exhaustion_reduce error path', async () => {
  const { run } = setup(conditionsTools);
  const r = await run('conditions_exhaustion_reduce', { actor: {}, session: 'no' });
  assert.equal(r.isError, true);
});

test('conditions_exhaustion_set absolute', async () => {
  const { run } = setup(conditionsTools);
  const r = await run('conditions_exhaustion_set', { actor: {}, level: 4 });
  assert.equal(r.data.actor.exhaustion, 4);
});

test('conditions_exhaustion_set error path', async () => {
  const { run } = setup(conditionsTools);
  const r = await run('conditions_exhaustion_set', { actor: {}, level: 4, session: 'no' });
  assert.equal(r.isError, true);
});

test('conditions_exhaustion_status returns derived d20 / speed / death flags', async () => {
  const { run } = setup(conditionsTools);
  const r = await run('conditions_exhaustion_status', { actor: { exhaustion: 6 } });
  assert.equal(r.data.level, 6);
  assert.equal(r.data.isDead, true);
  assert.ok(r.data.d20Modifier < 0);
  assert.ok(r.data.speedPenalty > 0);
});

test('conditions_exhaustion_status error path', async () => {
  const { run } = setup(conditionsTools);
  const r = await run('conditions_exhaustion_status', { actor: {}, session: 'no' });
  assert.equal(r.isError, true);
});
