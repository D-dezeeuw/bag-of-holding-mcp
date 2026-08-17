// World-pack registry — lookup, freezing, and the GM/public layer cut.
//
// Packs are plain data modules; this file is the only place that
// knows more than one exists. The registry deep-freezes every pack
// at import time so nothing downstream (tool handlers, the SDK, a
// creative host) can mutate shared world state — same immutability
// stance as the engine's SRD registries.

import { greyfen } from './greyfen.js';
import { gutterlight } from './gutterlight.js';
import { hollowVale } from './hollow-vale.js';

/**
 * Recursively freeze a value. Exported for pack authors: freeze
 * your pack at module scope exactly like `worlds` below is frozen.
 * The `isFrozen` guard makes shared references (two ids pointing
 * at one entry) a no-op on revisit instead of redundant work.
 */
export function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}

export const worlds = deepFreeze({
  [greyfen.id]: greyfen,
  [gutterlight.id]: gutterlight,
  [hollowVale.id]: hollowVale
});

/** Look up a pack by id; the error names what does exist. */
export function getWorld(id) {
  const world = worlds[id];
  if (!world) {
    throw new Error(`Unknown world: ${JSON.stringify(id)}. Available: ${Object.keys(worlds).join(', ')}.`);
  }
  return world;
}

/**
 * Return a deep copy of `entry` with every `gm` key removed unless
 * the GM layer was explicitly requested. Copying (not masking in
 * place) matters: packs are frozen and shared, so the public view
 * must be a fresh object the host can do anything with.
 */
export function layered(entry, layer) {
  const copy = structuredClone(entry);
  if (layer === 'gm') return copy;
  (function strip(value) {
    if (value !== null && typeof value === 'object') {
      if (!Array.isArray(value)) delete value.gm;
      for (const key of Object.keys(value)) strip(value[key]);
    }
  })(copy);
  return copy;
}
