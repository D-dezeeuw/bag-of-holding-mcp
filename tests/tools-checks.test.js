import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checksTools } from '../src/tools/checks.js';
import { setup } from './_helpers.js';

test('checks_ability_check returns a pass/fail verdict when DC is supplied', async () => {
  const { run } = setup(checksTools);
  const { data } = await run('checks_ability_check', { abilityScore: 14, proficient: true, proficiencyBonus: 3, dc: 12 });
  assert.equal(typeof data.success, 'boolean');
  assert.equal(typeof data.total, 'number');
});

test('checks_ability_check surfaces unknown-session as a structured tool error', async () => {
  const { run } = setup(checksTools);
  const r = await run('checks_ability_check', { abilityScore: 14, session: 'nope' });
  assert.equal(r.isError, true);
});

test('checks_saving_throw distinguishes intent in the rollLog (op = savingThrow, not abilityCheck)', async () => {
  const { sessions, run } = setup(checksTools);
  sessions.create({ id: 'g', seed: 1 });
  await run('checks_saving_throw', { abilityScore: 12, session: 'g' });
  assert.equal(sessions.rollLog('g')[0].op, 'savingThrow');
});

test('checks_saving_throw surfaces unknown-session as a structured tool error', async () => {
  const { run } = setup(checksTools);
  const r = await run('checks_saving_throw', { abilityScore: 14, session: 'nope' });
  assert.equal(r.isError, true);
});

test('checks_mod_from_score is a pure lookup (10→0, 14→+2, 18→+4)', async () => {
  const { run } = setup(checksTools);
  assert.equal((await run('checks_mod_from_score', { score: 10 })).data.mod, 0);
  assert.equal((await run('checks_mod_from_score', { score: 14 })).data.mod, 2);
  assert.equal((await run('checks_mod_from_score', { score: 18 })).data.mod, 4);
});


test('checks_clamp_dc bounds proposed DCs to the legal range', async () => {
  const { run } = setup(checksTools);
  const r = await run('checks_clamp_dc', { dc: 99 });
  assert.equal(typeof r.data.dc, 'number');
  assert.ok(r.data.dc <= 30);
});

