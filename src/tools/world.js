// World tools — pre-generated setting content on tap.
//
// Why this exists: without a pack, an AI DM improvises a world and
// silently contradicts itself by session three. These tools hand it
// layered, internally consistent content instead — and the layering
// is enforced here, not requested politely: `gm` material only
// leaves the server when `layer: "gm"` is asked for, and the
// descriptions tell the model what that obligation means.
//
// Content vs rules: packs cite SRD creatures by name for stat
// hints; the actual math stays with the engine tools.

import { z } from 'zod';
import { toolResult, toolError } from '../_result.js';
import { worlds, getWorld, layered } from '../world/index.js';
import { rankRecords } from '../memory/search.js';

const WorldField = z.string().describe('World pack id from world_list, e.g. "greyfen-march".');

const LayerField = z.enum(['public', 'gm']).optional().describe(
  'Content layer. Default "public" omits every gm-only field. Pass "gm" only when preparing scenes as the DM — gm material is spoilers, and it must reach players through play (the breadcrumbs), never by pasting.'
);

/** Flatten a pack into searchable entries for `world_search`. */
function corpus(world, layer) {
  const entries = [];
  const add = (kind, id, name, ...texts) => {
    entries.push({ kind, id, name, text: texts.filter(Boolean).join(' '), entities: [name] });
  };

  for (const [id, r] of Object.entries(world.regions)) {
    add('region', id, r.name, r.summary, r.travel, ...r.hooks);
    for (const site of r.sites) add('site', id, site.name, site.description);
    if (layer === 'gm') add('region-secret', id, r.name, r.gm.secret);
  }
  for (const [id, f] of Object.entries(world.factions)) {
    add('faction', id, f.name, f.publicFace, f.goals, f.methods, ...Object.values(f.relations));
    if (layer === 'gm') add('faction-secret', id, f.name, f.gm.secret, f.gm.weakness);
  }
  for (const [id, n] of Object.entries(world.npcs)) {
    add('npc', id, n.name, n.role, n.voice, n.wants, n.fears, n.statHint);
    if (layer === 'gm') add('npc-secret', id, n.name, n.gm.secret, n.gm.leverage);
  }
  for (const o of world.gettingStarted.openers) add('opener', o.id, o.title, o.hook, o.firstScene);
  for (const t of world.timeline) add('timeline', t.year, t.year, t.event);
  for (const g of world.pantheon.deadGods) add('god', g.name, g.name, g.domain, g.whatRemains);
  if (layer === 'gm') {
    for (const s of world.secrets) add('secret', s.id, s.id, s.truth, ...s.breadcrumbs);
  }
  return entries;
}

/**
 * Build the world tool descriptors. No sessions, no store: packs
 * are static frozen data, so this factory takes nothing at all.
 */
export function worldTools() {
  return [
    {
      name: 'world_list',
      description: 'List the pre-generated world packs shipped with this server. Start a campaign from one instead of improvising a setting — packs stay consistent where improvisation drifts.',
      input: {},
      // No try/catch: this reads static frozen data and has no
      // failure mode — a dead catch would just be untestable code.
      handler: async () => toolResult({
        worlds: Object.values(worlds).map((w) => ({
          id: w.id, name: w.name, setting: w.setting, tagline: w.tagline, levelBand: w.levelBand
        }))
      })
    },
    {
      name: 'world_overview',
      description: 'The player-safe orientation for one world: pitch, tone, public truths, timeline, pantheon, region and faction summaries, and the ready-to-run openers. Read this before session one; drill into world_region / world_faction / world_npc as play approaches them.',
      input: { world: WorldField },
      handler: async ({ world }) => {
        try {
          const w = getWorld(world);
          return toolResult(layered({
            id: w.id, name: w.name, setting: w.setting, tagline: w.tagline,
            levelBand: w.levelBand, pitch: w.pitch, tone: w.tone, themes: w.themes,
            truths: w.truths, gettingStarted: w.gettingStarted, timeline: w.timeline,
            pantheon: w.pantheon,
            regions: Object.entries(w.regions).map(([id, r]) => ({ id, name: r.name, summary: r.summary })),
            factions: Object.entries(w.factions).map(([id, f]) => ({ id, name: f.name, publicFace: f.publicFace }))
          }, 'public'));
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'world_region',
      description: 'Full detail for one region: summary, travel, sites, hooks, resident NPC ids — plus its gm secret when layer:"gm".',
      input: {
        world: WorldField,
        region: z.string().describe('Region id from world_overview, e.g. "wickmere".'),
        layer: LayerField
      },
      handler: async ({ world, region, layer }) => {
        try {
          const w = getWorld(world);
          const r = w.regions[region];
          if (!r) throw new Error(`Unknown region: ${JSON.stringify(region)}. Available: ${Object.keys(w.regions).join(', ')}.`);
          return toolResult({ id: region, ...layered(r, layer) });
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'world_faction',
      description: 'Full detail for one faction: public face, goals, methods, relations — plus its gm secret and weakness when layer:"gm".',
      input: {
        world: WorldField,
        faction: z.string().describe('Faction id from world_overview, e.g. "lantern-court".'),
        layer: LayerField
      },
      handler: async ({ world, faction, layer }) => {
        try {
          const w = getWorld(world);
          const f = w.factions[faction];
          if (!f) throw new Error(`Unknown faction: ${JSON.stringify(faction)}. Available: ${Object.keys(w.factions).join(', ')}.`);
          return toolResult({ id: faction, ...layered(f, layer) });
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'world_npc',
      description: 'Full detail for one NPC: role, voice, wants, fears, SRD stat hint — plus their gm secret and leverage when layer:"gm". Pair with memory_record: the pack is the NPC at campaign start; your memory log is what has happened to them since.',
      input: {
        world: WorldField,
        npc: z.string().describe('NPC id from a region\'s npcs list, e.g. "maela-thrice-lit".'),
        layer: LayerField
      },
      handler: async ({ world, npc, layer }) => {
        try {
          const w = getWorld(world);
          const n = w.npcs[npc];
          if (!n) throw new Error(`Unknown npc: ${JSON.stringify(npc)}. Available: ${Object.keys(w.npcs).join(', ')}.`);
          return toolResult({ id: npc, ...layered(n, layer) });
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'world_hooks',
      description: 'Every adventure hook in the pack — the campaign openers plus each region\'s hooks — optionally filtered to one region. Reach for this when the table needs a next thread.',
      input: {
        world: WorldField,
        region: z.string().optional().describe('Restrict to one region id (openers are always included).')
      },
      handler: async ({ world, region }) => {
        try {
          const w = getWorld(world);
          if (region !== undefined && !w.regions[region]) {
            throw new Error(`Unknown region: ${JSON.stringify(region)}. Available: ${Object.keys(w.regions).join(', ')}.`);
          }
          const hooks = w.gettingStarted.openers.map((o) => ({ source: 'opener', title: o.title, hook: o.hook }));
          for (const [id, r] of Object.entries(w.regions)) {
            if (region !== undefined && id !== region) continue;
            for (const hook of r.hooks) hooks.push({ source: id, hook });
          }
          return toolResult({ hooks });
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'world_secrets',
      description: 'GM ONLY — the pack\'s secret ladder: tiered truths with the breadcrumbs that reveal them through play. Never paste these to players; run the breadcrumbs and let the table earn each tier. Hold tier 3 until the players connect the lower tiers themselves.',
      input: {
        world: WorldField,
        tier: z.number().int().min(1).max(3).optional().describe('Restrict to one tier (1 = act-one texture, 3 = campaign core).')
      },
      handler: async ({ world, tier }) => {
        try {
          const w = getWorld(world);
          const secrets = tier !== undefined ? w.secrets.filter((s) => s.tier === tier) : w.secrets;
          return toolResult({ secrets, runningNotes: w.runningNotes });
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'world_search',
      description: 'Search a pack\'s content (regions, sites, factions, NPCs, openers, timeline, pantheon — plus gm material and secrets when layer:"gm"). Use it mid-session when a name comes up and you need the canonical fact fast.',
      input: {
        world: WorldField,
        query: z.string().describe('What you need, e.g. "who runs the tollgate".'),
        limit: z.number().int().min(1).max(25).optional().describe('Max hits (default 8).'),
        layer: LayerField
      },
      handler: async ({ world, query, limit = 8, layer }) => {
        try {
          const entries = corpus(getWorld(world), layer);
          const hits = rankRecords(entries, query).slice(0, limit).map(({ index, score }) => {
            const { kind, id, name, text } = entries[index];
            return { kind, id, name, text, score: Math.round(score * 10000) / 10000 };
          });
          return toolResult({ hits, searched: entries.length });
        } catch (err) { return toolError(err); }
      }
    }
  ];
}
