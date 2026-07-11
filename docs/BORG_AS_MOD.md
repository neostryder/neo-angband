# The Borg as a Bundled Mod - Scope and Plan

> STATUS: SCOPING (2026-07-11). This is the plan of record for task P8 (the
> Borg). It supersedes any earlier framing of the Borg as an in-core subsystem:
> the Borg ships as a BUNDLED MOD built on the mod framework's perceive/act API,
> not as core code. Its behavior is a faithful port of Angband 4.2.6's `borg/`.
> The same agent API that hosts it is the contract any third-party agent mod
> uses to drive the game. Nothing here is built yet; this defines what to build.

## 1. The decision

The procedural Borg is packaged as a **bundled mod**, not ported into
`packages/core`. Three things follow:

1. **It behaves exactly as the original.** This is a faithful port of the
   upstream `borg/` autoplayer (Angband 4.2.6), not a reimplementation.
2. **It is the reference implementation of the agent API.** The Borg is the
   most demanding possible consumer of a "read the whole game, drive every
   command" interface. Building it as a mod forces the mod framework to expose
   a complete perceive/act surface - and a faithful Borg that plays correctly
   is the acceptance test that the surface is complete.
3. **Every borg is a mod.** Third-party and AI-driven agents that play the
   game are mods on the same API. The framework, not the Borg, owns the
   perceive/act contract; agents are interchangeable consumers of it.

## 2. What the Borg is, in one paragraph

The Borg is a perceive -> think -> act agent. Upstream it hooks the game at
`inkey_hack` (`borg.c`): when the game asks for a keypress, the Borg perceives
the current world, decides, and returns queued keystrokes. Its perception is a
**hybrid**: about 90% direct reads of the game's own structures (inventory,
equipment, stores, spellbooks, the dungeon grid, monster identity via
`r_info[]`, object kinds via `k_info[]`, player race/class data) - the code
comments openly call these "cheats" - plus about 10% terminal scraping for the
two things not otherwise available: the **message/prompt line** (row 0) and the
**presence and motion of monsters/objects** on the visible panel. It acts
entirely by **emulating keypresses**, including replaying the game's targeting
cursor UI to aim. From this it maintains an internal model (`borg_grid[][]`,
`borg_kill[]`, `borg_take[]`, `borg_item[]`, a ~380-entry `BI_*` trait vector,
a "power" score) and runs a fixed priority ladder each turn (avoid death ->
recover -> fight -> optimize gear -> grab loot -> explore -> descend).

## 3. The perceive/act surface the Borg needs

This is the contract, distilled from what the upstream Borg actually consumes
and emits. Every entry corresponds to concrete upstream code.

### READ surface (perceive)
- **Player**: stats and sustains, cur/max HP and SP, cur/max level, cur/max
  depth, gold, food, speed, AC, to-hit/to-dam, blows, shots, light radius, all
  status afflictions (blind/confused/afraid/poisoned/cut/stun/paralyzed/etc.),
  infravision, resting flag, dead flag and cause-of-death, shapechange, winner
  state, class/race identity.
- **Race/class tables**: skills, attack multiplier, min weapon weight, max
  attacks, infravision; spellbook layout and per-spell level/mana/fail/status
  (learned/worked/forgotten).
- **Items** (carried, floor, and store): tval/sval/pval, weight, AC, dice,
  bonuses, object flags, modifiers, element info, brands, slays, curses,
  ego/artifact/activation, aware/ident state, value, inscription.
- **Dungeon grid**: per-tile feature, lighting (dark/lit/glow), in-view/known,
  trap and trap flags, glyph, web, shop number, permanent vs. diggable wall,
  floor object kind, monster index; bounds and the visible panel.
- **Monsters**: presence and screen glyph at a grid; a stable id; race index ->
  race flags and spell flags; speed/HP-estimate/level; awake/afraid/confused/
  stunned/poisoned.
- **Stores/home**: stock as item records plus prices; food/fuel availability.
- **Globals**: engine size/limit constants, feature/kind/trap tables, ignore
  and option settings.
- **Message stream**: the game messages produced since the last decision.
- **Pending prompt**: a structured descriptor of any interactive prompt the
  game is waiting on (-more-, yes/no, direction, target, store menu).
- **Turn counter**.

### WRITE surface (act) - as semantic verbs
move / melee / fire / throw / aim-wand / zap-rod / use-staff / activate /
cast / quaff / read / eat / wear / takeoff / drop / pickup / destroy / rest /
ascend / descend / tunnel / open / close / disarm / **set-target (by monster
id or location)** / shop-buy / shop-sell / shop-exit / answer-prompt /
save-game.

## 4. How the port already fits (and improves on the original)

The port exposes, in nascent form, exactly the seams a mod-borg needs - and it
does so more cleanly than upstream, because it never had a terminal to scrape
or a keymap to replay.

| Need | Upstream Borg mechanism | Port seam today |
|---|---|---|
| Read game state | ~90% struct "cheats" | `GameState` (`game/context.ts`): `chunk` (map), `actor.player`, `gear`, `monsters[]`, `groups[]`, `floor`, `traps`, `target`, `lore`, `ignore`, `options`, `z`, brands/slays. A structured read-model, no cheating required. |
| Know what the player knows | reads `cave` + own mark bits | `known` (`KnownMap`): the player's remembered/detected terrain and objects - the exact "what do I know" view the Borg reasons over. |
| Read messages | scrape terminal row 0 | the message system (`msg.ts`): a typed message stream, no scraping. |
| Answer prompts | scrape row 0, guess | the command model is non-interactive: a `PlayerCommand` carries its own args (direction, target, item), so there is no separate prompt to answer. |
| Aim at a target | replay `*`,`p`,cursor,`5` keystrokes (fragile) | `target.ts` `TargetState`: set a target by monster or grid directly. |
| Issue an action | emulate keypresses via `inkey_hack` | the moddable `ActionRegistry` (`game/player-turn.ts`, "built-ins can be replaced and new codes added") and the typed `CommandQueue` (`cmd.ts`, codes 1:1 with upstream). Semantic commands, no key emulation. |
| The decision hook | game calls `inkey()` -> Borg | `runGameLoop` returns `LOOP_STATUS.INPUT` when `nextCommand()` yields null. That return is the perceive->think->act boundary where a controller supplies the next command. |

The two most fragile parts of the upstream Borg - **row-0 screen scraping** and
**targeting-cursor keystroke replay** - simply do not exist in the port. The
mod-borg reads a typed message stream and sets a target by id. This is why the
port is a better host for the Borg than the original codebase.

## 5. The mod/agent API to build

The agent API is three capability-gated facades over the seams in section 4,
consistent with the ratified mod model (`docs/modding/MOD_LIFECYCLE.md`, which
already defines the `command:add`, `event:turn-start`, and `state:*.read`
capabilities and names an external AI agent as a supported plugin case).

1. **Perceive facade** - a stable, versioned, READ-ONLY view of `GameState`
   covering the section-3 read surface, plus the typed message stream and the
   turn counter. It must survive a plugin sandbox boundary (a serializable
   snapshot or a read-only proxy). Capability: `state:*.read`.
2. **Act facade** - register actions into the `ActionRegistry` and/or push
   typed commands, expressed as the section-3 semantic verbs (including
   set-target by id/grid). Capability: `command:add`.
3. **Controller seam** - register a plugin as the `nextCommand` provider,
   invoked at the `LOOP_STATUS.INPUT` boundary each time the game needs a
   command. The procedural Borg is deterministic (it draws from the seeded
   RNG); an AI-driven agent declares `nondeterministic: true` and core flips
   the save's determinism mode (per the mod determinism ratchet).

The same frozen facade is what every other agent mod builds on. Freezing it is
the point of building the Borg first: the Borg exercises the entire surface, so
if the Borg plays faithfully, the surface is complete.

## 6. The gap

The mod framework is fully **designed** (`docs/MODS.md`,
`docs/modding/MOD_LIFECYCLE.md`) but **not built**: there is no plugin runtime,
no sandbox, no capability enforcement, no read-only `GameState` facade, and no
controller registration. Borg-as-mod therefore depends on building that
substrate first. In the plan this is P7 (mod ecosystem hardening); P8 (the
Borg) rides on it. The Borg is the forcing function that makes the substrate
concrete and correct rather than speculative.

## 7. The Borg port plan

The upstream `borg/` is 59 `.c` files, ~64,000 lines. Grouped and tiered by
porting difficulty:

### Subsystem groups
- **Init / core / io** (`borg.c`, `borg-init.c`, `borg-util.c`, `borg-log.c`,
  `borg-io.c`, `borg-messages*.c`, `borg-reincarnate.c`) - hook point, config,
  logging, the message/prompt channel. In the port, the hook becomes the
  controller seam and the message channel becomes a typed subscription.
- **Perception / state-model** (`borg-update.c`, `borg-trait*.c`, `borg-cave*.c`,
  `borg-inventory.c`, `borg-item*.c`, `borg-power.c`, `borg-prepared.c`) -
  builds the internal model and the `BI_*` trait vector + power score from the
  perceive facade.
- **Item management** (`borg-item-use.c`, `borg-item-wear.c`,
  `borg-item-decurse.c`, `borg-item-enchant.c`, `borg-junk.c`, `borg-magic*.c`).
- **Combat** (`borg-fight-attack.c`, `borg-fight-defend.c`, `borg-fight-perm.c`,
  `borg-attack-munchkin.c`, `borg-projection.c`).
- **Danger / caution** (`borg-danger.c`, `borg-caution.c`, `borg-escape.c`,
  `borg-recover.c`).
- **Flow / navigation** (`borg-flow*.c`, `borg-light.c`) - BFS cost-field
  pathfinding.
- **Decision / think** (`borg-think*.c`) - the top-level priority ladder.
- **Home / shop** (`borg-store*.c`, `borg-home-*.c`).
- **Formulas DSL** (`borg-formulas*.c` + `borg.txt`) - an optional,
  runtime-parsed tuning layer for the three scoring functions (power, prepared,
  restock); the hard-coded C equivalents are the default, so this ports last
  and is skippable for a first faithful build.

### Difficulty tiers
- **Tier A (mechanical, port first):** item/inventory/store/spell model, cave
  model, io/message parsing, util/log, formulas. Near 1:1 onto the READ API.
- **Tier B (derived model + scoring):** the `BI_*` trait derivation, power and
  prepared scoring, home valuation, the map/monster/object model maintenance.
  Deterministic; fidelity matters because scoring drives every choice.
- **Tier C (genuinely hard, port last):** danger math
  (`borg-danger.c` + `borg-caution.c` + `borg-escape.c`), combat target
  selection and damage simulation (`borg-fight-attack.c` at 5,321 lines is the
  single hardest file, plus `borg-fight-defend.c`), flow/pathfinding
  (`borg-flow-kill.c` and friends), and the think ladder
  (`borg-think-dungeon.c`) whose ordering is the Borg's personality.

### Phased ordering (by dependency)
1. Mod substrate + perceive/act facade + controller seam (P7).
2. IO/message channel + item/inventory/store/spell model (Tier A).
3. Trait vector + power/prepared scoring + model maintenance (Tier B).
4. Danger (everything downstream needs it).
5. Flow / navigation.
6. Combat (attack / defend / projection / targeting).
7. Caution / escape / recover.
8. Think ladders (dungeon + store) + home/shop buy-sell.
9. Formulas DSL + `borg.txt` as the final tuning layer.

### Effort
This is the largest single subsystem remaining - comparable in size to a large
fraction of the rest of the engine. It is a multi-phase build, gated on the mod
substrate existing first. It is intentionally sequenced last (P8) for that
reason. The `borg-fight-attack.c` / `borg-danger.c` / `borg-flow-kill.c` /
`borg-think-dungeon.c` cluster is where the fidelity risk concentrates and
where verification effort should be focused (the same porter+independent-verify
discipline used for the scoring and display slices applies, with extra weight
on the danger and combat math).

## 8. Recommended build order and acceptance test

1. Build the mod substrate and freeze the perceive/act facade (P7). Validate it
   against this document's section-3 surface.
2. Port the Borg as a bundled mod on that facade (P8), in the tier order above.
3. **Acceptance test:** the bundled procedural Borg plays a faithful game -
   descends, fights, flees, shops, and dies or wins - driven entirely through
   the public agent API, with no privileged core access. A Borg that plays
   correctly proves the agent API is complete. Every subsequent agent mod
   (third-party or AI-driven) reuses that exact contract.
