/**
 * Monster death loot, ported from reference/src/mon-make.c:mon_create_drop
 * (L751) fused with reference/src/mon-util.c:monster_death (L949), Angband
 * 4.2.6.
 *
 * PLACEMENT-VS-DEATH DEVIATION (ledgered): upstream generates a monster's
 * drops at PLACEMENT (place_new_monster_one -> mon_create_drop), storing them
 * on the monster's held_obj pile via monster_carry, and monster_death merely
 * drops that pile to the floor. This port does NOT generate at placement (the
 * generation is deferred in game/mon-place.ts), so mon_create_drop's generation
 * is run HERE, at death, and its objects are carried onto mon.heldObj just
 * before the drop pass. Consequences:
 * - For a given (race, depth) the produced items match upstream's distribution,
 *   but their OFFSET in the global RNG stream differs from vanilla (upstream
 *   draws them during level generation). Accepted; full stream parity would
 *   need a real placement-time held pile.
 * - Stolen gold/items (attached to mon.heldObj during play by melee theft,
 *   monster_carry in game/mon-side.ts) genuinely accumulate on the monster and
 *   are dropped here alongside the generated drops. Because generation runs
 *   after theft (not before, as upstream), generated objects never merge into a
 *   stolen stack the way they might in vanilla; a minor edge-case difference.
 * - The placement origin (DROP_PIT / DROP_VAULT / DROP_SUMMON / ...) is lost:
 *   drops always get ORIGIN.DROP. Known low-severity fidelity gap.
 *
 * RNG DRAW ORDER within monsterDeath (all via state.rng), faithful to
 * mon_create_drop then monster_death:
 *  1. mon_create_drop_count non-maximize (mon-make.c L721-734): the DROP_* rolls
 *     and the specified-drop loop (which draws even though its count is discarded
 *     here) - see mon/make.ts monCreateDropCount.
 *  2. no RNG in the theft reduction, unique monlevel bump, or level calc.
 *  3. QUESTOR/Morgoth QUEST_ART force-drop (mon-make.c L794): a level-100
 *     QUESTOR force-drops every QUEST_ART artifact - object_prep(RANDOMISE) at
 *     lev 100 plus copy_artifact_data curse timeouts per artifact - inserted
 *     BEFORE the specified-drop loop, matching upstream's stream position.
 *  4. specified-drops loop (mon-make.c L830): per entry randint0(100) gate FIRST,
 *     then object creation (objectPrep+applyMagic by-kind, or makeObject by-tval),
 *     then randint0(max-min) for the stack count.
 *  5. generic-drops loop (mon-make.c L867), `number` times: the gold/item decision
 *     draws randint0(100) ONLY when goldOk && itemOk are both true (C short-circuit
 *     goldOk && (!itemOk || randint0(100) < 50)); then makeGold/makeObject internals.
 *  6. drop pass (monster_death L964-992): dropNear per held object draws
 *     dropFindGrid's oneIn(2) tie-breaks; loreTreasure draws up to two oneIn(4)
 *     when the kill is visible.
 * Generation (steps 4-5) fully precedes the drop pass (step 6): objects are
 * generated into a local prepend-built pile first, then dropped, matching the
 * upstream separation and the resulting floor-pile order.
 *
 * DEFERRED from monster_death (mon-util.c): mimicked-object deletion (L958,
 * mimics not modelled), quest_check (L1005, quest subsystem), the PR_MONLIST
 * redraw (UI).
 */

import { KF, ORIGIN, RF } from "../generated";
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
import { monsterIsUnique, monsterIsVisible } from "../mon/predicate";
import type { LoreStore } from "../mon/lore";
import { getLore, loreTreasure } from "../mon/lore";
import type { GameState } from "./context";
import type { FloorEnv } from "./floor";
import { dropNear } from "./floor";

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
 * as a dropped item for lore. In this port a generated drop is always
 * ORIGIN.DROP; the rest are enumerated for faithfulness (a stolen item keeps
 * its own origin and so is NOT counted).
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
 * mon_create_drop + monster_death: generate a dead monster's gold/items, carry
 * them onto its held pile, then drop the whole pile (held-then-generated, i.e.
 * stolen items first) to the floor at mon.grid. Silent on drops, as upstream.
 */
export function monsterDeath(
  state: GameState,
  mon: Monster,
  deps: MonsterDeathDeps,
): void {
  const rng: Rng = state.rng;
  const { makeDeps, reg } = deps;
  const depth = state.chunk.depth;

  /* effective_race (mon-make.c L767): shapechanged monsters have already
   * reverted by the time death runs, so originalRace is normally null. */
  const effectiveRace = mon.originalRace ?? mon.race;
  const lore = getLore(deps.lore, mon.race);

  const visible = monsterIsVisible(mon) || monsterIsUnique(mon);

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

  /* Build the generated pile in the same order upstream would (monster_carry
   * prepends), so the drop pass yields the same floor order. */
  const genHeld: GameObject[] = [];

  /* Morgoth's QUEST_ART force-drop (mon-make.c L794-827): a level-100 QUESTOR
   * drops every QUEST_ART artifact. Runs BEFORE the specified-drop loop so its
   * object_prep(RANDOMISE) at lev 100 lands at the same point in the stream as
   * upstream. Each is prepped from its base kind, stamped with the artifact
   * data, marked created, and carried. monster_carry never fails here (the
   * port's held pile is unbounded), so upstream's mark-uncreated rollback path
   * is unreachable. */
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

      obj.origin = ORIGIN.DROP;
      obj.originDepth = depth;
      obj.originRace = effectiveRace.ridx;
      obj.number = 1;

      monsterCarry(genHeld, obj, mon.midx);
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

    obj.origin = ORIGIN.DROP;
    obj.originDepth = depth;
    obj.originRace = effectiveRace.ridx;
    obj.number = obj.artifact
      ? 1
      : rng.randint0(drop.max - drop.min) + drop.min;

    monsterCarry(genHeld, obj, mon.midx);
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

    obj.origin = ORIGIN.DROP;
    obj.originDepth = depth;
    obj.originRace = effectiveRace.ridx;

    monsterCarry(genHeld, obj, mon.midx);
  }

  /* The full held pile at death: stolen items (accrued during play, newest
   * first) sit on top of the generated drops, exactly as upstream's held_obj
   * where placement-time drops are prepended first and theft prepends later. */
  const held = [...mon.heldObj, ...genHeld];
  mon.heldObj = [];

  /* Drop objects being carried (monster_death L964-992). */
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

  /* DEFERRED: mimicked-object deletion (L958), quest_check (L1005), the
   * PR_MONLIST redraw (L1002). */
}
