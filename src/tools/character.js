// Character — derive a fully computed sheet from a host-owned
// character record. Pure function: same record + same engine →
// same sheet.
//
// `Character.deriveSheet` reads across the engine's species,
// classes, backgrounds, feats, items, and XP tables. Plugins
// passed at session creation flow through automatically.

import { z } from 'zod';
import { Character } from '@zeeuw/bag-of-holding';
import { toolResult, toolError } from '../_result.js';

const SessionField = z.string().optional().describe('Session id; omit for default singleton.');

export function characterTools(sessions) {
  return [
    {
      name: 'character_derive_sheet',
      description: 'Compute a full character sheet from a persisted PC record (ability scores, mods, skills, AC, HP, proficiency bonus, etc.). The session\'s registries are used so plugin content resolves correctly.',
      input: {
        record: z.record(z.unknown()).describe('Persisted PC record.'),
        session: SessionField
      },
      handler: async ({ record, session }) => {
        try {
          const engine = sessions.get(session);
          return toolResult(engine.deriveSheet(record));
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'character_skill_ability_map',
      description: 'Return the SRD 5.2 skill-to-ability map (e.g. acrobatics→dex). Frozen; same value every call. Use when rendering a skill table so ordering and ability assignment match the engine.',
      input: {},
      handler: async () => toolResult({ skills: { ...Character.SKILL_ABILITY } })
    }
  ];
}
