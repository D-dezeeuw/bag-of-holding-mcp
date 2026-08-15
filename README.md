# bag-of-holding-mcp

[![npm version](https://img.shields.io/npm/v/@zeeuw/bag-of-holding-mcp.svg?style=flat-square)](https://www.npmjs.com/package/@zeeuw/bag-of-holding-mcp)
[![coverage 100%](https://img.shields.io/badge/coverage-100%25-brightgreen.svg?style=flat-square)](#development)
[![types: built-in](https://img.shields.io/badge/types-built--in-blue.svg?style=flat-square)](./index.d.ts)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](./LICENSE)

Model Context Protocol server for [`@zeeuw/bag-of-holding`](https://github.com/D-dezeeuw/bag-of-holding) — the SRD 5.2 rules kernel. Plug any MCP-aware AI host (Claude Desktop, Cursor, your own) into a rules-correct, replay-deterministic D&D 5e engine without trusting the model to do the math.

> The model owns the prose, the world, the pacing. The engine owns the
> dice, the checks, the combat math, and the audit trail.

## What this gives you

- **The AI can't fudge dice.** Every roll flows through the engine's seeded RNG; the engine writes an append-only `rollLog` the host can `engine_verify_log` at any time.
- **Rules-correct mechanics for free.** Ability checks, saving throws, attack rolls, damage with crit doubling, weapon mastery dispatch, conditions, exhaustion, XP — all driven by `@zeeuw/bag-of-holding`.
- **Sessions per game.** One process can serve many concurrent games, each with its own seed and rollLog.
- **Replay determinism from day one.** Save a seed + rollLog; reconstruct the exact sequence of rolls weeks later.
- **Campaigns that survive the context window.** A namespaced, append-only memory log (`memory_*`) for the story and a state vault (`state_*`) for the numbers — on disk, searchable, exportable. See [Long campaigns](#long-campaigns-memory-saves-worlds-guides).
- **A world to play in tonight.** The Greyfen March pack (`world_*`): a [Sundermark](https://github.com/D-dezeeuw/bag-of-holding/blob/main/docs/roadmap.md) frontier province with regions, factions, NPCs, hooks and a GM-only secret ladder, layered so spoilers only ship when asked for.
- **A picture when the table asks for one.** `/observe` in practice: `image_*` is a deliberate, budgeted image call — off until a player turns it on, capped per rolling window, with a cooldown, so an AI DM cannot illustrate every paragraph. See [Scene images](#scene-images-observe).
- **A DM that knows the drill.** How-to-play guides served as MCP prompts, resources *and* tools (`guide_*`): campaign loop, memory discipline, combat flow, session zero, DM style.
- **Boundary-honest.** The *engine* stays stateless and pure math; persistence lives here in the host layer — exactly where the engine's [boundary doc](https://github.com/D-dezeeuw/bag-of-holding/blob/main/docs/boundary.md) puts it.

## Install

> **Not on npm yet.** Neither this package nor its engine peer
> (`@zeeuw/bag-of-holding` ≥ 2.5.0) has been published, so the command below
> will not work until they are. Until then, clone both repos side by side and
> run from source (`npm install && npm start` here resolves the engine via its
> `file:../bag-of-holding` dev link).

```bash
npm install -g @zeeuw/bag-of-holding-mcp
```

## Use it from Claude Desktop

Add to your `claude_desktop_config.json` (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "bag-of-holding": {
      "command": "bag-of-holding-mcp"
    }
  }
}
```

Restart Claude Desktop and the server's 96 tools (dice, checks, combat with the full damage pipeline, rests, conditions, XP, beats, movesets, spellcasting, monster tiers, SRD lookups, sessions — plus campaign memory, state saves, generated world cartridges, the hand-authored world pack, the scene-image gate and the guides) appear automatically, along with the `campaign-quickstart`, `session-recap` and `run-combat` prompts. Tell Claude "you are my DM, use bag-of-holding for every mechanic" and play — or invoke the `campaign-quickstart` prompt and let the guide drive.

New to the whole idea? **[docs/how-to-start.md](docs/how-to-start.md)** walks from zero to a running campaign — setup, memory tokens, the session ritual, semantic memory, and how to audit the dice.

## Tool inventory

| Category | Tools |
| --- | --- |
| **Sessions** | `engine_create_session`, `engine_destroy_session`, `engine_list_sessions`, `engine_get_roll_log`, `engine_verify_log` |
| **Dice** | `dice_roll`, `dice_roll_advantage`, `dice_roll_disadvantage`, `dice_roll_die`, `dice_parse` |
| **Checks** | `checks_ability_check`, `checks_saving_throw`, `checks_mod_from_score`, `checks_clamp_dc` |
| **Combat** | `combat_roll_initiative`, `combat_attack_roll`, `combat_damage_roll`, `combat_apply_mastery`, `combat_mastery_properties`, `combat_apply_damage`, `combat_heal`, `combat_grant_temp_hp`, `combat_drop_to_zero`, `combat_death_save` |
| **Rests** | `rest_short`, `rest_long`, `rest_spend_hit_die` |
| **Conditions** | `conditions_list`, `conditions_apply`, `conditions_remove`, `conditions_has`, `conditions_exhaustion_gain`, `conditions_exhaustion_reduce`, `conditions_exhaustion_set`, `conditions_exhaustion_status` |
| **XP** | `xp_level_for_xp`, `xp_next_level_threshold`, `xp_award_milestone`, `xp_thresholds`, `xp_proficiency_for_level` |
| **Movesets** | `movesets_legal` |
| **Beats** | `beats_archetype_roles`, `beats_validate`, `beats_make_empty`, `beats_thread_create`, `beats_thread_current`, `beats_is_ready`, `beats_is_complete`, `beats_thread_advance` |
| **Character** | `character_derive_sheet`, `character_skill_ability_map` |
| **SRD lookups** | `srd_list`, `srd_get`, `srd_dump` — registries: species, classes, backgrounds, feats, spells, items, monsters |
| **Spellcasting** | `spells_for_class`, `spells_classes_for`, `spells_max_level`, `spells_fresh_slots`, `spells_cast`, `spells_rest`, `spells_cantrip_damage` |
| **Monster tiers** | `monsters_elevate`, `monsters_for_target_cr` |
| **Memory** | `memory_status`, `memory_record`, `memory_search`, `memory_recent`, `memory_forget`, `memory_export`, `memory_import` |
| **Campaigns** (the session-start surface) | `campaign_list`, `campaign_delete` |
| **State vault** | `state_save`, `state_load`, `state_list`, `state_delete` |
| **World packs** (hand-authored, read-only) | `world_list`, `world_overview`, `world_region`, `world_faction`, `world_npc`, `world_hooks`, `world_secrets`, `world_search` |
| **World cartridges** (generated; the playthrough — pin + patch ledger — persists per campaign in the token namespace) | `world_catalog`, `world_begin`, `world_node`, `world_lineage`, `world_commit`, `world_replay` |
| **Scene images** | `image_status`, `image_enable`, `image_disable`, `image_observe` |
| **Guides** | `guide_list`, `guide_get` |

Every engine tool accepts an optional `session` parameter; omit it to use the default (unseeded) singleton, fine for one-shot mechanic queries. For an actual campaign, always `engine_create_session({ seed: <int> })` first so rolls are reproducible.

## Sessions and replay

```text
1. engine_create_session({ id: "campaign-42", seed: 12345 })
2. ...gameplay tools, all with session: "campaign-42"...
3. engine_get_roll_log({ session: "campaign-42" })  → save log to disk
4. (weeks later) engine_verify_log({ seed: 12345, log: [...] })  → { ok: true }
```

If verification fails it returns `{ ok: false, divergedAt, expected, actual }` — the exact roll the AI claims happened but the engine never produced.

## Long campaigns: memory, saves, worlds, guides

Engine sessions live in RAM; campaigns live on disk. The loop (the `campaign-quickstart` prompt walks the model through it):

```text
Session one   world_list → world_overview → engine_create_session({ seed })
              …session zero… → state_save "party" → memory_record (session-summary)
Every start   state_load "party" → memory_recent({ type: "session-summary" })
During play   memory_search when a name resurfaces; world_search for canon;
              memory_record at scene ends and first meetings
Every end     memory_record (session-summary) → state_save "party" → memory_export (backup)
```

- **Memory** is an append-only JSONL log per campaign. Search is BM25 over text + double-weighted entities/tags out of the box — zero dependencies, offline, deterministic. Stand up the two sidecars in [`docker-compose.yml`](docker-compose.yml) (Qwen3-Embedding-0.6B behind an OpenAI-compatible endpoint + Qdrant) and the same tool turns **hybrid**: lexical, semantic and importance/recency rankings fused with reciprocal-rank fusion, so "the smuggler kid with the ledger" finds Tally without her name. Sidecars down? Search degrades to lexical on its own and says so (`retrieval` / `semanticError` in the result).
- **State** is a set of named JSON checkpoints per campaign (party records, a `Session.serialize()` payload, trackers). Memory remembers the story; state remembers the numbers.
- **Worlds** are static, deep-frozen packs. Public layer by default; `layer: "gm"` (and `world_secrets`) is spoiler material the model is instructed to reveal only through play.
- **Guides** ship identically as prompts, resources (`boh://guide/<id>`) and tools, because host support varies.

### Running it as a server (remote connector)

Everything above assumes the local stdio path, where the server is a
subprocess of your AI host and the campaign lives on that machine. It also
runs as a deployed HTTP service, so the campaign lives on the server and any
client can reach it:

```bash
docker compose up -d     # mcp + qdrant + embeddings
```

The MCP surface is `POST /mcp/<token>` with an open `GET /health`. The token
in the URL **is** the tenant — it hashes to that table's storage namespace,
so one deployment serves many tables with no shared state, and the model
never handles it (the `token` parameter is removed from every memory and
state tool when the transport pins the tenant). Point Claude Desktop's "Add
custom connector" at `https://<host>/mcp/<token>`, or
`claude mcp add --transport http boh https://<host>/mcp/<token>`.

The HTTP entrypoint refuses to start without `BOH_MEMORY_TOKEN_HASHES`, so a
half-configured deploy fails closed instead of serving every campaign to
whoever finds the URL. Full walkthrough for the nginx-proxy-manager + CI
deployment: **[docs/deployment.md](docs/deployment.md)**.

### Storage, tokens and the hosted mode

Data root: `$BOH_DATA_DIR`, default `~/.bag-of-holding` (nothing is written until the first write). Every memory/state tool takes an optional `token` — an **opaque string** that namespaces storage under `t-<sha256(token)[0..16]>`; no token means the shared `local` namespace. Tokens are never stored, only hashed. Use any high-entropy string (`openssl rand -base64 32`); never reuse a real credential (an SSH key, an API key) as a token.

```bash
BOH_DATA_DIR=~/.bag-of-holding            # storage root
BOH_MEMORY_TOKEN_HASHES=<sha256>,<sha256> # optional: closed mode
```

With `BOH_MEMORY_TOKEN_HASHES` set the store runs **closed**: only tokens hashing into the list are accepted, and over HTTP anything unlisted gets a 404 (the same 404 as a wrong path, so the endpoint is not an oracle for guessing tokens). That is also the whole auth story for a hosted tier — a billing site mints random tokens and stores only their hashes. Design and roadmap: [docs/implementation-long-campaign.md](docs/implementation-long-campaign.md).

### Semantic memory (optional sidecars)

```bash
docker compose up -d                       # Qdrant + Qwen3-Embedding-0.6B (TEI)
export BOH_EMBEDDINGS_URL=http://localhost:8080/v1
export BOH_QDRANT_URL=http://localhost:6333
```

`memory_search` is now hybrid; `memory_status` reports the semantic state. Full knob list — every one optional:

```bash
BOH_EMBEDDINGS_URL=http://localhost:8080/v1  # OpenAI-compatible /embeddings base; enables semantic search
BOH_EMBEDDINGS_MODEL=Qwen/Qwen3-Embedding-0.6B
BOH_EMBEDDINGS_DIM=256                       # Matryoshka truncation, applied client-side
BOH_EMBEDDINGS_API_KEY=                      # bearer, if your endpoint wants one
BOH_QDRANT_URL=http://localhost:6333
BOH_QDRANT_COLLECTION=boh-memory
BOH_QDRANT_API_KEY=
```

Multi-tenant by construction: one Qdrant collection, every point tagged with the token-derived namespace (`ns`, a tenant-marked index), every query filtered on it server-side. Raw tokens never reach the sidecars. Vectors back-fill lazily — enable the sidecars mid-campaign and the next search embeds the backlog on its own; forgotten records can never resurface because results are intersected with the live log.

## Scene images (`/observe`)

The model owns the prose; the *player* owns the pictures. Image generation is
off in every campaign until someone asks for it, and even then each render is
one deliberate tool call against a budget:

```text
image_status  { campaign }                → enabled? tier, budget, remaining, cooldown
image_enable  { campaign, budget? }       → the player's yes (budget can only tighten)
image_observe { campaign, scene, … }      → ONE picture of what the players can see
image_disable { campaign }                → the player's no
```

Why a gate at all: a model holding an unbounded image tool illustrates every
paragraph, and a sketch costs roughly 47x a text turn. So the ceiling is
structural rather than a polite instruction —

- **off by default**, per campaign, and the DM guide tells the model never to
  enable images on its own initiative;
- **N renders per rolling window** (free tier: 6/hour) plus a **cooldown**
  between renders, so one scene can't be re-rolled ten times;
- **toggling is not a refill.** Spend counters survive `image_disable` +
  `image_enable`; the window refills on the clock and nothing else;
- **the budget lives outside the state vault**, in its own file, so
  `state_save` can't be used to write a bigger one;
- **a failed render is refunded** — a player who got no picture never paid for
  one.

The pacing math is [`llm/imagegate.js`](https://github.com/D-dezeeuw/bag-of-holding-client/blob/main/src/llm/imagegate.js)
in the client toolkit, pure and shared, so a browser host and this server give
the same answer to "may I make a picture right now".

**Rendering is optional.** Configure an image model and the server renders
inline, returning a real MCP image content block — the picture appears in the
chat, wherever the host is:

```bash
BOH_IMAGE_API_KEY=sk-...                  # no key = no rendering (see below)
BOH_IMAGE_URL=https://openrouter.ai/api/v1
BOH_IMAGE_MODEL=google/gemini-2.5-flash-image
BOH_IMAGE_TIER=free                       # free | patron | studio — server-set, never model-set
```

With no key, `image_observe` still gates and still spends — it returns the
composed art-direction prompt plus a short-lived, one-shot **grant** for the app
that owns the pixels (and the player's own API key) to redeem. Same budget,
different renderer; `renderer: "server" | "host"` in every payload says which
you got. That is the same posture `memory_search` takes toward its sidecars:
degrade, and say so.

Tiers are resolved by the deployment, never by the model — no tool accepts a
`tier` parameter. Today that is one env var; the hook for "tokens that have paid
for tier X" is `tierFor(token, env)` in [`src/images.js`](src/images.js), since
the memory token already *is* the tenant.

## Embedding in your own host

If you're building an MCP host instead of using Claude Desktop, you can wire the same tool surface to a custom transport:

```js
import { createServer } from '@zeeuw/bag-of-holding-mcp';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const { server, sessions } = createServer();
await server.connect(new StdioServerTransport());

// Share `sessions` across multiple transports:
const { server: httpServer } = createServer({ sessions });
```

For the HTTP surface, `createHttpHandler()` returns a plain Node request
listener (mount it in your own server), `listen()` starts one, and `main()`
is the container's whole boot sequence — it returns an exit code instead of
calling `process.exit`, so it is testable:

```js
import { createHttpHandler } from '@zeeuw/bag-of-holding-mcp';

const { handler, store } = createHttpHandler({ memory: { dataDir, tokenHashes } });
http.createServer(handler).listen(8091);
```

`sessions` is the in-memory session registry; programmatic code can call `sessions.create`, `sessions.rollLog`, etc. without going through MCP tool dispatch.

## Honest limits

Since 0.2.0 the server does provide persistent narrative memory, mechanical checkpoints, a starter world and play guides. It still does **not** give you:

- Map state or positioning.
- Encounter design or DM judgment — the guides coach the model; the calls stay the model's.
- Enforced voice consistency — `memory_search` makes consistency *possible*; the model still has to ask.
- Semantic retrieval without the sidecars — the base server searches lexically (BM25); meaning-based recall needs the [docker sidecars](#semantic-memory-optional-sidecars) up.
- Automatic recording — nothing is remembered unless the model (or you) calls `memory_record`. The end-of-session ritual in the quickstart guide is what makes a campaign durable.

The engine is the math; the MCP is the wire plus the campaign's filing cabinet; the judgment is yours.

## Development

```bash
npm install
npm test               # node --test
npm run test:coverage  # 100/100/100 is the ongoing contract
npm run typecheck      # tsc --noEmit — drift gate for index.d.ts
```

## License

[MIT](./LICENSE). The engine it wraps is [MPL 2.0](https://github.com/D-dezeeuw/bag-of-holding/blob/main/LICENSE) (file-level copyleft); MPL travels with the engine's files regardless of what wraps them, so this permissive layer doesn't weaken the engine's protection.
