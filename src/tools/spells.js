// Spellcasting — class spell lists, slot tables, and the maths of a cast.
//
// The engine gained the class lists in 2.4.0: which classes may learn which
// spells, which the spell records themselves never carried. Without them a host
// offering a player their real spell list had to derive one from school and
// level, and a derived list gets a wizard casting Cure Wounds — the exact class
// of quiet wrongness this server exists to prevent.

import { z } from 'zod';
import { classesFor, maxSpellLevel } from '@zeeuw/bag-of-holding';
import { toolResult, toolError } from '../_result.js';

const SessionField = z.string().optional().describe('Session id; omit for default singleton.');

const PROGRESSIONS = ['full', 'half', 'pact'];

export function spellsTools(sessions) {
  return [
    {
      name: 'spells_for_class',
      description:
        'Every spell on a class\'s SRD 5.2 list, optionally filtered by level. Returns { spells: [{ id, name, level, school, damage?, healing?, save?, concentration? }] }, sorted by level then name. Subclass-granted spells (Domain, Circle, Patron, Oath) are NOT included — they belong to the subclass.',
      input: {
        classId:  z.string().describe('Class id, e.g. "wizard" or "cleric".'),
        level:    z.number().int().min(0).max(9).optional().describe('Exact spell level. 0 is cantrips.'),
        maxLevel: z.number().int().min(0).max(9).optional().describe('Ceiling — everything at or below this level.'),
        session:  SessionField
      },
      handler: async ({ classId, level, maxLevel, session }) => {
        try {
          const engine = sessions.get(session);
          // Filtered off the SESSION's registry rather than the package's, so a
          // session created with `extraSpells` behaves consistently everywhere.
          // Plugin spells carry no SRD class list and are therefore absent —
          // which is right: only the host knows who may cast its own content.
          const spells = Object.values(engine.spells)
            .filter(sp => classesFor(sp.id).includes(classId))
            .filter(sp => (level    == null || sp.level === level))
            .filter(sp => (maxLevel == null || sp.level <= maxLevel))
            .sort((a, b) => a.level - b.level || a.name.localeCompare(b.name));
          return toolResult({ spells });
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'spells_classes_for',
      description: 'Which classes have a given spell on their list. Returns { classes: string[] } — empty for an unknown id, which is also how you check whether a spell exists.',
      input: {
        spellId: z.string().describe('Spell id, e.g. "fireball".'),
        session: SessionField
      },
      handler: async ({ spellId, session }) => {
        try {
          sessions.get(session);            // validates the session id
          return toolResult({ classes: classesFor(spellId) });
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'spells_max_level',
      description:
        'The highest spell level a caster can reach at a given character level, by progression. Returns { maxSpellLevel }. Asserted in the engine against the slot tables themselves, so it never offers a level the character has no slot for.',
      input: {
        casterLevel: z.number().int().min(1).max(20).describe('Character level.'),
        progression: z.enum(PROGRESSIONS).default('full').describe('full (wizard, cleric…), half (paladin, ranger), pact (warlock).'),
        session:     SessionField
      },
      handler: async ({ casterLevel, progression, session }) => {
        try {
          sessions.get(session);            // validates the session id
          return toolResult({ maxSpellLevel: maxSpellLevel(casterLevel, progression) });
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'spells_fresh_slots',
      description: 'A full set of spell slots for a caster level and progression. Returns { slots: [{ level, used, max }] } — the shape spells_cast consumes.',
      input: {
        casterLevel: z.number().int().min(1).max(20).describe('Character level.'),
        progression: z.enum(PROGRESSIONS).default('full').describe('Slot progression.'),
        session:     SessionField
      },
      handler: async ({ casterLevel, progression, session }) => {
        try {
          const engine = sessions.get(session);
          return toolResult({ slots: engine.Spellcasting.freshSlots(progression, casterLevel) });
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'spells_cast',
      description:
        'Cast a spell: enforces components, the one-leveled-spell-per-turn rule, preparation for rituals, and slot consumption. Returns { ok: true, actor, castLevel, upcastEffect, ritual } or { ok: false, reason } citing the SRD rule that refused it. Note castLevel: consuming a higher slot than asked for casts at THAT level, so a 3rd-level request paying a 5th-level slot gets 5th-level effect.',
      input: {
        actor:   z.record(z.unknown()).describe('Actor with spellSlots[] and (for rituals) spellsPrepared[].'),
        spellId: z.string().describe('Spell id to cast.'),
        slotLevel: z.number().int().min(1).max(9).optional().describe('Slot to spend; defaults to the spell\'s own level. Use to upcast.'),
        ritual:  z.boolean().optional().describe('Cast as a ritual — no slot, +10 minutes, requires the Ritual tag and preparation.'),
        alreadyCastLeveledThisTurn: z.boolean().optional().describe('Host-tracked turn flag; the engine enforces one leveled spell per turn when true.'),
        session: SessionField
      },
      handler: async ({ actor, spellId, slotLevel, ritual, alreadyCastLeveledThisTurn, session }) => {
        try {
          const engine = sessions.get(session);
          const spell = engine.spells[spellId];
          if (!spell) return toolResult({ ok: false, reason: `no spell with id '${spellId}'` });
          const args = {};
          if (slotLevel != null) args.slotLevel = slotLevel;
          if (ritual    != null) args.ritual    = ritual;
          if (alreadyCastLeveledThisTurn != null) args.alreadyCastLeveledThisTurn = alreadyCastLeveledThisTurn;
          return toolResult(engine.Spellcasting.castSpell(actor, spell, args));
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'spells_rest',
      description: 'Recover slots. A long rest returns every slot; a short rest returns none to a full caster (that is the long rest\'s job) and the pact slots to a warlock. Returns { slots }.',
      input: {
        slots: z.array(z.object({
          level: z.number().int(), used: z.number().int(), max: z.number().int()
        })).describe('Current slots.'),
        kind:  z.enum(['long', 'short']).default('long').describe('Rest length.'),
        session: SessionField
      },
      handler: async ({ slots, kind, session }) => {
        try {
          const engine = sessions.get(session);
          const fn = kind === 'short' ? engine.Spellcasting.shortRest : engine.Spellcasting.longRest;
          return toolResult({ slots: fn(slots) });
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'spells_cantrip_damage',
      description: 'A cantrip\'s damage spec at a caster level, scaled at the SRD tiers (1st, 5th, 11th, 17th). Returns { spec }.',
      input: {
        spellId:     z.string().describe('Cantrip id.'),
        casterLevel: z.number().int().min(1).max(20).describe('Character level.'),
        session:     SessionField
      },
      handler: async ({ spellId, casterLevel, session }) => {
        try {
          const engine = sessions.get(session);
          const spell = engine.spells[spellId];
          if (!spell) return toolError(new Error(`no spell with id '${spellId}'`));
          if (!spell.damage) return toolResult({ spec: null });
          return toolResult({ spec: engine.Spellcasting.scaledDamageSpec(spell.damage, casterLevel) });
        } catch (err) { return toolError(err); }
      }
    }
  ];
}
