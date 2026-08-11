// Type definitions for @zeeuw/bag-of-holding-mcp.
//
// Hand-maintained alongside the public JS surface. The matching
// `npm run typecheck` (tsc --noEmit) is the drift gate: when you
// add or change an export in index.js, src/server.js, src/
// sessions.js, src/memory/, src/world/ or src/skills/, update this
// file in the same commit.

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { IncomingMessage, Server as HttpServer, ServerResponse } from 'node:http';

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
  /** Which retrieval actually ran for this call. */
  retrieval: 'lexical' | 'hybrid';
  /** Set when the semantic sidecars were configured but failed — search fell back to lexical. */
  semanticError?: string;
}

/**
 * Client for an OpenAI-compatible embeddings endpoint (TEI, Ollama,
 * vLLM, …). Vectors come back Matryoshka-truncated to `dim` and
 * L2-normalised.
 */
export interface EmbeddingsClient {
  model: string;
  dim: number;
  embedDocuments(texts: string[]): Promise<Float32Array[]>;
  embedQuery(text: string): Promise<Float32Array>;
}

export function createEmbeddingsClient(opts: {
  url: string;
  model?: string;
  dim?: number;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}): EmbeddingsClient;

/**
 * Qdrant REST client bound to one collection. Multi-tenant by
 * payload: every point carries the token-derived namespace and
 * every query filters on it server-side.
 */
export interface QdrantIndex {
  collection: string;
  ensureCollection(dim: number): Promise<{ created: boolean }>;
  existingIds(ids: string[]): Promise<Set<string>>;
  upsert(points: Array<{ id: string; vector: ArrayLike<number>; payload: Record<string, unknown> }>): Promise<{ upserted: number }>;
  query(opts: {
    vector: ArrayLike<number>; ns: string; campaign: string; model: string; limit: number;
  }): Promise<Array<{ rid: string; score: number }>>;
}

export function createQdrantClient(opts?: {
  url?: string;
  collection?: string;
  apiKey?: string;
  fetchImpl?: typeof fetch;
}): QdrantIndex;

/** Semantic-layer status as reported by `memory_status`. */
export interface EmbeddingsInfo {
  state: 'disabled' | 'unloaded' | 'ready' | 'failed';
  url?: string;
  model?: string;
  dim?: number;
  qdrant?: { url: string; collection: string };
  lastError?: string;
}

/**
 * Configuration for the disk store. Omitted fields resolve from
 * the environment: `$BOH_DATA_DIR` (default `~/.bag-of-holding`),
 * `$BOH_MEMORY_TOKEN_HASHES` (comma-separated SHA-256 hex — when
 * non-empty the store runs closed and only listed tokens are
 * accepted; that is the hosted-tier mode), and the semantic
 * sidecars: `$BOH_EMBEDDINGS_URL` / `_MODEL` / `_DIM` / `_API_KEY`
 * plus `$BOH_QDRANT_URL` / `_COLLECTION` / `_API_KEY`. Semantic
 * search is enabled exactly when an embeddings url (or an injected
 * embedder) is present; without it, search is lexical BM25.
 */
export interface MemoryStoreOptions {
  dataDir?: string;
  tokenHashes?: string[];
  embeddings?: { url?: string; model?: string; dim?: number; apiKey?: string };
  qdrant?: { url?: string; collection?: string; apiKey?: string };
  /** Pre-built clients — tests and embedders; config is ignored where these are given. */
  embedder?: EmbeddingsClient;
  vectorIndex?: QdrantIndex;
}

/**
 * Namespaced campaign persistence: an append-only JSONL memory log
 * plus JSON state checkpoints, per campaign, per token namespace.
 * Tokens are opaque strings, never stored — only hashed.
 */
export interface MemoryStore {
  dataDir: string;
  authRequired: boolean;
  /**
   * Whether this token may reach storage at all (always true in open
   * mode). Lets a transport reject at the door — the HTTP surface 404s —
   * instead of failing every tool call one at a time.
   */
  isAuthorized(token?: string): boolean;
  record(token: string | undefined, campaign: string, input: MemoryRecordInput): MemoryRecord;
  search(
    token: string | undefined,
    campaign: string,
    opts?: { query?: string; limit?: number; type?: MemoryType; entities?: string[] }
  ): Promise<MemorySearchResult>;
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
    embeddings: EmbeddingsInfo;
    campaigns: Array<{ campaign: string; records: number; stateKeys: number }>;
  };
  embeddingsInfo(): EmbeddingsInfo;
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
 * Registry of mounted world cartridges (pre-generated worlds baked by
 * @zeeuw/bag-of-holding-client's scripts/bake-world.js) plus the
 * world-sessions running over them. Cartridges are immutable; a session is
 * an ordered patch ledger over one, and replay folds that ledger back over
 * the same base.
 */
export interface WorldRegistry {
  dir: string | null;
  errors: string[];
  list(): Array<Record<string, unknown>>;
  get(id: string): Record<string, unknown> | null;
  begin(worldId: string): { session: string; worldId: string; digest: string | null; start: string | null } | null;
  session(id: string): { worldId: string; ledger: unknown[] } | null;
  node(worldId: string, nodeId: string): Record<string, unknown> | null;
  lineage(worldId: string, nodeId: string): Array<Record<string, unknown>> | null;
  commit(sessionId: string, patches: unknown[]): { session: string; ledgerLength: number } | null;
  replay(sessionId: string, opts?: { upToTurn?: number | null }): Record<string, unknown> | null;
}

/**
 * Load world cartridges from a directory (default: BOH_WORLDS_DIR).
 * A missing dir is not an error — the registry lists empty and says why.
 */
export function createWorlds(opts?: { dir?: string | null }): WorldRegistry;

/**
 * Build an MCP server with every bag-of-holding tool registered,
 * plus the campaign guides as MCP prompts and resources and the
 * world:// cartridge resources.
 * The returned `server` is unstarted — call `server.connect(transport)`
 * to attach it (stdio, HTTP, in-memory, …).
 */
export function createServer(opts?: {
  sessions?: SessionRegistry;
  memory?: MemoryStoreOptions;
  /** Prebuilt store, shared across tenants by the HTTP entrypoint. */
  memoryStore?: MemoryStore;
  /**
   * Pin the tenant. The `token` parameter is then removed from every
   * memory/state tool schema and this value used instead — how the HTTP
   * transport keeps the URL-path token out of the model's hands.
   */
  memoryToken?: string;
  worlds?: WorldRegistry;
  worldsDir?: string | null;
}): {
  server: McpServer;
  sessions: SessionRegistry;
  memory: MemoryStore;
  worlds: WorldRegistry;
  tools: ToolDescriptor[];
};

// ============================================================
// HTTP transport
// ============================================================

/**
 * Options for the HTTP surface. Either configure the store inline
 * (`memory`) or hand over a prebuilt one (`memoryStore`); the
 * container passes neither and lets the environment decide.
 */
export interface HttpOptions {
  memory?: MemoryStoreOptions;
  memoryStore?: MemoryStore;
}

/**
 * Build the request listener for the streamable-HTTP surface:
 * `POST /mcp/<token>` (the token is the tenant) plus an open
 * `GET /health`. Unknown tokens and unknown paths both 404.
 */
export function createHttpHandler(opts?: HttpOptions): {
  store: MemoryStore;
  handler: (req: IncomingMessage, res: ServerResponse) => void;
};

/**
 * Start an HTTP server on `port`. Rejects unless a token allowlist
 * is configured — an open endpoint would serve every campaign to
 * anyone who found the URL.
 */
export function listen(opts?: HttpOptions & { port?: number; host?: string }): Promise<HttpServer>;

/**
 * The container entrypoint's boot sequence. Returns a process exit
 * code (0 healthy, 2 fail-closed) rather than exiting, so bin/http.js
 * stays branchless and this stays testable.
 */
export function main(opts?: HttpOptions & {
  env?: NodeJS.ProcessEnv;
  out?: Pick<Console, 'log' | 'error'>;
  host?: string;
}): Promise<{ code: number; server: HttpServer | null }>;
