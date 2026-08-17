import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveImageConfig, tierFor, splitDataUri, renderImage,
  DEFAULT_IMAGE_MODEL, DEFAULT_IMAGE_BASE_URL,
} from '../src/images.js';

test('a server without a key renders nothing, and says so by returning null', () => {
  assert.equal(resolveImageConfig({}), null);
  assert.equal(resolveImageConfig({ BOH_IMAGE_API_KEY: '' }), null);
  assert.equal(resolveImageConfig({ BOH_IMAGE_API_KEY: '   ' }), null);
  assert.equal(resolveImageConfig({ BOH_IMAGE_MODEL: 'x/y' }), null, 'a model without a key is still no renderer');
});

test('a configured server falls back to the OpenRouter defaults', () => {
  assert.deepEqual(resolveImageConfig({ BOH_IMAGE_API_KEY: ' sk-abc ' }), {
    key: 'sk-abc', baseUrl: DEFAULT_IMAGE_BASE_URL, model: DEFAULT_IMAGE_MODEL,
  });
  assert.deepEqual(resolveImageConfig({
    BOH_IMAGE_API_KEY: 'sk-abc', BOH_IMAGE_URL: 'http://localhost:1234/v1', BOH_IMAGE_MODEL: 'local/sdxl',
  }), { key: 'sk-abc', baseUrl: 'http://localhost:1234/v1', model: 'local/sdxl' });
});

test('the tier is read from the deployment, never from the caller', () => {
  assert.equal(tierFor(undefined, {}), 'free');
  assert.equal(tierFor(null, {}), 'free');
  assert.equal(tierFor(null, { BOH_IMAGE_TIER: 'patron' }), 'patron');
  assert.equal(tierFor(null, { BOH_IMAGE_TIER: 'legendary' }), 'free', 'an unknown tier is not an upgrade');
  assert.equal(tierFor(null, { BOH_IMAGE_TIER: 'toString' }), 'free', 'nor is a prototype key');
});

test('a tenant tier beats the server default, and a bad one does not', () => {
  // The registry names the tier; BOH_IMAGE_TIER is the fallback for tenants
  // it says nothing about.
  assert.equal(tierFor({ tier: 'studio' }, {}), 'studio');
  assert.equal(tierFor({ tier: 'studio' }, { BOH_IMAGE_TIER: 'free' }), 'studio');
  assert.equal(tierFor({ tier: null }, { BOH_IMAGE_TIER: 'patron' }), 'patron',
    'an env-allowlist tenant carries no tier and falls back');
  assert.equal(tierFor({ tier: 'legendary' }, { BOH_IMAGE_TIER: 'patron' }), 'patron',
    'an unknown tenant tier falls back rather than inventing an allowance');
  assert.equal(tierFor({ tier: 'toString' }, {}), 'free');
  assert.equal(tierFor({ tier: 7 }, {}), 'free', 'a non-string tier is not a tier');
});

test('splitDataUri takes data-URIs and rejects everything else', () => {
  assert.deepEqual(splitDataUri('data:image/png;base64,AAAA'), { mimeType: 'image/png', data: 'AAAA' });
  assert.deepEqual(splitDataUri('data:image/jpeg;base64,QQ=='), { mimeType: 'image/jpeg', data: 'QQ==' });
  for (const junk of ['https://example.com/cat.png', 'data:image/png,notbase64', '', null, undefined, 42]) {
    assert.equal(splitDataUri(junk), null);
  }
});

test('renderImage passes the prompt through and reports the decoded size', async () => {
  const seen = [];
  const out = await renderImage(
    { key: 'sk-abc', baseUrl: 'http://x/v1', model: 'test/model' },
    'a lantern in fog',
    { generate: async (config, opts) => { seen.push({ config, opts }); return 'data:image/png;base64,AAAABBBB'; } }
  );
  assert.deepEqual(out, { ok: true, model: 'test/model', mimeType: 'image/png', data: 'AAAABBBB', bytes: 6 });
  assert.deepEqual(seen[0].config, { key: 'sk-abc', baseUrl: 'http://x/v1' });
  assert.deepEqual(seen[0].opts, { prompt: 'a lantern in fog', model: 'test/model' });
});

test('every render failure is an answer, never a throw', async () => {
  const config = { key: 'sk', baseUrl: 'http://x/v1', model: 'test/model' };

  const unconfigured = await renderImage(null, 'p');
  assert.equal(unconfigured.ok, false);
  assert.match(unconfigured.error, /BOH_IMAGE_API_KEY/);

  // generateImage returns null for a transport error or a response with no
  // image in it — the common case, and not an exception.
  const empty = await renderImage(config, 'p', { generate: async () => null });
  assert.equal(empty.ok, false);
  assert.match(empty.error, /no image/);

  // A provider that answers with a plain URL instead of a data-URI.
  const url = await renderImage(config, 'p', { generate: async () => 'https://cdn.example/cat.png' });
  assert.equal(url.ok, false);

  // And the pathological case: the generator itself blew up.
  const thrown = await renderImage(config, 'p', { generate: async () => { throw new Error('socket hang up'); } });
  assert.equal(thrown.ok, false);
  assert.match(thrown.error, /socket hang up/);
  const oddThrow = await renderImage(config, 'p', { generate: async () => { throw 'nope'; } });
  assert.equal(oddThrow.ok, false);
  assert.match(oddThrow.error, /nope/);
});
