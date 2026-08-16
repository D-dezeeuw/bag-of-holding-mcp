// Solo sessions + replay over the wire (0.11.0). What must hold: the
// tools are STATELESS — a snapshot round-trips create → act → peek
// across separate handler calls with nothing held server-side; the
// action surface is a whitelist; replay_share → replay_verify closes
// the anti-fudging handshake; and beats_cast_archetypes builds the
// provider closure from DATA (the wire limitation that kept it off the
// server is gone).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createServer } from '../src/server.js';

const tmpDir = () => mkdtempSync(join(tmpdir(), 'boh-solo-'));
const payload = (res) => JSON.parse(res.content[0].text);

function toolMap() {
  const { tools } = createServer({ memory: { dataDir: tmpDir(), tokenHashes: [] } });
  return new Map(tools.map((t) => [t.name, t]));
}

test('a solo session round-trips statelessly: create → act → act → peek', async () => {
  const tools = toolMap();
  const created = payload(await tools.get('solo_session_create').handler({ campaign: 'wire-probe', seed: 41 }));
  assert.ok(created.snapshot, 'the snapshot IS the session');
  assert.ok(created.party.length >= 1);
  const t0 = created.scene.minutes;

  // Each call restores from the snapshot alone — nothing server-side.
  const acted = payload(await tools.get('solo_session_act').handler({
    snapshot: created.snapshot, action: 'advanceTime', args: { minutes: 60 },
  }));
  assert.ok(acted.snapshot, 'a fresh snapshot comes back');
  const noted = payload(await tools.get('solo_session_act').handler({
    snapshot: acted.snapshot, action: 'record', args: { note: 'entered the fen-vault' },
  }));
  const peeked = payload(await tools.get('solo_session_peek').handler({ snapshot: noted.snapshot }));
  assert.equal(peeked.scene.minutes, t0 + 60, 'time advanced survived two round-trips');
  assert.ok(peeked.logLength >= 1, 'the note landed in the log');
});

test('replay_share → replay_verify closes the anti-fudging handshake', async () => {
  const tools = toolMap();
  const created = payload(await tools.get('solo_session_create').handler({ seed: 7 }));
  const acted = payload(await tools.get('solo_session_act').handler({
    snapshot: created.snapshot, action: 'advanceTime', args: { minutes: 10 },
  }));
  const shared = payload(await tools.get('replay_share').handler({ snapshot: acted.snapshot }));
  assert.ok(shared.replay.seed !== undefined);
  assert.ok(Array.isArray(shared.replay.rollLog));
  const verdict = payload(await tools.get('replay_verify').handler({ replay: shared.replay }));
  assert.equal(verdict.ok, true, 'an honest log verifies');
});

test('beats_cast_archetypes: the provider closure is built from DATA', async () => {
  const tools = toolMap();
  const beat = {
    id: 'beat.01', dramaticPurpose: 'test', prerequisites: [], setRequiredFlags: ['x'],
    requiredArchetypes: [{ role: 'authority' }, { role: 'informant' }],
  };
  const entities = [
    { id: 'magistrate', name: 'The Magistrate', archetypeRole: 'authority' },
    { id: 'clerk', name: 'The Clerk', archetypeRole: 'informant' },
    { id: 'thug', name: 'A Thug', archetypeRole: 'muscle' },
  ];
  const cast = payload(await tools.get('beats_cast_archetypes').handler({ beat, entities }));
  assert.equal(cast.cast.authority.id, 'magistrate');
  assert.equal(cast.cast.informant.id, 'clerk');
  // A missing role reports exactly as the kernel does.
  const short = payload(await tools.get('beats_cast_archetypes').handler({
    beat, entities: entities.slice(0, 1),
  }));
  assert.equal(short.cast, null);
  assert.equal(short.missing.role, 'informant');
});
