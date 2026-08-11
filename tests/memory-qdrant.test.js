import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQdrantClient, pointId } from '../src/memory/qdrant.js';

// Scripted fake fetch: shift one response per call, remember requests.
function fakeQdrant(script) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, method: init.method, headers: init.headers, body: init.body ? JSON.parse(init.body) : undefined });
    const next = script.shift();
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      text: async () => JSON.stringify(next.body ?? 'err'),
      json: async () => next.body
    };
  };
  return { calls, fetchImpl };
}

test('pointId derives a stable, well-formed UUID from record coordinates', () => {
  const a = pointId('t-abc', 'fen', 'm-3', 'qwen', 256);
  assert.equal(a, pointId('t-abc', 'fen', 'm-3', 'qwen', 256));
  assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
  // Any coordinate change → different point.
  assert.notEqual(a, pointId('t-abc', 'fen', 'm-3', 'qwen', 128));
  assert.notEqual(a, pointId('t-other', 'fen', 'm-3', 'qwen', 256));
});

test('ensureCollection leaves existing collections untouched', async () => {
  const { calls, fetchImpl } = fakeQdrant([{ status: 200, body: { result: {} } }]);
  const client = createQdrantClient({ url: 'http://q:6333/', collection: 'boh-test', fetchImpl });
  assert.deepEqual(await client.ensureCollection(4), { created: false });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://q:6333/collections/boh-test');
  assert.equal(calls[0].method, 'GET');
});

test('ensureCollection creates collection plus tenant indexes on 404', async () => {
  const { calls, fetchImpl } = fakeQdrant([
    { status: 404 },
    { status: 200, body: { result: true } },   // PUT collection
    { status: 200, body: { result: true } },   // index ns
    { status: 200, body: { result: true } },   // index campaign
    { status: 200, body: { result: true } }    // index model
  ]);
  const client = createQdrantClient({ fetchImpl });
  assert.deepEqual(await client.ensureCollection(4), { created: true });
  assert.equal(calls[1].body.vectors.size, 4);
  assert.equal(calls[1].body.vectors.distance, 'Cosine');
  const nsIndex = calls[2].body;
  assert.equal(nsIndex.field_name, 'ns');
  assert.equal(nsIndex.field_schema.is_tenant, true);
  assert.deepEqual([calls[3].body.field_name, calls[4].body.field_name], ['campaign', 'model']);
  // Defaults applied: localhost URL, boh-memory collection.
  assert.ok(calls[0].url.startsWith('http://localhost:6333/collections/boh-memory'));
});

test('ensureCollection refuses to guess on non-404 probe failures', async () => {
  const { fetchImpl } = fakeQdrant([{ status: 503 }]);
  const client = createQdrantClient({ fetchImpl });
  await assert.rejects(() => client.ensureCollection(4), /503 probing collection/);
});

test('existingIds and upsert short-circuit on empty input and map shapes otherwise', async () => {
  const { calls, fetchImpl } = fakeQdrant([
    { status: 200, body: { result: [{ id: 'aa' }, { id: 'bb' }] } },
    { status: 200, body: { result: {} } }
  ]);
  const client = createQdrantClient({ apiKey: 'qd-key', fetchImpl });

  assert.deepEqual(await client.existingIds([]), new Set());
  assert.deepEqual(await client.upsert([]), { upserted: 0 });
  assert.equal(calls.length, 0, 'empty inputs never hit the network');

  const existing = await client.existingIds(['aa', 'bb', 'cc']);
  assert.deepEqual(existing, new Set(['aa', 'bb']));
  assert.equal(calls[0].headers['api-key'], 'qd-key');

  const result = await client.upsert([
    { id: 'aa', vector: Float32Array.from([1, 0]), payload: { ns: 't-x', rid: 'm-1' } }
  ]);
  assert.deepEqual(result, { upserted: 1 });
  assert.ok(calls[1].url.endsWith('/points?wait=true'));
  assert.deepEqual(calls[1].body.points[0].vector, [1, 0]);
});

test('query filters by tenant, campaign and model and returns rid/score pairs', async () => {
  const { calls, fetchImpl } = fakeQdrant([
    { status: 200, body: { result: { points: [{ payload: { rid: 'm-2' }, score: 0.9 }, { payload: { rid: 'm-1' }, score: 0.5 }] } } }
  ]);
  const client = createQdrantClient({ fetchImpl });
  const hits = await client.query({ vector: Float32Array.from([0, 1]), ns: 't-x', campaign: 'fen', model: 'qwen', limit: 8 });
  assert.deepEqual(hits, [{ rid: 'm-2', score: 0.9 }, { rid: 'm-1', score: 0.5 }]);
  const filter = calls[0].body.filter.must;
  assert.deepEqual(filter.map((f) => f.key), ['ns', 'campaign', 'model']);
  assert.equal(calls[0].body.with_payload, true);
});

test('non-2xx responses surface with status, path and body excerpt', async () => {
  const { fetchImpl } = fakeQdrant([{ status: 400, body: { status: { error: 'dim mismatch' } } }]);
  const client = createQdrantClient({ fetchImpl });
  await assert.rejects(
    () => client.query({ vector: [1], ns: 'x', campaign: 'c', model: 'm', limit: 1 }),
    /Qdrant 400 on POST \/points\/query.*dim mismatch/s
  );
});
