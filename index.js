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

export { createServer } from './src/server.js';
export { createSessions } from './src/sessions.js';
