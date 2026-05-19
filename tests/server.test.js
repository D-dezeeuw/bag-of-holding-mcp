import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, createSessions } from '../index.js';

test('createServer wires every tool module so the AI gets the full surface in one shot', () => {
  const { server, sessions, tools } = createServer();
  assert.ok(server);
  assert.ok(sessions);
  const names = new Set(tools.map((t) => t.name));
  for (const expected of [
    'engine_create_session', 'engine_get_roll_log', 'engine_verify_log',
    'dice_roll', 'dice_parse',
    'checks_ability_check', 'checks_saving_throw',
    'combat_attack_roll', 'combat_damage_roll', 'combat_apply_mastery',
    'conditions_apply', 'conditions_exhaustion_status',
    'xp_level_for_xp', 'xp_award_milestone',
    'movesets_legal',
    'beats_validate', 'beats_thread_advance',
    'character_derive_sheet', 'character_skill_ability_map',
    'srd_list', 'srd_get', 'srd_dump'
  ]) {
    assert.ok(names.has(expected), `missing tool: ${expected}`);
  }
});

test('createServer accepts an injected session registry so embedders can share state across servers', () => {
  const sessions = createSessions();
  sessions.create({ id: 'shared', seed: 99 });
  const { sessions: returned } = createServer({ sessions });
  assert.equal(returned, sessions, 'same registry instance should flow through');
  assert.ok(returned.list().some((s) => s.id === 'shared'));
});
