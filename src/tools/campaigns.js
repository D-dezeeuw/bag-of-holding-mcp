// Campaign lifecycle tools — the session-start surface.
//
// A table sitting down should be shown its ongoing campaigns FIRST: resume
// one, start a new one, or retire one. The store has known most of this all
// along (memory counts, state keys, the world pin); these tools are its
// front door, so the campaign-quickstart guide can open with one call
// instead of a scavenger hunt across memory_status and world_catalog.
//
// Deletion is the one irreversible act in the whole tool surface, so it is
// deliberately awkward: the model must pass the campaign name TWICE (the
// `confirm` parameter must match exactly), the description mandates an
// explicit player request, and the tool suggests memory_export first. An
// LLM cannot fat-finger a campaign out of existence.

import { z } from 'zod';
import { toolResult, toolError } from '../_result.js';
import { tenantFields } from './_tenant.js';

const CampaignField = z.string().describe(
  'Campaign name, e.g. "curse-of-the-fen" — the same name the memory log, state vault and world playthrough live under.'
);

/**
 * Build the campaign lifecycle tool descriptors.
 *
 * @param store        memory store (owns every per-campaign file)
 * @param pinnedToken  when set (HTTP transport), the tenant is fixed and the
 *                     `token` parameter vanishes from every schema
 */
export function campaignTools(store, pinnedToken) {
  const { tokenField, tokenOf } = tenantFields(pinnedToken);
  return [
    {
      name: 'campaign_list',
      description: 'The session-start call: every campaign in this namespace, newest activity first — memory record count, state checkpoints, world binding (which cartridge, which setting, where the party landed) and when it was last played. OPEN EVERY SITTING WITH THIS: offer the table the list ("resume one of these, or begin anew?") before doing anything else. Resuming = state_load "party" + memory_recent; starting fresh = a new campaign name + world_begin.',
      input: { ...tokenField },
      handler: async (args) => {
        try {
          const campaigns = store.campaignOverview(tokenOf(args));
          return toolResult({
            campaigns,
            hint: campaigns.length === 0
              ? 'No campaigns yet. Pick a name with the player, then world_catalog → world_begin to start their first.'
              : 'Offer these to the table by name. Resume: state_load "party" + memory_recent({ type: "session-summary" }). New: a fresh campaign name.',
          });
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'campaign_delete',
      description: 'Permanently delete a campaign — memory log, state vault, world playthrough, image budget, everything. IRREVERSIBLE. Only on the player\'s explicit, unprompted request, and only after offering memory_export as a backup. `confirm` must repeat the campaign name exactly; ask the player to say the name themselves before you call this.',
      input: {
        ...tokenField,
        campaign: CampaignField,
        confirm: z.string().describe('The campaign name again, exactly. A mismatch refuses the deletion — this is the two-key turn on an irreversible act.'),
      },
      handler: async (args) => {
        try {
          if (args.confirm !== args.campaign) {
            return toolError(new Error(
              `Refused: confirm ${JSON.stringify(args.confirm)} does not match campaign ${JSON.stringify(args.campaign)}. If the player truly wants this campaign gone, pass its exact name twice — and offer memory_export first.`));
          }
          return toolResult(store.campaignDelete(tokenOf(args), args.campaign));
        } catch (err) { return toolError(err); }
      }
    },
  ];
}
