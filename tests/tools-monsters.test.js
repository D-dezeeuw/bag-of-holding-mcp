import { test } from 'node:test';
import assert from 'node:assert/strict';
import { monsterTools } from '../src/tools/monsters.js';
import { setup } from './_helpers.js';

test('monsters_elevate raises CR and HP by the template', async () => {
  const { run, sessions } = setup(monsterTools);
  const base = sessions.get().monsters.wight;
  const { data } = await run('monsters_elevate', { monsterId: 'wight', tier: 'elite' });
  assert.equal(data.cr, base.cr + 4);
  assert.ok(data.hp > base.hp, 'an elite has to be harder to kill, not just worth more');
});

test('the three tiers escalate', async () => {
  const { run } = setup(monsterTools);
  const cr = async (tier) => (await run('monsters_elevate', { monsterId: 'wight', tier })).data.cr;
  const [elite, champion, ancient] = [await cr('elite'), await cr('champion'), await cr('ancient')];
  assert.ok(elite < champion && champion < ancient);
});

test('monsters_elevate does not modify the source block', async () => {
  const { run, sessions } = setup(monsterTools);
  const before = { ...sessions.get().monsters.wight };
  await run('monsters_elevate', { monsterId: 'wight', tier: 'ancient' });
  assert.deepEqual({ ...sessions.get().monsters.wight }, before);
});

test('monsters_elevate reports an unknown monster', async () => {
  const { run } = setup(monsterTools);
  const r = await run('monsters_elevate', { monsterId: 'nope', tier: 'elite' });
  assert.equal(r.isError, true);
});

test('monsters_for_target_cr picks a template that reaches the target', async () => {
  const { run, sessions } = setup(monsterTools);
  const base = sessions.get().monsters.wight;
  const { data } = await run('monsters_for_target_cr', { monsterId: 'wight', targetCr: base.cr + 8 });
  assert.ok(data.tier, 'a target well above the base must select a template');
  assert.ok(data.block.cr > base.cr);
});

test('monsters_for_target_cr leaves a monster alone when it is already big enough', async () => {
  const { run } = setup(monsterTools);
  const { data } = await run('monsters_for_target_cr', { monsterId: 'wight', targetCr: 0 });
  assert.equal(data.tier, null);
  assert.equal(data.block.cr, 3);
});

test('monsters_for_target_cr reports an unknown monster', async () => {
  const { run } = setup(monsterTools);
  const r = await run('monsters_for_target_cr', { monsterId: 'nope', targetCr: 10 });
  assert.equal(r.isError, true);
});

test('monsters_elevate error path (unknown session)', async () => {
  const { run } = setup(monsterTools);
  const r = await run('monsters_elevate', { monsterId: 'wight', tier: 'elite', session: 'no' });
  assert.equal(r.isError, true);
});

test('monsters_for_target_cr error path (unknown session)', async () => {
  const { run } = setup(monsterTools);
  const r = await run('monsters_for_target_cr', { monsterId: 'wight', targetCr: 20, session: 'no' });
  assert.equal(r.isError, true);
});
