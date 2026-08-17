// On-disk layout of a campaign — the one place that knows where things live.
//
// Two readers need this: the memory store (which owns writing) and the
// operator module (which reads across every namespace for the admin panel).
// Duplicating six path joins between them would work right up until one side
// learned about a new file, so they share these instead. Everything here is
// pure and takes `dataDir` explicitly; nothing opens a file.
//
//   <dataDir>/<ns>/<campaign>/memory.jsonl          append-only narrative log
//   <dataDir>/<ns>/<campaign>/state/<key>.json      mechanical checkpoints
//   <dataDir>/<ns>/<campaign>/image-gate.json       render budget
//   <dataDir>/<ns>/<campaign>/world.json            world pin
//   <dataDir>/<ns>/<campaign>/world-ledger.jsonl    append-only patch ledger
//   <dataDir>/<ns>/<campaign>/world-observed.json   observation set
//
// The three files outside `state/` are outside it on purpose: the state vault
// is addressable by the model through `state_save`, and a budget or a world
// pin that a tool could overwrite would not be much of a budget or a pin.

import path from 'node:path';

export const campaignDirOf = (dataDir, ns, campaign) => path.join(dataDir, ns, campaign);
export const memoryFileOf = (dataDir, ns, campaign) => path.join(campaignDirOf(dataDir, ns, campaign), 'memory.jsonl');
export const stateDirOf = (dataDir, ns, campaign) => path.join(campaignDirOf(dataDir, ns, campaign), 'state');
export const imageGateFileOf = (dataDir, ns, campaign) => path.join(campaignDirOf(dataDir, ns, campaign), 'image-gate.json');
export const worldPinFileOf = (dataDir, ns, campaign) => path.join(campaignDirOf(dataDir, ns, campaign), 'world.json');
export const worldLedgerFileOf = (dataDir, ns, campaign) => path.join(campaignDirOf(dataDir, ns, campaign), 'world-ledger.jsonl');
export const worldObservedFileOf = (dataDir, ns, campaign) => path.join(campaignDirOf(dataDir, ns, campaign), 'world-observed.json');

/**
 * Parse a JSONL body tolerantly.
 *
 * Corrupt lines are counted and skipped rather than thrown: losing one memory
 * beats refusing to load a campaign, and a hand-edited log should still open.
 *
 * `truncatedTail` reports that the text does not end on a line boundary.
 * Writers here always append a trailing newline, so the only ways to see this
 * are a torn write or — the case that matters for the admin panel — reading
 * the file in one process while the server appends to it in another. The
 * panel shows it rather than pretending the last record is missing.
 *
 * @param {string} text
 * @returns {{ entries: unknown[], corrupt: number, truncatedTail: boolean }}
 */
export function parseJsonl(text) {
  const lines = text.split(/\r?\n/);
  const truncatedTail = lines[lines.length - 1].trim() !== '';
  const entries = [];
  let corrupt = 0;
  for (const line of lines) {
    if (line.trim() === '') continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      corrupt += 1;
    }
  }
  return { entries, corrupt, truncatedTail };
}

/**
 * Fold a memory op log into the live record set (insertion-ordered, oldest
 * first). `forget` ops tombstone earlier `record` ops; unknown ops are
 * ignored, so an older server can read a log a newer one wrote.
 */
export function liveRecords(ops) {
  const live = new Map();
  for (const entry of ops) {
    if (entry.op === 'record') {
      const { op, ...rec } = entry;
      live.set(rec.id, rec);
    } else if (entry.op === 'forget') {
      live.delete(entry.id);
    }
  }
  return [...live.values()];
}
