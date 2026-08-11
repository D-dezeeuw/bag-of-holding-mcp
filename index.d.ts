// Type definitions for @zeeuw/bag-of-holding-mcp.
//
// Hand-maintained alongside the public JS surface. The matching
// `npm run typecheck` (tsc --noEmit) is the drift gate: when you
// add or change an export in index.js, src/server.js, src/
// sessions.js, src/memory/, src/world/ or src/skills/, update this
// file in the same commit.

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
// Campaign memory & state vault
// ============================================================

/** Record kinds accepted by the memory log. */
export type MemoryType =
  | 'event' | 'npc' | 'place' | 'item' | 'quest' | 'faction'
  | 'lore' | 'session-summary' | 'note';

/** The accepted record kinds, in canonical order. */
export const MEMORY_TYPES: readonly MemoryType[];

/** What goes into `record`/`importAll`. */
export interface MemoryRecordInput {
  type: MemoryType;
  text: string;
  entities?: string[];
  tags?: string[];
  /** 1 (trivia) … 5 (campaign-defining). Default 3 at search time. */
  importance?: number;
  /** Preserved on import; assigned on fresh records. */
  ts?: number;
}

/** A stored record as returned by the read surfaces. */
export interface MemoryRecord extends MemoryRecordInput {
  id: string;
  ts: number;
}

export interface MemorySearchResult {
  hits: Array<MemoryRecord & { score: number }>;
  /** Records that survived the type/entities filters. */
  searched: number;
  /** Live records in the campaign. */
  total: number;
}

/**
 * Configuration for the disk store. Omitted fields resolve from
 * the environment: `$BOH_DATA_DIR` (default `~/.bag-of-holding`)
 * and `$BOH_MEMORY_TOKEN_HASHES` (comma-separated SHA-256 hex —
 * when non-empty the store runs closed and only listed tokens are
 * accepted; that is the hosted-tier mode).
 */
export interface MemoryStoreOptions {
  dataDir?: string;
  tokenHashes?: string[];
}

/**
 * Namespaced campaign persistence: an append-only JSONL memory log
 * plus JSON state checkpoints, per campaign, per token namespace.
 * Tokens are opaque strings, never stored — only hashed.
 */
export interface MemoryStore {
  dataDir: string;
  authRequired: boolean;
  record(token: string | undefined, campaign: string, input: MemoryRecordInput): MemoryRecord;
  search(
    token: string | undefined,
    campaign: string,
    opts?: { query?: string; limit?: number; type?: MemoryType; entities?: string[] }
  ): MemorySearchResult;
  recent(
    token: string | undefined,
    campaign: string,
    opts?: { limit?: number; type?: MemoryType }
  ): { records: MemoryRecord[]; total: number };
  forget(token: string | undefined, campaign: string, id: string): { forgotten: string };
  exportAll(token: string | undefined, campaign: string): {
    campaign: string; records: MemoryRecord[]; corruptLinesSkipped: number;
  };
  importAll(token: string | undefined, campaign: string, records: MemoryRecordInput[]): {
    imported: number; campaign: string;
  };
  campaigns(token?: string): Array<{ campaign: string; records: number; stateKeys: number }>;
  info(token?: string): {
    namespace: string; dataDir: string; authRequired: boolean;
    campaigns: Array<{ campaign: string; records: number; stateKeys: number }>;
  };
  stateSave(token: string | undefined, campaign: string, key: string, data: unknown): { key: string; bytes: number };
  stateLoad(token: string | undefined, campaign: string, key: string): { key: string; data: unknown };
  stateList(token: string | undefined, campaign: string): {
    keys: Array<{ key: string; bytes: number; savedAt: number }>;
  };
  stateDelete(token: string | undefined, campaign: string, key: string): { deleted: string };
}

/** Create a memory store rooted at a data directory. */
export function createMemoryStore(opts?: MemoryStoreOptions): MemoryStore;

// ============================================================
// World packs
// ============================================================

/**
 * A pre-generated setting. The concrete fields beyond these stable
 * ones (regions, factions, npcs, secrets, …) are content shapes
 * owned by each pack; consult a pack module or the world_* tool
 * outputs for the full structure.
 */
export interface WorldPack {
  id: string;
  name: string;
  setting: string;
  tagline: string;
  levelBand: string;
  pitch: string;
  regions: Record<string, Record<string, unknown>>;
  factions: Record<string, Record<string, unknown>>;
  npcs: Record<string, Record<string, unknown>>;
  secrets: Array<Record<string, unknown>>;
  [key: string]: unknown;
}

/** Every bundled pack, keyed by id, deep-frozen. */
export const worlds: Readonly<Record<string, WorldPack>>;

/** Look up a pack by id; throws (naming the available ids) on a miss. */
export function getWorld(id: string): WorldPack;

// ============================================================
// Guides
// ============================================================

export interface Guide {
  title: string;
  description: string;
  /** Markdown body. */
  text: string;
}

/** The how-to-play guides, keyed by id, frozen. */
export const GUIDES: Readonly<Record<string, Guide>>;

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
 * Build an MCP server with every bag-of-holding tool registered,
 * plus the campaign guides as MCP prompts and resources.
 * The returned `server` is unstarted — call `server.connect(transport)`
 * to attach it (stdio, HTTP, in-memory, …).
 */
export function createServer(opts?: {
  sessions?: SessionRegistry;
  memory?: MemoryStoreOptions;
}): {
  server: McpServer;
  sessions: SessionRegistry;
  memory: MemoryStore;
  tools: ToolDescriptor[];
};
