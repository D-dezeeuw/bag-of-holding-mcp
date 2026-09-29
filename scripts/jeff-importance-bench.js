#!/usr/bin/env node
// Measure JEFF's memory-importance judgment (src/jeff.js#judgeImportance) on
// scripts/jeff-importance-fixture.json against the default of 3.
//
//   BOH_JEFF_URL=https://jeff.example BOH_JEFF_KEY=… node scripts/jeff-importance-bench.js
import fs from 'node:fs';
import { resolveJeffConfig, createJeffClient, judgeImportance } from '../src/jeff.js';

const config = resolveJeffConfig({ ...process.env, BOH_JEFF_TIMEOUT_MS: '15000' });
if (!config) { console.error('set BOH_JEFF_URL and BOH_JEFF_KEY'); process.exit(2); }
const jeff = createJeffClient(config, { log: (e) => process.stderr.write(`${JSON.stringify(e)}\n`) });
const { cases } = JSON.parse(fs.readFileSync(new URL('./jeff-importance-fixture.json', import.meta.url), 'utf8'));

const rows = [];
for (const c of cases) {
  const t0 = Date.now();
  const j = await judgeImportance(jeff, c.type, c.text);
  rows.push({ expect: c.expect, got: j?.importance ?? null, score: j?.score ?? null, confidence: j?.confidence ?? null, ms: Date.now() - t0 });
  process.stderr.write(`${c.expect} -> ${j?.importance ?? '-'} (${j?.score ?? ''}) ${c.text.slice(0, 60)}\n`);
}
const n = rows.length;
const answered = rows.filter((r) => r.got !== null);
const mae = (xs, f) => xs.reduce((s, r) => s + Math.abs(f(r) - r.expect), 0) / xs.length;
const ms = rows.map((r) => r.ms).sort((a, b) => a - b);
console.log(JSON.stringify({
  cases: n, answered: answered.length,
  jeff_exact: answered.filter((r) => r.got === r.expect).length / n,
  jeff_within1: answered.filter((r) => Math.abs(r.got - r.expect) <= 1).length / n,
  jeff_mae: Number(mae(answered, (r) => r.got).toFixed(2)),
  default3_exact: rows.filter((r) => r.expect === 3).length / n,
  default3_within1: rows.filter((r) => Math.abs(3 - r.expect) <= 1).length / n,
  default3_mae: Number(mae(rows, () => 3).toFixed(2)),
  p50_ms: ms[Math.floor(n / 2)],
}, null, 2));
