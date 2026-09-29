# JEFF decisions: what is wired in, what is not, and why

**Status:** off by default. Two integration points are in: the importance
of a `memory_record` when the host leaves it out (0.21.0), and a
`route_request` tool that suggests which tool fits a request (0.22.0, after
JEFF's preselection changed). Since 0.23.0 both report what happened
afterwards to JEFF as outcome labels, for its calibration (see
[Outcomes](#outcomes-since-0230)). The other candidates were rejected on
reading the code. Everything below comes from measurements against a live JEFF on
29 Sep 2026.

JEFF is an open, self-hostable decision layer that
speaks the Jev Decisions API. You send it a `state` and typed questions
(`noul` yes/no, `choice`, `score`), and it answers each one with a
probability and says which engine produced the number. It never acts: the
caller decides what to do with an answer.

## The constraints

This package is on npm and runs inside other people's MCP hosts, so the
integration must not get in their way:

- **Invisible unless configured.** It is off until both `BOH_JEFF_URL` and
  `BOH_JEFF_KEY` are set, the same "set a key to turn it on" pattern as
  `BOH_LLM_API_KEY`, `BOH_IMAGE_API_KEY` and `BOH_EMBEDDINGS_URL`. When they
  are unset, `resolveJeffConfig` returns `null`, no client exists, no JEFF
  code path runs and no request is made. The tool list, the schemas, the
  handshake and every result are unchanged. `tests/jeff.test.js` proves it
  by swapping out the global `fetch` and counting the calls.
- **No dependency.** It uses the platform `fetch`, like the embeddings and
  Qdrant clients.
- **Shadow first.** `BOH_JEFF_MODE` defaults to `shadow`: JEFF is asked, and
  what `on` would have done is logged, but nothing changes. Only
  `BOH_JEFF_MODE=on` lets an answer change a result.
- **Fail open.** A timeout (default 4 s), a network error (retried once), a
  non-200 status, a body that is not JSON or not a JEFF response, a missing
  answer, or an answer with confidence below 0.2 all count as "no answer",
  and the server then behaves as if JEFF were not configured. A failure is
  never turned into an answer.
- **Send little.** Each question carries only the text it is about, clipped.
  The exact payload is listed below.
- **https only**, except plain http to a loopback host, so a bearer key never
  crosses a network in the clear. Any other URL leaves JEFF off.

## Environment

```bash
BOH_JEFF_URL=https://jeff.example     # unset = JEFF off (the default)
BOH_JEFF_KEY=…                        # a JEFF API key; unset = JEFF off
BOH_JEFF_MODE=shadow                  # shadow (default) | on — anything else reads as shadow
BOH_JEFF_TIMEOUT_MS=4000              # per request; a timeout is not retried
BOH_JEFF_OUTCOMES=1                   # outcome labels back to JEFF; on unless 0 (or false/off/no)
```

Log lines go to **stderr** as one JSON object each, prefixed with
`{"jeff":true,…}`. stdout is the MCP stdio channel. A log line carries
numbers (the stored or would-be importance, the score, the confidence and
the record type; for routing the top tool name, its probability and the
confidence), never record or request text and never the key.

## Shipped: memory importance when the host gives none

**The gap.** `memory_record` takes `importance` 1–5, and it is optional. The
store saves it only when it is given, and search reads a missing one as 3
(`search.js`: `+ 0.15 × importance`; the hybrid prior sorts by it too). A
host that never fills in the field (the guides ask for text and entities
first) ends up with a log where every record is a 3, so one of search's
three signals carries no information.

**The decision.** One `score` question on the tool's own 1–5 scale, with
five levels described in the memory-protocol guide's terms (trivia, minor,
notable, promise/debt/secret/loss, campaign-defining). The probability-weighted
level is rounded and becomes the importance. An importance the host gave
always wins, and JEFF is not asked.

| mode | what happens |
|---|---|
| unset | exactly as before |
| `shadow` | the record is written exactly as before, and the result is identical. JEFF is then asked in the background, and `{"feature":"memory_importance","mode":"shadow","would_store":4,…}` is logged |
| `on` | JEFF is asked first, bounded by the timeout. The judged importance is stored and the result carries `importanceJudged: { by: "jeff", score, confidence }`. If there is no answer, the record is written exactly as without JEFF |

Before JEFF is called, the tenant is checked with `store.isAuthorized`, so a
token the store would reject never causes a request.

**Evidence** (`scripts/jeff-importance-bench.js` on
`scripts/jeff-importance-fixture.json`: 20 records, labelled from the
memory-protocol guide):

| | exact | within ±1 | mean abs. error | p50 |
|---|---|---|---|---|
| JEFF (`jeff/auto`, llm_logprobs) | **80 %** | **100 %** | **0.20** | 315 ms |
| today's default (3) | 25 % | 65 % | 1.10 | 0 |

The fixture is small, and one author wrote both the records and the labels.
That is enough to justify shadow mode and a look at the logs, and not
enough to switch on by default.

**What leaves the server** (the whole request body):

```json
{"model": "jeff/auto",
 "state": {"type": "event", "text": "<the record text, at most 1000 characters>"},
 "questions": {"importance": {"type": "score", "instructions": "…", "criteria": ["trivia: …", "…"]}},
 "jeff": {"decision_family": "boh_memory_importance"}}
```

The request carries no entities, tags, campaign name, namespace, token or
record id. It does carry the tenant's campaign prose (one record's text),
which is why this is opt-in per deployment and why an operator should point
it only at a JEFF they run or trust. JEFF itself sends the state on to its
configured upstream model (OpenRouter on the reference deployment) and keeps
telemetry per its own settings.

## Shipped in 0.22.0: tool routing (`route_request`)

**The tool.** `route_request { request }` asks one JEFF `skill_selection`
choice over the server's own tool catalogue (every other tool, built from
the live list at startup: the MCP description cut to its first sentences,
or one of four routing descriptions, see below) and returns

```json
{"candidates": [{"tool": "checks_ability_check", "probability": 0.97,
                 "hint": "Resolve a D&D 5e ability check."}, …],
 "confidence": 0.97}
```

with up to three tools (known tool names only, probability ≥ 0.0005, the
hint is the first sentence of that tool's description). The server
`instructions` tell the host to call it first when unsure which tool fits.
The tool name follows the `<group>_<verb>` convention of the other tools.

- **Registered only with JEFF configured.** With `BOH_JEFF_URL` or
  `BOH_JEFF_KEY` unset there is no `route_request` and no `instructions`,
  and the `tools/list` bytes are those of 0.21.0 (`tests/jeff.test.js` pins
  their SHA-256). With JEFF set, the other 108 tools are listed exactly as
  without it.
- **`BOH_JEFF_MODE` does not apply.** It is a query with no side effect, so
  there is nothing for shadow mode to hold back, and a tool the host can see
  cannot be shadowed anyway. It answers in `shadow` and in `on`.
- **Fail open.** Timeout, network error, non-200, a body that is not a JEFF
  response, no `choice` answer, or only unknown tool names: the result is
  `{"candidates": [], "reason": "…"}`, never a tool error. The host then
  picks the tool itself, as it would without JEFF.
- **Advice, not dispatch.** The server does not call the suggested tool.

**What leaves the server** (the whole request body):

```json
{"model": "jeff/auto",
 "state": {"request": "<the request text, at most 500 characters>"},
 "questions": {"tool": {"type": "choice", "instructions": "…",
                        "criteria": {"<tool name>": "<description>", "…": "… (108 entries)"}}},
 "jeff": {"decision_family": "skill_selection"}}
```

The catalogue is this server's public tool list. The request text is the
player's or DM's words, so the same "point it only at a JEFF you trust"
applies as for importance. The log line carries the top tool name, its
probability and the confidence, never the request.

**Routing descriptions.** Four tools get a description in the words players
use (`ROUTE_DESCRIPTIONS` in `src/jeff.js`): `checks_ability_check`,
`checks_saving_throw`, `conditions_apply`, `srd_get`. They ship as part of
the option catalogue and are what makes the held-out set pass (see the
`--plain` rows below). They were written against the "I try to …" set and
before the held-out set.

**Measurement, 0.22.0** (`scripts/jeff-route-bench.js` against production
JEFF, which now runs JEFF D-095/D-096: preselection by rerank with K scaled
to the catalogue, 24 of 108 here, then an `llm_logprobs` pick. 120 requests):

| set | option text | n | top-1 | top-3 | p50 | cost (set) |
|---|---|---|---|---|---|---|
| `jeff-route-fixture.json` (tool vocabulary) | MCP descriptions (`--plain`) | 40 | 95 % | 95 % | 764 ms | $0.0162 |
| `jeff-route-fixture.json` | + 4 routing descriptions | 40 | 100 % | 100 % | 842 ms | $0.0165 |
| `jeff-route-checks-fixture.json` ("I try to …") | MCP descriptions | 8 | 12.5 % | 25 % | 1000 ms | $0.0032 |
| `jeff-route-checks-fixture.json` | + 4 routing descriptions | 8 | 87.5 % | 87.5 % | 941 ms | $0.0033 |
| `jeff-route-heldout-fixture.json` | MCP descriptions | 12 | 33 % | 33 % | 796 ms | $0.0049 |
| `jeff-route-heldout-fixture.json` | **+ 4 routing descriptions** | 12 | **100 %** | **100 %** | 846 ms | $0.0050 |

About $0.0004 and 0.85 s per call. The one miss with routing descriptions is
"I want to recall what I know about this ancient rune" (→ `world_npc`,
`guide_get`, `world_node`; the right tool got 0.04). Without them, plain
ability checks still route to `narration_prompt` or `image_observe`, so the
descriptions carry the result, not the preselection alone.

**Measurement, 0.21.0** (the same bench, JEFF with embedding preselection,
top 8 of 108, JEFF D-067):

| set | option text | n | top-1 | top-3 | p50 | cost |
|---|---|---|---|---|---|---|
| `jeff-route-fixture.json` | MCP descriptions (`--plain`) | 40 | 92.5 % | 92.5 % | 568 ms | $0.0061 |
| "I try to …" requests | MCP descriptions | 8 | 0 % | 0 % | 569 ms | $0.0010 |
| `jeff-route-fixture.json` | + 4 routing descriptions | 40 | 100 % | 100 % | 502 ms | $0.0059 |
| "I try to …" requests | + 4 routing descriptions | 8 | 87.5 % | 87.5 % | 541 ms | $0.0012 |
| held out | + 4 routing descriptions | 12 | 75 % | 75 % | 552 ms | $0.0018 |

**Why it was held back in 0.21.0, and what changed.**

1. *It missed the bar on fresh requests* (75 % top-3 held out, bar 85 %),
   and *top-3 was no safety net*: every miss was a preselection drop (the
   right tool at probability 0, outside JEFF's top 8). JEFF D-095/D-096
   made the preselection scale with the catalogue and rank with a reranker.
   The held-out set now scores 100 % top-3 with the routing descriptions,
   so both reasons are gone. The shipping bar was ≥ 85 % top-3 on held-out
   requests with the descriptions.
2. *It would not remove what it was meant to remove*: MCP still lists every
   tool, and a frontier host usually picks right unaided. That still holds,
   which is why the tool is advice the host may call "when unsure", not a
   step every turn, and why it is off unless an operator configures JEFF.
3. *It has no shadow form*: also still true. So `BOH_JEFF_MODE` does not
   gate it; configuring JEFF is the switch.

**Caveats.** The sets are small (12 held-out requests) and one author wrote
them. JEFF's own D-095 fixture includes these 12 requests, so they were
also used to choose JEFF's new preselection default; they are held out from
the routing descriptions, not from JEFF's tuning. Classes the four routing
descriptions do not cover depend on the tools' own descriptions, which say
what a tool computes rather than what a player says.

## Outcomes (since 0.23.0)

JEFF calibrates on labels: after a decision, the caller says what the right
answer turned out to be (`POST /v1/outcomes`, joined to the decision by its
id). The Hermes plugin was the first source of such labels; this server is
the second. Both features now report one, whenever JEFF is configured,
unless `BOH_JEFF_OUTCOMES=0`.

**The body, the whole of it:**

```json
{"request_id": "req_01K…", "question": "importance", "outcome": "label", "label": 3}
{"request_id": "req_01K…", "question": "tool",       "outcome": "label", "label": "srd_get"}
```

`request_id` is the `id` JEFF returned for the decision, `question` the
question key the decision asked. An importance label is a **level index**
(importance − 1, 0–4), which is how JEFF's calibration export reads a score
label. A tool label is the catalogue key. No `notes`, no record or request
text, no campaign, namespace, tenant token or record id. The bearer key is
the same as for decisions.

**When an importance label is posted:**

| JEFF judged the record… | then the host… | label |
|---|---|---|
| `on` or `shadow`, record without importance | later records the **same record** again with an explicit importance | that importance, for the earlier decision, once |
| `shadow`, the host gave an importance in the same call | (nothing further) | JEFF is asked in the background exactly as for a record without importance, and the host's importance is posted as the label of that decision |
| `on`, the host gave an importance | | nothing: the host's value is used and JEFF is not asked |

"The same record" is the same tenant, campaign, `type` and text (whitespace
normalised). The memory log is append-only with no update tool, and the
memory protocol corrects a record by recording it again and forgetting the
old one; a re-record of the same text with an explicit importance is how a
host overrides an importance. A corrected *text* is a different record and
posts nothing, because JEFF judged the old words. The link from decision to
record is kept in process memory only: an LRU of at most 1000 entries
(`hash(tenant, campaign, type, text)` → decision id, record id), lost on
restart. A low-confidence answer that stored nothing is still remembered: a
label calibrates exactly those. The shadow row is the richest source: every
record the host scores itself becomes a (JEFF's judgment, host's value) pair,
and the log line `{"feature":"memory_importance","mode":"shadow","would_store":2,"host":4,…}`
shows the same pair locally. It costs one JEFF call per such record, in
shadow mode only.

**When a tool label is posted:** `route_request` returned candidates, and the
host's **next tool call in the same session**, within 120 s, is one of the
catalogued tools (every tool but `route_request`). That tool is the label,
whether or not it was a candidate. The next call consumes the pending
decision, so a second `route_request`, a call after the window, or a
`route_request` that returned no candidates posts nothing.

- *Session.* Over HTTP the server is stateless (one MCP server per request,
  no MCP session id), so the **tenant** stands in for the session: two tables
  on one tenant token at the same time can label each other's routing. Over
  stdio the **process** is the session (one host per process). The key is a
  hash of the tenant token, kept in memory (at most 1000 pending decisions).
- *Noise.* "The next call" is a heuristic: a host that routes, then reads
  memory before acting, labels the routing `memory_search`. The label says
  what the host did, not what was right. Read it in JEFF's `report` before
  fitting on it.
- *Only dispatched calls count.* A call the MCP SDK rejects on its input
  schema never reaches a handler, so it neither labels nor consumes the
  decision; the host's corrected retry does.

**Fire and forget.** A post is started alongside the tool call and never
awaited: the tool result does not wait for it, and a test holds the fake
JEFF's outcome endpoint for 1.5 s and checks the result still arrives in
under 100 ms. At most four posts are in flight (more are skipped with a log
line), each bounded by `BOH_JEFF_TIMEOUT_MS`, with no retry. JEFF down, slow
or answering an error costs one stderr line
(`{"jeff":true,"feature":"outcome","outcome":"failed_open",…}`); a delivered
one logs `{"feature":"outcome","question":"tool","label":"srd_get","status":202}`.
Only ids in JEFF's format (`req_` + ULID) are ever posted.

## Rejected after reading the code

- **Solo-session oracle** (`src/tools/solo.js`). The solo tools are stateless
  snapshot dispatch over a whitelist of kernel `Session` methods. They make
  no judgment calls to improve: whether an action needs a check, which
  ability, the DC, and whether the scene moves on are all left to the host,
  on purpose (README "Honest limits": DM judgment stays the model's). The
  kernel's Mythic-style oracle is not even exposed. Putting a small logprob
  model in front of a frontier host's rulings would replace the better judge
  with a worse one.
- **Beats readiness and completion.** `beats_is_ready` and
  `beats_is_complete` check whether flags are set in a state map. That is a
  deterministic fact, and JEFF's own guidance is never to ask one.
- **"Worth remembering?" and memory category.** The host decided to call
  `memory_record`, and a server that refused the record would be overruling
  it. `type` is required by the schema, so there is no missing category to
  fill in. Compaction (the MCP-sampling follow-up) is not built, and a
  yes/no or score question cannot write a summary anyway.
- **Relay tier hint.** The client toolkit names a model on every relayed
  call, chosen by call kind, and the relay never overrides an explicit
  model. Its only fallback is the tier's `medium` slot, and `medium` equals
  `large` in both tier tables. A hint would add 0.5–1.5 s to every relayed
  turn and send the player's prose to a second service, and it would have
  almost nothing to decide.

## Future work, and the evidence that would justify it

- **Importance, on by default:** a few weeks of shadow logs (`would_store`)
  set against records whose importance the host did give, or against
  corrections made through `memory_forget`. Switch it on if JEFF agrees with
  host-given values about as often as the fixture shows (≥ 75 % exact).
- **Routing:** a fixture drawn from real transcripts (the `tool_route` log
  lines give the top pick; the tool the host then called gives the label).
  Add a routing description for each class that misses there, the way the
  four existing ones fixed ability checks, saves, conditions and lookups. If
  real-transcript top-3 falls below 85 %, take the tool out again.
- **Relay tier hint:** only if relay logs show a real share of model-less
  completions, or if the tier tables get a `large` slot that differs from
  `medium`.
- **Importance labels beyond the same text:** a host that corrects a record
  (new text) and forgets the old one also says something about the old
  importance, but not a clean label for JEFF's judgment of the old words. It
  posts nothing today.

## What JEFF could change (not done here; JEFF is read-only from this repo)

- **Tell label sources apart.** An outcome has no field for where a label
  came from, and `notes` is free text (dropped under strict privacy). A
  host override, a shadow pair and a "next tool call" heuristic are
  different grades of label; a small `source` enum on `/v1/outcomes` would
  let the calibration export filter them without a note.

- **Preselection recall on large catalogues.** Done in JEFF D-095/D-096
  (K scales with the option count, rerank preselection for
  `skill_selection`, `kept_min_score`/`dropped_top_score` in the response),
  which is what let routing ship in 0.22.0.
- **An unknown family name.** `boh_memory_importance` is not a built-in
  family, so it takes the `default` route (llm_logprobs, falling back to
  llm_json). That is the right engine here. A families entry would still
  let the operator give it its own route and group its telemetry
  explicitly.
