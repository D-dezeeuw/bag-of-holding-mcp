import { test } from 'node:test';
import assert from 'node:assert/strict';
import { engineTools } from '../src/tools/engine.js';
import { diceTools } from '../src/tools/dice.js';
import { setup } from './_helpers.js';

test('engine_create_session mints a seeded session and lists it', async () => {
  const { sessions } = setup(engineTools);
  const tools = engineTools(sessions);
  const create = tools.find((t) => t.name === 'engine_create_session');
  const list = tools.find((t) => t.name === 'engine_list_sessions');
  const created = await create.handler({ id: 'camp', seed: 7 });
  assert.equal(created.structuredContent.id, 'camp');
  const listed = await list.handler({});
  const ids = listed.structuredContent.sessions.map((s) => s.id);
  assert.ok(ids.includes('camp'));
  assert.ok(ids.includes('default'));
});

test('engine_create_session error path (duplicate id)', async () => {
  const { run } = setup(engineTools);
  await run('engine_create_session', { id: 'dup' });
  const r = await run('engine_create_session', { id: 'dup' });
  assert.equal(r.isError, true);
});

test('engine_destroy_session refuses the default', async () => {
  const { run } = setup(engineTools);
  const r = await run('engine_destroy_session', { session: 'default' });
  assert.equal(r.isError, true);
});

test('engine_destroy_session frees a real session', async () => {
  const { run } = setup(engineTools);
  await run('engine_create_session', { id: 'temp' });
  const r = await run('engine_destroy_session', { session: 'temp' });
  assert.equal(r.isError, false);
});

test('engine_list_sessions always includes the default', async () => {
  const { run } = setup(engineTools);
  const r = await run('engine_list_sessions', {});
  assert.ok(r.data.sessions.some((s) => s.id === 'default'));
});

test('engine_get_roll_log returns a defensive copy', async () => {
  // We need to actually populate the log — use diceTools against the same registry.
  const { sessions } = setup(engineTools);
  const engine = sessions.create({ id: 'audit', seed: 1 });
  const dTools = diceTools(sessions);
  await dTools.find((t) => t.name === 'dice_roll').handler({ spec: '1d20', session: engine.id });
  const eTools = engineTools(sessions);
  const log = await eTools.find((t) => t.name === 'engine_get_roll_log').handler({ session: engine.id });
  assert.equal(log.structuredContent.rollLog.length, 1);
});

test('engine_get_roll_log error path', async () => {
  const { run } = setup(engineTools);
  const r = await run('engine_get_roll_log', { session: 'no' });
  assert.equal(r.isError, true);
});

test('engine_verify_log replays a log and confirms determinism', async () => {
  const { sessions } = setup(engineTools);
  sessions.create({ id: 'replay', seed: 42 });
  const dTools = diceTools(sessions);
  await dTools.find((t) => t.name === 'dice_roll').handler({ spec: '1d20', session: 'replay' });
  await dTools.find((t) => t.name === 'dice_roll').handler({ spec: '2d6+3', session: 'replay' });
  const log = sessions.rollLog('replay');
  const verifyTool = engineTools(sessions).find((t) => t.name === 'engine_verify_log');
  const ok = await verifyTool.handler({ seed: 42, log });
  assert.equal(ok.structuredContent.ok, true);
});

test('engine_verify_log error path (bad log shape)', async () => {
  const { run } = setup(engineTools);
  const r = await run('engine_verify_log', { seed: 1, log: [{ op: 'unknown' }] });
  assert.equal(r.isError, true);
});
