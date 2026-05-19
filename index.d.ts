// Type definitions for @zeeuw/bag-of-holding-mcp.
//
// Hand-maintained alongside the public JS surface. The matching
// `npm run typecheck` (tsc --noEmit) is the drift gate: when you
// add or change an export in index.js, src/server.js, or src/
// sessions.js, update this file in the same commit.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

// ============================================================
// Sessions
// ============================================================

/**
 * Metadata snapshot for a session — what `engine_list_sessions`
 * returns, also what `createSessions().list()` returns to
 * in-process embedders.
 */
export interface SessionMetadata {
  id: string;
  seed: number | null;
  rollLogCap?: number | null;
  createdAt: number;
}

/**
 * Options when minting a new session.
 *
 * `extras` is forwarded verbatim to the engine's `createEngine`,
 * so it accepts everything that `createEngine` does (extraSpecies,
 * extraClasses, extraConditions, extraMastery, onRoll, rules, …).
 * We don't tighten the type here because that surface is the
 * engine's to own — duplicating it would invite drift.
 */
export interface CreateSessionOptions {
  id?: string;
  seed?: number;
  rollLogCap?: number;
  extras?: Record<string, unknown>;
}

/**
 * The session registry: lookup, create, destroy, list, rollLog.
 * Each engine instance is held in-memory; nothing is persisted.
 */
export interface SessionRegistry {
  /** Look up an engine (returns the default if id is empty). Throws on unknown explicit id. */
  get(id?: string): unknown;
  /** Mint a new session; returns its id and the seed it was bound to (or null). */
  create(opts?: CreateSessionOptions): { id: string; seed: number | null };
  /** Free a session. The "default" session cannot be destroyed. */
  destroy(id: string): { destroyed: string };
  /** Snapshot of all sessions (metadata only). */
  list(): SessionMetadata[];
  /** Defensive copy of a session's rollLog. */
  rollLog(id?: string): Array<Record<string, unknown>>;
}

/** Build a fresh session registry plus its default engine. */
export function createSessions(): SessionRegistry;

// ============================================================
// Server
// ============================================================

/**
 * Descriptor for a single MCP tool. Each tools/*.js module
 * returns an array of these; `createServer` iterates and
 * registers them.
 */
export interface ToolDescriptor {
  name: string;
  description: string;
  input: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

/**
 * Build an MCP server with every bag-of-holding tool registered.
 * The returned `server` is unstarted — call `server.connect(transport)`
 * to attach it (stdio, HTTP, in-memory, …).
 */
export function createServer(opts?: { sessions?: SessionRegistry }): {
  server: McpServer;
  sessions: SessionRegistry;
  tools: ToolDescriptor[];
};
