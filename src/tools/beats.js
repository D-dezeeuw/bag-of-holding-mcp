// Beats — the engine's story runtime: a thread of beats, each
// with a dramatic purpose and gating conditions. The MCP layer
// exposes the *schema and walker* primitives, which are pure.
//
// `castArchetypes` is deliberately omitted: it takes an
// `entityProvider` function, which can't cross the MCP wire as
// data. Hosts that need archetype casting should import the
// engine directly for that one call.

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
  ];
}
