// The relay on the wire: real socket, real HTTP, a stubbed provider.
//
// What these cases are really pinning down is that a browser can reach this at
// all (preflight + CORS), that the tenant path still refuses to be an oracle,
// and that every path out of a relayed call ends with the budget charged —
// including the streamed one, which is the only path a player actually uses.

import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createHttpHandler } from '../src/http.js';
import { FREE_MODELS, PAID_MODELS, RELAY_TIERS } from '@zeeuw/bag-of-holding-client';

const TOKEN = 'tenant-relay-token';
const FREE_TOKEN = 'tenant-free-token';
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

const T0 = 1_700_000_000_000;

let server;
let base;
let dataDir;
let registryFile;
/** Set per test: what the stubbed provider answers, and what it was asked. */
let upstream;

const relayConfig = { key: 'sk-operator-secret', baseUrl: 'https://provider.test/v1', appTitle: 'boh-test' };

function sseStream(frames) {
  return new ReadableStream({
    start(controller) {
      const enc = new TextEncoder();
      for (const f of frames) controller.enqueue(enc.encode(f));
      controller.close();
    },
  });
}

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boh-relay-'));
  // A registry (not just env hashes) so one tenant can carry a tier and the
  // other cannot — the difference the relay is supposed to enforce.
  registryFile = path.join(dataDir, 'tenants.json');
  fs.writeFileSync(registryFile, JSON.stringify({
    version: 1,
    tenants: {
      [sha256(TOKEN)]: { tier: 'studio', status: 'active' },
      [sha256(FREE_TOKEN)]: { tier: 'free', status: 'active' },
    },
  }));

  const { handler } = createHttpHandler({
    memory: { dataDir, registryFile },
    worldsDir: dataDir,
    env: {},
    now: () => T0,
    relayConfig,
    relayFetch: async (url, init) => {
      upstream.calls.push({ url, init, body: JSON.parse(init.body) });
      if (upstream.throws) throw upstream.throws;
      return upstream.response();
    },
  });
  server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

beforeEach(() => {
  upstream = {
    calls: [],
    throws: null,
    response: () => Response.json({
      choices: [{ message: { content: 'The fen exhales.' } }],
      usage: { total_tokens: 1_500 },
    }),
  };
  // Every case starts from a clean budget: these tests assert on charges.
  for (const entry of fs.readdirSync(dataDir, { withFileTypes: true })) {
    if (entry.isDirectory()) fs.rmSync(path.join(dataDir, entry.name), { recursive: true, force: true });
  }
});

const relay = (token, endpoint, init) => fetch(`${base}/mcp/${token}/v1/${endpoint}`, init);
const statusOf = async (token) => (await relay(token, 'status')).json();

const completion = (token, body) => relay(token, 'chat/completions', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

test('a browser can reach the relay: preflight answers with CORS', async () => {
  const res = await relay(TOKEN, 'chat/completions', {
    method: 'OPTIONS',
    headers: { origin: 'https://d-dezeeuw.github.io', 'access-control-request-headers': 'authorization' },
  });
  assert.equal(res.status, 204);
  assert.equal(res.headers.get('access-control-allow-origin'), '*');
  assert.match(res.headers.get('access-control-allow-headers'), /authorization/);
  assert.match(res.headers.get('access-control-allow-methods'), /POST/);
  assert.equal(res.headers.get('access-control-expose-headers'), 'retry-after');
});

test('the relay path is no more of an oracle than the MCP path', async () => {
  // Same 404 for a wrong token, a wrong endpoint, and a wrong shape.
  for (const url of [
    `${base}/mcp/not-a-real-token/v1/status`,
    `${base}/mcp/${TOKEN}/v1/embeddings`,
    `${base}/mcp/${TOKEN}/v1`,
    `${base}/mcp/${TOKEN}/v2/status`,
    `${base}/mcp//v1/status`,
  ]) {
    const res = await fetch(url);
    assert.equal(res.status, 404, `expected 404 for ${url}`);
    assert.deepEqual(await res.json(), { error: 'Not found' });
  }
});

test('status reports the tenant\'s tier, models and budget', async () => {
  const s = await statusOf(TOKEN);
  assert.equal(s.relay, 'bag-of-holding-mcp');
  assert.equal(s.relayEnabled, true);
  assert.equal(s.tier, 'studio');
  assert.equal(s.models.medium, PAID_MODELS.medium);
  assert.equal(s.budget.budget, RELAY_TIERS.studio.budget);
  assert.equal(s.budget.spent, 0);
  assert.ok(!JSON.stringify(s).includes(relayConfig.key), 'the operator key never leaves the process');

  const free = await statusOf(FREE_TOKEN);
  assert.equal(free.tier, 'free');
  assert.equal(free.models.medium, FREE_MODELS.medium);
});

test('/v1/models serves the tier\'s catalog, and only GET', async () => {
  const res = await relay(FREE_TOKEN, 'models');
  const ids = (await res.json()).data.map((m) => m.id);
  assert.ok(ids.includes(FREE_MODELS.medium));
  assert.ok(!ids.includes(PAID_MODELS.medium));

  const wrong = await relay(FREE_TOKEN, 'models', { method: 'POST' });
  assert.equal(wrong.status, 405);
});

test('a completion is forwarded under the operator key and charged to the tenant', async () => {
  const res = await completion(TOKEN, { messages: [{ role: 'user', content: 'Narrate.' }], temperature: 0.9 });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).choices[0].message.content, 'The fen exhales.');

  // What the provider was asked
  const call = upstream.calls[0];
  assert.equal(call.url, 'https://provider.test/v1/chat/completions');
  assert.equal(call.init.headers.authorization, `Bearer ${relayConfig.key}`);
  assert.equal(call.body.model, PAID_MODELS.medium, 'the tier\'s default, not the caller\'s choice');
  assert.equal(call.body.temperature, 0.9);

  // …and what it cost the tenant
  const s = await statusOf(TOKEN);
  assert.equal(s.budget.spent, 1_500);
  assert.equal(s.budget.calls, 1);
  assert.equal(s.budget.tokens, 1_500);
});

test('a free tenant cannot spend the operator\'s money on a paid model', async () => {
  const res = await completion(FREE_TOKEN, {
    messages: [{ role: 'user', content: 'Narrate.' }], model: PAID_MODELS.medium,
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.equal(body.error.type, 'model_not_allowed');
  assert.equal(upstream.calls.length, 0, 'nothing reached the provider');
  assert.equal((await statusOf(FREE_TOKEN)).budget.spent, 0, 'and nothing was charged');
});

test('a spent budget refuses with 402 and a Retry-After the page can read', async () => {
  // Burn the free tier's window in one enormous reported call.
  upstream.response = () => Response.json({
    choices: [{ message: { content: 'ok' } }],
    usage: { total_tokens: RELAY_TIERS.free.budget },
  });
  assert.equal((await completion(FREE_TOKEN, { messages: [{ role: 'user', content: 'a' }] })).status, 200);

  upstream.calls = [];
  const res = await completion(FREE_TOKEN, { messages: [{ role: 'user', content: 'b' }] });
  assert.equal(res.status, 402);
  const body = await res.json();
  assert.equal(body.error.type, 'budget_exhausted');
  assert.equal(res.headers.get('retry-after'), String(24 * 60 * 60));
  assert.equal(res.headers.get('access-control-allow-origin'), '*', 'a refusal a page cannot read is no answer');
  assert.equal(upstream.calls.length, 0);
});

test('a streamed turn is passed through byte for byte and charged from its usage frame', async () => {
  upstream.response = () => new Response(sseStream([
    'data: {"choices":[{"delta":{"content":"The "}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"fen "}}]}\n\n',
    'data: {"choices":[{"delta":{"content":"exhales."}}]}\n\n',
    'data: {"choices":[],"usage":{"total_tokens":2400}}\n\n',
    'data: [DONE]\n\n',
  ]), { headers: { 'content-type': 'text/event-stream' } });

  const res = await completion(TOKEN, { messages: [{ role: 'user', content: 'Narrate.' }], stream: true });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/event-stream/);
  const text = await res.text();
  assert.match(text, /The /);
  assert.match(text, /exhales\./);
  assert.match(text, /\[DONE\]/);

  assert.deepEqual(upstream.calls[0].body.stream_options, { include_usage: true },
    'a stream without usage reporting is a call nobody can charge');
  assert.equal((await statusOf(TOKEN)).budget.spent, 2_400);
});

test('a stream that dies before reporting usage charges what it saw, not a guess', async () => {
  upstream.response = () => new Response(sseStream([
    'data: {"choices":[{"delta":{"content":"The fen"}}]}\n\n',
  ]), { headers: { 'content-type': 'text/event-stream' } });

  const res = await completion(TOKEN, { messages: [{ role: 'user', content: 'Narrate.' }], stream: true });
  assert.equal(res.status, 200);
  await res.text();
  const s = await statusOf(TOKEN);
  assert.equal(s.budget.spent, 0);
  assert.equal(s.budget.calls, 1, 'the call still happened, and is still counted');
});

test('the provider\'s own refusals pass through with their status', async () => {
  upstream.response = () => new Response('rate limited', { status: 429 });
  const res = await completion(TOKEN, { messages: [{ role: 'user', content: 'a' }] });
  assert.equal(res.status, 429, 'the client library reads 429 as "walk the fallback chain"');
  assert.equal((await res.json()).error.type, 'provider_error');
  assert.equal((await statusOf(TOKEN)).budget.spent, 0, 'a refused call costs nothing');
});

test('an unreachable provider is a 502, not a hung socket', async () => {
  upstream.throws = new TypeError('fetch failed');
  const res = await completion(TOKEN, { messages: [{ role: 'user', content: 'a' }] });
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error.type, 'provider_unreachable');
});

test('a provider answering with something that is not JSON is a 502', async () => {
  upstream.response = () => new Response('<html>bad gateway</html>', {
    status: 200, headers: { 'content-type': 'text/html' },
  });
  const res = await completion(TOKEN, { messages: [{ role: 'user', content: 'a' }] });
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error.type, 'provider_error');
});

test('a budget that cannot be written loses the charge, not the turn', async () => {
  // The tokens were spent upstream either way. Refusing to hand over the
  // answer the player already paid for would be the worse of the two failures.
  const { store } = createHttpHandler({ memory: { dataDir, registryFile } });
  const { handler } = createHttpHandler({
    memoryStore: {
      ...store,
      relayBudgetSave() { throw new Error('EROFS: read-only file system'); },
    },
    worldsDir: dataDir,
    env: {},
    relayConfig,
    relayFetch: async () => Response.json({
      choices: [{ message: { content: 'ok' } }], usage: { total_tokens: 99 },
    }),
  });
  const brittle = http.createServer(handler);
  await new Promise((resolve) => brittle.listen(0, '127.0.0.1', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${brittle.address().port}/mcp/${TOKEN}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'a' }] }),
    });
    assert.equal(res.status, 200);
    assert.equal((await res.json()).choices[0].message.content, 'ok');
  } finally {
    await new Promise((resolve) => brittle.close(resolve));
  }
});

test('a malformed request never reaches the provider', async () => {
  for (const [body, init] of [
    [null, { method: 'POST', body: 'not json', headers: { 'content-type': 'application/json' } }],
    [null, { method: 'POST' }],
    [null, { method: 'GET' }],
  ]) {
    const res = await relay(TOKEN, 'chat/completions', init);
    assert.ok(res.status === 400 || res.status === 405, `got ${res.status}`);
    void body;
  }
  assert.equal(upstream.calls.length, 0);
});

test('with no key configured, status still answers but completions do not', async () => {
  const { handler } = createHttpHandler({
    memory: { dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'boh-norelay-')), registryFile },
    worldsDir: dataDir,
    env: {},
    relayConfig: null,
  });
  const bare = http.createServer(handler);
  await new Promise((resolve) => bare.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${bare.address().port}/mcp/${TOKEN}/v1`;
  try {
    const s = await (await fetch(`${url}/status`)).json();
    assert.equal(s.relay, 'bag-of-holding-mcp', 'the token IS valid — say so');
    assert.equal(s.relayEnabled, false);
    assert.equal(s.models, null);
    assert.match(s.hint, /your own provider key/);

    const res = await fetch(`${url}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'a' }] }),
    });
    assert.equal(res.status, 503);
    assert.equal((await res.json()).error.type, 'relay_unconfigured');
  } finally {
    await new Promise((resolve) => bare.close(resolve));
  }
});

test('a tampered or corrupt budget file cannot mint tokens', async () => {
  const nsDir = path.join(dataDir, `t-${sha256(FREE_TOKEN).slice(0, 16)}`);
  fs.mkdirSync(nsDir, { recursive: true });
  const file = path.join(nsDir, 'relay-budget.json');

  // A hand-edited ceiling buys nothing: the allowance comes from the tier.
  fs.writeFileSync(file, JSON.stringify({ tier: 'studio', budget: 99_999_999, spent: 0 }));
  const tampered = await statusOf(FREE_TOKEN);
  assert.equal(tampered.tier, 'free', 'the registry says free, whatever the file says');
  assert.equal(tampered.budget.budget, RELAY_TIERS.free.budget);

  // A corrupt file heals to a fresh window rather than locking the table out —
  // a bounded gift (one window at the tier ceiling), which is the right
  // direction to fail in for a file only this server writes.
  fs.writeFileSync(file, '{ not json');
  const healed = await statusOf(FREE_TOKEN);
  assert.equal(healed.budget.spent, 0);
  assert.equal(healed.budget.budget, RELAY_TIERS.free.budget);
});

test('the relay budget is not mistaken for a campaign', async () => {
  // It sits beside the campaign directories, so every enumerator here filters
  // it out by being a file rather than a directory.
  await completion(TOKEN, { messages: [{ role: 'user', content: 'a' }] });
  const nsDir = path.join(dataDir, `t-${sha256(TOKEN).slice(0, 16)}`);
  assert.ok(fs.existsSync(path.join(nsDir, 'relay-budget.json')));
  const { store } = createHttpHandler({ memory: { dataDir, registryFile } });
  assert.deepEqual(store.campaigns(TOKEN), []);
});

test('the MCP surface still works on the same tenant path', async () => {
  // The relay is a tail under /mcp/<token>, so the bare path must be untouched.
  const res = await fetch(`${base}/mcp/${TOKEN}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
  });
  assert.equal(res.status, 200);
});
