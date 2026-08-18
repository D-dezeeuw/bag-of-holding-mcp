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
  assert.equal(containerNames.length, 4);
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

test('the money-spending keys stay opt-in, and fail loudly when half-set', () => {
  // Both provider keys are commented out by default: a deployment that renders
  // images or relays inference is spending the operator's account on behalf of
  // every tenant, and that must be a decision someone made rather than a
  // default they inherited. When uncommented they use `:?` (error if unset)
  // for the same reason as the token hashes — an empty key is not "off", it is
  // a misconfiguration that would otherwise 401 every turn silently.
  for (const key of ['BOH_IMAGE_API_KEY', 'BOH_LLM_API_KEY']) {
    const line = compose.split('\n').find((l) => l.includes(`${key}:`));
    assert.ok(line, `${key} must appear in the compose file, even if commented`);
    assert.ok(line.trim().startsWith('#'), `${key} must ship commented out`);
    assert.match(line, new RegExp(`${key}:\\s*\\$\\{${key}:\\?`), `${key} must use :? not :-`);
  }
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


test('the world shelf has exactly one writer', () => {
  // Same single-writer split as the tenant registry, and load-bearing for a
  // different reason: a campaign pins a cartridge by DIGEST, so a second
  // process able to rewrite one would strand every campaign playing it. The
  // seeder mounts the volume read-write; everything else takes `:ro`.
  const mounts = [...compose.matchAll(/^\s*-\s*boh-worlds:\/worlds(:ro)?\s*$/gm)];
  assert.equal(mounts.length, 2, 'expected the mcp mount and the seeder mount');
  const writable = mounts.filter((m) => !m[1]);
  assert.equal(writable.length, 1, 'exactly one service may write the shelf');

  const seedBlock = compose.slice(compose.indexOf('\n  worlds-seed:'), compose.indexOf('\n  qdrant:'));
  assert.match(seedBlock, /-\s*boh-worlds:\/worlds\s*$/m, 'the writer must be worlds-seed');
  const mcpBlock = compose.slice(compose.indexOf('\n  mcp:'), compose.indexOf('\n  worlds-seed:'));
  assert.match(mcpBlock, /-\s*boh-worlds:\/worlds:ro/, 'the server reads the shelf, never writes it');
});

test('the shelf is filled before the server reads it', () => {
  // createWorlds reads the directory ONCE, at boot, and never again — so
  // plain start-ordering is not enough, the seeder must have EXITED. If this
  // gate is ever downgraded to `service_started`, a fresh deploy races and
  // the catalog comes up empty on the first boot after a volume reset.
  assert.match(compose, /worlds-seed:\n\s*condition: service_completed_successfully/);
  const seedBlock = compose.slice(compose.indexOf('\n  worlds-seed:'), compose.indexOf('\n  qdrant:'));
  assert.match(seedBlock, /restart: "no"/, 'the seeder is a one-shot, not a service');
  assert.match(seedBlock, /entrypoint: \["node", "scripts\/seed-worlds\.js"\]/);
});

test('the seeder runs the same image as the server', () => {
  // Two `build:` stanzas for one Dockerfile means two images and a window
  // where the seeder and the server disagree about what the client library
  // contains — including whether a cartridge bakes to the same digest.
  const tags = [...compose.matchAll(/^\s*image:\s*(bag-of-holding-mcp:\S+)$/gm)].map((m) => m[1]);
  assert.equal(tags.length, 2);
  assert.equal(tags[0], tags[1]);
});

test('the shelf volume is declared, and the worlds dir may default', () => {
  assert.match(compose.slice(compose.lastIndexOf('\nvolumes:')), /^\s{2}boh-worlds:/m);
  // `:-` not `:?`: a server with no shelf is a valid deployment and
  // world_catalog answers cleanly for one.
  assert.match(compose, /BOH_WORLDS_DIR:\s*\$\{BOH_WORLDS_DIR:-/);
});

test('the UI port is reached through the proxy network like everything else', () => {
  // The `no service publishes a port` test above already covers this, but
  // state the intent for the port that is deliberately unauthenticated: it
  // must not become the one thing bound to the host's interfaces.
  assert.match(compose, /BOH_UI_PORT:\s*"8099"/);
  assert.match(dockerfile, /^EXPOSE 8091 8099$/m, 'both surfaces are declared in the image');
  assert.doesNotMatch(compose, /^\s*ports:/m);
});

test('the operator scripts reach the image that is meant to run them', () => {
  // seed-worlds.js runs as the compose one-shot and publish-revision.js is
  // the only supported way to add a revision. The COPY list is an allowlist,
  // so both were absent until it named scripts/ — unreachable in the exact
  // place they exist to run.
  assert.match(dockerfile, /^COPY scripts\/ \.\/scripts\/$/m);
});
