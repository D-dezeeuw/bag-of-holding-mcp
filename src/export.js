// src/export.js — the world book: a cartridge (at a revision) carved into an
// EPUB, in two honest cuts.
//
// The player cut is safe to hand across the table: geography, legends as
// stories, crowns as public fact, the powers and their wars as anyone in a
// harbor tavern could recount them. The GM cut adds exactly the keys the
// generator marks as table-private — legend.kernelOfTruth, legend.payoff,
// crown.stanceOnThreat, the npc's wants, and each land's menace rendered
// through MENACE_SIGNPOSTS (never menaceHints(), which appends
// generator-steering text that has no business on a reader's page).
//
// Every book ends in a colophon carrying { worldId, revision, digest }, so a
// book and the campaign it documents can be proven to agree. With the uuid
// and timestamp derived from that same identity, the export is
// byte-deterministic: same world, same revision, same book.

import { buildEpub, MENACE_SIGNPOSTS } from '@zeeuw/bag-of-holding-client';

const cap = (s) => (s ? s[0].toUpperCase() + s.slice(1) : s);
const names = (data, ids) => (ids ?? []).map((id) => data.geo.nodes[id]?.name ?? id);
const list = (xs) => xs.filter(Boolean).join(', ');

function powersChapter(data, edition) {
  const lines = [];
  const factions = data.factions ?? [];
  const npcs = data.npcs ?? [];
  const byId = new Map(factions.map((f) => [f.id, f]));
  if (!factions.length) return { heading: 'The Powers', text: 'No power has yet raised a banner here.' };

  for (const f of factions) {
    const face = npcs.find((n) => n.leads === f.id);
    lines.push(`${f.name}${f.archetype ? ` — ${f.archetype}` : ''}.`);
    if (f.territory?.length) lines.push(`Holds ${list(names(data, f.territory))}.`);
    if (f.allies?.length) lines.push(`Allied with ${list(f.allies.map((id) => byId.get(id)?.name ?? id))}.`);
    if (f.enemies?.length) lines.push(`At odds with ${list(f.enemies.map((id) => byId.get(id)?.name ?? id))}.`);
    if (face) {
      lines.push(`Its face is ${face.name}, who ${face.voice}.`);
      if (edition === 'gm' && face.wants?.length) {
        lines.push(`Wants: ${list(face.wants)}.`);
      }
    }
    lines.push('');
  }

  for (const war of data.warState?.wars ?? []) {
    const [a, b] = war.between.map((id) => byId.get(id)?.name ?? id);
    lines.push(`${a} and ${b} are at war — ${war.intensity}, over ${war.cause}. It is felt in ${list(names(data, war.front))}.`);
  }
  return { heading: 'The Powers', text: lines.join('\n') };
}

function continentChapters(data, edition) {
  const chapters = [];
  for (const cId of data.continents) {
    const node = data.geo.nodes[cId];
    const slice = data.slices?.[cId];
    const text = [
      data.outlines?.[cId]?.digest ?? node.hook ?? '',
      // Menace is a GM fact: the signpost prose tells a DM how hard this
      // land should FEEL, which is exactly what a player book must let the
      // table discover instead of print.
      edition === 'gm' && slice?.menace ? `${cap(slice.menace)} land. ${MENACE_SIGNPOSTS[slice.menace] ?? ''}`.trim() : '',
      `Its provinces: ${list(names(data, data.provinces.filter((p) => data.geo.nodes[p]?.parent === cId)))}.`,
    ].filter(Boolean).join('\n\n');
    chapters.push({ heading: node.name, text });

    const legends = (data.lore?.legends ?? []).filter((l) => l.id.startsWith(`${cId}.`));
    if (legends.length) {
      const lore = legends.map((l) => [
        `${l.title}${l.era ? ` (${(data.lore.eras ?? []).find((e) => e.id === l.era)?.name ?? l.era})` : ''}.`,
        l.sites?.length ? `Told of ${list(names(data, l.sites))}.` : '',
        l.hooks?.length ? `They say: ${l.hooks.join(' · ')}` : '',
        ...(edition === 'gm' ? [
          l.kernelOfTruth ? `The truth of it: ${l.kernelOfTruth}` : '',
          l.payoff ? `What it pays: ${l.payoff}` : '',
        ] : []),
      ].filter(Boolean).join('\n')).join('\n\n');
      chapters.push({ heading: `Legends of ${node.name}`, text: lore });
    }
  }
  return chapters;
}

function crownsChapter(data, edition) {
  const lines = [];
  const factions = new Map((data.factions ?? []).map((f) => [f.id, f]));
  for (const crown of data.lore?.crowns ?? []) {
    const seatProvince = crown.id.replace(/\.crown$/, '');
    const face = (data.npcs ?? []).find((n) => n.seatOf === crown.id);
    lines.push(`${crown.name}, ${crown.title} of ${data.geo.nodes[seatProvince]?.name ?? seatProvince} — ${crown.legitimacy}.`);
    if (face) lines.push(`Seated: ${face.name}.`);
    if (edition === 'gm') {
      if (crown.stanceOnThreat) lines.push(`${cap(crown.stanceOnThreat)}.`);
      for (const rel of crown.factionRelations ?? []) {
        lines.push(`${factions.get(rel.factionId)?.name ?? rel.factionId}: ${rel.stance}.`);
      }
    }
    lines.push('');
  }
  return { heading: 'Crowns and Thrones', text: lines.join('\n') || 'No throne stands here.' };
}

/**
 * Carve one resolved world into EPUB chapters and build the book.
 * `resolution` is the registry's resolve() answer: { revision, data, digest }.
 * Returns { bytes: Uint8Array, filename, chapters, edition }.
 */
export async function exportWorldEpub(worldId, resolution, { edition = 'player' } = {}) {
  if (edition !== 'player' && edition !== 'gm') {
    throw new Error(`unknown edition '${edition}' — 'player' or 'gm'`);
  }
  const { data, revision, digest } = resolution;
  const title = data.geo.nodes[data.continents[0]]?.name ?? worldId;

  const overview = {
    heading: title,
    text: [
      `${data.continents.length} continent${data.continents.length === 1 ? '' : 's'}, ${data.provinces.length} provinces.`,
      data.lore?.eras?.length ? `${data.lore.eras.length} ages are remembered, oldest first: ${list(data.lore.eras.map((e) => e.name))}.` : '',
    ].filter(Boolean).join('\n\n'),
  };
  const colophon = {
    heading: 'Colophon',
    text: [
      `${edition === 'gm' ? 'The game master\'s cut — table secrets included.' : 'The player\'s cut — safe to hand across the table.'}`,
      `World ${worldId}, revision ${revision}, digest ${digest}.`,
      'A campaign pinned to this digest replays over exactly the content of this book.',
    ].join('\n'),
  };

  const chapters = [
    overview,
    powersChapter(data, edition),
    ...continentChapters(data, edition),
    crownsChapter(data, edition),
    colophon,
  ];

  // Identity-derived uuid + a fixed timestamp: same world+revision+edition,
  // same bytes. The digest is FNV-1a/32 (8 hex chars) — folded into the
  // uuid's tail with the revision so the two cuts and two revisions of one
  // world get distinct-but-stable identifiers.
  const tail = `${digest}${edition === 'gm' ? '01' : '00'}${String(revision).padStart(2, '0')}`.padStart(12, '0').slice(0, 12);
  const blob = await buildEpub({
    title,
    subtitle: edition === 'gm' ? 'The World Book — GM cut' : 'The World Book',
    lang: 'en',
    chapters,
    tone: data.slices?.world?.tone,
    tagline: null,
    cover: false,
    uuid: `00000000-0000-4000-8000-${tail}`,
    modified: '2026-01-01T00:00:00Z',
  });
  return {
    bytes: new Uint8Array(await blob.arrayBuffer()),
    filename: `${worldId}.r${revision}.${edition}.epub`,
    chapters: chapters.map((c) => c.heading),
    edition,
  };
}
