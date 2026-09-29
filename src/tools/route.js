// route_request — which tool handles this request? Registered ONLY when the
// optional JEFF decision layer is configured (BOH_JEFF_URL + BOH_JEFF_KEY);
// without it this module adds nothing and the tool list is unchanged.
//
// It asks JEFF one skill_selection choice over this server's own tool
// catalogue (the MCP descriptions, plus the routing descriptions in
// src/jeff.js) and hands back the three likeliest tools. It is advice: the
// host still decides. Only the request text leaves the server, clipped to
// 500 characters. A query with no side effect, so BOH_JEFF_MODE (shadow/on)
// does not apply. It fails open: JEFF down, slow or garbled gives an empty
// candidate list with a `reason`, never an error. See docs/jeff-decisions.md.

import { z } from 'zod';
import { toolResult } from '../_result.js';
import { routeCatalogue, routeRequest, ROUTE_TEXT_MAX_CHARS } from '../jeff.js';

export const ROUTE_TOOL_NAME = 'route_request';

/** Server instructions, sent only when route_request is registered. */
export const ROUTE_INSTRUCTIONS = `When you are unsure which Bag of Holding tool fits what a player or the DM just said (for example "I try to sneak past the guard"), call ${ROUTE_TOOL_NAME} with their words first. It returns the three likeliest tools with probabilities and a one-line hint. It is advice: pick the tool yourself, and an empty candidate list means choose without it.`;

/**
 * @param jeff   the JEFF client, or null (then no tool)
 * @param tools  the server's other tools `[{ name, description }]`, the catalogue routed over
 */
export function routeTools(jeff, tools) {
  if (!jeff) return [];
  const catalogue = routeCatalogue(tools);
  return [
    {
      name: ROUTE_TOOL_NAME,
      description: `Suggest which tool handles a request: give the player's or DM's words, get the three likeliest tools of this server with probabilities and a one-line hint each. Advisory, for when you are unsure which tool fits. Only the request text (first ${ROUTE_TEXT_MAX_CHARS} characters) is sent to the configured JEFF decision service. An empty candidate list comes with a reason; then choose the tool yourself.`,
      input: {
        request: z.string().min(1).describe('What the player or DM said or wants, in their own words, e.g. "I try to pick the lock".'),
      },
      handler: async ({ request }) => {
        try {
          return toolResult(await routeRequest(jeff, catalogue, request));
        } catch {
          return toolResult({ candidates: [], reason: 'Routing failed. Choose the tool yourself.' });
        }
      },
    },
  ];
}
