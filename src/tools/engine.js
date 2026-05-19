// Engine — session lifecycle + replay verification.
//
// These tools are how a host opens a game ("give me a deterministic
// session for campaign #42 with seed 12345"), inspects what's
// running, pulls the audit trail, and proves the engine actually
// produced the rolls the AI claims it did.

import { z } from 'zod';
import { verifyLog } from '@zeeuw/bag-of-holding';
import { toolResult, toolError } from '../_result.js';

const SessionField = z.string().describe('Session id.');

export function engineTools(sessions) {
  return [
    {
      name: 'engine_create_session',
      description: 'Open a new game session with its own engine instance. Pass `seed` for deterministic replay. Returns { id, seed }. Always create a session before starting a campaign — the default singleton is unseeded and shared.',
      input: {
        id: z.string().optional().describe('Optional session id; auto-generated if omitted.'),
        seed: z.number().int().optional().describe('Seed for the session\'s RNG. Omit for non-deterministic play (Math.random).'),
        rollLogCap: z.number().int().positive().optional().describe('Max rollLog entries (default ∞). Useful for very long sessions.'),
        extras: z.record(z.unknown()).optional().describe('Engine plugin options: extraSpecies, extraClasses, extraConditions, extraMastery, etc. (See createEngine in @zeeuw/bag-of-holding.)')
      },
      handler: async ({ id, seed, rollLogCap, extras }) => {
        try {
          return toolResult(sessions.create({ id, seed, rollLogCap, extras }));
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'engine_destroy_session',
      description: 'Free a session\'s engine + audit trail from server memory. The default session is protected — destroying it would orphan any unscoped tool calls.',
      input: { session: SessionField },
      handler: async ({ session }) => {
        try {
          return toolResult(sessions.destroy(session));
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'engine_list_sessions',
      description: 'List all sessions known to the server, including the default. Returns metadata only (id, seed, createdAt) — not the engines themselves.',
      input: {},
      handler: async () => toolResult({ sessions: sessions.list() })
    },
    {
      name: 'engine_get_roll_log',
      description: 'Read a session\'s append-only rollLog. Each entry is { index, op, ...payload, context? }. Pass through to engine_verify_log to prove replay-determinism.',
      input: { session: SessionField.optional() },
      handler: async ({ session }) => {
        try {
          return toolResult({ rollLog: sessions.rollLog(session) });
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'engine_verify_log',
      description: 'Replay a rollLog against a fresh seeded engine and confirm every roll matches. Returns { ok: true } on success or { ok: false, divergedAt, expected, actual } on the first mismatch. Use this to catch determinism regressions or fabricated rolls.',
      input: {
        seed: z.number().int().describe('Seed the log was originally recorded with.'),
        log: z.array(z.record(z.unknown())).describe('Roll log to verify.'),
        rules: z.record(z.unknown()).optional().describe('Rule overrides matching the original session, if any.')
      },
      handler: async ({ seed, log, rules }) => {
        try {
          return toolResult(verifyLog({ seed, log, rules }));
        } catch (err) { return toolError(err); }
      }
    }
  ];
}
