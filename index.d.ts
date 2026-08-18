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
  /**
   * Path to a tenant registry JSON file (or `$BOH_TENANT_REGISTRY`). A
   * second allowlist source, unioned with `tokenHashes`, re-read when it
   * changes so tenants can be added, retiered, suspended or revoked
   * without a restart. A corrupt file at startup throws.
   */
  registryFile?: string | null;
  /** How stale a registry read may be, in ms. Default 2000. */
  registryTtlMs?: number;
  /** Clock for the registry TTL — tests drive this instead of sleeping. */
  now?: () => number;
  /** Where registry problems are reported. Default `console.error`. */
  warn?: (message: string) => void;
  embeddings?: { url?: string; model?: string; dim?: number; apiKey?: string };
  qdrant?: { url?: string; collection?: string; apiKey?: string };
  /** Pre-built clients — tests and embedders; config is ignored where these are given. */
  embedder?: EmbeddingsClient;
  vectorIndex?: QdrantIndex;
}

/** What the allowlist knows about a token beyond whether it is allowed. */
export interface TenantMeta {
  /** Registry-assigned tier, or null when the tenant came from the env allowlist. */
  tier: string | null;
  status: 'active' | 'suspended';
  /** Reserved for token rotation: an existing namespace this token maps to. */
  ns: string | null;
  source: 'registry' | 'env';
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
  /**
   * Tier / status / provenance for a token, or null when no allowlist
   * source knows it. Unlike `isAuthorized`, this reports suspended tenants
   * rather than hiding them — the door says 404, the operator needs why.
   */
  tenantMeta(token?: string): TenantMeta | null;
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
    state: Record<string, unknown>;
    world: { pin: WorldPin; ledger: Array<Record<string, unknown>>; observed: Record<string, unknown> } | null;
  };
  importAll(token: string | undefined, campaign: string, records: MemoryRecordInput[], extras?: {
    state?: Record<string, unknown> | null;
    world?: { pin: WorldPin; ledger?: Array<Record<string, unknown>>; observed?: Record<string, unknown> } | null;
  }): { imported: number; stateKeys: number; world: boolean; campaign: string };
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
  /** The campaign's world pin (see WorldPin), or null when unbound / corrupt. */
  worldPin(token: string | undefined, campaign: string): WorldPin | null;
  /** Bind a campaign to a world. Throws when a pin file already exists. */
  worldBind(token: string | undefined, campaign: string, pin: WorldPin): WorldPin;
  /** Replace the pin (the upgrade path's writer); appends `audit` to its trail. */
  worldRebind(token: string | undefined, campaign: string, pin: WorldPin, audit?: Record<string, unknown>): WorldPin;
  /** Append validated patches to the campaign's world ledger. */
  worldAppend(token: string | undefined, campaign: string, patches: unknown[]): { appended: number };
  /** Read the world ledger, oldest first; corrupt lines counted, never fatal. */
  worldLedger(token: string | undefined, campaign: string): { patches: Array<Record<string, unknown>>; corruptLinesSkipped: number };
  /** The observation set: entityId → { paths: string[] | '*', turn }. */
  worldObserved(token: string | undefined, campaign: string): Record<string, { paths: string[] | '*'; turn: number }>;
  /** Record observations ({ id, path?, turn? }); '*' marks the whole entity. */
  worldObserve(token: string | undefined, campaign: string, entries: Array<{ id: string; path?: string; turn?: number }>): Record<string, unknown>;
  /** Every campaign in the namespace with a world pin. */
  worldBindings(token: string | undefined): Array<{ campaign: string; pin: WorldPin }>;
  /** The session-start surface: one row per campaign, newest activity first. */
  campaignOverview(token: string | undefined): Array<{
    campaign: string; records: number; stateKeys: number; ledgerLength: number;
    lastPlayedAt: number;
    world: { worldId: string; setting: string | null; digest: string | null; start: string | null } | null;
  }>;
  /** Delete a campaign directory whole. Irreversible; throws on unknown. */
  campaignDelete(token: string | undefined, campaign: string): { deleted: string };
  /**
   * The campaign's scene-image gate (permission + budget), or null when it
   * has never been set or the file is unreadable. Stored beside the state
   * vault rather than inside it, so `state_save` cannot rewrite a budget.
   */
  imageGateLoad(token: string | undefined, campaign: string): ImageGate | null;
  imageGateSave(token: string | undefined, campaign: string, gate: ImageGate): ImageGate;
  /**
   * The tenant's inference budget, or null when nothing has been relayed yet.
   * Per tenant, not per campaign: it meters spend against the operator's
   * provider key, which a per-campaign file would refill on every new campaign.
   */
  relayBudgetLoad(token: string | undefined): RelayBudget | null;
  relayBudgetSave(token: string | undefined, budget: RelayBudget): RelayBudget;
}

/**
 * Persisted scene-image gate. The shape is owned by
 * `@zeeuw/bag-of-holding-client`'s `llm/imagegate.js`, which is also where
 * every transition (enable, spend, refund, window roll) lives; this server
 * only stores it and reads it back.
 */
export interface ImageGate {
  v: number;
  enabled: boolean;
  tier: string;
  budget: number;
  windowMs: number;
  cooldownMs: number;
  spent: number;
  windowStart: number;
  lastRenderAt: number;
  renders: number;
}

/** Image-model configuration, or null when this server holds no key. */
export interface ImageConfig {
  key: string;
  baseUrl: string;
  model: string;
}

/**
 * Read BOH_IMAGE_API_KEY / BOH_IMAGE_URL / BOH_IMAGE_MODEL from an
 * environment. Null means this deployment renders nothing and
 * `image_observe` hands back a grant for the host to redeem instead.
 */
export function resolveImageConfig(env?: Record<string, string | undefined>): ImageConfig | null;

/**
 * Which image tier a caller plays on. Server-resolved (BOH_IMAGE_TIER today,
 * a per-token lookup once tokens name a paid tier) — never model-supplied.
 */
export function tierFor(
  meta: Pick<TenantMeta, 'tier'> | null | undefined,
  env?: Record<string, string | undefined>
): string;

/**
 * Split a `data:<mime>;base64,<body>` URI into the parts an MCP image content
 * block needs. Null for anything else — a provider answering with a plain URL
 * counts as "no image" rather than shipping broken base64 to the host.
 */
export function splitDataUri(uri: unknown): { mimeType: string; data: string } | null;

/** The image model used when BOH_IMAGE_MODEL is unset. */
export const DEFAULT_IMAGE_MODEL: string;
/** The API base used when BOH_IMAGE_URL is unset. */
export const DEFAULT_IMAGE_BASE_URL: string;

// ============================================================
// Inference relay
// ============================================================

/**
 * Persisted per-tenant inference budget. Like `ImageGate`, the shape and every
 * transition are owned by `@zeeuw/bag-of-holding-client` (`llm/relaygate.js`);
 * this server stores it, applies it, and charges it.
 */
export interface RelayBudget {
  v: number;
  tier: string;
  budget: number;
  windowMs: number;
  spent: number;
  windowStart: number;
  calls: number;
  tokens: number;
}

/** Relay configuration, or null when this deployment sells no inference. */
export interface RelayConfig {
  key: string;
  baseUrl: string;
  appTitle: string;
}

/**
 * Read BOH_LLM_API_KEY / BOH_LLM_URL / BOH_LLM_APP_TITLE from an environment.
 * Null means `/v1/status` reports `relayEnabled: false` and the completion
 * endpoint answers 503, so a host asks the player for their own key instead.
 */
export function resolveRelayConfig(env?: Record<string, string | undefined>): RelayConfig | null;

/**
 * Which relay tier a tenant spends on: the registry's tier, else BOH_LLM_TIER,
 * else `free`. Never reads BOH_IMAGE_TIER — pictures and tokens are priced
 * separately on purpose.
 */
export function relayTierFor(
  meta: Pick<TenantMeta, 'tier'> | null | undefined,
  env?: Record<string, string | undefined>
): string;

/** The model map a tier may reach (the client toolkit's free/paid tables). */
export function modelsForTier(tier: string): Record<string, string | null>;

/** Every model id this tier may ask for, including the fallback chains. */
export function allowedModels(tier: string, env?: Record<string, string | undefined>): Set<string>;

/**
 * Decide whether a completion may be relayed. Either a refusal ready to
 * serialize (400 model-not-allowed, 402 budget-exhausted, 400 invalid-request)
 * or the upstream body to send.
 */
export function planCompletion(args: {
  tier: string;
  body: unknown;
  budget: RelayBudget | null;
  env?: Record<string, string | undefined>;
  now?: number;
}): { status: 200; model: string; upstream: Record<string, unknown> }
  | { status: number; body: { error: { message: string; type: string; [k: string]: unknown } } };

/** Render one prompt. Never rejects: failures come back as `{ ok: false, error }`. */
export function renderImage(
  config: ImageConfig | null,
  prompt: string,
  deps?: { generate?: (config: { key: string; baseUrl: string }, opts: { prompt: string; model: string }) => Promise<string | null> }
): Promise<
  | { ok: true; model: string; mimeType: string; data: string; bytes: number }
  | { ok: false; error: string }
>;

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
 * Read-only registry of mounted world cartridges (pre-generated worlds
 * baked by @zeeuw/bag-of-holding-client's scripts/bake-world.js).
 * Cartridges are immutable and this registry holds NO play state —
 * playthroughs live in the memory store's token namespace (see
 * Playthroughs), because a process Map dies with the process, and over
 * the stateless HTTP transport "the process" is one request.
 */
export interface WorldRegistry {
  dir: string | null;
  errors: string[];
  /** One row per world: the client's catalogEntry plus { revisions, latest }. */
  list(): Array<Record<string, unknown>>;
  /** ALWAYS revision 0 — latest is selected explicitly, never implicitly. */
  get(id: string): Record<string, unknown> | null;
  /** The contiguous revision ladder ([0] with no revisions), or null. */
  revisionsOf(worldId: string): number[] | null;
  /** The world's data at a revision (null = latest servable), cached forever. */
  resolve(worldId: string, revision?: number | null): { revision: number; data: Record<string, unknown>; digest: string } | null;
  latest(worldId: string): number | null;
  /**
   * The fold base for one entity: what the world says about it AT a
   * revision (default 0), as cells (client cellsOf). Null for an unknown
   * world or unservable revision; {} for an entity the world has never
   * heard of — which IS its fold base.
   */
  cell(worldId: string, entityId: string, revision?: number): Record<string, unknown> | null;
  powers(worldId: string): {
    factions: Array<Record<string, unknown>>;
    warState: Record<string, unknown> | null;
    npcs: Array<Record<string, unknown>>;
  } | null;
  node(worldId: string, nodeId: string): Record<string, unknown> | null;
  lineage(worldId: string, nodeId: string): Array<Record<string, unknown>> | null;
}

/**
 * Load world cartridges from a directory (default: BOH_WORLDS_DIR).
 * A missing dir is not an error — the registry lists empty and says why.
 */
export function createWorlds(opts?: { dir?: string | null }): WorldRegistry;

// ============================================================
// Playthroughs
// ============================================================

/**
 * A campaign's world binding: pinned at world_begin and stored in the
 * tenant namespace beside the memory log. `upgrades` is the audit trail
 * of explicit re-pins written by world_upgrade.
 */
export interface WorldPin {
  v: number;
  worldId: string;
  /** The revision the campaign is pinned to. Absent on pre-revision pins (read as 0). */
  revision?: number;
  digest: string | null;
  /** The base cartridge's own digest (revision 0), for shelf-drift tripwires. */
  baseDigest?: string | null;
  setting: string | null;
  start: string | null;
  upgrades: Array<Record<string, unknown>>;
}

/**
 * The campaign↔world binding layer. THE CAMPAIGN NAME IS THE PLAYTHROUGH
 * ID: one campaign, one world, one pin, one append-only patch ledger —
 * all persisted through the memory store, so a playthrough survives
 * restarts and (over HTTP) spans requests.
 */
export interface Playthroughs {
  /**
   * Bind a campaign to a world at a revision (null = latest servable).
   * Throws if already bound, the world is unknown, or the revision is
   * unservable. The resolution is frozen into the pin.
   */
  begin(token: string | undefined, campaign: string, worldId: string, opts?: { revision?: number | null }): {
    campaign: string; worldId: string; revision: number; digest: string | null;
    setting: string | null; start: string | null;
  };
  pin(token: string | undefined, campaign: string): WorldPin | null;
  /**
   * Validate and append play patches. Partial acceptance: each patch goes
   * through the client's makePatch + appendPatch against the cartridge
   * cells, and failures land in `rejected` with reasons while the rest of
   * the batch commits.
   */
  commit(token: string | undefined, campaign: string, patches: unknown[]): {
    appended: number;
    rejected: Array<{ index: number; reason: string; conflict?: unknown }>;
    ledgerLength: number;
  };
  /** Fold the campaign's ledger over the pinned cartridge's cells. Null when unbound. */
  replay(token: string | undefined, campaign: string, opts?: { upToTurn?: number | null }): Record<string, unknown> | null;
  /**
   * Move the pin up the revision ladder: forward-only, all-or-nothing,
   * audited on the pin. Conflicts with observed content refuse the whole
   * upgrade ({ ok: false, conflicts }); dryRun reports without moving.
   */
  upgrade(token: string | undefined, campaign: string, toRevision: number, opts?: { dryRun?: boolean }): Record<string, unknown>;
  /**
   * The campaign's world as the table knows it — the payload behind the
   * live atlas views. The pinned revision's geography, folded through the
   * campaign's ledger and narrowed to what this campaign has discovered,
   * then run through the client's playerCut. Player edition only, by
   * design: this is meant to render on a screen the players can see.
   * Null when the campaign has never begun a world; throws when the shelf
   * can no longer resolve the pinned revision.
   */
  atlas(token: string | undefined, campaign: string): {
    campaign: string;
    worldId: string;
    revision: number;
    digest: string | null;
    start: string | null;
    edition: 'player';
    seed: number | null;
    settingId: string | null;
    worldShape: { continents: number };
    geo: { nodes: Record<string, Record<string, unknown>>; edges: Array<Record<string, unknown>> };
    factions: Array<Record<string, unknown>>;
    npcs: Array<Record<string, unknown>>;
    warState: Record<string, unknown> | null;
    lore: Record<string, unknown>;
    counts: { continents: number; provinces: number; links: number; powers: number; wars: number };
  } | null;
  /** Record that the party has seen a node whole (feeds the revision publish gate in scripts/publish-revision.js). */
  observeRead(token: string | undefined, campaign: string, nodeId: string): void;
}

/** Build the playthrough layer over a world registry and the memory store. */
export function createPlaythroughs(worlds: WorldRegistry, store: MemoryStore): Playthroughs;

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
  /**
   * Scene-image seam: `env` supplies BOH_IMAGE_* (defaults to the process
   * environment), while `now` and `render` let tests drive the budget clock
   * and the provider without either.
   */
  images?: {
    env?: Record<string, string | undefined>;
    now?: () => number;
    render?: typeof renderImage;
  };
  worlds?: WorldRegistry;
  worldsDir?: string | null;
}): {
  server: McpServer;
  sessions: SessionRegistry;
  memory: MemoryStore;
  worlds: WorldRegistry;
  playthroughs: Playthroughs;
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
  /**
   * One worlds registry for the whole process (or a directory to build one
   * from). Hoisted here deliberately: without it, every request would
   * re-read and re-mount every cartridge from disk.
   */
  worlds?: WorldRegistry;
  worldsDir?: string | null;
  /**
   * Relay seams. `env` supplies BOH_LLM_* (defaults to the process
   * environment) and is resolved once at construction, while `relayConfig`,
   * `relayFetch` and `now` let tests drive the provider and the budget clock
   * without either. Passing `relayConfig: null` is a deployment that sells no
   * inference.
   */
  env?: Record<string, string | undefined>;
  now?: () => number;
  relayConfig?: RelayConfig | null;
  relayFetch?: typeof fetch;
}

/**
 * Build the request listener for the streamable-HTTP surface:
 * `POST /mcp/<token>` (the token is the tenant) plus an open
 * `GET /health`. With a provider key configured, the same tenant path also
 * serves the OpenAI-compatible relay — `POST /mcp/<token>/v1/chat/completions`,
 * `GET /mcp/<token>/v1/models`, `GET /mcp/<token>/v1/status`. Unknown tokens
 * and unknown paths both 404.
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
