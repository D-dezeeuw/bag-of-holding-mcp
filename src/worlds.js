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
import { mountCartridge, catalogEntry, cellsOf, ancestorsOf } from '@zeeuw/bag-of-holding-client';

/**
 * Load every world-*.json in `dir` and return the read-only registry the
 * world tools close over. A missing or empty dir is not an error — the tools
 * answer with an explanation instead, so a server started without worlds
 * still lists cleanly.
 */
export function createWorlds({ dir = process.env.BOH_WORLDS_DIR ?? null } = {}) {
  const worlds = new Map();     // id → { envelope, mounted }
  const errors = [];
  if (dir) {
    let files = [];
    // `[^.]` rather than `.`: revision sidecars (a future world-1234.r2.json)
    // and any other dotted name must never be mistaken for a base cartridge —
    // one bad mount would take the whole catalog down at list() time.
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
  }

  const get = (id) => worlds.get(id)?.mounted ?? null;

  return {
    dir, errors,

    // One catalog row shape for the whole ecosystem: the client's
    // catalogEntry is the source of truth (this used to be a hand-rolled
    // near-copy, and the two had already drifted apart — the copy had lost
    // `name`). Only `id` is layered on top, because here the id is the
    // filename stem, not the seed.
    list: () => [...worlds.entries()].map(([id, w]) => catalogEntry(w.envelope, { id })),
    get,

    /**
     * The fold base for one entity of one world — what the cartridge says
     * about it, as cells. Replay folds a campaign's ledger over this, so
     * cartridge entities replay over their real content and invented
     * entities (an NPC the table met) fold from nothing. Null for an
     * unknown world; {} for an unknown entity (that IS the fold base for
     * something the cartridge has never heard of).
     */
    cell(worldId, entityId) {
      const w = worlds.get(worldId);
      return w ? cellsOf(w.envelope.data, entityId) : null;
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
