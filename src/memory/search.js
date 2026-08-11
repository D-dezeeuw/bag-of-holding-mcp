// Campaign-memory retrieval — lexical, deterministic, zero-dep.
//
// Why BM25 and not embeddings: a vector index needs an embedding
// model, and an embedding model means an API key, network calls and
// provider drift inside the one layer of the stack that is currently
// key-free, offline and replayable. Campaign memory is also an easy
// retrieval problem — the things a DM asks for (NPC names, places,
// quest nouns) are distinctive tokens, which is lexical search's
// best case. The contract of `rankRecords` (records + query in,
// scored indices out) is the seam where a semantic backend can be
// swapped in later without touching any tool surface.

// Small english stopword set. Deliberately short: campaign text is
// terse, and over-aggressive stopping would eat words like "will"
// (a name) — we only strip the unambiguous glue.
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at',
  'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its', 'this',
  'that', 'with', 'for', 'as', 'by', 'from', 'has', 'have', 'had',
  'he', 'she', 'they', 'them', 'his', 'her', 'their', 'you', 'your',
  'we', 'us', 'our', 'not', 'no', 'so', 'if', 'then', 'than', 'into'
]);

/**
 * Lowercase a string and split it into search tokens. Single
 * characters and stopwords are dropped; digits survive ("d20",
 * "13th" carry meaning in this domain).
 */
export function tokenize(text) {
  return String(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

// BM25 constants — the textbook defaults. Not exposed as options:
// nobody tunes k1/b per campaign, and a fixed pair keeps rankings
// reproducible across releases.
const K1 = 1.2;
const B = 0.75;

/**
 * Rank `records` against `query`. Returns `[{ index, score }]`
 * sorted best-first; records that match nothing are omitted, so an
 * empty array honestly means "your memory has nothing on this".
 *
 * Scoring = BM25 over the record text (entities and tags counted
 * twice — a hit on a *name* should outrank a hit in prose) plus two
 * small deterministic nudges:
 *   + 0.15 × importance (1–5, default 3) — the DM said it matters;
 *   + 0.30 × log-position recency — newer records win ties, because
 *     in play the latest state of an NPC beats their introduction.
 * Both nudges are an order of magnitude below a solid BM25 match, so
 * they reorder near-ties rather than overrule relevance.
 */
export function rankRecords(records, query) {
  const qTokens = [...new Set(tokenize(query))];
  const n = records.length;
  if (qTokens.length === 0 || n === 0) return [];

  const docs = records.map((r) => {
    const boosted = [...(r.entities ?? []), ...(r.tags ?? [])]
      .flatMap((field) => {
        const toks = tokenize(field);
        return [...toks, ...toks];
      });
    return [...tokenize(r.text), ...boosted];
  });

  const avgLen = docs.reduce((sum, d) => sum + d.length, 0) / n;
  const df = new Map();
  for (const doc of docs) {
    for (const tok of new Set(doc)) df.set(tok, (df.get(tok) ?? 0) + 1);
  }

  const ranked = [];
  for (let i = 0; i < n; i++) {
    const doc = docs[i];
    const tf = new Map();
    for (const tok of doc) tf.set(tok, (tf.get(tok) ?? 0) + 1);

    let score = 0;
    for (const q of qTokens) {
      const f = tf.get(q);
      if (!f) continue;
      const d = df.get(q);
      const idf = Math.log(1 + (n - d + 0.5) / (d + 0.5));
      score += idf * ((f * (K1 + 1)) / (f + K1 * (1 - B + B * (doc.length / avgLen))));
    }
    if (score > 0) {
      const importance = records[i].importance ?? 3;
      const recency = n > 1 ? i / (n - 1) : 1;
      ranked.push({ index: i, score: score + 0.15 * importance + 0.3 * recency });
    }
  }

  // Ties (same score) break toward the newer record — same
  // rationale as the recency nudge, applied at the comparator too
  // so ordering is total and stable.
  ranked.sort((a, b) => b.score - a.score || b.index - a.index);
  return ranked;
}
