// SRD lookups — read-only access to the six content registries
// the engine ships: species, classes, backgrounds, feats, spells,
// items. Plugin content added at session creation appears
// transparently here.
//
// One generic tool (`srd_get`/`srd_list`) instead of six per-
// registry tools: the AI doesn't gain anything from a more
// granular surface, and a generic kind+id keeps the tool count
// down (Claude has a limit on tool inventory size that grows
// faster than this server's appetite for it).

import { z } from 'zod';
import { toolResult, toolError } from '../_result.js';

const SessionField = z.string().optional().describe('Session id; omit for default singleton.');
const RegistryKind = z.enum(['species', 'classes', 'backgrounds', 'feats', 'spells', 'items']).describe('Which SRD registry to read.');

export function srdTools(sessions) {
  return [
    {
      name: 'srd_list',
      description: 'List the ids in an SRD registry. Returns { kind, ids }. Cheap — does not include the records themselves.',
      input: { kind: RegistryKind, session: SessionField },
      handler: async ({ kind, session }) => {
        try {
          const engine = sessions.get(session);
          return toolResult({ kind, ids: Object.keys(engine[kind]) });
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'srd_get',
      description: 'Fetch a single record from an SRD registry. Returns the full record or { found: false } if unknown.',
      input: {
        kind: RegistryKind,
        id: z.string().describe('Record id (e.g. "elf", "fighter", "longsword").'),
        session: SessionField
      },
      handler: async ({ kind, id, session }) => {
        try {
          const engine = sessions.get(session);
          const record = engine[kind][id];
          if (record === undefined) return toolResult({ found: false, kind, id });
          return toolResult({ found: true, kind, id, record });
        } catch (err) { return toolError(err); }
      }
    },
    {
      name: 'srd_dump',
      description: 'Return every record in an SRD registry. Heavy — use srd_list + srd_get when you only need a subset. Useful for one-shot "show me everything" UIs.',
      input: { kind: RegistryKind, session: SessionField },
      handler: async ({ kind, session }) => {
        try {
          const engine = sessions.get(session);
          return toolResult({ kind, records: { ...engine[kind] } });
        } catch (err) { return toolError(err); }
      }
    }
  ];
}
