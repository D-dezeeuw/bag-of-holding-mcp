import { test, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createServer } from '../src/server.js';
import { createHttpHandler } from '../src/http.js';
import {
  resolveJeffConfig, createJeffClient, readScore, judgeImportance,
  importanceState, DEFAULT_JEFF_TIMEOUT_MS, MEMORY_TEXT_MAX_CHARS,
} from '../src/jeff.js';
import { parse } from './_helpers.js';

// The optional JEFF decision layer (docs/jeff-decisions.md). Three promises
// are pinned here: with BOH_JEFF_* unset nothing changes and nothing is sent;
// with it set, memory_record's importance judgment does what it says; and with JEFF down, slow or
// talking nonsense, the server behaves exactly as if it were unset.

// ---------------------------------------------------------------- fake JEFF

let fake;          // http.Server
let fakeUrl;       // http://127.0.0.1:<port>
let reply;         // (body) => { status, json?, raw?, delayMs? }
let seen;          // requests received: { headers, body }

before(async () => {
  fake = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    seen.push({ url: req.url, headers: req.headers, body });
    const r = reply(body);
    if (r.delayMs) await new Promise((ok) => setTimeout(ok, r.delayMs));
    if (res.destroyed) return;
    res.writeHead(r.status ?? 200, { 'content-type': 'application/json' });
    res.end(r.raw ?? JSON.stringify(r.json));
  });
  await new Promise((ok) => fake.listen(0, '127.0.0.1', ok));
  fakeUrl = `http://127.0.0.1:${fake.address().port}`;
});

after(async () => {
  fake.closeAllConnections?.();
  await new Promise((ok) => fake.close(ok));
});

beforeEach(() => { seen = []; reply = () => ({ status: 500, json: {} }); });

const scoreAnswer = (score, confidence = 0.9) => ({
  status: 200,
  json: { id: 'req_x', answers: { importance: { type: 'score', score, confidence, legend: {}, probabilities: {} } }, jeff: { answers: {} } },
});

function mkClient(mode = 'on', extra = {}) {
  const logs = [];
  const client = createJeffClient(
    resolveJeffConfig({ BOH_JEFF_URL: fakeUrl, BOH_JEFF_KEY: 'test-key', BOH_JEFF_MODE: mode, BOH_JEFF_TIMEOUT_MS: '300', ...extra }),
    { log: (e) => logs.push(e) },
  );
  return { client, logs };
}

const tmpDirs = [];
function mkServer(jeff) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boh-jeff-'));
  tmpDirs.push(dataDir);
  const built = createServer({ memory: { dataDir }, jeff });
  const byName = new Map(built.tools.map((t) => [t.name, t]));
  return {
    ...built,
    run: async (name, args) => parse(await byName.get(name).handler(args)),
  };
}
after(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); });

const withoutTs = ({ ts, ...rest }) => rest;
const RECORD = { campaign: 'fen', type: 'event', text: 'The party promised Aldric to bring Mira home.', entities: ['Aldric', 'Mira'] };

// ------------------------------------------------------------ configuration

test('resolveJeffConfig: off unless both URL and key are set', () => {
  assert.equal(resolveJeffConfig({}), null);
  assert.equal(resolveJeffConfig({ BOH_JEFF_URL: 'https://jeff.example' }), null);
  assert.equal(resolveJeffConfig({ BOH_JEFF_KEY: 'k' }), null);
  assert.equal(resolveJeffConfig({ BOH_JEFF_URL: '  ', BOH_JEFF_KEY: 'k' }), null);
  assert.equal(resolveJeffConfig({ BOH_JEFF_URL: 'https://jeff.example', BOH_JEFF_KEY: '  ' }), null);
});

test('resolveJeffConfig: the compose pass-through shape (every variable defined, empty) is off', () => {
  // docker-compose.yml passes all four as `${BOH_JEFF_…:-}`, so an .env that
  // never mentions JEFF still hands the container four empty strings.
  const empty = { BOH_JEFF_URL: '', BOH_JEFF_KEY: '', BOH_JEFF_MODE: '', BOH_JEFF_TIMEOUT_MS: '' };
  assert.equal(resolveJeffConfig(empty), null);
  // And with only URL + key filled in, the empty mode and timeout fall back to their defaults.
  const cfg = resolveJeffConfig({ ...empty, BOH_JEFF_URL: 'https://jeff.example', BOH_JEFF_KEY: 'k' });
  assert.equal(cfg.mode, 'shadow');
  assert.equal(cfg.timeoutMs, DEFAULT_JEFF_TIMEOUT_MS);
});

test('resolveJeffConfig: https anywhere, plain http only to loopback, junk URLs off', () => {
  assert.equal(resolveJeffConfig({ BOH_JEFF_URL: 'http://jeff.example', BOH_JEFF_KEY: 'k' }), null);
  assert.equal(resolveJeffConfig({ BOH_JEFF_URL: 'not a url', BOH_JEFF_KEY: 'k' }), null);
  assert.equal(resolveJeffConfig({ BOH_JEFF_URL: 'ftp://jeff.example', BOH_JEFF_KEY: 'k' }), null);
  assert.ok(resolveJeffConfig({ BOH_JEFF_URL: 'http://localhost:8080', BOH_JEFF_KEY: 'k' }));
  assert.ok(resolveJeffConfig({ BOH_JEFF_URL: 'http://127.0.0.1:8080', BOH_JEFF_KEY: 'k' }));
  assert.ok(resolveJeffConfig({ BOH_JEFF_URL: 'http://[::1]:8080', BOH_JEFF_KEY: 'k' }));
});

test('resolveJeffConfig: shadow by default, trailing slash and timeout normalised', () => {
  const c = resolveJeffConfig({ BOH_JEFF_URL: 'https://jeff.example/', BOH_JEFF_KEY: ' k ' });
  assert.deepEqual(c, { url: 'https://jeff.example', key: 'k', mode: 'shadow', timeoutMs: DEFAULT_JEFF_TIMEOUT_MS });
  assert.equal(resolveJeffConfig({ BOH_JEFF_URL: 'https://j', BOH_JEFF_KEY: 'k', BOH_JEFF_MODE: 'on' }).mode, 'on');
  assert.equal(resolveJeffConfig({ BOH_JEFF_URL: 'https://j', BOH_JEFF_KEY: 'k', BOH_JEFF_MODE: 'ON!' }).mode, 'shadow');
  assert.equal(resolveJeffConfig({ BOH_JEFF_URL: 'https://j', BOH_JEFF_KEY: 'k', BOH_JEFF_TIMEOUT_MS: '250' }).timeoutMs, 250);
  assert.equal(resolveJeffConfig({ BOH_JEFF_URL: 'https://j', BOH_JEFF_KEY: 'k', BOH_JEFF_TIMEOUT_MS: '-1' }).timeoutMs, DEFAULT_JEFF_TIMEOUT_MS);
  assert.equal(createJeffClient(null), null);
});

// ------------------------------------------------- unset: nothing changes

test('env unset: no client, no extra tool, no instructions, no network call', async () => {
  const saved = {};
  for (const k of ['BOH_JEFF_URL', 'BOH_JEFF_KEY', 'BOH_JEFF_MODE']) { saved[k] = process.env[k]; delete process.env[k]; }
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (...args) => { calls += 1; return realFetch(...args); };
  try {
    const dflt = mkServer(undefined);            // resolves from process.env
    const off = mkServer(null);                  // explicitly off
    assert.equal(dflt.jeff, null);
    assert.deepEqual(dflt.tools.map((t) => t.name), off.tools.map((t) => t.name));

    const a = await dflt.run('memory_record', RECORD);
    const b = await off.run('memory_record', RECORD);
    assert.deepEqual(withoutTs(a.data), withoutTs(b.data));
    assert.equal(a.data.importance, undefined);
    assert.equal(a.data.importanceJudged, undefined);

    const client = new Client({ name: 't', version: '0' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await dflt.server.connect(st);
    await client.connect(ct);
    assert.equal(client.getInstructions(), undefined);
    await client.close();

    // The HTTP entrypoint resolves from its own env the same way.
    createHttpHandler({ memory: { dataDir: tmpDirs[0] }, env: {} });
    assert.equal(calls, 0, 'no JEFF code path may touch the network when unset');
  } finally {
    globalThis.fetch = realFetch;
    for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
  }
});

// -------------------------------------------------------- the client itself

test('client: POSTs /v1/systemone with bearer key, jeff/auto and the family', async () => {
  reply = () => scoreAnswer(3);
  const { client } = mkClient('on');
  const res = await client.decide({ feature: 'f', family: 'fam', state: { a: 1 }, questions: { q: { type: 'noul' } } });
  assert.ok(res.answers);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url, '/v1/systemone');
  assert.equal(seen[0].headers.authorization, 'Bearer test-key');
  assert.deepEqual(seen[0].body, { model: 'jeff/auto', state: { a: 1 }, questions: { q: { type: 'noul' } }, jeff: { decision_family: 'fam' } });
  await client.decide({ feature: 'f', state: 's', questions: {} });
  assert.equal(seen[1].body.jeff, undefined);
});

test('client: non-200, non-JSON, non-JEFF body and timeout all resolve to null and log failed_open', async () => {
  const { client, logs } = mkClient('on');
  const ask = () => client.decide({ feature: 'f', state: 's', questions: {} });
  reply = () => ({ status: 503, json: { error: { code: 'OVERLOADED' } } });
  assert.equal(await ask(), null);
  reply = () => ({ status: 200, raw: 'not json' });
  assert.equal(await ask(), null);
  reply = () => ({ status: 200, json: { hello: 'world' } });
  assert.equal(await ask(), null);
  reply = () => ({ status: 200, json: null });
  assert.equal(await ask(), null);
  reply = () => ({ status: 200, raw: '42' });
  assert.equal(await ask(), null);
  reply = () => ({ status: 200, json: { answers: 'x' } });
  assert.equal(await ask(), null);
  reply = () => ({ ...scoreAnswer(3), delayMs: 600 });
  const before = seen.length;
  assert.equal(await ask(), null);
  assert.equal(seen.length - before, 1, 'a timeout is not retried');
  assert.deepEqual(logs.map((l) => l.reason), ['status 503', 'body not JSON', 'not a JEFF response', 'not a JEFF response', 'not a JEFF response', 'not a JEFF response', 'timeout']);
  assert.ok(logs.every((l) => l.outcome === 'failed_open' && !JSON.stringify(l).includes('test-key')));
});

test('client: one retry on a network error, then gives up', async () => {
  let n = 0;
  const ok = { status: 200, json: async () => ({ answers: {} }) };
  const flaky = createJeffClient(resolveJeffConfig({ BOH_JEFF_URL: 'https://j', BOH_JEFF_KEY: 'k' }), {
    fetchImpl: async () => { n += 1; if (n === 1) throw new Error('ECONNRESET'); return ok; }, log: () => {},
  });
  assert.deepEqual(await flaky.decide({ feature: 'f', state: 's', questions: {} }), { answers: {} });
  assert.equal(n, 2);

  let m = 0;
  const logs = [];
  const down = createJeffClient(resolveJeffConfig({ BOH_JEFF_URL: 'https://j', BOH_JEFF_KEY: 'k' }), {
    fetchImpl: async () => { m += 1; throw new Error('ECONNREFUSED'); }, log: (e) => logs.push(e),
  });
  assert.equal(await down.decide({ feature: 'f', state: 's', questions: {} }), null);
  assert.equal(m, 2);
  assert.equal(logs[0].reason, 'network');
});

test('default logger writes one JSON line to stderr, never stdout', async () => {
  const writes = [];
  const orig = process.stderr.write;
  process.stderr.write = (s) => { writes.push(String(s)); return true; };
  try {
    const c = createJeffClient(resolveJeffConfig({ BOH_JEFF_URL: 'https://j', BOH_JEFF_KEY: 'k' }), {
      fetchImpl: async () => ({ status: 500, json: async () => ({}) }),
    });
    await c.decide({ feature: 'f', state: 's', questions: {} });
  } finally { process.stderr.write = orig; }
  assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(writes[0]), { jeff: true, feature: 'f', outcome: 'failed_open', reason: 'status 500' });
});

test('readScore: only a well-formed score answer counts', () => {
  assert.equal(readScore(null, 'k'), null);
  assert.equal(readScore({ answers: { k: { type: 'noul', noul: 0.5 } } }, 'k'), null);
  assert.equal(readScore({ answers: { k: { type: 'score', score: Number.NaN } } }, 'k'), null);
  assert.deepEqual(readScore({ answers: { k: { type: 'score', score: 1.5 } } }, 'k'), { score: 1.5, confidence: null, probabilities: null });
});

// ------------------------------------------------------ memory importance

test('importance state carries only type and clipped text', () => {
  assert.deepEqual(importanceState('npc', 'Tally'), { type: 'npc', text: 'Tally' });
  const long = importanceState('note', 'x'.repeat(MEMORY_TEXT_MAX_CHARS + 50));
  assert.equal(long.text.length, MEMORY_TEXT_MAX_CHARS + 2);
});

test('judgeImportance: maps the 0-4 score onto 1-5, drops low confidence', async () => {
  const { client } = mkClient('on');
  reply = () => scoreAnswer(2.98);
  assert.deepEqual(await judgeImportance(client, 'event', 't'), { importance: 4, score: 2.98, confidence: 0.9 });
  reply = () => scoreAnswer(3.99, 0.1);
  assert.equal(await judgeImportance(client, 'event', 't'), null);
  reply = () => scoreAnswer(9);          // out of range is clamped, never invented
  assert.equal((await judgeImportance(client, 'event', 't')).importance, 5);
  reply = () => ({ status: 200, json: { answers: {} } });   // PARTIAL_FAILURE: no answer
  assert.equal(await judgeImportance(client, 'event', 't'), null);
});

test('memory_record, mode on: JEFF fills a missing importance and says so', async () => {
  reply = () => scoreAnswer(3.0, 0.95);
  const { client, logs } = mkClient('on');
  const s = mkServer(client);
  const r = await s.run('memory_record', RECORD);
  assert.equal(r.data.importance, 4);
  assert.deepEqual(r.data.importanceJudged, { by: 'jeff', score: 3, confidence: 0.95 });
  assert.equal(s.memory.recent(undefined, 'fen').records[0].importance, 4);
  // Exactly what left the server: type + text. No entities, campaign or token.
  assert.deepEqual(seen[0].body.state, { type: 'event', text: RECORD.text });
  assert.equal(seen[0].body.jeff.decision_family, 'boh_memory_importance');
  assert.ok(!JSON.stringify(seen[0].body).includes('fen'));
  assert.equal(logs.at(-1).stored, 4);
  assert.ok(!JSON.stringify(logs).includes('Aldric'), 'log lines carry numbers, never text');
});

test('memory_record: a host-given importance always wins, JEFF is not asked', async () => {
  reply = () => scoreAnswer(0);
  const { client } = mkClient('on');
  const s = mkServer(client);
  const r = await s.run('memory_record', { ...RECORD, importance: 2 });
  assert.equal(r.data.importance, 2);
  assert.equal(seen.length, 0);
});

test('memory_record, shadow mode: result identical to unset; the judgment is only logged', async () => {
  reply = () => scoreAnswer(4, 0.9);
  const logs = [];
  let done;
  const logged = new Promise((ok) => { done = ok; });
  const client = createJeffClient(resolveJeffConfig({ BOH_JEFF_URL: fakeUrl, BOH_JEFF_KEY: 'k' }),
    { log: (e) => { logs.push(e); done(); } });
  assert.equal(client.mode, 'shadow');
  const shadow = mkServer(client);
  const off = mkServer(null);
  const a = await shadow.run('memory_record', RECORD);
  const b = await off.run('memory_record', RECORD);
  assert.deepEqual(withoutTs(a.data), withoutTs(b.data));
  await logged;
  assert.deepEqual(logs[0], { feature: 'memory_importance', mode: 'shadow', would_store: 5, score: 4, confidence: 0.9, type: 'event' });
  assert.equal(shadow.memory.recent(undefined, 'fen').records[0].importance, undefined);
});

test('memory_record: JEFF down, slow or garbled is identical to unset (mode on)', async () => {
  const off = mkServer(null);
  const baseline = withoutTs((await off.run('memory_record', RECORD)).data);
  const cases = [
    () => ({ status: 500, json: {} }),
    () => ({ status: 200, raw: '<html>' }),
    () => ({ status: 200, json: { answers: { importance: { type: 'score', score: 'high' } } } }),
    () => ({ ...scoreAnswer(4), delayMs: 600 }),
    () => scoreAnswer(4, 0.05),
  ];
  for (const c of cases) {
    reply = c;
    const { client } = mkClient('on');
    const s = mkServer(client);
    const r = await s.run('memory_record', RECORD);
    assert.equal(r.isError, false);
    assert.deepEqual(withoutTs(r.data), baseline);
    assert.equal(s.memory.recent(undefined, 'fen').records[0].importance, undefined);
  }
  // Connection refused: a closed port.
  const closed = createJeffClient(resolveJeffConfig({ BOH_JEFF_URL: 'http://127.0.0.1:9', BOH_JEFF_KEY: 'k', BOH_JEFF_MODE: 'on' }), { log: () => {} });
  const r = await mkServer(closed).run('memory_record', RECORD);
  assert.deepEqual(withoutTs(r.data), baseline);
});

test('memory_record: store errors still surface as tool errors with JEFF on', async () => {
  reply = () => scoreAnswer(2);
  const { client } = mkClient('on');
  const r = await mkServer(client).run('memory_record', { ...RECORD, campaign: '../escape' });
  assert.equal(r.isError, true);
});

test('memory_record: an unauthorised token never reaches JEFF', async () => {
  reply = () => scoreAnswer(2);
  const { client } = mkClient('on');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boh-jeff-closed-'));
  tmpDirs.push(dataDir);
  const sha = createHash('sha256').update('good', 'utf8').digest('hex');
  const { tools } = createServer({ memory: { dataDir, tokenHashes: [sha] }, jeff: client });
  const rec = tools.find((t) => t.name === 'memory_record');
  const r = parse(await rec.handler({ ...RECORD, token: 'bad' }));
  assert.equal(r.isError, true);
  assert.equal(seen.length, 0);
});

// ------------------------------------------------ surface stays the same

test('JEFF adds no tool and no instructions, in either mode', async () => {
  const off = mkServer(null);
  for (const mode of ['shadow', 'on']) {
    const s = mkServer(mkClient(mode).client);
    assert.deepEqual(s.tools.map((t) => t.name), off.tools.map((t) => t.name));
    const client = new Client({ name: 't', version: '0' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await s.server.connect(st);
    await client.connect(ct);
    assert.equal(client.getInstructions(), undefined);
    await client.close();
  }
});

test('HTTP entrypoint: BOH_JEFF_* in its env turns the feature on for every tenant', async () => {
  reply = () => scoreAnswer(1, 0.8);
  const TOKEN = 'jeff-tenant';
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boh-jeff-http-'));
  tmpDirs.push(dataDir);
  const { handler } = createHttpHandler({
    memory: { dataDir, tokenHashes: [createHash('sha256').update(TOKEN, 'utf8').digest('hex')] },
    env: { BOH_JEFF_URL: fakeUrl, BOH_JEFF_KEY: 'k', BOH_JEFF_MODE: 'on' },
  });
  const srv = http.createServer(handler);
  await new Promise((ok) => srv.listen(0, '127.0.0.1', ok));
  try {
    const client = new Client({ name: 't', version: '0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${srv.address().port}/mcp/${TOKEN}`)));
    const out = await client.callTool({ name: 'memory_record', arguments: { campaign: 'c', type: 'npc', text: 'Old Hedda runs the ferry.' } });
    assert.equal(out.structuredContent.importance, 2);
    assert.equal(out.structuredContent.importanceJudged.by, 'jeff');
    assert.equal(out.structuredContent.token, undefined);
    assert.deepEqual(seen[0].body.state, { type: 'npc', text: 'Old Hedda runs the ferry.' });
    await client.close();
  } finally {
    srv.closeAllConnections?.();
    await new Promise((ok) => srv.close(ok));
  }
});

test('a logger that throws never breaks a call', async () => {
  const orig = process.stderr.write;
  process.stderr.write = () => { throw new Error('EPIPE'); };
  try {
    const c = createJeffClient(resolveJeffConfig({ BOH_JEFF_URL: 'https://j', BOH_JEFF_KEY: 'k' }), {
      fetchImpl: async () => ({ status: 500, json: async () => ({}) }),
    });
    assert.equal(await c.decide({ feature: 'f', state: 's', questions: {} }), null);
  } finally { process.stderr.write = orig; }
});

test('judgeImportance: an answer without a confidence is taken as it is', async () => {
  const c = createJeffClient(resolveJeffConfig({ BOH_JEFF_URL: 'https://j', BOH_JEFF_KEY: 'k' }), {
    fetchImpl: async () => ({ status: 200, json: async () => ({ answers: { importance: { type: 'score', score: 0.2 } } }) }),
    log: () => {},
  });
  assert.deepEqual(await judgeImportance(c, 'note', 't'), { importance: 1, score: 0.2, confidence: null });
});

test('createHttpHandler takes an injected client or null', async () => {
  // Both forms of the HTTP seam construct without touching the network.
  assert.ok(createHttpHandler({ memory: { dataDir: tmpDirs[0] }, jeff: null }).handler);
  assert.ok(createHttpHandler({ memory: { dataDir: tmpDirs[0] }, jeff: mkClient('on').client }).handler);
});
