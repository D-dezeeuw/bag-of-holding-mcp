// The UI surface — static browser pages, on their own port.
//
// This is deliberately a SECOND listener rather than more routes on the
// MCP handler, because the two surfaces have opposite security postures
// and mixing them is how one inherits the other's mistakes:
//
//   :8091  /mcp/<token>   the token IS the auth; every byte is campaign data.
//   :8099  /  /atlas      no auth, no token, no campaign data — ever.
//
// What it serves is the browser half of @zeeuw/bag-of-holding-client:
// `examples/*.html` and the `src/` modules they import. Those pages bake
// a world IN THE PAGE, so nothing here reads the shelf, the store, or a
// tenant namespace. That is what makes an unauthenticated port safe to
// put behind a public hostname, and it is a property to preserve: if a
// page ever needs real campaign data, it goes through the host's own
// authenticated proxy calling `world_atlas`, not through this listener.
//
// Routes are a table, so adding a page is one row. Everything else falls
// through to static assets, which is what makes the pages' relative
// imports (`../src/ui/atlas.js`) resolve without a build step or a
// <base> tag — from `/atlas` and `/atlas/` alike.

import { createServer as createHttpServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { readFile, stat } from 'node:fs/promises';
import { join, resolve, extname, dirname, sep } from 'node:path';

/**
 * Short paths → the page that answers them. Add a row to add a tool.
 * The client's own `examples/index.html` links the same set, so keep
 * the two in step.
 */
export const UI_ROUTES = Object.freeze({
  '/': 'examples/index.html',
  '/atlas': 'examples/atlas.html',
  '/initiative': 'examples/initiative.html',
});

/**
 * The only directories an un-routed path may reach.
 *
 * The root is a PACKAGE directory: it holds package.json, a lockfile, a
 * README, and whatever a future dependency drops beside them. Containment
 * alone would happily serve all of that, because it only asks "is this
 * under the root" — and the answer is yes. So the root itself is not
 * servable; assets come from the two directories the pages actually
 * import from, and nothing else is addressable at all.
 */
const ASSET_DIRS = Object.freeze(['src', 'examples']);

/**
 * Extensions this surface will serve, and how to label them.
 *
 * An allowlist rather than a lookup-with-fallback, so the answer to "can
 * it serve X" is decided here rather than by what happens to be on disk.
 */
const TYPES = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
});

/**
 * Where the client package is installed. Resolved ONCE, at boot, from a
 * module specifier — never from anything a request carries.
 *
 * `import.meta.resolve` on the BARE specifier, not a subpath and not
 * `createRequire().resolve`. The client's `exports` map declares exactly
 * one entry, `{".": {"import": "./index.js"}}`, so a subpath throws
 * ERR_PACKAGE_PATH_NOT_EXPORTED and a CJS resolve throws too — it looks
 * for a `require` condition that map does not carry. The entry point
 * sits at the package root, so one dirname up is the root.
 */
export function clientRoot() {
  return dirname(fileURLToPath(import.meta.resolve('@zeeuw/bag-of-holding-client')));
}

/**
 * Strip the prefix a reverse proxy prepends.
 *
 * nginx-proxy-manager's Custom Locations forward the full URI, so a
 * location of `/client` arrives here as `/client/src/ui/atlas.js`. Other
 * setups strip it. Rather than demand one, take the prefix as config and
 * accept the path either way — the same container then works behind both,
 * and behind a bare hostname with the prefix unset.
 */
export function stripBase(pathname, basePath) {
  if (!basePath) return pathname;
  const base = `/${basePath.replace(/^\/+|\/+$/g, '')}`;
  if (pathname === base) return '/';
  return pathname.startsWith(`${base}/`) ? pathname.slice(base.length) : pathname;
}

/**
 * Map a request path to a real file inside `root`, or null to refuse.
 *
 * The containment check compares RESOLVED paths, after `..` has already
 * been collapsed — checking the raw request string instead is the classic
 * way to miss an encoded traversal. A trailing separator is appended to
 * the root before the prefix test so a sibling directory whose name
 * merely starts with the root's cannot pass.
 */
export function resolveFile(pathname, root) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;                       // malformed percent-encoding
  }
  if (decoded.includes('\0')) return null;
  const routed = UI_ROUTES[decoded.replace(/\/+$/, '') || '/'] ?? UI_ROUTES[decoded];
  const rel = routed ?? decoded.replace(/^\/+/, '');
  if (rel === '') return null;
  // An un-routed path must name one of the asset directories up front.
  // Note this is checked on the REQUESTED path, before resolution, and
  // containment is checked after — one stops `/package.json`, the other
  // stops `/src/../../elsewhere`. Neither alone is enough.
  if (!routed && !ASSET_DIRS.some((d) => rel === d || rel.startsWith(`${d}/`))) return null;
  const file = resolve(root, rel);
  const within = resolve(root) + sep;
  if (!file.startsWith(within)) return null;
  const type = TYPES[extname(file).toLowerCase()];
  return type ? { file, type, routed: Boolean(routed) } : null;
}

/**
 * Build the request listener. Exported so tests drive it over a real
 * socket without binding a port in the suite's own process tree.
 */
export function createUiHandler({ root = clientRoot(), basePath = process.env.BOH_UI_BASE_PATH ?? '' } = {}) {
  return async function handler(req, res) {
    const send = (code, body, headers = {}) => {
      res.writeHead(code, { 'content-length': Buffer.byteLength(body), ...headers });
      res.end(req.method === 'HEAD' ? undefined : body);
    };
    // Static assets and nothing else. A surface that cannot be written to
    // is a surface that cannot be used to write.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      return send(405, 'Method not allowed', { 'content-type': 'text/plain; charset=utf-8', allow: 'GET, HEAD' });
    }
    const { pathname } = new URL(req.url, 'http://localhost');
    const hit = resolveFile(stripBase(pathname, basePath), root);
    if (!hit) return send(404, 'Not found', { 'content-type': 'text/plain; charset=utf-8' });
    try {
      const info = await stat(hit.file);
      if (!info.isFile()) return send(404, 'Not found', { 'content-type': 'text/plain; charset=utf-8' });
      const body = await readFile(hit.file);
      send(200, body, {
        'content-type': hit.type,
        // Pages change with a deploy and are cheap; modules are the bulk
        // and are versioned by the image they came from. Neither is
        // content-hashed, so nothing here may be cached immutably.
        'cache-control': hit.type.startsWith('text/html') ? 'no-cache' : 'public, max-age=300',
        'x-content-type-options': 'nosniff',
      });
    } catch {
      send(404, 'Not found', { 'content-type': 'text/plain; charset=utf-8' });
    }
  };
}

/**
 * Start the UI listener, or return null when it is switched off.
 *
 * Off is the default everywhere except the container: `BOH_UI_PORT`
 * unset means the stdio path, the test suite and an embedding host get
 * exactly the surface they had before this file existed. A root that
 * cannot be resolved (the client not installed) is reported and skipped
 * rather than fatal — the MCP surface is the product; the pages are a
 * convenience, and losing them must not take a table's server down.
 */
export async function listenUi({ env = process.env, host = '0.0.0.0', out = console, ...opts } = {}) {
  const port = Number.parseInt(env.BOH_UI_PORT ?? '', 10);
  if (!Number.isInteger(port) || port <= 0) return null;
  let root;
  try {
    root = opts.root ?? clientRoot();
    await stat(join(root, UI_ROUTES['/']));
  } catch (err) {
    out.error(`UI surface disabled: ${err.message}`);
    return null;
  }
  const server = createHttpServer(createUiHandler({ ...opts, root }));
  await new Promise((resolve) => server.listen(port, host, resolve));
  out.log(`bag-of-holding-mcp UI listening on :${port} (${Object.keys(UI_ROUTES).join(' ')})`);
  return server;
}
