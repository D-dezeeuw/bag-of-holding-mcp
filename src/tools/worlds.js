// World tools — mount pre-generated worlds, run sessions over them, replay
// finished campaigns. The read surface is also exposed as world:// resources
// (registered in server.js) so an MCP host can browse a world with no tool
// calls at all; the tools exist for hosts that only speak tools.

import { z } from 'zod';
import { toolResult, toolError } from '../_result.js';

const WorldField = z.string().describe('World id from world_catalog, e.g. "world-1234".');
const NodeField = z.string().describe('Node id inside the world tree, e.g. "continent-0.province-1".');
const SessionField = z.string().describe('World-session id from world_begin (not an engine session).');

export function worldsTools(worlds) {
  return [
    {
      name: 'world_catalog',
      description: 'List the pre-generated world cartridges this server can mount: id, digest (the world\'s identity — model output is frozen at bake time), size, tone, threat. Empty plus a note when the server was started without a worlds directory.',
      input: {},
      handler: async () => {
        try {
          return toolResult({ worlds: worlds.list(), dir: worlds.dir, errors: worlds.errors });
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'world_begin',
      description: 'Start a fresh session over a cartridge: the same immutable base, an empty patch ledger — nothing is copied and the cartridge is never written. Returns { session, digest, start } where start is the conventional landing (the first port province).',
      input: { world: WorldField },
      handler: async ({ world }) => {
        try {
          const out = worlds.begin(world);
          return out ? toolResult(out) : toolError(new Error(`unknown world '${world}' — call world_catalog first`));
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'world_node',
      description: 'Everything the cartridge knows about one node: the tree record (name, kind, detail, climate…), its baked outline if the bake hydrated one, its blueprint slice, its crown, and every legend bound at or above it. Detail 0/1 content only — full hydration happens at the table with the host\'s own model.',
      input: { world: WorldField, node: NodeField },
      handler: async ({ world, node }) => {
        try {
          const out = worlds.node(world, node);
          return out ? toolResult(out) : toolError(new Error(`unknown node '${node}' in '${world}'`));
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
      description: 'Append play patches to a world-session\'s ledger (the campaign record). Patches follow the client ledger shape: { turn, target, scope, kind, path, to, because?, source? }. The cartridge base is never touched — this ledger IS the campaign.',
      input: {
        session: SessionField,
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
      handler: async ({ session, patches }) => {
        try {
          const out = worlds.commit(session, patches.map(p => ({ from: null, chapter: null, because: null, source: null, ...p })));
          return out ? toolResult(out) : toolError(new Error(`unknown world-session '${session}'`));
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'world_replay',
      description: 'Playback: fold the session\'s ordered patch ledger over the immutable cartridge base and return the folded state — the whole campaign, or history up to a turn with upToTurn. The same ledger over the same cartridge digest reproduces the same campaign byte for byte; spectating, post-mortems, and resume-anywhere all fall out of this one call.',
      input: {
        session: SessionField,
        upToTurn: z.number().optional().describe('Replay only patches with turn <= this. Omit for the full campaign.'),
      },
      handler: async ({ session, upToTurn }) => {
        try {
          const out = worlds.replay(session, { upToTurn });
          return out ? toolResult(out) : toolError(new Error(`unknown world-session '${session}'`));
        } catch (err) { return toolError(err); }
      }
    },
  ];
}
