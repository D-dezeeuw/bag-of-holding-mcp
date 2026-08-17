import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHttpHandler, listen, main } from '../src/http.js';
import { createMemoryStore } from '../src/memory/store.js';
import { bakeCartridge } from '@zeeuw/bag-of-holding-client';

// The deployed surface, exercised the way the internet will: a real socket,
// real HTTP, and the real MCP client speaking streamable-HTTP. Anything that
// passes here is what nginx-proxy-manager will be proxying.

const TOKEN_A = 'tenant-alpha-token';
const TOKEN_B = 'tenant-beta-token';
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

let server;
let base;
let dataDir;

before(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boh-http-'));
  const worldsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boh-http-worlds-'));
  fs.writeFileSync(path.join(worldsDir, 'world-1234.json'), JSON.stringify(await bakeCartridge(1234)));
  const { handler } = createHttpHandler({
    memory: { dataDir, tokenHashes: [sha256(TOKEN_A), sha256(TOKEN_B)] },
    worldsDir
  });
  server = http.createServer(handler);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  fs.rmSync(dataDir, { recursive: true, force: true });
});

/** Connect an MCP client to one tenant's URL. */
async function connect(token) {
  const client = new Client({ name: 'test-host', version: '0.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp/${token}`)));
  return client;
}

test('/health is open and says nothing but "a server is here"', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true });
});

test('unknown tokens and malformed paths are indistinguishable 404s', async () => {
  // A distinct 401 for "right shape, wrong secret" would make the endpoint an
  // oracle for brute-forcing tokens. Everything that isn't a valid tenant
  // looks the same from outside.
  for (const url of [
    `${base}/mcp/not-a-real-token`,
    `${base}/mcp/`,
    `${base}/mcp`,
    `${base}/`,
    `${base}/mcp/${TOKEN_A}/extra`,
    `${base}/admin`
  ]) {
    const res = await fetch(url, { method: 'POST' });
    assert.equal(res.status, 404, `${url} should 404`);
    assert.deepEqual(await res.json(), { error: 'Not found' });
  }
});

test('a URL-encoded token still resolves to its tenant', async () => {
  const res = await fetch(`${base}/mcp/${encodeURIComponent(TOKEN_A)}`, { method: 'POST' });
  assert.notEqual(res.status, 404, 'a valid token must not 404 merely for being encoded');
});

test('the full tool surface is served over HTTP', async () => {
  const client = await connect(TOKEN_A);
  try {
    const { tools } = await client.listTools();
    assert.equal(tools.length, 107);
    for (const expected of ['dice_roll', 'memory_record', 'world_overview', 'guide_get', 'state_save']) {
      assert.ok(tools.some((t) => t.name === expected), `missing ${expected}`);
    }
  } finally { await client.close(); }
});

test('the token is absent from EVERY schema over HTTP — the model cannot see or leak it', async () => {
  const client = await connect(TOKEN_A);
  try {
    const { tools } = await client.listTools();
    // Not just the known families: any tool that grows a `token` parameter in
    // pinned mode is a leak, whoever adds it. Memory, state, images and the
    // world playthrough tools are all tenant-scoped today.
    for (const tool of tools) {
      const props = Object.keys(tool.inputSchema.properties ?? {});
      assert.ok(!props.includes('token'), `${tool.name} still exposes a token parameter`);
    }
    const scoped = tools.filter((t) => /^(memory_|state_|image_|campaign_|world_begin|world_node|world_commit|world_replay)/.test(t.name));
    assert.equal(scoped.length, 21, 'the tenant-scoped families are all present');
  } finally { await client.close(); }
});

test('a campaign round-trips over HTTP and lands in the tenant namespace on disk', async () => {
  const client = await connect(TOKEN_A);
  try {
    const written = await client.callTool({
      name: 'memory_record',
      arguments: {
        campaign: 'fen', type: 'npc',
        text: 'Met Tally beneath the sluice-gates; she counts in exact numbers.',
        entities: ['Tally'], importance: 4
      }
    });
    assert.equal(written.structuredContent.id, 'm-1');

    const found = await client.callTool({
      name: 'memory_search', arguments: { campaign: 'fen', query: 'Tally sluice' }
    });
    assert.equal(found.structuredContent.hits[0].id, 'm-1');
    assert.equal(found.structuredContent.retrieval, 'lexical');

    await client.callTool({
      name: 'state_save', arguments: { campaign: 'fen', key: 'party', data: { pcs: [{ name: 'Bren' }] } }
    });
    const loaded = await client.callTool({ name: 'state_load', arguments: { campaign: 'fen', key: 'party' } });
    assert.deepEqual(loaded.structuredContent.data.pcs[0], { name: 'Bren' });

    // On disk it is the hashed namespace, never the token itself.
    const namespaces = fs.readdirSync(dataDir);
    assert.ok(namespaces.includes(`t-${sha256(TOKEN_A).slice(0, 16)}`));
    for (const ns of namespaces) assert.ok(!ns.includes(TOKEN_A));
  } finally { await client.close(); }
});

test('tenants cannot see each other: same campaign name, separate shelves', async () => {
  const alpha = await connect(TOKEN_A);
  const beta = await connect(TOKEN_B);
  try {
    await beta.callTool({
      name: 'memory_record',
      arguments: { campaign: 'fen', type: 'note', text: 'A beta-only secret about the drowned bell.' }
    });
    const betaSees = await beta.callTool({ name: 'memory_search', arguments: { campaign: 'fen', query: 'beta secret bell' } });
    assert.equal(betaSees.structuredContent.hits.length, 1);

    const alphaSees = await alpha.callTool({ name: 'memory_search', arguments: { campaign: 'fen', query: 'beta secret bell' } });
    assert.equal(alphaSees.structuredContent.hits.length, 0, 'tenant A must not see tenant B\'s memories');

    const alphaStatus = await alpha.callTool({ name: 'memory_status', arguments: {} });
    const betaStatus = await beta.callTool({ name: 'memory_status', arguments: {} });
    assert.notEqual(alphaStatus.structuredContent.namespace, betaStatus.structuredContent.namespace);
  } finally { await alpha.close(); await beta.close(); }
});

test('engine sessions are per-tenant, so two tables can use the same session id without sharing dice', async () => {
  const alpha = await connect(TOKEN_A);
  const beta = await connect(TOKEN_B);
  try {
    // Same id, same seed, in both tenants: a shared registry would reject the
    // second as "Session already exists" and, worse, silently share a rollLog.
    for (const client of [alpha, beta]) {
      const created = await client.callTool({
        name: 'engine_create_session', arguments: { id: 'curse-of-the-fen', seed: 4242 }
      });
      assert.equal(created.structuredContent.id, 'curse-of-the-fen');
    }

    await alpha.callTool({ name: 'dice_roll', arguments: { spec: '1d20', session: 'curse-of-the-fen' } });
    const alphaLog = await alpha.callTool({ name: 'engine_get_roll_log', arguments: { session: 'curse-of-the-fen' } });
    const betaLog = await beta.callTool({ name: 'engine_get_roll_log', arguments: { session: 'curse-of-the-fen' } });
    assert.equal(alphaLog.structuredContent.rollLog.length, 1);
    assert.equal(betaLog.structuredContent.rollLog.length, 0, 'tenant B\'s rollLog must be untouched by A');
  } finally { await alpha.close(); await beta.close(); }
});

test('engine sessions persist across requests within a tenant', async () => {
  // Stateless HTTP means a new MCP server per request; the per-tenant engine
  // registry is what keeps `engine_create_session` meaningful for the calls
  // that follow it, in this connection or the next.
  const first = await connect(TOKEN_A);
  await first.callTool({ name: 'engine_create_session', arguments: { id: 'persisted', seed: 7 } });
  await first.close();

  const second = await connect(TOKEN_A);
  try {
    const listed = await second.callTool({ name: 'engine_list_sessions', arguments: {} });
    assert.ok(listed.structuredContent.sessions.some((s) => s.id === 'persisted'));
    const roll = await second.callTool({ name: 'dice_roll', arguments: { spec: '1d20', session: 'persisted' } });
    assert.ok(roll.structuredContent.total >= 1);
  } finally { await second.close(); }
});

test('handler failures become a 500 rather than a hung socket', async () => {
  // A store whose authorization check throws stands in for any unexpected
  // fault inside the request path.
  const exploding = {
    ...createMemoryStore({ dataDir, tokenHashes: [sha256(TOKEN_A)] }),
    isAuthorized: () => { throw new Error('store exploded'); }
  };
  const { handler } = createHttpHandler({ memoryStore: exploding });
  const srv = http.createServer(handler);
  await new Promise((resolve) => srv.listen(0, '127.0.0.1', resolve));
  try {
    const res = await fetch(`http://127.0.0.1:${srv.address().port}/mcp/whatever`, { method: 'POST' });
    assert.equal(res.status, 500);
    const body = await res.json();
    assert.equal(body.error, 'Internal error');
    assert.match(body.detail, /store exploded/);
  } finally {
    await new Promise((resolve) => srv.close(resolve));
  }
});

test('listen() refuses to serve without a token allowlist, and binds when given one', async () => {
  const open = fs.mkdtempSync(path.join(os.tmpdir(), 'boh-open-'));
  try {
    await assert.rejects(
      () => listen({ port: 0, memory: { dataDir: open, tokenHashes: [] } }),
      /Refusing to serve MCP over HTTP with no token allowlist/
    );
    const httpServer = await listen({
      port: 0, host: '127.0.0.1', memory: { dataDir: open, tokenHashes: [sha256(TOKEN_A)] }
    });
    try {
      const res = await fetch(`http://127.0.0.1:${httpServer.address().port}/health`);
      assert.equal(res.status, 200);
    } finally {
      await new Promise((resolve) => httpServer.close(resolve));
    }
  } finally {
    fs.rmSync(open, { recursive: true, force: true });
  }
});

test('an error after the response has started just closes the socket', async () => {
  // Once headers are on the wire a 500 body can't be sent — writing one
  // would corrupt an in-flight stream. Driven with a stub response because
  // the real path needs a fault mid-stream, which no client can provoke.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boh-late-'));
  try {
    const store = createMemoryStore({ dataDir: dir, tokenHashes: [sha256(TOKEN_A)] });
    const { handler } = createHttpHandler({
      memoryStore: { ...store, isAuthorized: () => { throw new Error('late fault'); } }
    });
    let ended = false;
    let wrote = false;
    await handler(
      { url: `/mcp/${TOKEN_A}`, method: 'POST', headers: {} },
      { headersSent: true, on() {}, writeHead() { wrote = true; }, end() { ended = true; } }
    );
    assert.ok(ended, 'socket should be closed');
    assert.ok(!wrote, 'no second set of headers should be written');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('createHttpHandler exposes the store it built so an embedder can share it', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boh-share-'));
  try {
    const store = createMemoryStore({ dataDir: dir, tokenHashes: [sha256(TOKEN_A)] });
    const built = createHttpHandler({ memoryStore: store });
    assert.equal(built.store, store);
    assert.equal(createHttpHandler({ memory: { dataDir: dir, tokenHashes: [] } }).store.authRequired, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('main() boots on a configured port and reports exit code 0', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boh-main-'));
  const said = [];
  try {
    const { code, server: booted } = await main({
      env: { BOH_HTTP_PORT: '0' },
      out: { log: (m) => said.push(m), error: (m) => said.push(m) },
      host: '127.0.0.1',
      memory: { dataDir: dir, tokenHashes: [sha256(TOKEN_A)] }
    });
    try {
      assert.equal(code, 0);
      assert.match(said[0], /listening on :0/);
      const res = await fetch(`http://127.0.0.1:${booted.address().port}/health`);
      assert.equal(res.status, 200);
    } finally {
      await new Promise((resolve) => booted.close(resolve));
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('main() defaults the port to 8091 — the value the Dockerfile and compose expect', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boh-main-'));
  const said = [];
  try {
    const { code, server: booted } = await main({
      env: {},
      out: { log: (m) => said.push(m), error: (m) => said.push(m) },
      host: '127.0.0.1',
      memory: { dataDir: dir, tokenHashes: [sha256(TOKEN_A)] }
    });
    try {
      assert.equal(code, 0);
      assert.equal(booted.address().port, 8091);
    } finally {
      await new Promise((resolve) => booted.close(resolve));
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('main() fails closed with exit code 2 and a FATAL line when the allowlist is missing', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boh-main-'));
  const errors = [];
  try {
    const { code, server: booted } = await main({
      env: { BOH_HTTP_PORT: '0' },
      out: { log: () => {}, error: (m) => errors.push(m) },
      memory: { dataDir: dir, tokenHashes: [] }
    });
    assert.equal(code, 2);
    assert.equal(booted, null, 'nothing should be listening after a refusal');
    assert.match(errors[0], /^FATAL: Refusing to serve MCP over HTTP/);
    assert.match(errors[0], /BOH_MEMORY_TOKEN_HASHES/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('with no options at all, the handler configures itself from the environment', () => {
  // This is how the container runs it: bin/http.js passes only a port, and
  // every store setting arrives as BOH_* in the compose file.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boh-env-'));
  const saved = { data: process.env.BOH_DATA_DIR, hashes: process.env.BOH_MEMORY_TOKEN_HASHES };
  try {
    process.env.BOH_DATA_DIR = dir;
    process.env.BOH_MEMORY_TOKEN_HASHES = sha256(TOKEN_A);
    const { store } = createHttpHandler();
    assert.equal(store.dataDir, dir);
    assert.equal(store.authRequired, true);
    assert.equal(store.isAuthorized(TOKEN_A), true);
    assert.equal(store.isAuthorized(TOKEN_B), false);
  } finally {
    for (const [key, value] of [['BOH_DATA_DIR', saved.data], ['BOH_MEMORY_TOKEN_HASHES', saved.hashes]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a playthrough spans SEPARATE HTTP connections — begin, then commit, then replay', async () => {
  // The old in-process world sessions could not do this at all: stateless
  // mode builds a fresh McpServer per request, so a `ws-N` id minted by one
  // call was garbage by the next. The playthrough persists in the tenant
  // namespace, so three independent connections are three visits to the
  // same campaign.
  const c1 = await connect(TOKEN_A);
  try {
    const begun = await c1.callTool({ name: 'world_begin', arguments: { campaign: 'fen', world: 'world-1234' } });
    assert.equal(begun.structuredContent.campaign, 'fen');
  } finally { await c1.close(); }

  const c2 = await connect(TOKEN_A);
  try {
    const committed = await c2.callTool({ name: 'world_commit', arguments: {
      campaign: 'fen',
      patches: [{ turn: 1, target: 'npc.vera', path: 'mood', to: 'wary' }],
    } });
    assert.equal(committed.structuredContent.appended, 1);
  } finally { await c2.close(); }

  const c3 = await connect(TOKEN_A);
  try {
    const replay = await c3.callTool({ name: 'world_replay', arguments: { campaign: 'fen' } });
    assert.equal(replay.structuredContent.applied, 1);
    assert.equal(replay.structuredContent.state['npc.vera'].mood, 'wary');
  } finally { await c3.close(); }

  // And tenant B cannot see tenant A's campaign at all.
  const cb = await connect(TOKEN_B);
  try {
    const other = await cb.callTool({ name: 'world_replay', arguments: { campaign: 'fen' } });
    assert.equal(other.isError, true, "another tenant's campaign name is a different campaign");
  } finally { await cb.close(); }
});
