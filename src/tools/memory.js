// Memory & state-vault tools — long-campaign persistence.
//
// Everything here writes to disk through the memory store; nothing
// touches the engine or the rollLog. The split of responsibilities:
// `memory_*` is the campaign's *narrative* log (what happened, who
// was met, what was promised), `state_*` is its *mechanical*
// checkpoint store (party records, Session.serialize payloads).
// Together they mean a campaign survives a context reset: recap
// from memory, reload the party from state, keep playing.
//
// The `guide_get({ id: "memory-protocol" })` guide is the long-form
// discipline; the tool descriptions below are its short form.

import { z } from 'zod';
import { toolResult, toolError } from '../_result.js';
import { MEMORY_TYPES } from '../memory/store.js';

const TokenField = z.string().optional().describe(
  'Memory token — an opaque string that namespaces your storage (never stored, only hashed). Omit it for the shared local namespace. Required when the server runs with a token allowlist (hosted mode). Treat it like a password; never write it into memory records.'
);

const CampaignField = z.string().describe(
  'Campaign name, e.g. "curse-of-the-fen". 1-64 chars of A-Za-z0-9_- (it becomes a folder name). Use one campaign name per table and stick to it.'
);

const TypeField = z.enum(MEMORY_TYPES).describe(
  'Record kind: event (something happened), npc / place / faction / item (a durable fact about one), quest (goal state), lore (world truth learned), session-summary (end-of-session recap), note (anything else).'
);

/**
 * Build the memory + state tool descriptors against a memory store.
 *
 * Unlike the engine tool factories these close over the *store*,
 * not the session registry — memory deliberately outlives any
 * engine session (that is its whole point).
 */
export function memoryTools(store) {
  return [
    {
      name: 'memory_status',
      description: 'Orient yourself: which namespace this token maps to, where data lives on disk, whether the server requires tokens, and every campaign in the namespace with record/state counts. Call this once at the start of a session before recording.',
      input: { token: TokenField },
      handler: async ({ token }) => {
        try {
          return toolResult(store.info(token));
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'memory_record',
      description: 'Append one memory to the campaign\'s permanent log. Record at scene ends, first meetings, promises made, and always one session-summary before ending a session. Write text in third person, past tense, self-contained (it will be read months later with no context). Name every proper noun in `entities` — that is what search keys on. Returns the stored record with its id.',
      input: {
        token: TokenField,
        campaign: CampaignField,
        type: TypeField,
        text: z.string().describe('The memory itself — 1-3 sentences, self-contained, third person past tense. Facts, not transcript.'),
        entities: z.array(z.string()).optional().describe('Proper nouns involved: NPC names, places, factions, item names. Double-weighted in search — always fill this.'),
        tags: z.array(z.string()).optional().describe('Free labels for filtering, e.g. ["act-1", "secret", "combat"].'),
        importance: z.number().int().min(1).max(5).optional().describe('1 trivia … 5 campaign-defining. Default 3. Reserve 5 for facts that change the campaign\'s direction.')
      },
      handler: async ({ token, campaign, ...input }) => {
        try {
          return toolResult(store.record(token, campaign, input));
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'memory_search',
      description: 'Query the campaign log (BM25 over text, entities and tags double-weighted, importance and recency break ties). Call it whenever a name resurfaces, a scene opens in a known place, or before improvising a fact you might have already established. Empty hits honestly means the log has nothing — do not invent a memory.',
      input: {
        token: TokenField,
        campaign: CampaignField,
        query: z.string().describe('What you need to recall, e.g. "Maela debt lantern court".'),
        limit: z.number().int().min(1).max(50).optional().describe('Max hits (default 8).'),
        type: TypeField.optional(),
        entities: z.array(z.string()).optional().describe('Restrict to records naming at least one of these entities (case-insensitive).')
      },
      handler: async ({ token, campaign, ...query }) => {
        try {
          return toolResult(store.search(token, campaign, query));
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'memory_recent',
      description: 'Newest records first — the session-start recap read. Combine with type: "session-summary" to reload where the story left off, then memory_search for specifics as they come up.',
      input: {
        token: TokenField,
        campaign: CampaignField,
        limit: z.number().int().min(1).max(100).optional().describe('How many records (default 10).'),
        type: TypeField.optional()
      },
      handler: async ({ token, campaign, ...opts }) => {
        try {
          return toolResult(store.recent(token, campaign, opts));
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'memory_forget',
      description: 'Tombstone a record by id (it stops appearing in search/recent/export; the underlying log stays append-only). Use for corrections — record the corrected fact first, then forget the wrong one.',
      input: {
        token: TokenField,
        campaign: CampaignField,
        id: z.string().describe('Record id from memory_record / memory_search, e.g. "m-17".')
      },
      handler: async ({ token, campaign, id }) => {
        try {
          return toolResult(store.forget(token, campaign, id));
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'memory_export',
      description: 'Dump every live record — the backup and migration format. Offer this to the player at the end of a long session; the output re-imports with memory_import.',
      input: { token: TokenField, campaign: CampaignField },
      handler: async ({ token, campaign }) => {
        try {
          return toolResult(store.exportAll(token, campaign));
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'memory_import',
      description: 'Re-record an exported dump into a campaign (fresh ids, original timestamps kept). Import into an empty campaign name for a faithful restore; importing into a live campaign appends.',
      input: {
        token: TokenField,
        campaign: CampaignField,
        records: z.array(z.record(z.unknown())).describe('The `records` array from a memory_export payload.')
      },
      handler: async ({ token, campaign, records }) => {
        try {
          return toolResult(store.importAll(token, campaign, records));
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'state_save',
      description: 'Checkpoint mechanical state as JSON under a named key (last write per key wins). Save the party\'s character records under "party" after every levelling or loot change, and a Session.serialize payload under "session" when pausing mid-encounter. Memory remembers the story; state_save remembers the numbers.',
      input: {
        token: TokenField,
        campaign: CampaignField,
        key: z.string().describe('Checkpoint name, e.g. "party", "session", "initiative". Same grammar as campaign names.'),
        data: z.record(z.unknown()).describe('Any JSON object — party records, serialized session, tracker state.')
      },
      handler: async ({ token, campaign, key, data }) => {
        try {
          return toolResult(store.stateSave(token, campaign, key, data));
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'state_load',
      description: 'Load a checkpoint saved with state_save. At session start: state_load "party" for current character records instead of reconstructing them from prose.',
      input: {
        token: TokenField,
        campaign: CampaignField,
        key: z.string().describe('Checkpoint name passed to state_save.')
      },
      handler: async ({ token, campaign, key }) => {
        try {
          return toolResult(store.stateLoad(token, campaign, key));
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'state_list',
      description: 'List the campaign\'s checkpoints with sizes and save times.',
      input: { token: TokenField, campaign: CampaignField },
      handler: async ({ token, campaign }) => {
        try {
          return toolResult(store.stateList(token, campaign));
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'state_delete',
      description: 'Delete one checkpoint by key. Memory records are never touched by this.',
      input: {
        token: TokenField,
        campaign: CampaignField,
        key: z.string().describe('Checkpoint name to delete.')
      },
      handler: async ({ token, campaign, key }) => {
        try {
          return toolResult(store.stateDelete(token, campaign, key));
        } catch (err) { return toolError(err); }
      }
    }
  ];
}
