// Session manager — holds one engine instance per session id.
//
// Why sessions exist: bag-of-holding's audit/replay contract
// (seeded RNG + rollLog + verifyLog) is only useful if a single
// run's rolls all flow through the same engine instance. The MCP
// server is one process serving (potentially) many concurrent
// games, so we keep a small Map of named engines and let tool
// callers select one with `session: "<id>"`. Omit `session` and
// you get the default singleton, which uses Math.random and is
// fine for one-shot mechanic queries ("roll me a d20") where
// determinism doesn't matter.
//
// State here is intentionally minimal: only the engine + its
// metadata. Character sheets, world state, narrative memory all
// stay in the host — see docs/boundary.md in the engine repo.

import { createEngine, Dice } from '@zeeuw/bag-of-holding';

/**
 * Create a fresh session registry plus its default engine.
 *
 * Why a factory instead of module-globals: tests need isolated
 * registries (no cross-test bleed), and a host that embeds the
 * MCP server in-process may want several independent registries
 * (e.g., one per tenant).
 */
export function createSessions() {
  const engines = new Map();
  const metadata = new Map();

  // Default singleton — no seed, no log cap, plain Math.random.
  // Created eagerly so the very first tool call always has
  // something to dispatch against, even before a host opens a
  // named session.
  const defaultEngine = createEngine();
  engines.set('default', defaultEngine);
  metadata.set('default', { id: 'default', seed: null, createdAt: Date.now() });

  /**
   * Look up an engine by session id. Falls back to the default
   * singleton when `id` is `undefined`/empty so tool handlers can
   * always call `sessions.get(args.session)` without a null guard.
   * Throws on an unknown explicit id — silent fallback would hide
   * host bugs where a session was destroyed mid-game.
   */
  function get(id) {
    if (id === undefined || id === null || id === '') return defaultEngine;
    const engine = engines.get(id);
    if (!engine) throw new Error(`Unknown session: ${id}`);
    return engine;
  }

  /**
   * Mint a new named session with its own seeded engine.
   *
   * Why we generate the id server-side: replay determinism only
   * works if the seed is captured the moment the engine is built;
   * letting the host supply a freeform id is fine, but we own the
   * seed→engine binding so a host can never accidentally reuse a
   * seed under a different id and silently desync its rollLog.
   */
  function create({ id, seed, rollLogCap, extras } = {}) {
    const sessionId = id ?? `session-${engines.size}-${Date.now()}`;
    if (engines.has(sessionId)) {
      throw new Error(`Session already exists: ${sessionId}`);
    }
    const opts = { ...(extras ?? {}) };
    if (seed !== undefined && seed !== null) {
      opts.rng = Dice.seededRng(seed);
    }
    if (rollLogCap !== undefined && rollLogCap !== null) {
      opts.rollLogCap = rollLogCap;
    }
    const engine = createEngine(opts);
    engines.set(sessionId, engine);
    metadata.set(sessionId, {
      id: sessionId,
      seed: seed ?? null,
      rollLogCap: rollLogCap ?? null,
      createdAt: Date.now()
    });
    return { id: sessionId, seed: seed ?? null };
  }

  /**
   * Free a session's engine + metadata. The default singleton is
   * protected because it's the implicit fallback for unscoped tool
   * calls; destroying it would break every subsequent tool that
   * doesn't pass an explicit session id.
   */
  function destroy(id) {
    if (id === 'default') {
      throw new Error('Cannot destroy the default session');
    }
    const existed = engines.delete(id);
    metadata.delete(id);
    if (!existed) throw new Error(`Unknown session: ${id}`);
    return { destroyed: id };
  }

  /**
   * Snapshot all session metadata. Used by the `engine_list_sessions`
   * tool so a host can render "current campaigns" UI without
   * touching the engine objects directly.
   */
  function list() {
    return Array.from(metadata.values());
  }

  /**
   * Read a session's append-only rollLog. Returned as a defensive
   * copy so the caller (often the MCP transport layer, then the
   * AI) can't mutate the engine's audit trail.
   */
  function rollLog(id) {
    const engine = get(id);
    return engine.rollLog.slice();
  }

  return { get, create, destroy, list, rollLog };
}
