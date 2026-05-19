import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSessions } from '../src/sessions.js';

test('default session exists immediately so unscoped tool calls always have an engine', () => {
  const s = createSessions();
  const list = s.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].id, 'default');
  assert.equal(list[0].seed, null);
  assert.ok(s.get());
  assert.ok(s.get(''));
  assert.ok(s.get(null));
});

test('get throws on unknown explicit id (silent fallback would hide host bugs)', () => {
  const s = createSessions();
  assert.throws(() => s.get('nope'), /Unknown session: nope/);
});

test('create mints a seeded engine and binds the seed to the id atomically', () => {
  const s = createSessions();
  const { id, seed } = s.create({ id: 'campaign-1', seed: 42 });
  assert.equal(id, 'campaign-1');
  assert.equal(seed, 42);
  const e = s.get('campaign-1');
  const r1 = e.Dice.roll('1d20');
  const e2 = s.create({ id: 'campaign-2', seed: 42 });
  const r2 = s.get(e2.id).Dice.roll('1d20');
  assert.equal(r1.total, r2.total, 'same seed must yield same first roll');
});

test('create auto-generates id and applies rollLogCap + extras', () => {
  const s = createSessions();
  const { id } = s.create({ seed: 7, rollLogCap: 2, extras: { extraConditions: ['blessed'] } });
  assert.match(id, /^session-/);
  const e = s.get(id);
  assert.ok(e.Conditions.CONDITIONS.includes('blessed'));
  e.Dice.roll('1d4');
  e.Dice.roll('1d4');
  e.Dice.roll('1d4');
  assert.equal(e.rollLog.length, 2, 'rollLogCap evicts oldest');
});

test('create rejects duplicate id (atomic seed→id binding contract)', () => {
  const s = createSessions();
  s.create({ id: 'dup' });
  assert.throws(() => s.create({ id: 'dup' }), /already exists/);
});

test('destroy frees a session but refuses the default (would orphan unscoped calls)', () => {
  const s = createSessions();
  s.create({ id: 'temp' });
  assert.deepEqual(s.destroy('temp'), { destroyed: 'temp' });
  assert.throws(() => s.destroy('temp'), /Unknown session: temp/);
  assert.throws(() => s.destroy('default'), /Cannot destroy the default session/);
});

test('rollLog returns a defensive copy so callers cannot mutate the engine audit trail', () => {
  const s = createSessions();
  s.create({ id: 'audited', seed: 1 });
  s.get('audited').Dice.roll('1d20');
  const log = s.rollLog('audited');
  assert.equal(log.length, 1);
  log.push({ tampered: true });
  assert.equal(s.rollLog('audited').length, 1);
});
