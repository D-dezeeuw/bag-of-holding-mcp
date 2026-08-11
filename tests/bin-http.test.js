import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// bin/http.js is what the container's ENTRYPOINT runs, so it is the one
// file whose failure mode is "the deployment is down". Everything else is
// tested in-process; this one gets spawned for real.

const ENTRY = fileURLToPath(new URL('../bin/http.js', import.meta.url));
const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');

/** Spawn the entrypoint and collect its output until `ready` matches or it exits. */
function run(env, { waitFor } = {}) {
  const child = spawn(process.execPath, [ENTRY], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (d) => { stdout += d; });
  child.stderr.on('data', (d) => { stderr += d; });
  return new Promise((resolve) => {
    const settle = (code) => resolve({ code, stdout, stderr, child });
    if (waitFor) {
      const timer = setInterval(() => {
        if (waitFor.test(stdout)) { clearInterval(timer); settle(null); }
      }, 25);
      child.on('exit', (code) => { clearInterval(timer); settle(code); });
    } else {
      child.on('exit', settle);
    }
  });
}

test('the entrypoint refuses to start without a token allowlist, and says why', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boh-bin-'));
  try {
    const { code, stderr } = await run({
      BOH_DATA_DIR: dir,
      BOH_MEMORY_TOKEN_HASHES: '',
      BOH_HTTP_PORT: '0'
    });
    // Exit 2, not 1: the same fail-closed contract the compose file relies
    // on — a deploy missing its allowlist must die loudly rather than serve
    // every campaign to whoever finds the URL.
    assert.equal(code, 2);
    assert.match(stderr, /FATAL/);
    assert.match(stderr, /BOH_MEMORY_TOKEN_HASHES/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('with an allowlist it binds, announces itself, and serves /health', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boh-bin-'));
  let child;
  try {
    const started = await run(
      {
        BOH_DATA_DIR: dir,
        BOH_MEMORY_TOKEN_HASHES: sha256('a-token'),
        // Port 0 would be unaddressable from out here, so pick a high one
        // and let a bind clash fail the test loudly rather than silently.
        BOH_HTTP_PORT: '8199'
      },
      { waitFor: /listening on/ }
    );
    child = started.child;
    assert.equal(started.code, null, `process exited early: ${started.stderr}`);
    assert.match(started.stdout, /listening on :8199/);
    assert.match(started.stdout, /POST \/mcp\/<token>/);

    const health = await fetch('http://127.0.0.1:8199/health');
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { ok: true });

    // And the auth boundary is live on the real process, not just in-process.
    const denied = await fetch('http://127.0.0.1:8199/mcp/wrong-token', { method: 'POST' });
    assert.equal(denied.status, 404);
  } finally {
    child?.kill();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
