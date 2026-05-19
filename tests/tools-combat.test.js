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
