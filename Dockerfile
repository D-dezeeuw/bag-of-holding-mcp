# ---------- builder ----------
FROM node:22-slim AS builder
# git: the engine peer is installed from its own repository, not npm.
# The published engine lags the source by design (npm has 2.1.0 while
# package.json's peer range asks for ^2.5.0), so resolving from the
# registry would pin the image to a version this server predates.
# Same reasoning as .github/workflows/ci.yml's install step.
#
# ca-certificates is NOT optional here, and its absence is deceptive.
# node:22-slim ships no system CA bundle, so `git fetch https://…` dies with
#   fatal: server certificate verification failed. CAfile: none CRLfile: none
# while npm itself keeps working perfectly — npm verifies TLS against Node's
# BUILT-IN root certificates, git against the system store via libcurl. That
# split is why the registry was always reachable (it answered with ETARGET)
# yet every git dependency failed: two different trust stores, only one of
# them present.
RUN apt-get update && apt-get install -y --no-install-recommends git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY package.json ./
# Force GitHub git traffic onto anonymous HTTPS.
#
# npm resolved the `github:owner/repo` shorthand to ssh://git@github.com/… for
# its `ls-remote`, and this image has no ssh client — the build died on
# "ssh: not found". Installing openssh-client would NOT fix it: ssh to
# git@github.com needs a key, and there is no anonymous ssh to GitHub, so it
# would only trade "not found" for "Permission denied (publickey)".
#
# This rewrite sits BELOW npm, at the git layer, so it does not matter which
# transport npm picks — both spellings of the ssh remote become HTTPS, which
# needs no credentials for public repos. The specs below ask for https
# explicitly too; both layers have to fail before this breaks again.
RUN git config --global url."https://github.com/".insteadOf "ssh://git@github.com/" \
    && git config --global --add url."https://github.com/".insteadOf "git@github.com:"
# Promote BOTH sibling packages from dev links (file:../…, which only exist in
# a side-by-side checkout) to real dependencies fetched from source.
#
# ORDER IS LOAD-BEARING — delete the peer ranges BEFORE setting the deps.
#
# Two separate traps, and the second one is silent:
#
#   1. npm 7+ installs unsatisfied peers from the REGISTRY, and both ranges
#      deliberately point ahead of what is published (engine peer
#      >=2.5.0 <4.0.0 vs 2.1.0 on npm; client peer >=0.29.0 <1.0.0, not
#      yet on npm at that version). Left in place they fail the
#      build with ETARGET while the correct code sits in the dependency map.
#   2. `npm pkg set dependencies.X=<git spec>` does NOT stick while X is still
#      listed as a peer: a later `npm pkg` call re-reads the file, normalises
#      the dep against the peer, and rewrites the git spec back to the peer's
#      semver range. The set appears to succeed and the failure surfaces later
#      as ETARGET on a range you thought you had replaced.
#
# The peer ranges still document intent for consumers installing from npm;
# they simply have nothing to say inside an image pinned to source.
RUN npm pkg delete peerDependencies devDependencies \
    && npm pkg set "dependencies.@zeeuw/bag-of-holding"="git+https://github.com/D-dezeeuw/bag-of-holding.git#main" \
    && npm pkg set "dependencies.@zeeuw/bag-of-holding-client"="git+https://github.com/D-dezeeuw/bag-of-holding-client.git#main" \
    && node -e "const d=require('/build/package.json').dependencies; for (const k of ['@zeeuw/bag-of-holding','@zeeuw/bag-of-holding-client']) if (!d[k].startsWith('git+https://')) { console.error('FATAL: '+k+' is '+d[k]+', expected a git+https: spec — peer normalisation clobbered it'); process.exit(1); }" \
    && npm install --omit=dev --no-package-lock --no-audit --no-fund \
    && node -p "'engine ' + JSON.parse(require('fs').readFileSync('node_modules/@zeeuw/bag-of-holding/package.json')).version + ', client ' + JSON.parse(require('fs').readFileSync('node_modules/@zeeuw/bag-of-holding-client/package.json')).version + ' installed from source'"

# ---------- runtime ----------
FROM node:22-slim
# Its own uid, distinct from node's built-in 1000: this container is the
# internet-facing surface and owns a data volume, so it should not share
# an identity with anything else that might land on this host.
RUN groupadd -g 10101 boh && useradd -m -u 10101 -g boh boh
# Must match `name:` in docker-compose.yml. docker/deploy.sh prunes dangling
# images filtered on this label rather than host-wide, so without it a deploy
# would leave every superseded build of this app on disk forever.
LABEL com.docker.compose.project="bag-of-holding-mcp"
WORKDIR /srv
COPY --from=builder /build/node_modules ./node_modules
# Runtime files only — tests, docs, compose and the Dockerfile itself stay
# out of the image (an allowlist, so a new top-level file is excluded by
# default rather than shipped by accident).
COPY package.json index.js index.d.ts ./
COPY src/ ./src/
COPY bin/ ./bin/
# Operator scripts: seed-worlds.js runs as the one-shot that fills the
# shelf before the server reads it, and publish-revision.js is the only
# supported way to add a revision. Both were absent from this allowlist,
# which made them unreachable in the very place they are meant to run.
COPY scripts/ ./scripts/
# Both volume mount points, created owned by boh.
#
# This is not cosmetic and it is not only about THIS container. When Docker
# first mounts an EMPTY named volume, it seeds the mount point's ownership
# from the image path underneath it — and if the image has no such path, the
# volume ends up owned by root. Whichever container mounts the volume first
# decides that, permanently.
#
# /data has always been here, which is why it works. /registry was not, and
# the failure was invisible from this side: this container mounts the
# registry READ-ONLY and never writes, so a root-owned volume looked fine
# here and surfaced in the admin panel as EACCES on the first token mint.
#
# So both images that touch this volume create it owned by boh (uid 10101),
# and the deploy order stops mattering.
#
# /worlds is the third, and it is the case the rule was written for: the
# worlds-seed one-shot mounts it READ-WRITE and this container mounts it
# read-only, from the same image — so if the mount point were missing,
# whichever ran first would hand the other a root-owned volume it cannot
# bake into.
RUN mkdir -p /data /registry /worlds && chown boh:boh /data /registry /worlds
USER boh
ENV NODE_ENV=production \
    BOH_HTTP_PORT=8091 \
    BOH_DATA_DIR=/data \
    BOH_WORLDS_DIR=/worlds \
    # Cap V8's heap well under the compose file's mem_limit (256m).
    # Without this, V8 derives its limit from HOST RAM and has no
    # reason to collect before the cgroup OOM-kills the container —
    # measured: 3,000 trivial requests drove RSS to 277 MB uncapped
    # vs a steady 178 MB at 128 MB old-space. 192 leaves headroom
    # for buffers, sockets and the base image.
    NODE_OPTIONS=--max-old-space-size=192
# 8091 the MCP surface, 8099 the static browser pages. Neither is
# published to the host; the proxy reaches both over the docker network.
EXPOSE 8091 8099
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.BOH_HTTP_PORT||8091)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "bin/http.js"]
