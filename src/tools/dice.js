// Dice tools — the most-called surface in the whole server.
//
// Each call flows through the per-session engine's Dice namespace,
// which uses the session's seeded RNG and appends to its rollLog.
// That's the entire reason this MCP exists: take the dice out of
// the AI's hands so neither side can fudge a roll, and keep the
// trail auditable after the fact via `engine_get_roll_log` +
// `engine_verify_log`.

import { z } from 'zod';
import { toolResult, toolError } from '../_result.js';

const SessionField = z.string().optional().describe(
  'Session id from engine_create_session. Omit to use the default (unseeded) singleton — fine for one-shot mechanic questions, wrong for an actual game where you need replayability.'
);

const ContextField = z.record(z.unknown()).optional().describe(
  'Free-form tag attached to the rollLog entry (e.g. { actor: "PC-1", purpose: "perception", round: 3 }). Lets `engine_get_roll_log` be filtered/searched later — pass it whenever you can.'
);

/**
 * Build the dice tool descriptors against a given session registry.
 *
 * Why factory-of-handlers instead of class instances: each handler
 * closes over `sessions` once, the resulting descriptors are plain
 * data, and the server module can register them by iterating —
 * which makes the whole surface trivially testable (just call the
 * `handler` directly, no MCP transport needed).
 */
export function diceTools(sessions) {
  return [
    {
      name: 'dice_roll',
      description: 'Roll dice with the standard XdY±Z grammar. Examples: "1d20", "2d6+3", "4d8-2". Returns { rolls, modifier, total }. Use this instead of letting the model "decide" a roll.',
      input: {
        spec: z.string().describe('Dice spec, e.g. "1d20", "2d6+3"'),
        session: SessionField,
        context: ContextField
      },
      handler: async ({ spec, session, context }) => {
        try {
          const engine = sessions.get(session);
          return toolResult(engine.Dice.roll(spec, context));
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'dice_roll_advantage',
      description: 'Roll the spec twice, keep the higher total. Use for D&D 5e advantage. Returns { rolls, modifier, total, picked }.',
      input: {
        spec: z.string().describe('Dice spec, e.g. "1d20+5"'),
        session: SessionField,
        context: ContextField
      },
      handler: async ({ spec, session, context }) => {
        try {
          const engine = sessions.get(session);
          return toolResult(engine.Dice.rollAdvantage(spec, context));
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'dice_roll_disadvantage',
      description: 'Roll the spec twice, keep the lower total. Use for D&D 5e disadvantage.',
      input: {
        spec: z.string().describe('Dice spec, e.g. "1d20+5"'),
        session: SessionField,
        context: ContextField
      },
      handler: async ({ spec, session, context }) => {
        try {
          const engine = sessions.get(session);
          return toolResult(engine.Dice.rollDisadvantage(spec, context));
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'dice_roll_die',
      description: 'Roll a single die of N sides. Use for ad-hoc d4/d6/d8/d10/d12/d20/d100 rolls outside the XdY grammar.',
      input: {
        sides: z.number().int().positive().describe('Number of sides (e.g. 20 for a d20).'),
        session: SessionField,
        context: ContextField
      },
      handler: async ({ sides, session, context }) => {
        try {
          const engine = sessions.get(session);
          return toolResult({ value: engine.Dice.rollDie(sides, context) });
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'dice_parse',
      description: 'Parse a dice spec without rolling. Returns { count, sides, modifier }. Pure helper — does not consume the RNG or write to the rollLog.',
      input: {
        spec: z.string().describe('Dice spec, e.g. "2d6+3"')
      },
      handler: async ({ spec }) => {
        try {
          // Parse is engine-independent and stateless; using the
          // default engine here keeps the call site uniform.
          return toolResult(sessions.get().Dice.parse(spec));
        } catch (err) { return toolError(err); }
      }
    }
  ];
}
