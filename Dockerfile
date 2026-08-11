# ---------- builder ----------
FROM node:22-slim AS builder
# git: the engine peer is installed from its own repository, not npm.
# The published engine lags the source by design (npm has 2.1.0 while
# package.json's peer range asks for ^2.5.0), so resolving from the
# registry would pin the image to a version this server predates.
# Same reasoning as .github/workflows/ci.yml's install step.
RUN apt-get update && apt-get install -y --no-install-recommends git \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /build
COPY package.json ./
# Promote BOTH sibling packages from dev links (file:../…, which only exist in
# a side-by-side checkout) to real dependencies fetched from source.
#
# ORDER IS LOAD-BEARING — delete the peer ranges BEFORE setting the deps.
#
# Two separate traps, and the second one is silent:
#
#   1. npm 7+ installs unsatisfied peers from the REGISTRY, and both ranges
#      deliberately point ahead of what is published (engine peer ^2.5.0 vs
#      2.1.0 on npm; client peer ^0.8.0 vs 0.4.0). Left in place they fail the
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
    && npm pkg set "dependencies.@zeeuw/bag-of-holding"="github:D-dezeeuw/bag-of-holding#main" \
    && npm pkg set "dependencies.@zeeuw/bag-of-holding-client"="github:D-dezeeuw/bag-of-holding-client#main" \
    && node -e "const d=require('/build/package.json').dependencies; for (const k of ['@zeeuw/bag-of-holding','@zeeuw/bag-of-holding-client']) if (!d[k].startsWith('github:')) { console.error('FATAL: '+k+' is '+d[k]+', expected a github: spec — peer normalisation clobbered it'); process.exit(1); }" \
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
# The data volume is mounted here; create it owned by boh so the first
# write works under a read_only root filesystem.
RUN mkdir -p /data && chown boh:boh /data
USER boh
ENV NODE_ENV=production \
    BOH_HTTP_PORT=8091 \
    BOH_DATA_DIR=/data
EXPOSE 8091
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.BOH_HTTP_PORT||8091)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "bin/http.js"]
