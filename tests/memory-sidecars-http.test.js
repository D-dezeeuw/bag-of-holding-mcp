import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createMemoryStore } from '../src/memory/store.js';

// End-to-end over real HTTP: an in-process server impersonates both
// sidecars (OpenAI-shaped /v1/embeddings and Qdrant's REST routes),
// the store is configured purely through the BOH_* environment, and
// the real clients talk to it with the real fetch. This is the same
// wire the docker-compose stack speaks — minus the 600 MB model.

const ENV_KEYS = [
  'BOH_EMBEDDINGS_URL', 'BOH_EMBEDDINGS_MODEL', 'BOH_EMBEDDINGS_DIM', 'BOH_EMBEDDINGS_API_KEY',
  'BOH_QDRANT_URL', 'BOH_QDRANT_COLLECTION', 'BOH_QDRANT_API_KEY'
];
const savedEnv = {};
let server;
let tmpDir;
const seenAuth = { embeddings: null, qdrant: null };
const qdrantState = { collection: null, points: new Map(), indexes: [] };

// Server-side "model": known words share a dimension, so paraphrase
// retrieval genuinely exercises the semantic path.
function serverVec(text) {
  const t = text.toLowerCase();
  const v = [0, 0, 0, 0, 0, 0, 0, 0]; // 8 dims; client truncates to 4
  if (/ledger|books|accounts/.test(t)) v[0] = 1;
  if (/lantern|lamp/.test(t)) v[1] = 1;
  if (/barge|boat/.test(t)) v[2] = 1;
  if (v.every((x) => x === 0)) v[3] = 1;
  return v;
}

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => { raw += chunk; });
    req.on('end', () => resolve(raw === '' ? undefined : JSON.parse(raw)));
  });
}

before(async () => {
  for (const key of ENV_KEYS) savedEnv[key] = process.env[key];
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boh-http-'));

  server = http.createServer(async (req, res) => {
    const body = await readBody(req);
    const send = (status, payload) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(payload));
    };

    if (req.url === '/v1/embeddings') {
      seenAuth.embeddings = req.headers.authorization;
      return send(200, {
        data: body.input.map((text, index) => ({ index, embedding: serverVec(text) }))
      });
    }

    if (req.url.startsWith('/collections/boh-test')) {
      seenAuth.qdrant = req.headers['api-key'];
      const rest = req.url.slice('/collections/boh-test'.length);
      if (rest === '' && req.method === 'GET') {
        return qdrantState.collection
          ? send(200, { result: qdrantState.collection })
          : send(404, { status: { error: 'not found' } });
      }
      if (rest === '' && req.method === 'PUT') {
        qdrantState.collection = body.vectors;
        return send(200, { result: true });
      }
      if (rest === '/index') {
        qdrantState.indexes.push(body.field_name);
        return send(200, { result: true });
      }
      if (rest === '/points' && req.method === 'POST') {
        return send(200, {
          result: body.ids.filter((id) => qdrantState.points.has(id)).map((id) => ({ id }))
        });
      }
      if (rest === '/points?wait=true') {
        for (const p of body.points) qdrantState.points.set(p.id, p);
        return send(200, { result: { status: 'completed' } });
      }
      if (rest === '/points/query') {
        const must = Object.fromEntries(body.filter.must.map((f) => [f.key, f.match.value]));
        const points = [...qdrantState.points.values()]
          .filter((p) => p.payload.ns === must.ns && p.payload.campaign === must.campaign && p.payload.model === must.model)
          .map((p) => ({
            payload: p.payload,
            score: p.vector.reduce((s, x, i) => s + x * body.query[i], 0)
          }))
          .sort((a, b) => b.score - a.score)
          .slice(0, body.limit);
        return send(200, { result: { points } });
      }
    }
    return send(500, { error: `unhandled ${req.method} ${req.url}` });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  process.env.BOH_EMBEDDINGS_URL = `${origin}/v1`;
  process.env.BOH_EMBEDDINGS_MODEL = 'qwen3-test';
  process.env.BOH_EMBEDDINGS_DIM = '4';
  process.env.BOH_EMBEDDINGS_API_KEY = 'emb-secret';
  process.env.BOH_QDRANT_URL = origin;
  process.env.BOH_QDRANT_COLLECTION = 'boh-test';
  process.env.BOH_QDRANT_API_KEY = 'qdrant-secret';
});

after(async () => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]; else process.env[key] = savedEnv[key];
  }
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('a campaign flows record → hybrid search over real HTTP, configured from the environment alone', async () => {
  const store = createMemoryStore({ dataDir: tmpDir, tokenHashes: [] });

  const info = store.embeddingsInfo();
  assert.equal(info.state, 'unloaded');
  assert.equal(info.model, 'qwen3-test');
  assert.equal(info.dim, 4);
  assert.equal(info.qdrant.collection, 'boh-test');

  store.record('table-token', 'fen', {
    type: 'event', text: 'Tally hid the ledger in a flooded cellar', entities: ['Tally'], importance: 4
  });
  store.record('table-token', 'fen', {
    type: 'npc', text: 'Maela trims the lantern wicks at dusk', entities: ['Maela']
  });

  // Paraphrase: no shared token with the ledger record.
  const result = await store.search('table-token', 'fen', { query: 'where are the books kept' });
  assert.equal(result.retrieval, 'hybrid');
  assert.equal(result.hits[0].entities[0], 'Tally');

  // The stack was provisioned on first use, with tenant indexes and auth.
  assert.deepEqual(qdrantState.collection, { size: 4, distance: 'Cosine' });
  assert.deepEqual(qdrantState.indexes, ['ns', 'campaign', 'model']);
  assert.equal(qdrantState.points.size, 2);
  assert.equal(seenAuth.embeddings, 'Bearer emb-secret');
  assert.equal(seenAuth.qdrant, 'qdrant-secret');
  assert.equal(store.embeddingsInfo().state, 'ready');

  // Tokens never travel: payloads carry the hashed namespace only.
  for (const point of qdrantState.points.values()) {
    assert.match(point.payload.ns, /^t-[0-9a-f]{16}$/);
    assert.ok(!JSON.stringify(point).includes('table-token'));
  }
});

test('a second store instance reuses the existing collection without recreating it', async () => {
  const store = createMemoryStore({ dataDir: tmpDir, tokenHashes: [] });
  const indexCountBefore = qdrantState.indexes.length;
  const result = await store.search('table-token', 'fen', { query: 'lamp' });
  assert.equal(result.retrieval, 'hybrid');
  assert.equal(result.hits[0].entities[0], 'Maela');
  assert.equal(qdrantState.indexes.length, indexCountBefore, 'no re-provisioning on an existing collection');
});

test('explicit options outrank the environment for every semantic setting', async () => {
  const origin = `http://127.0.0.1:${server.address().port}`;
  // Environment points elsewhere on purpose; options must win.
  process.env.BOH_EMBEDDINGS_URL = 'http://127.0.0.1:1/nowhere';
  process.env.BOH_QDRANT_URL = 'http://127.0.0.1:1';
  try {
    const store = createMemoryStore({
      dataDir: tmpDir,
      tokenHashes: [],
      embeddings: { url: `${origin}/v1`, model: 'qwen3-test', dim: 4, apiKey: 'emb-secret' },
      qdrant: { url: origin, collection: 'boh-test', apiKey: 'qdrant-secret' }
    });
    const info = store.embeddingsInfo();
    assert.equal(info.url, `${origin}/v1`);
    assert.equal(info.qdrant.collection, 'boh-test');
    const result = await store.search('table-token', 'fen', { query: 'boat traffic' });
    assert.equal(result.retrieval, 'hybrid');
  } finally {
    process.env.BOH_EMBEDDINGS_URL = `${origin}/v1`;
    process.env.BOH_QDRANT_URL = origin;
  }
});
