import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toolResult, toolError } from '../src/_result.js';

test('toolResult ships both text and structuredContent so AI clients and programmatic embedders both see the payload', () => {
  const r = toolResult({ x: 1 });
  assert.equal(r.content[0].type, 'text');
  assert.equal(JSON.parse(r.content[0].text).x, 1);
  assert.deepEqual(r.structuredContent, { x: 1 });
});

test('toolError preserves the message from an Error so plugin-author pointers survive the wire', () => {
  const r = toolError(new Error('bad thing'));
  assert.equal(r.isError, true);
  assert.equal(r.content[0].text, 'bad thing');
});

test('toolError stringifies non-Error throwables (covers `throw "string"` and `throw { code }` paths)', () => {
  const r = toolError('plain string');
  assert.equal(r.isError, true);
  assert.equal(r.content[0].text, 'plain string');
});
