// The UI surface — the unauthenticated port.
//
// This listener has no token check, so what it CANNOT serve is the whole
// contract. The refusal tests below are the point of the file; the happy
// path is three lines.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';

import {
  createUiHandler, resolveFile, stripBase, clientRoot, listenUi, UI_ROUTES,
} from '../src/ui-server.js';

let server, base, root;

before(async () => {
  root = clientRoot();
  server = http.createServer(createUiHandler({ root }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => { await new Promise((r) => server.close(r)); });

const get = (path, opts) => fetch(`${base}${path}`, opts);

test('the routes serve the pages a host links', async () => {
  for (const [route, file] of Object.entries(UI_ROUTES)) {
    const res = await get(route);
    assert.equal(res.status, 200, `${route} → ${file}`);
    assert.match(res.headers.get('content-type'), /^text\/html/);
    assert.match(await res.text(), /<!doctype html>/i);
  }
  // `/atlas/` must work as well as `/atlas`: a proxy that appends a
  // trailing slash must not 404, and the pages' relative imports resolve
  // to the same place either way.
  assert.equal((await get('/atlas/')).status, 200);
});

test('the modules the pages import are served as JavaScript', async () => {
  // The atlas page's own first import. If this 404s or arrives as
  // text/plain the page is a blank screen, so assert both.
  const res = await get('/src/worldgen/cartridge.js');
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /^text\/javascript/);
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(await res.text(), /export function catalogEntry|export async function bakeCartridge/);
});

test('it refuses to leave its root, however the path is spelled', async () => {
  const escapes = [
    '/../../../etc/passwd',
    '/src/../../../etc/passwd',
    '/%2e%2e%2f%2e%2e%2fetc%2fpasswd',
    '/src/%2e%2e/%2e%2e/package.json',
  ];
  for (const path of escapes) {
    const res = await get(path);
    assert.equal(res.status, 404, `escaped with ${path}`);
  }
  // resolveFile is the guard itself — assert it directly too, since a
  // proxy could normalise a path before the handler ever sees it.
  assert.equal(resolveFile('/../secrets.json', root), null);
  assert.equal(resolveFile('/\0.html', root), null);
  assert.equal(resolveFile('/%zz', root), null);
  // A sibling directory whose name merely starts with the root's must
  // not pass the containment prefix test.
  assert.equal(resolveFile(`/../${root.split('/').pop()}-evil/x.js`, root), null);
});

test('the package root is not a document root', async () => {
  // The root is a PACKAGE directory. Containment alone would serve every
  // file in it, so un-routed paths must name an asset directory. Note
  // WHATWG URL collapses %2e%2e for us before the handler sees it, which
  // is exactly how `/src/%2e%2e/%2e%2e/package.json` becomes a plain
  // request for `/package.json` — caught here rather than by the
  // traversal guard.
  assert.equal((await get('/package.json')).status, 404);
  assert.equal((await get('/index.js')).status, 404);
  assert.equal(resolveFile('/package.json', root), null);
  assert.equal(resolveFile('/LICENSE', root), null);
  assert.equal(resolveFile('/index.js', root), null);
  // …while the two asset directories the pages import from are reachable.
  assert.equal(resolveFile('/src/ui/atlas.js', root)?.type, 'text/javascript; charset=utf-8');
  assert.equal(resolveFile('/examples/atlas.html', root)?.type, 'text/html; charset=utf-8');
  // A directory whose name merely starts with an allowed one is not one.
  assert.equal(resolveFile('/srcret/x.js', root), null);
});

test('it is read-only: anything but GET/HEAD is refused', async () => {
  for (const method of ['POST', 'PUT', 'DELETE', 'PATCH']) {
    const res = await get('/', { method });
    assert.equal(res.status, 405, method);
    assert.equal(res.headers.get('allow'), 'GET, HEAD');
  }
  const head = await get('/atlas', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
});

test('a proxy prefix is stripped when configured, and only then', () => {
  assert.equal(stripBase('/client/atlas', '/client'), '/atlas');
  assert.equal(stripBase('/client', '/client'), '/');
  assert.equal(stripBase('/client/src/ui/atlas.js', 'client'), '/src/ui/atlas.js');
  // Unset: the path is already root-relative because the proxy stripped it.
  assert.equal(stripBase('/atlas', ''), '/atlas');
  // A path that merely starts with the same letters is not a prefix match.
  assert.equal(stripBase('/clientele/atlas', '/client'), '/clientele/atlas');
});

test('the prefixed surface serves the same pages', async () => {
  const prefixed = http.createServer(createUiHandler({ root, basePath: '/client' }));
  await new Promise((r) => prefixed.listen(0, '127.0.0.1', r));
  const at = `http://127.0.0.1:${prefixed.address().port}`;
  try {
    assert.equal((await fetch(`${at}/client`)).status, 200);
    assert.equal((await fetch(`${at}/client/atlas`)).status, 200);
    assert.equal((await fetch(`${at}/client/src/ui/atlas.js`)).status, 200);
  } finally {
    await new Promise((r) => prefixed.close(r));
  }
});

test('the surface is absent unless BOH_UI_PORT says otherwise', async () => {
  // Every path but the container: stdio hosts, the suite, an embedder.
  assert.equal(await listenUi({ env: {} }), null);
  assert.equal(await listenUi({ env: { BOH_UI_PORT: '' } }), null);
  assert.equal(await listenUi({ env: { BOH_UI_PORT: 'not-a-port' } }), null);
});

test('a client with no pages disables the surface instead of killing the server', async () => {
  const said = [];
  const out = { log: () => {}, error: (m) => said.push(m) };
  const ui = await listenUi({ env: { BOH_UI_PORT: '8123' }, root: '/nonexistent-client', out });
  assert.equal(ui, null);
  assert.equal(said.length, 1);
  assert.match(said[0], /UI surface disabled/);
});
