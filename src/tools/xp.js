// XP — level lookup, next-level threshold, and beat-driven
// milestone awards.
//
// The engine exposes a bound XP namespace per session because
// rule overrides (custom XP curves, alternate proficiency tables
// in Phase B) can be set at engine creation time.

import { z } from 'zod';
import { toolResult, toolError } from '../_result.js';

const SessionField = z.string().optional().describe('Session id; omit for default singleton.');

export function xpTools(sessions) {
  return [
    {
      name: 'xp_level_for_xp',
      description: 'Look up the level matching a total XP value, per the session\'s thresholds. Returns { level }.',
      input: {
        xp: z.number().int().nonnegative().describe('Total XP.'),
        session: SessionField
      },
      handler: async ({ xp, session }) => {
        try {
          const engine = sessions.get(session);
          return toolResult({ level: engine.XP.levelForXP(xp) });
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'xp_next_level_threshold',
      description: 'Return the XP value that triggers the next level-up (or null if max level). Returns { threshold, level }.',
      input: {
        xp: z.number().int().nonnegative().describe('Current total XP.'),
        session: SessionField
      },
      handler: async ({ xp, session }) => {
        try {
          const engine = sessions.get(session);
          return toolResult({ threshold: engine.XP.nextLevelThreshold(xp) });
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'xp_award_milestone',
      description: 'Award XP for completing a beat. Returns { xpDelta, newTotal, willLevelUp }. The host writes `newTotal` back to the PC record itself — this tool is a pure calculation.',
      input: {
        pc: z.record(z.unknown()).describe('PC record (must include xp and level).'),
        beat: z.record(z.unknown()).describe('Beat record (targetPlaytimeMinutes drives the award).'),
        session: SessionField
      },
      handler: async ({ pc, beat, session }) => {
        try {
          const engine = sessions.get(session);
          return toolResult(engine.XP.awardMilestone({ pc, beat }));
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'xp_thresholds',
      description: 'Return the full XP→level threshold table this session uses. Useful for UIs that render an XP bar.',
      input: { session: SessionField },
      handler: async ({ session }) => {
        try {
          const engine = sessions.get(session);
          return toolResult({ thresholds: { ...engine.XP.THRESHOLDS } });
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'xp_proficiency_for_level',
      description: 'Return the proficiency bonus for a given level. Returns { proficiencyBonus }.',
      input: {
        level: z.number().int().min(1).describe('Character level.'),
        session: SessionField
      },
      handler: async ({ level, session }) => {
        try {
          const engine = sessions.get(session);
          return toolResult({ proficiencyBonus: engine.XP.PROFICIENCY_BY_LEVEL[level] ?? null });
        } catch (err) { return toolError(err); }
      }
    }
  ];
}
