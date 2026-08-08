// Monster tiers — deriving a CR 16–24 opponent from a verified SRD stat block.
//
// The SRD bestiary tops out below the tier where a campaign's final act
// happens. Inventing stat blocks for that range means inventing balance that
// was never tested against anything; the engine's templates instead SCALE a
// block whose numbers are known good, which is the difference between a boss
// that is hard and one that is arbitrary.

import { z } from 'zod';
import { elevate, templateForTargetCr } from '@zeeuw/bag-of-holding';
import { toolResult, toolError } from '../_result.js';

const SessionField = z.string().optional().describe('Session id; omit for default singleton.');

export function monsterTools(sessions) {
  return [
    {
      name: 'monsters_elevate',
      description:
        'Raise an SRD monster to a higher tier. "elite" is +4 CR and x1.8 HP, "champion" +8 and x2.8, "ancient" +12 and x4.0, with attack, save and damage scaled to match. Returns the derived stat block, including a display name ("Ancient Wight"). The source block is not modified.',
      input: {
        monsterId: z.string().describe('SRD monster id, e.g. "wight".'),
        tier:      z.enum(['elite', 'champion', 'ancient']).describe('Template to apply.'),
        session:   SessionField
      },
      handler: async ({ monsterId, tier, session }) => {
        try {
          const engine = sessions.get(session);
          const base = engine.monsters[monsterId];
          if (!base) return toolError(new Error(`no monster with id '${monsterId}'`));
          return toolResult(elevate(base, tier));
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'monsters_for_target_cr',
      description:
        'Pick the template that lifts a monster closest to a target CR, and apply it. Returns { tier, block } or { tier: null, block } when the base is already at or above the target. Use this when you know the encounter difficulty you want rather than the tier name.',
      input: {
        monsterId: z.string().describe('SRD monster id to raise.'),
        targetCr:  z.number().min(0).max(30).describe('Challenge rating you are building toward.'),
        session:   SessionField
      },
      handler: async ({ monsterId, targetCr, session }) => {
        try {
          const engine = sessions.get(session);
          const base = engine.monsters[monsterId];
          if (!base) return toolError(new Error(`no monster with id '${monsterId}'`));
          const tier = templateForTargetCr(base, targetCr);
          return toolResult({ tier, block: tier ? elevate(base, tier) : base });
        } catch (err) { return toolError(err); }
      }
    }
  ];
}
