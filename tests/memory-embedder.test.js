import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createEmbeddingsClient, truncateNormalize } from '../src/memory/embedder.js';

// Fake fetch capturing requests and answering with canned vectors —
// the OpenAI /embeddings shape without a model or a network.
function fakeService({ status = 200, respond } = {}) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, headers: init.headers, body });
    if (status !== 200) {
      return { ok: false, status, text: async () => 'boom' };
    }
    const data = respond
      ? respond(body)
      : body.input.map((text, index) => ({ index, embedding: [text.length, 1, 0, 0] }));
    return { ok: true, status, json: async () => ({ data }) };
  };
  return { calls, fetchImpl };
}

test('truncateNormalize applies the Matryoshka contract: cut first, unit-length after', () => {
  const v = truncateNormalize([3, 4, 999, 999], 2);
  assert.equal(v.length, 2);
  assert.ok(Math.abs(v[0] - 0.6) < 1e-6);
  assert.ok(Math.abs(v[1] - 0.8) < 1e-6);
  // A zero vector stays zero instead of dividing by zero.
  assert.deepEqual(Array.from(truncateNormalize([0, 0, 0], 2)), [0, 0]);
});

test('embedDocuments posts the OpenAI shape and returns normalised, truncated vectors', async () => {
  const { calls, fetchImpl } = fakeService();
  const client = createEmbeddingsClient({ url: 'http://x/v1/', model: 'qwen-test', dim: 2, fetchImpl });
  const [a] = await client.embedDocuments(['abcd']);
  // Trailing slash trimmed, /embeddings appended.
  assert.equal(calls[0].url, 'http://x/v1/embeddings');
  assert.equal(calls[0].body.model, 'qwen-test');
  assert.equal(calls[0].headers.authorization, undefined);
  // [4, 1] normalised.
  assert.ok(Math.abs(a[0] - 4 / Math.sqrt(17)) < 1e-6);
  assert.equal(a.length, 2);
});

test('embedQuery adds the instruction prefix and the api key travels as a bearer', async () => {
  const { calls, fetchImpl } = fakeService();
  const client = createEmbeddingsClient({ url: 'http://x/v1', apiKey: 's3cret', fetchImpl });
  await client.embedQuery('where is tally');
  assert.match(calls[0].body.input[0], /^Instruct: .*\nQuery: where is tally$/s);
  assert.equal(calls[0].headers.authorization, 'Bearer s3cret');
});

test('long inputs are embedded truncated, never rejected', async () => {
  const { calls, fetchImpl } = fakeService();
  const client = createEmbeddingsClient({ url: 'http://x/v1', fetchImpl });
  await client.embedDocuments(['d'.repeat(5000)]);
  assert.equal(calls[0].body.input[0].length, 2000);
  await client.embedQuery('q'.repeat(5000));
  // 500 query chars + the instruction prefix.
  assert.ok(calls[1].body.input[0].length < 500 + 200);
});

test('big batches split into service-sized requests, order preserved via the index field', async () => {
  const { calls, fetchImpl } = fakeService({
    // Answer shuffled to prove the client re-orders by index.
    respond: (body) => body.input
      .map((text, index) => ({ index, embedding: [text.length, 1] }))
      .reverse()
  });
  const client = createEmbeddingsClient({ url: 'http://x/v1', dim: 2, fetchImpl });
  const texts = Array.from({ length: 33 }, (_, i) => 'x'.repeat(i + 1));
  const vectors = await client.embedDocuments(texts);
  // 8 per request (paired with the server's --max-batch-tokens ceiling),
  // so 33 documents become 5 requests: 8+8+8+8+1.
  assert.equal(calls.length, 5);
  assert.equal(calls[0].body.input.length, 8);
  assert.equal(calls.at(-1).body.input.length, 1);
  assert.equal(vectors.length, 33);
  // First vector corresponds to the 1-char text despite the reversal.
  assert.ok(vectors[0][0] < vectors[32][0]);
});

test('service failures and shape mismatches surface as clear errors', async () => {
  const bad = createEmbeddingsClient({ url: 'http://x/v1', fetchImpl: fakeService({ status: 503 }).fetchImpl });
  await assert.rejects(() => bad.embedQuery('q'), /Embeddings service 503 .*boom/s);

  const short = createEmbeddingsClient({
    url: 'http://x/v1',
    fetchImpl: fakeService({ respond: () => [] }).fetchImpl
  });
  await assert.rejects(() => short.embedQuery('q'), /returned 0 vectors for 1 inputs/);

  const shapeless = createEmbeddingsClient({
    url: 'http://x/v1',
    fetchImpl: fakeService({ respond: () => undefined }).fetchImpl
  });
  await assert.rejects(() => shapeless.embedQuery('q'), /returned no vectors for 1 inputs/);

  assert.throws(() => createEmbeddingsClient({ url: '' }), /needs a url/);
  assert.throws(() => createEmbeddingsClient({}), /needs a url/);
});
