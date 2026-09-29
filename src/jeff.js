// JEFF — an optional decision layer, off unless a deployment configures it.
//
// JEFF (an open, self-hostable decision layer speaking the Jev Decisions API)
// answers bounded judgments — yes/no, pick one, place on a
// scale — with a probability and says where the number came from. This server
// is model-free by design: the connected host LLM narrates and decides. JEFF
// does not change that; it fills a gap where the server today falls back to a
// constant because nobody made the call (see docs/jeff-decisions.md for which
// gaps, which were rejected, and why).
//
// Four rules, all of them tested:
//
//   • Invisible unless configured. No BOH_JEFF_URL + BOH_JEFF_KEY → the
//     resolver returns null, no client exists, no JEFF code path runs, and no
//     request is ever made. The published package's default behaviour does not
//     change by one byte.
//   • Shadow first. BOH_JEFF_MODE defaults to "shadow": JEFF is asked, the
//     answer is logged with what "on" would have done, and nothing changes.
//     Only BOH_JEFF_MODE=on lets an answer affect a result.
//   • Fail open. Timeout, network error, non-200, a body that is not a JEFF
//     response, a missing answer: all are `null`, and every caller treats null
//     as "behave exactly as if JEFF were not configured". A failure is never
//     turned into an answer (JEFF's own design rule 5).
//   • Say little. Each feature sends only the text its question is about,
//     clipped; never a token, a namespace, a campaign name or a record id.
//     An outcome (POST /v1/outcomes, since 0.23.0) carries only JEFF's own
//     decision id, the question key, the observed label and its source.
//
// No dependency: the platform fetch, like the embeddings and Qdrant clients.

export const DEFAULT_JEFF_TIMEOUT_MS = 4000;
export const JEFF_MODES = Object.freeze(['shadow', 'on']);

/** Longest memory text sent for an importance judgment. Records are 1-3 sentences by protocol. */
export const MEMORY_TEXT_MAX_CHARS = 1000;

/** A score answer less concentrated than this is treated as "no opinion" (JEFF D-070's default floor). */
export const MIN_CONFIDENCE = 0.2;

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/** JEFF's decision id: req_ + a ULID (JEFF server/contract/response.js). Anything else is never posted. */
export const JEFF_REQUEST_ID_RE = /^req_[0-9A-HJKMNP-TV-Z]{26}$/;

/** At most this many outcome posts in flight; more are skipped with a log line (as the Hermes plugin does). */
export const OUTCOME_MAX_IN_FLIGHT = 4;

/** Importance decisions remembered per process for a later host override (LRU). */
export const IMPORTANCE_MEMORY_MAX = 1000;

/** A route_request answer is labelled by the next tool call only within this window. */
export const ROUTE_OUTCOME_WINDOW_MS = 120_000;

/** Pending routing decisions kept per process (one per session key; HTTP has one per tenant). */
export const ROUTE_PENDING_MAX = 1000;

/**
 * Read the JEFF configuration out of an environment.
 *
 * Returns `null` — JEFF off — unless both BOH_JEFF_URL and BOH_JEFF_KEY are
 * set, and also when the URL is not https (plain http is accepted only to a
 * loopback host, so a bearer key never crosses a network in the clear). The
 * key is never echoed into a tool payload or a log line.
 *
 * @param {Record<string, string|undefined>} [env]
 */
export function resolveJeffConfig(env = process.env) {
  const rawUrl = typeof env.BOH_JEFF_URL === 'string' ? env.BOH_JEFF_URL.trim() : '';
  const key = typeof env.BOH_JEFF_KEY === 'string' ? env.BOH_JEFF_KEY.trim() : '';
  if (rawUrl === '' || key === '') return null;
  let url;
  try { url = new URL(rawUrl); } catch { return null; }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOOPBACK.has(url.hostname))) return null;
  const mode = JEFF_MODES.includes(env.BOH_JEFF_MODE ?? '') ? env.BOH_JEFF_MODE : 'shadow';
  const timeout = Number.parseInt(env.BOH_JEFF_TIMEOUT_MS ?? '', 10);
  // Outcomes are on whenever JEFF is; BOH_JEFF_OUTCOMES=0 (or false/off/no)
  // switches them off. Empty (the compose pass-through) means on.
  const outcomesFlag = String(env.BOH_JEFF_OUTCOMES ?? '').trim().toLowerCase();
  return {
    url: rawUrl.replace(/\/+$/, ''),
    key,
    mode,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_JEFF_TIMEOUT_MS,
    outcomes: !['0', 'false', 'off', 'no'].includes(outcomesFlag),
  };
}

/** One JSON line on stderr. stdout is the MCP stdio channel and must stay clean. */
function defaultLog(entry) {
  try { process.stderr.write(`${JSON.stringify({ jeff: true, ...entry })}\n`); } catch { /* logging never breaks a turn */ }
}

/**
 * A client for `POST <url>/v1/systemone`, or null when `config` is null —
 * callers hold `jeff ?? null` and skip every JEFF path on null.
 *
 * `decide()` never throws and never rejects: it resolves to the parsed JEFF
 * response, or to null on anything else. One retry on a network error (a
 * refused or reset connection); none on a timeout, because a retry would
 * double the wait the timeout exists to bound.
 *
 * @param {ReturnType<typeof resolveJeffConfig>} config
 * @param {{ fetchImpl?: typeof fetch, log?: (entry: object) => void, now?: () => number }} [opts]
 */
export function createJeffClient(config, opts = {}) {
  if (!config) return null;
  const fetchImpl = opts.fetchImpl ?? fetch;
  const log = opts.log ?? defaultLog;

  async function attempt(body, signal) {
    const res = await fetchImpl(`${config.url}/v1/systemone`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.key}` },
      body,
      signal,
    });
    if (res.status !== 200) return { error: `status ${res.status}` };
    let json;
    try { json = await res.json(); } catch { return { error: 'body not JSON' }; }
    if (!json || typeof json !== 'object' || !json.answers || typeof json.answers !== 'object') {
      return { error: 'not a JEFF response' };
    }
    return { json };
  }

  async function once(body) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), config.timeoutMs);
    const out = await attempt(body, ctl.signal)
      .catch(() => (ctl.signal.aborted ? { error: 'timeout' } : { error: 'network', retry: true }));
    clearTimeout(timer);
    return out;
  }

  return {
    mode: config.mode,
    /** The outcome reporter (see createOutcomeReporter), or null with BOH_JEFF_OUTCOMES=0. */
    outcomes: config.outcomes === false ? null : createOutcomeReporter(config, { fetchImpl, log, now: opts.now }),
    /**
     * Ask JEFF. `feature` names the caller in the log line; `family` is JEFF's
     * decision family (routing and telemetry grouping on its side).
     */
    async decide({ feature, family, state, questions }) {
      const body = JSON.stringify({
        model: 'jeff/auto',
        state,
        questions,
        ...(family ? { jeff: { decision_family: family } } : {}),
      });
      let out = await once(body);
      if (out.retry) out = await once(body);
      if (out.error) {
        log({ feature, outcome: 'failed_open', reason: out.error });
        return null;
      }
      return out.json;
    },
    log,
  };
}

/** JEFF's decision id of a response, or null when it is not a well-formed one. */
export function decisionId(response) {
  const id = response?.id;
  return typeof id === 'string' && JEFF_REQUEST_ID_RE.test(id) ? id : null;
}

// ---------------------------------------------------------------------------
// Outcomes: what happened after a decision (JEFF POST /v1/outcomes).
//
// JEFF joins an outcome to its decision by id and fits calibration on the
// `label` outcomes. Two kinds, wired in src/tools/memory.js and
// src/tools/route.js:
//
//   • importance — the host's explicit importance for a record JEFF judged
//     (a later re-record of the same text, or, in shadow mode, the value the
//     host gave in the very request JEFF judged in the background). The label
//     is a score level index: importance − 1.
//   • tool — the catalogue tool the host called next after route_request
//     (same session, within ROUTE_OUTCOME_WINDOW_MS). The label is its name.
//
// Every post is fire-and-forget: never awaited by a tool, bounded by the
// client timeout, at most OUTCOME_MAX_IN_FLIGHT at once, not retried, and any
// failure is one log line. The body is
// { request_id, question, outcome: "label", label, source } and nothing else:
// no text, no campaign, no namespace, no token. `source` (0.24.0, JEFF D-099)
// says who knew the label: `host_override` (the host re-recorded a judged
// record), `shadow_pair` (the host's own value for a record judged in the
// background) or `next_call` (the tool called after route_request). A JEFF
// older than D-099 answers 422 to the field; the post is then sent once more
// without it, and every later post in this process leaves it out (one log
// line when that happens).
// ---------------------------------------------------------------------------

/**
 * @param {NonNullable<ReturnType<typeof resolveJeffConfig>>} config
 * @param {{ fetchImpl: typeof fetch, log: (entry: object) => void, now?: () => number }} deps
 */
export function createOutcomeReporter(config, { fetchImpl, log, now = Date.now }) {
  let inFlight = 0;
  const running = new Set();
  /** fingerprint → { id, record }, in insertion (= recency) order: an LRU. */
  const importance = new Map();
  /** session key → { id, at } */
  const routes = new Map();

  function safeLog(entry) { try { log(entry); } catch { /* never breaks a call */ } }

  /**
   * Whether this JEFF accepts `source` (D-099). Assumed yes until a 422 names
   * the field; then every later post in this process leaves it out.
   */
  let sendSource = true;

  function send(body, signal) {
    return fetchImpl(`${config.url}/v1/outcomes`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${config.key}` },
      body: JSON.stringify(body),
      signal,
    });
  }

  function post(body) {
    if (inFlight >= OUTCOME_MAX_IN_FLIGHT) {
      safeLog({ feature: 'outcome', question: body.question, outcome: 'skipped', reason: 'in_flight' });
      return false;
    }
    inFlight += 1;
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), config.timeoutMs);
    const p = (async () => {
      try {
        const { source, ...bare } = body;
        let res = await send(sendSource ? body : bare, ctl.signal);
        let text = '';
        try { text = await res.text(); } catch { /* the body is only read for the 422 check */ }
        // A JEFF older than D-099 refuses the field it does not know (422,
        // issues[].path "source"): send it once more without the field, and
        // leave it out from then on.
        if (res.status === 422 && sendSource && text.includes('source')) {
          sendSource = false;
          safeLog({ feature: 'outcome', outcome: 'source_unsupported', reason: 'JEFF refused the source field (422); outcomes are sent without it from now on' });
          res = await send(bare, ctl.signal);
          try { await res.text(); } catch { /* the body is not needed */ }
        }
        safeLog({ feature: 'outcome', question: body.question, label: body.label, status: res.status });
      } catch {
        safeLog({ feature: 'outcome', question: body.question, outcome: 'failed_open', reason: ctl.signal.aborted ? 'timeout' : 'network' });
      } finally {
        clearTimeout(timer);
        inFlight -= 1;
      }
    })();
    running.add(p);
    p.finally(() => running.delete(p));
    return true;
  }

  function label(id, question, value, source) {
    if (typeof id !== 'string' || !JEFF_REQUEST_ID_RE.test(id)) return false;
    return post({ request_id: id, question, outcome: 'label', label: value, source });
  }

  return {
    /** Remember an importance decision for a record, for a later host override. */
    rememberImportance(fingerprint, id, record) {
      if (typeof id !== 'string' || !JEFF_REQUEST_ID_RE.test(id)) return;
      importance.delete(fingerprint);
      importance.set(fingerprint, { id, record });
      while (importance.size > IMPORTANCE_MEMORY_MAX) importance.delete(importance.keys().next().value);
    },
    /**
     * The host gave an explicit importance (1-5) for a record with this
     * fingerprint. Posts it as the label of the remembered decision (once)
     * and returns true, or returns false when none is remembered.
     */
    importanceOverride(fingerprint, value) {
      const hit = importance.get(fingerprint);
      if (!hit) return false;
      importance.delete(fingerprint);
      label(hit.id, 'importance', value - 1, 'host_override');
      return true;
    },
    /** Post an importance (1-5) as the label of decision `id`. */
    importanceLabel(id, value) { return label(id, 'importance', value - 1, 'shadow_pair'); },
    /** route_request answered with decision `id` in this session. */
    routed(session, id) {
      if (typeof id !== 'string' || !JEFF_REQUEST_ID_RE.test(id)) return;
      routes.delete(session);
      routes.set(session, { id, at: now() });
      while (routes.size > ROUTE_PENDING_MAX) routes.delete(routes.keys().next().value);
    },
    /**
     * A tool was called in this session. If route_request answered before it
     * (within the window) and `tool` is in the routed catalogue, post the
     * tool as the label. The pending decision is consumed either way, so a
     * second route_request or a non-catalogue tool posts nothing.
     */
    toolCalled(session, tool, inCatalogue) {
      const p = routes.get(session);
      if (!p) return false;
      routes.delete(session);
      if (!inCatalogue || now() - p.at > ROUTE_OUTCOME_WINDOW_MS) return false;
      return label(p.id, 'tool', tool, 'next_call');
    },
    /** Resolves when every post in flight has finished (tests, shutdown). */
    settled: () => Promise.allSettled([...running]),
    /** How many importance decisions are remembered. */
    get remembered() { return importance.size; },
  };
}

/** Read a `score` answer, or null when JEFF did not answer that key. */
export function readScore(response, key) {
  const a = response?.answers?.[key];
  if (!a || a.type !== 'score' || typeof a.score !== 'number' || !Number.isFinite(a.score)) return null;
  const confidence = typeof a.confidence === 'number' ? a.confidence : null;
  return { score: a.score, confidence, probabilities: a.probabilities ?? null };
}

// ---------------------------------------------------------------------------
// Feature: memory importance, when the host did not give one.
//
// `memory_record` takes `importance` 1-5 and stores 3 when it is omitted. The
// search ranks by importance alongside text and recency, so a log where every
// record is a 3 has lost one of its three signals. The host usually omits it
// (it is optional, and the guides ask for text and entities first). This asks
// JEFF to place the record on the tool's own 1-5 scale — the host's number
// always wins when it gave one.
// ---------------------------------------------------------------------------

export const IMPORTANCE_LEVELS = Object.freeze([
  'trivia: colour or a passing detail nobody will need to recall',
  'minor: a small fact that might come up again',
  'notable: a named person, place, item or event that is likely to matter again in this story arc',
  'major: a promise, debt, secret, alliance, betrayal, death or loss that will shape the next sessions',
  "campaign-defining: changes the campaign's direction (a main villain revealed, a world-changing event, the party's central goal set or ended)",
]);

export const IMPORTANCE_QUESTION = Object.freeze({
  type: 'score',
  instructions: 'How important is this campaign memory for a tabletop RPG campaign that will run for months? Pick the level whose description fits best.',
  criteria: IMPORTANCE_LEVELS,
});

/**
 * The whole state that leaves the server for an importance judgment: the
 * record's type and its text, clipped. Not entities, tags, the campaign name,
 * the namespace or the token.
 */
export function importanceState(type, text) {
  const t = String(text);
  return { type, text: t.length > MEMORY_TEXT_MAX_CHARS ? `${t.slice(0, MEMORY_TEXT_MAX_CHARS)} …` : t };
}

/**
 * Ask JEFF for an importance. Resolves to `{ importance, score, confidence }`
 * (importance on the tool's 1-5 scale) or null — no answer, or an answer with
 * too little confidence to act on.
 */
export async function judgeImportance(jeff, type, text) {
  return (await askImportance(jeff, type, text)).judgment;
}

/**
 * judgeImportance plus JEFF's decision id: `{ id, judgment }`. `id` is set
 * whenever JEFF answered the importance question with a well-formed id, even
 * with too little confidence to act on (a later label still calibrates it);
 * `judgment` is what judgeImportance returns.
 */
export async function askImportance(jeff, type, text) {
  const res = await jeff.decide({
    feature: 'memory_importance',
    family: 'boh_memory_importance',
    state: importanceState(type, text),
    questions: { importance: IMPORTANCE_QUESTION },
  });
  const s = readScore(res, 'importance');
  if (!s) return { id: null, judgment: null };
  const id = decisionId(res);
  if (s.confidence !== null && s.confidence < MIN_CONFIDENCE) return { id, judgment: null };
  const importance = Math.min(5, Math.max(1, Math.round(s.score) + 1));
  return { id, judgment: { importance, score: s.score, confidence: s.confidence } };
}

// ---------------------------------------------------------------------------
// Feature: tool routing (`route_request`), registered only when JEFF is
// configured.
//
// One `skill_selection` choice over the server's own tool catalogue: which
// tool handles what a player or the DM just said? JEFF preselects (rerank,
// K scaled with the option count, JEFF D-095/D-096) and a logprobs pick
// ranks the survivors. The answer is advice to the host, which still picks.
// It is a query with no side effect, so BOH_JEFF_MODE does not apply.
// Measured in docs/jeff-decisions.md (scripts/jeff-route-bench.js).
// ---------------------------------------------------------------------------

/** Longest request text sent for a routing judgment. */
export const ROUTE_TEXT_MAX_CHARS = 500;

/** How many candidates route_request returns. */
export const ROUTE_TOP_N = 3;

/**
 * Routing descriptions for tools whose MCP description says what the tool
 * computes but not which player requests need it. The preselection compares
 * the request with these words, and "I climb the wall" shares none with
 * "Resolve a D&D 5e ability check": without them 1 of 8 plain ability-check
 * requests and 4 of 12 held-out requests routed right; with them 7 of 8 and
 * 12 of 12 (docs/jeff-decisions.md). They are part of the option catalogue.
 */
export const ROUTE_DESCRIPTIONS = Object.freeze({
  checks_ability_check: 'A character attempts something with an uncertain outcome: sneaking, climbing, jumping, swimming, forcing a door, picking a lock, persuading, deceiving, intimidating, haggling, searching, noticing, listening, reading someone\'s intent, recalling lore, handling an animal. Resolves the ability or skill check.',
  checks_saving_throw: 'A creature must resist something that happens to it: a trap, poison, a spell, a breath weapon, a fall, a charm or fear effect. Resolves the saving throw.',
  conditions_apply: 'Something leaves a creature poisoned, paralyzed, petrified, stunned, frightened, charmed, blinded, deafened, grappled, restrained, prone, incapacitated or unconscious. Applies the condition to the actor.',
  srd_get: 'Look up the rules text or stat block of one specific spell, monster, item, weapon, armor, feat, class, species or background: what does it do, what are its stats.',
});

/** A tool description cut to its first sentences, at most `max` characters. */
export function shortDescription(description, max = 300) {
  const d = String(description).replace(/\s+/g, ' ').trim();
  if (d.length <= max) return d;
  const cut = d.slice(0, max);
  const stop = cut.lastIndexOf('. ');
  return stop > 80 ? cut.slice(0, stop + 1) : `${cut}…`;
}

/** The first sentence of a tool description, for a one-line hint. */
export function firstSentence(description, max = 200) {
  const d = String(description).replace(/\s+/g, ' ').trim();
  const m = d.match(/^.*?[.!?](?=\s|$)/);
  const s = m ? m[0] : d;
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

/**
 * The skill_selection question over a tool catalogue `[{ name, description }]`.
 * `plain` leaves out ROUTE_DESCRIPTIONS (the bench's baseline).
 */
export function routeQuestion(tools, { plain = false } = {}) {
  return {
    type: 'choice',
    instructions: 'Which Bag of Holding tool should the AI Dungeon Master call first to handle this request at a D&D table?',
    criteria: Object.fromEntries(tools.map((t) => [t.name, (plain ? undefined : ROUTE_DESCRIPTIONS[t.name]) ?? shortDescription(t.description)])),
  };
}

/** The whole state that leaves the server for a routing judgment: the request text, clipped. */
export function routeState(text) {
  const t = String(text);
  return { request: t.length > ROUTE_TEXT_MAX_CHARS ? t.slice(0, ROUTE_TEXT_MAX_CHARS) : t };
}

/**
 * Ask JEFF which tools fit a request. Never throws. Resolves to
 * `{ candidates: [{ tool, probability, hint }], confidence }`, or
 * `{ candidates: [], reason }` when JEFF gave no usable answer.
 *
 * @param {ReturnType<typeof createJeffClient>} jeff
 * @param {{ question: object, hints: Map<string, string> }} catalogue  from routeCatalogue()
 * @param {string} text
 * @param {{ onDecision?: (id: string) => void }} [opts]  called with JEFF's
 *   decision id when candidates are returned (the outcome hook)
 */
export async function routeRequest(jeff, catalogue, text, opts = {}) {
  let res;
  try {
    res = await jeff.decide({
      feature: 'tool_route',
      family: 'skill_selection',
      state: routeState(text),
      questions: { tool: catalogue.question },
    });
  } catch { res = null; }
  if (!res) return { candidates: [], reason: 'JEFF did not answer (unreachable, timed out or returned an invalid response). Choose the tool yourself.' };
  const a = res.answers?.tool;
  const probs = a && a.type === 'choice' && a.probabilities && typeof a.probabilities === 'object' ? a.probabilities : null;
  if (!probs) return { candidates: [], reason: 'JEFF returned no tool choice. Choose the tool yourself.' };
  const ranked = Object.entries(probs)
    .filter(([name, p]) => catalogue.hints.has(name) && typeof p === 'number' && Number.isFinite(p) && p >= 0.0005)
    .sort((x, y) => y[1] - x[1])
    .slice(0, ROUTE_TOP_N);
  if (ranked.length === 0) return { candidates: [], reason: 'JEFF named no known tool. Choose the tool yourself.' };
  const candidates = ranked.map(([tool, p]) => ({ tool, probability: Math.round(p * 1000) / 1000, hint: catalogue.hints.get(tool) }));
  const confidence = typeof a.confidence === 'number' && Number.isFinite(a.confidence) ? a.confidence : null;
  try { jeff.log({ feature: 'tool_route', top: candidates[0].tool, probability: candidates[0].probability, confidence }); } catch { /* never breaks a call */ }
  const id = decisionId(res);
  if (id && opts.onDecision) { try { opts.onDecision(id); } catch { /* never breaks a call */ } }
  return { candidates, confidence };
}

/** Build the question and hint table once from the live tool list. */
export function routeCatalogue(tools) {
  const list = tools.map((t) => ({ name: t.name, description: t.description }));
  return {
    question: routeQuestion(list),
    hints: new Map(list.map((t) => [t.name, firstSentence(t.description)])),
  };
}
