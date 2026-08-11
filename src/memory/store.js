// Campaign memory & state vault — the persistence half of the server.
//
// The engine's boundary doc says the host owns persistence; until
// now "the host" meant the model's context window, which is not
// persistence. This module gives the MCP layer a disk: an
// append-only JSONL log per campaign for narrative memory, plus a
// directory of JSON snapshots ("state vault") for mechanical state
// like party records and `Session.serialize()` payloads.
//
// Trust model: tokens are opaque strings the server NEVER stores —
// a token is hashed and the hash prefix becomes the storage
// namespace. With a token-hash allowlist configured (env or opts)
// the store runs closed (hosted-tier mode); without one it runs
// open and tokens merely namespace. Private keys are not tokens;
// `openssl rand -base64 32` is all a token needs to be.
//
// Writes are synchronous on purpose: MCP tool calls arrive one at a
// time at human cadence, files are small, and sync appends keep the
// store trivially correct across concurrent server processes
// sharing a data dir (single-line appends, no read-modify-write).

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { rankRecords } from './search.js';

/**
 * Record types the memory log accepts. An enum (rather than
 * free-form strings) so `memory_recent({ type })` filters stay
 * useful — twenty spellings of "npc" would make the log unqueryable.
 */
export const MEMORY_TYPES = Object.freeze([
  'event', 'npc', 'place', 'item', 'quest', 'faction', 'lore',
  'session-summary', 'note'
]);

// Campaign names and state keys become file-system paths, so the
// grammar is strict: alphanumeric start, then [A-Za-z0-9_-], max 64.
// This is the traversal guard — everything else about a name is the
// host's business.
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

function parseEnvHashes(raw) {
  return (raw ?? '').split(',').map((h) => h.trim()).filter(Boolean);
}

function assertName(kind, value) {
  if (typeof value !== 'string' || !NAME_RE.test(value)) {
    throw new Error(
      `Invalid ${kind}: ${JSON.stringify(value)}. Use 1-64 characters of A-Za-z0-9_- starting with a letter or digit, e.g. "curse-of-the-fen".`
    );
  }
}

function assertRecordInput({ type, text, entities, tags, importance }) {
  if (!MEMORY_TYPES.includes(type)) {
    throw new Error(`Invalid memory type: ${JSON.stringify(type)}. One of: ${MEMORY_TYPES.join(', ')}.`);
  }
  if (typeof text !== 'string' || text.trim() === '') {
    throw new Error('Memory text must be a non-empty string.');
  }
  for (const [field, value] of [['entities', entities], ['tags', tags]]) {
    if (value !== undefined && (!Array.isArray(value) || value.some((v) => typeof v !== 'string'))) {
      throw new Error(`Memory ${field} must be an array of strings.`);
    }
  }
  if (importance !== undefined && (!Number.isInteger(importance) || importance < 1 || importance > 5)) {
    throw new Error('Memory importance must be an integer from 1 (trivia) to 5 (campaign-defining).');
  }
}

/**
 * Create a memory store rooted at a data directory.
 *
 * Resolution order for the root: `opts.dataDir` → `$BOH_DATA_DIR` →
 * `~/.bag-of-holding`. Nothing touches the disk until the first
 * write — merely starting the server never creates directories in a
 * user's home.
 *
 * `opts.tokenHashes` (or `$BOH_MEMORY_TOKEN_HASHES`, comma-separated
 * SHA-256 hex) switches the store to closed mode: only tokens whose
 * hash is listed are accepted. This is the whole hosted-tier auth
 * story — a billing site mints random tokens and feeds hashes here.
 */
export function createMemoryStore(opts = {}) {
  const dataDir = opts.dataDir
    ?? process.env.BOH_DATA_DIR
    ?? path.join(os.homedir(), '.bag-of-holding');
  const tokenHashes = new Set(
    (opts.tokenHashes ?? parseEnvHashes(process.env.BOH_MEMORY_TOKEN_HASHES))
      .map((h) => h.toLowerCase())
  );
  const authRequired = tokenHashes.size > 0;

  function namespaceFor(token) {
    if (authRequired && (typeof token !== 'string' || !tokenHashes.has(sha256(token)))) {
      throw new Error(
        'Invalid or missing memory token: this server runs with a token allowlist. Pass the token you were issued (any opaque string; the server stores only its hash).'
      );
    }
    return typeof token === 'string' && token !== '' ? `t-${sha256(token).slice(0, 16)}` : 'local';
  }

  const campaignDir = (ns, campaign) => path.join(dataDir, ns, campaign);
  const memoryFile = (ns, campaign) => path.join(campaignDir(ns, campaign), 'memory.jsonl');
  const stateDir = (ns, campaign) => path.join(campaignDir(ns, campaign), 'state');

  /**
   * Read a campaign's op log. Corrupt lines (a torn write, a hand
   * edit) are counted and skipped, never fatal — losing one memory
   * beats refusing to load a campaign.
   */
  function loadOps(ns, campaign) {
    const file = memoryFile(ns, campaign);
    if (!fs.existsSync(file)) return { ops: [], corrupt: 0 };
    const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim() !== '');
    const ops = [];
    let corrupt = 0;
    for (const line of lines) {
      try {
        ops.push(JSON.parse(line));
      } catch {
        corrupt += 1;
      }
    }
    return { ops, corrupt };
  }

  /**
   * Fold the op log into the live record set (insertion-ordered,
   * oldest first). `forget` ops tombstone earlier `record` ops;
   * unknown ops are ignored so an older server can read a log a
   * newer one wrote.
   */
  function liveRecords(ops) {
    const live = new Map();
    for (const entry of ops) {
      if (entry.op === 'record') {
        const { op, ...rec } = entry;
        live.set(rec.id, rec);
      } else if (entry.op === 'forget') {
        live.delete(entry.id);
      }
    }
    return [...live.values()];
  }

  function appendOp(ns, campaign, entry) {
    fs.mkdirSync(campaignDir(ns, campaign), { recursive: true });
    fs.appendFileSync(memoryFile(ns, campaign), `${JSON.stringify(entry)}\n`, 'utf8');
  }

  function writeRecord(ns, campaign, input, ops) {
    assertRecordInput(input);
    const entry = {
      op: 'record',
      id: `m-${ops.length + 1}`,
      ts: typeof input.ts === 'number' ? input.ts : Date.now(),
      type: input.type,
      text: input.text
    };
    if (input.entities?.length) entry.entities = input.entities;
    if (input.tags?.length) entry.tags = input.tags;
    if (input.importance !== undefined) entry.importance = input.importance;
    appendOp(ns, campaign, entry);
    const { op, ...rec } = entry;
    return rec;
  }

  /** All campaigns in the token's namespace, with sizes. */
  function listCampaigns(token) {
    const ns = namespaceFor(token);
    const root = path.join(dataDir, ns);
    if (!fs.existsSync(root)) return [];
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => {
        const live = liveRecords(loadOps(ns, d.name).ops);
        let stateKeys = 0;
        const sd = stateDir(ns, d.name);
        if (fs.existsSync(sd)) {
          stateKeys = fs.readdirSync(sd).filter((f) => f.endsWith('.json')).length;
        }
        return { campaign: d.name, records: live.length, stateKeys };
      });
  }

  return {
    dataDir,
    authRequired,

    /** Append one memory record; returns it with its assigned id. */
    record(token, campaign, input) {
      const ns = namespaceFor(token);
      assertName('campaign', campaign);
      const { ops } = loadOps(ns, campaign);
      return writeRecord(ns, campaign, input, ops);
    },

    /** Rank the campaign's live records against a query. */
    search(token, campaign, { query, limit = 8, type, entities } = {}) {
      const ns = namespaceFor(token);
      assertName('campaign', campaign);
      const all = liveRecords(loadOps(ns, campaign).ops);
      let candidates = all;
      if (type !== undefined) candidates = candidates.filter((r) => r.type === type);
      if (entities?.length) {
        const wanted = entities.map((e) => e.toLowerCase());
        candidates = candidates.filter((r) =>
          (r.entities ?? []).some((e) => wanted.includes(e.toLowerCase()))
        );
      }
      const hits = rankRecords(candidates, query ?? '')
        .slice(0, limit)
        .map(({ index, score }) => ({
          ...candidates[index],
          score: Math.round(score * 10000) / 10000
        }));
      return { hits, searched: candidates.length, total: all.length };
    },

    /** Newest-first slice of the log — the "session recap" read. */
    recent(token, campaign, { limit = 10, type } = {}) {
      const ns = namespaceFor(token);
      assertName('campaign', campaign);
      const all = liveRecords(loadOps(ns, campaign).ops);
      const filtered = type !== undefined ? all.filter((r) => r.type === type) : all;
      return { records: filtered.slice(-limit).reverse(), total: all.length };
    },

    /** Tombstone a record. The log stays append-only. */
    forget(token, campaign, id) {
      const ns = namespaceFor(token);
      assertName('campaign', campaign);
      const { ops } = loadOps(ns, campaign);
      const live = new Map(liveRecords(ops).map((r) => [r.id, r]));
      if (!live.has(id)) {
        throw new Error(`Unknown or already-forgotten memory id: ${id}`);
      }
      appendOp(ns, campaign, { op: 'forget', id, ts: Date.now() });
      return { forgotten: id };
    },

    /** Full live-record dump — the backup / migration format. */
    exportAll(token, campaign) {
      const ns = namespaceFor(token);
      assertName('campaign', campaign);
      const { ops, corrupt } = loadOps(ns, campaign);
      return { campaign, records: liveRecords(ops), corruptLinesSkipped: corrupt };
    },

    /**
     * Re-record an exported dump (fresh ids, original timestamps
     * kept). Import into an *empty* campaign to get a faithful
     * restore; importing into a live one appends.
     */
    importAll(token, campaign, records) {
      const ns = namespaceFor(token);
      assertName('campaign', campaign);
      if (!Array.isArray(records)) {
        throw new Error('Import expects an array of records (the memory_export shape).');
      }
      for (const rec of records) assertRecordInput(rec);
      let { ops } = loadOps(ns, campaign);
      for (const rec of records) {
        writeRecord(ns, campaign, rec, ops);
        ops = [...ops, rec];
      }
      return { imported: records.length, campaign };
    },

    campaigns: listCampaigns,

    /** One-call orientation: where data lives, auth mode, campaigns. */
    info(token) {
      return {
        namespace: namespaceFor(token),
        dataDir,
        authRequired,
        campaigns: listCampaigns(token)
      };
    },

    /**
     * Save an arbitrary JSON snapshot (party records, a
     * `Session.serialize()` payload, an initiative order). Last
     * write wins per key — snapshots are checkpoints, not a log.
     */
    stateSave(token, campaign, key, data) {
      const ns = namespaceFor(token);
      assertName('campaign', campaign);
      assertName('state key', key);
      const json = JSON.stringify(data, null, 2);
      if (json === undefined) {
        throw new Error('State data must be JSON-serialisable (undefined is not).');
      }
      fs.mkdirSync(stateDir(ns, campaign), { recursive: true });
      fs.writeFileSync(path.join(stateDir(ns, campaign), `${key}.json`), json, 'utf8');
      return { key, bytes: Buffer.byteLength(json, 'utf8') };
    },

    stateLoad(token, campaign, key) {
      const ns = namespaceFor(token);
      assertName('campaign', campaign);
      assertName('state key', key);
      const file = path.join(stateDir(ns, campaign), `${key}.json`);
      if (!fs.existsSync(file)) {
        throw new Error(`No saved state "${key}" in campaign "${campaign}". state_list shows what exists.`);
      }
      return { key, data: JSON.parse(fs.readFileSync(file, 'utf8')) };
    },

    stateList(token, campaign) {
      const ns = namespaceFor(token);
      assertName('campaign', campaign);
      const dir = stateDir(ns, campaign);
      if (!fs.existsSync(dir)) return { keys: [] };
      const keys = fs.readdirSync(dir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => {
          const stat = fs.statSync(path.join(dir, f));
          return { key: f.slice(0, -'.json'.length), bytes: stat.size, savedAt: Math.round(stat.mtimeMs) };
        });
      return { keys };
    },

    stateDelete(token, campaign, key) {
      const ns = namespaceFor(token);
      assertName('campaign', campaign);
      assertName('state key', key);
      const file = path.join(stateDir(ns, campaign), `${key}.json`);
      if (!fs.existsSync(file)) {
        throw new Error(`No saved state "${key}" in campaign "${campaign}".`);
      }
      fs.unlinkSync(file);
      return { deleted: key };
    }
  };
}
