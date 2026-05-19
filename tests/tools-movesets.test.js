import { test } from 'node:test';
import assert from 'node:assert/strict';
import { movesetsTools } from '../src/tools/movesets.js';
import { setup } from './_helpers.js';

test('movesets_legal returns combat chips in combat mode and exploration chips otherwise', async () => {
  const { run } = setup(movesetsTools);
  const combat = await run('movesets_legal', { pc: {}, scene: { mode: 'combat' } });
  const ids = combat.data.actions.map((a) => a.id);
  assert.ok(ids.includes('attack.melee'));

  const explore = await run('movesets_legal', { pc: {}, scene: { mode: 'exploration' } });
  const exploreIds = explore.data.actions.map((a) => a.id);
  assert.ok(exploreIds.includes('move'));
  assert.ok(!exploreIds.includes('attack.melee'));
});

test('movesets_legal error path', async () => {
  const { run } = setup(movesetsTools);
  const r = await run('movesets_legal', { pc: {}, scene: {}, session: 'no' });
  assert.equal(r.isError, true);
});
