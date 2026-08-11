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
// Two tenancy modes, and the tool schemas differ between them:
//
//   - stdio (local): the token is an optional tool parameter, so a
//     single desktop process can serve several tables.
//   - HTTP (deployed): the tenant is pinned by the transport — the
//     token lives in the URL path — and the `token` parameter is
//     removed from every schema below. The model then cannot see,
//     supply, or leak it, and cannot reach another tenant's shelf
//     by guessing a string.
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
 *
 * @param store         memory store (see src/memory/store.js)
 * @param pinnedToken   when set, the tenant is fixed by the
 *                      transport: `token` vanishes from every input
 *                      schema and this value is used instead.
 */
export function memoryTools(store, pinnedToken) {
  const pinned = typeof pinnedToken === 'string' && pinnedToken !== '';
  // Spread into each schema: `{}` when pinned, so the field is
  // absent rather than present-and-ignored. An ignored parameter
  // the model can still fill in is an invitation to leak a secret
  // into the transcript.
  const tokenField = pinned ? {} : { token: TokenField };
  const tokenOf = pinned ? () => pinnedToken : (args) => args.token;

  return [
    {
      name: 'memory_status',
      description: 'Orient yourself: which namespace you are on, where data lives, whether the server requires tokens, the semantic-search state (embeddings sidecar + Qdrant, or lexical-only), and every campaign in the namespace with record/state counts. Call this once at the start of a session before recording.',
      input: { ...tokenField },
      handler: async (args) => {
        try {
          return toolResult(store.info(tokenOf(args)));
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'memory_record',
      description: 'Append one memory to the campaign\'s permanent log. Record at scene ends, first meetings, promises made, and always one session-summary before ending a session. Write text in third person, past tense, self-contained (it will be read months later with no context). Name every proper noun in `entities` — that is what search keys on. Returns the stored record with its id.',
      input: {
        ...tokenField,
        campaign: CampaignField,
        type: TypeField,
        text: z.string().describe('The memory itself — 1-3 sentences, self-contained, third person past tense. Facts, not transcript.'),
        entities: z.array(z.string()).optional().describe('Proper nouns involved: NPC names, places, factions, item names. Double-weighted in search — always fill this.'),
        tags: z.array(z.string()).optional().describe('Free labels for filtering, e.g. ["act-1", "secret", "combat"].'),
        importance: z.number().int().min(1).max(5).optional().describe('1 trivia … 5 campaign-defining. Default 3. Reserve 5 for facts that change the campaign\'s direction.')
      },
      handler: async (args) => {
        try {
          const { campaign, type, text, entities, tags, importance } = args;
          return toolResult(store.record(tokenOf(args), campaign, { type, text, entities, tags, importance }));
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'memory_search',
      description: 'Query the campaign log. Lexical BM25 always runs (entities and tags double-weighted); with the semantic sidecars up (Qwen embeddings + Qdrant, see memory_status) results are hybrid — the `retrieval` field says which you got, and paraphrased queries ("the smuggler kid with the ledger") then work as well as exact names. Call it whenever a name resurfaces, a scene opens in a known place, or before improvising a fact you might have already established. Empty hits honestly means the log has nothing — do not invent a memory.',
      input: {
        ...tokenField,
        campaign: CampaignField,
        query: z.string().describe('What you need to recall, e.g. "Maela debt lantern court".'),
        limit: z.number().int().min(1).max(50).optional().describe('Max hits (default 8).'),
        type: TypeField.optional(),
        entities: z.array(z.string()).optional().describe('Restrict to records naming at least one of these entities (case-insensitive).')
      },
      handler: async (args) => {
        try {
          const { campaign, query, limit, type, entities } = args;
          return toolResult(await store.search(tokenOf(args), campaign, { query, limit, type, entities }));
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'memory_recent',
      description: 'Newest records first — the session-start recap read. Combine with type: "session-summary" to reload where the story left off, then memory_search for specifics as they come up.',
      input: {
        ...tokenField,
        campaign: CampaignField,
        limit: z.number().int().min(1).max(100).optional().describe('How many records (default 10).'),
        type: TypeField.optional()
      },
      handler: async (args) => {
        try {
          const { campaign, limit, type } = args;
          return toolResult(store.recent(tokenOf(args), campaign, { limit, type }));
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'memory_forget',
      description: 'Tombstone a record by id (it stops appearing in search/recent/export; the underlying log stays append-only). Use for corrections — record the corrected fact first, then forget the wrong one.',
      input: {
        ...tokenField,
        campaign: CampaignField,
        id: z.string().describe('Record id from memory_record / memory_search, e.g. "m-17".')
      },
      handler: async (args) => {
        try {
          return toolResult(store.forget(tokenOf(args), args.campaign, args.id));
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'memory_export',
      description: 'Dump every live record — the backup and migration format. Offer this to the player at the end of a long session; the output re-imports with memory_import.',
      input: { ...tokenField, campaign: CampaignField },
      handler: async (args) => {
        try {
          return toolResult(store.exportAll(tokenOf(args), args.campaign));
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'memory_import',
      description: 'Re-record an exported dump into a campaign (fresh ids, original timestamps kept). Import into an empty campaign name for a faithful restore; importing into a live campaign appends.',
      input: {
        ...tokenField,
        campaign: CampaignField,
        records: z.array(z.record(z.unknown())).describe('The `records` array from a memory_export payload.')
      },
      handler: async (args) => {
        try {
          return toolResult(store.importAll(tokenOf(args), args.campaign, args.records));
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'state_save',
      description: 'Checkpoint mechanical state as JSON under a named key (last write per key wins). Save the party\'s character records under "party" after every levelling or loot change, and a Session.serialize payload under "session" when pausing mid-encounter. Memory remembers the story; state_save remembers the numbers.',
      input: {
        ...tokenField,
        campaign: CampaignField,
        key: z.string().describe('Checkpoint name, e.g. "party", "session", "initiative". Same grammar as campaign names.'),
        data: z.record(z.unknown()).describe('Any JSON object — party records, serialized session, tracker state.')
      },
      handler: async (args) => {
        try {
          return toolResult(store.stateSave(tokenOf(args), args.campaign, args.key, args.data));
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'state_load',
      description: 'Load a checkpoint saved with state_save. At session start: state_load "party" for current character records instead of reconstructing them from prose.',
      input: {
        ...tokenField,
        campaign: CampaignField,
        key: z.string().describe('Checkpoint name passed to state_save.')
      },
      handler: async (args) => {
        try {
          return toolResult(store.stateLoad(tokenOf(args), args.campaign, args.key));
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'state_list',
      description: 'List the campaign\'s checkpoints with sizes and save times.',
      input: { ...tokenField, campaign: CampaignField },
      handler: async (args) => {
        try {
          return toolResult(store.stateList(tokenOf(args), args.campaign));
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'state_delete',
      description: 'Delete one checkpoint by key. Memory records are never touched by this.',
      input: {
        ...tokenField,
        campaign: CampaignField,
        key: z.string().describe('Checkpoint name to delete.')
      },
      handler: async (args) => {
        try {
          return toolResult(store.stateDelete(tokenOf(args), args.campaign, args.key));
        } catch (err) { return toolError(err); }
      }
    }
  ];
}
