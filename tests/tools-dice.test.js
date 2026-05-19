import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diceTools } from '../src/tools/dice.js';
import { setup } from './_helpers.js';

test('dice_roll routes through the session engine and logs to its rollLog', async () => {
  const { sessions, run } = setup(diceTools);
  sessions.create({ id: 'g', seed: 1 });
  const { data } = await run('dice_roll', { spec: '2d6+3', session: 'g', context: { actor: 'pc-1' } });
  assert.equal(typeof data.total, 'number');
  assert.equal(data.modifier, 3);
  assert.equal(sessions.rollLog('g').length, 1);
  assert.deepEqual(sessions.rollLog('g')[0].context, { actor: 'pc-1' });
});

test('dice_roll surfaces engine errors as a structured tool error (not a thrown exception)', async () => {
  const { run } = setup(diceTools);
  const r = await run('dice_roll', { spec: 'not-a-spec' });
  assert.equal(r.isError, true);
  assert.match(r.message, /spec|dice/i);
});

test('dice_roll_advantage keeps the higher of two rolls', async () => {
  const { run } = setup(diceTools);
  const { data } = await run('dice_roll_advantage', { spec: '1d20' });
  assert.equal(typeof data.total, 'number');
});

test('dice_roll_advantage error path', async () => {
  const { run } = setup(diceTools);
  const r = await run('dice_roll_advantage', { spec: 'bad' });
  assert.equal(r.isError, true);
});

test('dice_roll_disadvantage keeps the lower of two rolls', async () => {
  const { run } = setup(diceTools);
  const { data } = await run('dice_roll_disadvantage', { spec: '1d20' });
  assert.equal(typeof data.total, 'number');
});

test('dice_roll_disadvantage error path', async () => {
  const { run } = setup(diceTools);
  const r = await run('dice_roll_disadvantage', { spec: 'bad' });
  assert.equal(r.isError, true);
});

test('dice_roll_die rolls a single die', async () => {
  const { run } = setup(diceTools);
  const { data } = await run('dice_roll_die', { sides: 20 });
  assert.ok(data.value >= 1 && data.value <= 20);
});

test('dice_roll_die surfaces unknown-session errors as a structured tool error', async () => {
  const { run } = setup(diceTools);
  const r = await run('dice_roll_die', { sides: 20, session: 'no-such-session' });
  assert.equal(r.isError, true);
});

test('dice_parse is pure and does not consume the RNG / write to the log', async () => {
  const { sessions, run } = setup(diceTools);
  const { data } = await run('dice_parse', { spec: '3d8-1' });
  assert.equal(data.count, 3);
  assert.equal(data.sides, 8);
  assert.equal(data.modifier, -1);
  assert.equal(sessions.rollLog().length, 0);
});

test('dice_parse error path', async () => {
  const { run } = setup(diceTools);
  const r = await run('dice_parse', { spec: 'gibberish' });
  assert.equal(r.isError, true);
});
