import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

// Guards on the deployment files. These are not style checks — each one
// encodes a property that, if broken, either widens what a deploy destroys
// or exposes a sidecar to the internet. They are cheap to assert and the
// failures they prevent are expensive and silent.

const read = (rel) => fs.readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), 'utf8');
const compose = read('docker-compose.yml');
const dockerfile = read('Dockerfile');
const deploy = read('docker/deploy.sh');

const projectName = compose.match(/^name:\s*(\S+)/m)[1];
const containerNames = [...compose.matchAll(/^\s*container_name:\s*(\S+)/gm)].map((m) => m[1]);

test('every container name carries the project prefix, so the deploy sweep reaches all of them', () => {
  // deploy.sh force-removes containers matching `^<project>-` that belong to
  // another compose project. A container outside that prefix is invisible to
  // the single-instance guarantee.
  assert.equal(projectName, 'bag-of-holding-mcp');
  assert.equal(containerNames.length, 3);
  for (const name of containerNames) {
    assert.ok(name.startsWith(`${projectName}-`), `${name} must start with ${projectName}-`);
  }
});

test('the project name is specific enough not to reap another stack', () => {
  // The sweep matches by name prefix across projects, so a vague project
  // name makes this deploy destructive to unrelated containers. The sibling
  // engine repo is called bag-of-holding; ours must be strictly longer and
  // more specific than that.
  assert.ok(projectName.startsWith('bag-of-holding-'), 'must not be the bare engine repo name');
  assert.ok(projectName.length > 'bag-of-holding'.length);
});

test('image pruning is scoped to this project, never host-wide', () => {
  // A bare `docker image prune -f` reaps every dangling image on a shared
  // host — including other apps' rollback targets.
  assert.doesNotMatch(deploy, /docker image prune -f\s*$/m, 'unscoped prune found');
  assert.match(deploy, /docker image prune -f --filter "label=com\.docker\.compose\.project=\$PROJECT"/);
});

test('the Dockerfile label matches the compose project, or the scoped prune silently stops working', () => {
  const label = dockerfile.match(/^LABEL com\.docker\.compose\.project="(.+)"/m);
  assert.ok(label, 'Dockerfile must set com.docker.compose.project');
  assert.equal(label[1], projectName);
});

test('no service publishes a port — the only public surface is via the proxy network', () => {
  // Publishing a port on the sidecars would bypass `internal: true` and put
  // Qdrant (an unauthenticated read/write database at rest here) or the
  // embedding server directly on the host's interfaces.
  assert.doesNotMatch(compose, /^\s*ports:/m);
});

test('the sidecars stay off the proxy network and the internal network has no gateway', () => {
  assert.match(compose, /boh-internal:\n\s*internal:\s*true/);
  // Only the mcp service may name the external proxy network. Counting
  // occurrences catches a sidecar being quietly attached to it.
  const proxyRefs = [...compose.matchAll(/nginx-proxy-manager_default:/g)].length;
  assert.equal(proxyRefs, 2, 'expected exactly one service reference plus the networks: declaration');
});

test('only the embedding server has egress, and only because it downloads a model', () => {
  // boh-egress exists so TEI can reach huggingface.co on first boot — on a
  // purely internal network it crash-loops with a DNS resolution error.
  // Qdrant must never join it: it has no reason to reach the internet, and
  // it holds the campaign vectors.
  assert.doesNotMatch(compose, /boh-egress:\n\s*internal:\s*true/, 'boh-egress must not be internal');
  const egressRefs = [...compose.matchAll(/^\s+- boh-egress$/gm)].length;
  assert.equal(egressRefs, 1, 'exactly one service may sit on the egress network');

  const qdrantBlock = compose.slice(compose.indexOf('\n  qdrant:'), compose.indexOf('\n  embeddings:'));
  assert.ok(qdrantBlock.includes('boh-internal'), 'qdrant stays on the internal network');
  assert.ok(!qdrantBlock.includes('boh-egress'), 'qdrant must not have egress');
});

test('no service is handed an empty-string Qdrant api key', () => {
  // `QDRANT__SERVICE__API_KEY: ${QDRANT_API_KEY:-}` always DEFINES the
  // variable — as "" when unset. Qdrant reads that as "auth configured" and
  // 401s every request, including from the server sharing the same value,
  // and blanking the .env line does not help because the variable is still
  // defined. Absent is the only spelling of "off". If the key is ever
  // re-enabled it must use ${QDRANT_API_KEY} with no `:-` default, so an
  // unset variable is a loud compose error instead of a silent lockout.
  const active = compose.split('\n').filter((l) => !l.trim().startsWith('#'));
  for (const line of active) {
    assert.doesNotMatch(line, /API_KEY:\s*\$\{[A-Z_]+:-\}/, `empty-defaulted api key: ${line.trim()}`);
  }
});

test('the required auth variable has no default, so a misconfigured deploy fails closed', () => {
  // `:?` (error if unset) rather than `:-` (fall back). With a default this
  // would boot with an empty allowlist.
  assert.match(compose, /BOH_MEMORY_TOKEN_HASHES:\s*\$\{BOH_MEMORY_TOKEN_HASHES:\?/);
});

test('the tenant registry is mounted read-only, so only the panel can write it', () => {
  // The single-writer split is the whole architecture: the panel owns
  // identity and writes the allowlist, this server only reads it. Dropping
  // `:ro` would let a bug here rewrite who is allowed in, and would let two
  // processes race on a file that has no locking.
  assert.match(compose, /-\s*boh-registry:\/registry:ro/);
  assert.doesNotMatch(compose, /-\s*boh-registry:\/registry\s*$/m, 'registry mount must carry :ro');
});

test('the registry variable has a default, unlike the token hashes', () => {
  // `:?` on BOH_MEMORY_TOKEN_HASHES makes a missing allowlist a hard error.
  // The registry is different: env-only provisioning is a legitimate
  // deployment, and the file is legitimately absent before the panel first
  // writes it, so `:-` (fall back) is correct here and `:?` would break the
  // bootstrap order.
  assert.match(compose, /BOH_TENANT_REGISTRY:\s*\$\{BOH_TENANT_REGISTRY:-/);
});

test('the registry volume is declared, not assumed to exist', () => {
  // A compose file naming a volume it never declares is only an error at
  // `up`, and only on a host that has not happened to create it already.
  assert.match(compose, /^volumes:/m);
  assert.match(compose.slice(compose.lastIndexOf('\nvolumes:')), /^\s{2}boh-registry:/m);
});

test('every mounted volume path exists in the image, owned by the runtime user', () => {
  // Docker seeds an empty named volume's ownership from the image path under
  // the mount point, and creates it ROOT-owned when the image has no such
  // path — permanently, decided by whichever container mounts it first.
  //
  // This container mounts the registry read-only, so getting it wrong is
  // invisible here and surfaces in the admin panel as EACCES on the first
  // token mint. That is not a hypothetical: it is how this was found.
  const mounts = [...compose.matchAll(/^\s*-\s*[\w-]+:(\/[\w/-]+)(?::ro)?\s*$/gm)]
    .map((m) => m[1])
    .filter((p) => p !== '/qdrant/storage' && p !== '/data/db');   // sidecar images own theirs
  assert.ok(mounts.length >= 2, 'expected at least the data and registry mounts');

  const mkdir = dockerfile.match(/^RUN mkdir -p ([^&]+)&& chown boh:boh (.+)$/m);
  assert.ok(mkdir, 'the Dockerfile must create its volume mount points');
  const created = mkdir[1].trim().split(/\s+/);
  const owned = mkdir[2].trim().split(/\s+/);

  for (const mount of mounts) {
    assert.ok(created.includes(mount), `${mount} is mounted but never created in the image`);
    assert.ok(owned.includes(mount), `${mount} is created but not chowned to boh`);
  }
});
