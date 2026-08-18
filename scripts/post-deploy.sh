#!/usr/bin/env bash
# Post-deploy smoke check, invoked by docker/deploy.sh.
#
# Three questions: is the MCP surface serving, is the campaign data still
# readable, and did semantic search actually come up? The third is a warning
# rather than a failure on purpose — memory search degrades to lexical by
# design when the sidecars are down, so a slow-booting embedding container
# is a quality dip, not an outage, and must not read as a failed deploy.
set -uo pipefail

COMPOSE_FILE=${COMPOSE_FILE:-docker-compose.yml}
status=0
dc() { docker compose -f "$COMPOSE_FILE" "$@"; }

echo "    waiting for the MCP surface to answer..."
for i in $(seq 1 30); do
  if dc exec -T mcp node -e "
fetch('http://127.0.0.1:'+(process.env.BOH_HTTP_PORT||8091)+'/health')
  .then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))
" 2>/dev/null; then
    echo "    health OK (after ${i}s)"
    break
  fi
  if [ "$i" = 30 ]; then
    echo "    WARNING: /health did not answer within 30s"
    status=1
  fi
  sleep 1
done

# An unknown token must 404, not 500 and not 200. This is the auth boundary
# for the whole deployment, so assert it on every deploy rather than trusting
# that nobody loosened it.
echo "    checking that an unknown token is refused..."
code=$(dc exec -T mcp node -e "
fetch('http://127.0.0.1:'+(process.env.BOH_HTTP_PORT||8091)+'/mcp/definitely-not-a-real-token', { method: 'POST' })
  .then(r => { console.log(r.status); process.exit(0); }).catch(() => { console.log('ERR'); process.exit(0); })
" 2>/dev/null | tr -d '\r')
if [ "$code" = "404" ]; then
  echo "    unknown token rejected (404)"
else
  echo "    WARNING: unknown token returned '$code', expected 404"
  status=1
fi

# The data volume is the irreplaceable artefact; make sure the container can
# actually read it (a bad mount or ownership change shows up here, not three
# sessions later when someone tries to save a party).
echo "    checking the data volume is readable/writable..."
if dc exec -T mcp node -e "
const fs = require('fs'); const dir = process.env.BOH_DATA_DIR || '/data';
const probe = dir + '/.deploy-probe';
fs.writeFileSync(probe, String(Date.now())); fs.unlinkSync(probe);
const tenants = fs.readdirSync(dir).filter(d => d !== 'lost+found');
console.log('    data dir OK, ' + tenants.length + ' tenant namespace(s)');
" 2>/dev/null; then
  :
else
  echo "    WARNING: data dir not writable by the container"
  status=1
fi

# The world shelf. Informational like the sidecar probe below, and for the
# same reason: an empty shelf is a legitimate deployment. But it is also what
# a forgotten BOH_SEED_WORLDS looks like, and the symptom otherwise surfaces
# much later as world_begin answering "unknown world" at somebody's table.
# Say the number out loud on every deploy so the two cases are told apart
# here rather than there.
echo "    checking the world shelf..."
dc exec -T mcp node -e "
const fs = require('fs'); const dir = process.env.BOH_WORLDS_DIR;
if (!dir) return console.log('    no BOH_WORLDS_DIR — generated worlds are off');
let files = [];
try { files = fs.readdirSync(dir).filter(f => /^world-[^.]+\.json\$/.test(f)); }
catch (e) { return console.log('    shelf unreadable at ' + dir + ' (' + e.message + ')'); }
const revs = fs.existsSync(dir + '/revisions') ? fs.readdirSync(dir + '/revisions').length : 0;
console.log(files.length
  ? '    shelf OK, ' + files.length + ' cartridge(s), ' + revs + ' revision file(s)'
  : '    shelf is EMPTY — set BOH_SEED_WORLDS in .env, or bake cartridges into the boh-worlds volume');
" 2>/dev/null || echo "    WARNING: could not read the world shelf"

# The browser pages, when the surface is switched on. Static assets only, so
# this asks one question: does the atlas page come back? A 404 here means the
# client package in the image shipped without examples/, which is invisible
# from the MCP side and looks like a proxy fault from the outside.
echo "    checking the UI surface..."
dc exec -T mcp node -e "
const port = process.env.BOH_UI_PORT;
if (!port) return console.log('    BOH_UI_PORT unset — browser pages are off');
const base = 'http://127.0.0.1:' + port + (process.env.BOH_UI_BASE_PATH || '');
Promise.all(['/', '/atlas'].map(p =>
  fetch(base + p, { signal: AbortSignal.timeout(5000) })
    .then(r => '    ' + (p === '/' ? 'home' : 'atlas') + ': HTTP ' + r.status + (r.ok ? '' : ' — NOT ok'))
    .catch(e => '    ' + p + ': unreachable (' + e.message + ')')
)).then(lines => { lines.forEach(l => console.log(l)); process.exit(0); });
" 2>/dev/null || echo "    WARNING: could not probe the UI surface"

# Semantic search: reachable sidecars mean hybrid retrieval; unreachable means
# lexical. Report which one this deploy actually landed on.
echo "    checking the semantic sidecars..."
dc exec -T mcp node -e "
const qdrant = process.env.BOH_QDRANT_URL, emb = process.env.BOH_EMBEDDINGS_URL;
// Send the api-key exactly as the server does. Probing without it made a
// correctly-secured Qdrant report 401 and read like a failure, which is a
// worse outcome than no check at all — a health probe that cries wolf gets
// ignored on the day it is right.
const key = process.env.BOH_QDRANT_API_KEY;
const headers = key ? { 'api-key': key } : {};
const probe = (name, url, opts) => fetch(url, { signal: AbortSignal.timeout(5000), ...opts })
  .then(r => console.log('    ' + name + ': HTTP ' + r.status + (r.ok ? '' : ' — NOT ok')))
  .catch(e => console.log('    ' + name + ': unreachable (' + e.message + ') — search stays lexical'));
Promise.all([
  probe('qdrant', qdrant + '/collections', { headers }),
  probe('embeddings', emb.replace(/\/v1\$/, '') + '/health')
]).then(() => process.exit(0));
" 2>/dev/null || echo "    WARNING: could not probe the sidecars"

exit $status
