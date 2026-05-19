// Conditions — apply/remove/check the SRD 5.2 boolean conditions
// (blinded, charmed, …) plus numeric exhaustion (gain/reduce/set
// + derived d20 and speed penalties).
//
// The engine functions are pure: they return a new actor record
// rather than mutating in place. The host stores the returned
// actor. This is the contract that lets MCP work at all — every
// game-state mutation crosses the wire as immutable data.

import { z } from 'zod';
import { toolResult, toolError } from '../_result.js';

const SessionField = z.string().optional().describe('Session id; omit for default singleton.');

export function conditionsTools(sessions) {
  return [
    {
      name: 'conditions_list',
      description: 'List the condition names this session knows about (SRD 5.2 defaults plus any extras passed to engine_create_session).',
      input: { session: SessionField },
      handler: async ({ session }) => {
        try {
          const engine = sessions.get(session);
          return toolResult({ conditions: [...engine.Conditions.CONDITIONS] });
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'conditions_apply',
      description: 'Apply a condition to an actor. Returns the new actor record (host must replace the old one). Throws for unknown conditions — use conditions_list to check.',
      input: {
        actor: z.record(z.unknown()).describe('Actor record (anything with mutable state).'),
        condition: z.string().describe('Condition name (see conditions_list).'),
        session: SessionField
      },
      handler: async ({ actor, condition, session }) => {
        try {
          const engine = sessions.get(session);
          return toolResult({ actor: engine.Conditions.apply(actor, condition) });
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'conditions_remove',
      description: 'Remove a condition from an actor. Returns the new actor record. Idempotent — removing an absent condition is a no-op.',
      input: {
        actor: z.record(z.unknown()).describe('Actor record.'),
        condition: z.string().describe('Condition name.'),
        session: SessionField
      },
      handler: async ({ actor, condition, session }) => {
        try {
          const engine = sessions.get(session);
          return toolResult({ actor: engine.Conditions.remove(actor, condition) });
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'conditions_has',
      description: 'Check whether an actor currently has a given condition. Returns { has: boolean }.',
      input: {
        actor: z.record(z.unknown()).describe('Actor record.'),
        condition: z.string().describe('Condition name.'),
        session: SessionField
      },
      handler: async ({ actor, condition, session }) => {
        try {
          const engine = sessions.get(session);
          return toolResult({ has: engine.Conditions.has(actor, condition) });
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'conditions_exhaustion_gain',
      description: 'Increase an actor\'s exhaustion (default +1, capped at 6 per SRD 5.2). Returns the new actor. Prefer this over conditions_exhaustion_set so deltas show up in history.',
      input: {
        actor: z.record(z.unknown()).describe('Actor record.'),
        amount: z.number().int().optional().describe('Levels to gain (default 1).'),
        session: SessionField
      },
      handler: async ({ actor, amount, session }) => {
        try {
          const engine = sessions.get(session);
          return toolResult({ actor: engine.Conditions.exhaustion.gain(actor, amount) });
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'conditions_exhaustion_reduce',
      description: 'Decrease an actor\'s exhaustion (default −1, floored at 0). SRD 5.2 long rest reduces by 1; pass `amount` for greater clears.',
      input: {
        actor: z.record(z.unknown()).describe('Actor record.'),
        amount: z.number().int().optional().describe('Levels to reduce (default 1).'),
        session: SessionField
      },
      handler: async ({ actor, amount, session }) => {
        try {
          const engine = sessions.get(session);
          return toolResult({ actor: engine.Conditions.exhaustion.reduce(actor, amount) });
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'conditions_exhaustion_set',
      description: 'Set an actor\'s exhaustion level explicitly (0–6). Returns the new actor. Use for save-load and debug; the loop should normally prefer gain/reduce.',
      input: {
        actor: z.record(z.unknown()).describe('Actor record.'),
        level: z.number().int().min(0).max(6).describe('New exhaustion level (0–6).'),
        session: SessionField
      },
      handler: async ({ actor, level, session }) => {
        try {
          const engine = sessions.get(session);
          return toolResult({ actor: engine.Conditions.exhaustion.set(actor, level) });
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'conditions_exhaustion_status',
      description: 'Read derived exhaustion data for an actor: { level, d20Modifier, speedPenalty, isDead }. Call before any d20 test so the loop can apply the right penalty.',
      input: {
        actor: z.record(z.unknown()).describe('Actor record.'),
        session: SessionField
      },
      handler: async ({ actor, session }) => {
        try {
          const engine = sessions.get(session);
          const ex = engine.Conditions.exhaustion;
          return toolResult({
            level: ex.level(actor),
            d20Modifier: ex.modifierToD20Tests(actor),
            speedPenalty: ex.speedPenalty(actor),
            isDead: ex.isDead(actor)
          });
        } catch (err) { return toolError(err); }
      }
    }
  ];
}
