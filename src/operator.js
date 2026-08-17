// The operator surface — read-only, out-of-band, deliberately not a tool.
//
// Every method on the memory store takes a token and derives the namespace
// from it, so nothing in the MCP surface can enumerate tenants or read across
// them. That is a security boundary, stated where it is enforced:
// scripts/publish-revision.js says "no model-reachable tool may enumerate
// namespaces; an operator at a shell may". This module is the "operator at a
// shell" half, packaged so the admin panel can import it instead of
// re-implementing the on-disk layout.
//
// Three properties keep that boundary honest, and all three are load-bearing:
//
//   1. READ-ONLY BY CONSTRUCTION. There are no write methods here. Not
//      "writes that check a flag" — none. The panel provisions tenants by
//      writing the registry file; it never reaches into campaign data.
//   2. NOT WIRED INTO ANY TOOL. Nothing under src/tools/ imports this, and
//      nothing should. `createServer` never sees it.
//   3. FILESYSTEM ACCESS IS THE CREDENTIAL. There is no auth here because
//      there is no request here: whoever can open the data directory can
//      already read everything in it. Do not put this behind an HTTP handler
//      and call the handler's auth sufficient.
//
// It imports node: builtins and ./memory/layout.js only — no MCP SDK, no zod,
// no engine. A consumer installing this package for the operator surface pays
// for a path join and a JSON parse.
//
// Concurrency: the serving process appends to these files while this reads
// them. Every reader here is tolerant — a torn trailing line is reported as
// `truncatedTail`, never thrown — because the alternative is a dashboard that
// breaks whenever someone is actually playing.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  campaignDirOf, memoryFileOf, stateDirOf, imageGateFileOf,
  worldPinFileOf, worldLedgerFileOf, worldObservedFileOf,
  parseJsonl, liveRecords,
} from './memory/layout.js';

// Namespace and campaign names are directory names. The panel passes these
// back from `listNamespaces`, but validating anyway is what stops a crafted
// name from walking out of the data directory.
const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/;

function assertName(kind, value) {
  if (typeof value !== 'string' || !NAME_RE.test(value)) {
    throw new Error(
      `Invalid ${kind}: ${JSON.stringify(value)}. Use 1-64 characters of A-Za-z0-9_- starting with a letter or digit.`
    );
  }
}

const statOr = (file, pick, fallback) => {
  try { return pick(fs.statSync(file)); } catch { return fallback; }
};
const mtimeOf = (file) => statOr(file, (s) => s.mtimeMs, 0);
const sizeOf = (file) => statOr(file, (s) => s.size, 0);

/** Read a JSON file, or null if it is missing or unparseable. */
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** Total bytes under a directory. Missing directories are 0, not an error. */
function dirBytes(dir) {
  let total = 0;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) total += dirBytes(full);
    else total += sizeOf(full);
  }
  return total;
}

function listDirs(dir) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name);
  } catch {
    return [];
  }
}

/**
 * Open a read-only view of a data directory.
 *
 * Resolution matches the memory store: `opts.dataDir` → `$BOH_DATA_DIR` →
 * `~/.bag-of-holding`. Nothing is created; a data directory that does not
 * exist reads as empty rather than throwing, so a panel can start before the
 * game server has ever written anything.
 *
 * @param {{ dataDir?: string }} [opts]
 */
export function createOperatorStore(opts = {}) {
  const dataDir = opts.dataDir
    ?? process.env.BOH_DATA_DIR
    ?? path.join(os.homedir(), '.bag-of-holding');

  /** Everything known about one campaign directory. */
  function campaignDetail(ns, campaign) {
    const memory = memoryFileOf(dataDir, ns, campaign);
    let records = 0;
    let corruptLinesSkipped = 0;
    let truncatedTail = false;
    if (fs.existsSync(memory)) {
      const parsed = parseJsonl(fs.readFileSync(memory, 'utf8'));
      records = liveRecords(parsed.entries).length;
      corruptLinesSkipped = parsed.corrupt;
      truncatedTail = parsed.truncatedTail;
    }

    const sd = stateDirOf(dataDir, ns, campaign);
    const stateKeys = fs.existsSync(sd)
      ? fs.readdirSync(sd).filter((f) => f.endsWith('.json')).length
      : 0;

    const ledgerFile = worldLedgerFileOf(dataDir, ns, campaign);
    let ledgerEntries = 0;
    let ledgerTruncated = false;
    if (fs.existsSync(ledgerFile)) {
      const parsed = parseJsonl(fs.readFileSync(ledgerFile, 'utf8'));
      ledgerEntries = parsed.entries.length;
      ledgerTruncated = parsed.truncatedTail;
    }

    const pin = readJson(worldPinFileOf(dataDir, ns, campaign));
    const observed = readJson(worldObservedFileOf(dataDir, ns, campaign));
    const gate = readJson(imageGateFileOf(dataDir, ns, campaign));

    const lastPlayedAt = Math.round(Math.max(
      mtimeOf(memory), mtimeOf(ledgerFile),
      mtimeOf(worldPinFileOf(dataDir, ns, campaign)), mtimeOf(sd), 0
    ));

    return {
      campaign,
      records,
      corruptLinesSkipped,
      // True when a file was read mid-append, i.e. someone is playing right
      // now. Surfaced rather than hidden: a count that quietly excludes the
      // newest line reads as data loss.
      truncatedTail: truncatedTail || ledgerTruncated,
      stateKeys,
      ledgerEntries,
      observedKeys: observed === null ? 0 : Object.keys(observed).length,
      lastPlayedAt,
      bytes: dirBytes(campaignDirOf(dataDir, ns, campaign)),
      world: pin === null ? null : {
        worldId: pin.worldId ?? null,
        setting: pin.setting ?? null,
        digest: pin.digest ?? null,
        start: pin.start ?? null,
      },
      // Deployment policy rather than campaign story, which is why it is not
      // in the export — but the panel needs it to answer "is this tenant
      // actually using the tier they are on?".
      imageGate: gate === null ? null : {
        enabled: gate.enabled ?? false,
        tier: gate.tier ?? null,
        budget: gate.budget ?? null,
        spent: gate.spent ?? 0,
        renders: gate.renders ?? 0,
      },
    };
  }

  return {
    dataDir,

    /**
     * One row per namespace directory, busiest first.
     *
     * Namespaces are opaque here by construction — `t-<sha256(token)[0:16]>`
     * is a one-way hash, so this can report what a tenant *has* and never who
     * they are. Mapping a namespace back to a person is the panel's job, from
     * its own records.
     */
    listNamespaces() {
      return listDirs(dataDir)
        .map((ns) => {
          const campaigns = listDirs(path.join(dataDir, ns));
          const lastActivityAt = campaigns.reduce(
            (max, campaign) => Math.max(max, mtimeOf(campaignDirOf(dataDir, ns, campaign)),
              mtimeOf(memoryFileOf(dataDir, ns, campaign))),
            mtimeOf(path.join(dataDir, ns))
          );
          return {
            ns,
            campaigns: campaigns.length,
            bytes: dirBytes(path.join(dataDir, ns)),
            lastActivityAt: Math.round(lastActivityAt),
          };
        })
        .sort((a, b) => b.lastActivityAt - a.lastActivityAt);
    },

    /**
     * Everything the panel shows on one tenant: per-campaign record, state
     * and ledger counts, world binding, image-gate spend, sizes and times.
     *
     * A namespace with no directory reads as `exists: false` with an empty
     * campaign list rather than throwing — a provisioned tenant who has never
     * played is a normal row in the table, not an error.
     */
    namespaceOverview(ns) {
      assertName('namespace', ns);
      const root = path.join(dataDir, ns);
      const campaigns = listDirs(root)
        .map((campaign) => campaignDetail(ns, campaign))
        .sort((a, b) => b.lastPlayedAt - a.lastPlayedAt);
      return {
        ns,
        exists: fs.existsSync(root),
        bytes: dirBytes(root),
        lastActivityAt: campaigns.reduce((max, c) => Math.max(max, c.lastPlayedAt), 0),
        campaigns,
      };
    },

    /**
     * A campaign dump in the same shape as the `memory_export` tool, so an
     * operator-side export and a player-side one are the same file and can be
     * re-imported by the same `memory_import`.
     *
     * The image gate is deliberately absent, matching the tool: a render
     * budget is deployment policy, and importing one would smuggle spend
     * state between deployments.
     */
    exportCampaign(ns, campaign) {
      assertName('namespace', ns);
      assertName('campaign', campaign);
      const dir = campaignDirOf(dataDir, ns, campaign);
      if (!fs.existsSync(dir)) {
        throw new Error(`No campaign "${campaign}" in namespace "${ns}".`);
      }
      const memory = memoryFileOf(dataDir, ns, campaign);
      const parsed = fs.existsSync(memory)
        ? parseJsonl(fs.readFileSync(memory, 'utf8'))
        : { entries: [], corrupt: 0, truncatedTail: false };

      const state = {};
      const sd = stateDirOf(dataDir, ns, campaign);
      if (fs.existsSync(sd)) {
        for (const file of fs.readdirSync(sd).filter((f) => f.endsWith('.json'))) {
          const data = readJson(path.join(sd, file));
          // A torn checkpoint is skipped, same as a torn memory line.
          if (data !== null) state[file.slice(0, -5)] = data;
        }
      }

      const pin = readJson(worldPinFileOf(dataDir, ns, campaign));
      let world = null;
      if (pin !== null) {
        const ledgerFile = worldLedgerFileOf(dataDir, ns, campaign);
        const ledger = fs.existsSync(ledgerFile)
          ? parseJsonl(fs.readFileSync(ledgerFile, 'utf8')).entries
          : [];
        world = {
          pin,
          ledger,
          observed: readJson(worldObservedFileOf(dataDir, ns, campaign)) ?? {},
        };
      }

      return {
        campaign,
        records: liveRecords(parsed.entries),
        corruptLinesSkipped: parsed.corrupt,
        truncatedTail: parsed.truncatedTail,
        state,
        world,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// The destructive half — deliberately a SEPARATE factory.
//
// `createOperatorStore` above is read-only by construction, and a test asserts
// its exact method list. That contract is worth keeping, so deletion does not
// join it: it lives here, under a name that says what it does, so the import
// line in a consumer reads as an admission rather than an accident.
//
// Everything the read surface's header says still applies, and more sharply:
// nothing under src/tools/ may import this, and filesystem access IS the
// credential. There is no auth here because there is no request here.
//
// What this does NOT do, on purpose:
//   - It does not check whether a tenant is allowed to be deleted. That is
//     policy, and policy lives in the administration layer that knows what a
//     tenant IS. This module knows only directories.
//   - It does not stop the serving process from writing. A campaign being
//     played while it is deleted is a race the CALLER must close — the panel
//     does it by requiring the tenant be revoked first, which shuts the door
//     ~2s before anything is removed.
//
// Every method captures what it is about to destroy and returns it, so the
// caller can write an audit record that outlives the data it describes.

/**
 * Open a destructive view of a data directory.
 *
 * @param {{ dataDir?: string }} [opts]
 */
export function createOperatorPurge(opts = {}) {
  const dataDir = opts.dataDir
    ?? process.env.BOH_DATA_DIR
    ?? path.join(os.homedir(), '.bag-of-holding');
  const reader = createOperatorStore({ dataDir });

  /**
   * Resolve a path under the data directory, or throw.
   *
   * The name checks above already reject `..`, so this is the second lock on
   * the same door: it re-resolves and proves the result is strictly inside
   * the root. `rmSync(..., {recursive: true})` aimed one level too high
   * deletes every tenant on the box, so this is worth asserting twice.
   */
  function within(...segments) {
    const root = path.resolve(dataDir);
    const target = path.resolve(root, ...segments);
    if (target === root || !target.startsWith(root + path.sep)) {
      throw new Error(`Refusing to delete ${target}: outside the data directory ${root}.`);
    }
    return target;
  }

  return {
    dataDir,

    /**
     * Delete one campaign directory — memory log, state vault, image gate,
     * world playthrough, everything under it.
     *
     * Returns what was destroyed. Throws when the campaign does not exist,
     * so a double-submitted form is a visible error rather than a silent
     * "deleted" for something that was already gone.
     */
    deleteCampaign(ns, campaign) {
      assertName('namespace', ns);
      assertName('campaign', campaign);
      const dir = within(ns, campaign);
      if (!fs.existsSync(dir)) {
        throw new Error(`No campaign "${campaign}" in namespace "${ns}".`);
      }
      // Captured BEFORE the delete: this is what the audit record gets, and
      // there is no second chance to read it.
      const before = reader.namespaceOverview(ns).campaigns.find((c) => c.campaign === campaign) ?? null;
      fs.rmSync(dir, { recursive: true, force: true });
      return {
        ns,
        campaign,
        records: before?.records ?? 0,
        stateKeys: before?.stateKeys ?? 0,
        ledgerEntries: before?.ledgerEntries ?? 0,
        bytes: before?.bytes ?? 0,
      };
    },

    /**
     * Delete an entire namespace — every campaign a tenant has.
     *
     * Irreversible, and the largest thing this package can be asked to do.
     * The caller is expected to have closed the door first; see the header.
     */
    deleteNamespace(ns) {
      assertName('namespace', ns);
      const dir = within(ns);
      if (!fs.existsSync(dir)) {
        throw new Error(`No namespace "${ns}" in ${dataDir}.`);
      }
      const before = reader.namespaceOverview(ns);
      fs.rmSync(dir, { recursive: true, force: true });
      return {
        ns,
        campaigns: before.campaigns.map((c) => c.campaign),
        records: before.campaigns.reduce((sum, c) => sum + c.records, 0),
        bytes: before.bytes,
      };
    },
  };
}
