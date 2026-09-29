#!/usr/bin/env node
// Measure JEFF as a tool router for this server: every utterance in
// scripts/jeff-route-fixture.json is asked as ONE skill_selection choice over
// the full tool catalogue (routeQuestion in src/jeff.js), and the answer is scored
// against the fixture's accepted tools.
//
//   BOH_JEFF_URL=https://jeff.example BOH_JEFF_KEY=… node scripts/jeff-route-bench.js [--fixture f.json] [--plain] [--out file.json]
//
// --plain uses only the tools' own MCP descriptions (the first measurement);
// the default adds ROUTE_DESCRIPTIONS (src/jeff.js) for four tools, which is
// exactly the catalogue the shipped route_request tool sends.
//
// Fixtures: jeff-route-fixture.json (40 requests in tool vocabulary),
// jeff-route-checks-fixture.json (8 "I try to …" player actions) and
// jeff-route-heldout-fixture.json (12 requests written before the routing
// descriptions). Results: docs/jeff-decisions.md.
//
// Prints top-1 / top-3 accuracy, p50/p90 latency and the upstream cost JEFF
// reported. Not part of the published package (scripts/ is not in `files`).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createServer } from '../src/server.js';
import { routeQuestion } from '../src/jeff.js';

const url = (process.env.BOH_JEFF_URL ?? '').replace(/\/+$/, '');
const key = process.env.BOH_JEFF_KEY ?? '';
if (!url || !key) { console.error('set BOH_JEFF_URL and BOH_JEFF_KEY'); process.exit(2); }
const plainRun = process.argv.includes('--plain');
const outIdx = process.argv.indexOf('--out');
const outFile = outIdx > 0 ? process.argv[outIdx + 1] : null;

const fxIdx = process.argv.indexOf('--fixture');
const fixturePath = fxIdx > 0 ? process.argv[fxIdx + 1] : new URL('./jeff-route-fixture.json', import.meta.url);
const fixture = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'boh-route-'));
const { tools } = createServer({ memory: { dataDir }, jeff: null });
// The catalogue route_request routes over: every tool of a JEFF-less server.
const question = routeQuestion(tools.map((t) => ({ name: t.name, description: t.description })), { plain: plainRun });

const rows = [];
for (const c of fixture.cases) {
  const t0 = Date.now();
  let res, json;
  try {
    res = await fetch(`${url}/v1/systemone`, {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'jeff/auto', state: { request: c.u }, questions: { tool: question }, jeff: { decision_family: 'skill_selection' } }),
    });
    json = await res.json();
  } catch (err) { json = { error: String(err) }; }
  const ms = Date.now() - t0;
  const a = json?.answers?.tool;
  const ranked = a ? Object.entries(a.probabilities).sort((x, y) => y[1] - x[1]).map(([k]) => k) : [];
  const top1 = ranked[0] ?? null;
  const hit1 = c.expect.includes(top1);
  const hit3 = ranked.slice(0, 3).some((k) => c.expect.includes(k));
  const meta = json?.jeff?.answers?.tool ?? {};
  rows.push({ u: c.u, expect: c.expect, top3: ranked.slice(0, 3), p1: a ? a.probabilities[top1] : null,
    // Best probability JEFF gave any accepted tool; 0 means preselection dropped it.
    pExpected: a ? Math.max(...c.expect.map((k) => a.probabilities[k] ?? 0)) : null,
    confidence: a?.confidence ?? null, hit1, hit3, ms, status: res?.status ?? null,
    cost: json?.usage?.cost ?? 0, strategy: meta.strategy, preselected: meta.preselected ?? null, error: json?.error ?? meta.error ?? null });
  process.stderr.write(`${hit1 ? '1' : hit3 ? '3' : 'x'} ${ms}ms ${top1} <- ${c.u}\n`);
}

const q = (xs, p) => { const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };
const n = rows.length;
const summary = {
  cases: n,
  top1: rows.filter((r) => r.hit1).length / n,
  top3: rows.filter((r) => r.hit3).length / n,
  answered: rows.filter((r) => r.top3.length > 0).length,
  p50_ms: q(rows.map((r) => r.ms), 0.5),
  p90_ms: q(rows.map((r) => r.ms), 0.9),
  cost_usd: Number(rows.reduce((s, r) => s + (r.cost || 0), 0).toFixed(6)),
  options: Object.keys(question.criteria).length,
};
console.log(JSON.stringify(summary, null, 2));
if (outFile) fs.writeFileSync(outFile, JSON.stringify({ summary, rows }, null, 2));
fs.rmSync(dataDir, { recursive: true, force: true });
