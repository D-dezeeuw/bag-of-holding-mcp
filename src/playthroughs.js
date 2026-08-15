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

import { makePatch, appendPatch, fold, isValidId } from '@zeeuw/bag-of-holding-client';

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
    begin(token, campaign, worldId) {
      const world = worlds.get(worldId);
      if (!world) {
        throw new Error(`unknown world '${worldId}' — call world_catalog first`);
      }
      const start = world.provinces.find(p => world.geo.nodes[p].port) ?? world.provinces[0] ?? null;
      const pin = store.worldBind(token, campaign, {
        v: 1,
        worldId,
        digest: world.digest,
        setting: world.settingId ?? null,
        start,
        upgrades: [],
      });
      return { campaign, worldId, digest: pin.digest, setting: pin.setting, start: pin.start };
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
        const bases = { [patch.target]: worlds.cell(pin.worldId, patch.target) ?? {} };
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
      const all = store.worldLedger(token, campaign).patches;
      const patches = upToTurn == null ? all : all.filter(p => p.turn <= upToTurn);
      const state = {};
      for (const target of new Set(patches.map(p => p.target))) {
        state[target] = fold(worlds.cell(pin.worldId, target) ?? {}, patches, target);
      }
      return {
        campaign,
        worldId: pin.worldId,
        digest: pin.digest,
        turns: patches.length ? Math.max(...patches.map(p => p.turn)) : 0,
        applied: patches.length,
        state,
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
