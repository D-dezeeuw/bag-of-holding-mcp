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
  routeState, routeQuestion, firstSentence, ROUTE_DESCRIPTIONS, ROUTE_TEXT_MAX_CHARS,
  createOutcomeReporter, IMPORTANCE_MEMORY_MAX, OUTCOME_MAX_IN_FLIGHT, ROUTE_OUTCOME_WINDOW_MS,
} from '../src/jeff.js';
import { ROUTE_TOOL_NAME, ROUTE_INSTRUCTIONS } from '../src/tools/route.js';
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
  assert.deepEqual(c, { url: 'https://jeff.example', key: 'k', mode: 'shadow', timeoutMs: DEFAULT_JEFF_TIMEOUT_MS, outcomes: true });
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

test('JEFF adds exactly route_request and the instructions, in either mode', async () => {
  const off = mkServer(null);
  for (const mode of ['shadow', 'on']) {
    const s = mkServer(mkClient(mode).client);
    assert.deepEqual(s.tools.map((t) => t.name), [...off.tools.map((t) => t.name), ROUTE_TOOL_NAME]);
    const client = new Client({ name: 't', version: '0' });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await s.server.connect(st);
    await client.connect(ct);
    assert.equal(client.getInstructions(), ROUTE_INSTRUCTIONS);
    const listed = (await client.listTools()).tools;
    assert.equal(listed.length, off.tools.length + 1);
    assert.ok(listed.some((t) => t.name === ROUTE_TOOL_NAME));
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

// ------------------------------------------------------------ route_request

// The tools/list of 0.21.0 with JEFF unset, as the bytes an MCP client
// receives (JSON of listTools().tools). Pinned so the optional routing tool
// provably changes nothing for a deployment without BOH_JEFF_*. A deliberate
// change to any tool's name, description or schema must update this hash.
const TOOLS_LIST_SHA256_0_21_0 = 'a9b0aa69922b42500064fc7331ddd299d32088727b73d0ec4f1858102b2d8625';

async function listOf(s) {
  const client = new Client({ name: 't', version: '0' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await s.server.connect(st);
  await client.connect(ct);
  const tools = (await client.listTools()).tools;
  const instructions = client.getInstructions();
  await client.close();
  return { tools, instructions };
}

test('route_request: not registered without JEFF; tools/list byte-identical to 0.21.0', async () => {
  const saved = {};
  for (const k of ['BOH_JEFF_URL', 'BOH_JEFF_KEY', 'BOH_JEFF_MODE']) { saved[k] = process.env[k]; delete process.env[k]; }
  try {
    for (const s of [mkServer(null), mkServer(undefined)]) {
      assert.ok(!s.tools.some((t) => t.name === ROUTE_TOOL_NAME));
      const { tools, instructions } = await listOf(s);
      assert.equal(instructions, undefined);
      assert.equal(tools.length, 108);
      assert.equal(createHash('sha256').update(JSON.stringify(tools)).digest('hex'), TOOLS_LIST_SHA256_0_21_0);
    }
  } finally {
    for (const [k, v] of Object.entries(saved)) if (v !== undefined) process.env[k] = v;
  }
});

test('route_request: with JEFF the other 108 tools are listed exactly as without it', async () => {
  const off = await listOf(mkServer(null));
  const on = await listOf(mkServer(mkClient('shadow').client));
  assert.deepEqual(on.tools.filter((t) => t.name !== ROUTE_TOOL_NAME), off.tools);
});

const choiceAnswer = (probabilities, confidence = 0.8) => ({
  status: 200,
  json: { id: 'req_r', answers: { tool: { type: 'choice', choice: Object.keys(probabilities)[0], confidence, probabilities } }, jeff: { answers: {} } },
});

test('route_request: success returns the top 3 known tools with probabilities and hints', async () => {
  reply = () => choiceAnswer({ conditions_apply: 0.05, checks_ability_check: 0.8, dice_roll: 0.1, not_a_tool: 0.03, srd_get: 0.02, memory_record: 0 });
  const { client, logs } = mkClient('shadow');   // mode does not matter for a query tool
  const s = mkServer(client);
  const out = await s.run(ROUTE_TOOL_NAME, { request: 'I try to sneak past the guard.' });
  assert.deepEqual(out.data.candidates.map((c) => c.tool), ['checks_ability_check', 'dice_roll', 'conditions_apply']);
  assert.deepEqual(out.data.candidates.map((c) => c.probability), [0.8, 0.1, 0.05]);
  const check = s.tools.find((t) => t.name === 'checks_ability_check');
  assert.equal(out.data.candidates[0].hint, firstSentence(check.description));
  assert.ok(out.data.candidates.every((c) => typeof c.hint === 'string' && c.hint.length > 0 && c.hint.length <= 200 && !c.hint.includes('\n')));
  assert.equal(out.data.confidence, 0.8);
  assert.equal(out.data.reason, undefined);
  assert.deepEqual(logs, [{ feature: 'tool_route', top: 'checks_ability_check', probability: 0.8, confidence: 0.8 }]);
});

test('route_request: sends only the clipped request over the live catalogue with routing descriptions', async () => {
  reply = () => choiceAnswer({ srd_get: 1 });
  const s = mkServer(mkClient('on').client);
  const long = 'x'.repeat(ROUTE_TEXT_MAX_CHARS + 300);
  await s.run(ROUTE_TOOL_NAME, { request: long });
  assert.equal(seen.length, 1);
  const { body, headers, url } = seen[0];
  assert.equal(url, '/v1/systemone');
  assert.equal(headers.authorization, 'Bearer test-key');
  assert.deepEqual(Object.keys(body).sort(), ['jeff', 'model', 'questions', 'state']);
  assert.deepEqual(body.state, { request: 'x'.repeat(ROUTE_TEXT_MAX_CHARS) });
  assert.deepEqual(body.jeff, { decision_family: 'skill_selection' });
  assert.deepEqual(Object.keys(body.questions), ['tool']);
  const criteria = body.questions.tool.criteria;
  assert.equal(Object.keys(criteria).length, 108);
  assert.ok(!(ROUTE_TOOL_NAME in criteria), 'the router does not route to itself');
  for (const [name, text] of Object.entries(ROUTE_DESCRIPTIONS)) assert.equal(criteria[name], text);
  assert.deepEqual(body.questions.tool, routeQuestion(s.tools.filter((t) => t.name !== ROUTE_TOOL_NAME)));
  assert.deepEqual(routeState('short'), { request: 'short' });
});

test('route_request: JEFF down, slow or garbled gives an empty list with a reason, never an error', async () => {
  const cases = [
    () => ({ status: 503, json: {} }),                                             // non-200
    () => ({ status: 200, raw: 'not json at all' }),                              // garbage body
    () => ({ status: 200, json: { hello: 'world' } }),                            // not a JEFF response
    () => ({ status: 200, json: { answers: {} } }),                               // no answer for the key
    () => ({ status: 200, json: { answers: { tool: { type: 'score', score: 2 } } } }),       // wrong answer type
    () => ({ status: 200, json: { answers: { tool: { type: 'choice', probabilities: 'x' } } } }),
    () => choiceAnswer({ made_up_tool: 0.9, another: 0.1 }),                      // no known tool
    () => ({ status: 200, json: { answers: {} }, delayMs: 600 }),                 // timeout (300 ms)
  ];
  for (const r of cases) {
    reply = r;
    const s = mkServer(mkClient('on').client);
    const res = await s.tools.find((t) => t.name === ROUTE_TOOL_NAME).handler({ request: 'I climb the wall.' });
    assert.ok(!res.isError);
    const out = parse(res);
    assert.deepEqual(out.data.candidates, []);
    assert.equal(typeof out.data.reason, 'string');
    assert.ok(out.data.reason.length > 0);
  }
});

test('route_request: an unreachable JEFF fails open too', async () => {
  const client = createJeffClient(resolveJeffConfig({ BOH_JEFF_URL: 'http://127.0.0.1:1', BOH_JEFF_KEY: 'k', BOH_JEFF_TIMEOUT_MS: '300' }), { log: () => {} });
  const s = mkServer(client);
  const out = await s.run(ROUTE_TOOL_NAME, { request: 'What are the stats for a longbow?' });
  assert.deepEqual(out.data.candidates, []);
  assert.match(out.data.reason, /JEFF did not answer/);
});

test('route_request: a client whose decide throws still does not throw', async () => {
  const s = mkServer({ mode: 'on', decide: async () => { throw new Error('boom'); }, log: () => {} });
  const out = await s.run(ROUTE_TOOL_NAME, { request: 'x' });
  assert.deepEqual(out.data.candidates, []);
  assert.ok(out.data.reason);
});

test('firstSentence: one line, first sentence, bounded', () => {
  assert.equal(firstSentence('Roll a die. Then more.'), 'Roll a die.');
  assert.equal(firstSentence('No stop here'), 'No stop here');
  assert.equal(firstSentence('a\n b.  c'), 'a b.');
  assert.equal(firstSentence('y'.repeat(300)).length, 200);
});

// ---------------------------------------------------------------- outcomes
//
// POST /v1/outcomes (0.23.0): the host's explicit importance and the tool the
// host called after route_request go back to JEFF as labels, fire-and-forget.

const rid = (n) => `req_${String(n).padStart(26, '0')}`;
const outcomePosts = () => seen.filter((r) => r.url === '/v1/outcomes');
async function waitFor(pred, ms = 2000) {
  const t0 = Date.now();
  while (!pred()) {
    if (Date.now() - t0 > ms) throw new Error('waitFor timed out');
    await new Promise((ok) => setTimeout(ok, 5));
  }
}
/** Decisions answer from `decide`; outcomes get 202 (or `outcome`). */
function jeffReplies(decide, outcome = () => ({ status: 202, json: { accepted: true } })) {
  return (body) => (body.request_id !== undefined ? outcome(body) : decide(body));
}
const importanceWithId = (id, score = 1, confidence = 0.9) => ({
  status: 200,
  json: { id, answers: { importance: { type: 'score', score, confidence, legend: {}, probabilities: {} } }, jeff: { answers: {} } },
});
const routeWithId = (id, probabilities = { checks_ability_check: 0.9, dice_roll: 0.1 }) => ({
  status: 200,
  json: { id, answers: { tool: { type: 'choice', choice: Object.keys(probabilities)[0], confidence: 0.9, probabilities } }, jeff: { answers: {} } },
});

test('outcomes: on by default with JEFF; BOH_JEFF_OUTCOMES=0/false/off switches them off', () => {
  const base = { BOH_JEFF_URL: 'https://j', BOH_JEFF_KEY: 'k' };
  assert.equal(resolveJeffConfig(base).outcomes, true);
  assert.equal(resolveJeffConfig({ ...base, BOH_JEFF_OUTCOMES: '' }).outcomes, true);
  assert.equal(resolveJeffConfig({ ...base, BOH_JEFF_OUTCOMES: '1' }).outcomes, true);
  for (const off of ['0', 'false', 'off', ' OFF ']) assert.equal(resolveJeffConfig({ ...base, BOH_JEFF_OUTCOMES: off }).outcomes, false);
  assert.equal(createJeffClient(resolveJeffConfig({ ...base, BOH_JEFF_OUTCOMES: '0' })).outcomes, null);
  assert.ok(createJeffClient(resolveJeffConfig(base)).outcomes);
});

test('outcomes, mode on: a later explicit importance on the same record is posted as the label, once', async () => {
  reply = jeffReplies(() => importanceWithId(rid(1), 1));
  const { client, logs } = mkClient('on');
  const s = mkServer(client);
  const judged = await s.run('memory_record', RECORD);
  assert.equal(judged.data.importance, 2);
  assert.equal(outcomePosts().length, 0, 'a judgment alone posts nothing');
  // The host corrects it: the same record (whitespace aside) with an explicit importance.
  const t0 = Date.now();
  const over = await s.run('memory_record', { ...RECORD, text: `  ${RECORD.text.replace(/ /g, '  ')} `, importance: 5 });
  assert.equal(over.data.importance, 5);
  await client.outcomes.settled();
  assert.ok(Date.now() - t0 < 1000);
  const [post] = outcomePosts();
  assert.equal(post.headers.authorization, 'Bearer test-key');
  // Exactly five fields: the decision id, the question key, "label", the level index (5 → 4), the source.
  assert.deepEqual(post.body, { request_id: rid(1), question: 'importance', outcome: 'label', label: 4, source: 'host_override' });
  assert.equal(seen.filter((r) => r.url === '/v1/systemone').length, 1, 'an explicit importance in mode on never asks JEFF');
  assert.deepEqual(logs.at(-1), { feature: 'outcome', question: 'importance', label: 4, status: 202 });
  // Once: a third record of the same text posts nothing more.
  await s.run('memory_record', { ...RECORD, importance: 3 });
  await client.outcomes.settled();
  assert.equal(outcomePosts().length, 1);
  // A different campaign or text is not the same record.
  reply = jeffReplies(() => importanceWithId(rid(2), 1));
  await s.run('memory_record', RECORD);
  await s.run('memory_record', { ...RECORD, campaign: 'other', importance: 4 });
  await s.run('memory_record', { ...RECORD, text: 'Something else entirely.', importance: 4 });
  await client.outcomes.settled();
  assert.equal(outcomePosts().length, 1);
});

test('outcomes, shadow mode: the host\'s own importance labels the background judgment; results unchanged', async () => {
  reply = jeffReplies(() => importanceWithId(rid(3), 0.2));
  const { client, logs } = mkClient('shadow');
  const shadow = mkServer(client);
  const off = mkServer(null);
  const a = await shadow.run('memory_record', { ...RECORD, importance: 4 });
  const b = await off.run('memory_record', { ...RECORD, importance: 4 });
  assert.deepEqual(withoutTs(a.data), withoutTs(b.data));
  await waitFor(() => outcomePosts().length === 1);
  assert.deepEqual(outcomePosts()[0].body, { request_id: rid(3), question: 'importance', outcome: 'label', label: 3, source: 'shadow_pair' });
  assert.deepEqual(seen[0].body.state, { type: 'event', text: RECORD.text });
  await waitFor(() => logs.some((l) => l.host === 4));
  assert.deepEqual(logs.find((l) => l.host === 4), { feature: 'memory_importance', mode: 'shadow', would_store: 1, host: 4, score: 0.2, confidence: 0.9, type: 'event' });
  await client.outcomes.settled();
});

test('outcomes, shadow mode: a record without importance, later re-recorded with one, is labelled too', async () => {
  reply = jeffReplies(() => importanceWithId(rid(4), 2, 0.1));   // too unsure to act on, still a decision
  const { client } = mkClient('shadow');
  const s = mkServer(client);
  await s.run('memory_record', RECORD);
  await waitFor(() => client.outcomes.remembered === 1);
  await s.run('memory_record', { ...RECORD, importance: 2 });
  await client.outcomes.settled();
  assert.deepEqual(outcomePosts().map((p) => p.body), [{ request_id: rid(4), question: 'importance', outcome: 'label', label: 1, source: 'host_override' }]);
  assert.equal(seen.filter((r) => r.url === '/v1/systemone').length, 1, 'an override is not judged again');
});

test('outcomes, routing: the next catalogue tool call is posted as the choice label', async () => {
  reply = jeffReplies(() => routeWithId(rid(5)));
  const { client } = mkClient('shadow');
  const s = mkServer(client);
  const routed = await s.run(ROUTE_TOOL_NAME, { request: 'I climb the wall.' });
  assert.equal(routed.data.candidates[0].tool, 'checks_ability_check');
  assert.equal(routed.data.id, undefined, 'the decision id stays server-side');
  const t0 = Date.now();
  await s.run('guide_list', {});
  assert.ok(Date.now() - t0 < 500);
  await client.outcomes.settled();
  assert.deepEqual(outcomePosts().map((p) => p.body), [{ request_id: rid(5), question: 'tool', outcome: 'label', label: 'guide_list', source: 'next_call' }]);
  // Consumed: the call after that posts nothing.
  await s.run('guide_list', {});
  await client.outcomes.settled();
  assert.equal(outcomePosts().length, 1);
});

test('outcomes, routing: a second route_request, an empty answer or a late call posts nothing for the first', async () => {
  let t = 1_000_000;
  let n = 10;
  reply = jeffReplies(() => routeWithId(rid(n++)));
  const client = createJeffClient(resolveJeffConfig({ BOH_JEFF_URL: fakeUrl, BOH_JEFF_KEY: 'k', BOH_JEFF_TIMEOUT_MS: '300' }), { log: () => {}, now: () => t });
  const s = mkServer(client);
  await s.run(ROUTE_TOOL_NAME, { request: 'a' });            // rid(10)
  await s.run(ROUTE_TOOL_NAME, { request: 'b' });            // rid(11): replaces 10, which posts nothing
  await s.run('srd_get', { kind: 'spell', id: 'fireball' });
  await client.outcomes.settled();
  assert.deepEqual(outcomePosts().map((p) => p.body.request_id), [rid(11)]);
  await s.run(ROUTE_TOOL_NAME, { request: 'c' });            // rid(12)
  t += ROUTE_OUTCOME_WINDOW_MS + 1;
  await s.run('guide_list', {});   // too late
  await client.outcomes.settled();
  assert.equal(outcomePosts().length, 1);
  reply = jeffReplies(() => routeWithId(rid(13), { not_a_tool: 1 }));
  await s.run(ROUTE_TOOL_NAME, { request: 'd' });            // no candidates → no pending decision
  await s.run('guide_list', {});
  await client.outcomes.settled();
  assert.equal(outcomePosts().length, 1);
});

test('outcomes, routing: sessions are per tenant over HTTP-style servers, per process on stdio', async () => {
  reply = jeffReplies(() => routeWithId(rid(20)));
  const { client } = mkClient('on');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boh-jeff-'));
  tmpDirs.push(dataDir);
  const store = createServer({ memory: { dataDir }, jeff: null }).memory;
  const tenant = (token) => {
    const { tools } = createServer({ memoryStore: store, memoryToken: token, jeff: client });
    return (name, args) => tools.find((t) => t.name === name).handler(args);
  };
  await tenant('alpha')(ROUTE_TOOL_NAME, { request: 'x' });
  await tenant('beta')('guide_list', {});   // another tenant: not the label
  await client.outcomes.settled();
  assert.equal(outcomePosts().length, 0);
  await tenant('alpha')('guide_list', {});  // a fresh server, same tenant
  await client.outcomes.settled();
  assert.deepEqual(outcomePosts().map((p) => p.body.label), ['guide_list']);
});

test('outcomes off (BOH_JEFF_OUTCOMES=0): nothing is posted and shadow never asks for a label', async () => {
  reply = jeffReplies((body) => (body.questions.tool ? routeWithId(rid(30)) : importanceWithId(rid(31))));
  for (const mode of ['on', 'shadow']) {
    const { client } = mkClient(mode, { BOH_JEFF_OUTCOMES: '0' });
    assert.equal(client.outcomes, null);
    const s = mkServer(client);
    await s.run('memory_record', RECORD);
    await s.run('memory_record', { ...RECORD, importance: 5 });
    await s.run(ROUTE_TOOL_NAME, { request: 'I climb.' });
    await s.run('guide_list', {});
    await new Promise((ok) => setTimeout(ok, 50));
  }
  assert.equal(outcomePosts().length, 0);
  // on: one importance + one route; shadow: one background importance + one route. None for the explicit record.
  assert.equal(seen.length, 4);
});

test('outcomes, JEFF unset: no reporter, no wrapper, no request', async () => {
  const realFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (...a) => { calls += 1; return realFetch(...a); };
  try {
    const s = mkServer(null);
    await s.run('memory_record', RECORD);
    await s.run('memory_record', { ...RECORD, importance: 5 });
    await s.run('guide_list', {});
    assert.ok(s.tools.every((t) => t.name !== ROUTE_TOOL_NAME));
  } finally { globalThis.fetch = realFetch; }
  assert.equal(calls, 0);
  assert.equal(seen.length, 0);
});

test('outcomes: JEFF slow or down never delays or breaks a tool result', async () => {
  // Decisions answer at once; every outcome post hangs past the 300 ms timeout.
  reply = jeffReplies(
    (body) => (body.questions.tool ? routeWithId(rid(40)) : importanceWithId(rid(41))),
    () => ({ status: 202, json: {}, delayMs: 1500 }),
  );
  const { client, logs } = mkClient('on');
  const s = mkServer(client);
  await s.run('memory_record', RECORD);
  let t0 = Date.now();
  const r = await s.run('memory_record', { ...RECORD, importance: 5 });
  const recordMs = Date.now() - t0;
  assert.equal(r.data.importance, 5);
  await s.run(ROUTE_TOOL_NAME, { request: 'I climb.' });
  t0 = Date.now();
  const roll = await s.run('guide_list', {});
  const toolMs = Date.now() - t0;
  assert.ok(!roll.isError && roll.data);
  assert.ok(recordMs < 100, `record took ${recordMs} ms`);
  assert.ok(toolMs < 100, `tool took ${toolMs} ms`);
  await client.outcomes.settled();
  assert.equal(logs.filter((l) => l.feature === 'outcome' && l.outcome === 'failed_open' && l.reason === 'timeout').length, 2);

  // Unreachable: the post rejects; still nothing surfaces.
  const down = createJeffClient(resolveJeffConfig({ BOH_JEFF_URL: 'http://127.0.0.1:1', BOH_JEFF_KEY: 'k', BOH_JEFF_TIMEOUT_MS: '300' }), { log: () => {} });
  assert.equal(down.outcomes.importanceLabel(rid(42), 3), true);
  await down.outcomes.settled();
});

test('outcome reporter: the importance memory is an LRU of at most 1000; in-flight posts are capped', async () => {
  const bodies = [];
  let release;
  const gate = new Promise((ok) => { release = ok; });
  const fetchImpl = async (url, init) => { bodies.push(JSON.parse(init.body)); await gate; return new Response('{}', { status: 202 }); };
  const logs = [];
  const r = createOutcomeReporter({ url: 'https://j', key: 'k', timeoutMs: 5000 }, { fetchImpl, log: (e) => logs.push(e) });
  for (let i = 0; i < IMPORTANCE_MEMORY_MAX + 5; i++) r.rememberImportance(`fp${i}`, rid(i), `m-${i}`);
  assert.equal(r.remembered, IMPORTANCE_MEMORY_MAX);
  assert.equal(r.importanceOverride('fp0', 3), false, 'the oldest were evicted');
  assert.equal(r.importanceOverride('fp4', 3), false);
  // Touching an entry makes it the newest.
  r.rememberImportance('fp5', rid(5), 'm-5');
  r.rememberImportance('fpX', rid(9999), 'm-x');
  assert.equal(r.importanceOverride('fp5', 3), true);
  assert.equal(r.importanceOverride('fp6', 3), false, 'fp6 was the oldest after fp5 moved up');
  // A malformed id is never remembered or posted.
  r.rememberImportance('bad', 'req_x', 'm-1');
  assert.equal(r.importanceOverride('bad', 3), false);
  assert.equal(r.importanceLabel('nope', 3), false);
  // Two posts are in flight; fill up to the cap, then one more is skipped.
  for (let i = 0; i < OUTCOME_MAX_IN_FLIGHT - 1; i++) assert.equal(r.importanceLabel(rid(i), 1), true);
  assert.equal(r.importanceLabel(rid(77), 1), false);
  assert.ok(logs.some((l) => l.outcome === 'skipped'));
  release();
  await r.settled();
  assert.equal(r.importanceLabel(rid(78), 1), true);
  await r.settled();
  // Privacy: every body is exactly id, question, "label", label, source.
  for (const b of bodies) assert.deepEqual(Object.keys(b).sort(), ['label', 'outcome', 'question', 'request_id', 'source']);
});

test('outcomes: an older JEFF that refuses `source` (422) gets the post again without it, and never again', async () => {
  // A pre-D-099 JEFF: any body with `source` is a 422 naming the field.
  const refused = { status: 422, json: { error: { code: 'INVALID_REQUEST', message: 'invalid outcome', issues: [{ path: 'source', message: 'unknown field "source"' }] } } };
  reply = jeffReplies(
    (body) => (body.questions.tool ? routeWithId(rid(50)) : importanceWithId(rid(51))),
    (body) => ('source' in body ? refused : { status: 202, json: { accepted: true } }),
  );
  const { client, logs } = mkClient('on');
  const s = mkServer(client);
  await s.run('memory_record', RECORD);
  await s.run('memory_record', { ...RECORD, importance: 5 });
  await client.outcomes.settled();
  assert.deepEqual(outcomePosts().map((p) => p.body), [
    { request_id: rid(51), question: 'importance', outcome: 'label', label: 4, source: 'host_override' },
    { request_id: rid(51), question: 'importance', outcome: 'label', label: 4 },
  ]);
  assert.equal(logs.filter((l) => l.outcome === 'source_unsupported').length, 1);
  assert.deepEqual(logs.at(-1), { feature: 'outcome', question: 'importance', label: 4, status: 202 });
  // From now on the field is left out at once: one post, no second log line.
  await s.run(ROUTE_TOOL_NAME, { request: 'I climb.' });
  await s.run('guide_list', {});
  await client.outcomes.settled();
  assert.deepEqual(outcomePosts().slice(2).map((p) => p.body), [{ request_id: rid(50), question: 'tool', outcome: 'label', label: 'guide_list' }]);
  assert.equal(logs.filter((l) => l.outcome === 'source_unsupported').length, 1);
});

test('outcomes: a 422 that does not mention `source` is not retried and keeps the field', async () => {
  reply = jeffReplies(
    () => importanceWithId(rid(60)),
    () => ({ status: 422, json: { error: { code: 'INVALID_REQUEST', issues: [{ path: 'label', message: 'bad label' }] } } }),
  );
  const { client, logs } = mkClient('shadow');
  const s = mkServer(client);
  await s.run('memory_record', { ...RECORD, importance: 2 });
  await waitFor(() => outcomePosts().length === 1);
  await client.outcomes.settled();
  await s.run('memory_record', { ...RECORD, text: 'Another thing.', importance: 3 });
  await waitFor(() => outcomePosts().length === 2);
  await client.outcomes.settled();
  assert.ok(outcomePosts().every((p) => p.body.source === 'shadow_pair'));
  assert.equal(logs.filter((l) => l.outcome === 'source_unsupported').length, 0);
  assert.equal(logs.filter((l) => l.feature === 'outcome' && l.status === 422).length, 2);
});
