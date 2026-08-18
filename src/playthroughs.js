// Playthroughs — a campaign's binding to a world, persisted per tenant.
//
// This layer replaces the old in-process world "sessions" (`ws-N` ids in a
// Map inside the registry). Those could not survive a server restart, and
// over the stateless HTTP transport — a fresh McpServer per request — they
// could not survive from one tool call to the NEXT: world_begin followed by
// world_commit was functionally broken at one table. The fix is not a cache;
// it is admitting that a playthrough is campaign state, and campaign state
// lives where every other kind already does — in the memory store's token
// namespace, on disk, beside memory.jsonl and the image gate.
//
// So: THE CAMPAIGN NAME IS THE PLAYTHROUGH ID. One campaign, one world, one
// pin, one ledger. No parallel identity to leak across tenants or lose.
//
// The pin records which cartridge the campaign runs on (id + digest, frozen
// at begin — a shelf whose file changes under a pinned campaign is detected,
// not absorbed). The ledger is the campaign; replay folds it over the
// cartridge's own cells, so a province the players changed replays as that
// province — name, slice, mood and all — not as patch residue over `{}`.

import {
  makePatch, appendPatch, fold, isValidId,
  classifyRevision, revisionConflicts, playerCut,
} from '@zeeuw/bag-of-holding-client';

// The engine's ledger id grammar (kind.name segments) is one convention;
// cartridge geo ids (continent-0.province-1) are another. Both are legal
// patch targets, so target validation accepts either: the client's isValidId
// covers the ledger grammar, and the geo grammar is the same character set —
// lowercase alphanumerics and hyphens in dot segments. What neither allows
// is what matters: path separators, dots-only segments, empty segments.
const GEO_ID = /^[a-z0-9][a-z0-9-]*(\.[a-z0-9][a-z0-9-]*)*$/;
const validTarget = (t) => typeof t === 'string' && (isValidId(t) || GEO_ID.test(t));

/**
 * Build the playthrough layer over a world registry and the memory store.
 * Every method takes the tenant token first, exactly like the store's own
 * methods — tenancy is the caller's (the tool layer's) concern.
 */
export function createPlaythroughs(worlds, store) {
  return {
    /**
     * Bind `campaign` to a world and record the pin. Refuses when the
     * campaign is already bound (one campaign, one world) and when the world
     * is unknown. The start province is STORED in the pin, not recomputed on
     * read: a future revision that inserts an earlier port must not silently
     * move an existing campaign's landing.
     */
    begin(token, campaign, worldId, { revision = null } = {}) {
      const world = worlds.get(worldId);
      if (!world) {
        throw new Error(`unknown world '${worldId}' — call world_catalog first`);
      }
      // A NEW campaign defaults to the latest servable revision; an explicit
      // number pins exactly that rung. Either way the resolution is frozen
      // into the pin — this campaign never moves again unless it explicitly
      // upgrades.
      const at = worlds.resolve(worldId, revision);
      if (!at) {
        throw new Error(`world '${worldId}' has no servable revision ${revision} — world_revisions shows the ladder`);
      }
      const start = at.data.provinces.find(p => at.data.geo.nodes[p].port) ?? at.data.provinces[0] ?? null;
      const pin = store.worldBind(token, campaign, {
        v: 1,
        worldId,
        revision: at.revision,
        digest: at.digest,
        baseDigest: world.digest,
        setting: world.settingId ?? null,
        start,
        upgrades: [],
      });
      return {
        campaign, worldId, revision: pin.revision, digest: pin.digest,
        setting: pin.setting, start: pin.start,
      };
    },

    /** The campaign's pin, or null when it has never begun a world. */
    pin(token, campaign) {
      return store.worldPin(token, campaign);
    },

    /**
     * Validate and append play patches. Partial acceptance by design: a
     * batch of eight patches with one bad path must not lose the seven good
     * ones, and the narrator's drift is visible in `rejected` — patch.js's
     * own guidance is that callers should count rejections.
     *
     * Every accepted patch went through makePatch (path/scope/kind/turn
     * validation, prototype-chain refusal) and appendPatch with the
     * cartridge cells as base — so canon that contradicts mechanical state
     * is rejected HERE, with a reason, instead of silently accepted and
     * skipped at fold time.
     */
    commit(token, campaign, rawPatches) {
      const pin = store.worldPin(token, campaign);
      if (!pin) {
        throw new Error(`campaign "${campaign}" has no world; call world_begin first`);
      }
      let ledger = store.worldLedger(token, campaign).patches;
      const accepted = [];
      const rejected = [];
      rawPatches.forEach((raw, index) => {
        let patch;
        try {
          patch = makePatch(raw);
        } catch (err) {
          return rejected.push({ index, reason: err.message });
        }
        if (!validTarget(patch.target)) {
          return rejected.push({ index, reason: `invalid target id '${patch.target}'` });
        }
        const bases = { [patch.target]: worlds.cell(pin.worldId, patch.target, pin.revision ?? 0) ?? {} };
        const out = appendPatch(ledger, patch, bases);
        if (!out.ok) {
          return rejected.push({ index, reason: out.reason, conflict: out.conflict ?? null });
        }
        ledger = out.ledger;
        accepted.push(patch);
      });
      store.worldAppend(token, campaign, accepted);
      // Committing about an entity is observing it — the write half of the
      // future publish gate's question "has any campaign seen this?".
      store.worldObserve(token, campaign, accepted.map((p) => ({
        id: p.target, path: p.path.split('.')[0], turn: p.turn,
      })));
      return { appended: accepted.length, rejected, ledgerLength: ledger.length };
    },

    /**
     * Fold the campaign's ledger over the pinned cartridge — the promise the
     * old replay made ("over the immutable cartridge base") and did not
     * keep: it folded over `{}`, so replay returned patch residue instead of
     * the world. Cartridge entities now fold over their real cells; entities
     * the table invented fold from nothing, which is what they are.
     */
    replay(token, campaign, { upToTurn = null } = {}) {
      const pin = store.worldPin(token, campaign);
      if (!pin) return null;
      const world = worlds.get(pin.worldId);
      if (!world) {
        // The shelf lost the cartridge from under a pinned campaign — say
        // so; do not fold over nothing and call it the world.
        throw new Error(`campaign "${campaign}" is pinned to '${pin.worldId}', which this server no longer mounts`);
      }
      if (!worlds.resolve(pin.worldId, pin.revision ?? 0)) {
        // Same honesty one level up: the base is here but the pinned
        // revision's chain no longer resolves (a revision file was removed
        // or its base digest stopped matching).
        throw new Error(`campaign "${campaign}" is pinned to '${pin.worldId}' revision ${pin.revision}, which this shelf can no longer resolve`);
      }
      const all = store.worldLedger(token, campaign).patches;
      const patches = upToTurn == null ? all : all.filter(p => p.turn <= upToTurn);
      const state = {};
      for (const target of new Set(patches.map(p => p.target))) {
        state[target] = fold(worlds.cell(pin.worldId, target, pin.revision ?? 0) ?? {}, patches, target);
      }
      return {
        campaign,
        worldId: pin.worldId,
        revision: pin.revision ?? 0,
        digest: pin.digest,
        turns: patches.length ? Math.max(...patches.map(p => p.turn)) : 0,
        applied: patches.length,
        state,
      };
    },

    /**
     * Move a campaign's pin up the revision ladder — the ONLY way a running
     * game ever changes revision, and it is explicit, audited, and
     * all-or-nothing. The checks, in order: bound; forward-only; the pinned
     * resolution still matches the pin (tripwire for a hand-edited shelf);
     * the target rung resolves (its chain digests already verified by the
     * registry). Then every intervening revision's ledger is classified
     * against THIS campaign's pinned content — a node added since the pin is
     * an add, everything else is an edit — and every edit is checked against
     * what this campaign has actually observed. One conflict refuses the
     * whole upgrade with the full list; declining is a no-op forever. The
     * play ledger is never touched, and the old revision's files stay on the
     * shelf, so world_replay at the old pin still reproduces the campaign.
     */
    upgrade(token, campaign, toRevision, { dryRun = false } = {}) {
      const pin = store.worldPin(token, campaign);
      if (!pin) {
        throw new Error(`campaign "${campaign}" has no world; call world_begin first`);
      }
      const from = pin.revision ?? 0;
      if (!Number.isInteger(toRevision) || toRevision <= from) {
        throw new Error(`upgrades are forward-only: campaign "${campaign}" is at revision ${from}, cannot move to ${toRevision}`);
      }
      const current = worlds.resolve(pin.worldId, from);
      if (!current) {
        throw new Error(`campaign "${campaign}" is pinned to '${pin.worldId}' revision ${from}, which this shelf can no longer resolve`);
      }
      if (pin.digest && current.digest !== pin.digest) {
        throw new Error(`the shelf's revision ${from} of '${pin.worldId}' resolves to ${current.digest}, but this campaign pinned ${pin.digest} — the worlds directory changed under a pinned campaign; refusing to upgrade over it`);
      }
      const target = worlds.resolve(pin.worldId, toRevision);
      if (!target) {
        throw new Error(`world '${pin.worldId}' has no servable revision ${toRevision} — world_revisions shows the ladder`);
      }

      const adds = [], edits = [];
      for (let r = from + 1; r <= toRevision; r++) {
        const rev = worlds.revision(pin.worldId, r);
        if (!rev) throw new Error(`revision ${r} of '${pin.worldId}' vanished mid-check`);
        const split = classifyRevision(current.data, rev.ledger);
        adds.push(...split.adds.map(p => ({ ...p, revision: r })));
        edits.push(...split.edits.map(p => ({ ...p, revision: r })));
      }
      const observedRaw = store.worldObserved(token, campaign);
      const observations = Object.fromEntries(
        Object.entries(observedRaw).map(([id, o]) => [id, o.paths]));
      const conflicts = revisionConflicts(edits, observations).map(c => ({
        ...c,
        revision: edits.find(e => e.target === c.target && e.path === c.path)?.revision ?? null,
        was: 'observed at the table',
      }));

      if (conflicts.length) {
        return {
          ok: false, campaign, from, to: toRevision,
          adds: adds.length, edits: edits.length, blocked: conflicts.length,
          conflicts,
          advice: 'This campaign has seen content the upgrade would rewrite. Publish the revision in two halves — the additive half upgrades cleanly everywhere — or keep this campaign pinned; a pin is a fine place to stay.',
        };
      }
      if (!dryRun) {
        store.worldRebind(token, campaign,
          { ...pin, revision: toRevision, digest: target.digest },
          { from, to: toRevision, at: new Date().toISOString() });
      }
      return {
        ok: true, campaign, from, to: toRevision, digest: target.digest,
        adds: adds.length, edits: edits.length, dryRun,
      };
    },

    /**
     * The campaign's world AS THE TABLE KNOWS IT — the payload behind the
     * live atlas view.
     *
     * There is no `edition` parameter and that is deliberate. This tool is
     * reachable by a model that may be rendering onto a screen the players
     * are looking at, so the only cut it can produce is the player cut. The
     * GM's spoiler view of a world comes from the cartridge itself (or from
     * world_export's gm edition), off to one side of the table.
     *
     * Three layers compose, in this order:
     *
     *   1. the pinned revision's baked geography — the world as published;
     *   2. the campaign's own ledger, folded per node, so a province the
     *      table renamed or burned appears renamed or burned;
     *   3. discovery, which is what makes this a PLAYER map: a node counts
     *      as found when the campaign has observed it (walked in through
     *      world_node, or written a patch about it), when the ledger says
     *      so outright, or when it is the landing the pin froze at begin.
     *      Standing on a province reveals the landmass under it; an edge
     *      appears once both of its ends are known.
     *
     * Then playerCut DELETES everything else — undiscovered nodes, the
     * edges touching them, the powers that hold no known ground, and the
     * gm-only fields of what remains. A secret that never leaves the
     * server cannot leak through a stylesheet.
     *
     * `worldShape` survives the cut on purpose: it is a COUNT of the
     * world's landmasses and nothing more. Without it, a fogged map would
     * re-ring itself every time the party sighted a new coast — the atlas
     * would redraw the world rather than fill it in.
     */
    atlas(token, campaign) {
      const pin = store.worldPin(token, campaign);
      if (!pin) return null;
      const revision = pin.revision ?? 0;
      const at = worlds.resolve(pin.worldId, revision);
      if (!at) {
        throw new Error(`campaign "${campaign}" is pinned to '${pin.worldId}' revision ${revision}, which this shelf can no longer resolve`);
      }
      const data = at.data;
      const baseGeo = data.geo ?? { nodes: {}, edges: [] };

      // Layer 2 — the table's canon over the published world. Only nodes
      // the ledger actually names are folded; the rest are copied as baked.
      const patches = store.worldLedger(token, campaign).patches;
      const touched = new Set(patches.map((p) => p.target));
      const nodes = {};
      for (const [id, node] of Object.entries(baseGeo.nodes)) {
        if (!touched.has(id)) { nodes[id] = { ...node }; continue; }
        const folded = fold(worlds.cell(pin.worldId, id, revision) ?? {}, patches, id);
        nodes[id] = { ...node, ...(folded?.node ?? {}) };
      }

      // Layer 3 — discovery. The observation set is the authority (it is
      // what world_node writes when the party is THERE), the folded node
      // flag is honoured too, and the pin's landing counts from turn zero:
      // a campaign that has begun is standing somewhere.
      const found = new Set(Object.keys(store.worldObserved(token, campaign)));
      if (pin.start) found.add(pin.start);
      for (const [id, node] of Object.entries(nodes)) {
        if (found.has(id) || node.discovered === true) found.add(id);
      }
      // Standing on a province reveals the landmass under it.
      for (const id of [...found]) {
        const parent = nodes[id]?.parent;
        if (parent && nodes[parent]) found.add(parent);
      }
      for (const id of found) {
        if (nodes[id]) nodes[id] = { ...nodes[id], discovered: true };
      }
      const edges = (baseGeo.edges ?? []).map((e) => ({
        ...e, discovered: found.has(e.from) && found.has(e.to),
      }));

      const cut = playerCut({
        seed: data.seed ?? null,
        settingId: data.settingId ?? null,
        geo: { ...baseGeo, nodes, edges },
        factions: data.factions ?? [],
        npcs: data.npcs ?? [],
        warState: data.warState ?? null,
        lore: data.lore ?? {},
        edition: 'player',
      });

      return {
        ...cut,
        campaign,
        worldId: pin.worldId,
        revision,
        digest: at.digest,
        start: pin.start ?? null,
        counts: {
          continents: Object.values(cut.geo.nodes).filter((n) => n.kind === 'continent').length,
          provinces: Object.values(cut.geo.nodes).filter((n) => n.kind === 'province').length,
          links: cut.geo.edges.length,
          powers: cut.factions.length,
          wars: cut.warState?.wars?.length ?? 0,
        },
      };
    },

    /**
     * Reading a node during play is observing it whole — the party walked
     * in. This is what finally gives the client's promoteObserved concept
     * teeth on the server side.
     */
    observeRead(token, campaign, nodeId) {
      const pin = store.worldPin(token, campaign);
      if (!pin) return;
      store.worldObserve(token, campaign, [{ id: nodeId, path: '*' }]);
    },
  };
}
