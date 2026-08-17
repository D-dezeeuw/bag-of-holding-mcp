import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worlds, getWorld, layered, deepFreeze } from '../src/world/index.js';

// Content QA: a world pack is a web of cross-references, and a
// dangling one surfaces mid-session as the DM confidently citing an
// NPC that doesn't exist. These tests make the referential integrity
// of every bundled pack a merge gate.

test('one pack per engine setting is bundled', () => {
  assert.deepEqual(
    Object.keys(worlds).sort(),
    ['greyfen-march', 'gutterlight-yards', 'hollow-vale']
  );
  assert.equal(worlds['greyfen-march'].setting, 'Sundermark');
  assert.equal(worlds['gutterlight-yards'].setting, 'Brassgear');
  assert.equal(worlds['hollow-vale'].setting, 'The Hollow Vale');
});

test('every bundled pack cross-references cleanly', () => {
  for (const world of Object.values(worlds)) {
    const regionIds = Object.keys(world.regions);
    const factionIds = Object.keys(world.factions);
    const npcIds = Object.keys(world.npcs);

    assert.ok(regionIds.includes(world.gettingStarted.startingLocation), `${world.id}: startingLocation`);

    for (const [id, region] of Object.entries(world.regions)) {
      for (const npc of region.npcs) {
        assert.ok(npcIds.includes(npc), `${world.id}/${id}: unknown npc ${npc}`);
      }
      assert.ok(region.hooks.length >= 2, `${world.id}/${id}: needs hooks`);
      assert.ok(region.sites.length >= 2, `${world.id}/${id}: needs sites`);
      assert.ok(region.gm.secret, `${world.id}/${id}: region gm secret`);
    }

    for (const [id, npc] of Object.entries(world.npcs)) {
      assert.ok(regionIds.includes(npc.location), `${world.id}/${id}: unknown location ${npc.location}`);
      assert.ok(npc.faction === null || factionIds.includes(npc.faction), `${world.id}/${id}: unknown faction`);
      for (const field of ['name', 'pronouns', 'role', 'voice', 'statHint']) {
        assert.ok(npc[field], `${world.id}/${id}: missing ${field}`);
      }
      assert.ok(npc.gm.secret, `${world.id}/${id}: npc gm secret`);
    }

    for (const [id, faction] of Object.entries(world.factions)) {
      for (const other of Object.keys(faction.relations)) {
        assert.ok(factionIds.includes(other), `${world.id}/${id}: relation to unknown faction ${other}`);
        assert.notEqual(other, id, `${world.id}/${id}: self-relation`);
      }
      assert.ok(faction.gm.secret && faction.gm.weakness, `${world.id}/${id}: faction gm layer`);
    }

    for (const secret of world.secrets) {
      assert.ok([1, 2, 3].includes(secret.tier), `${world.id}/${secret.id}: tier`);
      assert.ok(secret.breadcrumbs.length >= 2, `${world.id}/${secret.id}: breadcrumbs`);
    }
    assert.ok(world.secrets.some((s) => s.tier === 3), `${world.id}: needs a tier-3 core`);

    for (const opener of world.gettingStarted.openers) {
      for (const field of ['id', 'title', 'hook', 'firstScene']) {
        assert.ok(opener[field], `${world.id}/${opener.id ?? '?'}: opener ${field}`);
      }
    }
    assert.ok(world.timeline.length >= 5 && world.pantheon.deadGods.length >= 3, `${world.id}: history`);
  }
});

test('packs are deep-frozen — no host can mutate shared canon', () => {
  const greyfen = getWorld('greyfen-march');
  assert.throws(() => { greyfen.name = 'renamed'; }, TypeError);
  assert.throws(() => { greyfen.npcs['old-nod'].gm.secret = 'rewritten'; }, TypeError);
  assert.throws(() => { greyfen.secrets.push({}); }, TypeError);
});

test('getWorld throws a pointer at what does exist', () => {
  assert.throws(() => getWorld('narnia'), /Unknown world.*greyfen-march/s);
});

test('layered() strips gm keys recursively on the public cut and returns mutable copies', () => {
  const region = getWorld('greyfen-march').regions.wickmere;
  const publicCut = layered(region, undefined);
  assert.equal('gm' in publicCut, false);
  assert.equal(JSON.stringify(publicCut).includes('"gm"'), false);
  publicCut.name = 'mutable copy'; // frozen source, workable copy

  const gmCut = layered(region, 'gm');
  assert.ok(gmCut.gm.secret.length > 0);

  // Nested gm keys vanish too, and arrays are traversed, not deleted from.
  const nested = layered({ list: [{ gm: { s: 1 }, keep: true }], child: { gm: 'x', ok: null } }, 'public');
  assert.deepEqual(nested, { list: [{ keep: true }], child: { ok: null } });
});

test('deepFreeze freezes through shared references without re-walking them', () => {
  const shared = { inner: { n: 1 } };
  const frozen = deepFreeze({ a: shared, b: shared, nil: null });
  assert.ok(Object.isFrozen(frozen.a.inner));
  assert.equal(frozen.a, frozen.b);
  assert.equal(deepFreeze('leaf'), 'leaf');
});
