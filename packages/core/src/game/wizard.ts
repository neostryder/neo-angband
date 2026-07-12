/**
 * The WIZARD / DEBUG command surface, ported from Angband 4.2.6:
 *   - reference/src/cmd-wizard.c   (the do_cmd_wiz_* command actions)
 *   - reference/src/wiz-debug.c    (wiz_cheat_death)
 *
 * These are debug / cheat commands. Upstream gates them behind ALLOW_DEBUG and
 * flags the character with NOSCORE_WIZARD; a normal, faithful game (this
 * project's design decision 16: no save-scumming, faithful play) must never
 * reach them. The port keeps that gate as an explicit `wizard` boolean on the
 * WizardDeps seam: every action here is a no-op refusal when `wizard` is false,
 * so the wizard surface is a dev affordance behind a flag exactly like upstream.
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
 * DEFERRED (see parity/ledger/wizard-debug.yaml for the full list with
 * reasons): the wiz-spoil.c spoiler generators, the three Monte-Carlo stats
 * collectors (do_cmd_wiz_collect_*), and the pure interactive shells
 * do_cmd_wiz_play_item / _display_item / _stat_item / _edit_player_start.
 */

import { EF, KF, ORIGIN, PROJ, TMD } from "../generated";
import type { Loc } from "../loc";
import { PLAYER_EXP, PY_MAX_EXP, playerExpGain, playerExpLose } from "../player/exp";
import type { ExpDeps } from "../player/exp";
import { PY_MAX_LEVEL } from "../player/calcs";
import { STAT_MAX } from "../player/types";
import {
  applyMagic,
  copyArtifactData,
  makeGold,
  makeObject,
  objectPrep,
} from "../obj/make";
import type { MakeDeps } from "../obj/make";
import { appendObjectCurse, removeObjectCurse, tvalIsMoney } from "../obj/object";
import type { GameObject } from "../obj/object";
import type { Artifact, Curse, ObjectKind } from "../obj/types";
import type { FlavorKnowledge } from "../obj/knowledge";
import { MON_GROUP } from "../mon/types";
import type { MonsterRace } from "../mon/types";
import { PY_FOOD_FULL_DEFAULT as PY_FOOD_FULL } from "../player/birth";
import { cheatMonsterLore, getLore, wipeMonsterLore } from "../mon/lore";
import { sourceNone, sourcePlayer } from "../effects/interpreter";
import type { EffectContext } from "../effects/interpreter";
import { scatterExt } from "../world/scatter";
import { deleteMonster, monsterMax, squareIsEmpty } from "./context";
import type { GameState } from "./context";
import { dropNear, floorPile } from "./floor";
import { placeNewMonster } from "./mon-place";
import type { MonPlaceDeps } from "./mon-place";
import { placeTrap, squareIsTrap, squareIsWebbed } from "./trap";
import type { TrapDeps } from "./trap";
import { pushObject } from "./project-feat";
import { wizLightLevel } from "./effect-terrain";
import { squareIsKnown } from "./known";
import { buildEffectContext } from "./effect-env";
import type { EffectEnvDeps } from "./effect-env";
import { attachGameEnv } from "./effect-game-env";
import type { CastContext } from "./project-cast";
import type { ObjCmdDeps } from "./obj-cmd";

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
   * The wizard/debug gate (upstream ALLOW_DEBUG + NOSCORE_WIZARD). When false,
   * every wizard action is a no-op refusal and no game state changes.
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
  /** The full curse list (reg.curses), for curse_item. */
  curses?: readonly (Curse | null)[];
  /** msg(): command feedback. */
  msg?: (text: string) => void;
}

/** requireWizard: the gate. Returns false (and no-ops) when not in wizard mode. */
export function wizardEnabled(deps: WizardDeps): boolean {
  return deps.wizard === true;
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
  dropNear(state, obj, 0, state.actor.grid, true);
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
  if (!wizardEnabled(deps) || !deps.makeDeps) return false;
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
    dropNear(state, obj, 0, state.actor.grid, true);
  }
  return true;
}

/**
 * do_cmd_wiz_advance (L414): max stats, a heap of gold, level 50, full HP/SP.
 */
export function wizAdvance(state: GameState, deps: WizardDeps): boolean {
  if (!wizardEnabled(deps) || !deps.expDeps) return false;
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
  if (!wizardEnabled(deps)) return false;
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
  if (!wizardEnabled(deps) || !deps.makeDeps || !deps.artifacts) return false;
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
  if (!wizardEnabled(deps) || !deps.makeDeps || !deps.artifacts) return false;
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
  if (!wizardEnabled(deps) || !deps.makeDeps) return false;
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
  if (!wizardEnabled(deps) || !deps.makeDeps) return false;
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
  if (!wizardEnabled(deps) || !deps.makeDeps || !deps.artifacts) return false;
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
  if (!wizardEnabled(deps) || !deps.makeDeps) return false;
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
  if (!wizardEnabled(deps) || !deps.trapDeps) return false;
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
  if (!wizardEnabled(deps) || !deps.effect) return false;
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
  if (!wizardEnabled(deps) || !deps.curses) return false;
  const { obj, index, power } = params;
  if (index <= 0 || index >= deps.curses.length) return false;
  if (power < 0) return false;
  if (power) {
    appendObjectCurse(state.rng, obj, index, power, deps.curses);
  } else if (!removeObjectCurse(obj, index)) {
    return false;
  }
  return true;
}

/**
 * do_cmd_wiz_detect_all_local (L1068): detect traps / doors / stairs / gold /
 * objects / visible + invisible monsters in a 22x40 rectangle.
 */
export function wizDetectAllLocal(state: GameState, deps: WizardDeps): boolean {
  if (!wizardEnabled(deps) || !deps.effect) return false;
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
  if (!wizardEnabled(deps) || !deps.effect) return false;
  const whole: SimpleParams = { y: 500, x: 500 };
  runSimple(state, deps.effect, EF.DETECT_VISIBLE_MONSTERS, whole);
  runSimple(state, deps.effect, EF.DETECT_INVISIBLE_MONSTERS, whole);
  return true;
}

/**
 * do_cmd_wiz_magic_map (L1418): map the area around the player (22x40).
 */
export function wizMagicMap(state: GameState, deps: WizardDeps): boolean {
  if (!wizardEnabled(deps) || !deps.effect) return false;
  return runSimple(state, deps.effect, EF.MAP_AREA, { y: 22, x: 40 });
}

/**
 * do_cmd_wiz_hit_all_los (L1303): PROJECT_LOS 10000 damage as PROJ_DISP_ALL
 * (dispel every monster in line of sight).
 */
export function wizHitAllLos(state: GameState, deps: WizardDeps): boolean {
  if (!wizardEnabled(deps) || !deps.effect) return false;
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
  if (!wizardEnabled(deps) || !deps.expDeps) return false;
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
  if (!wizardEnabled(deps)) return false;
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
  if (!wizardEnabled(deps)) return false;
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
  if (!wizardEnabled(deps) || !deps.expDeps) return false;
  const n = params.quantity < 1 ? 1 : params.quantity;
  playerExpGain(state.actor.player, n, deps.expDeps);
  return true;
}

/**
 * do_cmd_wiz_jump_level (L1339): jump to dungeon level `level` (dungeon_change_
 * level - the port signals a pending level change). Out-of-range is a no-op.
 */
export function wizJumpLevel(
  state: GameState,
  params: { level: number },
  deps: WizardDeps,
): boolean {
  if (!wizardEnabled(deps)) return false;
  const level = params.level;
  if (level < 0 || level >= state.z.maxDepth) return false;
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
  if (!wizardEnabled(deps) || !deps.makeDeps || !deps.flavor) return false;
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
  if (!wizardEnabled(deps)) return false;
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
  if (!wizardEnabled(deps)) return false;
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
  if (!wizardEnabled(deps)) return null;
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
  if (!wizardEnabled(deps) || !deps.makeDeps) return false;
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
  return true;
}

/**
 * do_cmd_wiz_tweak_item (L2698, DATA half): set a non-artifact item's ego /
 * artifact / modifiers / to_a / to_h / to_d directly. The shell owns the
 * prompts; the values arrive as parameters. Every field is optional; only the
 * supplied ones are changed. (ego_apply_magic / copy_artifact_data on an
 * ego/artifact set are the shell's follow-up and are not re-run here.)
 */
export function wizTweakItem(
  state: GameState,
  params: {
    obj: GameObject;
    ego?: import("../obj/types").EgoItem | null;
    artifact?: Artifact | null;
    modifiers?: readonly number[];
    toA?: number;
    toH?: number;
    toD?: number;
  },
  deps: WizardDeps,
): boolean {
  if (!wizardEnabled(deps)) return false;
  const { obj } = params;
  if (obj.artifact) return false;
  if (params.ego !== undefined) obj.ego = params.ego;
  if (params.artifact !== undefined) obj.artifact = params.artifact;
  if (params.modifiers) {
    for (let i = 0; i < obj.modifiers.length && i < params.modifiers.length; i++) {
      obj.modifiers[i] = params.modifiers[i] as number;
    }
  }
  if (params.toA !== undefined) obj.toA = params.toA;
  if (params.toH !== undefined) obj.toH = params.toH;
  if (params.toD !== undefined) obj.toD = params.toD;
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
  if (!wizardEnabled(deps) || !deps.monPlace) return false;
  const info = { index: 0, role: MON_GROUP.LEADER };
  for (let i = 0; i < 10; i++) {
    const spots = scatterExt(state.chunk, state.rng, 1, state.actor.grid, 1, true, (_c, g) =>
      squareIsEmpty(state, g),
    );
    if (spots.length === 0) {
      deps.msg?.("Could not place monster.");
      return false;
    }
    if (placeNewMonster(state, spots[0]!, params.race, true, true, info, deps.monPlace)) {
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
  if (!wizardEnabled(deps) || !deps.effect) return false;
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
  if (!wizardEnabled(deps) || !deps.effect || params.range < 1) return false;
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
  if (!wizardEnabled(deps) || !deps.effect) return false;
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
  if (!wizardEnabled(deps)) return false;
  pushObject(state, params.grid);
  return true;
}

/**
 * do_cmd_wiz_wizard_light (L2907): permanently light and know the whole level.
 */
export function wizWizardLight(state: GameState, deps: WizardDeps): boolean {
  if (!wizardEnabled(deps)) return false;
  wizLightLevel(state, true);
  return true;
}

/**
 * wiz_cheat_death (wiz-debug.c L28): survive a lethal blow - reset age, refill
 * HP/SP, cure the afflictions, feed, cancel recall / deep descent and return to
 * town. The recall / deep-descent counters are player upkeep the port carries
 * on the player; word_recall / deep_descent live there.
 */
export function wizCheatDeath(state: GameState, deps: WizardDeps): boolean {
  if (!wizardEnabled(deps) || !deps.effect) return false;
  const p = state.actor.player;
  p.age = 1;
  state.isDead = false;
  p.chp = p.mhp;
  p.chpFrac = 0;
  p.csp = p.msp;
  p.cspFrac = 0;

  const ctx = effContext(state, deps.effect);
  const timed = ctx.player?.timed;
  if (timed) {
    for (const idx of CHEAT_DEATH_TIMED) timed.clearTimed(idx, true, false);
    timed.setTimed(TMD.FOOD, PY_FOOD_FULL - 1, false, false);
  }

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
  if (!wizardEnabled(deps)) return [];
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
  if (!wizardEnabled(deps)) return [];
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
  if (!wizardEnabled(deps)) return [];
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

/**
 * do_cmd_wiz_dump_level_map (L1112, DATA half): the level's feature grid as
 * rows of feature indices. The shell renders / writes them (upstream writes an
 * HTML file; the file I/O is not ported).
 */
export function wizDumpLevelMap(state: GameState, deps: WizardDeps): number[][] {
  if (!wizardEnabled(deps)) return [];
  const c = state.chunk;
  const rows: number[][] = [];
  for (let y = 0; y < c.height; y++) {
    const row: number[] = [];
    for (let x = 0; x < c.width; x++) row.push(c.feat({ x, y }));
    rows.push(row);
  }
  return rows;
}

/** KF_INSTA_ART: the kind-flag marking instant-artifact base kinds. */
const KF_INSTA_ART = KF.INSTA_ART;
