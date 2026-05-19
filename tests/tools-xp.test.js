import { test } from 'node:test';
import assert from 'node:assert/strict';
import { xpTools } from '../src/tools/xp.js';
import { setup } from './_helpers.js';

test('xp_level_for_xp returns a level from the session thresholds', async () => {
  const { run } = setup(xpTools);
  const { data } = await run('xp_level_for_xp', { xp: 0 });
  assert.equal(data.level, 1);
});

test('xp_level_for_xp error path', async () => {
  const { run } = setup(xpTools);
  const r = await run('xp_level_for_xp', { xp: 0, session: 'no' });
  assert.equal(r.isError, true);
});

test('xp_next_level_threshold returns the next breakpoint', async () => {
  const { run } = setup(xpTools);
  const { data } = await run('xp_next_level_threshold', { xp: 0 });
  assert.ok(data.threshold > 0);
});

test('xp_next_level_threshold error path', async () => {
  const { run } = setup(xpTools);
  const r = await run('xp_next_level_threshold', { xp: 0, session: 'no' });
  assert.equal(r.isError, true);
});

test('xp_award_milestone computes the delta and will-level-up flag', async () => {
  const { run } = setup(xpTools);
  const { data } = await run('xp_award_milestone', {
    pc: { xp: 0, level: 1 },
    beat: { targetPlaytimeMinutes: 30 }
  });
  assert.equal(typeof data.xpDelta, 'number');
  assert.equal(typeof data.willLevelUp, 'boolean');
});

test('xp_award_milestone error path', async () => {
  const { run } = setup(xpTools);
  const r = await run('xp_award_milestone', { pc: {}, beat: {}, session: 'no' });
  assert.equal(r.isError, true);
});

test('xp_thresholds returns the full table', async () => {
  const { run } = setup(xpTools);
  const { data } = await run('xp_thresholds', {});
  assert.ok(Object.keys(data.thresholds).length > 0);
});

test('xp_thresholds error path', async () => {
  const { run } = setup(xpTools);
  const r = await run('xp_thresholds', { session: 'no' });
  assert.equal(r.isError, true);
});

test('xp_proficiency_for_level returns the SRD progression', async () => {
  const { run } = setup(xpTools);
  const r = await run('xp_proficiency_for_level', { level: 1 });
  assert.equal(r.data.proficiencyBonus, 2);
  const r2 = await run('xp_proficiency_for_level', { level: 99 });
  assert.equal(r2.data.proficiencyBonus, null);
});

test('xp_proficiency_for_level error path', async () => {
  const { run } = setup(xpTools);
  const r = await run('xp_proficiency_for_level', { level: 1, session: 'no' });
  assert.equal(r.isError, true);
});
