/**
 * @neo-angband/core - the headless game engine.
 *
 * Phase 0 scaffold. The engine grows here by dependency order:
 * rng -> dice/expressions -> flags -> world kernel -> entities ->
 * effects -> game loop. See docs/PORT_PLAN.md at the repository root.
 *
 * Parity baseline: Angband 4.2.6 (see reference/ and parity/).
 */

export * from "./rng";
export * from "./loc";
export * from "./events";
export * from "./cmd";
export * from "./msg";
export * from "./color";
export * from "./bitflag";
export * from "./guard";
export * from "./expression";
export * from "./dice";
export * from "./generated";
export * from "./constants";

/** Upstream release this port is verified against. */
export const PARITY_BASELINE = "4.2.6";

/** Port version, tracked independently of the baseline. */
export const ENGINE_VERSION = "0.1.0";
export * from "./world/feature";
export * from "./world/chunk";
export * from "./world/view";
export * from "./world/scatter";
export * from "./world/flow";
export * from "./world/project";
export * from "./world/projection";
export * from "./world/trap";
export * from "./effects/effect";
export * from "./effects/effect-info";
export * from "./effects/interpreter";
export * from "./effects/handlers";
export * from "./mon/types";
export * from "./mon/bind";
export * from "./mon/monster";
export * from "./mon/make";
export * from "./mon/summon";
export * from "./mon/predicate";
export * from "./mon/timed";
export * from "./mon/take-hit";
export * from "./mon/spell";
export * from "./mon/project-mon";
export * from "./obj/types";
export * from "./obj/bind";
export * from "./obj/object";
export * from "./obj/chest";
export * from "./obj/make";
export * from "./obj/power";
export * from "./obj/value";
export * from "./obj/knowledge";
export * from "./obj/ignore";
export * from "./obj/known-object";
export * from "./obj/desc";
export * from "./obj/object-info";
export * from "./obj/randname";
export * from "./obj/flavor";
export * from "./obj/randart";
export * from "./player/types";
export * from "./player/options";
export * from "./player/bind";
export * from "./player/player";
export * from "./player/calcs";
export * from "./player/timed";
export * from "./player/take-hit";
export * from "./player/spell";
export * from "./player/birth";
export * from "./player/history";
export * from "./player/abilities";
export * from "./save/buffer";
export * from "./save/integrity";
export * from "./gen/util";
export * from "./gen/room";
export * from "./gen/cave";
export * from "./gen/generate";
export * from "./combat/index";
export * from "./store/types";
export * from "./store/bind";
export * from "./store/price";
export * from "./store/store";
export * from "./store/transact";
export * from "./session/boot";
export * from "./session/game";
export * from "./session/save";
export * from "./game/energy";
export * from "./game/context";
export * from "./game/monster-turn";
export * from "./game/scheduler";
export * from "./game/player-turn";
export * from "./game/project-monster";
export * from "./game/project-player";
export * from "./game/project-cast";
export * from "./game/effect-env";
export * from "./game/effect-game-env";
export * from "./game/effect-attack";
export * from "./game/effect-general";
export * from "./game/effect-monster";
export * from "./game/effect-teleport";
export * from "./game/effect-terrain";
export * from "./game/effect-item";
export * from "./game/effect-melee";
export * from "./game/effect-summon";
export * from "./game/effect-detect";
export * from "./game/known";
export * from "./game/target";
export * from "./game/target-loop";
export * from "./game/mon-cmd";
export * from "./game/describe";
export * from "./game/history";
export * from "./game/object-inspect";
export * from "./game/mon-message";
export * from "./game/mon-list";
export * from "./game/obj-list";
export * from "./game/display";
export * from "./game/char-sheet";
export * from "./game/ui-entry";
export * from "./game/equip-cmp";
export * from "./game/mon-shape";
export * from "./mon/lore";
export * from "./mon/lore-describe";
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
} from "./game/mon-place";
export type {
  MonPlaceDeps as LiveMonPlaceDeps,
  SummonDeps,
} from "./game/mon-place";
export * from "./game/thrust";
export * from "./game/mon-cast";
export * from "./game/mon-ranged";
export * from "./game/mon-group";
export * from "./game/floor";
export * from "./game/pickup";
export * from "./game/obj-cmd";
export * from "./game/cave-cmd";
export * from "./game/chest";
export * from "./game/trap";
export * from "./game/spell-cmd";
export * from "./game/ranged-cmd";
export * from "./game/loop";
export * from "./game/ignore-cmd";
/* --- Wizard / debug commands (task #29: cmd-wizard.c / wiz-debug.c) ---
 * The debug/cheat command surface, gated behind the WizardDeps.wizard flag
 * (upstream ALLOW_DEBUG + NOSCORE_WIZARD); unreachable in faithful play. */
export * from "./game/wizard";
export * from "./sound";

/* --- High scores (task #28: score.c / score-util.c / ui-score.c) --- */
export * from "./score/types";
export * from "./score/score";
export * from "./score/display";

/* --- Graphics/tiles + visuals (task #27: grafmode.c / ui-visuals.c) --- */
export * from "./visuals";

// Some small derived constants and geometry helpers are defined
// independently by more than one domain (identical values/behavior).
// Re-export a single canonical copy so the barrel is unambiguous rather
// than dropping the name from two colliding `export *`s.
// - OF_SIZE/ELEM_MAX: flag-array sizes derived from the generated lists,
//   defined by both obj/types and player/types.
// - nextGrid: next_grid(grid, dir), defined by both world/view and
//   gen/util as grid + DDGRID[dir].
export { OF_SIZE, ELEM_MAX } from "./obj/types";
export { nextGrid } from "./world/view";
// objDescNameFormat: obj/bind has a reduced &-stripping helper (sval name
// matching); obj/desc has the full obj_desc_name_format (modstr + pluralise).
// Expose the full port as canonical; bind's stays internal to its module.
export { objDescNameFormat } from "./obj/desc";
// CriticalLevel is defined by both constants (parsed data) and combat/hit
// (with msg typed as the specific HitType). Crit levels are a combat
// concept; expose combat/hit's as canonical.
export type { CriticalLevel } from "./combat/hit";
// Combat message types for shells rendering py_attack text (the combat code
// returns HitType keys only; the text is a UI concern - see combat/melee.ts).
export type { MeleeAttack, MeleeBlow } from "./combat/melee";
export type { HitType } from "./combat/hit";
// - EXTRACT_ENERGY/turnEnergy: the extract_energy[] table and turn_energy()
//   live in mon/monster; game/energy re-exports them for convenience, so
//   pin mon/monster as the single canonical source.
// - squareIsEmpty: two genuinely different predicates share the name -
//   gen/util's is a generation-time check (takes a Gen), game/context's is
//   a live occupancy check (takes a GameState). Keep gen/util's as the
//   barrel-canonical (it predates game/); game/context's is reached via its
//   module and will get an aliased export if the game API needs it publicly.
export { EXTRACT_ENERGY, turnEnergy } from "./mon/monster";
export { squareIsEmpty } from "./gen/util";
// - squareCanPutItem: like squareIsEmpty, a generation-time predicate
//   (gen/util, takes a Gen) and a live-cave one (game/floor, takes a
//   GameState) share the name; gen/util's stays barrel-canonical and the
//   live one is reached via its module.
export { squareCanPutItem } from "./gen/util";
// - placeTrap: gen/util's generation-time marker vs game/trap's live
//   place_trap; same convention, gen/util's stays barrel-canonical.
export { placeTrap } from "./gen/util";
export * from "./game/gear";
