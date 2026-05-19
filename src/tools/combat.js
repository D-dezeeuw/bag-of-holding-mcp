// Combat — initiative, attacks, damage, weapon mastery.
//
// Weapon mastery is the SRD 5.2 mechanic that gives each martial
// weapon a passive property (cleave, graze, vex, etc.). The
// engine resolves them via a handler table; a session built with
// `extras.extraMastery` can plug in homebrew handlers. The
// `combat_mastery_properties` tool surfaces which masteries the
// session currently knows about so the AI can describe them
// without guessing.

import { z } from 'zod';
import { toolResult, toolError } from '../_result.js';

const SessionField = z.string().optional().describe('Session id; omit for default singleton.');
const ContextField = z.record(z.unknown()).optional().describe('Free-form tag attached to the rollLog entry.');

export function combatTools(sessions) {
  return [
    {
      name: 'combat_roll_initiative',
      description: 'Roll initiative for an actor with the given DEX score. Returns the total. Logged in the session\'s rollLog.',
      input: {
        dexterity: z.number().int().describe('Raw DEX score (e.g. 16).'),
        session: SessionField,
        context: ContextField
      },
      handler: async ({ dexterity, session, context }) => {
        try {
          const engine = sessions.get(session);
          return toolResult({ value: engine.Combat.rollInitiative({ dexterity }, context) });
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'combat_attack_roll',
      description: 'Resolve a 5e attack roll. Returns { roll, total, ac, hit, critical }. Crits are detected per the session\'s rules (default: nat 20).',
      input: {
        attackBonus: z.number().int().describe('Total attack bonus (proficiency + ability + magic).'),
        ac: z.number().int().describe('Target armour class.'),
        session: SessionField,
        context: ContextField
      },
      handler: async ({ attackBonus, ac, session, context }) => {
        try {
          const engine = sessions.get(session);
          return toolResult(engine.Combat.attackRoll({ attackBonus, ac }, context));
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'combat_damage_roll',
      description: 'Resolve damage. Pass `critical: true` to apply the session\'s crit rule (default: double the dice). Returns { rolls, total }.',
      input: {
        damageDice: z.string().describe('Damage dice spec, e.g. "1d8" or "2d6+1".'),
        damageMod: z.number().int().optional().describe('Flat modifier (e.g. STR mod).'),
        critical: z.boolean().optional().describe('Whether this is a crit.'),
        session: SessionField,
        context: ContextField
      },
      handler: async ({ session, context, ...args }) => {
        try {
          const engine = sessions.get(session);
          return toolResult(engine.Combat.damageRoll(args, context));
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'combat_apply_mastery',
      description: 'Apply a weapon\'s mastery property to a target given an attack result. Returns the engine\'s mastery effect payload (or null if no applicable mastery). Pure dispatch — does not roll dice.',
      input: {
        weapon: z.record(z.unknown()).describe('Weapon record (must include `mastery` field for an effect to fire).'),
        target: z.record(z.unknown()).describe('Target actor.'),
        attackResult: z.record(z.unknown()).describe('Result from combat_attack_roll.'),
        attacker: z.record(z.unknown()).optional().describe('Attacker actor (some masteries depend on attacker state).'),
        session: SessionField
      },
      handler: async ({ weapon, target, attackResult, attacker, session }) => {
        try {
          const engine = sessions.get(session);
          return toolResult(engine.Combat.applyMastery(weapon, target, attackResult, attacker));
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'combat_mastery_properties',
      description: 'List the weapon mastery property names this session understands (default 8 SRD properties, plus any extras from session creation). Use this when you need to validate a weapon record.',
      input: { session: SessionField },
      handler: async ({ session }) => {
        try {
          const engine = sessions.get(session);
          return toolResult({ properties: [...engine.Combat.MASTERY_PROPERTIES] });
        } catch (err) { return toolError(err); }
      }
    }
  ];
}
