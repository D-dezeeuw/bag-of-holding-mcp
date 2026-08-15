// World registry — pre-generated cartridges served over MCP (doc 18 §11/§E).
//
// A cartridge is an immutable baked genesis (see the client's
// src/worldgen/cartridge.js); this registry loads a directory of them and
// answers reads over their bases. That is ALL it does now: it holds no
// play state. Playthroughs — which campaign is on which world, its patch
// ledger, its observations — live in the memory store's token namespace
// (src/playthroughs.js), because play state that lives in a process Map is
// play state that dies with the process, and over the stateless HTTP
// transport "the process" is one request.
//
// Both shapes of a world are kept per id:
//   envelope — the parsed { v, data, c } artifact, pristine. catalogEntry
//              and cellsOf work on this; a future revision resolver applies
//              deltas to data and re-digests it.
//   mounted  — mountCartridge's flattened view (data spread + digest/v),
//              what the node/lineage reads serve.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  mountCartridge, catalogEntry, cellsOf, ancestorsOf,
  mountRevision, applyRevisions, resolvedDigest,
} from '@zeeuw/bag-of-holding-client';

/**
 * Load every world-*.json in `dir` and return the read-only registry the
 * world tools close over. A missing or empty dir is not an error — the tools
 * answer with an explanation instead, so a server started without worlds
 * still lists cleanly.
 */
export function createWorlds({ dir = process.env.BOH_WORLDS_DIR ?? null } = {}) {
  const worlds = new Map();     // id → { envelope, mounted }
  const revisionFiles = new Map(); // worldId → Map(revision → filename)
  const errors = [];
  if (dir) {
    let files = [];
    // `[^.]` rather than `.`: revision sidecars (world-1234.r2.json) and any
    // other dotted name must never be mistaken for a base cartridge — one
    // bad mount would take the whole catalog down at list() time.
    try { files = readdirSync(dir).filter(f => /^world-[^.]+\.json$/.test(f)); }
    catch (err) { errors.push(`worlds dir '${dir}': ${err.message}`); }
    for (const f of files) {
      const id = f.replace(/\.json$/, '');
      try {
        const raw = readFileSync(join(dir, f), 'utf8');
        const mounted = mountCartridge(raw, {
          onError: (code, detail) => errors.push(`${f}: ${code} ${detail ?? ''}`.trim()),
        });
        if (mounted) worlds.set(id, { envelope: JSON.parse(raw), mounted });
      } catch (err) { errors.push(`${f}: ${err.message}`); }
    }
    // Revisions live in their own subdirectory, never beside the bases.
    // Filenames index them (`world-1234.r2.json` → revision 2 of world-1234);
    // the artifacts themselves are mounted lazily, on first resolve.
    let revFiles = [];
    try { revFiles = readdirSync(join(dir, 'revisions')).filter(f => /^world-[^.]+\.r[1-9]\d*\.json$/.test(f)); }
    catch { /* no revisions directory is the common case, not an error */ }
    for (const f of revFiles) {
      const m = f.match(/^(world-[^.]+)\.r([1-9]\d*)\.json$/);
      if (!worlds.has(m[1])) { errors.push(`revisions/${f}: no base cartridge ${m[1]}.json on the shelf`); continue; }
      if (!revisionFiles.has(m[1])) revisionFiles.set(m[1], new Map());
      revisionFiles.get(m[1]).set(Number(m[2]), f);
    }
  }

  const get = (id) => worlds.get(id)?.mounted ?? null;

  // The contiguous revision ladder for one world: [0, 1, …] up to the first
  // gap. A missing rung strands everything above it (r3 without r2 was
  // authored against content this shelf cannot reconstruct) — record the
  // truncation once, at load-shape time, so the catalog tells the truth.
  const revisionsOf = (worldId) => {
    if (!worlds.has(worldId)) return null;
    const have = revisionFiles.get(worldId);
    const ladder = [0];
    for (let r = 1; have?.has(r); r++) ladder.push(r);
    if (have && have.size > ladder.length - 1) {
      const stranded = [...have.keys()].filter(r => !ladder.includes(r)).sort((a, b) => a - b);
      errors.push(`${worldId}: revisions ${stranded.join(', ')} are stranded above a gap (highest servable: ${ladder.at(-1)})`);
      for (const r of stranded) have.delete(r);   // report once, then forget
    }
    return ladder;
  };

  // resolve(worldId, revision) — the world's data AT a revision, lazily
  // computed and cached forever (both inputs are immutable artifacts, so the
  // cache can never go stale). null revision = latest servable. A revision
  // whose chain refuses (base-digest mismatch) resolves to null and records
  // why; the ladder above it is truncated so `latest` stays honest.
  const resolved = new Map();   // `${worldId}@${revision}` → { revision, data, digest }
  const resolve = (worldId, revision = null) => {
    const w = worlds.get(worldId);
    if (!w) return null;
    const ladder = revisionsOf(worldId);
    const target = revision ?? ladder.at(-1);
    if (!ladder.includes(target)) return null;
    const key = `${worldId}@${target}`;
    if (resolved.has(key)) return resolved.get(key);

    let out = null;
    if (target === 0) {
      out = { revision: 0, data: w.envelope.data, digest: w.envelope.c };
    } else {
      const chain = [];
      for (let r = 1; r <= target; r++) {
        const f = revisionFiles.get(worldId)?.get(r);
        const mounted = f ? mountRevision(readFileSync(join(dir, 'revisions', f), 'utf8'), {
          onError: (code, detail) => errors.push(`revisions/${f}: ${code} ${detail ?? ''}`.trim()),
        }) : null;
        if (!mounted) break;
        chain.push(mounted);
      }
      const applied = applyRevisions(w.envelope.data, chain, {
        onError: (code, detail) => errors.push(`${worldId}: ${code} ${detail ?? ''}`.trim()),
      });
      if (applied.applied.length === target) {
        out = { revision: target, data: applied.data, digest: resolvedDigest(applied.data) };
      } else {
        // The chain refused below the target: truncate the ladder there so
        // latest() never points at a revision this shelf cannot serve.
        const servable = applied.applied.at(-1) ?? 0;
        const have = revisionFiles.get(worldId);
        for (const r of [...(have?.keys() ?? [])]) if (r > servable) have.delete(r);
      }
    }
    resolved.set(key, out);
    return out;
  };

  return {
    dir, errors,

    // One catalog row shape for the whole ecosystem: the client's
    // catalogEntry is the source of truth (this used to be a hand-rolled
    // near-copy, and the two had already drifted apart — the copy had lost
    // `name`). Only `id` is layered on top, because here the id is the
    // filename stem, not the seed.
    list: () => [...worlds.entries()].map(([id, w]) => {
      const ladder = revisionsOf(id);
      return { ...catalogEntry(w.envelope, { id }), revisions: ladder, latest: ladder.at(-1) };
    }),
    // UNCHANGED semantics: get() means revision 0, forever. Making it mean
    // "latest" would move every existing reader onto new content — exactly
    // the bug pinning exists to prevent. Latest is selected explicitly, at
    // the browse/begin boundary only.
    get,
    revisionsOf,
    resolve,
    latest: (worldId) => revisionsOf(worldId)?.at(-1) ?? null,

    /**
     * The fold base for one entity of one world — what the cartridge says
     * about it AT a revision, as cells. Replay folds a campaign's ledger
     * over this, so cartridge entities replay over their real content and
     * invented entities (an NPC the table met) fold from nothing. Null for
     * an unknown world or unservable revision; {} for an unknown entity
     * (that IS the fold base for something the world has never heard of).
     */
    cell(worldId, entityId, revision = 0) {
      const r = resolve(worldId, revision);
      return r ? cellsOf(r.data, entityId) : null;
    },

    /**
     * The power layer in one read: who holds what, who fights whom, and the
     * faces. Everything the depth phases mint at genesis — factions with
     * territory and relations, the war state (null = honest peace), and the
     * world npcs whose seatOf/leads ids tie them to crowns and factions.
     */
    powers(worldId) {
      const world = get(worldId);
      if (!world) return null;
      return {
        factions: world.factions ?? [],
        warState: world.warState ?? null,
        npcs: world.npcs ?? [],
      };
    },

    node(worldId, nodeId) {
      const world = get(worldId);
      const node = world?.geo.nodes[nodeId];
      if (!node) return null;
      // The powers as felt HERE: a faction whose territory covers this node
      // (or an ancestor), a war whose front runs through it, and — when the
      // node's crown has a sovereign — the face seated on that throne.
      const inTerritory = (ids) => (ids ?? []).some(p => nodeId === p || nodeId.startsWith(`${p}.`));
      const factions = (world.factions ?? []).filter(f => inTerritory(f.territory));
      const wars = (world.warState?.wars ?? []).filter(w => inTerritory(w.front));
      const crown = world.lore.crowns.find(c => c.id === `${nodeId}.crown`) ?? null;
      const face = crown
        ? (world.npcs ?? []).find(n => n.seatOf === crown.id) ?? null
        : null;
      return {
        node,
        outline: world.outlines?.[nodeId] ?? null,
        slice: world.slices?.[nodeId] ?? null,
        crown,
        face,
        factions,
        wars,
        legends: world.lore.legends.filter(l => (l.sites ?? []).some(s =>
          s === nodeId || nodeId.startsWith(`${s}.`))),
      };
    },

    lineage(worldId, nodeId) {
      const world = get(worldId);
      if (!world || !world.geo.nodes[nodeId]) return null;
      return [...ancestorsOf(world.geo, nodeId)].reverse().map(a => ({
        id: a.id, kind: a.kind, name: a.name,
        digest: a.digest ?? world.outlines?.[a.id]?.digest ?? a.hook ?? null,
        detail: a.detail ?? 0,
      }));
    },
  };
}
