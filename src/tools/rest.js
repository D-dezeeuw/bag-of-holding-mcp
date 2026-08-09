// Rest mechanics — short rest, long rest, Hit Dice.
//
// The engine has owned rest recovery since 1.2.0 (slot refresh by
// caster kind, resource refresh timing, hit-die recovery on a long
// rest, the interrupted-rest rule) but none of it was reachable
// over MCP — a host that wanted "we camp for the night" had to
// hand-write the recovery the kernel already gets right. Same
// contract as the damage tranche: the tool returns the updated
// actor, the host stores it.

import { z } from 'zod';
import { toolResult, toolError } from '../_result.js';

const SessionField = z.string().optional().describe('Session id; omit for default singleton.');
const ContextField = z.record(z.unknown()).optional().describe('Free-form tag attached to the rollLog entry.');

export function restTools(sessions) {
  return [
    {
      name: 'rest_short',
      description: 'Take a short rest: refreshes short-rest resources (e.g. Second Wind uses per class rules) and warlock-style pact slots. Does NOT spend Hit Dice — call rest_spend_hit_die per die the player chooses to spend. Returns the updated actor.',
      input: {
        actor: z.record(z.unknown()).describe('Actor record (spellSlots?, resources?).'),
        session: SessionField
      },
      handler: async ({ actor, session }) => {
        try {
          const engine = sessions.get(session);
          return toolResult({ actor: engine.Rest.shortRest(actor) });
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'rest_long',
      description: 'Take a long rest: restores HP to max, refreshes spell slots and long-rest resources, recovers spent Hit Dice per the session\'s rules (default: half of total), reduces exhaustion by 1. Pass interrupted: true for a rest broken by 1+ hour of strenuous activity — the actor returns UNCHANGED per SRD 5.2. Returns the updated actor.',
      input: {
        actor: z.record(z.unknown()).describe('Actor record.'),
        interrupted: z.boolean().optional().describe('Whether the rest was interrupted (yields no benefit).'),
        session: SessionField
      },
      handler: async ({ actor, interrupted, session }) => {
        try {
          const engine = sessions.get(session);
          return toolResult({ actor: engine.Rest.longRest(actor, { interrupted }) });
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'rest_spend_hit_die',
      description: 'Spend one Hit Die during a short rest: rolls the actor\'s hitDie, adds CON modifier (minimum 1 healed), caps at hpMax, increments hitDiceUsed. Returns { healed, die?, hpAfter, actor }; healed is 0 with no roll when no dice remain. The die face is logged in the session\'s rollLog.',
      input: {
        actor: z.record(z.unknown()).describe('Actor record (hitDie, hitDiceTotal or level, hitDiceUsed?, abilityScores.con, hp, hpMax).'),
        session: SessionField,
        context: ContextField
      },
      handler: async ({ actor, session, context }) => {
        try {
          const engine = sessions.get(session);
          return toolResult(engine.Rest.spendHitDie(actor, context));
        } catch (err) { return toolError(err); }
      }
    }
  ];
}
