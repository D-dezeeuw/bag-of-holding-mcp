// World tools — mount pre-generated worlds, run playthroughs over them,
// replay finished campaigns. The read surface is also exposed as world://
// resources (registered in server.js) so an MCP host can browse a world with
// no tool calls at all; the tools exist for hosts that only speak tools.
//
// A playthrough is addressed by CAMPAIGN NAME — the same name the memory
// log, the state vault and the image gate already use — and persists in the
// token namespace beside them. The old `ws-N` session ids were process-local
// (and, over the stateless HTTP transport, request-local: world_begin
// followed by world_commit could not work at all); campaign-as-id is what
// makes a playthrough survive both.

import { z } from 'zod';
import { toolResult, toolError } from '../_result.js';
import { tenantFields } from './_tenant.js';

const WorldField = z.string().describe('World id from world_catalog, e.g. "world-1234".');
const NodeField = z.string().describe('Node id inside the world tree, e.g. "continent-0.province-1".');
const CampaignField = z.string().describe(
  'Campaign name, e.g. "curse-of-the-fen" — the same one your memory_record and state_save calls use. The playthrough (pin + patch ledger) persists under it.'
);

/**
 * Build the world tool descriptors.
 *
 * @param worlds        read-only cartridge registry (src/worlds.js)
 * @param playthroughs  the campaign↔world binding layer (src/playthroughs.js)
 * @param pinnedToken   when set (HTTP transport), the tenant is fixed and the
 *                      `token` parameter vanishes from every schema, exactly
 *                      as it does for the memory and image tools
 */
export function worldsTools(worlds, playthroughs, pinnedToken) {
  const { tokenField, tokenOf } = tenantFields(pinnedToken);
  return [
    {
      name: 'world_catalog',
      description: 'List the pre-generated world cartridges this server can mount: id, digest (the world\'s identity — model output is frozen at bake time), size, setting (which genre it was baked under; null = the library defaults), tone, threat. Empty plus a note when the server was started without a worlds directory.',
      input: {},
      handler: async () => {
        try {
          return toolResult({ worlds: worlds.list(), dir: worlds.dir, errors: worlds.errors });
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'world_begin',
      description: 'Bind this campaign to a cartridge and start playing over it: the same immutable base, an empty patch ledger — nothing is copied and the cartridge is never written. The binding persists on disk under the campaign name (it survives restarts and reconnects) and records the world\'s digest as a pin. One campaign, one world: beginning twice is refused. A new campaign defaults to the LATEST revision on the shelf; pass `revision` to pin an earlier one explicitly. Either way the campaign stays pinned there forever — later revisions never move a running game. Returns { campaign, worldId, revision, digest, setting, start } — `setting` names the genre so a host knows what voice to write in, `start` is the conventional landing (the first port province), frozen into the pin.',
      input: {
        ...tokenField, campaign: CampaignField, world: WorldField,
        revision: z.number().int().min(0).optional().describe('Pin this exact revision instead of the latest. world_revisions shows the ladder.'),
      },
      handler: async (args) => {
        try {
          return toolResult(playthroughs.begin(tokenOf(args), args.campaign, args.world,
            { revision: args.revision ?? null }));
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'world_upgrade',
      description: 'Move this campaign\'s pin up the revision ladder — the ONLY way a running game ever changes revision. Explicit, audited (the pin records every upgrade), forward-only, and ALL-OR-NOTHING: every intervening revision is classified against this campaign\'s own pinned content, every edit is checked against what the table has actually observed, and one conflict refuses the whole upgrade with the full list — nothing half-applies. Declining is a no-op forever; a pin is a fine place to stay. The play ledger is never touched. Pass dryRun to see the verdict without moving the pin. Ask the table before upgrading — this changes their world\'s canon, even when it changes nothing they have seen.',
      input: {
        ...tokenField,
        campaign: CampaignField,
        toRevision: z.number().int().min(1).describe('The revision to move to. world_revisions shows the ladder.'),
        dryRun: z.boolean().optional().describe('Check and report without moving the pin.'),
      },
      handler: async (args) => {
        try {
          return toolResult(playthroughs.upgrade(tokenOf(args), args.campaign, args.toRevision,
            { dryRun: args.dryRun ?? false }));
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'world_revisions',
      description: 'The revision ladder for one world: which revisions this shelf can serve ([0] for a base with no revisions), and which is latest. A revision is a published delta over the base cartridge — running campaigns stay pinned to the revision they began on; new campaigns default to latest. A ladder shorter than the files on disk means a gap or a base-digest mismatch truncated it — the registry errors say which.',
      input: { world: WorldField },
      handler: async ({ world }) => {
        try {
          const revisions = worlds.revisionsOf(world);
          if (!revisions) return toolError(new Error(`unknown world '${world}'`));
          return toolResult({ world, revisions, latest: revisions.at(-1) });
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'world_powers',
      description: 'The world\'s power layer in one read: every faction (territory, allies, enemies), the war state (who fights whom, how hot, over what, and the front provinces — null means honest peace), and the world npcs — the faces of the powers, each linked by id to the crown it holds (`seatOf`) and the faction it leads (`leads`). Read this once at session start to know whose war the party is walking into; the ids are the same ones beats cast and payoffs bind to.',
      input: { world: WorldField },
      handler: async ({ world }) => {
        try {
          const out = worlds.powers(world);
          return out ? toolResult(out) : toolError(new Error(`unknown world '${world}'`));
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'world_node',
      description: 'Everything the cartridge knows about one node: the tree record (name, kind, detail, climate…), its baked outline if the bake hydrated one, its blueprint slice, its crown and the face seated on it (the world npc whose seatOf names this crown), the factions whose territory covers it, the wars whose front runs through it, and every legend bound at or above it. Detail 0/1 content only — full hydration happens at the table with the host\'s own model. Pass `campaign` when the party is actually THERE: the node is then recorded as observed, which is what protects it from being rewritten under the table by a future world revision.',
      input: { ...tokenField, world: WorldField, node: NodeField, campaign: CampaignField.optional() },
      handler: async (args) => {
        try {
          const out = worlds.node(args.world, args.node);
          if (!out) return toolError(new Error(`unknown node '${args.node}' in '${args.world}'`));
          if (args.campaign) playthroughs.observeRead(tokenOf(args), args.campaign, args.node);
          return toolResult(out);
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'world_lineage',
      description: 'A node\'s ancestry root-down — continent, then province — each with its best available digest. This is the lineage context a host feeds its hydration calls so a region on one continent keeps feeling like that continent.',
      input: { world: WorldField, node: NodeField },
      handler: async ({ world, node }) => {
        try {
          const out = worlds.lineage(world, node);
          return out ? toolResult({ lineage: out }) : toolError(new Error(`unknown node '${node}' in '${world}'`));
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'world_commit',
      description: 'Append play patches to the campaign\'s world ledger (the campaign record). Patches follow the client ledger shape: { turn, target, scope, kind, path, to, because?, source? }. Every patch is validated on the way in — bad paths, bad targets, and canon that contradicts recorded mechanical state are rejected individually with reasons while the rest of the batch lands, so check `rejected` in the result. The cartridge base is never touched — this ledger IS the campaign.',
      input: {
        ...tokenField,
        campaign: CampaignField,
        patches: z.array(z.object({
          turn: z.number(),
          target: z.string(),
          scope: z.enum(['local', 'regional', 'world']).default('local'),
          kind: z.enum(['mechanical', 'canon']).default('canon'),
          path: z.string(),
          to: z.unknown(),
          because: z.string().nullish(),
          source: z.string().nullish(),
        })).describe('Ordered patches to append.'),
      },
      handler: async (args) => {
        try {
          const raw = args.patches.map(p => ({ from: null, chapter: null, because: null, source: null, ...p }));
          return toolResult(playthroughs.commit(tokenOf(args), args.campaign, raw));
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'world_replay',
      description: 'Playback: fold the campaign\'s ordered patch ledger over the immutable cartridge base and return the folded state — the whole campaign, or history up to a turn with upToTurn. Cartridge entities replay over their real baked content (a renamed province replays with its name, slice and your changes together); entities the table invented fold from their patches alone. The same ledger over the same cartridge digest reproduces the same campaign byte for byte.',
      input: {
        ...tokenField,
        campaign: CampaignField,
        upToTurn: z.number().optional().describe('Replay only patches with turn <= this. Omit for the full campaign.'),
      },
      handler: async (args) => {
        try {
          const out = playthroughs.replay(tokenOf(args), args.campaign, { upToTurn: args.upToTurn });
          return out ? toolResult(out) : toolError(new Error(`campaign "${args.campaign}" has no world; call world_begin first`));
        } catch (err) { return toolError(err); }
      }
    },
  ];
}
