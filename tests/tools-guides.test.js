import { test } from 'node:test';
import assert from 'node:assert/strict';
import { guideTools } from '../src/tools/guides.js';
import { GUIDES } from '../src/skills/guides.js';
import { parse } from './_helpers.js';

const tools = guideTools();
const byName = new Map(tools.map((t) => [t.name, t]));
const run = async (name, args = {}) => parse(await byName.get(name).handler(args));

test('guide_list names the seven guides with usable summaries', async () => {
  const { data } = await run('guide_list');
  assert.deepEqual(
    data.guides.map((g) => g.id).sort(),
    ['campaign-quickstart', 'combat-flow', 'dm-style', 'memory-protocol', 'narration-style', 'session-zero', 'war-thread']
  );
  for (const g of data.guides) assert.ok(g.title && g.description);
});

test('guide_get serves full markdown that references the real tool names', async () => {
  const { data } = await run('guide_get', { id: 'campaign-quickstart' });
  assert.equal(data.title, 'Campaign quickstart');
  for (const mention of ['engine_create_session', 'memory_recent', 'state_save', 'world_overview', 'memory_export']) {
    assert.ok(data.text.includes(mention), `quickstart should mention ${mention}`);
  }
  const protocol = await run('guide_get', { id: 'memory-protocol' });
  assert.ok(protocol.data.text.includes('memory_forget'));
});

test('the war-thread preset casts the premise from real tool surfaces', async () => {
  const { data } = await run('guide_get', { id: 'war-thread' });
  // The preset must drive the same ids the engine holds: powers, the
  // sovereign face, the war state paths world_commit can actually write.
  for (const mention of ['world_powers', 'world_begin', 'warState.wars', 'seatOf', 'crown.legitimacy', 'state_save']) {
    assert.ok(data.text.includes(mention), `war-thread should mention ${mention}`);
  }
});

test('guide_get rejects unknown ids with the available list', async () => {
  const result = await run('guide_get', { id: 'how-to-win' });
  assert.equal(result.isError, true);
  assert.match(result.message, /Unknown guide.*campaign-quickstart/s);
});

test('the guide registry is frozen and every guide is substantial', () => {
  assert.ok(Object.isFrozen(GUIDES));
  for (const [id, guide] of Object.entries(GUIDES)) {
    assert.ok(guide.text.length > 500, `${id} should be a real guide, not a stub`);
    assert.ok(guide.text.startsWith('# '), `${id} should be markdown`);
  }
});
