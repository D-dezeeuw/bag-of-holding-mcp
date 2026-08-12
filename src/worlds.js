// World registry — pre-generated cartridges served over MCP (doc 18 §11/§E).
//
// A cartridge is an immutable baked genesis (see the client's
// src/worldgen/cartridge.js); this registry loads a directory of them and
// runs sessions over their bases. The split is the whole design: the
// cartridge is never written, a session is an ordered patch ledger on top,
// and playback is folding that ledger over the same base — the same story
// the engine's Replay tells for dice, one level up.
//
// State here is deliberately session-shaped, like sessions.js: the registry
// holds { worldId, ledger } per session id; character sheets and narrative
// memory stay in the host.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { mountCartridge, fold, ancestorsOf } from '@zeeuw/bag-of-holding-client';

/**
 * Load every world-*.json in `dir` (lazily verified via mountCartridge) and
 * return the registry the world tools close over. A missing or empty dir is
 * not an error — the tools answer with an explanation instead, so a server
 * started without worlds still lists cleanly.
 */
export function createWorlds({ dir = process.env.BOH_WORLDS_DIR ?? null } = {}) {
  const worlds = new Map();     // id → mounted cartridge
  const errors = [];
  if (dir) {
    let files = [];
    try { files = readdirSync(dir).filter(f => /^world-.+\.json$/.test(f)); }
    catch (err) { errors.push(`worlds dir '${dir}': ${err.message}`); }
    for (const f of files) {
      const id = f.replace(/\.json$/, '');
      try {
        const mounted = mountCartridge(readFileSync(join(dir, f), 'utf8'), {
          onError: (code, detail) => errors.push(`${f}: ${code} ${detail ?? ''}`.trim()),
        });
        if (mounted) worlds.set(id, mounted);
      } catch (err) { errors.push(`${f}: ${err.message}`); }
    }
  }

  const sessions = new Map();   // session id → { worldId, ledger: [] }
  let nextSession = 1;

  const get = (id) => worlds.get(id) ?? null;

  return {
    dir, errors,
    list: () => [...worlds.entries()].map(([id, w]) => ({
      id, seed: w.seed, digest: w.digest, v: w.v,
      continents: w.continents.length, provinces: w.provinces.length,
      legends: w.lore.legends.length, outlined: Object.keys(w.outlines ?? {}).length,
      // The setting is what makes a multi-world catalog readable: tone and
      // threat alone cannot tell a host that one of these is a sealed shelter
      // and the next is a fantasy kingdom. null means the library's own
      // default tables — a cartridge baked before settings existed, or one
      // deliberately baked without.
      setting: w.settingId ?? null,
      tone: w.slices?.world?.tone ?? null, threat: w.slices?.world?.threatType ?? null,
    })),
    get,

    // Every session is the same immutable base plus its own empty ledger —
    // "a fresh version of that world" costs nothing and copies nothing.
    begin(worldId) {
      const world = get(worldId);
      if (!world) return null;
      const id = `ws-${nextSession++}`;
      sessions.set(id, { worldId, ledger: [] });
      // The conventional landing: the first port province (mine[0] is always
      // a port by skeleton construction), so hosts start where sea lanes are.
      const start = world.provinces.find(p => world.geo.nodes[p].port) ?? world.provinces[0] ?? null;
      // The setting rides along: a host that mounts a world it did not bake
      // needs to know which genre it just started before it writes a line of
      // prose about it.
      return { session: id, worldId, digest: world.digest, setting: world.settingId ?? null, start };
    },
    session: (id) => sessions.get(id) ?? null,

    node(worldId, nodeId) {
      const world = get(worldId);
      const node = world?.geo.nodes[nodeId];
      if (!node) return null;
      return {
        node,
        outline: world.outlines?.[nodeId] ?? null,
        slice: world.slices?.[nodeId] ?? null,
        crown: world.lore.crowns.find(c => c.id === `${nodeId}.crown`) ?? null,
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

    commit(sessionId, patches) {
      const s = sessions.get(sessionId);
      if (!s) return null;
      s.ledger.push(...patches);
      return { session: sessionId, ledgerLength: s.ledger.length };
    },

    // Playback: fold the ordered patch log over the immutable base. With
    // upToTurn set this replays history to any moment; the same log over the
    // same digest reproduces the same campaign, byte for byte.
    replay(sessionId, { upToTurn = null } = {}) {
      const s = sessions.get(sessionId);
      const world = s ? get(s.worldId) : null;
      if (!world) return null;
      const patches = upToTurn == null ? s.ledger : s.ledger.filter(p => p.turn <= upToTurn);
      const state = {};
      for (const target of new Set(patches.map(p => p.target))) {
        state[target] = fold({}, patches, target);
      }
      return {
        worldId: s.worldId, digest: world.digest,
        turns: patches.length ? Math.max(...patches.map(p => p.turn)) : 0,
        applied: patches.length, state,
      };
    },
  };
}
