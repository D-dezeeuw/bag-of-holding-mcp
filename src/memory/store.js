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
import { rankRecords, fuseRankings } from './search.js';
import {
  createEmbeddingsClient, DEFAULT_EMBEDDINGS_MODEL, DEFAULT_EMBEDDINGS_DIM
} from './embedder.js';
import {
  createQdrantClient, pointId, DEFAULT_QDRANT_URL, DEFAULT_QDRANT_COLLECTION
} from './qdrant.js';

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

/**
 * Resolve the semantic-search configuration, or null when disabled.
 * Semantic memory is opt-in: it turns on when an embeddings
 * endpoint is configured (opts or $BOH_EMBEDDINGS_URL) or when a
 * pre-built embedder is injected (tests, embedders). The docker
 * compose file in the repo root stands up the expected sidecars —
 * Qwen3-Embedding-0.6B behind an OpenAI-compatible endpoint, plus
 * Qdrant for the vectors.
 */
function resolveSemantic(opts) {
  const dimRaw = Number.parseInt(process.env.BOH_EMBEDDINGS_DIM ?? '', 10);
  const embeddings = {
    url: opts.embeddings?.url ?? process.env.BOH_EMBEDDINGS_URL,
    model: opts.embeddings?.model ?? process.env.BOH_EMBEDDINGS_MODEL,
    dim: opts.embeddings?.dim ?? (Number.isInteger(dimRaw) ? dimRaw : undefined),
    apiKey: opts.embeddings?.apiKey ?? process.env.BOH_EMBEDDINGS_API_KEY
  };
  if (!opts.embedder && !embeddings.url) return null;
  return {
    embeddings,
    qdrant: {
      url: opts.qdrant?.url ?? process.env.BOH_QDRANT_URL,
      collection: opts.qdrant?.collection ?? process.env.BOH_QDRANT_COLLECTION,
      apiKey: opts.qdrant?.apiKey ?? process.env.BOH_QDRANT_API_KEY
    }
  };
}

/**
 * What gets embedded for a record: the text plus the entity names.
 * Entities usually appear in well-written text anyway, but records
 * that lean on the entities field alone still deserve semantic
 * recall. Keep this composition stable — stored vectors are only
 * re-embedded when the model or dim changes, not when this does.
 */
function embeddableText(record) {
  const entities = record.entities?.length ? ` | ${record.entities.join(', ')}` : '';
  return `${record.text}${entities}`;
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

  // Semantic layer — lazily initialised on the first hybrid search
  // so a configured-but-down sidecar can never block startup, and
  // reset on failure so a restarted sidecar is picked up on the
  // next search instead of needing a server restart.
  const semanticCfg = resolveSemantic(opts);
  let semanticPromise = null;
  let semanticState = semanticCfg ? 'unloaded' : 'disabled';
  let semanticError = null;
  function getSemantic() {
    semanticPromise ??= (async () => {
      const embedder = opts.embedder ?? createEmbeddingsClient(semanticCfg.embeddings);
      const index = opts.vectorIndex ?? createQdrantClient(semanticCfg.qdrant);
      await index.ensureCollection(embedder.dim);
      return { embedder, index };
    })();
    return semanticPromise;
  }

  /**
   * Is this token allowed to reach storage at all? Always true in open
   * mode. Exposed so a transport can reject an unknown token at the door
   * (the HTTP entrypoint 404s) rather than letting every tool call fail
   * one at a time.
   */
  function isAuthorized(token) {
    return !authRequired || (typeof token === 'string' && tokenHashes.has(sha256(token)));
  }

  function namespaceFor(token) {
    if (!isAuthorized(token)) {
      throw new Error(
        'Invalid or missing memory token: this server runs with a token allowlist. Pass the token you were issued (any opaque string; the server stores only its hash).'
      );
    }
    return typeof token === 'string' && token !== '' ? `t-${sha256(token).slice(0, 16)}` : 'local';
  }

  const campaignDir = (ns, campaign) => path.join(dataDir, ns, campaign);
  const memoryFile = (ns, campaign) => path.join(campaignDir(ns, campaign), 'memory.jsonl');
  const stateDir = (ns, campaign) => path.join(campaignDir(ns, campaign), 'state');
  // Outside `state/` on purpose — see `imageGateLoad` below.
  const imageGateFile = (ns, campaign) => path.join(campaignDir(ns, campaign), 'image-gate.json');

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

  /**
   * Semantic-layer status without touching the sidecars: config
   * plus the state the last search left behind ('disabled' |
   * 'unloaded' | 'ready' | 'failed', with the failure reason).
   */
  function embeddingsInfo() {
    if (!semanticCfg) return { state: 'disabled' };
    return {
      state: semanticState,
      url: semanticCfg.embeddings.url ?? '(injected embedder)',
      model: opts.embedder?.model ?? semanticCfg.embeddings.model ?? DEFAULT_EMBEDDINGS_MODEL,
      dim: opts.embedder?.dim ?? semanticCfg.embeddings.dim ?? DEFAULT_EMBEDDINGS_DIM,
      qdrant: {
        url: semanticCfg.qdrant.url ?? DEFAULT_QDRANT_URL,
        collection: semanticCfg.qdrant.collection ?? DEFAULT_QDRANT_COLLECTION
      },
      ...(semanticError === null ? {} : { lastError: semanticError })
    };
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
    isAuthorized,

    /** Append one memory record; returns it with its assigned id. */
    record(token, campaign, input) {
      const ns = namespaceFor(token);
      assertName('campaign', campaign);
      const { ops } = loadOps(ns, campaign);
      return writeRecord(ns, campaign, input, ops);
    },

    /**
     * Rank the campaign's live records against a query.
     *
     * Lexical BM25 always runs. With the semantic sidecars
     * configured the result is a hybrid: missing vectors are
     * back-filled into Qdrant (so enabling semantics later "just
     * works" on an old campaign), the query is embedded, and the
     * lexical, semantic and importance/recency rankings are fused
     * with reciprocal-rank fusion. Sidecar trouble degrades to the
     * lexical result with `semanticError` set — quality falls back,
     * availability doesn't.
     */
    async search(token, campaign, { query, limit = 8, type, entities } = {}) {
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
      const q = query ?? '';
      const lexRanked = rankRecords(candidates, q);
      const lexicalHits = lexRanked.slice(0, limit).map(({ index, score }) => ({
        ...candidates[index],
        score: Math.round(score * 10000) / 10000
      }));
      const base = { searched: candidates.length, total: all.length };
      if (semanticState === 'disabled' || q.trim() === '' || candidates.length === 0) {
        return { hits: lexicalHits, ...base, retrieval: 'lexical' };
      }

      try {
        const { embedder, index } = await getSemantic();
        const posById = new Map(candidates.map((r, i) => [r.id, i]));
        const idFor = (r) => pointId(ns, campaign, r.id, embedder.model, embedder.dim);

        // Backfill: embed and upsert any candidate Qdrant hasn't
        // seen under this model/dim (deterministic point ids make
        // this an idempotent set-difference, not bookkeeping).
        const existing = await index.existingIds(candidates.map(idFor));
        const missing = candidates.filter((r) => !existing.has(idFor(r)));
        if (missing.length > 0) {
          const vectors = await embedder.embedDocuments(missing.map(embeddableText));
          await index.upsert(missing.map((r, i) => ({
            id: idFor(r),
            vector: vectors[i],
            payload: { ns, campaign, rid: r.id, model: embedder.model }
          })));
        }

        const neighbours = await index.query({
          vector: await embedder.embedQuery(q),
          ns,
          campaign,
          model: embedder.model,
          limit: Math.max(32, limit * 4)
        });
        // Intersect with the live, filter-surviving candidates:
        // Qdrant may still hold vectors for records that were since
        // forgotten or that a type/entity filter excluded.
        const inCandidates = neighbours.filter((n) => posById.has(n.rid));
        // Nearest-neighbour search always returns *something*; a
        // relevance floor keeps orthogonal noise from counting as a
        // match. Relative to the best hit rather than absolute,
        // because absolute cosine ranges drift across embedding
        // models; the positive floor rejects the degenerate case
        // where nothing relates at all.
        const maxScore = Math.max(0, ...inCandidates.map((n) => n.score));
        const semanticIds = inCandidates
          .filter((n) => n.score > 0 && n.score >= maxScore * 0.6)
          .map((n) => n.rid);
        const lexicalIds = lexRanked.map(({ index: i }) => candidates[i].id);

        // The prior (importance, then recency) only re-orders
        // records some ranking actually matched — on its own it
        // must never resurrect a no-match into the results.
        const matched = new Set([...lexicalIds, ...semanticIds]);
        const priorIds = candidates
          .filter((r) => matched.has(r.id))
          .sort((a, b) =>
            (b.importance ?? 3) - (a.importance ?? 3) || posById.get(b.id) - posById.get(a.id))
          .map((r) => r.id);

        const fused = fuseRankings([
          { ids: lexicalIds, weight: 1 },
          { ids: semanticIds, weight: 1 },
          { ids: priorIds, weight: 0.5 }
        ]);
        const byId = new Map(candidates.map((r) => [r.id, r]));
        // Exact fused ties are practically impossible (three
        // weighted rank lists), and if one occurs the stable sort
        // keeps Map insertion order — lexical rank first. Still
        // deterministic, so no explicit tie-break.
        const hits = [...fused.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, limit)
          .map(([id, score]) => ({ ...byId.get(id), score: Math.round(score * 10000) / 10000 }));
        semanticState = 'ready';
        semanticError = null;
        return { hits, ...base, retrieval: 'hybrid' };
      } catch (err) {
        // Reset so a recovered sidecar is retried next search.
        semanticPromise = null;
        semanticState = 'failed';
        semanticError = err.message;
        return { hits: lexicalHits, ...base, retrieval: 'lexical', semanticError: err.message };
      }
    },

    /** Newest-first slice of the log — the "session recap" read. */
    recent(token, campaign, { limit = 10, type } = {}) {
      const ns = namespaceFor(token);
      assertName('campaign', campaign);
      const all = liveRecords(loadOps(ns, campaign).ops);
      const filtered = type !== undefined ? all.filter((r) => r.type === type) : all;
      return { records: filtered.slice(-limit).reverse(), total: all.length };
    },

    /**
     * Tombstone a record. The log stays append-only. Any vector
     * already in Qdrant is left in place on purpose: search
     * intersects neighbours with the live record set, so a stale
     * point can never resurface a forgotten memory, and keeping
     * forget synchronous means it cannot fail on a down sidecar.
     */
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
        embeddings: embeddingsInfo(),
        campaigns: listCampaigns(token)
      };
    },

    embeddingsInfo,

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
    },

    /**
     * Read the campaign's image gate, or null when it has never been set.
     *
     * Deliberately NOT a state-vault key: `state_save` takes an arbitrary key
     * and arbitrary JSON, so a gate living there would be a budget the model
     * could rewrite ("state_save image-gate { budget: 999 }"). It gets its own
     * file beside the vault instead, reachable only through the image tools.
     * A corrupt file reads as null — the gate then heals to "off", which is
     * the safe direction to fail in.
     */
    imageGateLoad(token, campaign) {
      const ns = namespaceFor(token);
      assertName('campaign', campaign);
      const file = imageGateFile(ns, campaign);
      if (!fs.existsSync(file)) return null;
      try {
        return JSON.parse(fs.readFileSync(file, 'utf8'));
      } catch {
        return null;
      }
    },

    /** Write the campaign's image gate. Last write wins; it is a counter, not a log. */
    imageGateSave(token, campaign, gate) {
      const ns = namespaceFor(token);
      assertName('campaign', campaign);
      fs.mkdirSync(campaignDir(ns, campaign), { recursive: true });
      fs.writeFileSync(imageGateFile(ns, campaign), JSON.stringify(gate, null, 2), 'utf8');
      return gate;
    }
  };
}
