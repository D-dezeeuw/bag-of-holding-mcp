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
// time at human cadence and files are small. Honest limit: this does
// NOT make the store safe across concurrent server processes sharing
// a data dir — memory-record ids are minted from ops.length, a
// read-modify-write, so two processes appending to the same campaign
// can mint colliding ids. One serving process per data dir (what the
// docker deployment does) is the supported shape; cross-process
// id minting is a compaction-era fix.

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
  // The world playthrough trio, also outside `state/` (see the world methods).
  const worldPinFile = (ns, campaign) => path.join(campaignDir(ns, campaign), 'world.json');
  const worldLedgerFile = (ns, campaign) => path.join(campaignDir(ns, campaign), 'world-ledger.jsonl');
  const worldObservedFile = (ns, campaign) => path.join(campaignDir(ns, campaign), 'world-observed.json');

  // Closure readers (not methods) so the public methods never rely on `this`
  // — a destructured store method must keep working.
  function readWorldPin(ns, campaign) {
    const file = worldPinFile(ns, campaign);
    if (!fs.existsSync(file)) return null;
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return null; // a corrupt pin reads as unbound — worldBind refuses to
                   // overwrite an existing FILE, so nothing is lost silently
    }
  }
  function readWorldObserved(ns, campaign) {
    const file = worldObservedFile(ns, campaign);
    if (!fs.existsSync(file)) return {};
    try {
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return {};
    }
  }

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
      // The whole campaign travels: narrative log, mechanical checkpoints,
      // and the world playthrough (pin + ledger + observed) — that trio is
      // what lets a campaign started over MCP continue in a browser host
      // folding the same ledger over the same cartridge. The image gate is
      // deliberately NOT exported: a render budget is deployment policy,
      // not campaign story, and importing one would smuggle spend state.
      const state = {};
      const sd = stateDir(ns, campaign);
      if (fs.existsSync(sd)) {
        for (const f of fs.readdirSync(sd).filter((x) => x.endsWith('.json'))) {
          try { state[f.slice(0, -5)] = JSON.parse(fs.readFileSync(path.join(sd, f), 'utf8')); }
          catch { /* a torn checkpoint is skipped, same as a torn memory line */ }
        }
      }
      const pin = readWorldPin(ns, campaign);
      const world = pin === null ? null : {
        pin,
        ledger: (() => { const file = worldLedgerFile(ns, campaign);
          if (!fs.existsSync(file)) return [];
          const out = [];
          for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
            if (line.trim() === '') continue;
            try { const e = JSON.parse(line); if (e.op === 'patch') { const { op, ...patch } = e; out.push(patch); } }
            catch { /* torn line */ }
          }
          return out; })(),
        observed: readWorldObserved(ns, campaign),
      };
      return { campaign, records: liveRecords(ops), corruptLinesSkipped: corrupt, state, world };
    },

    /**
     * Re-record an exported dump (fresh ids, original timestamps
     * kept). Import into an *empty* campaign to get a faithful
     * restore; importing into a live one appends.
     */
    importAll(token, campaign, records, { state = null, world = null } = {}) {
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
      let stateKeys = 0;
      for (const [key, data] of Object.entries(state ?? {})) {
        assertName('state key', key);
        fs.mkdirSync(stateDir(ns, campaign), { recursive: true });
        fs.writeFileSync(path.join(stateDir(ns, campaign), `${key}.json`), JSON.stringify(data, null, 2), 'utf8');
        stateKeys += 1;
      }
      let worldImported = false;
      if (world?.pin) {
        // Through worldBind, so a bound campaign refuses rather than being
        // silently paved over — import a playthrough into a FRESH campaign.
        fs.mkdirSync(campaignDir(ns, campaign), { recursive: true });
        const file = worldPinFile(ns, campaign);
        if (fs.existsSync(file)) {
          throw new Error(`Campaign "${campaign}" already has a world; import a playthrough into a fresh campaign.`);
        }
        fs.writeFileSync(file, JSON.stringify(world.pin, null, 2), 'utf8');
        if (world.ledger?.length) {
          const lines = world.ledger.map((p) => `${JSON.stringify({ op: 'patch', ...p })}\n`).join('');
          fs.appendFileSync(worldLedgerFile(ns, campaign), lines, 'utf8');
        }
        if (world.observed && Object.keys(world.observed).length) {
          fs.writeFileSync(worldObservedFile(ns, campaign), JSON.stringify(world.observed, null, 2), 'utf8');
        }
        worldImported = true;
      }
      return { imported: records.length, stateKeys, world: worldImported, campaign };
    },

    campaigns: listCampaigns,

    /**
     * The session-start surface: one row per campaign, newest activity
     * first — enough for a host to render "resume, start new, or delete"
     * without touching any other tool.
     */
    campaignOverview(token) {
      const ns = namespaceFor(token);
      const root = path.join(dataDir, ns);
      if (!fs.existsSync(root)) return [];
      const mtimeOf = (p) => { try { return fs.statSync(p).mtimeMs; } catch { return 0; } };
      return fs.readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => {
          const campaign = d.name;
          const live = liveRecords(loadOps(ns, campaign).ops);
          const sd = stateDir(ns, campaign);
          const stateKeys = fs.existsSync(sd) ? fs.readdirSync(sd).filter((f) => f.endsWith('.json')).length : 0;
          const pin = readWorldPin(ns, campaign);
          const ledgerFile = worldLedgerFile(ns, campaign);
          let ledgerLength = 0;
          if (fs.existsSync(ledgerFile)) {
            ledgerLength = fs.readFileSync(ledgerFile, 'utf8').split(/\r?\n/).filter((l) => l.trim() !== '').length;
          }
          const lastPlayedAt = Math.round(Math.max(
            mtimeOf(memoryFile(ns, campaign)), mtimeOf(ledgerFile),
            mtimeOf(worldPinFile(ns, campaign)), mtimeOf(sd), 0));
          return {
            campaign, records: live.length, stateKeys, ledgerLength, lastPlayedAt,
            world: pin === null ? null : {
              worldId: pin.worldId, setting: pin.setting ?? null,
              digest: pin.digest ?? null, start: pin.start ?? null,
            },
          };
        })
        .sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
    },

    /**
     * Delete a campaign — memory log, state vault, image gate, playthrough,
     * everything. Irreversible by design; the tool layer demands the player
     * type the name back, and offers memory_export first.
     */
    campaignDelete(token, campaign) {
      const ns = namespaceFor(token);
      assertName('campaign', campaign);
      const dir = campaignDir(ns, campaign);
      if (!fs.existsSync(dir)) {
        throw new Error(`No campaign "${campaign}" in this namespace. campaign_list shows what exists.`);
      }
      fs.rmSync(dir, { recursive: true, force: true });
      return { deleted: campaign };
    },

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
    },

    // ── World playthrough binding ─────────────────────────────────────────
    //
    // A campaign binds to ONE world: the pin (world.json — which cartridge,
    // frozen at begin), an append-only patch ledger (world-ledger.jsonl),
    // and an observation set (world-observed.json — which entities the table
    // has actually seen, the input to the revision publish gate in scripts/publish-revision.js).
    //
    // Same placement reasoning as the image gate: none of these are
    // state-vault keys, because state_save takes arbitrary JSON and a pin or
    // a ledger the model can rewrite is neither a pin nor a ledger. The
    // ledger is op-wrapped ({"op":"patch",…} per line) so a compaction op
    // can join the format later without a migration.

    /** The campaign's world pin, or null when it has never begun a world. */
    worldPin(token, campaign) {
      const ns = namespaceFor(token);
      assertName('campaign', campaign);
      return readWorldPin(ns, campaign);
    },

    /**
     * Bind the campaign to a world. Refuses when a pin file already exists —
     * a campaign plays one world, and rebinding is an explicit, audited
     * operation (worldRebind), never an accident of calling begin twice.
     */
    worldBind(token, campaign, pin) {
      const ns = namespaceFor(token);
      assertName('campaign', campaign);
      const file = worldPinFile(ns, campaign);
      if (fs.existsSync(file)) {
        throw new Error(`Campaign "${campaign}" is already bound to a world. One campaign, one world; start another campaign for another world.`);
      }
      fs.mkdirSync(campaignDir(ns, campaign), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(pin, null, 2), 'utf8');
      return pin;
    },

    /**
     * Replace the pin — the upgrade path's writer. `audit` is appended to
     * the pin's `upgrades` trail so the pin always tells its own history.
     */
    worldRebind(token, campaign, pin, audit) {
      const ns = namespaceFor(token);
      assertName('campaign', campaign);
      const file = worldPinFile(ns, campaign);
      if (!fs.existsSync(file)) {
        throw new Error(`Campaign "${campaign}" is not bound to a world; call world_begin first.`);
      }
      const next = { ...pin, upgrades: [...(pin.upgrades ?? []), ...(audit ? [audit] : [])] };
      fs.writeFileSync(file, JSON.stringify(next, null, 2), 'utf8');
      return next;
    },

    /** Append validated patches to the campaign's world ledger. */
    worldAppend(token, campaign, patches) {
      const ns = namespaceFor(token);
      assertName('campaign', campaign);
      if (!patches.length) return { appended: 0 };
      fs.mkdirSync(campaignDir(ns, campaign), { recursive: true });
      const lines = patches.map((p) => `${JSON.stringify({ op: 'patch', ...p })}\n`).join('');
      fs.appendFileSync(worldLedgerFile(ns, campaign), lines, 'utf8');
      return { appended: patches.length };
    },

    /**
     * Read the campaign's world ledger, oldest first. Corrupt lines (a torn
     * write) are counted and skipped, same discipline as the memory log —
     * losing one patch beats refusing to load a campaign. Unknown ops are
     * ignored so an older server can read a ledger a newer one wrote.
     */
    worldLedger(token, campaign) {
      const ns = namespaceFor(token);
      assertName('campaign', campaign);
      const file = worldLedgerFile(ns, campaign);
      if (!fs.existsSync(file)) return { patches: [], corruptLinesSkipped: 0 };
      const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/).filter((l) => l.trim() !== '');
      const patches = [];
      let corrupt = 0;
      for (const line of lines) {
        try {
          const entry = JSON.parse(line);
          if (entry.op === 'patch') {
            const { op, ...patch } = entry;
            patches.push(patch);
          }
        } catch {
          corrupt += 1;
        }
      }
      return { patches, corruptLinesSkipped: corrupt };
    },

    /** The campaign's observation set: { [entityId]: { paths: string[]|'*', turn } }. */
    worldObserved(token, campaign) {
      const ns = namespaceFor(token);
      assertName('campaign', campaign);
      return readWorldObserved(ns, campaign);
    },

    /**
     * Record observations: entries of { id, path?, turn? }. A path of '*'
     * (or an entry with no path) marks the whole entity observed — "the
     * party walked into it" — and is never narrowed again; path lists only
     * ever grow. Small last-write-wins map by design: the future publish
     * gate reads one tiny file per campaign, not a ledger parse.
     */
    worldObserve(token, campaign, entries) {
      const ns = namespaceFor(token);
      assertName('campaign', campaign);
      if (!entries.length) return {};
      const observed = readWorldObserved(ns, campaign);
      for (const { id, path: p = '*', turn = 0 } of entries) {
        if (typeof id !== 'string' || id === '') continue;
        const prev = observed[id];
        if (prev?.paths === '*') continue;                      // already whole
        if (p === '*') observed[id] = { paths: '*', turn: prev?.turn ?? turn };
        else {
          const paths = new Set(prev?.paths ?? []);
          paths.add(p);
          observed[id] = { paths: [...paths].sort(), turn: prev?.turn ?? turn };
        }
      }
      fs.mkdirSync(campaignDir(ns, campaign), { recursive: true });
      fs.writeFileSync(worldObservedFile(ns, campaign), JSON.stringify(observed, null, 2), 'utf8');
      return observed;
    },

    /** Every campaign in the namespace with a world pin — the upgrade/publish scan's read. */
    worldBindings(token) {
      const ns = namespaceFor(token);
      const root = path.join(dataDir, ns);
      if (!fs.existsSync(root)) return [];
      return fs.readdirSync(root, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => ({ campaign: d.name, pin: readWorldPin(ns, d.name) }))
        .filter((b) => b.pin !== null);
    }
  };
}
