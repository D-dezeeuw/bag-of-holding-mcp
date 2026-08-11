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
//
// Three registries live behind the tools, with different lifetimes:
// engine sessions (in-memory, per game sitting), the memory store
// (on disk, outlives every session — that is its point), and the
// world packs / guides (static frozen data). The campaign guides
// are additionally registered as MCP prompts and resources.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createSessions } from './sessions.js';
import { createMemoryStore } from './memory/store.js';
import { registerGuides } from './skills/guides.js';
import { diceTools } from './tools/dice.js';
import { checksTools } from './tools/checks.js';
import { combatTools } from './tools/combat.js';
import { conditionsTools } from './tools/conditions.js';
import { xpTools } from './tools/xp.js';
import { movesetsTools } from './tools/movesets.js';
import { beatsTools } from './tools/beats.js';
import { characterTools } from './tools/character.js';
import { srdTools } from './tools/srd.js';
import { spellsTools } from './tools/spells.js';
import { monsterTools } from './tools/monsters.js';
import { restTools } from './tools/rest.js';
import { engineTools } from './tools/engine.js';
import { memoryTools } from './tools/memory.js';
import { worldTools } from './tools/world.js';
import { guideTools } from './tools/guides.js';

const SERVER_NAME = 'bag-of-holding';
const SERVER_VERSION = '0.2.0';

/**
 * Build an MCP server with every bag-of-holding tool registered.
 *
 * Returns `{ server, sessions, memory, tools }`. The sessions
 * registry and memory store are exposed so a programmatic embedder
 * can mint sessions, read rollLogs, or touch campaign memory
 * without going through MCP tool dispatch. Tests use this too.
 *
 * @param {{
 *   sessions?: ReturnType<typeof createSessions>,
 *   memory?: { dataDir?: string, tokenHashes?: string[] }
 * }} [opts]
 *   `sessions` injects a shared session registry (rare — usually
 *   you want the default fresh one). `memory` configures the disk
 *   store; omitted, it resolves via $BOH_DATA_DIR /
 *   $BOH_MEMORY_TOKEN_HASHES and finally ~/.bag-of-holding.
 */
export function createServer(opts = {}) {
  const sessions = opts.sessions ?? createSessions();
  const memory = createMemoryStore(opts.memory ?? {});
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
    ...srdTools(sessions),
    ...spellsTools(sessions),
    ...monsterTools(sessions),
    ...restTools(sessions),
    ...memoryTools(memory),
    ...worldTools(),
    ...guideTools()
  ];

  for (const tool of allTools) {
    server.tool(tool.name, tool.description, tool.input, tool.handler);
  }

  registerGuides(server);

  return { server, sessions, memory, tools: allTools };
}
