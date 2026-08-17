// Tenant registry — the hot-reloadable half of the allowlist.
//
// `BOH_MEMORY_TOKEN_HASHES` is a boot-time snapshot: adding or revoking a
// tenant means editing `.env` and redeploying, which is fine for a handful
// of hand-issued tokens and hopeless for a panel that provisions them. This
// module adds the other source — a JSON file some *other* process writes:
//
//   { "version": 1,
//     "tenants": { "<sha256 hex of token>": { "tier": "free", "status": "active" } } }
//
// The two sources are a union, and the env var stays supported forever as
// break-glass: if the file is wrong, deleting the variable is not the fix,
// but setting the variable always is.
//
// Why a file and not an API. The writer is the admin panel, which holds
// identity, billing and PII; the reader is this server, which is public and
// self-hosted by strangers. A file keeps the dependency pointing one way —
// the panel projects a PII-free `hash -> {tier, status}` view and this
// server never learns what a user *is*. An HTTP control plane would mean a
// second authed surface here, credentials to distribute, and a database
// driver in a repo that ships with two dependencies.
//
// Reload is lazy and cheap: a `statSync` on the auth path, at most once per
// TTL (2s by default), reparsing only when mtime or size actually moved.
// Nothing polls in the background — a server with no traffic does no work.
//
// Failure posture, in order of how much it matters:
//   - Corrupt file at startup  -> throw. A server that boots with a registry
//     it cannot read would serve whatever the env var happens to say, which
//     is not what the operator asked for. `main()` turns this into exit 2.
//   - Corrupt file at runtime  -> keep the last good copy, warn loudly. The
//     alternative is a half-written file revoking every live table.
//   - File absent at startup   -> empty, no error. This is bootstrap
//     ordering: the server comes up before the panel has written anything.
//   - File vanishes at runtime -> keep the last good copy, warn once. A
//     stray `rm` should not be a total outage; revocation has its own
//     spelling (`status`, or dropping the entry).

import fs from 'node:fs';

/** The only schema version this server understands. */
export const REGISTRY_VERSION = 1;

/** Registry keys are sha256 hex digests — lowercase, 64 chars. */
const HASH_RE = /^[0-9a-f]{64}$/;

/** Enough of a hash to identify an entry in a log without printing the whole thing. */
const short = (hash) => `${hash.slice(0, 12)}…`;

/**
 * Parse a registry document.
 *
 * Structural problems (not JSON, wrong version, `tenants` not an object)
 * throw: the file as a whole is unusable and guessing would be worse.
 * Problems with a single entry are collected as warnings and the entry is
 * skipped — one malformed row must not revoke everybody else.
 *
 * `status` is strict on purpose: only the exact string `active` authorises.
 * A typo, a missing field, or a future value this build doesn't know all
 * mean suspended, because the failure that matters is the one where a
 * revoked tenant keeps playing. Every such case warns, so a hand-edited
 * file that silently disables a table says so in the log.
 *
 * @param {string} text
 * @returns {{ tenants: Map<string, {tier: string|null, status: 'active'|'suspended', ns: string|null}>, warnings: string[] }}
 */
export function parseRegistry(text) {
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (err) {
    throw new Error(`Tenant registry is not valid JSON: ${err.message}`);
  }
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) {
    throw new Error('Tenant registry must be a JSON object.');
  }
  if (doc.version !== REGISTRY_VERSION) {
    throw new Error(
      `Unsupported tenant registry version ${JSON.stringify(doc.version)} (this build reads version ${REGISTRY_VERSION}).`
    );
  }
  const raw = doc.tenants;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Tenant registry "tenants" must be an object keyed by token hash.');
  }

  const tenants = new Map();
  const warnings = [];
  for (const [key, entry] of Object.entries(raw)) {
    const hash = key.toLowerCase();
    if (!HASH_RE.test(hash)) {
      warnings.push(`ignoring tenant key ${JSON.stringify(key)}: not a sha256 hex digest`);
      continue;
    }
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
      warnings.push(`ignoring tenant ${short(hash)}: entry is not an object`);
      continue;
    }
    if (entry.status === undefined) {
      warnings.push(`tenant ${short(hash)} has no status — treating as suspended`);
    } else if (entry.status !== 'active' && entry.status !== 'suspended') {
      warnings.push(
        `tenant ${short(hash)} has unrecognised status ${JSON.stringify(entry.status)} — treating as suspended`
      );
    }
    tenants.set(hash, {
      // Tier names are the image layer's vocabulary, not this module's, so
      // an unknown string passes through and is validated where it is used.
      tier: typeof entry.tier === 'string' ? entry.tier : null,
      status: entry.status === 'active' ? 'active' : 'suspended',
      // Reserved for token rotation: a new hash pointing at an existing
      // namespace, so rotating a token moves no data. Nothing reads it yet.
      ns: typeof entry.ns === 'string' ? entry.ns : null,
    });
  }
  return { tenants, warnings };
}

/**
 * A lazily-reloading view of the registry file.
 *
 * `start()` performs the first load and is the only method that throws;
 * `get()` refreshes at most once per TTL and never does. Pass `now` and
 * `ttlMs` to drive the clock from a test rather than sleeping.
 *
 * @param {{ file?: string|null, ttlMs?: number, now?: () => number, warn?: (msg: string) => void }} [opts]
 */
export function createTenantRegistry(opts = {}) {
  const file = opts.file ?? null;
  const ttlMs = Number.isFinite(opts.ttlMs) ? opts.ttlMs : 2000;
  const now = opts.now ?? Date.now;
  const warn = opts.warn ?? ((msg) => console.error(`bag-of-holding-mcp: ${msg}`));

  /** @type {Map<string, {tier: string|null, status: 'active'|'suspended', ns: string|null}>} */
  let tenants = new Map();
  // mtime+size, not mtime alone: two writes inside one millisecond are rare
  // but a rename-into-place makes them possible, and a missed reload is a
  // revocation that didn't happen.
  let stamp = null;
  let lastCheck = -Infinity;
  let missingReported = false;

  function stampOf() {
    try {
      const st = fs.statSync(file);
      return `${st.mtimeMs}:${st.size}`;
    } catch {
      return null;
    }
  }

  /**
   * Read and parse the file. Returns false when it isn't there.
   * @param {boolean} strict throw on a bad file (startup) or warn (runtime)
   */
  function load(strict) {
    let text;
    try {
      text = fs.readFileSync(file, 'utf8');
    } catch (err) {
      // ENOENT is the ordinary "not written yet" case and stays quiet.
      // Anything else — a permissions problem, or the classic one where a
      // bind mount with no file behind it makes Docker create a DIRECTORY
      // at this path — is a misconfiguration that would otherwise present
      // as "every tenant 404s" with nothing in the log to explain it.
      if (err.code !== 'ENOENT') {
        const message = `tenant registry ${file} cannot be read (${err.code ?? err.message})`;
        if (strict) throw new Error(message);
        warn(`${message}; keeping ${tenants.size} tenant(s) from the last good copy`);
      }
      return false;
    }
    let parsed;
    try {
      parsed = parseRegistry(text);
    } catch (err) {
      if (strict) throw new Error(`${err.message} (${file})`);
      warn(`tenant registry ${file} is unreadable (${err.message}); keeping ${tenants.size} tenant(s) from the last good copy`);
      // Deliberately leave `stamp` alone so the next check retries this
      // file rather than treating the broken version as loaded.
      return true;
    }
    for (const message of parsed.warnings) warn(`tenant registry: ${message}`);
    tenants = parsed.tenants;
    stamp = stampOf();
    missingReported = false;
    return true;
  }

  function refresh(force) {
    if (file === null) return;
    const t = now();
    if (!force && t - lastCheck < ttlMs) return;
    lastCheck = t;
    const current = stampOf();
    if (current === null) {
      // Absent. At startup that is ordinary (the panel has not written it
      // yet); later it means someone removed a file we were reading.
      if (stamp !== null && !missingReported) {
        missingReported = true;
        warn(`tenant registry ${file} disappeared; keeping ${tenants.size} tenant(s) from the last good copy`);
      }
      return;
    }
    if (current === stamp) return;
    load(false);
  }

  return {
    /** Whether a registry file was configured at all. */
    configured: file !== null,
    /** Configured path, or null. Reported by `info()` for orientation. */
    file,

    /**
     * First load. Throws when the file exists but cannot be used, so a
     * misconfigured deploy fails closed at boot instead of quietly serving
     * a different allowlist than the operator intended.
     */
    start() {
      if (file === null) return;
      lastCheck = now();
      if (stampOf() !== null) load(true);
    },

    /**
     * Look up a tenant by token hash, refreshing if the TTL has expired.
     * Returns null for an unknown hash — including one whose entry was
     * skipped as malformed.
     */
    get(hash) {
      refresh(false);
      return tenants.get(hash) ?? null;
    },

    /** How many tenants the last good copy holds. */
    get size() {
      return tenants.size;
    },
  };
}
