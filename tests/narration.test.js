// The sidecar-narrator slice (0.12.0). What must hold: the tool renders
// the SAME prompt the client toolkit renders (one contract, two
// surfaces — drift here would give the sidecar a different narrator
// than the browser host); the engine's numbers cross verbatim; the
// schema rides along so the host can validate replies; and unknown
// kinds refuse instead of hallucinating a template.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { narrationPrompt } from '@zeeuw/bag-of-holding-client';
import { createServer } from '../src/server.js';

const payload = (res) => JSON.parse(res.content[0].text);

test('narration_prompt renders the client contract verbatim, schema attached', async () => {
  const { tools } = createServer({ memory: { dataDir: mkdtempSync(join(tmpdir(), 'boh-narr-')), tokenHashes: [] } });
  const tool = tools.find((t) => t.name === 'narration_prompt');
  assert.ok(tool, 'the tool is served');
  assert.match(tool.description, /SIDECAR NARRATORS ONLY/);

  const moment = { attacker: 'Vex', target: 'goblin', total: 18, ac: 15, damage: 7 };
  const rendered = payload(await tool.handler({ kind: 'attack.hit', payload: moment, tone: 'grim' }));
  // One contract, two surfaces: byte-identical to the client's own render.
  const reference = narrationPrompt('attack.hit', moment, { tone: 'grim' });
  assert.equal(rendered.system, reference.system);
  assert.equal(rendered.user, reference.user);
  assert.equal(rendered.cacheKey, reference.cacheKey);
  // The numbers crossed verbatim and the guardrail is in the system half.
  assert.match(rendered.user, /18 vs 15/);
  assert.match(rendered.system, /never change numbers/);
  // The reply schema rides along for host-side validation.
  assert.equal(rendered.schema.required[0], 'narration');
  // Unknown kinds refuse at the zod boundary or the handler — either
  // way, no hallucinated template.
  const bad = await tool.handler({ kind: 'taunt.witty', payload: {} });
  assert.match(bad.content[0].text, /unknown kind|invalid/i);
});
