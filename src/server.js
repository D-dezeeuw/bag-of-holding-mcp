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

import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { createSessions } from './sessions.js';
import { createMemoryStore } from './memory/store.js';
import { createPlaythroughs } from './playthroughs.js';
import { registerGuides } from './skills/guides.js';
import { createWorlds } from './worlds.js';
import { worldsTools } from './tools/worlds.js';
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
import { campaignTools } from './tools/campaigns.js';
import { worldTools } from './tools/world.js';
import { guideTools } from './tools/guides.js';
import { imageTools } from './tools/images.js';

const SERVER_NAME = 'bag-of-holding';
const SERVER_VERSION = '0.6.0';

/**
 * Build an MCP server with every bag-of-holding tool registered.
 *
 * Returns `{ server, sessions, memory, worlds, playthroughs,
 * tools }`. The registries are exposed so a programmatic embedder
 * can mint sessions, read rollLogs, touch campaign memory, or bind
 * a campaign to a world without going through MCP tool dispatch.
 * Tests use this too.
 *
 * @param {{
 *   sessions?: ReturnType<typeof createSessions>,
 *   memory?: import('../index.js').MemoryStoreOptions,
 *   memoryStore?: ReturnType<typeof createMemoryStore>,
 *   memoryToken?: string,
 *   images?: { env?: Record<string, string|undefined>, now?: () => number, render?: Function }
 * }} [opts]
 *   `sessions` injects a shared session registry (rare — usually
 *   you want the default fresh one). `memory` configures the disk
 *   store and the optional semantic sidecars (embeddings endpoint +
 *   Qdrant); omitted, everything resolves from the environment
 *   (BOH_DATA_DIR, BOH_MEMORY_TOKEN_HASHES, BOH_EMBEDDINGS_*,
 *   BOH_QDRANT_*) with ~/.bag-of-holding as the default root.
 *   `memoryStore` injects a prebuilt store instead — the HTTP
 *   entrypoint builds one per process and shares it across tenants
 *   (isolation is per call, by token), so the Qdrant and embeddings
 *   clients are established once rather than per connection.
 *   `memoryToken` pins the tenant: the `token` parameter is then
 *   removed from every memory/state tool schema and this value is
 *   used instead. That is how the HTTP transport keeps the token —
 *   which lives in the URL path — out of the model's hands.
 *   `images` is the scene-image seam: `env` (defaults to the
 *   process environment) supplies BOH_IMAGE_* — the key that
 *   decides whether this server renders pictures itself or hands
 *   back a grant for the client to render — while `now` and
 *   `render` exist so tests can drive the budget clock and the
 *   provider without either.
 */
export function createServer(opts = {}) {
  const sessions = opts.sessions ?? createSessions();
  const memory = opts.memoryStore ?? createMemoryStore(opts.memory ?? {});
  const worlds = opts.worlds ?? createWorlds({ dir: opts.worldsDir ?? process.env.BOH_WORLDS_DIR ?? null });
  // Playthroughs bind campaigns to worlds THROUGH the memory store, so they
  // are as persistent and as tenant-scoped as the memory log itself.
  const playthroughs = createPlaythroughs(worlds, memory);
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  const allTools = [
    ...worldsTools(worlds, playthroughs, opts.memoryToken),
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
    ...memoryTools(memory, opts.memoryToken),
    ...campaignTools(memory, opts.memoryToken),
    ...imageTools(memory, opts.memoryToken, opts.images ?? {}),
    ...worldTools(),
    ...guideTools()
  ];

  for (const tool of allTools) {
    server.tool(tool.name, tool.description, tool.input, tool.handler);
  }

  registerGuides(server);

  // The same read surface as world:// resources, so an MCP host can browse a
  // mounted world with no tool calls at all. Node ids ride in the URI path
  // (dots are legal there): world://world-1234/node/continent-0.province-1
  const json = (uri, payload) => ({
    contents: [{ uri: uri.href, mimeType: 'application/json', text: JSON.stringify(payload) }],
  });
  server.resource('world-catalog', 'world://catalog', async (uri) =>
    json(uri, { worlds: worlds.list(), dir: worlds.dir, errors: worlds.errors }));
  server.resource('world-node',
    new ResourceTemplate('world://{world}/node/{node}', { list: undefined }),
    async (uri, { world, node }) => {
      const out = worlds.node(world, node);
      if (!out) throw new Error(`unknown node '${node}' in '${world}'`);
      return json(uri, out);
    });
  server.resource('world-lineage',
    new ResourceTemplate('world://{world}/lineage/{node}', { list: undefined }),
    async (uri, { world, node }) => {
      const out = worlds.lineage(world, node);
      if (!out) throw new Error(`unknown node '${node}' in '${world}'`);
      return json(uri, { lineage: out });
    });

  return { server, sessions, memory, worlds, playthroughs, tools: allTools };
}
