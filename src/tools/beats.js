// Beats — the engine's story runtime: a thread of beats, each
// with a dramatic purpose and gating conditions. The MCP layer
// exposes the *schema and walker* primitives, which are pure.
//
// `castArchetypes` historically took an `entityProvider` function,
// which can't cross the MCP wire — so it was omitted. Since 0.11.0
// `beats_cast_archetypes` closes that gap DATA-SHAPED: the caller
// sends the candidate entities as records (the kernel's 3.x npcs
// registry is exactly this shape) and the server builds the provider
// closure from them. The function stayed host-side; the data crosses.

import { z } from 'zod';
import { toolResult, toolError } from '../_result.js';

const SessionField = z.string().optional().describe('Session id; omit for default singleton.');

export function beatsTools(sessions) {
  return [
    {
      name: 'beats_archetype_roles',
      description: 'List the vocabulary of NPC functional roles a beat can request (authority, antagonist, informant, etc.). Use this when constructing beats to avoid roles the runtime won\'t understand.',
      input: { session: SessionField },
      handler: async ({ session }) => {
        try {
          const engine = sessions.get(session);
          return toolResult({ roles: [...engine.Beats.ARCHETYPE_ROLES] });
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'beats_validate',
      description: 'Validate a beat record. Returns { valid, errors }. Returns ALL errors so an authoring UI can show them all at once.',
      input: {
        beat: z.record(z.unknown()).describe('Beat record to validate.'),
        session: SessionField
      },
      handler: async ({ beat, session }) => {
        try {
          const engine = sessions.get(session);
          return toolResult(engine.Beats.validateBeat(beat));
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'beats_make_empty',
      description: 'Create a fresh empty beat with sensible defaults (intentionally invalid — `dramaticPurpose` is empty so the author must fill it in). Use as a starting point.',
      input: {
        id: z.string().describe('Beat id.'),
        session: SessionField
      },
      handler: async ({ id, session }) => {
        try {
          const engine = sessions.get(session);
          return toolResult(engine.Beats.makeEmptyBeat(id));
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'beats_thread_create',
      description: 'Wrap an array of beats into a thread (an ordered walker). Returns the thread record — pass it to the other thread_* tools.',
      input: {
        beats: z.array(z.record(z.unknown())).describe('Beats in narrative order.'),
        session: SessionField
      },
      handler: async ({ beats, session }) => {
        try {
          const engine = sessions.get(session);
          return toolResult(engine.Beats.createThread(beats));
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'beats_thread_current',
      description: 'Return the current beat in a thread (or null if the thread is exhausted).',
      input: {
        thread: z.record(z.unknown()).describe('Thread record from beats_thread_create.'),
        session: SessionField
      },
      handler: async ({ thread, session }) => {
        try {
          const engine = sessions.get(session);
          return toolResult({ beat: engine.Beats.currentBeat(thread) });
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'beats_is_ready',
      description: 'Check whether a beat\'s prerequisites are satisfied by the current game state. Returns { ready }.',
      input: {
        beat: z.record(z.unknown()).describe('Beat record.'),
        state: z.record(z.unknown()).describe('Game state (must include `flags` map).'),
        session: SessionField
      },
      handler: async ({ beat, state, session }) => {
        try {
          const engine = sessions.get(session);
          return toolResult({ ready: engine.Beats.isReady(beat, state) });
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'beats_is_complete',
      description: 'Check whether a beat\'s `setRequiredFlags` are all set in the current state. Returns { complete }.',
      input: {
        beat: z.record(z.unknown()).describe('Beat record.'),
        state: z.record(z.unknown()).describe('Game state.'),
        session: SessionField
      },
      handler: async ({ beat, state, session }) => {
        try {
          const engine = sessions.get(session);
          return toolResult({ complete: engine.Beats.isComplete(beat, state) });
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'beats_thread_advance',
      description: 'Advance a thread past the current beat if it is complete. Returns { thread, advanced, finished, reason? }. The `finished` flag is the loop\'s signal to end the chronicle.',
      input: {
        thread: z.record(z.unknown()).describe('Thread record.'),
        state: z.record(z.unknown()).describe('Game state.'),
        session: SessionField
      },
      handler: async ({ thread, state, session }) => {
        try {
          const engine = sessions.get(session);
          return toolResult(engine.Beats.advance(thread, state));
        } catch (err) { return toolError(err); }
      }
    }
    ,
    {
      name: 'beats_cast_archetypes',
      description: 'Fill a beat\'s requiredArchetypes from a list of candidate entities (id + archetypeRole + anything else, e.g. engine.npcs records). First candidate matching each slot\'s role wins; returns { cast, missing?, error? } exactly as the kernel\'s Beats.castArchetypes reports. Data-shaped: the entityProvider closure is built server-side from your list.',
      input: {
        beat: z.record(z.unknown()).describe('The beat whose requiredArchetypes need filling.'),
        entities: z.array(z.record(z.unknown())).describe('Candidate entities; each needs at least { id, archetypeRole }.'),
        session: SessionField
      },
      handler: async ({ beat, entities, session }) => {
        try {
          const engine = sessions.get(session);
          const pool = Array.isArray(entities) ? entities : [];
          const entityProvider = (slot) => pool.find((e) => e?.archetypeRole === slot.role) ?? null;
          return toolResult(engine.Beats.castArchetypes(beat, { entityProvider }));
        } catch (err) { return toolError(err); }
      }
    }
  ];
}
