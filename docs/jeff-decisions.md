# JEFF decisions: what is wired in, what is not, and why

**Status:** shipped in 0.21.0, off by default. One integration point is
in: the importance of a `memory_record` when the host leaves it out. Tool
routing was built, measured and left out. The other candidates were rejected
on reading the code. Everything below comes from measurements against a live
JEFF on 29 Sep 2026.

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
```

Log lines go to **stderr** as one JSON object each, prefixed with
`{"jeff":true,…}`. stdout is the MCP stdio channel. A log line carries
numbers (the stored or would-be importance, the score, the confidence and
the record type), never record text and never the key.

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

## Measured and not shipped: tool routing (`boh_route`)

**The idea.** A `boh_route` tool ("which of the 108 tools handles this
request?"), backed by one JEFF `skill_selection` choice over the whole
catalogue, with JEFF's embedding preselection (top 8 of 108, D-067) in front
of a logprobs pick. The server `instructions` would tell hosts to call it
first when unsure.

**Measurement** (`scripts/jeff-route-bench.js`, live JEFF, family
`skill_selection`):

| set | option text | n | top-1 | top-3 | p50 | cost |
|---|---|---|---|---|---|---|
| `jeff-route-fixture.json` | MCP descriptions (`--plain`) | 40 | 92.5 % | 92.5 % | 568 ms | $0.0061 |
| "I try to …" requests (sneak, climb, persuade, search, …) | MCP descriptions | 8 | **0 %** | **0 %** | 569 ms | $0.0010 |
| `jeff-route-fixture.json` | + 4 routing descriptions | 40 | 100 % | 100 % | 502 ms | $0.0059 |
| "I try to …" requests | + 4 routing descriptions | 8 | 87.5 % | 87.5 % | 541 ms | $0.0012 |
| held out (written before the descriptions) | + 4 routing descriptions | 12 | **75 %** | **75 %** | 552 ms | $0.0018 |

**Why it is not shipped:**

1. **It misses the bar on fresh requests.** The first fixture used tool
   vocabulary ("roll initiative", "saving throw") and flattered the router.
   Plain ability-check requests, the most common thing a player says, went
   0 for 8, each routed with confidence to `image_observe` or `world_search`.
   Hand-written routing descriptions for four tools fixed exactly those four
   tools. On the held-out set, every request in an untuned class missed
   (a crossbow attack, "write down that…", "what happened with Orsk last
   time?"). 75 % top-3 is below the ~85 % bar.
2. **Top-3 is no safety net.** Every miss was a preselection drop: the right
   tool got probability 0 because the embedding stage did not rank it in the
   top 8. So top-3 always equals top-1, and a wrong answer is wrong
   outright, not a near miss.
3. **It would not remove what it was meant to remove.** MCP lists every tool
   to the host on every turn whether or not a router exists, and a frontier
   host picks the right tool for these requests without help. The router
   would add a round trip (about 0.5 s plus a host turn) to save reasoning
   the host is good at.
4. **It has no shadow form.** A tool the host can see is a behaviour change
   in itself.

The bench, the fixture and the question builder (including the four routing
descriptions) stay in `scripts/`, which is not published, so the measurement
can be repeated.

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
- **Routing:** re-run `scripts/jeff-route-bench.js` on the held-out set
  after JEFF's preselection changes (see below), and on a fixture drawn from
  real transcripts. Reconsider when top-3 on held-out requests is ≥ 85 %
  and top-3 is actually better than top-1.
- **Relay tier hint:** only if relay logs show a real share of model-less
  completions, or if the tier tables get a `large` slot that differs from
  `medium`.
- **Outcomes:** post `POST /v1/outcomes` when a host later overrides a
  JEFF-given importance (a `memory_forget` followed by a re-record with an
  explicit importance), so JEFF's calibration has labels.

## What JEFF could change (not done here; JEFF is read-only from this repo)

- **Preselection recall on large catalogues.** `skill_selection` keeps the
  top 8 by embedding. With 108 options every miss above was a preselection
  drop, even when the logprob stage would plainly have picked the right tool.
  A `top_k` that grows with the option count (the "would change if" in
  D-067), or rerank preselection for more than ~50 options, would address
  it. A `preselect_recall` telemetry field (was the final pick near the top
  K, and how far was the runner-up) would show this without a labelled set.
- **An unknown family name.** `boh_memory_importance` is not a built-in
  family, so it takes the `default` route (llm_logprobs, falling back to
  llm_json). That is the right engine here. A families entry would still
  let the operator give it its own route and group its telemetry
  explicitly.
