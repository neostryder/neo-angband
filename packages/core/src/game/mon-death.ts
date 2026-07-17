/**
 * Monster death and its loot, ported from reference/src/mon-make.c:mon_create_drop
 * (L751), reference/src/mon-util.c:monster_death (L949) and
 * mon_take_nonplayer_hit / monster_take_terrain_damage (L1193, L1327), Angband
 * 4.2.6.
 *
 * DROP TIMING (faithful): drops are generated at PLACEMENT (monCreateDrop, called
 * from game/mon-place.ts place_new_monster_one) and carried onto the monster's
 * held pile via monster_carry, stamped with the placement origin (ORIGIN.DROP for
 * live spawns; DROP_PIT / DROP_VAULT / DROP_SUMMON for the matching generation
 * contexts). monster_death merely drops that pile to the floor. This matches the
 * upstream RNG-stream position (drops draw during level generation, not at death)
 * and preserves the true drop origins - the earlier "generate at death" deviation
 * is RESCINDED. WIRING-NEEDED: mon-place.ts must call monCreateDrop at placement
 * (see the WP-2 report); until it does, monsters carry no generated loot.
 *
 * mon_take_nonplayer_hit is the shared "a non-player source hurt this monster"
 * primitive (terrain, monster-vs-monster) that funnels through monster_death and
 * delete_monster_idx on a kill, mirroring mon_take_hit for player kills.
 */

import { KF, MON_MSG, ORIGIN, RF } from "../generated";
import type { Rng } from "../rng";
import type { GameObject } from "../obj/object";
import { tvalIsMoney } from "../obj/object";
import type { MakeDeps } from "../obj/make";
import {
  applyMagic,
  copyArtifactData,
  makeGold,
  makeObject,
  objectPrep,
} from "../obj/make";
import type { ObjRegistry } from "../obj/bind";
import { tvalFindIdx } from "../obj/bind";
import type { Monster } from "../mon/monster";
import { monCreateDropCount, monsterCarry } from "../mon/make";
import {
  monsterIsCamouflaged,
  monsterIsUnique,
  monsterIsVisible,
} from "../mon/predicate";
import { monsterScaredByDamage, monsterWake } from "../mon/take-hit";
import { MON_TMD } from "../generated";
import type { LoreStore } from "../mon/lore";
import { getLore, loreTreasure } from "../mon/lore";
import type { GameState } from "./context";
import { deleteMonster } from "./context";
import { monsterPrimaryGroupSize } from "./mon-group";
import { monsterRevertShape } from "./mon-shape";
import { formatMonsterMessage, formatPainMessage } from "./mon-message";
import type { FloorEnv } from "./floor";
import { dropNear, floorExcise, floorPile } from "./floor";

/** Everything monsterDeath needs beyond the GameState (all built in wireGame). */
export interface MonsterDeathDeps {
  /** MakeDeps for makeObject / makeGold / applyMagic / objectPrep. */
  makeDeps: MakeDeps;
  /** The object registry, for the specified-drop tval/kind/sval lookups. */
  reg: ObjRegistry;
  /** The floor drop environment (isIgnored / isTrap) for dropNear. */
  floorEnv: FloorEnv;
  /** The lore store, for the unique theft reduction and loreTreasure. */
  lore: LoreStore;
}

/**
 * The subset of ORIGIN_* values that monster_death (mon-util.c L975-982) counts
 * as a dropped item for lore. Generated drops carry their placement origin
 * (DROP / DROP_PIT / DROP_VAULT / DROP_SUMMON / ...); a stolen item keeps
 * ORIGIN.STOLEN and so is NOT counted.
 */
function isDropOrigin(origin: number): boolean {
  return (
    origin === ORIGIN.DROP ||
    origin === ORIGIN.DROP_PIT ||
    origin === ORIGIN.DROP_VAULT ||
    origin === ORIGIN.DROP_SUMMON ||
    origin === ORIGIN.DROP_SPECIAL ||
    origin === ORIGIN.DROP_BREED ||
    origin === ORIGIN.DROP_POLY ||
    origin === ORIGIN.DROP_WIZARD
  );
}

/**
 * mon_create_drop (mon-make.c L751): generate a monster's gold/items at
 * PLACEMENT and carry them onto its held pile (monster_carry), stamped with the
 * placement `origin` (ORIGIN.DROP for live spawns, DROP_PIT / DROP_VAULT /
 * DROP_SUMMON for the corresponding generation contexts). Returns whether
 * anything was carried. monster_death (below) later drops this pile.
 *
 * RNG DRAW ORDER (all via state.rng), faithful to mon_create_drop:
 *  1. mon_create_drop_count non-maximize (mon-make.c L775 / L721-734): the DROP_*
 *     rolls and the specified-drop loop (which draws even though its count is
 *     discarded here) - see mon/make.ts monCreateDropCount.
 *  2. QUESTOR/Morgoth QUEST_ART force-drop (L794): a level-100 QUESTOR force-drops
 *     every QUEST_ART artifact - object_prep(RANDOMISE) at lev 100 plus
 *     copy_artifact_data curse timeouts per artifact - BEFORE the specified-drop
 *     loop, matching upstream's stream position.
 *  3. specified-drops loop (L830): per entry randint0(100) gate FIRST, then object
 *     creation (objectPrep+applyMagic by-kind, or makeObject by-tval), then
 *     randint0(max-min) for the stack count.
 *  4. generic-drops loop (L867), `number` times: the gold/item decision draws
 *     randint0(100) ONLY when goldOk && itemOk are both true (C short-circuit),
 *     then makeGold/makeObject internals.
 * monster_carry never fails here (the port's held pile is unbounded), so
 * upstream's mark-uncreated / object_wipe rollback path is unreachable.
 */
export function monCreateDrop(
  state: GameState,
  mon: Monster,
  origin: number,
  deps: MonsterDeathDeps,
): boolean {
  const rng: Rng = state.rng;
  const { makeDeps, reg } = deps;
  const depth = state.chunk.depth;

  /* effective_race (mon-make.c L767): the pre-shapechange race, if any. */
  const effectiveRace = mon.originalRace ?? mon.race;
  const lore = getLore(deps.lore, mon.race);

  const great = effectiveRace.flags.has(RF.DROP_GREAT);
  const good = great || effectiveRace.flags.has(RF.DROP_GOOD);
  const goldOk = !effectiveRace.flags.has(RF.ONLY_ITEM);
  const itemOk = !effectiveRace.flags.has(RF.ONLY_GOLD);

  /* How many generic drops (mon-make.c L775). */
  let number = monCreateDropCount(rng, effectiveRace, false, false).number;

  /* Uniques that have been stolen from get their quantity reduced (L778). */
  if (monsterIsUnique(mon)) {
    number = Math.max(0, number - lore.thefts);
  }

  /* Unique bonus to the effective monster level (L783-787). */
  let monlevel = effectiveRace.level;
  let extraRoll = false;
  if (monsterIsUnique(mon)) {
    monlevel = Math.min(monlevel + 15, monlevel * 2);
    extraRoll = true;
  }

  /* Reward fighting OOD monsters (L791-792, integer division). */
  let level = Math.max(Math.trunc((monlevel + depth) / 2), monlevel);
  level = Math.min(level, 100);

  let any = false;

  /* Morgoth's QUEST_ART force-drop (mon-make.c L794-827). */
  if (effectiveRace.flags.has(RF.QUESTOR) && effectiveRace.level === 100) {
    for (let j = 1; j < reg.artifacts.length; j++) {
      const art = reg.artifacts[j];
      if (!art) continue;
      const kind = reg.lookupKind(art.tval, art.sval);
      if (!kind || !kind.kindFlags.has(KF.QUEST_ART)) continue;

      const obj = objectPrep(rng, reg, makeDeps.constants, kind, 100, "randomise");
      obj.artifact = art;
      copyArtifactData(rng, reg, obj, art);
      makeDeps.artifacts.markCreated(art.aidx, true);

      obj.origin = origin;
      obj.originDepth = depth;
      obj.originRace = effectiveRace.ridx;
      obj.number = 1;

      monsterCarry(mon.heldObj, obj, mon.midx);
      any = true;
    }
  }

  /* Specified drops (mon-make.c L830). */
  for (const drop of effectiveRace.drops) {
    if (rng.randint0(100) >= drop.percentChance) continue;

    const tvalNum = tvalFindIdx(drop.tval);
    let obj: GameObject | null;
    if (drop.sval !== null) {
      /* Specified by kind (drop->kind). */
      const sval = reg.lookupSval(tvalNum, drop.sval);
      const kind = reg.lookupKind(tvalNum, sval);
      if (!kind) continue;
      obj = objectPrep(rng, reg, makeDeps.constants, kind, level, "randomise");
      applyMagic(rng, makeDeps, obj, level, true, good, great, extraRoll, depth);
    } else {
      /* Specified by tval (drop->tval). */
      obj = makeObject(rng, makeDeps, level, good, great, extraRoll, tvalNum, depth);
    }

    if (!obj) continue;

    obj.origin = origin;
    obj.originDepth = depth;
    obj.originRace = effectiveRace.ridx;
    obj.number = obj.artifact
      ? 1
      : rng.randint0(drop.max - drop.min) + drop.min;

    monsterCarry(mon.heldObj, obj, mon.midx);
    any = true;
  }

  /* Generic drops (mon-make.c L867). */
  for (let j = 0; j < number; j++) {
    let obj: GameObject | null;
    if (goldOk && (!itemOk || rng.randint0(100) < 50)) {
      obj = makeGold(rng, makeDeps, level, "any");
    } else {
      obj = makeObject(rng, makeDeps, level, good, great, extraRoll, 0, depth);
      if (!obj) continue;
    }

    obj.origin = origin;
    obj.originDepth = depth;
    obj.originRace = effectiveRace.ridx;

    monsterCarry(mon.heldObj, obj, mon.midx);
    any = true;
  }

  return any;
}

/**
 * monster_death (mon-util.c L949): delete the monster's mimicked object, then
 * drop its held pile (the placement-time mon_create_drop items plus anything
 * stolen during play) to the floor at mon.grid, counting the drop for lore.
 * Silent on drops, as upstream. quest_check (L1005) rides the player-kill seam
 * (session/game.ts onPlayerKill), which is the only reachable quest-completing
 * path (only the player kills uniques / quest monsters).
 *
 * The old placement-vs-death drop deviation is RESCINDED: generation now runs at
 * placement (monCreateDrop, called from game/mon-place.ts), so drops land at the
 * upstream RNG-stream position and keep their true DROP_PIT / DROP_VAULT /
 * DROP_SUMMON origins. This function no longer draws generation RNG - only the
 * dropNear grid tie-breaks and loreTreasure.
 */
export function monsterDeath(
  state: GameState,
  mon: Monster,
  deps: MonsterDeathDeps,
): void {
  const rng: Rng = state.rng;
  const lore = getLore(deps.lore, mon.race);
  const visible = monsterIsVisible(mon) || monsterIsUnique(mon);

  /* Delete any mimicked object (mon-util.c L957-961): square_delete_object of
   * the fake floor item this monster was imitating, before dropping loot. */
  if (mon.mimickedObj) {
    const pile = floorPile(state, mon.grid);
    const fake = pile.find((o) => o.mimickingMIdx === mon.midx);
    if (fake) floorExcise(state, mon.grid, fake);
    mon.mimickedObj = 0;
  }

  /* Drop objects being carried (monster_death L963-992). */
  const held = mon.heldObj;
  mon.heldObj = [];

  let dumpItem = 0;
  let dumpGold = 0;
  for (const obj of held) {
    obj.heldMIdx = 0;

    /* Count it for lore BEFORE any origin change (L972-984). */
    if (tvalIsMoney(obj.tval) && obj.origin !== ORIGIN.STOLEN) {
      dumpGold++;
    } else if (!tvalIsMoney(obj.tval) && isDropOrigin(obj.origin)) {
      dumpItem++;
    }

    /* Change origin if the monster is invisible (L987-988). */
    if (!visible) obj.origin = ORIGIN.DROP_UNKNOWN;

    /* drop_near(cave, &obj, 0, mon->grid, true, false): chance 0, prefer_pile
     * FALSE (mon-util.c L990; the port's boolean slot is preferPile). */
    dropNear(state, obj, 0, mon.grid, false, deps.floorEnv);
  }

  /* Take note of any dropped treasure (monster_death L998-999). */
  if (visible && (dumpItem || dumpGold)) {
    loreTreasure(rng, lore, dumpItem, dumpGold);
  }

  /* DEFERRED: the PR_MONLIST redraw (L1002, UI). quest_check (L1005) is wired at
   * the player-kill seam (session/game.ts). */
}

/** The hooks mon_take_nonplayer_hit needs beyond the death deps. */
export interface NonplayerHitDeps extends MonsterDeathDeps {
  /** add_monster_message text sink (routes formatted lines to state.msg). */
  message?: (text: string) => void;
}

/**
 * The per-state registry the scheduler reads for terrain damage
 * (monster_take_terrain_damage runs inside process_monsters, which has no deps
 * of its own). The session installs the deps once after building the death
 * deps; absent, terrain damage is inert (the pre-port behaviour).
 */
const NONPLAYER_HIT_DEPS = new WeakMap<GameState, NonplayerHitDeps>();

/** Install the mon_take_nonplayer_hit deps for a state (session wiring). */
export function installNonplayerHitDeps(
  state: GameState,
  deps: NonplayerHitDeps,
): void {
  NONPLAYER_HIT_DEPS.set(state, deps);
}

/** The installed mon_take_nonplayer_hit deps for a state, or null. */
export function getNonplayerHitDeps(state: GameState): NonplayerHitDeps | null {
  return NONPLAYER_HIT_DEPS.get(state) ?? null;
}

/**
 * mon_take_nonplayer_hit (mon-util.c L1193): inflict `dam` on `tMon` from a
 * non-player source (terrain, another monster). Uniques/arena monsters cannot
 * be killed this way (damage is capped to leave them alive). Wakes the monster
 * without making it player-aware, applies damage, and on death reverts a
 * shapechange, shows the die message, generates loot (monster_death) and deletes
 * the monster; otherwise shows the hurt / pain message and rolls fear. Returns
 * whether the monster died. `hurtMsgCode` / `dieMsgCode` are MON_MSG_* indices
 * (MON_MSG_NONE for hurtMsg falls through to message_pain).
 */
export function monTakeNonplayerHit(
  state: GameState,
  tMon: Monster,
  dam: number,
  hurtMsgCode: number,
  dieMsgCode: number,
  deps: NonplayerHitDeps,
): boolean {
  const rng: Rng = state.rng;
  const emit = (text: string | null): void => {
    if (text) (deps.message ?? state.msg ?? (() => {}))(text);
  };

  /* "Unique" or arena monsters can only be "killed" by the player. */
  if (monsterIsUnique(tMon) || state.arenaLevel) {
    if (dam > tMon.hp) dam = tMon.hp;
  }

  /* Wake the monster up, but it does not become aware of the player. */
  monsterWake(rng, tMon, false, 0);

  /* Hurt the monster. */
  tMon.hp -= dam;

  if (tMon.hp < 0) {
    /* Shapechanged monsters revert on death. */
    if (tMon.originalRace) monsterRevertShape(state, tMon);

    /* Death message. */
    emit(formatMonsterMessage(tMon, dieMsgCode));

    /* Generate treasure and delete the monster. */
    monsterDeath(state, tMon, deps);
    deleteMonster(state, tMon.midx);
    return true;
  }

  /* Give detailed messages if visible and not camouflaged. */
  if (!monsterIsCamouflaged(tMon)) {
    if (hurtMsgCode !== MON_MSG.NONE) {
      emit(formatMonsterMessage(tMon, hurtMsgCode));
    } else if (dam > 0) {
      emit(formatPainMessage(tMon, dam));
    }
  }

  /* Sometimes a monster gets scared by damage (group fear-save per member). */
  if (!tMon.mTimed[MON_TMD.FEAR] && dam > 0) {
    monsterScaredByDamage(rng, tMon, dam, monsterPrimaryGroupSize(state, tMon));
  }

  return false;
}

/**
 * monster_take_terrain_damage (mon-util.c L1327): a monster standing on fiery
 * terrain it does not resist takes 100 + 1d100 fire damage via
 * mon_take_nonplayer_hit (MON_MSG_CATCH_FIRE / MON_MSG_DISINTEGRATES). Upstream
 * quirk preserved: the local `fear` flag is never set, so the FLEE_IN_TERROR
 * message never fires. square_isdamaging is feat_is_fiery in 4.2.6 (lava only).
 */
export function monsterTakeTerrainDamage(
  state: GameState,
  mon: Monster,
  deps: NonplayerHitDeps,
): void {
  if (!state.chunk.isFiery(mon.grid)) return;
  if (mon.race.flags.has(state.chunk.feature(mon.grid).resistFlag)) return;
  monTakeNonplayerHit(
    state,
    mon,
    100 + state.rng.randint1(100),
    MON_MSG.CATCH_FIRE,
    MON_MSG.DISINTEGRATES,
    deps,
  );
}
