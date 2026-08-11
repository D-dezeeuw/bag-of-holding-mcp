import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMemoryStore } from '../src/memory/store.js';

// Hybrid retrieval with injected fakes: a lexicon "embedder" that
// maps known words onto shared dimensions (so synonyms land on the
// same vector) and an in-memory stand-in for Qdrant. No network,
// fully deterministic.

const tmpDirs = [];
after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

const LEXICON = { blade: 0, sword: 0, steel: 0, lantern: 1, lamp: 1, ledger: 2, books: 2 };

function lexVec(text) {
  const v = new Float32Array(4);
  for (const [word, dim] of Object.entries(LEXICON)) {
    if (text.toLowerCase().includes(word)) v[dim] = 1;
  }
  let norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  if (norm === 0) { v[3] = 1; norm = 1; }
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

function fakeEmbedder({ failFirst = 0 } = {}) {
  let calls = 0;
  const embedded = [];
  return {
    model: 'fake-lex',
    dim: 4,
    embedded,
    async embedDocuments(texts) {
      if (calls++ < failFirst) throw new Error('embeddings sidecar down');
      embedded.push(...texts);
      return texts.map(lexVec);
    },
    async embedQuery(text) {
      if (calls++ < failFirst) throw new Error('embeddings sidecar down');
      return lexVec(text);
    }
  };
}

function fakeIndex({ extraRid } = {}) {
  const points = new Map();
  return {
    collection: 'fake',
    ensured: 0,
    upsertBatches: [],
    async ensureCollection() { this.ensured += 1; return { created: this.ensured === 1 }; },
    async existingIds(ids) { return new Set(ids.filter((id) => points.has(id))); },
    async upsert(batch) {
      this.upsertBatches.push(batch.length);
      for (const p of batch) points.set(p.id, p);
      return { upserted: batch.length };
    },
    async query({ vector, ns, campaign, model, limit }) {
      const hits = [...points.values()]
        .filter((p) => p.payload.ns === ns && p.payload.campaign === campaign && p.payload.model === model)
        .map((p) => ({
          rid: p.payload.rid,
          score: p.vector.reduce((s, x, i) => s + x * vector[i], 0)
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
      if (extraRid) hits.unshift({ rid: extraRid, score: 1 });
      return hits;
    }
  };
}

function mkStore(overrides = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boh-hybrid-'));
  tmpDirs.push(dir);
  const embedder = overrides.embedder ?? fakeEmbedder();
  const vectorIndex = overrides.vectorIndex ?? fakeIndex(overrides);
  const store = createMemoryStore({ dataDir: dir, tokenHashes: [], embedder, vectorIndex });
  return { store, embedder, vectorIndex };
}

function seed(store) {
  store.record(undefined, 'fen', { type: 'item', text: 'Bren bought a fine blade from the smith', entities: ['Bren'] });
  store.record(undefined, 'fen', { type: 'npc', text: 'Maela trims the lamp wicks at dusk', entities: ['Maela'] });
  store.record(undefined, 'fen', { type: 'event', text: 'Tally hid the ledger in a flooded cellar', entities: ['Tally'] });
}

test('hybrid search finds by meaning where lexical misses: "sword" retrieves the blade record', async () => {
  const { store } = mkStore();
  seed(store);
  const result = await store.search(undefined, 'fen', { query: 'sword' });
  assert.equal(result.retrieval, 'hybrid');
  assert.equal(result.hits[0].text, 'Bren bought a fine blade from the smith');
  // And exact-name queries still work through the fused ranking.
  const named = await store.search(undefined, 'fen', { query: 'Tally books' });
  assert.equal(named.hits[0].entities[0], 'Tally');
});

test('vectors backfill lazily and idempotently, and record entities join the embedded text', async () => {
  const { store, embedder, vectorIndex } = mkStore();
  seed(store);
  await store.search(undefined, 'fen', { query: 'lamp' });
  assert.deepEqual(vectorIndex.upsertBatches, [3], 'first search embeds every live record');
  assert.ok(embedder.embedded[0].includes('| Bren'), 'entities ride along in the embedded text');

  await store.search(undefined, 'fen', { query: 'sword' });
  assert.deepEqual(vectorIndex.upsertBatches, [3], 'second search re-embeds nothing');

  store.record(undefined, 'fen', { type: 'note', text: 'a new steel shipment arrived' });
  await store.search(undefined, 'fen', { query: 'sword' });
  assert.deepEqual(vectorIndex.upsertBatches, [3, 1], 'only the new record is embedded');
});

test('stale vectors cannot resurrect forgotten or filtered-out records', async () => {
  const { store } = mkStore();
  seed(store);
  await store.search(undefined, 'fen', { query: 'blade' });
  store.forget(undefined, 'fen', 'm-1');
  const afterForget = await store.search(undefined, 'fen', { query: 'sword' });
  assert.ok(afterForget.hits.every((h) => h.id !== 'm-1'), 'forgotten record stays gone despite its vector');

  // A type filter shrinks the candidate set the same way.
  const filtered = await store.search(undefined, 'fen', { query: 'sword lamp ledger', type: 'npc' });
  assert.ok(filtered.hits.every((h) => h.type === 'npc'));

  // And rids Qdrant returns that we never wrote are ignored outright.
  const { store: junkStore } = mkStore({ extraRid: 'm-999' });
  seed(junkStore);
  const junk = await junkStore.search(undefined, 'fen', { query: 'sword' });
  assert.ok(junk.hits.every((h) => h.id !== 'm-999'));
});

test('the importance prior re-orders matches but never resurrects a no-match', async () => {
  const { store } = mkStore();
  seed(store);
  store.record(undefined, 'fen', {
    type: 'lore', text: 'utterly unrelated prophecy of the deep', importance: 5
  });
  const result = await store.search(undefined, 'fen', { query: 'sword' });
  assert.ok(result.hits.every((h) => h.id !== 'm-4'), 'importance alone cannot force a hit');
});

test('sidecar failure degrades to lexical with the reason, then recovers on the next search', async () => {
  const embedder = fakeEmbedder({ failFirst: 1 });
  const { store } = mkStore({ embedder });
  seed(store);

  const degraded = await store.search(undefined, 'fen', { query: 'blade' });
  assert.equal(degraded.retrieval, 'lexical');
  assert.match(degraded.semanticError, /sidecar down/);
  assert.equal(degraded.hits[0].id, 'm-1', 'lexical results still served');
  assert.equal(store.embeddingsInfo().state, 'failed');
  assert.match(store.embeddingsInfo().lastError, /sidecar down/);

  const recovered = await store.search(undefined, 'fen', { query: 'sword' });
  assert.equal(recovered.retrieval, 'hybrid');
  assert.equal(store.embeddingsInfo().state, 'ready');
  assert.equal(store.embeddingsInfo().lastError, undefined);
});

test('empty queries and empty candidate sets never wake the sidecars', async () => {
  const { store, embedder } = mkStore();
  seed(store);
  const empty = await store.search(undefined, 'fen', { query: '   ' });
  assert.deepEqual(empty.hits, []);
  assert.equal(empty.retrieval, 'lexical');
  const none = await store.search(undefined, 'fen', { query: 'sword', type: 'session-summary' });
  assert.equal(none.retrieval, 'lexical');
  assert.equal(none.searched, 0);
  assert.equal(embedder.embedded.length, 0, 'no embedding happened');
});

test('embeddingsInfo reports the injected embedder and transitions unloaded → ready', async () => {
  const { store } = mkStore();
  const before = store.embeddingsInfo();
  assert.equal(before.state, 'unloaded');
  assert.equal(before.url, '(injected embedder)');
  assert.equal(before.model, 'fake-lex');
  assert.equal(before.dim, 4);
  seed(store);
  await store.search(undefined, 'fen', { query: 'blade' });
  assert.equal(store.embeddingsInfo().state, 'ready');
  // info() carries the same block for memory_status.
  assert.equal(store.info(undefined).embeddings.state, 'ready');
});

test('weak semantic echoes fall below the relevance floor; strong ones rank with importance', async () => {
  const { store } = mkStore();
  store.record(undefined, 'fen', { type: 'item', text: 'a blade from the smith' });
  store.record(undefined, 'fen', { type: 'item', text: 'a steel dagger of the deep', importance: 5 });
  // Diluted vector: blade+lantern+ledger → cosine ≈ 0.577 to "sword",
  // under the 0.6 × best-hit floor set by the pure matches above.
  store.record(undefined, 'fen', { type: 'note', text: 'jumbled blade lantern ledger inventory' });
  // A spread of importances (5 / 2 / default / default) so the
  // prior ordering weighs real pairs in both directions.
  store.record(undefined, 'fen', { type: 'item', text: 'a steel buckle from the deep', importance: 2 });
  store.record(undefined, 'fen', { type: 'item', text: 'a crate of steel rations' });
  const result = await store.search(undefined, 'fen', { query: 'sword' });
  const ids = result.hits.map((h) => h.id);
  for (const id of ['m-1', 'm-2', 'm-4', 'm-5']) {
    assert.ok(ids.includes(id), `strong match ${id} surfaces`);
  }
  assert.ok(!ids.includes('m-3'), 'the diluted echo stays out');
});

test('config without injection reports library defaults for model, dim and qdrant', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boh-hybrid-'));
  tmpDirs.push(dir);
  // URL configured (semantic enabled) but nothing else — the info
  // block shows what the store would actually use.
  const store = createMemoryStore({
    dataDir: dir, tokenHashes: [], embeddings: { url: 'http://127.0.0.1:1/v1' }
  });
  const info = store.embeddingsInfo();
  assert.equal(info.state, 'unloaded');
  assert.equal(info.model, 'Qwen/Qwen3-Embedding-0.6B');
  assert.equal(info.dim, 256);
  assert.deepEqual(info.qdrant, { url: 'http://localhost:6333', collection: 'boh-memory' });
});

test('semantic search stays inside the token namespace', async () => {
  const { store } = mkStore();
  store.record('token-a', 'fen', { type: 'item', text: 'a blade of the northern smiths' });
  store.record('token-b', 'fen', { type: 'item', text: 'a lantern of the drowned parish' });
  const a = await store.search('token-a', 'fen', { query: 'sword' });
  assert.equal(a.hits.length, 1);
  const crossTenant = await store.search('token-b', 'fen', { query: 'sword' });
  assert.equal(crossTenant.hits.length, 0, 'tenant b cannot see tenant a\'s memories');
});
