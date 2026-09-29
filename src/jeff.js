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
//
// No dependency: the platform fetch, like the embeddings and Qdrant clients.

export const DEFAULT_JEFF_TIMEOUT_MS = 4000;
export const JEFF_MODES = Object.freeze(['shadow', 'on']);

/** Longest memory text sent for an importance judgment. Records are 1-3 sentences by protocol. */
export const MEMORY_TEXT_MAX_CHARS = 1000;

/** A score answer less concentrated than this is treated as "no opinion" (JEFF D-070's default floor). */
export const MIN_CONFIDENCE = 0.2;

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

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
  return {
    url: rawUrl.replace(/\/+$/, ''),
    key,
    mode,
    timeoutMs: Number.isFinite(timeout) && timeout > 0 ? timeout : DEFAULT_JEFF_TIMEOUT_MS,
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
 * @param {{ fetchImpl?: typeof fetch, log?: (entry: object) => void }} [opts]
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
  const res = await jeff.decide({
    feature: 'memory_importance',
    family: 'boh_memory_importance',
    state: importanceState(type, text),
    questions: { importance: IMPORTANCE_QUESTION },
  });
  const s = readScore(res, 'importance');
  if (!s) return null;
  if (s.confidence !== null && s.confidence < MIN_CONFIDENCE) return null;
  const importance = Math.min(5, Math.max(1, Math.round(s.score) + 1));
  return { importance, score: s.score, confidence: s.confidence };
}
