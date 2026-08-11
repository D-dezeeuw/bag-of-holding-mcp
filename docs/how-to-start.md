# How to start an MCP-driven LLM adventure

You bring an MCP-aware AI host (Claude Desktop, Cursor, or your own).
The server brings everything else: real dice the model can't fudge,
SRD 5.2 rules, a world with its secrets already written, campaign
memory that outlives any chat window, and the playbooks that teach
the model to be a decent DM. This page takes you from nothing to
"the lanterns of Wickmere are lit and something is wrong in the fen"
— and back to the same campaign next week.

## 1. What you need

- **Node ≥ 22** and an MCP host. The walkthrough uses Claude Desktop;
  any host that speaks MCP over stdio works the same.
- **This server.** Until the npm release lands, clone the two repos
  side by side and install:

  ```bash
  git clone https://github.com/D-dezeeuw/bag-of-holding.git
  git clone https://github.com/D-dezeeuw/bag-of-holding-mcp.git
  cd bag-of-holding-mcp && npm install
  ```

- *(Optional, recommended for long campaigns)* **Docker**, for the
  semantic-memory sidecars in step 6.

## 2. Wire it into your host (5 minutes)

Add the server to `claude_desktop_config.json` (macOS:
`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "bag-of-holding": {
      "command": "node",
      "args": ["/absolute/path/to/bag-of-holding-mcp/bin/cli.js"]
    }
  }
}
```

Restart the host. You should see the bag-of-holding tools appear
(84 of them), plus three prompts: `campaign-quickstart`,
`session-recap`, `run-combat`.

**Smoke test** — ask the model:

> Roll 2d6+3 with bag-of-holding.

You should get a real `dice_roll` call with two visible dice. If the
model "rolls" without a tool call, say: *"Use the bag-of-holding
tools for every mechanic — no exceptions."* That sentence is the
whole trust model.

## 3. Pick your memory token (multi-tenant in one line)

Everything the campaign remembers (the story log and the mechanical
save files) is stored under a **token** — an opaque string that acts
as your private shelf. Different token, different shelf: one server
happily serves your table, your partner's table, and a stranger's.

```bash
openssl rand -base64 32     # this is your token — treat it like a password
```

Rules of the shelf:

- Any string works. The server never stores it — only a hash of it
  names your storage folder.
- **Never reuse a real credential** (SSH key, API key) as a token,
  and never paste your token into the story itself.
- No token is fine for a private machine: you get the shared `local`
  shelf.
- Where things land: `~/.bag-of-holding` (override with
  `BOH_DATA_DIR`).

Tell the model once, at the start of a session: *"My memory token is
`<token>`, campaign `<name>` — pass them to every memory and state
tool."*

## 4. Session zero → first campaign

The fastest start is the built-in prompt: in Claude Desktop, pick
**campaign-quickstart** from the prompt menu (＋), give it a campaign
name (e.g. `curse-of-the-fen`) and the world `greyfen-march`. The
prompt walks the model through the whole setup ritual:

1. `engine_create_session` with a **seed** — this is what makes every
   roll reproducible and auditable later;
2. `world_overview` of **The Greyfen March** — a fen province of
   Sundermark where the gods died three centuries ago and the
   province lives off their estate; three ready-made openers included;
3. session zero: party building through `character_derive_sheet`,
   table expectations, binding each PC to a faction or NPC;
4. the first save: `state_save "party"` + a session-zero summary in
   memory.

No prompt menu in your host? Paste this instead:

> You are my DM. Call `guide_get` with id `campaign-quickstart` on
> bag-of-holding and follow it exactly. My memory token is `<token>`,
> the campaign is `<name>`, the world is `greyfen-march`.

What an honest exchange looks like in play:

> **You:** I search the drowned pews for the postulant's satchel.
> **DM:** *(calls `checks_ability_check` — Investigation, DC 13 → 16,
> success)* Your fingers close on wet leather wedged under a pew that
> has been straightened — recently, and not by you. Inside: three
> torn ledger pages. *(calls `memory_record`: "Party recovered three
> potency-ledger pages from the Under-Nave…")*

The model narrates; the engine decides. If the fiction and the dice
disagree, the dice win.

## 5. The ritual that makes it a campaign

Ending a sitting (say it, or let the quickstart guide drive):

> Wrap up: record a session summary, save the party, and give me a
> memory export as a backup.

Resuming next week (or next month, or on another machine):

> Use the **session-recap** prompt for campaign `<name>` — or:
> "Load campaign `<name>`: state_load the party, read the latest
> session summaries, recap, and continue."

Useful table phrases the tools understand well:

| Say | What happens |
| --- | --- |
| "What do we know about Maela?" | `memory_search` + `world_npc` — log first, canon second |
| "Save the game" | `state_save` party (+ session serialization if mid-fight) |
| "Recap last session" | `memory_recent` type `session-summary` |
| "That fact was wrong, fix it" | corrected `memory_record`, then `memory_forget` the bad id |
| "Prove that crit was real" | `engine_get_roll_log` / `engine_verify_log` |

## 6. Turn on semantic memory (the long-campaign upgrade)

Out of the box, memory search is lexical — great at names ("Maela",
"Tollgate"), blind to paraphrase ("that smuggler kid with the
ledger"). The fix is two local containers: Qwen3-Embedding-0.6B for
meaning, Qdrant for vectors. Nothing leaves your machine.

```bash
cd bag-of-holding-mcp
docker compose up -d        # first start downloads the model once
```

Then hand the server the two URLs (in the host config, so it survives
restarts):

```json
"bag-of-holding": {
  "command": "node",
  "args": ["/absolute/path/to/bag-of-holding-mcp/bin/cli.js"],
  "env": {
    "BOH_EMBEDDINGS_URL": "http://localhost:8080/v1",
    "BOH_QDRANT_URL": "http://localhost:6333"
  }
}
```

That's it. `memory_status` now reports the semantic state, search
results say `retrieval: "hybrid"`, and old campaigns upgrade
themselves — the first search embeds the backlog automatically.
Stop the containers and search quietly falls back to lexical; start
them again and the next search heals. Tenancy carries through: your
token's namespace travels with every vector, and no query can cross
it.

## 7. Dice you can audit

Every roll flows through the engine's seeded RNG into an append-only
log. At any point:

> Export the roll log for this session.

…and weeks later, `engine_verify_log` with the saved seed + log
proves the whole dice stream reproduces — or names the exact roll
that doesn't. If a player suspects the DM of mercy (or malice), the
log settles it. This only works if the session was **seeded**, which
is why the quickstart insists.

## 8. More tables, more players, one server

- **Several campaigns, one person:** same token, different campaign
  names.
- **Several people, one machine:** one token per table; nobody can
  read a shelf they don't hold the token for.
- **Hosting for others:** set `BOH_MEMORY_TOKEN_HASHES` to the
  SHA-256 hashes of the tokens you've issued and the store runs
  closed — unknown tokens are refused outright. This is the same
  shape a paid hosted tier runs; details in
  [implementation-long-campaign.md](implementation-long-campaign.md).

### Playing against a deployed server

If someone has already deployed this (see
[deployment.md](deployment.md)), you don't install anything at all —
the campaign lives on the server and you connect to a URL:

- **Claude Desktop**: Settings → Connectors → *Add custom connector*.
  Title it whatever you like, paste `https://<host>/mcp/<token>` as
  the MCP server URL, leave the OAuth fields blank.
- **Claude Code**:
  `claude mcp add --transport http boh https://<host>/mcp/<token>`

Your token is already in that URL, so skip step 3 entirely — you'll
notice the memory tools have no `token` parameter at all in this
mode, which is deliberate: the model can't see it, so it can't leak
it into the story. Everything else in this guide works identically.

Two things follow from the token being in a URL. Treat the whole URL
as the password (it lands in browser history and access logs more
readily than a header would), and don't paste it into the chat —
it's configuration, not conversation.

## 9. When something's off

| Symptom | Fix |
| --- | --- |
| No bag-of-holding tools in the host | Absolute path in the config; Node ≥ 22 (`node -v`); restart the host fully |
| Model narrates numbers without tool calls | Say the sentence from step 2; start sessions via the quickstart prompt, which bakes the rule in |
| "Invalid or missing memory token" | The server runs closed (`BOH_MEMORY_TOKEN_HASHES`); pass an issued token |
| `retrieval: "lexical"` with a `semanticError` | Sidecars down or still downloading the model — `docker compose ps`; search keeps working meanwhile |
| Campaign "gone" after a chat reset | It isn't: `memory_status` → your campaigns are on disk; run the session-recap prompt |
| Remote connector 404s | Wrong or unlisted token — an unknown token and a wrong path return the same 404 on purpose. Check the URL against the issued one; `GET /health` should return `{"ok":true}` regardless |
| Remote connector rejects everything after a token rotation | Storage is namespaced *by token*, so a new token is a new empty shelf. `memory_export` under the old token first, then import under the new one |
| Genuinely lost the disk | Restore from your latest `memory_export` with `memory_import`, `state_save` the party from the export's records, keep playing |

---

*The engine is the math, the server is the filing cabinet, the model
is the voice — and the campaign is yours.*
