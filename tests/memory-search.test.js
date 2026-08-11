import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tokenize, rankRecords, fuseRankings } from '../src/memory/search.js';

test('tokenize lowercases, strips stopwords and single chars, keeps digit-bearing tokens', () => {
  assert.deepEqual(
    tokenize('The Orc AND a d20 at I... x! Wickmere'),
    ['orc', 'd20', 'wickmere']
  );
});

test('rankRecords returns [] for empty corpora and for queries made only of stopwords', () => {
  assert.deepEqual(rankRecords([], 'maela'), []);
  assert.deepEqual(rankRecords([{ text: 'a fine day' }], 'the and of'), []);
});

test('rankRecords omits non-matching records — empty hits mean the log truly has nothing', () => {
  const records = [
    { text: 'Maela lit three lanterns in the Lamp Row' },
    { text: 'the party bought eels at the Wet Market' }
  ];
  const ranked = rankRecords(records, 'maela lanterns');
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].index, 0);
});

test('entity hits outrank prose hits (entities are double-weighted)', () => {
  const records = [
    { text: 'someone in the market mentioned maela in passing' },
    { text: 'a stranger asked for the lamp keeper', entities: ['Maela'], tags: ['lamp-row'] }
  ];
  const ranked = rankRecords(records, 'maela');
  assert.equal(ranked[0].index, 1);
  // Tags feed the index too.
  assert.equal(rankRecords(records, 'lamp row')[0].index, 1);
});

test('importance outweighs the recency nudge when the DM said it matters', () => {
  const records = [
    { text: 'the margravine forged the charter seal', importance: 5 },
    { text: 'the margravine served pickled eel and charter talk', importance: 1 }
  ];
  // Identical bm25 pull on "margravine charter"? Not exactly — but
  // importance (+0.60 spread) must beat recency (+0.30 spread) when
  // text relevance is comparable.
  const ranked = rankRecords(records, 'margravine charter');
  assert.equal(ranked[0].index, 0);
});

test('exact score ties break toward the newer record', () => {
  // Same text → same bm25. importance 5 at index 0 (+0.75) equals
  // importance 3 at index 1 (+0.45 + 0.30 recency) — a true tie,
  // resolved by the comparator's index-desc fallback.
  const records = [
    { text: 'gold ring found', importance: 5 },
    { text: 'gold ring found', importance: 3 }
  ];
  const ranked = rankRecords(records, 'gold ring');
  assert.equal(ranked[0].score, ranked[1].score);
  assert.deepEqual(ranked.map((r) => r.index), [1, 0]);
});

test('a single-record corpus ranks with full recency and default importance', () => {
  const ranked = rankRecords([{ text: 'the bell rang thirteen times' }], 'bell thirteen');
  assert.equal(ranked.length, 1);
  assert.ok(ranked[0].score > 0);
});

test('fuseRankings merges rankings scale-free: agreement wins, weights matter, absentees stay absent', () => {
  const fused = fuseRankings([
    { ids: ['a', 'b', 'c'], weight: 1 },   // lexical order
    { ids: ['b', 'a'], weight: 1 },        // semantic order — no c
    { ids: ['c', 'b', 'a'], weight: 0.5 }  // prior
  ]);
  // b: 1/62 + 1/61 + 0.5/62 ≈ 0.0364 — top ranks in both main lists.
  // a: 1/61 + 1/62 + 0.5/63 ≈ 0.0355; c: 1/63 + 0.5/61 ≈ 0.0241.
  const order = [...fused.entries()].sort((x, y) => y[1] - x[1]).map(([id]) => id);
  assert.deepEqual(order, ['b', 'a', 'c']);
  assert.equal(fused.has('d'), false);
  // The damping constant is overridable.
  const tight = fuseRankings([{ ids: ['a'], weight: 1 }], 0);
  assert.equal(tight.get('a'), 1);
});
