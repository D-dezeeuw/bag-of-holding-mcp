// MCP server factory.
//
// Builds an `McpServer` from the SDK with every tool descriptor
// registered against a fresh session registry. Lives apart from
// `bin/cli.js` so that:
//   1. In-process embedders can call `createServer()` and wire it
//      to a custom transport (HTTP, in-memory, test harness).
//   2. Tests can instantiate the server without the stdio CLI
//      lifecycle.
//
// The descriptor pattern — each tool file exports a function that
// returns `[{ name, description, input, handler }, ...]` — is what
// makes both of those things straightforward.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createSessions } from './sessions.js';
import { diceTools } from './tools/dice.js';
import { checksTools } from './tools/checks.js';
import { combatTools } from './tools/combat.js';
import { conditionsTools } from './tools/conditions.js';
import { xpTools } from './tools/xp.js';
import { movesetsTools } from './tools/movesets.js';
import { beatsTools } from './tools/beats.js';
import { characterTools } from './tools/character.js';
import { srdTools } from './tools/srd.js';
import { engineTools } from './tools/engine.js';

const SERVER_NAME = 'bag-of-holding';
const SERVER_VERSION = '0.0.1';

/**
 * Build an MCP server with every bag-of-holding tool registered.
 *
 * Returns `{ server, sessions }`. The sessions registry is
 * exposed so a programmatic embedder can mint sessions or read
 * rollLogs without going through MCP tool dispatch. Tests use
 * this too.
 *
 * @param {{ sessions?: ReturnType<typeof createSessions> }} [opts]
 *   Inject a session registry to share state across multiple
 *   servers (rare — usually you want the default fresh one).
 */
export function createServer(opts = {}) {
  const sessions = opts.sessions ?? createSessions();
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  const allTools = [
    ...engineTools(sessions),
    ...diceTools(sessions),
    ...checksTools(sessions),
    ...combatTools(sessions),
    ...conditionsTools(sessions),
    ...xpTools(sessions),
    ...movesetsTools(sessions),
    ...beatsTools(sessions),
    ...characterTools(sessions),
    ...srdTools(sessions)
  ];

  for (const tool of allTools) {
    server.tool(tool.name, tool.description, tool.input, tool.handler);
  }

  return { server, sessions, tools: allTools };
}
