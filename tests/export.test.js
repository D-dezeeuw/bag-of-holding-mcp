// The world book — one cartridge carved into an EPUB, in two honest cuts.
//
// What must hold: the player cut never carries a table secret; the GM cut
// carries exactly the marked ones; the colophon binds book to world identity;
// the export is byte-deterministic; and the tool ships it base64 with the
// ladder respected.

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { bakeCartridge } from '@zeeuw/bag-of-holding-client';
import { createWorlds } from '../src/worlds.js';
import { exportWorldEpub } from '../src/export.js';
import { worldsTools } from '../src/tools/worlds.js';
import { createMemoryStore } from '../src/memory/store.js';
import { createPlaythroughs } from '../src/playthroughs.js';

let dir, worlds, cart;
const tmp = [];
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'boh-export-'));
  tmp.push(dir);
  cart = await bakeCartridge(1234);
  fs.writeFileSync(path.join(dir, 'world-1234.json'), JSON.stringify(cart));
  worlds = createWorlds({ dir });
});
after(() => { for (const d of tmp) fs.rmSync(d, { recursive: true, force: true }); });

const bookText = async (edition) => {
  const out = await exportWorldEpub('world-1234', worlds.resolve('world-1234', 0), { edition });
  return { out, text: new TextDecoder('latin1').decode(out.bytes) };
};

test('the player cut tells stories; the GM cut tells the truth', async () => {
  const { out: player, text: pText } = await bookText('player');
  const { out: gm, text: gText } = await bookText('gm');

  assert.equal(pText.indexOf('mimetype'), 30, 'a real EPUB, mimetype first');
  assert.equal(player.filename, 'world-1234.r0.player.epub');
  assert.equal(gm.filename, 'world-1234.r0.gm.epub');

  // Both cuts carry the world: powers, wars, crowns, faces.
  const faction = cart.data.factions[0];
  const king = cart.data.npcs[0];
  for (const text of [pText, gText]) {
    assert.ok(text.includes(faction.name), 'the powers are in the book');
    assert.ok(text.includes(king.name.split(' ')[0]), 'the faces are in the book');
    assert.ok(text.includes('Colophon'));
    assert.ok(text.includes(`revision 0, digest ${cart.c}`), 'the colophon binds book to world');
  }

  // The GM-only keys: wants, menace prose, stances. (A genesis bake leaves
  // legend kernels/payoffs null — hydration's to fill — so the kernel lines
  // are asserted as never-in-the-player-cut rather than always-in-the-GM's.)
  assert.ok(gText.includes('Wants:'), 'the GM knows what the King wants');
  assert.ok(!pText.includes('Wants:'), 'the player book does not');
  assert.ok(/ land\. /.test(gText), 'the GM is told how hard each land runs');
  assert.ok(!/ land\. /.test(pText), 'the player has to feel it instead');
  assert.ok(!pText.includes('The truth of it:'));
  assert.ok(!pText.includes('What it pays:'));
  // Every crown's stance line is GM-only (genesis leaves stanceOnThreat null,
  // so assert via factionRelations stances instead — those always exist for
  // held crowns).
  const sovereignLine = /: sovereign\./;
  assert.match(gText, sovereignLine, 'the GM sees who truly holds the throne');
  assert.ok(!sovereignLine.test(pText), 'the player must earn that knowledge');
});

test('same world, same revision, same bytes — and the two cuts differ', async () => {
  const a = await exportWorldEpub('world-1234', worlds.resolve('world-1234', 0), { edition: 'gm' });
  const b = await exportWorldEpub('world-1234', worlds.resolve('world-1234', 0), { edition: 'gm' });
  assert.deepEqual(a.bytes, b.bytes, 'byte-deterministic');
  const p = await exportWorldEpub('world-1234', worlds.resolve('world-1234', 0), { edition: 'player' });
  assert.notDeepEqual(p.bytes, a.bytes, 'distinct uuid per cut');
  await assert.rejects(exportWorldEpub('x', worlds.resolve('world-1234', 0), { edition: 'director' }),
    /unknown edition/);
});

test('world_export ships it base64, resolves the ladder, refuses the unservable', async () => {
  const pt = createPlaythroughs(worlds,
    createMemoryStore({ dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'boh-export-store-')), tokenHashes: [] }));
  const byName = new Map(worldsTools(worlds, pt).map((t) => [t.name, t]));
  const r = await byName.get('world_export').handler({ world: 'world-1234', edition: 'gm' });
  const out = r.structuredContent;
  assert.equal(out.filename, 'world-1234.r0.gm.epub');
  assert.equal(out.digest, cart.c);
  assert.ok(out.chapters.includes('The Powers') && out.chapters.includes('Colophon'));
  const bytes = Buffer.from(out.epubBase64, 'base64');
  assert.equal(bytes.length, out.bytes);
  assert.equal(bytes.subarray(30, 38).toString(), 'mimetype');

  const bad = await byName.get('world_export').handler({ world: 'world-1234', revision: 5 });
  assert.equal(bad.isError, true);
  const unknown = await byName.get('world_export').handler({ world: 'world-9' });
  assert.equal(unknown.isError, true);
});
