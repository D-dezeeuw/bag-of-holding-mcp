import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer, createSessions } from '../index.js';

const tmpDirs = [];
function tmpDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boh-server-'));
  tmpDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

test('createServer wires every tool module so the AI gets the full surface in one shot', () => {
  const { server, sessions, memory, tools } = createServer({ memory: { dataDir: tmpDir(), tokenHashes: [] } });
  assert.ok(server);
  assert.ok(sessions);
  assert.ok(memory);
  const names = new Set(tools.map((t) => t.name));
  assert.equal(names.size, 100, 'tool count is part of the README contract');
  assert.equal(names.size, tools.length, 'no two tools may share a name');
  for (const expected of [
    'engine_create_session', 'engine_get_roll_log', 'engine_verify_log',
    'dice_roll', 'dice_parse',
    'checks_ability_check', 'checks_saving_throw',
    'combat_attack_roll', 'combat_damage_roll', 'combat_apply_mastery',
    'conditions_apply', 'conditions_exhaustion_status',
    'xp_level_for_xp', 'xp_award_milestone',
    'movesets_legal',
    'beats_validate', 'beats_thread_advance',
    'character_derive_sheet', 'character_skill_ability_map',
    'srd_list', 'srd_get', 'srd_dump',
    // Two distinct world surfaces share the world_ prefix without colliding:
    // generated cartridges (catalog/begin/node/lineage/commit/replay) and the
    // hand-authored static packs (list/overview/region/faction/npc/...).
    'world_catalog', 'world_begin', 'world_node', 'world_lineage', 'world_commit', 'world_replay',
    'memory_status', 'memory_record', 'memory_search', 'memory_recent',
    'memory_forget', 'memory_export', 'memory_import',
    'state_save', 'state_load', 'state_list', 'state_delete',
    'world_list', 'world_overview', 'world_region', 'world_faction',
    'world_npc', 'world_hooks', 'world_secrets', 'world_search',
    'guide_list', 'guide_get',
    'image_status', 'image_enable', 'image_disable', 'image_observe',
    'campaign_list', 'campaign_delete'
  ]) {
    assert.ok(names.has(expected), `missing tool: ${expected}`);
  }
});

test('createServer() with no options stands up on environment defaults without touching the disk', () => {
  const { server, sessions, memory, tools } = createServer();
  assert.ok(server);
  assert.ok(sessions.get());
  assert.equal(tools.length, 100);
  assert.equal(typeof memory.dataDir, 'string');
});

test('createServer accepts an injected session registry so embedders can share state across servers', () => {
  const sessions = createSessions();
  sessions.create({ id: 'shared', seed: 99 });
  const { sessions: returned } = createServer({ sessions, memory: { dataDir: tmpDir(), tokenHashes: [] } });
  assert.equal(returned, sessions, 'same registry instance should flow through');
  assert.ok(returned.list().some((s) => s.id === 'shared'));
});

test('the memory config flows through to the tools and the exposed store', async () => {
  const dataDir = tmpDir();
  const { memory, tools } = createServer({ memory: { dataDir, tokenHashes: [] } });
  assert.equal(memory.dataDir, dataDir);
  const statusTool = tools.find((t) => t.name === 'memory_status');
  const result = await statusTool.handler({});
  assert.equal(result.structuredContent.dataDir, dataDir);
  // The embedder-facing store and the tool surface hit the same disk.
  memory.record(undefined, 'shared-fen', { type: 'note', text: 'written via the store api' });
  const status = await statusTool.handler({});
  assert.deepEqual(status.structuredContent.campaigns, [{ campaign: 'shared-fen', records: 1, stateKeys: 0 }]);
});

test('guides are served as MCP prompts and resources over a real client connection', async () => {
  const { server } = createServer({ memory: { dataDir: tmpDir(), tokenHashes: [] } });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-host', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  try {
    const { prompts } = await client.listPrompts();
    assert.deepEqual(
      prompts.map((p) => p.name).sort(),
      ['campaign-quickstart', 'run-combat', 'session-recap']
    );

    // The quickstart prompt threads its arguments into the message…
    const withArgs = await client.getPrompt({
      name: 'campaign-quickstart',
      arguments: { campaign: 'curse-of-the-fen', world: 'greyfen-march' }
    });
    const text = withArgs.messages[0].content.text;
    assert.ok(text.includes('"curse-of-the-fen"'));
    assert.ok(text.includes('"greyfen-march"'));
    assert.ok(text.includes('# Campaign quickstart'));

    // …and reads cleanly without them.
    const bare = await client.getPrompt({ name: 'campaign-quickstart', arguments: {} });
    assert.ok(!bare.messages[0].content.text.includes('for campaign "'));

    const recap = await client.getPrompt({ name: 'session-recap', arguments: { campaign: 'fen' } });
    assert.ok(recap.messages[0].content.text.includes('state_load'));

    const combat = await client.getPrompt({ name: 'run-combat', arguments: {} });
    assert.ok(combat.messages[0].content.text.includes('# Combat flow'));

    // Assert on the guide resources specifically rather than a bare count —
    // the world cartridge surface registers its own (world://catalog) and
    // more may follow; a total-count assertion would break on every one.
    const { resources } = await client.listResources();
    const guides = resources.filter((r) => r.uri.startsWith('boh://guide/'));
    assert.equal(guides.length, 6);
    for (const resource of guides) {
      const { contents } = await client.readResource({ uri: resource.uri });
      assert.equal(contents[0].mimeType, 'text/markdown');
      assert.ok(contents[0].text.startsWith('# '), `${resource.uri} serves markdown`);
    }
  } finally {
    await client.close();
    await server.close();
  }
});
