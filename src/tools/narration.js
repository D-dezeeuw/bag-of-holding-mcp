// Narration prompt — the MCP-appropriate slice of the client's prompt
// scaffolding, and deliberately ONLY a slice. In the normal deployment
// the model connected to this server IS the narrator, and it needs a
// style contract (the narration-style guide), not a prompt builder.
// This tool exists for the sidecar-narrator deployment: a host that
// runs mechanics through this server but hands flavor text to a
// cheaper model of its own. It renders the same provider-agnostic
// prompt the client toolkit uses — system contract + the engine's
// numbers verbatim + a cache key — and the HOST carries it to its
// provider. The provider adapters and the narrate() loop stay
// client-side where the transport lives; shipping them here would
// put an outbound text-LLM dependency in a server whose whole point
// is that the connected model does the talking.

import { z } from 'zod';
import { narrationPrompt, PROMPT_KINDS, NARRATION_SCHEMA } from '@zeeuw/bag-of-holding-client';
import { toolResult, toolError } from '../_result.js';

export function narrationTools() {
  return [
    {
      name: 'narration_prompt',
      description: `Render a provider-agnostic narration prompt for a resolved moment — FOR SIDECAR NARRATORS ONLY. If you are the narrator at this table (the normal case), do not call this: narrate directly under the narration-style guide. Kinds: ${PROMPT_KINDS.join(', ')}. Returns { system, user, cacheKey, schema } — the host carries it to its own model and validates the reply against the schema.`,
      input: {
        kind: z.enum(PROMPT_KINDS).describe('The resolution kind being narrated.'),
        payload: z.record(z.unknown()).describe("The engine's numbers for the moment (e.g. { attacker, target, total, ac, damage }). Verbatim facts only — the prompt forbids the model from changing them."),
        tone: z.string().optional().describe("The table's tone tag (grim, wry, heroic…). Part of the cache key."),
      },
      handler: async ({ kind, payload, tone }) => {
        try {
          const prompt = narrationPrompt(kind, payload ?? {}, { tone });
          return toolResult({ ...prompt, schema: NARRATION_SCHEMA });
        } catch (err) { return toolError(err); }
      },
    },
  ];
}
