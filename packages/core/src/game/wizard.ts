/**
 * The WIZARD / DEBUG command surface, ported from Angband 4.2.6:
 *   - reference/src/cmd-wizard.c   (the do_cmd_wiz_* command actions)
 *   - reference/src/wiz-debug.c    (wiz_cheat_death)
 *
 * UPSTREAM HAS TWO SEPARATE CONCEPTS HERE, and this module gates on the second.
 * The port originally collapsed them into one `wizard` boolean, which silently
 * made every debug command unreachable unless wizard mode was also on - a gate
 * upstream does not have:
 *
 *   - DEBUG consent (player_can_debug_prereq, reference/src/player-util.c
 *     L1296-1307) gates all 41 debug-menu commands. It consults ONLY
 *     `player->noscore & NOSCORE_DEBUG`; on the first use it asks confirm_debug()
 *     and, if accepted, ORs the bit in permanently. It never reads
 *     player->wizard. Every row of every cmd_debug_* table in
 *     reference/src/ui-game.c L247-322 uses this prereq and nothing else.
 *   - WIZARD mode (player->wizard, toggled by ^W / do_cmd_wizard,
 *     reference/src/cmd-misc.c L40-67) is a separate, much smaller thing: it
 *     changes six display / knowledge behaviours and nothing in this module.
 *     Its 15 upstream call sites are the toggle itself, cheat death
 *     (player-util.c L246), the "[=-WIZARD-=]" title (ui-display.c L178,
 *     ui-player.c L628), all-artifacts-known (ui-knowledge.c L1695), the seven
 *     look/target coordinate+noise+scent lines (ui-target.c), the headless
 *     stats build (main-stats.c L435) and the borg's cheat-death check.
 *
 * So WizardDeps carries BOTH flags: `debug` (the player_can_debug_prereq result)
 * gates the commands here, and `wizard` gates only wizCheatDeath, whose upstream
 * path is `player->wizard || OPT(player, cheat_live)`. A normal, faithful game
 * (design decision 16: no save-scumming, faithful play) reaches neither without
 * the player accepting an explicit, savefile-marking warning first.
 *
 * MOST of these commands are thin wrappers that drive already-ported engine
 * systems with debug parameters, so this module wires to the existing port and
 * does not re-implement the engine:
 *   - object / gold / artifact creation -> obj/make.ts (objectPrep, applyMagic,
 *     makeGold, copyArtifactData) through the shared MakeDeps bundle;
 *   - detection / mapping / teleport / summon-random / project-los / restore
 *     stat+exp -> the effect interpreter's effect_simple (effects/interpreter.ts
 *     effectSimple) over a game effect context (game/effect-env.ts +
 *     game/effect-game-env.ts), the same stack items and spells run through;
 *   - banish -> deleteMonster (game/context.ts);
 *   - create_trap -> placeTrap (game/trap.ts);
 *   - summon_named -> scatterExt + placeNewMonster (world/scatter.ts,
 *     game/mon-place.ts);
 *   - curse_item -> appendObjectCurse / removeObjectCurse (obj/object.ts);
 *   - exp / level / stat edits -> player/exp.ts (playerExpGain / playerExpLose);
 *   - learn_object_kinds -> the per-game FlavorKnowledge (obj/knowledge.ts);
 *   - recall / wipe monster -> cheatMonsterLore / wipeMonsterLore (mon/lore.ts);
 *   - wizard_light -> wizLightLevel (game/effect-terrain.ts);
 *   - push_object -> pushObject (game/project-feat.ts).
 *
 * The Term / prompt UI halves stay with the shell (the "which item / which
 * monster / how many" menus and the map-highlight redraws): where a command
 * needs a selection or count, this module takes it as a parameter. The map
 * QUERY commands (query_feature / query_square_flag / peek_noise_scent) and
 * dump_level_map port their DATA half only - they return the grids or map the
 * shell would highlight or write, not the drawing.
 *
 * The item / player debug shells whose non-UI halves are engine data or state
 * changes are ported here too (their Term rendering and menu loops stay with the
 * shell, WP-14): wizDisplayItem (wiz_display_item DATA), wizPlayItemBegin /
 * wizPlayItemReject / wizPlayItemAccept (the do_cmd_wiz_play_item session
 * snapshot / restore / commit), wizStatItem (do_cmd_wiz_stat_item's make_object
 * rarity sampler) and wizEditPlayerStart (do_cmd_wiz_edit_player_start's batch
 * stat/gold/exp apply). The NOSCORE_* cheat-flag model and the markNoscore seam
 * (15.3) live here as well.
 *
 * DEFERRED (see parity/ledger/wizard-debug.yaml): the wiz-spoil.c spoiler
 * generators and the three Monte-Carlo collectors (do_cmd_wiz_collect_*) are
 * dev-tooling ports that live in packages/cli (spoilers.ts, stats.ts,
 * wiz-stats.ts) alongside the other headless generation harnesses, not in this
 * engine module.
 */

import { EF, KF, ORIGIN, PROJ, TMD } from "../generated/index.js";
import type { Loc } from "../loc.js";
import { PY_MAX_EXP, playerExpGain, playerExpLose } from "../player/exp.js";
import type { ExpDeps } from "../player/exp.js";
import { PY_MAX_LEVEL } from "../player/calcs.js";
import { PN, STAT_MAX } from "../player/types.js";
import {
  applyMagic,
  copyArtifactData,
  egoApplyMagic,
  makeGold,
  makeObject,
  objectPrep,
} from "../obj/make.js";
import type { MakeDeps } from "../obj/make.js";
import {
  appendObjectCurse,
  objectCopy,
  objectWeightOne,
  removeObjectCurse,
  tvalCanHaveCharges,
  tvalCanHaveTimeout,
  tvalIsAmmo,
  tvalIsMoney,
} from "../obj/object.js";
import type { GameObject } from "../obj/object.js";
import { objectValue } from "../obj/value.js";
import { OBJ_NOTICE, objectLearnOnWield } from "../obj/knowledge.js";
import { MAX_PVAL, OBJ_MOD_MAX } from "../obj/types.js";
import type { FlagSet } from "../bitflag.js";
import type { Artifact, Curse, EgoItem, ObjectKind } from "../obj/types.js";
import type { FlavorKnowledge } from "../obj/knowledge.js";
import { MON_GROUP } from "../mon/types.js";
import type { MonsterRace } from "../mon/types.js";
import { PY_FOOD_FULL_DEFAULT as PY_FOOD_FULL } from "../player/birth.js";
import { cheatMonsterLore, getLore, wipeMonsterLore } from "../mon/lore.js";
import { sourceNone, sourcePlayer } from "../effects/interpreter.js";
import type { EffectContext } from "../effects/interpreter.js";
import { scatterExt } from "../world/scatter.js";
import { deleteMonster, monsterMax } from "./context.js";
import type { GameState } from "./context.js";
import { dropNear, floorPile } from "./floor.js";
import { objectIsCarried, objectIsInQuiver } from "./gear.js";
import { objectTouch } from "../obj/known-object.js";
import { placeNewMonster, squareIsEmptyLive } from "./mon-place.js";
import type { MonPlaceDeps } from "./mon-place.js";
import { placeTrap, squareIsTrap, squareIsWebbed } from "./trap.js";
import type { TrapDeps } from "./trap.js";
import { pushObject } from "./project-feat.js";
import { wizLightLevel } from "./effect-terrain.js";
import { squareIsKnown, updatePlayerObjectKnowledge } from "./known.js";
import { buildEffectContext } from "./effect-env.js";
import type { EffectEnvDeps } from "./effect-env.js";
import { attachGameEnv } from "./effect-game-env.js";
import type { CastContext } from "./project-cast.js";
import type { ObjCmdDeps } from "./obj-cmd.js";

/* ------------------------------------------------------------------ *
 * Deps and the wizard gate.
 * ------------------------------------------------------------------ */

/**
 * The effect-interpreter bundle needed to run effect_simple from a wizard
 * command (identical to SpellCmdDeps.effects): the registry with the game
 * handlers plus everything attachGameEnv wires onto the context.
 */
export type WizEffectDeps = Pick<
  ObjCmdDeps,
  | "registry"
  | "cast"
  | "envDeps"
  | "inject"
  | "teleport"
  | "general"
  | "item"
  | "summon"
>;

/**
 * WizardDeps: the wizard/debug gate plus the already-ported engine bundles the
 * commands wire to. Every bundle is optional so a caller can expose only the
 * subset of wizard commands it needs; an action whose bundle is absent is a
 * no-op (it behaves as gated).
 */
export interface WizardDeps {
  /**
   * player_can_debug_prereq's result (player-util.c L1296-1307): has this
   * character already consented to debug commands, i.e. is NOSCORE_DEBUG set?
   * This is the gate on all 41 debug commands in this module. It is NOT wizard
   * mode: upstream's prereq never reads player->wizard, so a non-wizard player
   * who accepts the debug warning gets the whole debug surface.
   *
   * The consent itself lives on player->noscore, so a caller computes this as
   * `(player.noscore & NOSCORE.DEBUG) !== 0` and asks the player via the shell's
   * confirm_debug equivalent before setting the bit through markNoscore.
   */
  debug: boolean;
  /**
   * player->wizard (cmd-misc.c L40-67). Gates ONLY wizCheatDeath here, whose
   * upstream condition is `player->wizard || OPT(player, cheat_live)`
   * (player-util.c L246). The other five wizard-mode behaviours are display and
   * knowledge concerns and live with their own modules (game/display.ts,
   * game/char-sheet.ts, obj/artifact-known.ts, game/target-loop.ts), each with
   * its own `wizard` flag - none of them route through this seam.
   */
  wizard: boolean;
  /** obj/make.ts bundle (reg / alloc / constants) for object creation. */
  makeDeps?: MakeDeps;
  /** player/exp.ts hooks (rng + level-change ripple) for exp / stat edits. */
  expDeps?: ExpDeps;
  /** The effect_simple bundle for detection / teleport / summon / restore. */
  effect?: WizEffectDeps;
  /** game/trap.ts deps for create_trap. */
  trapDeps?: TrapDeps;
  /** game/mon-place.ts deps for summon_named. */
  monPlace?: MonPlaceDeps;
  /** Per-game flavor knowledge for learn_object_kinds. */
  flavor?: FlavorKnowledge;
  /** The full monster race list, for the "all monsters" recall / wipe. */
  races?: readonly MonsterRace[];
  /** The full artifact list (reg.artifacts), for create_all_artifact. */
  artifacts?: readonly (Artifact | null)[];
  /** The full ego list (reg.egos), for wiz_tweak_item. */
  egos?: readonly EgoItem[];
  /** The full curse list (reg.curses), for curse_item. */
  curses?: readonly (Curse | null)[];
  /**
   * Mark the character's savefile-invalidating cheat flags (player->noscore).
   * Optional seam: player.ts does not yet carry a noscore field (owned by the
   * gear/player work package) and save.ts persists it (owned by the save/load
   * work package), so this module cannot write the flag directly. When a caller
   * supplies the hook, the noscore actions here call it with the NOSCORE_* bits
   * upstream would OR in; when it is absent the marking is a no-op (see the
   * WIRING-NEEDED items in the ledger). Bits come from the NOSCORE constants.
   */
  markNoscore?: (bits: number) => void;
  /** msg(): command feedback. */
  msg?: (text: string) => void;
}

/**
 * player_can_debug_prereq (player-util.c L1296-1307): the gate on every debug
 * command. Returns false (and the command no-ops) until the character has
 * consented to debug mode. Deliberately independent of wizard mode.
 */
export function debugEnabled(deps: WizardDeps): boolean {
  return deps.debug === true;
}

/**
 * player->wizard (cmd-misc.c L40-67). Only wizCheatDeath gates on this here; see
 * WizardDeps.wizard for where the other wizard-mode behaviours live.
 */
export function wizardEnabled(deps: WizardDeps): boolean {
  return deps.wizard === true;
}

/* ------------------------------------------------------------------ *
 * NOSCORE cheat flags (player.h L92-100).
 * ------------------------------------------------------------------ */

/**
 * NOSCORE_*: the "ways in which players can be marked as cheaters" bit model
 * (player.h L92-100). Stored on player->noscore (a uint16), persisted in the
 * savefile (save.c L622 wr_u16b / load.c L965 rd_u16b) and re-asserted from the
 * savefile's own wizard flag on load (savefile.c L650). A set cheat bit
 * invalidates the high-score entry (score.c L289). The bit values match
 * upstream exactly so a loaded uint16 is interpreted identically.
 */
export const NOSCORE = {
  /** Character used wizard mode (wiz-debug.c L32, cmd-misc.c L51). */
  WIZARD: 0x0002,
  /** Character used a debug command / debug options (player-util.c L1303). */
  DEBUG: 0x0008,
  /** Character jumped levels (cmd-wizard.c L1366); transient, cleared after
   * the jump completes (generate.c L824-828). Does NOT invalidate the score. */
  JUMPING: 0x0010,
  /** Character was played by the Borg (cmd-misc.c L140, main-win.c L3396). */
  BORG: 0x0020,
} as const;

/**
 * The two upstream build switches that decide whether NOSCORE_BORG exists and
 * whether it disqualifies a score. Upstream expresses these as #ifdefs
 * (player.h L97-99 wraps the bit in ALLOW_BORG; score.c L292-297 skips the borg
 * branch when SCORE_BORGS is defined), so the port records the configuration it
 * builds under as named constants instead of leaving the choice implicit.
 *
 * ALLOW_BORG: true. The Borg ships as a bundled mod (decision 31), so the bit
 * exists and can be set.
 * SCORE_BORGS: false, matching upstream's default - a borg-played character is
 * not eligible for the high-score table.
 */
export const ALLOW_BORG = true;
export const SCORE_BORGS = false;

/**
 * The cheat bits that invalidate a high-score entry (score.c L289-298).
 * NOSCORE_WIZARD | NOSCORE_DEBUG always disqualify; NOSCORE_BORG additionally
 * does so only under ALLOW_BORG && !SCORE_BORGS, which is this port's
 * configuration. NOSCORE_JUMPING is deliberately absent: it is a transient
 * generation marker, not a scoring disqualifier.
 */
export const NOSCORE_SCORE_INVALIDATING =
  NOSCORE.WIZARD |
  NOSCORE.DEBUG |
  (ALLOW_BORG && !SCORE_BORGS ? NOSCORE.BORG : 0);

/** markNoscore (obj-mark analogue): OR cheat bits into a noscore value. Pure. */
export function markNoscore(current: number, bits: number): number {
  return (current | bits) & 0xffff;
}

/**
 * noscoreInvalidatesScore (score.c L289): true when the character's cheat flags
 * disqualify it from the high-score table.
 */
export function noscoreInvalidatesScore(noscore: number): boolean {
  return (noscore & NOSCORE_SCORE_INVALIDATING) !== 0;
}

/* ------------------------------------------------------------------ *
 * effect_simple plumbing.
 * ------------------------------------------------------------------ */

/** Parameters passed straight through to registry.effectSimple. */
interface SimpleParams {
  diceString?: string;
  subtype?: number;
  radius?: number;
  other?: number;
  y?: number;
  x?: number;
  none?: boolean;
}

/** Build a game effect context (the same shape spellCast / useAux build). */
function effContext(state: GameState, eff: WizEffectDeps): EffectContext {
  const base = buildEffectContext(state, eff.envDeps as EffectEnvDeps);
  return attachGameEnv(base, {
    state,
    cast: eff.cast as CastContext,
    ...(eff.teleport ? { teleport: eff.teleport } : {}),
    ...(eff.general ? { general: eff.general } : {}),
    ...(eff.item ? { item: eff.item } : {}),
    ...(eff.summon ? { summon: eff.summon } : {}),
  });
}

/** Run one effect_simple with a player (or none) source; false if no bundle. */
function runSimple(
  state: GameState,
  eff: WizEffectDeps | undefined,
  index: number,
  params: SimpleParams,
): boolean {
  if (!eff) return false;
  const ctx = effContext(state, eff);
  return eff.registry.effectSimple(index, ctx, {
    origin: params.none ? sourceNone() : sourcePlayer(),
    diceString: params.diceString ?? "0",
    subtype: params.subtype ?? 0,
    radius: params.radius ?? 0,
    other: params.other ?? 0,
    y: params.y ?? 0,
    x: params.x ?? 0,
  });
}

/* ------------------------------------------------------------------ *
 * Shared object-creation building blocks (cmd-wizard.c L139-L302).
 * ------------------------------------------------------------------ */

/**
 * wiz_create_object_from_kind (cmd-wizard.c L169): a fresh instance of a kind,
 * money made as gold, everything else prepped and given plain magic (no
 * messages, no artifacts).
 */
export function wizCreateObjectFromKind(
  state: GameState,
  kind: ObjectKind,
  makeDeps: MakeDeps,
): GameObject {
  if (tvalIsMoney(kind.tval)) {
    return makeGold(state.rng, makeDeps, state.chunk.depth, kind.name);
  }
  const obj = objectPrep(
    state.rng,
    makeDeps.reg,
    makeDeps.constants,
    kind,
    state.chunk.depth,
    "randomise",
  );
  /* apply_magic(obj, depth, allow_artifacts=false, good=false, great=false,
   * extra=false). */
  applyMagic(state.rng, makeDeps, obj, state.chunk.depth, false, false, false, false, state.chunk.depth);
  return obj;
}

/**
 * wiz_create_object_from_artifact (cmd-wizard.c L139): instantiate an artifact
 * on its base kind and mark it created in the shared registry (L157), so the
 * normal generation paths will not spawn it again.
 */
export function wizCreateObjectFromArtifact(
  state: GameState,
  art: Artifact,
  makeDeps: MakeDeps,
): GameObject | null {
  if (!art.name) return null;
  const kind = makeDeps.reg.lookupKind(art.tval, art.sval);
  if (!kind) return null;
  const obj = objectPrep(
    state.rng,
    makeDeps.reg,
    makeDeps.constants,
    kind,
    art.allocMin,
    "randomise",
  );
  obj.artifact = art;
  copyArtifactData(state.rng, makeDeps.reg, obj, art);
  makeDeps.artifacts.markCreated(art.aidx, true);
  return obj;
}

/**
 * wiz_drop_object (cmd-wizard.c L292): mark the object as a cheat and drop it
 * from heaven near the player.
 */
export function wizDropObject(state: GameState, obj: GameObject | null): void {
  if (!obj) return;
  obj.origin = ORIGIN.CHEAT;
  obj.originDepth = state.chunk.depth;
  dropNear(state, obj, 0, state.actor.grid, true, true);
}

/* ------------------------------------------------------------------ *
 * The command actions.
 * ------------------------------------------------------------------ */

/**
 * do_cmd_wiz_acquire (L389): acquire `quantity` good (or great) objects and
 * drop them near the player. Wires to make_object (the acquirement() loop).
 */
export function wizAcquire(
  state: GameState,
  params: { quantity: number; great?: boolean },
  deps: WizardDeps,
): boolean {
  if (!debugEnabled(deps) || !deps.makeDeps) return false;
  const great = params.great ?? false;
  for (let i = 0; i < params.quantity; i++) {
    /* acquirement: make_object(cave, level, good=true, great, extra=true). */
    const obj = makeObject(
      state.rng,
      deps.makeDeps,
      state.chunk.depth,
      true,
      great,
      true,
      0,
      state.chunk.depth,
    );
    if (!obj) continue;
    obj.origin = ORIGIN.ACQUIRE;
    obj.originDepth = state.chunk.depth;
    dropNear(state, obj, 0, state.actor.grid, true, true);
  }
  return true;
}

/**
 * do_cmd_wiz_advance (L414): max stats, a heap of gold, level 50, full HP/SP.
 */
export function wizAdvance(state: GameState, deps: WizardDeps): boolean {
  if (!debugEnabled(deps) || !deps.expDeps) return false;
  const p = state.actor.player;
  for (let i = 0; i < STAT_MAX; i++) {
    p.statCur[i] = 118;
    p.statMax[i] = 118;
  }
  p.au = 1000000;
  playerExpGain(p, PY_MAX_EXP, deps.expDeps);
  p.chp = p.mhp;
  p.chpFrac = 0;
  p.csp = p.msp;
  p.cspFrac = 0;
  return true;
}

/**
 * do_cmd_wiz_banish (L449): delete every monster within `range` grids
 * (measured by mon->cdis, as upstream).
 */
export function wizBanish(
  state: GameState,
  params: { range: number },
  deps: WizardDeps,
): boolean {
  if (!debugEnabled(deps)) return false;
  for (let i = 1; i < monsterMax(state); i++) {
    const mon = state.monsters[i];
    if (!mon) continue;
    if (mon.cdis > params.range) continue;
    deleteMonster(state, i);
  }
  return true;
}

/**
 * do_cmd_wiz_create_all_artifact (L728): create every artifact and drop them.
 */
export function wizCreateAllArtifact(state: GameState, deps: WizardDeps): boolean {
  if (!debugEnabled(deps) || !deps.makeDeps || !deps.artifacts) return false;
  for (let i = 1; i < deps.artifacts.length; i++) {
    const art = deps.artifacts[i];
    if (!art) continue;
    wizDropObject(state, wizCreateObjectFromArtifact(state, art, deps.makeDeps));
  }
  return true;
}

/**
 * do_cmd_wiz_create_all_artifact_from_tval (L746): create every artifact of a
 * given tval.
 */
export function wizCreateAllArtifactFromTval(
  state: GameState,
  params: { tval: number },
  deps: WizardDeps,
): boolean {
  if (!debugEnabled(deps) || !deps.makeDeps || !deps.artifacts) return false;
  for (let i = 1; i < deps.artifacts.length; i++) {
    const art = deps.artifacts[i];
    if (!art || art.tval !== params.tval) continue;
    wizDropObject(state, wizCreateObjectFromArtifact(state, art, deps.makeDeps));
  }
  return true;
}

/**
 * do_cmd_wiz_create_all_obj (L780): create one of every ordinary kind (skip
 * instant-artifact kinds) and drop them.
 */
export function wizCreateAllObj(state: GameState, deps: WizardDeps): boolean {
  if (!debugEnabled(deps) || !deps.makeDeps) return false;
  const kinds = deps.makeDeps.reg.kinds;
  for (const kind of kinds) {
    if (!kind || !kind.base || !kind.base.name) continue;
    if (kind.kindFlags.has(KF_INSTA_ART)) continue;
    wizDropObject(state, wizCreateObjectFromKind(state, kind, deps.makeDeps));
  }
  return true;
}

/**
 * do_cmd_wiz_create_all_obj_from_tval (L803): create one of every kind with a
 * given tval; `art` selects whether instant-artifact kinds are included.
 */
export function wizCreateAllObjFromTval(
  state: GameState,
  params: { tval: number; art?: boolean },
  deps: WizardDeps,
): boolean {
  if (!debugEnabled(deps) || !deps.makeDeps) return false;
  const art = params.art ?? false;
  for (const kind of deps.makeDeps.reg.kinds) {
    if (!kind || kind.tval !== params.tval) continue;
    if (!art && kind.kindFlags.has(KF_INSTA_ART)) continue;
    wizDropObject(state, wizCreateObjectFromKind(state, kind, deps.makeDeps));
  }
  return true;
}

/**
 * do_cmd_wiz_create_artifact (L842): create one artifact by index.
 */
export function wizCreateArtifact(
  state: GameState,
  params: { index: number },
  deps: WizardDeps,
): boolean {
  if (!debugEnabled(deps) || !deps.makeDeps || !deps.artifacts) return false;
  const ind = params.index;
  if (ind < 1 || ind >= deps.artifacts.length) {
    deps.msg?.("That's not a valid artifact.");
    return false;
  }
  const art = deps.artifacts[ind];
  if (!art) {
    deps.msg?.("That's not a valid artifact.");
    return false;
  }
  wizDropObject(state, wizCreateObjectFromArtifact(state, art, deps.makeDeps));
  return true;
}

/**
 * do_cmd_wiz_create_obj (L873): create one object of a kind by index.
 */
export function wizCreateObj(
  state: GameState,
  params: { index: number },
  deps: WizardDeps,
): boolean {
  if (!debugEnabled(deps) || !deps.makeDeps) return false;
  const kinds = deps.makeDeps.reg.kinds;
  const ind = params.index;
  if (ind < 0 || ind >= kinds.length) {
    deps.msg?.("That's not a valid kind of object.");
    return false;
  }
  const kind = kinds[ind];
  if (!kind) {
    deps.msg?.("That's not a valid kind of object.");
    return false;
  }
  wizDropObject(state, wizCreateObjectFromKind(state, kind, deps.makeDeps));
  return true;
}

/**
 * do_cmd_wiz_create_trap (L904): place a trap of type `index` under the player
 * when the grid permits it.
 */
export function wizCreateTrap(
  state: GameState,
  params: { index: number },
  deps: WizardDeps,
): boolean {
  if (!debugEnabled(deps) || !deps.trapDeps) return false;
  const grid = state.actor.grid;
  const tidx = params.index;
  if (
    !state.chunk.isFloor(grid) ||
    squareIsTrap(state, grid) ||
    squareIsWebbed(state, grid) ||
    floorPile(state, grid).length > 0
  ) {
    deps.msg?.("You can't place a trap there!");
    return false;
  }
  if (state.chunk.depth === 0) {
    deps.msg?.("You can't place a trap in the town!");
    return false;
  }
  if (tidx < 1 || tidx >= deps.trapDeps.kinds.length) {
    deps.msg?.("Trap not found.");
    return false;
  }
  placeTrap(state, grid, tidx, 0, deps.trapDeps);
  return true;
}

/**
 * do_cmd_wiz_cure_all (L941): remove equipment curses, restore every stat and
 * lost experience, top HP/SP, clear the affliction timers and feed the player.
 */
export function wizCureAll(state: GameState, deps: WizardDeps): boolean {
  if (!debugEnabled(deps) || !deps.effect) return false;
  const p = state.actor.player;

  /* Remove curses from equipped items. */
  for (const handle of p.equipment) {
    if (!handle) continue;
    const obj = state.gear.store.get(handle);
    if (obj && obj.curses) obj.curses = null;
  }

  const ctx = effContext(state, deps.effect);

  /* Restore stats (EF_RESTORE_STAT, one per stat) and lost experience. */
  for (let i = 0; i < STAT_MAX; i++) {
    deps.effect.registry.effectSimple(EF.RESTORE_STAT, ctx, {
      origin: sourcePlayer(),
      diceString: "0",
      subtype: i,
    });
  }
  deps.effect.registry.effectSimple(EF.RESTORE_EXP, ctx, {
    origin: sourceNone(),
    diceString: "0",
  });

  /* Heal and restore mana. */
  p.chp = p.mhp;
  p.chpFrac = 0;
  p.csp = p.msp;
  p.cspFrac = 0;

  /* Cure the affliction timers (player_clear_timed). */
  const timed = ctx.player?.timed;
  if (timed) {
    for (const idx of CURE_ALL_TIMED) timed.clearTimed(idx, true, false);
    /* No longer hungry (player_set_timed FOOD). */
    timed.setTimed(TMD.FOOD, PY_FOOD_FULL - 1, false, false);
  }

  deps.msg?.("You feel *much* better!");
  return true;
}

/** The affliction timers cure_all clears (cmd-wizard.c L972-981). */
const CURE_ALL_TIMED: readonly number[] = [
  TMD.BLIND,
  TMD.CONFUSED,
  TMD.POISONED,
  TMD.AFRAID,
  TMD.PARALYZED,
  TMD.IMAGE,
  TMD.STUN,
  TMD.CUT,
  TMD.SLOW,
  TMD.AMNESIA,
];

/**
 * do_cmd_wiz_curse_item (L1004): add a curse (power > 0) or remove one
 * (power == 0) on an item. The "which item / which curse" prompts are the
 * shell's; the object, curse index and power arrive as parameters.
 */
export function wizCurseItem(
  state: GameState,
  params: { obj: GameObject; index: number; power: number },
  deps: WizardDeps,
): boolean {
  if (!debugEnabled(deps) || !deps.curses) return false;
  const { obj, index, power } = params;
  if (index <= 0 || index >= deps.curses.length) return false;
  if (power < 0) return false;
  if (power) {
    appendObjectCurse(state.rng, obj, index, power, deps.curses);
  } else if (!removeObjectCurse(obj, index)) {
    return false;
  }
  wizPlayItemStandardUpkeep(state, obj); /* L1057. */
  return true;
}

/**
 * wiz_play_item_standard_upkeep (cmd-wizard.c L370): "the typical updates needed
 * to upkeep flags after playing with an item". Of PU_BONUS | PU_INVEN |
 * PN_COMBINE | PR_INVEN | PR_EQUIP - or PR_ITEMLIST for an uncarried object -
 * only the notice bit is owed; the rest is the ratified update/redraw divergence
 * (game/known.ts:153). Since only the carried branch raises it, an object being
 * edited on the floor asks for nothing.
 *
 * Six C call sites, one per editing command (L568, L1057, L1715, L2351, L2783,
 * and twice inside the WIZ_TWEAK macro at L2828/L2847). All are wired; the
 * WIZ_TWEAK pair collapses into wizTweakItem's single tail because the macro's
 * two expansions are the same statement on the same object.
 */
function wizPlayItemStandardUpkeep(state: GameState, obj: GameObject): void {
  if (!objectIsCarried(state.gear, obj)) return;
  state.actor.player.upkeep.notice |= PN.COMBINE;
}

/**
 * do_cmd_wiz_detect_all_local (L1068): detect traps / doors / stairs / gold /
 * objects / visible + invisible monsters in a 22x40 rectangle.
 */
export function wizDetectAllLocal(state: GameState, deps: WizardDeps): boolean {
  if (!debugEnabled(deps) || !deps.effect) return false;
  const local: SimpleParams = { y: 22, x: 40 };
  runSimple(state, deps.effect, EF.DETECT_TRAPS, local);
  runSimple(state, deps.effect, EF.DETECT_DOORS, local);
  runSimple(state, deps.effect, EF.DETECT_STAIRS, local);
  runSimple(state, deps.effect, EF.DETECT_GOLD, local);
  runSimple(state, deps.effect, EF.DETECT_OBJECTS, local);
  runSimple(state, deps.effect, EF.DETECT_VISIBLE_MONSTERS, local);
  runSimple(state, deps.effect, EF.DETECT_INVISIBLE_MONSTERS, local);
  return true;
}

/**
 * do_cmd_wiz_detect_all_monsters (L1091): detect all monsters in a 500x500
 * rectangle (i.e. the whole level).
 */
export function wizDetectAllMonsters(state: GameState, deps: WizardDeps): boolean {
  if (!debugEnabled(deps) || !deps.effect) return false;
  const whole: SimpleParams = { y: 500, x: 500 };
  runSimple(state, deps.effect, EF.DETECT_VISIBLE_MONSTERS, whole);
  runSimple(state, deps.effect, EF.DETECT_INVISIBLE_MONSTERS, whole);
  return true;
}

/**
 * do_cmd_wiz_magic_map (L1418): map the area around the player (22x40).
 */
export function wizMagicMap(state: GameState, deps: WizardDeps): boolean {
  if (!debugEnabled(deps) || !deps.effect) return false;
  return runSimple(state, deps.effect, EF.MAP_AREA, { y: 22, x: 40 });
}

/**
 * do_cmd_wiz_hit_all_los (L1303): PROJECT_LOS 10000 damage as PROJ_DISP_ALL
 * (dispel every monster in line of sight).
 */
export function wizHitAllLos(state: GameState, deps: WizardDeps): boolean {
  if (!debugEnabled(deps) || !deps.effect) return false;
  return runSimple(state, deps.effect, EF.PROJECT_LOS, {
    diceString: "10000",
    subtype: PROJ.DISP_ALL,
  });
}

/**
 * do_cmd_wiz_edit_player_exp (L1137): set the player's experience to `value`,
 * clamped to [0, PY_MAX_EXP], gaining or losing to reach it.
 */
export function wizEditPlayerExp(
  state: GameState,
  params: { value: number },
  deps: WizardDeps,
): boolean {
  if (!debugEnabled(deps) || !deps.expDeps) return false;
  const p = state.actor.player;
  const newv = Math.min(PY_MAX_EXP, Math.max(0, params.value));
  if (newv > p.exp) {
    playerExpGain(p, newv - p.exp, deps.expDeps);
  } else {
    playerExpLose(p, p.exp - newv, false, deps.expDeps);
  }
  return true;
}

/**
 * do_cmd_wiz_edit_player_gold (L1169): set the player's gold to `value`,
 * clamped to [0, INT32_MAX].
 */
export function wizEditPlayerGold(
  state: GameState,
  params: { value: number },
  deps: WizardDeps,
): boolean {
  if (!debugEnabled(deps)) return false;
  state.actor.player.au = Math.min(2147483647, Math.max(0, params.value));
  return true;
}

/**
 * do_cmd_wiz_edit_player_stat (L1247): set one stat to `value`, clamped to
 * [3, 118].
 */
export function wizEditPlayerStat(
  state: GameState,
  params: { stat: number; value: number },
  deps: WizardDeps,
): boolean {
  if (!debugEnabled(deps)) return false;
  const { stat } = params;
  if (stat < 0 || stat >= STAT_MAX) return false;
  const newv = Math.min(118, Math.max(3, params.value));
  const p = state.actor.player;
  p.statCur[stat] = newv;
  p.statMax[stat] = newv;
  return true;
}

/**
 * do_cmd_wiz_increase_exp (L1314): gain `quantity` (>= 1) experience.
 */
export function wizIncreaseExp(
  state: GameState,
  params: { quantity: number },
  deps: WizardDeps,
): boolean {
  if (!debugEnabled(deps) || !deps.expDeps) return false;
  const n = params.quantity < 1 ? 1 : params.quantity;
  playerExpGain(state.actor.player, n, deps.expDeps);
  return true;
}

/**
 * do_cmd_wiz_jump_level (L1339): jump to dungeon level `level` (dungeon_change_
 * level - the port signals a pending level change). Out-of-range is a no-op.
 *
 * `chooseGen` is the answer to "Choose cave profile? " (L1360-1363). It is the
 * ONLY thing that sets NOSCORE_JUMPING (L1365-1367), and that bit is not really
 * a cheat marker: choose_profile consumes it as the one-shot signal to ask which
 * profile to build (generate.c:824). Marking it unconditionally - which this
 * function used to do - both mis-flags the savefile and would make every jump
 * ask for a profile name.
 */
export function wizJumpLevel(
  state: GameState,
  params: { level: number; chooseGen?: boolean },
  deps: WizardDeps,
): boolean {
  if (!debugEnabled(deps)) return false;
  const level = params.level;
  if (level < 0 || level >= state.z.maxDepth) return false;
  /* player->noscore |= NOSCORE_JUMPING (cmd-wizard.c L1366). */
  if (params.chooseGen) deps.markNoscore?.(NOSCORE.JUMPING);
  deps.msg?.(`You jump to dungeon level ${level}.`);
  state.targetDepth = level;
  state.generateLevel = true;
  return true;
}

/**
 * do_cmd_wiz_learn_object_kinds (L1386): make the player aware of every kind up
 * to `level`. Awareness lives in the per-game FlavorKnowledge in the port.
 */
export function wizLearnObjectKinds(
  state: GameState,
  params: { level: number },
  deps: WizardDeps,
): boolean {
  if (!debugEnabled(deps) || !deps.makeDeps || !deps.flavor) return false;
  for (const kind of deps.makeDeps.reg.kinds) {
    if (!kind || !kind.name) continue;
    if (kind.level <= params.level) deps.flavor.setAware(kind);
  }
  deps.msg?.("You now know about many items!");
  return true;
}

/**
 * do_cmd_wiz_recall_monster (L2161): fully learn a monster race's lore, or all
 * races when `all` is set.
 */
export function wizRecallMonster(
  state: GameState,
  params: { race?: MonsterRace; all?: boolean },
  deps: WizardDeps,
): boolean {
  if (!debugEnabled(deps)) return false;
  if (params.all) {
    if (!deps.races) return false;
    for (const race of deps.races) {
      if (race) cheatMonsterLore(race, getLore(state.lore, race));
    }
    return true;
  }
  if (!params.race) return false;
  cheatMonsterLore(params.race, getLore(state.lore, params.race));
  return true;
}

/**
 * do_cmd_wiz_wipe_recall (L2860): forget a monster race's lore, or all races.
 */
export function wizWipeRecall(
  state: GameState,
  params: { race?: MonsterRace; all?: boolean },
  deps: WizardDeps,
): boolean {
  if (!debugEnabled(deps)) return false;
  if (params.all) {
    if (!deps.races) return false;
    for (const race of deps.races) {
      if (race) wipeMonsterLore(race, getLore(state.lore, race));
    }
    return true;
  }
  if (!params.race) return false;
  wipeMonsterLore(params.race, getLore(state.lore, params.race));
  return true;
}

/**
 * do_cmd_wiz_rerate (L2209): reroll the player's per-level hitpoint table until
 * it lands in the legal band, and report the life rating. Returns the rating.
 */
export function wizRerate(state: GameState, deps: WizardDeps): number | null {
  if (!debugEnabled(deps)) return null;
  const p = state.actor.player;
  let minValue = Math.trunc((PY_MAX_LEVEL * 3 * (p.hitdie - 1)) / 8);
  minValue += PY_MAX_LEVEL;
  let maxValue = Math.trunc((PY_MAX_LEVEL * 5 * (p.hitdie - 1)) / 8);
  maxValue += PY_MAX_LEVEL;

  p.playerHp[0] = p.hitdie;

  for (;;) {
    for (let i = 1; i < PY_MAX_LEVEL; i++) {
      p.playerHp[i] = state.rng.randint1(p.hitdie) + (p.playerHp[i - 1] as number);
    }
    const top = p.playerHp[PY_MAX_LEVEL - 1] as number;
    if (top >= minValue && top <= maxValue) break;
  }

  const percent = Math.trunc(
    ((p.playerHp[PY_MAX_LEVEL - 1] as number) * 200) /
      (p.hitdie + (PY_MAX_LEVEL - 1) * p.hitdie),
  );
  deps.msg?.(`Current Life Rating is ${percent}/100.`);
  return percent;
}

/**
 * do_cmd_wiz_reroll_item (L2254): reroll a non-artifact item on its kind at the
 * player's depth. `roll` is 0 normal, 1 good, 2 excellent (good + great). The
 * rerolled properties are written back onto the object in place.
 */
export function wizRerollItem(
  state: GameState,
  params: { obj: GameObject; roll: number },
  deps: WizardDeps,
): boolean {
  if (!debugEnabled(deps) || !deps.makeDeps) return false;
  const { obj } = params;
  if (obj.artifact) return false;
  const good = params.roll >= 1;
  const great = params.roll >= 2;

  const fresh = objectPrep(
    state.rng,
    deps.makeDeps.reg,
    deps.makeDeps.constants,
    obj.kind,
    state.chunk.depth,
    "randomise",
  );
  applyMagic(state.rng, deps.makeDeps, fresh, state.chunk.depth, false, good, great, false, state.chunk.depth);

  /* Copy the rolled combat / property values back onto the target object,
   * keeping its identity and pile position (obj is not a fresh allocation
   * here, so pile links stay intact). */
  obj.ego = fresh.ego;
  obj.dd = fresh.dd;
  obj.ds = fresh.ds;
  obj.ac = fresh.ac;
  obj.toA = fresh.toA;
  obj.toH = fresh.toH;
  obj.toD = fresh.toD;
  obj.weight = fresh.weight;
  for (let i = 0; i < obj.modifiers.length; i++) {
    obj.modifiers[i] = fresh.modifiers[i] as number;
  }
  obj.flags.copy(fresh.flags);
  obj.slays = fresh.slays;
  obj.brands = fresh.brands;
  obj.curses = fresh.curses;
  for (let i = 0; i < obj.elInfo.length; i++) {
    const dst = obj.elInfo[i]!;
    const src = fresh.elInfo[i]!;
    dst.resLevel = src.resLevel;
    dst.flags = src.flags;
  }
  obj.origin = ORIGIN.CHEAT;
  /* L2349-2354. Upstream branches on the command's "update" choice between this
   * and wiz_play_item_notify_changed (a UI-only signal); called unconditionally
   * here because the false branch is the play-item flow, whose Accept raises the
   * same bit anyway, and a bit set twice is set once.
   *
   * Note that obj.weight was just overwritten from the reroll without touching
   * upkeep->total_weight. That is upstream's wart, not an omission - C's
   * object_copy at L2336 does the same - and core keeps warts. */
  wizPlayItemStandardUpkeep(state, obj);
  return true;
}

/**
 * do_cmd_wiz_tweak_item (L2698): apply the complete DATA command. The shell
 * owns the prompts; the values arrive as parameters. Every field is optional;
 * only supplied fields are changed. Selecting an ego or artifact follows C's
 * object_prep + ego_apply_magic / copy_artifact_data sequence, including its
 * RNG draws, before the scalar modifier prompts are applied.
 */
export function wizTweakItem(
  state: GameState,
  params: {
    obj: GameObject;
    ego?: EgoItem | null;
    artifact?: Artifact | null;
    modifiers?: readonly number[];
    toA?: number;
    toH?: number;
    toD?: number;
  },
  deps: WizardDeps,
): boolean {
  if (!debugEnabled(deps)) return false;
  const { obj } = params;
  if (obj.artifact) return false;

  const copyPreparedFields = (fresh: GameObject): void => {
    /* object_prep mutates the existing C object while preserving its pile /
     * identity fields. Copy the generated fields back while retaining those
     * live carrier fields in the port's object model. */
    obj.ego = fresh.ego;
    obj.artifact = fresh.artifact;
    obj.tval = fresh.tval;
    obj.sval = fresh.sval;
    obj.pval = fresh.pval;
    obj.weight = fresh.weight;
    obj.dd = fresh.dd;
    obj.ds = fresh.ds;
    obj.ac = fresh.ac;
    obj.toA = fresh.toA;
    obj.toH = fresh.toH;
    obj.toD = fresh.toD;
    obj.flags.copy(fresh.flags);
    for (let i = 0; i < obj.modifiers.length; i++) {
      obj.modifiers[i] = fresh.modifiers[i] as number;
    }
    for (let i = 0; i < obj.elInfo.length; i++) {
      obj.elInfo[i]!.resLevel = fresh.elInfo[i]!.resLevel;
      obj.elInfo[i]!.flags = fresh.elInfo[i]!.flags;
    }
    obj.brands = fresh.brands ? [...fresh.brands] : null;
    obj.slays = fresh.slays ? [...fresh.slays] : null;
    obj.curses = fresh.curses ? fresh.curses.map((c) => ({ ...c })) : null;
    obj.effect = fresh.effect;
    obj.effectMsg = fresh.effectMsg;
    obj.activation = fresh.activation;
    obj.time = { ...fresh.time };
    obj.timeout = fresh.timeout;
  };

  if (params.ego !== undefined) {
    if (params.ego && !deps.makeDeps) return false;
    if (params.ego && deps.makeDeps) {
      const fresh = objectPrep(
        state.rng,
        deps.makeDeps.reg,
        deps.makeDeps.constants,
        obj.kind,
        state.chunk.depth,
        "randomise",
      );
      fresh.ego = params.ego;
      egoApplyMagic(state.rng, deps.makeDeps.reg, fresh, state.chunk.depth);
      copyPreparedFields(fresh);
    } else {
      obj.ego = null;
    }
  }

  if (params.artifact !== undefined) {
    if (params.artifact && !deps.makeDeps) return false;
    if (params.artifact && deps.makeDeps) {
      const fresh = objectPrep(
        state.rng,
        deps.makeDeps.reg,
        deps.makeDeps.constants,
        obj.kind,
        params.artifact.allocMin,
        "randomise",
      );
      fresh.ego = null;
      fresh.artifact = params.artifact;
      copyArtifactData(state.rng, deps.makeDeps.reg, fresh, params.artifact);
      copyPreparedFields(fresh);
    } else {
      obj.artifact = null;
    }
  }
  if (params.modifiers) {
    for (let i = 0; i < obj.modifiers.length && i < params.modifiers.length; i++) {
      obj.modifiers[i] = params.modifiers[i] as number;
    }
  }
  if (params.toA !== undefined) obj.toA = params.toA;
  if (params.toH !== undefined) obj.toH = params.toH;
  if (params.toD !== undefined) obj.toD = params.toD;
  /* L2783 plus the WIZ_TWEAK macro's own two calls (L2828, L2847). */
  wizPlayItemStandardUpkeep(state, obj);
  return true;
}

/**
 * do_cmd_wiz_summon_named (L2569): summon a specific monster near the player.
 * Wires to scatter_ext + place_new_monster, trying up to 10 empty grids.
 */
export function wizSummonNamed(
  state: GameState,
  params: { race: MonsterRace },
  deps: WizardDeps,
): boolean {
  if (!debugEnabled(deps) || !deps.monPlace) return false;
  const info = { index: 0, role: MON_GROUP.LEADER };
  for (let i = 0; i < 10; i++) {
    const spots = scatterExt(state.chunk, state.rng, 1, state.actor.grid, 1, true, (_c, g) =>
      squareIsEmptyLive(state, g),
    );
    if (spots.length === 0) {
      deps.msg?.("Could not place monster.");
      return false;
    }
    /* wiz_create_monster (cmd-wizard.c L2614-2615): ORIGIN_DROP_WIZARD. */
    if (
      placeNewMonster(
        state,
        spots[0]!,
        params.race,
        true,
        true,
        info,
        deps.monPlace,
        ORIGIN.DROP_WIZARD,
      )
    ) {
      return true;
    }
  }
  deps.msg?.("Could not place monster.");
  return false;
}

/**
 * do_cmd_wiz_summon_random (L2629): summon `quantity` random monsters near the
 * player (one EF_SUMMON per monster, value 1).
 */
export function wizSummonRandom(
  state: GameState,
  params: { quantity: number },
  deps: WizardDeps,
): boolean {
  if (!debugEnabled(deps) || !deps.effect) return false;
  const n = params.quantity < 1 ? 1 : params.quantity;
  for (let i = 0; i < n; i++) {
    runSimple(state, deps.effect, EF.SUMMON, { diceString: "1" });
  }
  return true;
}

/**
 * do_cmd_wiz_teleport_random (L2651): teleport the player a given range.
 */
export function wizTeleportRandom(
  state: GameState,
  params: { range: number },
  deps: WizardDeps,
): boolean {
  if (!debugEnabled(deps) || !deps.effect || params.range < 1) return false;
  return runSimple(state, deps.effect, EF.TELEPORT, {
    diceString: String(params.range),
  });
}

/**
 * do_cmd_wiz_teleport_to (L2673): teleport the player onto a target grid, if it
 * is passable.
 */
export function wizTeleportTo(
  state: GameState,
  params: { grid: Loc },
  deps: WizardDeps,
): boolean {
  if (!debugEnabled(deps) || !deps.effect) return false;
  if (!state.chunk.isPassable(params.grid)) {
    deps.msg?.("The square you are aiming for is impassable.");
    return false;
  }
  return runSimple(state, deps.effect, EF.TELEPORT_TO, {
    y: params.grid.y,
    x: params.grid.x,
  });
}

/**
 * do_cmd_wiz_push_object (L1871): push the pile off a chosen grid.
 */
export function wizPushObject(
  state: GameState,
  params: { grid: Loc },
  deps: WizardDeps,
): boolean {
  if (!debugEnabled(deps)) return false;
  pushObject(state, params.grid);
  return true;
}

/**
 * do_cmd_wiz_wizard_light (L2907): permanently light and know the whole level.
 */
export function wizWizardLight(state: GameState, deps: WizardDeps): boolean {
  if (!debugEnabled(deps)) return false;
  /* wiz_light(cave, player, true) (cmd-wizard.c:2909): the wizard command is
   * always the `full` form, so it square_know_piles rather than sense_piles. */
  wizLightLevel(state, true, true);
  return true;
}

/**
 * wiz_cheat_death (wiz-debug.c L28): survive a lethal blow - reset age, refill
 * HP/SP, cure the afflictions, feed, cancel recall / deep descent and return to
 * town. The recall / deep-descent counters are player upkeep the port carries
 * on the player; word_recall / deep_descent live there.
 */
export function wizCheatDeath(state: GameState, deps: WizardDeps): boolean {
  /* player->wizard || OPT(player, cheat_live) (player-util.c L246); the caller
   * (game/take-hit-hooks.ts) enforces the cheat_live half. */
  if (!wizardEnabled(deps)) return false;
  const p = state.actor.player;
  /* player->noscore |= NOSCORE_WIZARD (wiz-debug.c L32). */
  deps.markNoscore?.(NOSCORE.WIZARD);
  p.age = 1;
  state.isDead = false;
  p.chp = p.mhp;
  p.chpFrac = 0;
  p.csp = p.msp;
  p.cspFrac = 0;

  /* Timed clear + food need the effect/timed bundle (wiz-debug.c L43-53). When
   * the shell has not assembled it yet, HP/SP/age still revive (W2-009). */
  if (deps.effect) {
    const ctx = effContext(state, deps.effect);
    const timed = ctx.player?.timed;
    if (timed) {
      for (const idx of CHEAT_DEATH_TIMED) timed.clearTimed(idx, true, false);
      timed.setTimed(TMD.FOOD, PY_FOOD_FULL - 1, false, false);
    }
  }

  /* Cancel recall (wiz-debug.c L56-64) and deep descent (L67-74). Both are
   * counters on the player, so zeroing them is state, not UI - and without this
   * a cheated death left a pending recall or descent still counting down in
   * process_world, which would fire from the town you were just returned to. */
  if (p.wordRecall) {
    deps.msg?.("A tension leaves the air around you...");
    p.wordRecall = 0;
  }
  if (p.deepDescent) {
    deps.msg?.("The air around you stops swirling...");
    p.deepDescent = 0;
  }

  /* my_strcpy(p->died_from, "Cheating death", ...) (wiz-debug.c L78). The
   * take-hit hook wrote the real killer here before the prompt, which is C's
   * order too (player-util.c L244 runs before get_check); upstream then
   * overwrites it on the way out. Without this the character carries the name
   * of the monster it did not die to. */
  p.diedFrom = "Cheating death";

  /* Back to the town. */
  state.targetDepth = 0;
  state.generateLevel = true;
  return true;
}

/** The affliction timers cheat_death clears (wiz-debug.c L43-50). */
const CHEAT_DEATH_TIMED: readonly number[] = [
  TMD.BLIND,
  TMD.CONFUSED,
  TMD.POISONED,
  TMD.AFRAID,
  TMD.PARALYZED,
  TMD.IMAGE,
  TMD.STUN,
  TMD.CUT,
];

/* ------------------------------------------------------------------ *
 * Item debug shells (cmd-wizard.c): the non-UI engine / data halves.
 * The Term rendering (wiz_display_item's prt / prt_binary flag grid) and the
 * command-queue menu loops stay with the shell (WP-14); these return the data
 * the shell needs or perform the concrete state change it drives.
 * ------------------------------------------------------------------ */

/**
 * The DATA half of wiz_display_item (cmd-wizard.c L190-283): the scalar item
 * facts the debug panel prints. The Term_clear / prt line layout and the
 * vertical prt_binary flag grid are the shell's; this returns the values.
 *
 * `all` chooses whether the combat-plus fields (to-hit / to-dam / to-ac) and
 * the flag set come from the fully-real object or from what is known: upstream
 * reads object_to_hit(all ? obj : obj->known) and object_flags[_known](obj).
 * The port's known twin is a GameObject, supplied as `known`; when `all` is
 * false and `known` is given, the "+" fields and flagsKnown read from it.
 * object_flags(obj) is just a copy of obj.flags (obj-util.c L353); the "known"
 * flag set is the twin's flags (obj.flags when no twin is threaded).
 */
export interface WizItemDisplay {
  /** obj->dd (always from the real object). */
  dd: number;
  /** obj->ds. */
  ds: number;
  /** object_to_hit(all ? obj : obj->known). */
  toH: number;
  /** object_to_dam(all ? obj : obj->known). */
  toD: number;
  /** obj->ac. */
  ac: number;
  /** object_to_ac(all ? obj : obj->known). */
  toA: number;
  /** obj->kind->kidx. */
  kidx: number;
  tval: number;
  sval: number;
  /** object_weight_one(obj). */
  weight: number;
  /** obj->timeout. */
  timeout: number;
  /** obj->number. */
  number: number;
  /** obj->pval. */
  pval: number;
  /** obj->artifact ? aidx : 0 (upstream "name1"). */
  name1: number;
  /** obj->ego ? eidx : -1 (upstream "egoidx"). */
  egoidx: number;
  /** object_value(obj, 1). */
  cost: number;
  /** object_flags(obj): the full flag set (== obj.flags). */
  flags: FlagSet;
  /** object_flags_known(obj): the known flag set (the twin's, or obj's). */
  flagsKnown: FlagSet;
}

export function wizDisplayItem(
  obj: GameObject,
  deps: WizardDeps,
  opts: { all?: boolean; known?: GameObject | null } = {},
): WizItemDisplay | null {
  if (!debugEnabled(deps) || !deps.makeDeps) return null;
  const all = opts.all ?? true;
  const known = opts.known ?? null;
  /* The object the "+" combat fields and the known flag set are read from. */
  const view = all ? obj : known ?? obj;
  return {
    dd: obj.dd,
    ds: obj.ds,
    toH: view.toH,
    toD: view.toD,
    ac: obj.ac,
    toA: view.toA,
    kidx: obj.kind.kidx,
    tval: obj.tval,
    sval: obj.sval,
    weight: objectWeightOne(obj, deps.curses),
    timeout: obj.timeout,
    number: obj.number,
    pval: obj.pval,
    name1: obj.artifact ? obj.artifact.aidx : 0,
    egoidx: obj.ego ? obj.ego.eidx : -1,
    cost: objectValue(deps.makeDeps.reg, obj, 1, true),
    flags: obj.flags,
    flagsKnown: (known ?? obj).flags,
  };
}

/** The outcome of wizChangeItemQuantity, for the shell's feedback. */
export interface WizQuantityResult {
  /** The number the stack ended up at (unchanged when the edit was refused). */
  number: number;
  /** The ceiling MIN(max_stack, charge limit, quiver limit) that was applied. */
  max: number;
  /** Whether obj.number actually changed. */
  changed: boolean;
}

/**
 * do_cmd_wiz_change_item_quantity (CMD_WIZ_CHANGE_ITEM_QUANTITY, cmd-wizard.c
 * L484-575), the [q] entry of the do_cmd_wiz_play_item session (L1771-1789).
 *
 * Refuses an equipped item ("Can not change the quantity of an equipped item.",
 * L495) and any artifact ("Can not modify the quantity of an artifact.", L501),
 * then computes the ceiling nmax the same three ways upstream does (L505-517):
 *   - obj->kind->base->max_stack, always;
 *   - for a charge-carrying device with pval > 0, (MAX_PVAL * number) / pval, so
 *     the scaled-up charges cannot overflow MAX_PVAL;
 *   - for a quiver item, quiver_slot_size / (ammo ? 1 : thrown_quiver_mult).
 * The requested count is then clamped to [1, nmax] (L520 MAX(1, MIN(nmax, n))).
 *
 * Upstream warts preserved: charges and timeouts are rescaled by INTEGER
 * division `(pval * n) / number` BEFORE obj->number is assigned (L524-530), so
 * both reads use the OLD number; and the whole body is skipped when n equals the
 * current number, leaving charges untouched. `update` false suppresses only the
 * weight/upkeep refresh (L551-570), never the number change itself.
 *
 * The PU_BONUS / PU_INVEN / PN_COMBINE / PR_* upkeep bits are UI (the shell's);
 * the carried-weight arithmetic upstream does alongside them IS state and is
 * applied here.
 */
export function wizChangeItemQuantity(
  state: GameState,
  params: {
    obj: GameObject;
    /** The gear handle, when the item is carried (absent for a floor item). */
    handle?: number;
    /** cmd_get_arg_number "quantity". */
    quantity: number;
    /** cmd_get_arg_choice "update"; absent behaves as upstream's !CMD_OK. */
    update?: boolean;
  },
  deps: WizardDeps,
): WizQuantityResult | null {
  if (!debugEnabled(deps) || !deps.makeDeps) return null;
  const { obj, handle } = params;
  const p = state.actor.player;

  /* cmd-wizard.c L494-497: an explicitly supplied equipped item is refused. */
  if (handle !== undefined && p.equipment.includes(handle)) {
    deps.msg?.("Can not change the quantity of an equipped item.");
    return null;
  }
  /* L499-503: artifacts are one of a kind. */
  if (obj.artifact) {
    deps.msg?.("Can not modify the quantity of an artifact.");
    return null;
  }

  const z = deps.makeDeps.constants;
  let nmax = obj.kind.base.maxStack;
  if (tvalCanHaveCharges(obj.tval) && obj.pval > 0 && obj.number > 0) {
    nmax = Math.min(Math.trunc((MAX_PVAL * obj.number) / obj.pval), nmax);
  }
  if (handle !== undefined && objectIsInQuiver(state.gear, handle)) {
    nmax = Math.min(
      Math.trunc(
        z.quiverSlotSize / (tvalIsAmmo(obj.tval) ? 1 : z.thrownQuiverMult),
      ),
      nmax,
    );
  }

  const n = Math.max(1, Math.min(nmax, params.quantity));
  if (n === obj.number) return { number: obj.number, max: nmax, changed: false };

  /* L523-530: rescale charges / timeouts against the OLD number. */
  if (tvalCanHaveCharges(obj.tval) && obj.number > 0) {
    obj.pval = Math.trunc((obj.pval * n) / obj.number);
  }
  if (tvalCanHaveTimeout(obj.tval) && obj.number > 0) {
    obj.timeout = Math.trunc((obj.timeout * n) / obj.number);
  }

  /* L532-570: with "update" absent or true, restate the carried weight. */
  if ((params.update ?? true) && handle !== undefined) {
    const one = objectWeightOne(obj, deps.curses);
    p.upkeep.totalWeight -= obj.number * one;
    p.upkeep.totalWeight += n * one;
  }

  obj.number = n;
  wizPlayItemStandardUpkeep(state, obj); /* L568. */
  return { number: n, max: nmax, changed: true };
}

/**
 * wizPlayItemBegin (do_cmd_wiz_play_item, cmd-wizard.c L1642-1645): snapshot the
 * object so the [t]weak / [r]eroll / [c]urse edits can be rejected. Upstream
 * allocates a fresh object and object_copy()s the working item into it; the port
 * uses objectCopy (obj/object.ts) which produces the same value snapshot.
 * Returns the preserved copy the shell hands back to Accept / Reject.
 */
export function wizPlayItemBegin(
  obj: GameObject,
  deps: WizardDeps,
): GameObject | null {
  if (!debugEnabled(deps)) return null;
  return objectCopy(obj);
}

/** The mutable item properties wiz_play_item's reject restores (object_copy). */
function restoreItemFields(dst: GameObject, src: GameObject): void {
  dst.kind = src.kind;
  dst.ego = src.ego;
  dst.artifact = src.artifact;
  dst.tval = src.tval;
  dst.sval = src.sval;
  dst.pval = src.pval;
  dst.weight = src.weight;
  dst.dd = src.dd;
  dst.ds = src.ds;
  dst.ac = src.ac;
  dst.toA = src.toA;
  dst.toH = src.toH;
  dst.toD = src.toD;
  dst.flags.copy(src.flags);
  for (let i = 0; i < dst.modifiers.length; i++) {
    dst.modifiers[i] = src.modifiers[i] as number;
  }
  for (let i = 0; i < dst.elInfo.length; i++) {
    const d = dst.elInfo[i]!;
    const s = src.elInfo[i]!;
    d.resLevel = s.resLevel;
    d.flags = s.flags;
  }
  dst.brands = src.brands ? [...src.brands] : null;
  dst.slays = src.slays ? [...src.slays] : null;
  dst.curses = src.curses ? src.curses.map((c) => ({ ...c })) : null;
  dst.effect = src.effect;
  dst.effectMsg = src.effectMsg;
  dst.activation = src.activation;
  dst.time = { ...src.time };
  dst.timeout = src.timeout;
  dst.number = src.number;
  dst.notice = src.notice;
  dst.origin = src.origin;
  dst.originDepth = src.originDepth;
  dst.originRace = src.originRace;
}

/**
 * wizPlayItemReject (do_cmd_wiz_play_item, cmd-wizard.c L1822-1843): the play
 * session was abandoned with changes; copy the preserved original back onto the
 * working object in place. Upstream restores the pile links after object_copy;
 * the port mutates the existing object (its pile membership is by array position
 * in floor/gear, not per-object links), so no link fix-up is needed.
 */
export function wizPlayItemReject(
  obj: GameObject,
  original: GameObject,
  deps: WizardDeps,
): boolean {
  if (!debugEnabled(deps)) return false;
  restoreItemFields(obj, original);
  return true;
}

/**
 * wizPlayItemAccept (do_cmd_wiz_play_item, cmd-wizard.c L1679-1718): commit the
 * changes.
 *
 * Upstream does FOUR things under `if (object_changed)`, in this order:
 *   1. L1685-1706 — if the object is carried AND either its number or its
 *      object_weight_one has changed, subtract the old stack's weight from
 *      upkeep->total_weight and add the new one's.
 *   2. L1707 — object_touch(player, obj), which marks the object assessed and
 *      logs an artifact find.
 *   3. L1708-1714 — if it is EQUIPPED, clear the known WORN notice and re-run
 *      object_learn_on_wield.
 *   4. wiz_play_item_standard_upkeep (redraws; the shell's job here).
 *
 * Only (3) was ported. (1) was excused as "the total_weight / redraw upkeep is
 * UI (the shell's)", and that reading was true when it was written and is not
 * now: `upkeep.totalWeight` became a real running total in the fix for
 * PORT_TODO 1.2, so an editor that changes an item's quantity or weight and does
 * not adjust it desynchronises the burden the speed penalty reads. The sibling
 * command already knew this - runChangeQuantity has done the same arithmetic at
 * :1470 all along - so the two halves of one wizard screen disagreed.
 *
 * `original` is the wizPlayItemBegin snapshot, needed because the diff is
 * against the pre-edit stack, not against zero.
 */
export function wizPlayItemAccept(
  state: GameState,
  obj: GameObject,
  original: GameObject,
  params: { changed: boolean; equipped: boolean },
  deps: WizardDeps,
): boolean {
  if (!debugEnabled(deps)) return false;
  if (!params.changed) return true;

  const p = state.actor.player;
  /* (1) L1685-1706. The `carried` gate is upstream's: an object being edited
   * off the floor has no weight in the player's total to correct. */
  if (objectIsCarried(state.gear, obj)) {
    const wasOne = objectWeightOne(original, state.gear.curses);
    const nowOne = objectWeightOne(obj, state.gear.curses);
    if (obj.number !== original.number || nowOne !== wasOne) {
      p.upkeep.totalWeight -= original.number * wasOne;
      p.upkeep.totalWeight += obj.number * nowOne;
    }
  }

  /* (2) L1707. Unconditional within `changed` - not gated on equipped, which is
   * why it cannot be folded into the branch below. */
  objectTouch(obj, {
    ...(obj.artifact ? { onArtifactFound: (): void => state.onArtifactFound?.(obj.artifact!) } : {}),
  });

  /* (3) L1708-1714. */
  if (params.equipped) {
    obj.notice &= ~OBJ_NOTICE_WORN;
    objectLearnOnWield(state.actor.player, obj, state.runeEnv);
    updatePlayerObjectKnowledge(state); /* player_learn_rune sweep (L1373). */
  }

  /* (4) L1715-1716. The step this function stopped one line short of when the
   * first three landed - the docblock even said "L1708-1714". An edit that
   * changes the item's identity is exactly when the pack may need combining. */
  wizPlayItemStandardUpkeep(state, obj);
  return true;
}

/** OBJ_NOTICE_WORN: the "has been worn" learn gate cleared on accept. */
const OBJ_NOTICE_WORN = OBJ_NOTICE.WORN;

/** The classification of one make_object roll against the target (stat_item). */
export interface WizStatItemResult {
  /** Rolls actually performed. */
  rolls: number;
  /** Same tval/sval, all modifiers and to_a/to_h/to_d equal. */
  matches: number;
  /** Same or better across every tested property, and strictly better once. */
  better: number;
  /** Same or worse across every tested property, and strictly worse once. */
  worse: number;
  /** Same tval/sval but neither strictly better nor worse (a mix). */
  other: number;
}

/**
 * do_cmd_wiz_stat_item (cmd-wizard.c L2386-2562): roll `nRolls` items with
 * make_object at `level` and classify each as match / better / worse / other
 * against the target object. `roll` is 0 normal, 1 good, 2 excellent (good +
 * great). The interrupt polling and the running Term readout are UI and are
 * omitted; the classification math, RNG draw order and the artifact-preserve
 * quirk are faithful.
 *
 * Upstream quirk preserved (L2504-2506, L2559-2561): it marks the TARGET
 * object's artifact uncreated before each roll (so make_object may regenerate
 * it) and re-marks it created at the end - note it tests obj->artifact, the
 * target's, not the rolled test object's, exactly as upstream does.
 */
export function wizStatItem(
  state: GameState,
  params: { obj: GameObject; roll: number; level: number; nRolls?: number },
  deps: WizardDeps,
): WizStatItemResult | null {
  if (!debugEnabled(deps) || !deps.makeDeps) return null;
  const { obj } = params;
  const good = params.roll >= 1;
  const great = params.roll >= 2;
  const level = params.level;
  const n = params.nRolls ?? TEST_ROLL;

  let matches = 0;
  let better = 0;
  let worse = 0;
  let other = 0;
  let i = 0;
  for (; i < n; i++) {
    /* make_object(cave, level, good, great, false, NULL, 0). */
    const test = makeObject(state.rng, deps.makeDeps, level, good, great, false, 0, level);

    /* Allow the target artifact to be regenerated (L2504-2506). */
    if (obj.artifact) deps.makeDeps.artifacts.markCreated(obj.artifact.aidx, false);

    if (!test) continue;

    /* Same tval and sval? (L2512-2516) */
    if (obj.tval !== test.tval || obj.sval !== test.sval) continue;

    /* Compare modifiers (L2518-2528). */
    let isMatch = true;
    let isBetter = true;
    let isWorse = true;
    for (let j = 0; j < OBJ_MOD_MAX; j++) {
      const tm = test.modifiers[j] as number;
      const om = obj.modifiers[j] as number;
      if (tm !== om) {
        isMatch = false;
        if (tm < om) isBetter = false;
        else isWorse = false;
      }
    }

    if (isMatch && test.toA === obj.toA && test.toH === obj.toH && test.toD === obj.toD) {
      matches++;
    } else if (isBetter && test.toA >= obj.toA && test.toH >= obj.toH && test.toD >= obj.toD) {
      better++;
    } else if (isWorse && test.toA <= obj.toA && test.toH <= obj.toH && test.toD <= obj.toD) {
      worse++;
    } else {
      other++;
    }
  }

  /* Normally leave a single artifact created (L2559-2561). */
  if (obj.artifact) deps.makeDeps.artifacts.markCreated(obj.artifact.aidx, true);

  return { rolls: i, matches, better, worse, other };
}

/** TEST_ROLL (cmd-wizard.c L2385): the default sample size. */
const TEST_ROLL = 100000;

/**
 * do_cmd_wiz_edit_player_start (cmd-wizard.c L1202-1239): the batch player
 * editor. Upstream chains a queued CMD_WIZ_EDIT_PLAYER_STAT per stat plus a
 * gold and an exp edit through the edit_player_state machine; the queue
 * plumbing is UI. The engine effect is: apply the six stat edits, the gold
 * edit, and the exp edit. Each field is optional; a supplied value is applied
 * through the already-ported per-field editor (same clamps), so an absent field
 * is left unchanged (the shell's "cancel this stage" path).
 */
export function wizEditPlayerStart(
  state: GameState,
  params: {
    stats?: readonly (number | undefined)[];
    gold?: number;
    exp?: number;
  },
  deps: WizardDeps,
): boolean {
  if (!debugEnabled(deps)) return false;
  if (params.stats) {
    for (let stat = 0; stat < STAT_MAX && stat < params.stats.length; stat++) {
      const v = params.stats[stat];
      if (v !== undefined) wizEditPlayerStat(state, { stat, value: v }, deps);
    }
  }
  if (params.gold !== undefined) wizEditPlayerGold(state, { value: params.gold }, deps);
  if (params.exp !== undefined) wizEditPlayerExp(state, { value: params.exp }, deps);
  return true;
}

/* ------------------------------------------------------------------ *
 * The map QUERY commands (DATA half only; the highlight redraw is the shell's).
 * ------------------------------------------------------------------ */

/**
 * do_cmd_wiz_query_feature (L1930, DATA half): the fully-in-bounds grids whose
 * feature is one of `features`. The shell highlights them.
 */
export function wizQueryFeature(
  state: GameState,
  params: { features: readonly number[] },
  deps: WizardDeps,
): Loc[] {
  if (!debugEnabled(deps)) return [];
  const out: Loc[] = [];
  const c = state.chunk;
  for (let y = 1; y < c.height - 1; y++) {
    for (let x = 1; x < c.width - 1; x++) {
      const grid = { x, y };
      if (params.features.includes(c.feat(grid))) out.push(grid);
    }
  }
  return out;
}

/**
 * do_cmd_wiz_query_square_flag (L2105, DATA half): the fully-in-bounds grids
 * carrying a SQUARE_* flag; flag 0 selects the known grids (as upstream).
 */
export function wizQuerySquareFlag(
  state: GameState,
  params: { flag: number },
  deps: WizardDeps,
): Loc[] {
  if (!debugEnabled(deps)) return [];
  const out: Loc[] = [];
  const c = state.chunk;
  for (let y = 1; y < c.height - 1; y++) {
    for (let x = 1; x < c.width - 1; x++) {
      const grid = { x, y };
      const show = params.flag
        ? c.sqinfoHas(grid, params.flag)
        : squareIsKnown(state, grid);
      if (show) out.push(grid);
    }
  }
  return out;
}

/**
 * do_cmd_wiz_peek_noise_scent (L1477, DATA half): the fully-in-bounds grids at
 * exactly `depth` on the chosen flow heatmap ("noise" or "scent"). The shell
 * steps depth from 0 upward and highlights each returned set.
 */
export function wizPeekFlow(
  state: GameState,
  params: { depth: number; which: "noise" | "scent" },
  deps: WizardDeps,
): Loc[] {
  if (!debugEnabled(deps)) return [];
  const out: Loc[] = [];
  const c = state.chunk;
  const map = params.which === "scent" ? c.scent : c.noise;
  for (let y = 1; y < c.height - 1; y++) {
    for (let x = 1; x < c.width - 1; x++) {
      if (map[y * c.width + x] === params.depth) out.push({ x, y });
    }
  }
  return out;
}

/** KF_INSTA_ART: the kind-flag marking instant-artifact base kinds. */
const KF_INSTA_ART = KF.INSTA_ART;
