# bag-of-holding-mcp

[![npm version](https://img.shields.io/npm/v/@zeeuw/bag-of-holding-mcp.svg?style=flat-square)](https://www.npmjs.com/package/@zeeuw/bag-of-holding-mcp)
[![coverage 100%](https://img.shields.io/badge/coverage-100%25-brightgreen.svg?style=flat-square)](#development)
[![types: built-in](https://img.shields.io/badge/types-built--in-blue.svg?style=flat-square)](./index.d.ts)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg?style=flat-square)](./LICENSE)

Model Context Protocol server for [`@zeeuw/bag-of-holding`](https://github.com/D-dezeeuw/bag-of-holding) — the SRD 5.2 rules kernel. Plug any MCP-aware AI host (Claude Desktop, Cursor, your own) into a rules-correct, replay-deterministic D&D 5e engine without trusting the model to do the math.

> The model owns the prose, the world, the pacing. The engine owns the
> dice, the checks, the combat math, and the audit trail.

## What this gives you

- **The AI can't fudge dice.** Every roll flows through the engine's seeded RNG; the engine writes an append-only `rollLog` the host can `engine_verify_log` at any time.
- **Rules-correct mechanics for free.** Ability checks, saving throws, attack rolls, damage with crit doubling, weapon mastery dispatch, conditions, exhaustion, XP — all driven by `@zeeuw/bag-of-holding`.
- **Sessions per game.** One process can serve many concurrent games, each with its own seed and rollLog.
- **Replay determinism from day one.** Save a seed + rollLog; reconstruct the exact sequence of rolls weeks later.
- **Boundary-honest.** The server is stateless w.r.t. game state. Character sheets, world memory, NPC continuity stay in the host — exactly where the engine's [boundary doc](https://github.com/D-dezeeuw/bag-of-holding/blob/main/docs/boundary.md) puts them.

## Install

```bash
npm install -g @zeeuw/bag-of-holding-mcp
```

## Use it from Claude Desktop

Add to your `claude_desktop_config.json` (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

```json
{
  "mcpServers": {
    "bag-of-holding": {
      "command": "bag-of-holding-mcp"
    }
  }
}
```

Restart Claude Desktop and the engine's 46 tools (dice, checks, combat, conditions, XP, beats, movesets, SRD lookups, sessions) appear automatically. Tell Claude "you are my DM, use bag-of-holding for every mechanic" and play.

## Tool inventory

| Category | Tools |
| --- | --- |
| **Sessions** | `engine_create_session`, `engine_destroy_session`, `engine_list_sessions`, `engine_get_roll_log`, `engine_verify_log` |
| **Dice** | `dice_roll`, `dice_roll_advantage`, `dice_roll_disadvantage`, `dice_roll_die`, `dice_parse` |
| **Checks** | `checks_ability_check`, `checks_saving_throw`, `checks_mod_from_score`, `checks_clamp_dc` |
| **Combat** | `combat_roll_initiative`, `combat_attack_roll`, `combat_damage_roll`, `combat_apply_mastery`, `combat_mastery_properties` |
| **Conditions** | `conditions_list`, `conditions_apply`, `conditions_remove`, `conditions_has`, `conditions_exhaustion_gain`, `conditions_exhaustion_reduce`, `conditions_exhaustion_set`, `conditions_exhaustion_status` |
| **XP** | `xp_level_for_xp`, `xp_next_level_threshold`, `xp_award_milestone`, `xp_thresholds`, `xp_proficiency_for_level` |
| **Movesets** | `movesets_legal` |
| **Beats** | `beats_archetype_roles`, `beats_validate`, `beats_make_empty`, `beats_thread_create`, `beats_thread_current`, `beats_is_ready`, `beats_is_complete`, `beats_thread_advance` |
| **Character** | `character_derive_sheet`, `character_skill_ability_map` |
| **SRD lookups** | `srd_list`, `srd_get`, `srd_dump` |

Every tool accepts an optional `session` parameter; omit it to use the default (unseeded) singleton, fine for one-shot mechanic queries. For an actual campaign, always `engine_create_session({ seed: <int> })` first so rolls are reproducible.

## Sessions and replay

```text
1. engine_create_session({ id: "campaign-42", seed: 12345 })
2. ...gameplay tools, all with session: "campaign-42"...
3. engine_get_roll_log({ session: "campaign-42" })  → save log to disk
4. (weeks later) engine_verify_log({ seed: 12345, log: [...] })  → { ok: true }
```

If verification fails it returns `{ ok: false, divergedAt, expected, actual }` — the exact roll the AI claims happened but the engine never produced.

## Embedding in your own host

If you're building an MCP host instead of using Claude Desktop, you can wire the same tool surface to a custom transport:

```js
import { createServer } from '@zeeuw/bag-of-holding-mcp';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const { server, sessions } = createServer();
await server.connect(new StdioServerTransport());

// Share `sessions` across multiple transports:
const { server: httpServer } = createServer({ sessions });
```

`sessions` is the in-memory session registry; programmatic code can call `sessions.create`, `sessions.rollLog`, etc. without going through MCP tool dispatch.

## Honest limits

This server exposes the engine. It does **not** give you:

- A persistent world, NPC continuity, or scene memory across turns.
- Encounter design, pacing, or DM judgment.
- Map state or positioning.
- Voice consistency for the AI DM.

Those live in the host. The engine is the math; the MCP is the wire; everything else is yours.

## Development

```bash
npm install
npm test               # node --test
npm run test:coverage  # 100/100/100 is the ongoing contract
npm run typecheck      # tsc --noEmit — drift gate for index.d.ts
```

## License

[MIT](./LICENSE). The engine it wraps is [MPL 2.0](https://github.com/D-dezeeuw/bag-of-holding/blob/main/LICENSE) (file-level copyleft); MPL travels with the engine's files regardless of what wraps them, so this permissive layer doesn't weaken the engine's protection.
