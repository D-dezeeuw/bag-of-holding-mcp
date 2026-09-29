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
 * @param opts   `session`: the key the outcome of a routing decision is
 *               tracked under (see withRouteOutcomes)
 */
export function routeTools(jeff, tools, opts = {}) {
  if (!jeff) return [];
  const catalogue = routeCatalogue(tools);
  const outcomes = jeff.outcomes ?? null;
  const session = opts.session ?? 'process';
  const onDecision = outcomes ? (id) => outcomes.routed(session, id) : undefined;
  return [
    {
      name: ROUTE_TOOL_NAME,
      description: `Suggest which tool handles a request: give the player's or DM's words, get the three likeliest tools of this server with probabilities and a one-line hint each. Advisory, for when you are unsure which tool fits. Only the request text (first ${ROUTE_TEXT_MAX_CHARS} characters) is sent to the configured JEFF decision service. An empty candidate list comes with a reason; then choose the tool yourself.`,
      input: {
        request: z.string().min(1).describe('What the player or DM said or wants, in their own words, e.g. "I try to pick the lock".'),
      },
      handler: async ({ request }) => {
        try {
          return toolResult(await routeRequest(jeff, catalogue, request, { onDecision }));
        } catch {
          return toolResult({ candidates: [], reason: 'Routing failed. Choose the tool yourself.' });
        }
      },
    },
  ];
}

/**
 * The outcome of a routing decision is the tool the host actually called
 * next. Wraps every tool's handler so a call first tells the outcome
 * reporter which tool ran in this session; the reporter posts it as the
 * label of a route_request answered within the last 120 s, and only when it
 * is one of the routed catalogue's tools. route_request itself is not in the
 * catalogue, so a second route_request consumes the pending decision and
 * posts nothing. The wrapper never awaits the post and never changes a
 * result. Without JEFF, with outcomes off, or without route_request, the
 * tools are returned untouched.
 *
 * `session` is the session key: HTTP has no MCP session (stateless, one
 * server per request), so it is the tenant; stdio is one process.
 *
 * @param {Array<{ name: string, handler: Function }>} tools  every tool, route_request included
 * @param jeff     the JEFF client, or null
 * @param session  the session key
 */
export function withRouteOutcomes(tools, jeff, session) {
  const outcomes = jeff?.outcomes ?? null;
  if (!outcomes || !tools.some((t) => t.name === ROUTE_TOOL_NAME)) return tools;
  const catalogue = new Set(tools.filter((t) => t.name !== ROUTE_TOOL_NAME).map((t) => t.name));
  return tools.map((t) => ({
    ...t,
    handler: (...args) => {
      try { outcomes.toolCalled(session, t.name, catalogue.has(t.name)); } catch { /* never breaks a call */ }
      return t.handler(...args);
    },
  }));
}
