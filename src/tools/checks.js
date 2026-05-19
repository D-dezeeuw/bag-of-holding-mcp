// Ability checks + saving throws.
//
// These are the second most-called surface after raw dice. The
// engine handles the math (mod from score, proficiency bonus, DC
// clamp); we just pass through. The reason for funneling them
// through the engine rather than letting the AI compose
// `dice_roll` itself is that the resulting rollLog entries record
// the *intent* (`abilityCheck` vs `savingThrow` vs `roll`), which
// is what `verifyLog` and any later analytics key on.

import { z } from 'zod';
import { toolResult, toolError } from '../_result.js';

const SessionField = z.string().optional().describe('Session id; omit for default singleton.');
const ContextField = z.record(z.unknown()).optional().describe('Free-form tag attached to the rollLog entry.');

const CheckArgs = {
  abilityScore: z.number().int().describe('Raw ability score (e.g. 14 for a STR 14 character).'),
  proficient: z.boolean().optional().describe('Whether the actor is proficient in this check.'),
  proficiencyBonus: z.number().int().optional().describe('Proficiency bonus to add (default 2 if proficient).'),
  dc: z.number().int().optional().describe('Difficulty class. If omitted, the engine returns the roll + total without a pass/fail verdict.')
};

export function checksTools(sessions) {
  return [
    {
      name: 'checks_ability_check',
      description: 'Resolve a D&D 5e ability check. Returns { roll, total, dc, success }. Pass `dc` to get a pass/fail verdict; omit it for just the total.',
      input: { ...CheckArgs, session: SessionField, context: ContextField },
      handler: async ({ session, context, ...args }) => {
        try {
          const engine = sessions.get(session);
          return toolResult(engine.Checks.abilityCheck(args, context));
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'checks_saving_throw',
      description: 'Resolve a D&D 5e saving throw. Same shape as ability check; semantic difference is recorded in the rollLog so analytics can distinguish them.',
      input: { ...CheckArgs, session: SessionField, context: ContextField },
      handler: async ({ session, context, ...args }) => {
        try {
          const engine = sessions.get(session);
          return toolResult(engine.Checks.savingThrow(args, context));
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'checks_mod_from_score',
      description: 'Pure helper: convert an ability score (1–30) to its modifier. 10→0, 14→+2, 18→+4 etc. Use this when you need the modifier independently of a roll.',
      input: { score: z.number().int().describe('Ability score (1–30).') },
      handler: async ({ score }) =>
        toolResult({ mod: sessions.get().Checks.modFromScore(score) })
    },
    {
      name: 'checks_clamp_dc',
      description: 'Pure helper: clamp a proposed DC to the engine\'s legal range. Useful when the AI suggests a DC the rules don\'t allow.',
      input: { dc: z.number().describe('Proposed DC.') },
      handler: async ({ dc }) =>
        toolResult({ dc: sessions.get().Checks.clampDC(dc) })
    }
  ];
}
