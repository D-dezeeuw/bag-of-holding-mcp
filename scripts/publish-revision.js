#!/usr/bin/env node
// scripts/publish-revision.js — put a revision on the shelf, carefully.
//
//   node scripts/publish-revision.js --worlds <dir> --file <revision.json> \
//        [--data-dir <dir>] [--force]
//
// Publishing is a SCRIPT, not a tool, on purpose: the advisory scan below
// reads every tenant's observation file, which is exactly the boundary the
// token-namespace design exists to stop a request handler from crossing. No
// model-reachable tool may enumerate namespaces; an operator at a shell may.
//
// The gate is advisory; the pin is authoritative. A campaign pinned below
// this revision never sees it, so an edit that slips past the scan cannot
// retroactively change anyone's game — only campaigns that explicitly
// world_upgrade are at risk, and world_upgrade re-runs the identical check
// for that one campaign with no TOCTOU window. So a conflict here is a
// warning to the publisher (split the revision into an additive half and an
// editing half), not a correctness mechanism. --force publishes anyway.
//
// What is NEVER negotiable, --force or not: an existing revision file is not
// overwritten. A published revision is immutable, same rule as the bases.

import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { mountRevision, classifyRevision, revisionConflicts } from '@zeeuw/bag-of-holding-client';
import { createWorlds } from '../src/worlds.js';

function parseArgs(argv) {
  const args = { force: false };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--worlds') args.worlds = argv[++i];
    else if (argv[i] === '--file') args.file = argv[++i];
    else if (argv[i] === '--data-dir') args.dataDir = argv[++i];
    else if (argv[i] === '--force') args.force = true;
    else { console.error(`unknown argument: ${argv[i]}`); process.exit(2); }
  }
  return args;
}

export function publishRevision({ worlds: worldsDir, file, dataDir = null, force = false, log = console.log }) {
  if (!worldsDir || !file) throw new Error('usage: publish-revision.js --worlds <dir> --file <revision.json> [--data-dir <dir>] [--force]');

  const raw = readFileSync(file, 'utf8');
  const errors = [];
  const rev = mountRevision(raw, { onError: (code, detail) => errors.push(`${code} ${detail ?? ''}`.trim()) });
  if (!rev) throw new Error(`refusing: ${file} is not a valid revision artifact (${errors.join('; ') || 'unmountable'})`);

  const registry = createWorlds({ dir: worldsDir });
  const ladder = registry.revisionsOf(rev.worldId);
  if (!ladder) throw new Error(`refusing: no base cartridge ${rev.worldId}.json in ${worldsDir}`);

  // First rule, checked first, immune to --force: a published revision is
  // immutable, like the bases. Re-publishing a rung gets THIS refusal, not a
  // confusing numbering complaint.
  const dest = join(worldsDir, 'revisions', `${rev.worldId}.r${rev.revision}.json`);
  if (existsSync(dest)) {
    throw new Error(`refusing: ${dest} already exists — published revisions are immutable, bump the revision number instead`);
  }

  const next = ladder.at(-1) + 1;
  if (rev.revision !== next) {
    throw new Error(`refusing: the shelf's next rung for ${rev.worldId} is r${next}, this artifact says r${rev.revision}`);
  }
  const below = registry.resolve(rev.worldId, rev.revision - 1);
  if (!below || rev.base.digest !== below.digest) {
    throw new Error(`refusing: authored against base digest ${rev.base.digest}, but revision ${rev.revision - 1} on this shelf resolves to ${below?.digest ?? 'nothing'}`);
  }

  // Advisory scan: which campaigns, across every tenant on this data dir,
  // have OBSERVED content this revision edits. Additive patches are never a
  // conflict. Skippable (no --data-dir) — you lose a warning, never a
  // guarantee, because world_upgrade re-checks per campaign anyway.
  const warnings = [];
  if (dataDir && existsSync(dataDir)) {
    const { edits } = classifyRevision(below.data, rev.ledger);
    for (const ns of readdirSync(dataDir, { withFileTypes: true }).filter(d => d.isDirectory())) {
      const nsDir = join(dataDir, ns.name);
      for (const camp of readdirSync(nsDir, { withFileTypes: true }).filter(d => d.isDirectory())) {
        const campDir = join(nsDir, camp.name);
        try {
          const pinFile = join(campDir, 'world.json');
          if (!existsSync(pinFile)) continue;
          const pin = JSON.parse(readFileSync(pinFile, 'utf8'));
          if (pin.worldId !== rev.worldId) continue;
          const obsFile = join(campDir, 'world-observed.json');
          const observedRaw = existsSync(obsFile) ? JSON.parse(readFileSync(obsFile, 'utf8')) : {};
          const observations = Object.fromEntries(Object.entries(observedRaw).map(([id, o]) => [id, o.paths]));
          for (const c of revisionConflicts(edits, observations)) {
            warnings.push(`${ns.name}/${camp.name}: edit to ${c.target} ${c.path} collides with observed ${c.blockedBy}`);
          }
        } catch { /* an unreadable campaign is not this script's problem */ }
      }
    }
  }

  if (warnings.length) {
    for (const w of warnings) log(`WARN ${w}`);
    if (!force) {
      throw new Error(`refusing: ${warnings.length} campaign(s) have observed content this revision edits. Split the revision (additive half publishes clean), or re-run with --force — pinned campaigns are unaffected either way; only explicit world_upgrade calls will see these conflicts re-checked.`);
    }
    log(`--force: publishing over ${warnings.length} advisory warning(s); pins stay authoritative.`);
  }

  mkdirSync(join(worldsDir, 'revisions'), { recursive: true });
  writeFileSync(dest, raw, 'utf8');
  log(`published ${rev.worldId} r${rev.revision} → ${dest}`);
  return { dest, worldId: rev.worldId, revision: rev.revision, warnings };
}

const invokedDirectly = process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop());
if (invokedDirectly) {
  try {
    publishRevision(parseArgs(process.argv.slice(2)));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
