// Guide tools — the lowest-common-denominator route to the guides.
//
// The same texts are registered as MCP prompts and resources (see
// src/skills/guides.js), but plenty of hosts surface neither; every
// host can call a tool. Serving identical content on all three
// surfaces is deliberate — the guides cannot drift apart.

import { z } from 'zod';
import { toolResult, toolError } from '../_result.js';
import { GUIDES } from '../skills/guides.js';

/** Build the guide tool descriptors. Static content; takes nothing. */
export function guideTools() {
  return [
    {
      name: 'guide_list',
      description: 'List the server\'s how-to-play guides (campaign loop, memory discipline, combat flow, session zero, DM style). Read campaign-quickstart before running your first session; the rest as their moment arrives.',
      input: {},
      // No try/catch: static frozen data, no failure mode — a dead
      // catch would just be untestable code.
      handler: async () => toolResult({
        guides: Object.entries(GUIDES).map(([id, g]) => ({
          id, title: g.title, description: g.description
        }))
      })
    },
    {
      name: 'guide_get',
      description: 'Fetch one guide\'s full text by id. These are your operating instructions as DM — follow them rather than improvising the workflow.',
      input: {
        id: z.string().describe('Guide id from guide_list, e.g. "campaign-quickstart".')
      },
      handler: async ({ id }) => {
        try {
          const guide = GUIDES[id];
          if (!guide) {
            throw new Error(`Unknown guide: ${JSON.stringify(id)}. Available: ${Object.keys(GUIDES).join(', ')}.`);
          }
          return toolResult({ id, ...guide });
        } catch (err) { return toolError(err); }
      }
    }
  ];
}
