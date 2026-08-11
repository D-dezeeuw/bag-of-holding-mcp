# Deploying to the Hetzner host

The server runs as three containers behind the existing
nginx-proxy-manager (NPM) stack, deployed by CI over SSH through the same
root-owned script pattern as the other apps on the box. If you have
deployed StockSensei, there is nothing new here except one extra network
and two sidecars.

## What runs

```
nginx-proxy-manager_default (external, 172.22.0.0/16)
  └── bag-of-holding-mcp   172.22.0.44:8091   ← NPM proxies the hostname here
                │
boh-internal (internal: true — no gateway, no route off-host)
  ├── bag-of-holding-qdrant        vectors
  └── bag-of-holding-embeddings    Qwen3-Embedding-0.6B via TEI
```

Only the MCP container joins the proxy network. Qdrant and the embedding
service sit on an `internal: true` network, which Docker gives no gateway
at all — they are unreachable from off-host by construction, which is why
this stack ships no firewall rules and publishes no ports. Don't add
`ports:` to either sidecar "just for debugging"; use `docker compose exec`.

**x86 only.** The TEI image is `linux/amd64`; this stack will not run on
Hetzner's ARM (CAX) instances. Use a CX/CPX box.

## One-time host setup

```bash
git clone https://github.com/D-dezeeuw/bag-of-holding-mcp /nebula/apps/bag-of-holding-mcp
cd /nebula/apps/bag-of-holding-mcp && ./scripts/bootstrap-host.sh
```

`bootstrap-host.sh` derives the slug from the directory name, checks the
external network exists, creates `.env` from `.env.example`, installs
`docker/deploy.sh` as root at `/nebula/apps/deploy-bag-of-holding-mcp.sh`,
and writes a sudoers rule scoped to that exact path. Idempotent — re-run it
to reinstall the deploy script when CI reports drift.

Then, before the first deploy:

1. **Fill in `.env`.** `BOH_MEMORY_TOKEN_HASHES` is mandatory; the
   container refuses to start without it (see *Tokens* below).
2. **Check 172.22.0.44 is free.** NPM caches each upstream's IP at config
   load, so a rebuild-assigned dynamic address would 502 every call — which
   is why the compose file pins one. Confirm nothing else holds it:
   ```bash
   docker network inspect nginx-proxy-manager_default | grep -A2 IPv4Address
   ```
   If `.44` is taken, pick the next free address and change it in
   `docker-compose.yml` *and* in the NPM proxy host.
3. **Check the internal subnet doesn't collide.** `boh-internal` claims
   `172.31.42.0/24`. Docker refuses overlapping pools, and the error only
   surfaces at `up`. NPM holds `172.22.0.0/16` and agent-heartbeat holds
   `172.28.0.0/24`; verify with `docker network ls` + `inspect`.
4. **Add the CI secret** (secrets are per-repository — StockSensei's does
   not apply here):
   ```bash
   gh secret set HETZNER_SSH_KEY --repo D-dezeeuw/bag-of-holding-mcp < ~/.ssh/hetzner
   ```
5. **Point NPM at it.** A new proxy host for the hostname you want, forwarding
   to `172.22.0.44:8091`, with TLS as usual. Websockets are not required —
   the transport is plain POST.

Deploy with `sudo -n /nebula/apps/deploy-bag-of-holding-mcp.sh`, or just push
to `main` and let CI do it.

## Tokens (this is the auth)

A token is an opaque string that is simultaneously the door key and the
tenant identity: it hashes to the storage namespace, so one deployment
serves many tables with no shared state. The model never sees it — when the
transport pins the tenant, the `token` parameter is removed from every
memory and state tool schema.

Mint one per table:

```bash
tok=$(openssl rand -hex 32); echo "token: $tok"
printf '%s' "$tok" | sha256sum | cut -d' ' -f1     # → BOH_MEMORY_TOKEN_HASHES
```

Keep the token, put the **hash** in `.env` (comma-separated for several).
Anything not on the list gets a 404 — the same 404 as a wrong path, so the
endpoint can't be used as an oracle to confirm a guessed token's shape.

The connector URL is `https://<host>/mcp/<token>`. That puts the secret in a
URL path, which lands in access logs far more readily than a header would;
this is the deliberate trade Claude Desktop's connector dialog forces (Title
+ URL, nowhere to put a bearer token). Treat a leaked URL as a leaked
campaign and rotate: drop the old hash from `.env`, add the new one, redeploy.
Storage is namespaced by token, so rotating a token starts a **new empty
shelf** — export first (`memory_export`), rotate, then `memory_import`.

## Connecting a client

- **Claude Desktop**: Settings → Connectors → Add custom connector, Title +
  the `https://<host>/mcp/<token>` URL, OAuth fields blank.
- **Claude Code**: `claude mcp add --transport http boh https://<host>/mcp/<token>`
- **Local stdio** is unchanged: point at `bin/cli.js`. That path keeps the
  optional `token` tool parameter, since one desktop process may serve
  several tables.

## Operating it

`docker/deploy.sh` stops and recreates services on every deploy, except
those named in `DEPLOY_KEEP_SERVICES` (`.env` sets `qdrant embeddings`).
Both are stateful and slow to restart — Qdrant reopens its storage, TEI
reloads multi-GB weights — so cycling them for an app-only change would
take semantic search down for a minute on every push.

> This `DEPLOY_KEEP_SERVICES` support is a small addition to the otherwise
> verbatim shared `docker/deploy.sh`. It defaults to the original
> stop-everything behaviour when unset, so it is safe to port back to the
> other apps that share this platform file.

`scripts/post-deploy.sh` runs after every deploy and asserts four things:
the MCP surface answers, an unknown token is refused with 404, the data
volume is writable, and which retrieval mode the deploy landed on. Sidecar
trouble is a warning, not a failure — search degrades to lexical by design
and heals on its own, so a slow-booting embedding container is a quality dip
rather than an outage.

### First boot

The embedding container downloads Qwen3-Embedding-0.6B on first start
(~1.2 GB into the `boh-hf-cache` volume) and needs a minute before it serves.
Until then `memory_search` returns `retrieval: "lexical"` with a
`semanticError` — expected, not broken.

If it never comes up, check for an OOM kill:

```bash
docker inspect bag-of-holding-embeddings --format '{{.State.OOMKilled}}'
```

`true` means raise `EMBEDDINGS_MEM_LIMIT` in `.env` (default 6g) and
redeploy. The model wants roughly 3–4 GB resident plus batch headroom;
everything else in this stack is deliberately small so this one can have room.

### Backups

Two volumes matter, and unequally:

- **`boh-data`** — the memory log and state vault. Irreplaceable. Back this up.
- **`boh-qdrant`** — vectors. Fully rebuildable: drop the collection and the
  next search re-embeds from `boh-data`.
- `boh-hf-cache` — model weights, re-downloadable.

```bash
docker run --rm -v bag-of-holding_boh-data:/data -v "$PWD:/backup" \
  alpine tar czf /backup/boh-data-$(date +%F).tar.gz -C /data .
```

### Changing the embedding dimension

`BOH_EMBEDDINGS_DIM` is fixed at collection creation on the Qdrant side.
Changing it requires a **new** `BOH_QDRANT_COLLECTION` name too, or every
upsert 400s against the old collection's vector size. The memory log is
unaffected; the new collection back-fills itself on the next search.
