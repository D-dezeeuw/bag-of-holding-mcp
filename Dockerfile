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
# Promote the engine from a dev link (file:../bag-of-holding, which only
# exists in a side-by-side checkout) to a real dependency fetched from
# source. --omit=dev then drops typescript and the rest of the dev tree.
RUN npm pkg set "dependencies.@zeeuw/bag-of-holding"="github:D-dezeeuw/bag-of-holding#main" \
    && npm pkg delete devDependencies \
    && npm install --omit=dev --no-package-lock --no-audit --no-fund \
    && node -p "'engine ' + JSON.parse(require('fs').readFileSync('node_modules/@zeeuw/bag-of-holding/package.json')).version + ' installed from source'"

# ---------- runtime ----------
FROM node:22-slim
# Its own uid, distinct from node's built-in 1000: this container is the
# internet-facing surface and owns a data volume, so it should not share
# an identity with anything else that might land on this host.
RUN groupadd -g 10101 boh && useradd -m -u 10101 -g boh boh
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
