import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { parseRegistry, createTenantRegistry, REGISTRY_VERSION } from '../src/memory/registry.js';

const tmpDirs = [];
function mkdir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boh-registry-'));
  tmpDirs.push(dir);
  return dir;
}
after(() => {
  for (const dir of tmpDirs) fs.rmSync(dir, { recursive: true, force: true });
});

const sha256 = (s) => createHash('sha256').update(s, 'utf8').digest('hex');
const HASH_A = sha256('token-a');
const HASH_B = sha256('token-b');

/** Write a registry file and return its path. */
function writeRegistry(dir, doc, name = 'tenants.json') {
  const file = path.join(dir, name);
  fs.writeFileSync(file, typeof doc === 'string' ? doc : JSON.stringify(doc), 'utf8');
  return file;
}

/** A registry harness with a hand-cranked clock and captured warnings. */
function mkRegistry(file, { ttlMs = 2000 } = {}) {
  const warnings = [];
  let clock = 1_000;
  const registry = createTenantRegistry({
    file, ttlMs, now: () => clock, warn: (m) => warnings.push(m),
  });
  return { registry, warnings, tick: (ms) => { clock += ms; } };
}

// ---- parseRegistry ---------------------------------------------------------

test('parseRegistry reads a well-formed document', () => {
  const { tenants, warnings } = parseRegistry(JSON.stringify({
    version: 1,
    tenants: {
      [HASH_A]: { tier: 'patron', status: 'active' },
      [HASH_B]: { tier: 'free', status: 'suspended' },
    },
  }));
  assert.deepEqual(warnings, []);
  assert.deepEqual(tenants.get(HASH_A), { tier: 'patron', status: 'active', ns: null });
  assert.deepEqual(tenants.get(HASH_B), { tier: 'free', status: 'suspended', ns: null });
});

test('parseRegistry uppercases hashes down to the canonical form', () => {
  const { tenants } = parseRegistry(JSON.stringify({
    version: 1, tenants: { [HASH_A.toUpperCase()]: { status: 'active' } },
  }));
  assert.equal(tenants.get(HASH_A).status, 'active');
});

test('parseRegistry keeps the reserved ns field and drops a non-string one', () => {
  const { tenants } = parseRegistry(JSON.stringify({
    version: 1,
    tenants: {
      [HASH_A]: { status: 'active', ns: 't-abc123' },
      [HASH_B]: { status: 'active', ns: 42 },
    },
  }));
  assert.equal(tenants.get(HASH_A).ns, 't-abc123');
  assert.equal(tenants.get(HASH_B).ns, null);
});

test('parseRegistry passes an unknown tier through — tier vocabulary belongs to the image layer', () => {
  const { tenants } = parseRegistry(JSON.stringify({
    version: 1, tenants: { [HASH_A]: { tier: 'platinum', status: 'active' } },
  }));
  assert.equal(tenants.get(HASH_A).tier, 'platinum');
});

test('parseRegistry nulls a non-string tier', () => {
  const { tenants } = parseRegistry(JSON.stringify({
    version: 1, tenants: { [HASH_A]: { tier: 7, status: 'active' } },
  }));
  assert.equal(tenants.get(HASH_A).tier, null);
});

test('a missing status is suspended, and says so', () => {
  // Fail closed: the expensive mistake is a revoked tenant that keeps
  // playing, not an active one that has to be re-enabled.
  const { tenants, warnings } = parseRegistry(JSON.stringify({
    version: 1, tenants: { [HASH_A]: { tier: 'free' } },
  }));
  assert.equal(tenants.get(HASH_A).status, 'suspended');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /has no status/);
});

test('an unrecognised status is suspended, and says so', () => {
  const { tenants, warnings } = parseRegistry(JSON.stringify({
    version: 1, tenants: { [HASH_A]: { status: 'ACTIVE' } },
  }));
  assert.equal(tenants.get(HASH_A).status, 'suspended');
  assert.match(warnings[0], /unrecognised status/);
});

test('an explicit suspended status is not warned about', () => {
  const { warnings } = parseRegistry(JSON.stringify({
    version: 1, tenants: { [HASH_A]: { status: 'suspended' } },
  }));
  assert.deepEqual(warnings, []);
});

test('one malformed entry is skipped without revoking the rest', () => {
  const { tenants, warnings } = parseRegistry(JSON.stringify({
    version: 1,
    tenants: {
      'not-a-hash': { status: 'active' },
      [HASH_A]: null,
      [HASH_B]: { status: 'active' },
    },
  }));
  assert.equal(tenants.size, 1);
  assert.equal(tenants.get(HASH_B).status, 'active');
  assert.equal(warnings.length, 2);
  assert.match(warnings[0], /not a sha256 hex digest/);
  assert.match(warnings[1], /entry is not an object/);
});

test('an array entry is not mistaken for an object', () => {
  const { tenants, warnings } = parseRegistry(JSON.stringify({
    version: 1, tenants: { [HASH_A]: ['active'] },
  }));
  assert.equal(tenants.size, 0);
  assert.match(warnings[0], /entry is not an object/);
});

test('structural problems throw rather than degrade', () => {
  for (const [doc, pattern] of [
    ['{ not json', /not valid JSON/],
    ['null', /must be a JSON object/],
    ['[]', /must be a JSON object/],
    [JSON.stringify({ version: 2, tenants: {} }), /Unsupported tenant registry version 2/],
    [JSON.stringify({ tenants: {} }), /Unsupported tenant registry version undefined/],
    [JSON.stringify({ version: 1 }), /"tenants" must be an object/],
    [JSON.stringify({ version: 1, tenants: [] }), /"tenants" must be an object/],
    [JSON.stringify({ version: 1, tenants: null }), /"tenants" must be an object/],
  ]) {
    assert.throws(() => parseRegistry(doc), pattern, `expected ${pattern} for ${doc}`);
  }
});

test('the exported version is the one the parser enforces', () => {
  assert.equal(REGISTRY_VERSION, 1);
  assert.doesNotThrow(() => parseRegistry(JSON.stringify({ version: REGISTRY_VERSION, tenants: {} })));
});

// ---- createTenantRegistry --------------------------------------------------

test('an unconfigured registry knows nothing and never touches the disk', () => {
  const { registry } = mkRegistry(null);
  registry.start();
  assert.equal(registry.configured, false);
  assert.equal(registry.file, null);
  assert.equal(registry.get(HASH_A), null);
  assert.equal(registry.size, 0);
});

test('start() loads the file and get() reads it back', () => {
  const dir = mkdir();
  const file = writeRegistry(dir, { version: 1, tenants: { [HASH_A]: { tier: 'studio', status: 'active' } } });
  const { registry, warnings } = mkRegistry(file);
  registry.start();
  assert.equal(registry.configured, true);
  assert.equal(registry.file, file);
  assert.equal(registry.size, 1);
  assert.equal(registry.get(HASH_A).tier, 'studio');
  assert.equal(registry.get(HASH_B), null);
  assert.deepEqual(warnings, []);
});

test('start() on an absent file is fine — the panel may not have written it yet', () => {
  const dir = mkdir();
  const { registry, warnings } = mkRegistry(path.join(dir, 'missing.json'));
  assert.doesNotThrow(() => registry.start());
  assert.equal(registry.size, 0);
  assert.deepEqual(warnings, []);
});

test('start() throws on a corrupt file, so a bad deploy fails closed at boot', () => {
  const dir = mkdir();
  const file = writeRegistry(dir, '{ half-written');
  const { registry } = mkRegistry(file);
  assert.throws(() => registry.start(), /not valid JSON/);
});

test('the throw names the file, because the message reaches an operator', () => {
  const dir = mkdir();
  const file = writeRegistry(dir, JSON.stringify({ version: 99, tenants: {} }));
  const { registry } = mkRegistry(file);
  assert.throws(() => registry.start(), new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('start() surfaces per-entry warnings', () => {
  const dir = mkdir();
  const file = writeRegistry(dir, { version: 1, tenants: { bogus: { status: 'active' } } });
  const { registry, warnings } = mkRegistry(file);
  registry.start();
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /tenant registry: ignoring tenant key/);
});

test('a change is picked up once the TTL expires, and not before', () => {
  const dir = mkdir();
  const file = writeRegistry(dir, { version: 1, tenants: { [HASH_A]: { status: 'active' } } });
  const { registry, tick } = mkRegistry(file, { ttlMs: 2000 });
  registry.start();
  assert.equal(registry.get(HASH_A).status, 'active');

  writeRegistry(dir, { version: 1, tenants: { [HASH_A]: { status: 'suspended' } } });
  // Inside the TTL the old answer stands.
  tick(1999);
  assert.equal(registry.get(HASH_A).status, 'active');
  // Past it, the new one does.
  tick(2);
  assert.equal(registry.get(HASH_A).status, 'suspended');
});

test('a rewrite of identical length still reloads — mtime moves even when size does not', () => {
  const dir = mkdir();
  const file = writeRegistry(dir, { version: 1, tenants: { [HASH_A]: { status: 'active' } } });
  const { registry, tick } = mkRegistry(file, { ttlMs: 10 });
  registry.start();
  const before = fs.statSync(file).mtimeMs;
  // Same byte count, different meaning.
  writeRegistry(dir, { version: 1, tenants: { [HASH_A]: { status: 'suspendd' } } });
  fs.utimesSync(file, new Date(), new Date(before + 5000));
  tick(50);
  assert.equal(registry.get(HASH_A).status, 'suspended');
});

test('an unchanged file is not reparsed', () => {
  const dir = mkdir();
  const file = writeRegistry(dir, { version: 1, tenants: { bogus: { status: 'active' } } });
  const { registry, warnings, tick } = mkRegistry(file, { ttlMs: 10 });
  registry.start();
  assert.equal(warnings.length, 1);
  tick(50);
  registry.get(HASH_A);
  tick(50);
  registry.get(HASH_A);
  // Still one: the stamp matched, so the malformed entry was not re-reported.
  assert.equal(warnings.length, 1);
});

test('a file that goes corrupt at runtime keeps the last good copy and warns once', () => {
  const dir = mkdir();
  const file = writeRegistry(dir, { version: 1, tenants: { [HASH_A]: { status: 'active' } } });
  const { registry, warnings, tick } = mkRegistry(file, { ttlMs: 10 });
  registry.start();

  writeRegistry(dir, 'truncated {');
  tick(50);
  assert.equal(registry.get(HASH_A).status, 'active', 'live tables keep playing');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /unreadable/);

  // Repaired: the retry picks it up, because a failed parse never claimed
  // the stamp.
  writeRegistry(dir, { version: 1, tenants: { [HASH_A]: { status: 'suspended' } } });
  tick(50);
  assert.equal(registry.get(HASH_A).status, 'suspended');
});

test('a vanished file keeps the last good copy and warns exactly once', () => {
  const dir = mkdir();
  const file = writeRegistry(dir, { version: 1, tenants: { [HASH_A]: { status: 'active' } } });
  const { registry, warnings, tick } = mkRegistry(file, { ttlMs: 10 });
  registry.start();

  fs.rmSync(file);
  tick(50);
  assert.equal(registry.get(HASH_A).status, 'active');
  tick(50);
  registry.get(HASH_A);
  assert.equal(warnings.length, 1, 'a missing file must not spam the log every TTL');
  assert.match(warnings[0], /disappeared/);

  // Restored: the warning arms again for next time.
  writeRegistry(dir, { version: 1, tenants: { [HASH_B]: { status: 'active' } } });
  tick(50);
  assert.equal(registry.get(HASH_B).status, 'active');
  assert.equal(registry.get(HASH_A), null);
  fs.rmSync(file);
  tick(50);
  registry.get(HASH_B);
  assert.equal(warnings.length, 2);
});

test('a registry that was never there does not warn when it stays absent', () => {
  const dir = mkdir();
  const { registry, warnings, tick } = mkRegistry(path.join(dir, 'nope.json'), { ttlMs: 10 });
  registry.start();
  tick(50);
  assert.equal(registry.get(HASH_A), null);
  assert.deepEqual(warnings, []);
});

test('a file that appears after startup is picked up without a restart', () => {
  const dir = mkdir();
  const file = path.join(dir, 'late.json');
  const { registry, tick } = mkRegistry(file, { ttlMs: 10 });
  registry.start();
  assert.equal(registry.get(HASH_A), null);

  writeRegistry(dir, { version: 1, tenants: { [HASH_A]: { status: 'active' } } }, 'late.json');
  tick(50);
  assert.equal(registry.get(HASH_A).status, 'active');
});

test('the default TTL is used when none is given', () => {
  const dir = mkdir();
  const file = writeRegistry(dir, { version: 1, tenants: { [HASH_A]: { status: 'active' } } });
  let clock = 0;
  const registry = createTenantRegistry({ file, now: () => clock, warn: () => {} });
  registry.start();
  writeRegistry(dir, { version: 1, tenants: { [HASH_A]: { status: 'suspended' } } });
  clock += 1999;
  assert.equal(registry.get(HASH_A).status, 'active');
  clock += 2;
  assert.equal(registry.get(HASH_A).status, 'suspended');
});

test('the default warn channel is console.error', () => {
  const dir = mkdir();
  const file = writeRegistry(dir, { version: 1, tenants: { bogus: {} } });
  const seen = [];
  const original = console.error;
  console.error = (msg) => seen.push(msg);
  try {
    createTenantRegistry({ file }).start();
  } finally {
    console.error = original;
  }
  assert.equal(seen.length, 1);
  assert.match(seen[0], /^bag-of-holding-mcp: tenant registry:/);
});

test('the default clock is Date.now', () => {
  const dir = mkdir();
  const file = writeRegistry(dir, { version: 1, tenants: { [HASH_A]: { status: 'active' } } });
  const registry = createTenantRegistry({ file, ttlMs: 0, warn: () => {} });
  registry.start();
  writeRegistry(dir, { version: 1, tenants: { [HASH_A]: { status: 'suspended' } } });
  // ttlMs 0 means every read re-stats, so no sleeping is needed.
  assert.equal(registry.get(HASH_A).status, 'suspended');
});

test('a directory at the registry path fails the boot loudly', () => {
  // The Docker footgun: a bind mount whose source does not exist makes the
  // daemon create a directory at the target. statSync succeeds, readFileSync
  // does not, and the old behaviour was to boot with an empty allowlist and
  // 404 every tenant with nothing in the log.
  const dir = mkdir();
  const asDir = path.join(dir, 'tenants.json');
  fs.mkdirSync(asDir);
  const { registry } = mkRegistry(asDir);
  assert.throws(() => registry.start(), /cannot be read \(EISDIR\)/);
});

test('an unreadable file at runtime keeps the last good copy and says why', () => {
  const dir = mkdir();
  const file = writeRegistry(dir, { version: 1, tenants: { [HASH_A]: { status: 'active' } } });
  const { registry, warnings, tick } = mkRegistry(file, { ttlMs: 10 });
  registry.start();

  // Swap the file for a directory of the same name: a stat still succeeds,
  // so this exercises the read failure rather than the absent-file path.
  fs.rmSync(file);
  fs.mkdirSync(file);
  tick(50);
  assert.equal(registry.get(HASH_A).status, 'active');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /cannot be read \(EISDIR\); keeping 1 tenant/);
});
