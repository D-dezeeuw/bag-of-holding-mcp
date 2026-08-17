// Types for the read-only operator surface (`@zeeuw/bag-of-holding-mcp/operator`).
//
// Separate from index.d.ts because the point of this entry is that it costs
// nothing: it pulls in node: builtins and a path helper, not the MCP SDK, zod
// or the rules engine. A consumer importing it for a dashboard should not
// acquire a type graph that reaches the whole server.
//
// There are no write methods here, and that is the contract rather than an
// omission — see src/operator.js for why.

/** A campaign directory, as read from disk. */
export interface OperatorCampaign {
  campaign: string;
  /** Live records after folding `forget` tombstones. */
  records: number;
  /** Lines that were not valid JSON and were skipped. */
  corruptLinesSkipped: number;
  /**
   * The memory log or world ledger did not end on a line boundary — almost
   * always because the serving process was appending while this read it.
   * Reported rather than hidden: a count that silently drops the newest line
   * reads as data loss.
   */
  truncatedTail: boolean;
  stateKeys: number;
  ledgerEntries: number;
  observedKeys: number;
  /** Newest mtime across the campaign's files, ms since epoch. */
  lastPlayedAt: number;
  bytes: number;
  world: {
    worldId: string | null;
    setting: string | null;
    digest: string | null;
    start: unknown;
  } | null;
  /** Render budget state, or null when this campaign never enabled images. */
  imageGate: {
    enabled: boolean;
    tier: string | null;
    budget: number | null;
    spent: number;
    renders: number;
  } | null;
}

export interface OperatorNamespace {
  /** `t-<sha256(token)[0:16]>` or `local` — opaque, and one-way by design. */
  ns: string;
  campaigns: number;
  bytes: number;
  lastActivityAt: number;
}

export interface OperatorNamespaceOverview {
  ns: string;
  /** False for a provisioned tenant who has never played — a normal row. */
  exists: boolean;
  bytes: number;
  lastActivityAt: number;
  campaigns: OperatorCampaign[];
}

/** Same shape as the `memory_export` tool, so the files interchange. */
export interface OperatorExport {
  campaign: string;
  records: Array<Record<string, unknown>>;
  corruptLinesSkipped: number;
  truncatedTail: boolean;
  state: Record<string, unknown>;
  world: {
    pin: Record<string, unknown>;
    ledger: Array<Record<string, unknown>>;
    observed: Record<string, unknown>;
  } | null;
}

export interface OperatorStore {
  dataDir: string;
  /** Every namespace directory, busiest first. */
  listNamespaces(): OperatorNamespace[];
  /** One tenant in full. Throws only on a name that is not a valid directory name. */
  namespaceOverview(ns: string): OperatorNamespaceOverview;
  /** Throws when the campaign directory does not exist. */
  exportCampaign(ns: string, campaign: string): OperatorExport;
}

/**
 * Open a read-only view of a data directory.
 * Resolution: `opts.dataDir` → `$BOH_DATA_DIR` → `~/.bag-of-holding`.
 */
export function createOperatorStore(opts?: { dataDir?: string }): OperatorStore;

/** What `deleteCampaign` destroyed, captured before the delete. */
export interface PurgedCampaign {
  ns: string;
  campaign: string;
  records: number;
  stateKeys: number;
  ledgerEntries: number;
  bytes: number;
}

/** What `deleteNamespace` destroyed, captured before the delete. */
export interface PurgedNamespace {
  ns: string;
  campaigns: string[];
  records: number;
  bytes: number;
}

/**
 * The destructive half of the operator surface — a SEPARATE factory, so
 * `OperatorStore` above stays literally write-free and an import of this
 * reads as an admission rather than an accident.
 *
 * Neither method checks whether the target *should* be deleted: that is
 * policy, and policy belongs to the layer that knows what a tenant is.
 * Neither stops the serving process from writing, either — closing that race
 * is the caller's job (the admin panel requires a tenant be revoked first,
 * which shuts the door before anything is removed).
 *
 * Both throw when the target does not exist, and both refuse any name that
 * would resolve outside the data directory.
 */
export interface OperatorPurge {
  dataDir: string;
  deleteCampaign(ns: string, campaign: string): PurgedCampaign;
  deleteNamespace(ns: string): PurgedNamespace;
}

export function createOperatorPurge(opts?: { dataDir?: string }): OperatorPurge;
