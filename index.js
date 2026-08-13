// Public surface for `@zeeuw/bag-of-holding-mcp`.
//
// Two consumption paths:
//
//   1. CLI (most common) — installed via npm and pointed at by
//      Claude Desktop / Cursor / any MCP host's stdio config.
//      Nothing to import; just spawn `bag-of-holding-mcp`.
//
//   2. In-process embedder — when a host wants to wire the same
//      tool surface to a custom transport (HTTP, in-memory, test
//      harness, multi-tenant server) without spawning a child
//      process. Use `createServer()` and connect it yourself.
//
// `createSessions` is re-exported so an embedder can share one
// session registry across multiple server instances (e.g., one
// MCP-over-HTTP endpoint per region, same in-memory game state).
// `createMemoryStore` likewise, so a hosted embedder can point
// several transports at one campaign-memory root (with a token
// allowlist for the closed, hosted-tier mode). The world packs and
// guides are exported for hosts that want to render them in a UI
// without a round-trip through tool dispatch.

export { createServer } from './src/server.js';
export { createSessions } from './src/sessions.js';
export { createHttpHandler, listen, main } from './src/http.js';
export { createMemoryStore, MEMORY_TYPES } from './src/memory/store.js';
export { createEmbeddingsClient } from './src/memory/embedder.js';
export { createQdrantClient } from './src/memory/qdrant.js';
export { GUIDES } from './src/skills/guides.js';
// Two distinct world surfaces, deliberately both exported:
//   `createWorlds` — generated cartridges loaded from BOH_WORLDS_DIR, played
//     as a patch ledger over an immutable base (world_catalog/begin/...).
//   `worlds`/`getWorld` — the hand-authored static packs compiled into this
//     package, read-only reference content (world_list/overview/region/...).
// Named apart (`worldPacks`) at the export boundary because both modules
// wanted the identifier `worlds`.
export { createWorlds } from './src/worlds.js';
// Scene images: the config/tier seams and the renderer. The *gate* — whether a
// picture may be made at all — deliberately lives in @zeeuw/bag-of-holding-client
// (llm/imagegate.js), because the browser host enforces the same budget.
export { resolveImageConfig, tierFor, renderImage, splitDataUri, DEFAULT_IMAGE_MODEL, DEFAULT_IMAGE_BASE_URL } from './src/images.js';
export { worlds as worldPacks, getWorld } from './src/world/index.js';
