# Deploying to the Hetzner host

The server runs as three containers behind the existing
nginx-proxy-manager (NPM) stack, deployed by CI over SSH through the same
root-owned script pattern as the other apps on the box. If you have
deployed StockSensei, there is nothing new here except one extra network
and two sidecars.

## What runs

```
nginx-proxy-manager_default (external, 172.22.0.0/16)
  └── bag-of-holding-mcp-server   172.22.0.44:8091  ← MCP, token-authenticated
                                  172.22.0.44:8099  ← browser pages, static, no auth
                │
(one-shot, exits before the server starts)
  └── bag-of-holding-mcp-worlds-seed   bakes cartridges into boh-worlds
                │
boh-internal (internal: true — no gateway, no route off-host)
  ├── bag-of-holding-mcp-qdrant       vectors
  └── bag-of-holding-mcp-embeddings   Qwen3-Embedding-0.6B via TEI
                │
boh-egress (outbound only, no published ports)
  └── bag-of-holding-mcp-embeddings   model downloads from huggingface.co
```

**Why the embedding server has a second network.** `internal: true` means
*no gateway* — no DNS, no internet. TEI downloads its model on first boot,
so on the internal network alone it crash-loops with:

```
dns error: failed to lookup address information: Temporary failure in name resolution
```

which reads like a broken network but is the isolation doing its job.
`boh-egress` restores outbound access only; nothing publishes a port, so
there is still no inbound path. Qdrant deliberately stays off it.

To harden once the model is cached: set `HF_HUB_OFFLINE=1` on the
embeddings service and drop `boh-egress`. The weights live in the
`boh-hf-cache` volume, so it never needs the internet again.

Compose project: `bag-of-holding-mcp`, and every container name starts with
it. That is not cosmetic — see *Blast radius* below.

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
6. **Optionally, point NPM at the pages too** — `172.22.0.44:8099`, which
   serves the client home at `/` and the world atlas at `/atlas`. Either give
   it its own hostname (nothing more to configure) or add it as a Custom
   Location on an existing one. NPM's Custom Locations **forward the path
   prefix** rather than stripping it, so a location of `/client` needs
   `BOH_UI_BASE_PATH=/client` in `.env` or every asset 404s.

   This port has no authentication, deliberately: it serves static files out
   of the client package and nothing else — no token, no store, no shelf.
   The pages bake a world in the browser. Showing a REAL campaign is the
   host's job, through its own authenticated proxy calling `world_atlas`;
   see the client's `docs/world-atlas.md`.

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

## The tenant registry (provisioning without a redeploy)

`BOH_MEMORY_TOKEN_HASHES` is read once at startup, so every add or revoke
costs a deploy. `BOH_TENANT_REGISTRY` points at a JSON file that is re-read
within ~2s of changing:

```json
{
  "version": 1,
  "tenants": {
    "9f86d081…": { "tier": "free",   "status": "active"    },
    "5e884898…": { "tier": "patron", "status": "suspended" }
  }
}
```

The two sources are a **union**. An env token stays valid whatever the file
says, which is what makes the variable a break-glass path: if the registry is
wrong, deleting it is not the fix, but setting the variable always is.

Rules worth knowing before you hand-edit it:

- Only the exact string `active` authorises. A typo, a missing `status`, or
  a value from a newer build all mean suspended — the expensive mistake is a
  revoked tenant that keeps playing, not an active one you re-enable. Every
  such case is logged, so a file that silently disables a table says why.
- `tier` names the tenant's scene-image allowance (`free`, `patron`,
  `studio` — renders per hour and the cooldown between them). It beats the
  deployment-wide `BOH_IMAGE_TIER`, which stays the default for tenants the
  registry says nothing about, including every env-allowlist token. A name
  this build does not know is never an upgrade: it falls back rather than
  handing out an allowance nobody priced. A downgrade is clamped through the
  budget already on disk, so it takes effect on the tenant's next call rather
  than at the next window. Tiering is the server's call throughout — no tool
  takes a `tier` parameter, so the model cannot ask for a bigger budget.
- `ns` is reserved for token rotation and nothing reads it yet.
- Unknown keys are ignored, so a newer panel writing extra fields will not
  break an older server.
- **Only the panel writes this file.** It is mounted `:ro` here, and that is
  enforcement, not documentation — two writers on a file with no locking is
  how an allowlist gets truncated.

Failure posture, which is deliberately asymmetric:

| When | What happens |
|---|---|
| Corrupt at startup | Refuses to boot, exit 2 — a server that cannot read its allowlist must not serve a different one |
| Corrupt at runtime | Keeps the last good copy, warns. A half-written file must not revoke every live table |
| Absent at startup | Fine, empty. This is the bootstrap order: this server comes up before the panel exists |
| Vanishes at runtime | Keeps the last good copy, warns once |
| A directory at that path | Refuses to boot. This is the Docker bind-mount footgun — a mount whose source is missing makes the daemon create a directory, which would otherwise present as "every tenant 404s" with nothing in the log |

Note the volume is declared here but written by the admin stack, which
mounts it read-write. Ordering is not fragile: with no file, this server
simply runs on the env allowlist alone.

## Connecting a client

- **Claude Desktop**: Settings → Connectors → Add custom connector, Title +
  the `https://<host>/mcp/<token>` URL, OAuth fields blank.
- **Claude Code**: `claude mcp add --transport http boh https://<host>/mcp/<token>`
- **Local stdio** is unchanged: point at `bin/cli.js`. That path keeps the
  optional `token` tool parameter, since one desktop process may serve
  several tables.
- **A browser game** talks to the relay instead of the MCP surface: base URL
  `https://<host>/mcp/<token>/v1`, token as the API key. See below.

## The inference relay (optional, and it spends your money)

With `BOH_LLM_API_KEY` set, the tenant path also serves an OpenAI-compatible
relay, so a token can pay for prose and not just storage:

```text
POST /mcp/<token>/v1/chat/completions   streaming or not
GET  /mcp/<token>/v1/models             the ids this tier may use
GET  /mcp/<token>/v1/status             tier + budget; answers even with no key
```

Leave the key unset and the deployment sells no inference: `/v1/status` reports
`relayEnabled: false` for a valid token and the other two answer 503, so a host
falls back to asking the player for their own key. Every relayed call is capped
by the tenant's tier (free 150k tokens/day, patron 2M, studio 10M) and can only
reach the model ids that tier names — see the README section for the full list
of what stops it being an open proxy.

Three things about this deployment specifically:

1. **The budget file is per tenant, not per campaign**:
   `$BOH_DATA_DIR/t-<hash>/relay-budget.json`, beside the campaign directories
   rather than inside one. Per campaign it would refill every time a player
   started a new campaign. It is last-write-wins like the image gate, which is
   the other reason two replicas must not share a data dir.

2. **NPM must not buffer the stream.** A relayed narration is server-sent
   events, and nginx's default proxy buffering holds them until the response
   completes — the player sees nothing for twenty seconds and then the whole
   paragraph at once. In the proxy host's Advanced tab:

   ```nginx
   proxy_buffering off;
   proxy_cache off;
   proxy_read_timeout 300s;   # longer than RELAY_TIMEOUT_MS
   ```

   The MCP surface itself streams too, so this is worth setting either way.

3. **CORS is answered by the app, not the proxy.** The relay returns
   `access-control-allow-origin: *` and handles `OPTIONS` itself. Do not add a
   second set of CORS headers in NPM: a browser rejects a response carrying two
   of them, and the failure looks exactly like a network error. The wildcard is
   deliberate — the credential is the token in the URL, not a cookie, so there
   is no ambient authority an origin check would protect.

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
docker inspect bag-of-holding-mcp-embeddings --format '{{.State.OOMKilled}}'
```

`true` means raise `EMBEDDINGS_MEM_LIMIT` in `.env` (default 6g) and
redeploy. The model wants roughly 3–4 GB resident plus batch headroom;
everything else in this stack is deliberately small so this one can have room.

If `OOMKilled` is `false`, read `docker logs bag-of-holding-mcp-embeddings`
instead — a DNS resolution error there means the container lost its egress
network (see above), not that the host's network is broken.

### Qdrant runs without an api key, on purpose

The variable is not wired into `docker-compose.yml` at all, and that is the
fix for a genuinely nasty failure mode rather than laziness.

`QDRANT__SERVICE__API_KEY: ${QDRANT_API_KEY:-}` always **defines** the
variable — as `""` when `QDRANT_API_KEY` is unset. Qdrant reads a
defined-but-empty `api_key` as *auth is configured* and enforces a key that
no request can match, so **every** call 401s, including from the server
holding the identical value. Blanking the line in `.env` does not help: the
variable is still defined. Only removing it means "off".

Running without costs nothing here — Qdrant has no gateway and no published
ports, so 6333 is unreachable from off-host.

To enable one: uncomment the two commented lines in `docker-compose.yml`
(the `qdrant` service **and** the `mcp` service — they must move together)
and set a fresh value in `.env`. Note they use `${QDRANT_API_KEY}` with no
`:-` default, so an unset variable becomes a loud compose error instead of a
silent lockout. Generate it with `openssl rand -hex 32`; don't reuse another
system's secret.

### Backups

Two volumes matter, and unequally:

- **`boh-data`** — the memory log and state vault. Irreplaceable. Back this up.
- **`boh-worlds`** — baked cartridges. Back this up. Nominally regenerable
  from a seed, but only by the exact generator version that first baked it:
  campaigns pin a cartridge by digest, so a re-mint under a running campaign
  strands it. Treat a cartridge like a published version — immutable.
- **`boh-qdrant`** — vectors. Fully rebuildable: drop the collection and the
  next search re-embeds from `boh-data`.
- `boh-hf-cache` — model weights, re-downloadable.

```bash
docker run --rm -v bag-of-holding-mcp_boh-data:/data -v "$PWD:/backup" \
  alpine tar czf /backup/boh-data-$(date +%F).tar.gz -C /data .
```

## The world shelf

Generated world cartridges live in the `boh-worlds` volume, mounted at
`/worlds` and **read-only** in the server — the same single-writer split as
the tenant registry, and for a sharper reason: a campaign pins a cartridge
by digest, so anything able to rewrite one would strand every campaign
playing it.

The shelf is filled by `worlds-seed`, a one-shot that runs before the server
starts. It bakes the seeds named in `BOH_SEED_WORLDS`, **skips anything
already present**, and exits. Every deploy re-runs it, and every deploy after
the first should report `already on the shelf`. An empty shelf is a valid
deployment — `world_catalog` says so cleanly — and `scripts/post-deploy.sh`
prints the cartridge count on every deploy so "deliberately empty" and
"forgot to set `BOH_SEED_WORLDS`" are told apart here rather than at
somebody's table.

**The shelf is read once, at process start.** Unlike `BOH_TENANT_REGISTRY`,
it does not hot-reload. A cartridge added to the volume while the server is
up stays invisible until:

```bash
docker compose restart mcp
```

That is also why `worlds-seed` is gated with
`condition: service_completed_successfully` rather than plain ordering — the
directory has to be complete before the server reads it, not merely being
written.

To add a world by hand rather than by seed, bake it with the client's
`scripts/bake-world.js` and copy it in through a read-write one-off (the
server's own mount cannot write):

```bash
docker run --rm -v bag-of-holding-mcp_boh-worlds:/w -v "$PWD/worlds:/src:ro" \
  alpine sh -c 'cp /src/world-*.json /w/'
docker compose restart mcp
```

Revisions go in `revisions/` under the same volume, published with
`scripts/publish-revision.js` — also a read-write one-off, and also a script
rather than a tool, because its advisory scan reads every tenant's
observation file.

## Blast radius: what a deploy can destroy

`deploy.sh` runs as root and does four destructive things. Three are scoped;
know what the scopes are before adding a service or renaming anything.

| Operation | Scope | Watch out |
| --- | --- | --- |
| `git reset --hard origin/<branch>` | this checkout | **Discards local edits to tracked files.** The deploy *is* the branch. Untracked files (`.env`) survive. |
| `compose rm --stop --force` | services in this file, minus `DEPLOY_KEEP_SERVICES` | Add a stateful service → add it to that list in `.env`. `worlds-seed` is deliberately NOT on it: it is a one-shot that no-ops when the shelf is already full, and skipping it is how a shelf quietly stays empty. Note nothing here touches **volumes** — `boh-worlds` and its cartridges survive every deploy. |
| stray sweep: `docker rm -f` | containers named `^bag-of-holding-mcp-` whose compose-project label differs | **Force-removes by name prefix, across projects.** This is why the project name must be specific. |
| `docker image prune` | `--filter label=com.docker.compose.project=bag-of-holding-mcp` | Scoped deliberately; a bare `docker image prune -f` would reap every dangling image on the host, including other apps' rollback targets. The filter matches because the Dockerfile sets that label — keep it in sync with `name:` in the compose file. |

The prefix rule cuts both ways: another stack whose project name is a
*prefix* of ours (e.g. plain `bag-of-holding`) would sweep **our** containers
on its own deploys. If the engine repo ever gets containerised, name its
project `bag-of-holding-engine`.

### Who can do this

The root-owned deploy script exists so a `git push` cannot change what runs
as root. Be clear-eyed about how far that goes: the script still runs
`docker compose up` and `scripts/post-deploy.sh` from the **freshly pulled
branch**, both as root. Compose can bind-mount any host path into a
container, so anyone who can push to `main` — or approve a PR into it — can
reach root on this box regardless of the script's ownership. The real
security boundary here is branch protection and who holds
`HETZNER_SSH_KEY`, not the file mode on `deploy-*.sh`.

### Changing the embedding dimension

`BOH_EMBEDDINGS_DIM` is fixed at collection creation on the Qdrant side.
Changing it requires a **new** `BOH_QDRANT_COLLECTION` name too, or every
upsert 400s against the old collection's vector size. The memory log is
unaffected; the new collection back-fills itself on the next search.

## Capacity: how many tables one instance holds

Measured on the shipped container shape (`cpus: "0.50"`,
`mem_limit: 256m`, heap capped at 192 MB since 0.15.0). A "table" is
one active campaign making ~6 tool calls a minute.

| Configuration | Concurrent tables | Binding limit |
| --- | --- | --- |
| Pre-0.15.0 (no heap cap, unbounded rollLogs) | ~50–80 | memory — engine rollLogs never freed |
| 0.15.0 defaults (rollLogCap 20k, idle eviction, heap cap) | **~250–400** | CPU (~80 tool calls/s absolute at 0.5 CPU) |
| Full core (`cpus: "1.0"`) | ~500–800 | CPU |

What degrades an instance first, in order:

1. **One huge campaign.** All store I/O is synchronous; a 20,000-record
   `memory_search` occupies the event loop for ~480 ms at 0.5 CPU and
   every other table waits behind it. Keep campaigns to thousands of
   records, not tens of thousands (the memory-protocol guide's
   discipline does this naturally).
2. **First semantic search on a large backlog.** The backfill embeds
   the whole campaign through the sidecar (pipelined 4 batches at a
   time since 0.15.0, 15 s deadline). Expect the first search after
   enabling sidecars mid-campaign to be slow once, then normal.
3. **Concurrent image renders.** Each in-flight render holds ~4–5 MB
   transient (base64 inline) for up to 60 s. The per-campaign budget
   gates volume, but there is no global render cap — keep
   `BOH_IMAGE_TIER=free` on shared deployments.

### Scaling past one instance: shard by token

Two replicas must NEVER share one `BOH_DATA_DIR` (memory-record ids,
the image-gate spend counter, the relay budget and the world pin are
all last-write-wins files; engine sessions are in-RAM per process).
Sharing one would also mean two processes each granting a tenant the
full token allowance. The supported
multi-instance shape is sharding, which works today with no code
changes because the token already IS the tenant:

1. Run N instances, each with its own volume (`BOH_DATA_DIR`) and its
   own disjoint `BOH_MEMORY_TOKEN_HASHES` allowlist.
2. Route on the URL path: `/mcp/<token>` → the instance whose
   allowlist holds that token's hash. Any reverse proxy that can route
   on a path prefix map can do this; unlisted tokens 404 on the wrong
   instance anyway (fail closed).
3. Moving a tenant = `memory_export` → import on the new shard (the
   export carries memory, state and the world trio), then move the
   hash between allowlists.
