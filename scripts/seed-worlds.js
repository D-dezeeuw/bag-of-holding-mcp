#!/usr/bin/env node
// scripts/seed-worlds.js — put cartridges on the shelf, once.
//
//   BOH_SEED_WORLDS=1234,777 BOH_WORLDS_DIR=/worlds node scripts/seed-worlds.js
//   node scripts/seed-worlds.js --seeds 1234,777 --out /worlds
//
// Runs as a one-shot before the server starts (compose:
// `depends_on: worlds-seed: { condition: service_completed_successfully }`),
// because `createWorlds` reads the directory ONCE at process start — a
// cartridge that lands later is invisible until the server restarts.
//
// WHY THIS IS NOT BAKED INTO THE IMAGE. A keyless bake is deterministic:
// seed 1234 produces the same bytes and the same digest every time. But
// deterministic-per-version is not the same as stable — change the
// generator and the same seed mints a different world, while campaigns
// carry that digest in their pin and their ledger folds over that exact
// content. Baking at image build would quietly re-mint the shelf on the
// next unrelated deploy and strand every pinned campaign. So: bake once
// into a volume, keep the artifact, and never overwrite it. Same rule the
// client's own bake-world.js enforces, and the same rule as an npm
// version — published is immutable.
//
// Skipping is therefore the NORMAL outcome. Every deploy re-runs this and
// every deploy after the first should report "already on the shelf".

import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join } from 'node:path';
import { bakeCartridge, catalogEntry } from '@zeeuw/bag-of-holding-client';

const args = process.argv.slice(2);
const argOf = (flag, fallback = null) => {
  const i = args.indexOf(flag);
  return i >= 0 && args[i + 1] != null ? args[i + 1] : fallback;
};

const outDir = argOf('--out', process.env.BOH_WORLDS_DIR ?? null);
if (!outDir) {
  console.error('seed-worlds: no worlds directory — set BOH_WORLDS_DIR or pass --out <dir>');
  process.exit(2);
}

// An empty list is a valid deployment, not a mistake: a server with no
// shelf answers world_catalog cleanly, and an operator who bakes their
// own worlds elsewhere wants exactly this. Exit 0 so compose's
// service_completed_successfully gate opens.
const seeds = (argOf('--seeds', process.env.BOH_SEED_WORLDS ?? ''))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
  .map(Number);

if (!seeds.length) {
  console.log('seed-worlds: no seeds configured (BOH_SEED_WORLDS empty) — leaving the shelf as it is');
  process.exit(0);
}
const bad = seeds.filter((s) => !Number.isFinite(s));
if (bad.length) {
  console.error(`seed-worlds: BOH_SEED_WORLDS must be comma-separated numbers; could not read ${bad.length} of them`);
  process.exit(2);
}

await mkdir(outDir, { recursive: true });

const exists = async (f) => { try { await access(f); return true; } catch { return false; } };

let baked = 0;
let kept = 0;
for (const seed of seeds) {
  const id = `world-${seed}`;
  const file = join(outDir, `${id}.json`);
  if (await exists(file)) {
    console.log(`  ${id} already on the shelf — left alone`);
    kept += 1;
    continue;
  }
  // No `complete` callback: the bake stays procedural, which is what
  // makes it deterministic and offline. Hydrating outlines against a
  // model is an operator act with a key, run once, not something a
  // container start should reach the internet to do.
  const cartridge = await bakeCartridge(seed);
  await writeFile(file, JSON.stringify(cartridge));
  const entry = catalogEntry(cartridge, { id });
  console.log(`  baked ${id} — digest ${entry.digest} | ${entry.continents} continents, ${entry.provinces} provinces, ${entry.legends} legends`);
  baked += 1;
}

// Rebuild the catalog sidecar from what is actually on the shelf. The MCP
// registry re-derives its own list from the files and never reads this,
// but the client's baker maintains it and an operator listing the volume
// should not find it stale.
const catalogFile = join(outDir, 'catalog.json');
let catalog = [];
try { catalog = JSON.parse(await readFile(catalogFile, 'utf8')); } catch { /* fresh catalog */ }
for (const seed of seeds) {
  const id = `world-${seed}`;
  const file = join(outDir, `${id}.json`);
  if (!(await exists(file))) continue;
  const cartridge = JSON.parse(await readFile(file, 'utf8'));
  catalog = catalog.filter((e) => e.id !== id);
  catalog.push(catalogEntry(cartridge, { id }));
}
catalog.sort((a, b) => a.id.localeCompare(b.id));
await writeFile(catalogFile, JSON.stringify(catalog, null, 2));

console.log(`seed-worlds: ${baked} baked, ${kept} already present — ${catalog.length} on the shelf at ${outDir}`);
