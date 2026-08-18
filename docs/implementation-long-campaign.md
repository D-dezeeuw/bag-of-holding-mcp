# Implementation plan — long-campaign support

**Status:** historical design record, written against 0.2.0. Its core
shipped then; the tool counts and follow-up list below reflect that
era (the server has since grown to 108 tools across campaigns,
cartridges, images, solo sessions and narration — see the README's
tool inventory for the live surface). Kept for the reasoning, not as
a status page.
**Scope:** this repo only. The engine (`@zeeuw/bag-of-holding`) is
untouched; every feature below lives on the host side of the
[boundary contract](https://github.com/D-dezeeuw/bag-of-holding/blob/main/docs/boundary.md).

The ask, in four parts:

1. **Memory** so a long campaign doesn't have to live in the model's
   context window (proposed: a vector database).
2. **Skills / context** — the MCP should teach the host *how* to run
   a campaign, not just hand it dice.
3. **A pre-generated world** so the model doesn't improvise a whole
   setting (layers, factions) from nothing.
4. **Auth** via a memory token now; a paid hosted tier later.

## Viability assessment

**All four are viable, in this package, without touching the engine.**
The engine's contract ("the host owns the prose, the persistence, and
the AI loop") anticipated exactly this: the MCP server *is* the host's
persistence layer. Two deliberate deviations from the ask as phrased:

### Deviation 1 — lexical core, semantic sidecars (revised: implemented)

*As originally assessed*, embeddings don't belong inside this server:
an in-process model would drag heavyweight dependencies into a
zero-dep package, and a cloud API would put a key and a provider in
the one layer that is key-free and auditable. The revision that
resolved the tension: **local sidecar containers**, per the project's
own infrastructure plan — Qdrant for vectors and Qwen3-Embedding-0.6B
behind Text Embeddings Inference, both in `docker-compose.yml`, both
spoken to over plain REST with the platform `fetch`. No new npm
dependencies; no cloud; no keys leaving the machine.

How it lands:

- **Lexical BM25 stays the base.** Records carry `type`, `entities`,
  `tags`, `importance` (1–5) and position (recency); with no sidecars
  configured, search works exactly as before, offline, deterministic.
- **Hybrid when the sidecars are up** (`$BOH_EMBEDDINGS_URL` set):
  lexical, semantic and importance/recency rankings are merged with
  reciprocal-rank fusion (k = 60) — scale-free, so BM25 floats and
  cosine scores never need reconciling. A relevance floor (positive
  score, ≥ 0.6 × best hit) keeps nearest-neighbour noise from
  counting as a match.
- **Lazy backfill.** Vectors are written at *search* time, not record
  time: deterministic point ids make "what's missing" a set
  difference, so enabling semantics mid-campaign embeds the backlog
  on the next search, and `memory_record` can never fail on a down
  sidecar.
- **Multi-tenant via Qdrant's own pattern.** One collection; every
  point's payload carries the token-derived namespace (`ns`) as a
  tenant-marked keyword index plus `campaign` and `model`; every
  query filters on all three server-side. Raw tokens never reach the
  sidecars, and results are intersected with the live record set so
  forgotten records and stale vectors can never resurface.
- **Degrade, don't fail.** Any sidecar error returns the lexical
  result with `retrieval: "lexical"` and `semanticError` set; the
  next search retries, so a restarted container heals without a
  server restart. `memory_status` reports the whole semantic state.
- **The embedding client is generic** (OpenAI-compatible
  `/embeddings` — TEI, Ollama, vLLM, LM Studio all qualify), queries
  get the Qwen instruction prefix client-side, and vectors are
  Matryoshka-truncated (default 256 of 1024 dims) then re-normalised
  client-side, so the stack stays swappable.

### Deviation 2 — the provided token was not embedded

The token supplied for testing is an **unencrypted OpenSSH ed25519
private key** (base64 of an `openssh-key-v1` blob, comment
`boh-memory-token`). Two rules follow:

- **Private keys are never bearer tokens**, and **no credential is
  ever committed to this repo** — public repo, secret scanners, and
  chat logs all make that a leak. If that keypair is used for real SSH
  anywhere, rotate it now.
- The server therefore treats tokens as **opaque strings it never
  stores**: a token is hashed (SHA-256) and the hash prefix becomes a
  storage namespace. Any string works as a token — including the one
  above, supplied locally via environment — but generate a real one
  with `openssl rand -base64 32`.

Everything else in the ask maps cleanly onto MCP-native machinery
(tools, prompts, resources) and is implemented as specified below.

## Architecture

```
┌─ MCP host (Claude Desktop, …) ── the LLM: prose, judgment, pacing ─┐
│                                                                    │
│   tools ───────────────┬─ prompts/resources ──── guides (skills)   │
▼                        ▼                                           │
engine tools        memory/state tools         world tools           │
(dice, combat, …)   (disk, namespaced)         (static content)      │
     │                    │                         │                │
@zeeuw/bag-of-holding   <dataDir>/<ns>/…       src/world/*.js        │
(math, rollLog — RAM)   (JSONL + JSON blobs)   (read-only pack)      │
```

Division of labour after this change:

| Concern | Owner |
| --- | --- |
| Rules math, dice, audit trail | engine (unchanged) |
| Prose, pacing, judgment, *deciding what to remember* | the LLM host |
| Narrative memory, mechanical saves | **this server** (`memory_*`, `state_*`) |
| Setting content | **this server** (`world_*`) |
| How-to-play knowledge | **this server** (guides via prompts/resources/tools) |

### Memory subsystem (`src/memory/`)

- **`store.js`** — namespaced disk persistence.
  - Data root: `opts.dataDir` → `$BOH_DATA_DIR` → `~/.bag-of-holding`.
    Nothing is written until the first write-tool call.
  - Namespace: no token → `local`; token → `t-<sha256(token)[0..16]>`.
    Tokens are never written to disk.
  - Auth: with `opts.tokenHashes` / `$BOH_MEMORY_TOKEN_HASHES`
    (comma-separated SHA-256 hex) set, only tokens hashing into the
    list are accepted — that is the hosted-tier mode. Unset = open
    local mode (tokens still namespace).
  - Campaign log: `<ns>/<campaign>/memory.jsonl`, **append-only**
    (`record` and `forget` ops; a forget is a tombstone, matching the
    engine's append-only rollLog philosophy). Corrupt lines are
    skipped and counted, never fatal.
  - State vault: `<ns>/<campaign>/state/<key>.json` — arbitrary JSON
    snapshots (party records, `Session.serialize()` payloads). This
    closes the *mechanical* half of the persistence gap; memory
    closes the narrative half.
  - Campaign and state keys validated against
    `^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$` — no path traversal.
- **`search.js`** — pure functions: tokenizer (lowercase, stopword
  strip), BM25 (k1 = 1.2, b = 0.75) over text + double-weighted
  entities/tags, blended with importance and log-position recency.
  Deterministic: same store + same query → same ranking.

### Tools (21 new at the time; 63 → 84, since grown to 108)

| Group | Tools |
| --- | --- |
| Memory | `memory_status`, `memory_record`, `memory_search`, `memory_recent`, `memory_forget`, `memory_export`, `memory_import` |
| State vault | `state_save`, `state_load`, `state_list`, `state_delete` |
| World | `world_list`, `world_overview`, `world_region`, `world_faction`, `world_npc`, `world_hooks`, `world_secrets`, `world_search` |
| Guides | `guide_list`, `guide_get` |

Memory/state tools take an optional `token`; world/guide tools are
public content and take none.

### World pack (`src/world/`)

The engine roadmap already reserves `3.0.0` for **Sundermark** (high
fantasy, "the gods have died"). Shipping a competing setting here
would fork canon, and shipping all of Sundermark is a milestone, not
a PR. So this pack is a deliberate slice: **the Greyfen March**, one
frontier province *of* Sundermark — dead-gods premise honoured
(clerics draw on relics, divination is séance), sized to run a
campaign tonight: 5 regions, 6 factions, 12 named NPCs, ~15 hooks, a
3-tier secret ladder, timeline, and three ready openers. When engine
3.0.0 ships the full continent, this pack folds in as one region of
it.

Layering is enforced, not advisory: `world_region` / `world_faction` /
`world_npc` return the public layer by default and only include `gm`
fields when `layer: "gm"` is passed; `world_secrets` is explicitly a
GM-only surface with breadcrumbs designed to be revealed through
play.

### Guides — the "skills" surface (`src/skills/`)

Markdown guides — five at the time (`campaign-quickstart`,
`memory-protocol`, `combat-flow`, `session-zero`, `dm-style`), seven
today (+ `narration-style`, `war-thread`). Exposed **three** ways
because host support varies:

- **MCP prompts** (`registerPrompt`) — user-invokable in hosts that
  surface them (Claude Desktop's + menu).
- **MCP resources** (`registerResource`, `boh://guide/<id>`) —
  attachable context.
- **`guide_list` / `guide_get` tools** — the lowest common
  denominator every host can reach.

The memory-protocol guide is the load-bearing one: *when* to record
(scene end, first meetings, promises made), *when* to search (scene
start, name reappears, arrival), what not to store (transcripts), and
the end-of-session ritual (summary record + `state_save` + export as
backup).

### Auth & the hosted tier

Now: token → namespace, optional hash allowlist, all local.
Later (the "small fee for persistent memory" website): run this same
server behind HTTP with `BOH_MEMORY_TOKEN_HASHES` fed from the billing
database — the website mints a random token, stores only its hash,
and the tool surface does not change. The hosted tier is also where a
real vector backend earns its keep (server-side embeddings, no key on
the user's machine). Payments, accounts, and transport hardening are
that product's concern, out of scope here.

## Testing

Repo contract is 100/100/100 line/branch/function coverage plus
`tsc --noEmit`; both hold after this change.

- `memory-search.test.js` — tokenizer, ranking, weighting, empties.
- `memory-store.test.js` — temp-dir stores: record/search/recent/
  forget/export/import, namespace isolation between tokens, allowlist
  accept/reject, corrupt-line resilience, traversal rejection, state
  vault CRUD, env fallbacks.
- `tools-memory.test.js`, `tools-world.test.js`, `tools-guides.test.js`
  — every handler's happy path + error path through the descriptor
  surface.
- `world-data.test.js` — content integrity: every cross-reference
  (region ↔ NPC ↔ faction) resolves, layers complete, pack deep-frozen.
- `server.test.js` — new tools registered; prompts/resources exercised
  end-to-end over an in-memory MCP client/server pair.

## Follow-ups (as written for 0.2.0 — statuses updated since)

- **Solo/Session orchestrator tools** — ✅ shipped in 0.11.0
  (`solo_session_create/act/peek`, `replay_share`, `replay_verify`,
  stateless snapshot round-trips in `src/tools/solo.js`).
- **Memory compaction** via MCP sampling (ask the *host* model to
  summarise old records — keeps the server model-free), plus pruning
  of stale Qdrant points left behind by `memory_forget` (harmless
  today thanks to live-set intersection, but they accumulate).
  Still open; multi-process id minting rides with it.
- **World-pack semantic search** — still open; `world_search` remains
  lexical (`rankRecords`).
- **More worlds** — Brassgear and Hollow Vale slices (the engine's
  setting plugin contract shipped at 3.3.0, so the shapes exist).
- **HTTP transport** — ✅ shipped (`src/http.js`, `bin/http.js`,
  tenant-pinned `POST /mcp/<token>`); **billing** for the hosted tier
  remains that product's concern, out of scope here.
