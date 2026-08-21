/**
 * @rpgm-tools/neo-angband-core - the headless game engine.
 *
 * Phase 0 scaffold. The engine grows here by dependency order:
 * rng -> dice/expressions -> flags -> world kernel -> entities ->
 * effects -> game loop. See docs/PORT_PLAN.md at the repository root.
 *
 * Parity baseline: Angband 4.2.6 (see reference/ and parity/).
 */

export * from "./rng.js";
export * from "./loc.js";
export * from "./events.js";
export * from "./cmd.js";
export * from "./msg.js";
export * from "./color.js";
export * from "./bitflag.js";
export * from "./guard.js";
export * from "./expression.js";
export * from "./parser.js";
export * from "./dice.js";
export * from "./generated/index.js";
export * from "./constants.js";

export * from "./version.js";
export * from "./world/feature.js";
export * from "./world/chunk.js";
export * from "./world/view.js";
export * from "./world/scatter.js";
export * from "./world/flow.js";
export * from "./world/project.js";
export * from "./world/projection.js";
export * from "./world/trap.js";
export * from "./effects/effect.js";
export * from "./effects/effect-info.js";
export * from "./effects/effect-info-registry.js";
export * from "./effects/effect-choice.js";
export * from "./effects/interpreter.js";
export * from "./effects/handlers.js";
export * from "./mon/types.js";
export * from "./mon/bind.js";
export * from "./mon/monster.js";
export * from "./mon/make.js";
export * from "./mon/summon.js";
export * from "./mon/predicate.js";
export * from "./mon/timed.js";
export * from "./mon/take-hit.js";
export * from "./mon/spell.js";
export * from "./mon/desc.js";
export * from "./mon/knowledge-groups.js";
export * from "./mon/project-mon.js";
export * from "./obj/types.js";
export * from "./obj/bind.js";
export * from "./obj/object.js";
export * from "./obj/chest.js";
export * from "./obj/make.js";
export * from "./obj/power.js";
export * from "./obj/value.js";
export * from "./obj/knowledge.js";
export * from "./obj/ignore.js";
export * from "./obj/known-object.js";
export * from "./obj/artifact-known.js";
export * from "./obj/artifact-fake.js";
export * from "./obj/fake-object.js";
export * from "./obj/desc.js";
export * from "./obj/object-info.js";
export * from "./obj/randname.js";
export * from "./obj/flavor.js";
export * from "./obj/randart.js";
export * from "./obj/randart-registry.js";
export * from "./obj/rune-registry.js";
export * from "./obj/tval-registry.js";
/* The randart BUILD primitives (addFlag / addMod / addResist / addBrand /
 * addToHit / ... ) and the set profile. A mod's registry:randart handler is
 * written exactly the way core's arms are written - by calling these - so a
 * seam whose primitives are not in `ctx.core` is a seam a mod cannot use.
 * Exporting the modules is what makes the randart registry reachable rather
 * than merely registered. */
export * from "./obj/randart-build.js";
export * from "./obj/randart-data.js";
export * from "./player/types.js";
export * from "./player/options.js";
export * from "./player/options-file.js";
export * from "./player/bind.js";
export * from "./player/player.js";
export * from "./player/calcs.js";
export * from "./player/timed.js";
export * from "./player/take-hit.js";
export * from "./player/spell.js";
export * from "./player/birth.js";
export * from "./player/history.js";
export * from "./player/death.js";
export * from "./player/abilities.js";
export * from "./player/shape-lore.js";
export * from "./save/buffer.js";
export * from "./save/compress.js";
export * from "./save/description.js";
export * from "./save/integrity.js";
export * from "./gen/util.js";
export * from "./gen/glyph.js";
export * from "./gen/room.js";
export * from "./gen/cave.js";
export * from "./gen/generate.js";
/* gen-monster's pit machinery: resolvePits is the last piece of a GenDeps a
 * caller outside core cannot otherwise build, so a mod that wants to run
 * generateLevel itself (or test a levelGenerated hook against real levels) needs
 * it. Everything else here is the same generation vocabulary gen/util already
 * publishes. */
export * from "./gen/gen-monster.js";
export * from "./combat/index.js";
export * from "./store/types.js";
export * from "./store/bind.js";
export * from "./store/price.js";
export * from "./store/store.js";
export * from "./store/transact.js";
export * from "./store/store-cmd.js";
export * from "./session/boot.js";
export * from "./session/game.js";
export * from "./session/save.js";
/* Save migration. A host needs SaveFromFutureError to tell "your game is too
 * old to read this" apart from "this file is damaged" - two sentences a
 * permadeath player reacts to very differently. See session/save-migrate.ts. */
export * from "./session/save-migrate.js";
/* The behaviour seam itself: ModHooks (the closed set of extension points) and
 * composeModHooks (the host's fold over several mods' contributions). A mod
 * cannot write a hook without the type, and a host cannot install one without
 * the fold, so both are part of the published API - see mod/hooks.ts. */
export * from "./mod/hooks.js";
export * from "./mod/save-blocks.js";
export * from "./mod/ids.js";
export * from "./mod/registry-host.js";
export * from "./mod/vocabulary.js";
export * from "./mod/record-keys.js";
export * from "./mod/extension.js";
/* THE TYPE ONLY, not the functions. `RecordRefusal` is the published shape of
 * `StoreRegistry.refused` and `ObjRegistry.refused`, so a consumer has to be
 * able to name it. `fieldOwner`, `sameEntry` and `refusalWhy` are binder
 * machinery: putting them on `ctx.core` would promise mods an interface this
 * repository wants to keep free to change, and the ABI ratchet
 * (mod-core-surface.test.ts) is right to have asked. */
export type { RecordRefusal } from "./mod/refusal.js";
export * from "./agent/index.js";
export * from "./game/energy.js";
export * from "./game/context.js";
export * from "./game/monster-turn.js";
export * from "./game/scheduler.js";
export * from "./game/player-turn.js";
/* The projection seam a mod writes handlers against: the per-game registry
 * (reached through ModRegistryHost.projections, "registry:projection"), the
 * handler and context types for all three sides, and core's own tables so an
 * author can read what they are replacing, and the two dispatch entry points so
 * a mod - or the canary that proves a mod reached the table - can run one.
 * Named explicitly rather than `export *` because these modules also re-export
 * helpers owned elsewhere (project-obj re-exports gearToLabel) that would
 * collide here. See game/projection-handlers.ts. */
export * from "./game/projection-handlers.js";
export { PROJECT_FEAT_HANDLERS, projectFeature } from "./game/project-feat.js";
export type {
  ProjectFeatCtx,
  ProjectFeatEnv,
  ProjectFeatHandler,
} from "./game/project-feat.js";
export { PROJECT_OBJ_HANDLERS, projectObject } from "./game/project-obj.js";
export type {
  ProjectObjCtx,
  ProjectObjHandler,
  ProjectWorldEnv,
} from "./game/project-obj.js";
export { PLAYER_SIDE_HANDLERS } from "./game/player-side.js";
export type {
  PlayerSideCtx,
  PlayerSideDeps,
  PlayerSideHandler,
} from "./game/player-side.js";
export * from "./game/project-monster.js";
export * from "./game/project-player.js";
export * from "./game/project-cast.js";
export * from "./game/effect-env.js";
export * from "./game/effect-game-env.js";
export * from "./game/effect-attack.js";
export * from "./game/effect-general.js";
export * from "./game/effect-monster.js";
export * from "./game/effect-teleport.js";
export * from "./game/effect-terrain.js";
export * from "./game/effect-item.js";
export * from "./game/effect-melee.js";
export * from "./game/effect-summon.js";
export * from "./game/effect-detect.js";
export * from "./game/known.js";
export * from "./game/inscription-confirm.js";
export * from "./game/target.js";
export * from "./game/target-loop.js";
export * from "./game/mon-cmd.js";
export * from "./game/describe.js";
export * from "./game/history.js";
export * from "./game/object-inspect.js";
export * from "./game/shape-inspect.js";
export * from "./game/mon-message.js";
export * from "./game/mon-list.js";
export * from "./game/obj-list.js";
export * from "./game/display.js";
export * from "./game/char-sheet.js";
export * from "./game/lore-color.js";
export * from "./game/ui-entry.js";
/* The character-screen seam a mod writes combiners and renderer backends
 * against: the per-game registry (reached through ModRegistryHost.uiEntry,
 * "registry:ui-entry") and the handler types. See game/ui-entry-registry.ts. */
export * from "./game/ui-entry-registry.js";
export * from "./game/equip-cmp.js";
export * from "./game/mon-shape.js";
export * from "./mon/lore.js";
export * from "./mon/lore-file.js";
export * from "./mon/lore-describe.js";
/* The live-cave placement family shares upstream names with its
 * generation-time twin in gen/util; the live variants export Live-suffixed. */
export {
  squareIsOpenLive,
  squareIsEmptyLive,
  squareAllowsSummon,
  placeNewMonsterOne,
  placeNewMonster as placeNewMonsterLive,
  pickAndPlaceMonster as pickAndPlaceMonsterLive,
  summonSpecific,
  selectShape,
  wipeMonsterCounts,
  countMonsterRaces,
} from "./game/mon-place.js";
export type {
  MonPlaceDeps as LiveMonPlaceDeps,
  SummonDeps,
} from "./game/mon-place.js";
export * from "./game/thrust.js";
export * from "./game/mon-cast.js";
export * from "./game/mon-ranged.js";
export * from "./game/mon-group.js";
export * from "./game/floor.js";
export * from "./game/dump-level.js";
export * from "./game/spoil.js";
export * from "./game/pickup.js";
export * from "./game/obj-cmd.js";
export * from "./game/cave-cmd.js";
export * from "./game/chest.js";
export * from "./game/trap.js";
export * from "./game/spell-cmd.js";
export * from "./game/ranged-cmd.js";
export * from "./game/loop.js";
export * from "./game/ignore-cmd.js";
export * from "./game/repeat.js";
/* --- Wizard / debug commands (task #29: cmd-wizard.c / wiz-debug.c) ---
 * The debug/cheat command surface, gated behind the WizardDeps.wizard flag
 * (upstream ALLOW_DEBUG + NOSCORE_WIZARD); unreachable in faithful play. */
export * from "./game/wizard.js";
export * from "./sound/index.js";

/* --- High scores (task #28: score.c / score-util.c / ui-score.c) --- */
export * from "./score/types.js";
export * from "./score/score.js";
export * from "./score/display.js";

/* --- Graphics/tiles + visuals (task #27: grafmode.c / ui-visuals.c) --- */
export * from "./visuals/index.js";
/* Localization (MOD_REACH gap 14). English ships in core and a locale is a
 * MOD, so this exports the layer and not any translation. */
export * from "./i18n/i18n.js";
export * from "./i18n/text.js";

/* --- The host layer (z-file.c + init.c's ANGBAND_DIR_*) ---
 * The injectable seam that lets a front end declare what its platform can do
 * instead of letting the platform's limits quietly redefine the game. Adapters
 * live with their front ends (web, cli, desktop); MemoryHost is the reference
 * implementation and what the tests drive. */
export * from "./host/io.js";
export * from "./host/memory.js";
export * from "./host/raw.js";
export * from "./host/bridge.js";
export * from "./host/args.js";

// Some small derived constants and geometry helpers are defined
// independently by more than one domain (identical values/behavior).
// Re-export a single canonical copy so the barrel is unambiguous rather
// than dropping the name from two colliding `export *`s.
// - OF_SIZE/ELEM_MAX: flag-array sizes derived from the generated lists,
//   defined by both obj/types and player/types.
// - nextGrid: next_grid(grid, dir), defined by both world/view and
//   gen/util as grid + DDGRID[dir].
export { OF_SIZE, ELEM_MAX } from "./obj/types.js";
export { nextGrid } from "./world/view.js";
// objDescNameFormat: obj/bind has a reduced &-stripping helper (sval name
// matching); obj/desc has the full obj_desc_name_format (modstr + pluralise).
// Expose the full port as canonical; bind's stays internal to its module.
export { objDescNameFormat } from "./obj/desc.js";
// CriticalLevel is defined by both constants (parsed data) and combat/hit
// (with msg typed as the specific HitType). Crit levels are a combat
// concept; expose combat/hit's as canonical.
export type { CriticalLevel } from "./combat/hit.js";
// Combat message types for shells rendering py_attack text (the combat code
// returns HitType keys only; the text is a UI concern - see combat/melee.ts).
export type { MeleeAttack, MeleeBlow } from "./combat/melee.js";
export type { HitType } from "./combat/hit.js";
// - EXTRACT_ENERGY/turnEnergy: the extract_energy[] table and turn_energy()
//   live in mon/monster; game/energy re-exports them for convenience, so
//   pin mon/monster as the single canonical source.
// - squareIsEmpty: two genuinely different predicates share the name -
//   gen/util's is a generation-time check (takes a Gen), game/context's is
//   a live occupancy check (takes a GameState). Keep gen/util's as the
//   barrel-canonical (it predates game/); game/context's is reached via its
//   module and will get an aliased export if the game API needs it publicly.
export { EXTRACT_ENERGY, turnEnergy } from "./mon/monster.js";
export { squareIsEmpty } from "./gen/util.js";
// - squareCanPutItem: like squareIsEmpty, a generation-time predicate
//   (gen/util, takes a Gen) and a live-cave one (game/floor, takes a
//   GameState) share the name; gen/util's stays barrel-canonical and the
//   live one is reached via its module.
export { squareCanPutItem } from "./gen/util.js";
// - placeTrap: gen/util's generation-time marker vs game/trap's live
//   place_trap; same convention, gen/util's stays barrel-canonical.
export { placeTrap } from "./gen/util.js";
export * from "./game/gear.js";
