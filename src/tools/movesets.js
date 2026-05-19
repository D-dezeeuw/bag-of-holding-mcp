// Movesets — the structured "action chips" the AI can offer a PC
// for a given scene. Pure function over (pc, scene).
//
// The AI calling this tool is the whole point: instead of
// hallucinating a list of available actions ("you could try to
// persuade the guard, attack, or run") the AI asks the engine
// what's actually legal in the current scene mode, and renders
// those. Keeps the rules layer authoritative even for UI shape.

import { z } from 'zod';
import { toolResult, toolError } from '../_result.js';

const SessionField = z.string().optional().describe('Session id; omit for default singleton.');

export function movesetsTools(sessions) {
  return [
    {
      name: 'movesets_legal',
      description: 'Return the list of legal action chips for a (pc, scene) pair. Each chip is { id, label, cost }. Call this before offering the player options so the menu matches the rules.',
      input: {
        pc: z.record(z.unknown()).describe('PC record.'),
        scene: z.record(z.unknown()).describe('Scene record (must include `mode`, e.g. "combat" or "exploration").'),
        session: SessionField
      },
      handler: async ({ pc, scene, session }) => {
        try {
          const engine = sessions.get(session);
          return toolResult({ actions: engine.Movesets.legal({ pc, scene }) });
        } catch (err) { return toolError(err); }
      }
    }
  ];
}
