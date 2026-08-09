import { test } from 'node:test';
import assert from 'node:assert/strict';
import { combatTools } from '../src/tools/combat.js';
import { setup } from './_helpers.js';

test('combat_roll_initiative records a logged value', async () => {
  const { sessions, run } = setup(combatTools);
  sessions.create({ id: 'g', seed: 1 });
  const { data } = await run('combat_roll_initiative', { dexterity: 16, session: 'g' });
  assert.equal(typeof data.value, 'number');
  assert.equal(sessions.rollLog('g')[0].op, 'rollInitiative');
});

test('combat_roll_initiative error path (unknown session)', async () => {
  const { run } = setup(combatTools);
  const r = await run('combat_roll_initiative', { dexterity: 16, session: 'no' });
  assert.equal(r.isError, true);
});

test('combat_attack_roll returns hit + critical flags', async () => {
  const { run } = setup(combatTools);
  const { data } = await run('combat_attack_roll', { attackBonus: 5, ac: 14 });
  assert.equal(typeof data.hit, 'boolean');
  assert.equal(typeof data.critical, 'boolean');
});

test('combat_attack_roll error path', async () => {
  const { run } = setup(combatTools);
  const r = await run('combat_attack_roll', { attackBonus: 5, ac: 14, session: 'no' });
  assert.equal(r.isError, true);
});

test('combat_damage_roll doubles dice on critical', async () => {
  const { run } = setup(combatTools);
  const { data } = await run('combat_damage_roll', { damageDice: '1d6', damageMod: 2, critical: true });
  assert.ok(data.total >= 2 + 2, 'crit doubles dice contribution');
});

test('combat_damage_roll error path', async () => {
  const { run } = setup(combatTools);
  const r = await run('combat_damage_roll', { damageDice: '1d6', session: 'no' });
  assert.equal(r.isError, true);
});

test('combat_apply_mastery dispatches; reports kind:"none" when no mastery property fires', async () => {
  const { run } = setup(combatTools);
  const { data } = await run('combat_apply_mastery', {
    weapon: { name: 'plain stick' },
    target: { id: 't' },
    attackResult: { hit: true, critical: false }
  });
  assert.equal(data.kind, 'none');
});

test('combat_apply_mastery error path', async () => {
  const { run } = setup(combatTools);
  const r = await run('combat_apply_mastery', { weapon: {}, target: {}, attackResult: {}, session: 'no' });
  assert.equal(r.isError, true);
});

test('combat_mastery_properties lists the SRD 5.2 names', async () => {
  const { run } = setup(combatTools);
  const { data } = await run('combat_mastery_properties', {});
  assert.ok(data.properties.includes('cleave'));
  assert.ok(data.properties.includes('vex'));
});

test('combat_mastery_properties error path', async () => {
  const { run } = setup(combatTools);
  const r = await run('combat_mastery_properties', { session: 'no' });
  assert.equal(r.isError, true);
});

// === Damage pipeline tools ===

test('combat_apply_damage runs the full pipeline (temp HP first, then HP)', async () => {
  const { run } = setup(combatTools);
  const actor = { hp: 20, hpMax: 20, tempHp: 3 };
  const { data } = await run('combat_apply_damage', { actor, amount: 8, type: 'slashing' });
  assert.equal(data.outcome, 'damaged');
  assert.equal(data.tempHpAbsorbed, 3);
  assert.equal(data.hpAfter, 15);
  assert.equal(data.actor.tempHp, 0);
});

test('combat_apply_damage honours resistances', async () => {
  const { run } = setup(combatTools);
  const actor = { hp: 20, hpMax: 20, damageResistances: ['fire'] };
  const { data } = await run('combat_apply_damage', { actor, amount: 9, type: 'fire' });
  assert.equal(data.finalAmount, 4); // halved, rounded down
  assert.equal(data.hpAfter, 16);
});

test('combat_apply_damage drops an actor to 0 as downed with fresh death saves', async () => {
  const { run } = setup(combatTools);
  const actor = { hp: 5, hpMax: 20 };
  const { data } = await run('combat_apply_damage', { actor, amount: 10 });
  assert.equal(data.outcome, 'downed');
  assert.equal(data.actor.hp, 0);
  assert.ok(data.actor.conditions.includes('unconscious'));
  assert.deepEqual(
    { s: data.actor.deathSaves.successes, f: data.actor.deathSaves.failures },
    { s: 0, f: 0 }
  );
});

test('combat_apply_damage error path (negative amount rejected by the engine)', async () => {
  const { run } = setup(combatTools);
  const r = await run('combat_apply_damage', { actor: { hp: 10 }, amount: -1 });
  assert.equal(r.isError, true);
});

test('combat_heal caps at hpMax and revives from 0', async () => {
  const { run } = setup(combatTools);
  const down = { hp: 0, hpMax: 12, conditions: ['unconscious'], deathSaves: { successes: 1, failures: 2, stable: false, dead: false } };
  const { data } = await run('combat_heal', { actor: down, amount: 50 });
  assert.equal(data.hpAfter, 12);
  assert.ok(!data.actor.conditions.includes('unconscious'));
  assert.equal(data.actor.deathSaves.failures, 0);
});

test('combat_heal error path', async () => {
  const { run } = setup(combatTools);
  const r = await run('combat_heal', { actor: { hp: 1 }, amount: 5, session: 'no' });
  assert.equal(r.isError, true);
});

test('combat_grant_temp_hp keeps the larger pool (no stacking)', async () => {
  const { run } = setup(combatTools);
  const bigger = await run('combat_grant_temp_hp', { actor: { hp: 10, tempHp: 2 }, amount: 6 });
  assert.equal(bigger.data.actor.tempHp, 6);
  const smaller = await run('combat_grant_temp_hp', { actor: { hp: 10, tempHp: 8 }, amount: 6 });
  assert.equal(smaller.data.actor.tempHp, 8);
});

test('combat_grant_temp_hp error path', async () => {
  const { run } = setup(combatTools);
  const r = await run('combat_grant_temp_hp', { actor: { hp: 1 }, amount: 2, session: 'no' });
  assert.equal(r.isError, true);
});

test('combat_drop_to_zero applies unconscious and a fresh tracker', async () => {
  const { run } = setup(combatTools);
  const { data } = await run('combat_drop_to_zero', { actor: { hp: 7, hpMax: 7 } });
  assert.equal(data.actor.hp, 0);
  assert.ok(data.actor.conditions.includes('unconscious'));
  assert.equal(data.actor.deathSaves.dead, false);
});

test('combat_drop_to_zero error path', async () => {
  const { run } = setup(combatTools);
  const r = await run('combat_drop_to_zero', { actor: { hp: 1 }, session: 'no' });
  assert.equal(r.isError, true);
});

test('combat_death_save rolls, tracks, and lands in the rollLog', async () => {
  const { sessions, run } = setup(combatTools);
  sessions.create({ id: 's1', seed: 7 });
  const actor = { hp: 0, hpMax: 10, deathSaves: { successes: 0, failures: 0, stable: false, dead: false } };
  const { data } = await run('combat_death_save', { actor, session: 's1' });
  assert.ok(['success', 'failure', 'stable', 'dead', 'revived'].includes(data.outcome));
  assert.ok(data.d20 >= 1 && data.d20 <= 20);
  const log = sessions.rollLog('s1');
  assert.equal(log.at(-1).op, 'deathSave');
});

test('combat_death_save is a noop on a stable actor', async () => {
  const { run } = setup(combatTools);
  const actor = { hp: 0, deathSaves: { successes: 3, failures: 0, stable: true, dead: false } };
  const { data } = await run('combat_death_save', { actor });
  assert.equal(data.outcome, 'noop');
  assert.equal(data.d20, 0);
});

test('combat_death_save error path', async () => {
  const { run } = setup(combatTools);
  const r = await run('combat_death_save', { actor: { hp: 0 }, session: 'no' });
  assert.equal(r.isError, true);
});
