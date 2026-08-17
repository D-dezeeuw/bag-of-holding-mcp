// Cross-repo drift gate: every creature id in the client's dungeon
// overlay pools must resolve against the kernel's registries (base
// SRD + Bestiary I — the pack the client's README tells hosts to
// mount for full pools). This test lives HERE because this repo is
// the only one that imports both packages; the client's own suite is
// deliberately kernel-free. If a pool gains an id no registry
// carries, this fails before a table ever meets a bossless vault.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEngine, BESTIARY_I } from '@zeeuw/bag-of-holding';
import { DUNGEON_OVERLAYS } from '@zeeuw/bag-of-holding-client';

test('every dungeon overlay id resolves against kernel SRD + Bestiary I', () => {
  const engine = createEngine({ extraMonsters: BESTIARY_I });
  const missing = [];
  for (const [theme, overlay] of Object.entries(DUNGEON_OVERLAYS)) {
    for (const id of overlay.enemies) {
      if (!engine.monsters[id]) missing.push(`${theme}: ${id}`);
    }
  }
  assert.deepEqual(missing, [], 'overlay ids with no kernel stat block');
});

test('the five once-missing bosses are real Bestiary I blocks', () => {
  for (const id of ['fungal-zombie', 'stone-sentinel', 'myconid-sovereign', 'young-drake', 'lesser-demon']) {
    const block = BESTIARY_I[id];
    assert.ok(block, `${id} missing from BESTIARY_I`);
    assert.ok(block.cr > 0 || block.cr === 0.5 || block.cr === 0.25, `${id} carries a CR`);
  }
});
