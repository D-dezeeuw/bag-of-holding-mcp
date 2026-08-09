import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spellsTools } from '../src/tools/spells.js';
import { setup } from './_helpers.js';

test('spells_for_class returns the class list, not a guess', async () => {
  const { run } = setup(spellsTools);
  const { data } = await run('spells_for_class', { classId: 'wizard' });
  const ids = data.spells.map(s => s.id);
  assert.ok(ids.includes('fireball'), 'wizards get Fireball');
  assert.ok(!ids.includes('cure-wounds'), 'wizards do not heal — a derived list gets this wrong');
});

test('spells_for_class filters by exact level', async () => {
  const { run } = setup(spellsTools);
  const { data } = await run('spells_for_class', { classId: 'cleric', level: 0 });
  assert.ok(data.spells.length > 0);
  for (const s of data.spells) assert.equal(s.level, 0);
});

test('spells_for_class filters by ceiling', async () => {
  const { run } = setup(spellsTools);
  const { data } = await run('spells_for_class', { classId: 'wizard', maxLevel: 2 });
  for (const s of data.spells) assert.ok(s.level <= 2);
});

test('spells_for_class is empty for a non-caster', async () => {
  const { run } = setup(spellsTools);
  const { data } = await run('spells_for_class', { classId: 'barbarian' });
  assert.deepEqual(data.spells, []);
});

test('spells_classes_for names the classes, and nothing for an unknown id', async () => {
  const { run } = setup(spellsTools);
  assert.deepEqual((await run('spells_classes_for', { spellId: 'eldritch-blast' })).data.classes, ['warlock']);
  assert.deepEqual((await run('spells_classes_for', { spellId: 'not-a-spell' })).data.classes, []);
});

test('spells_max_level tracks the progression', async () => {
  const { run } = setup(spellsTools);
  assert.equal((await run('spells_max_level', { casterLevel: 5, progression: 'full' })).data.maxSpellLevel, 3);
  assert.equal((await run('spells_max_level', { casterLevel: 5, progression: 'half' })).data.maxSpellLevel, 2);
  assert.equal((await run('spells_max_level', { casterLevel: 5, progression: 'pact' })).data.maxSpellLevel, 3);
});

test('spells_fresh_slots gives a level-1 wizard two first-level slots', async () => {
  const { run } = setup(spellsTools);
  const { data } = await run('spells_fresh_slots', { casterLevel: 1, progression: 'full' });
  assert.deepEqual(data.slots, [{ level: 1, used: 0, max: 2 }]);
});

test('spells_cast spends a slot and reports the level it cast at', async () => {
  const { run } = setup(spellsTools);
  const { data: fresh } = await run('spells_fresh_slots', { casterLevel: 3, progression: 'full' });
  const { data } = await run('spells_cast', {
    actor: { id: 'pc', spellSlots: fresh.slots, spellsPrepared: [] },
    spellId: 'magic-missile', slotLevel: 1,
  });
  assert.equal(data.ok, true);
  assert.equal(data.castLevel, 1);
  assert.equal(data.actor.spellSlots[0].used, 1);
});

test('spells_cast casts at the level of the slot actually spent', async () => {
  const { run } = setup(spellsTools);
  // Only a 2nd-level slot left: a 1st-level request burns it, so the spell has
  // to happen at 2nd — reporting 1st would spend the bigger slot for nothing.
  const { data } = await run('spells_cast', {
    actor: { id: 'pc', spellSlots: [{ level: 1, used: 2, max: 2 }, { level: 2, used: 0, max: 2 }] },
    spellId: 'magic-missile', slotLevel: 1,
  });
  assert.equal(data.ok, true);
  assert.equal(data.castLevel, 2);
});

test('spells_cast refuses with the rule that refused it', async () => {
  const { run } = setup(spellsTools);
  const { data } = await run('spells_cast', {
    actor: { id: 'pc', spellSlots: [{ level: 1, used: 2, max: 2 }] },
    spellId: 'magic-missile', slotLevel: 1,
  });
  assert.equal(data.ok, false);
  assert.ok(data.reason, 'a refusal must say why');
});

test('spells_cast enforces one leveled spell per turn, and exempts cantrips', async () => {
  const { run } = setup(spellsTools);
  const actor = { id: 'pc', spellSlots: [{ level: 1, used: 0, max: 4 }] };
  const leveled = await run('spells_cast', {
    actor, spellId: 'magic-missile', slotLevel: 1, alreadyCastLeveledThisTurn: true,
  });
  assert.equal(leveled.data.ok, false);
  const cantrip = await run('spells_cast', {
    actor, spellId: 'fire-bolt', alreadyCastLeveledThisTurn: true,
  });
  assert.equal(cantrip.data.ok, true);
});

test('spells_cast reports an unknown spell rather than throwing', async () => {
  const { run } = setup(spellsTools);
  const { data } = await run('spells_cast', { actor: { spellSlots: [] }, spellId: 'nope' });
  assert.equal(data.ok, false);
  assert.match(data.reason, /nope/);
});

test('spells_rest: a long rest restores, a short rest does not (full caster)', async () => {
  const { run } = setup(spellsTools);
  const spent = [{ level: 1, used: 4, max: 4 }];
  assert.deepEqual((await run('spells_rest', { slots: spent, kind: 'long'  })).data.slots, [{ level: 1, used: 0, max: 4 }]);
  assert.deepEqual((await run('spells_rest', { slots: spent, kind: 'short' })).data.slots, spent);
});

test('spells_cantrip_damage scales at the SRD tiers and nowhere else', async () => {
  const { run } = setup(spellsTools);
  const at = async (lvl) => (await run('spells_cantrip_damage', { spellId: 'fire-bolt', casterLevel: lvl })).data.spec;
  assert.equal(await at(1),  '1d10');
  assert.equal(await at(4),  '1d10');
  assert.equal(await at(5),  '2d10');
  assert.equal(await at(11), '3d10');
  assert.equal(await at(17), '4d10');
});

test('spells_cantrip_damage is null for a spell that deals none', async () => {
  const { run } = setup(spellsTools);
  assert.equal((await run('spells_cantrip_damage', { spellId: 'light', casterLevel: 5 })).data.spec, null);
});

test('every spells_* tool reports a bad session as an error', async () => {
  const { run, tools } = setup(spellsTools);
  for (const tool of tools) {
    const r = await run(tool.name, {
      session: 'no', classId: 'wizard', spellId: 'fire-bolt', casterLevel: 3,
      progression: 'full', slots: [], actor: { spellSlots: [] },
    });
    assert.equal(r.isError, true, `${tool.name} swallowed an unknown session`);
  }
});

test('spells_cast forwards the ritual flag (unprepared ritual is refused)', async () => {
  const { run } = setup(spellsTools);
  const actor = { spellSlots: [{ level: 1, used: 0, max: 2 }], spellsPrepared: [] };
  const { data } = await run('spells_cast', { actor, spellId: 'identify', ritual: true });
  assert.equal(data.ok, false);
  assert.match(data.reason, /prepar/i);
});

test('spells_cantrip_damage reports an unknown cantrip', async () => {
  const { run } = setup(spellsTools);
  const r = await run('spells_cantrip_damage', { spellId: 'not-a-cantrip', casterLevel: 5 });
  assert.equal(r.isError, true);
});
