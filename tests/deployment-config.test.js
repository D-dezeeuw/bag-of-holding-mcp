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

test('the required auth variable has no default, so a misconfigured deploy fails closed', () => {
  // `:?` (error if unset) rather than `:-` (fall back). With a default this
  // would boot with an empty allowlist.
  assert.match(compose, /BOH_MEMORY_TOKEN_HASHES:\s*\$\{BOH_MEMORY_TOKEN_HASHES:\?/);
});
