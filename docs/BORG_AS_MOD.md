# The Borg as a Mod - Scope and Plan

> STATUS: SHIPPED. The Borg left this repository at v0.13.0 and lives in
> [neostryder/neo-angband-mod-borg](https://github.com/neostryder/neo-angband-mod-borg),
> released at `v0.1.0` and installable from the mod manager like any other mod.
> This document is kept as the design rationale of record, and sections 6 and 8
> as the account of what the move actually cost. The header used to say
> IMPLEMENTED and "ships as a BUNDLED MOD (`packages/borg`)", which was wrong
> twice over: no mod ships inside the build, and a package with no importer does
> not ship at all. For how the Borg works see
> [docs/modding/BORG.md](modding/BORG.md); for the framework it rides, see
> [docs/modding/MOD_INTEGRATION_PLAN.md](modding/MOD_INTEGRATION_PLAN.md).

## 1. The decision

The procedural Borg is packaged as a **mod**, not ported into `packages/core`.
It is first-party, which is not the same as bundled: NO mod ships inside the
build, this one included. Every mod, ours or anyone's, is obtained the same way. Three things follow:

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

## 6. Where this actually stands (measured 2026-08-01)

The substrate is built. The Borg is ported. **The two are not connected, and no
player can reach the Borg by any route.** Said plainly here because the previous
version of this section said "the Borg rides them as a bundled mod
(`packages/borg`)", and that was not true of anything.

What is true, each of it checked rather than recalled:

| | |
| --- | --- |
| The substrate | Built. Plugin runtime, sandbox, capability enforcement, read-only `GameState` facade, `installController`. |
| The Borg itself | Ported and passing. 72 source files, 135 tests green across nine files. |
| Who imports `packages/borg` | **Nobody.** Zero references outside the package. |
| Who calls `installController` | Core's own tests, and `packages/mcp`. Not the web shell, not desktop. |
| `neostryder/neo-angband-mod-borg` | `.github`, `LICENSE.md`, `README.md`. No tags, no manifest, no plugin. |
| `RECOMMENDED_MODS` | Says the Borg is "absent because it has no release", which is correct. |

So the Borg is a library with no caller, in a monorepo that does not ship it,
with an empty repository waiting for it.

### What the move actually costs

Less than the file count suggests. The mod builder refuses a plugin that bundles
its own copy of the engine — a second set of registries running beside the game's
— so every value the Borg takes from core has to arrive through `ctx.core`
instead of a bare import. That sounds like 37 files, which is how many mention
`@rpgm-tools/neo-angband-core`. It is not: **28 of those are `import type`, which
compiles to nothing.**

The real runtime coupling is **six symbols across eight files**:

| Symbol | Where |
| --- | --- |
| `FEAT` | `danger/danger.ts`, `danger/geometry.ts`, `flow/flow-consts.ts`, `think-ladder.ts` |
| `RSF` | `danger/danger.ts`, `danger/facts.ts`, `fight/attack.ts` |
| `TV` | `item/svals.ts` (re-exported) |
| `Rng` | `rng.ts` |
| `MON_RACE_FLAG_ENTRIES`, `MON_SPELL_ENTRIES` | `resolvers.ts` |

Four of the six are generated constant tables. One is a class. That is the whole
of it.

### The one piece that does not exist yet

`ModPlugin` has `hooks`, `register`, `migrateBag` and `uninstall`, and **no
controller seam**. An autoplayer cannot announce itself the way a behaviour mod
announces a hook.

It does not need a new seam to work, though: `ctx.core` is the live engine
namespace, entire, so a plugin can call `ctx.core.installController(ctx.state,
borg)` from `register()`. Whether that stays the route or a first-class
`controller?(ctx)` is added is the one open design question here — and it is worth
answering deliberately, because the answer is the contract every future agent mod
uses, not just this one.

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

## 8. Build order and acceptance test

Steps 1 and 2 are done. Steps 3-7 are the move described in section 6.

1. ~~Build the mod substrate and freeze the perceive/act facade (P7).~~ Done.
2. ~~Port the Borg on that facade (P8), in the tier order above.~~ Done:
   `packages/borg`, 72 files, 135 tests.
3. **Decide the controller route** — `ctx.core.installController` from
   `register()`, or a first-class `controller?(ctx)` on `ModPlugin`. This is the
   contract every future agent mod inherits, so it is a decision and not an
   implementation detail.
4. **Thread the six symbols.** One module in the mod, handed `ctx.core` once,
   re-exporting `FEAT` / `RSF` / `TV` / `Rng` / `MON_RACE_FLAG_ENTRIES` /
   `MON_SPELL_ENTRIES`. Eight import lines change. Do it in `packages/borg`
   FIRST, where the full suite can prove it, and copy afterwards.
5. **Re-examine against what moved since the port.** The Borg was ported before
   the agent API reached 1.1.0 (the glyph layer), before `ModHooks` grew its
   current seams, and before the plugin ABI settled. Three gaps are already known
   and marked in the source: `auxActivation` is a complete port of
   `borg_attack_aux_activation` that nothing calls, and `decurseCommand` and
   `borgTestStuff` each accept a `playerHas` seam and drop it.
6. **The two tests that hang.** `foundation.test.ts` and `think.test.ts` run
   without output and without a timeout. `think.ts` is the decision ladder, so
   the untested part is the part that decides. Fix before the tag, not after: the
   mod's own CI is the only thing that will ever run them again.
7. **Release it like any other mod** — `npm run verify`, tag, re-fetch every file
   from `raw.githubusercontent.com` at that tag, hash it, and put the digests in
   `RECOMMENDED_MODS`. `docs/RELEASING.md` has the procedure and the reason the
   digest must come from what GitHub serves rather than from the local build.

**Acceptance test:** the procedural Borg plays a faithful game - descends,
fights, flees, shops, and dies or wins - driven entirely through the public agent
API, with no privileged core access, **installed from its own repository the way
a player would install it**. A Borg that plays correctly proves the agent API is
complete. Every subsequent agent mod (third-party or AI-driven) reuses that exact
contract.
