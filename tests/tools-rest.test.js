import { test } from 'node:test';
import assert from 'node:assert/strict';
import { restTools } from '../src/tools/rest.js';
import { setup } from './_helpers.js';

test('rest_long restores hp, slots, and reduces exhaustion', async () => {
  const { run } = setup(restTools);
  const actor = {
    hp: 3, hpMax: 20, level: 4,
    hitDiceTotal: 4, hitDiceUsed: 4, hitDie: 10,
    spellSlots: [{ level: 1, max: 3, used: 3 }],
    exhaustion: 2
  };
  const { data } = await run('rest_long', { actor });
  assert.equal(data.actor.hp, 20);
  assert.equal(data.actor.spellSlots[0].used, 0);
  assert.equal(data.actor.exhaustion, 1);
  // Default rule: half of total hit dice recovered.
  assert.equal(data.actor.hitDiceUsed, 2);
});

test('rest_long with interrupted: true yields no benefit', async () => {
  const { run } = setup(restTools);
  const actor = { hp: 3, hpMax: 20, exhaustion: 2 };
  const { data } = await run('rest_long', { actor, interrupted: true });
  assert.equal(data.actor.hp, 3);
  assert.equal(data.actor.exhaustion, 2);
});

test('rest_long error path', async () => {
  const { run } = setup(restTools);
  const r = await run('rest_long', { actor: { hp: 1 }, session: 'no' });
  assert.equal(r.isError, true);
});

test('rest_short refreshes short-rest resources but not hp', async () => {
  const { run } = setup(restTools);
  const actor = {
    hp: 5, hpMax: 20,
    resources: { secondWind: { max: 2, used: 2, refreshes: 'short' } }
  };
  const { data } = await run('rest_short', { actor });
  assert.equal(data.actor.hp, 5);
  assert.equal(data.actor.resources.secondWind.used, 0);
});

test('rest_short error path', async () => {
  const { run } = setup(restTools);
  const r = await run('rest_short', { actor: { hp: 1 }, session: 'no' });
  assert.equal(r.isError, true);
});

test('rest_spend_hit_die heals, increments used, and logs the die', async () => {
  const { sessions, run } = setup(restTools);
  sessions.create({ id: 's1', seed: 11 });
  const actor = {
    hp: 4, hpMax: 20, hitDie: 8, hitDiceTotal: 3, hitDiceUsed: 0,
    abilityScores: { con: 14 }
  };
  const { data } = await run('rest_spend_hit_die', { actor, session: 's1' });
  assert.ok(data.healed >= 1);
  assert.equal(data.actor.hitDiceUsed, 1);
  assert.equal(data.hpAfter, Math.min(20, 4 + data.healed));
  const log = sessions.rollLog('s1');
  assert.equal(log.at(-1).op, 'rollDie');
  assert.equal(log.at(-1).sides, 8);
});

test('rest_spend_hit_die with no dice left heals 0 and rolls nothing', async () => {
  const { run } = setup(restTools);
  const actor = { hp: 4, hpMax: 20, hitDie: 8, hitDiceTotal: 2, hitDiceUsed: 2, abilityScores: { con: 10 } };
  const { data } = await run('rest_spend_hit_die', { actor });
  assert.equal(data.healed, 0);
  assert.equal(data.actor.hitDiceUsed ?? 2, 2);
});

test('rest_spend_hit_die error path', async () => {
  const { run } = setup(restTools);
  const r = await run('rest_spend_hit_die', { actor: { hp: 1, hitDie: 8 }, session: 'no' });
  assert.equal(r.isError, true);
});
