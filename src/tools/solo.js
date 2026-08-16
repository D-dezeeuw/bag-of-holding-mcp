// Solo sessions and replay — the kernel's Session/Replay namespaces
// over the wire, in the STATELESS shape the playthrough work taught us:
// snapshot in, snapshot out. A live Session object cannot survive an
// HTTP transport that builds a server per request (the ws-N lesson), so
// every tool here round-trips through Session.serialize/restore — the
// caller owns the snapshot (state_save is the natural shelf for it),
// and a restart costs nothing because nothing lives here.

import { z } from 'zod';
import { Session, Replay, STARTER_PARTY } from '@zeeuw/bag-of-holding';
import { toolResult, toolError } from '../_result.js';

const SnapshotField = z.record(z.unknown()).describe(
  'A session snapshot from solo_session_create / solo_session_act. Opaque: store it (state_save works well) and pass it back verbatim.'
);

// The dispatchable surface. A whitelist, not reflection: every entry
// names a Session method that takes one plain-data args object and
// mutates the live session. Anything not listed does not cross the wire.
const ACTIONS = Object.freeze([
  'adoptActor', 'startEncounter', 'endTurn', 'endEncounter',
  'attack', 'applyDamage', 'heal', 'applyCondition', 'removeCondition',
  'shortRest', 'longRest', 'advanceTime', 'record',
]);

export function soloTools() {
  return [
    {
      name: 'solo_session_create',
      description: 'Start a kernel solo Session: seeded engine, party, scene clock, oracle — the full solo-play orchestrator. Returns { snapshot, scene, party }. The snapshot is the session; store it (state_save) and thread it through solo_session_act. Omit party to use the starter party.',
      input: {
        campaign: z.string().optional().describe('Campaign label stamped on the session.'),
        seed: z.number().int().optional().describe('RNG seed for replay-determinism. Strongly recommended.'),
        party: z.array(z.record(z.unknown())).optional().describe('CharacterRecords; defaults to STARTER_PARTY.'),
      },
      handler: async ({ campaign, seed, party }) => {
        try {
          const session = Session.create({
            campaign, seed, party: party ?? STARTER_PARTY,
          });
          return toolResult({
            snapshot: session.serialize(),
            scene: session.scene,
            party: session.party().map((p) => ({ id: p.id, name: p.name ?? p.id })),
          });
        } catch (err) { return toolError(err); }
      },
    },
    {
      name: 'solo_session_act',
      description: `Perform one session action and get the updated snapshot back. Actions: ${ACTIONS.join(', ')}. Args go to the session method verbatim (e.g. action "attack" with { attackerId, targetId, weaponId }). Returns { snapshot, result }. Stateless: the previous snapshot is consumed, the returned one replaces it.`,
      input: {
        snapshot: SnapshotField,
        action: z.enum(ACTIONS).describe('The session method to invoke.'),
        args: z.record(z.unknown()).optional().describe('Plain-data arguments for the action.'),
      },
      handler: async ({ snapshot, action, args }) => {
        try {
          const session = Session.restore(snapshot);
          const result = session[action](args ?? {});
          return toolResult({ snapshot: session.serialize(), result });
        } catch (err) { return toolError(err); }
      },
    },
    {
      name: 'solo_session_peek',
      description: 'Inspect a snapshot without acting: scene clock, encounter state, party condition, log length. Cheap and read-only — use it to re-orient after loading a stored snapshot.',
      input: { snapshot: SnapshotField },
      handler: async ({ snapshot }) => {
        try {
          const session = Session.restore(snapshot);
          return toolResult({
            scene: session.scene,
            encounter: session.encounter,
            party: session.party().map((p) => ({ id: p.id, name: p.name ?? p.id })),
            logLength: session.log.length,
          });
        } catch (err) { return toolError(err); }
      },
    },
    {
      name: 'replay_share',
      description: 'Produce a shareable replay blob from a session snapshot: seed, rules fingerprint, party records and the roll log — everything another table needs to verify the run was played straight.',
      input: { snapshot: SnapshotField },
      handler: async ({ snapshot }) => {
        try {
          const session = Session.restore(snapshot);
          return toolResult({ replay: Replay.share(session) });
        } catch (err) { return toolError(err); }
      },
    },
    {
      name: 'replay_verify',
      description: 'Verify a shared replay blob: re-rolls the recorded log against the recorded seed and rules fingerprint. Returns { ok } or { ok: false, ... } naming the divergence. The anti-fudging handshake, server-side.',
      input: {
        replay: z.record(z.unknown()).describe('A blob from replay_share.'),
      },
      handler: async ({ replay }) => {
        try {
          return toolResult(Replay.verify(replay));
        } catch (err) { return toolError(err); }
      },
    },
  ];
}
