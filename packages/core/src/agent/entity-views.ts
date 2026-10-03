/**
 * The two plain-data view builders the perceive facade and the loadout
 * simulation SHARE: one object as an `ItemView`, and the player as a
 * `PlayerView`.
 *
 * They live in their own module rather than in perceive.ts for one reason.
 * `agent/loadout.ts` describes a loadout the player is not wearing, and it has
 * to describe it in the same shape and through the same builders as the live
 * view - an `ItemView` carrying `value` in one and not the other would change
 * what an agent decides about the same object depending on which view handed it
 * over. Having both importers reach the same function is what makes that
 * structural instead of a convention, and it keeps the import graph one-way
 * (perceive and loadout both depend on this; neither depends on the other).
 */

import {
  ELEMENT_ENTRIES,
  OBJECT_FLAG_ENTRIES,
  OF,
  PLAYER_FLAG_ENTRIES,
  TMD,
} from "../generated/index.js";
import type { FlagSet } from "../bitflag.js";
import type { GameState } from "../game/context.js";
import type { GameObject } from "../obj/object.js";
import { tvalCanHaveFlavor, tvalIsBook } from "../obj/object.js";
import { playerObjectToBook } from "../player/spell.js";
import { OBJ_MOD_NAMES } from "../obj/bind.js";
import { objectValue } from "../obj/value.js";
import { objectFlagsKnown, objectKnownShadow } from "../obj/known-object.js";
import { knownDescOf } from "../game/describe.js";
import type { PlayerState } from "../player/calcs.js";
import type { PlayerCombatState } from "../combat/melee.js";
import type { AgentViewDeps, ItemView, PlayerView } from "./types.js";

/** OF_* codes for the set flags in an object-flag FlagSet (OF is 1-indexed). */
export function ofCodes(flags: FlagSet): string[] {
  const out: string[] = [];
  for (const f of flags) {
    const entry = OBJECT_FLAG_ENTRIES[f - 1];
    if (entry) out.push(entry.name);
  }
  return out;
}

/**
 * PF_* codes for the set flags in a player-flag FlagSet (PF is 0-indexed: PF_NONE
 * is entry 0 and never set, since bitflag iteration starts at FLAG_START = 1, so
 * no "-1" offset is needed here the way ofCodes needs one for OF_*).
 */
export function pfCodes(flags: FlagSet): string[] {
  const out: string[] = [];
  for (const f of flags) {
    const entry = PLAYER_FLAG_ENTRIES[f];
    if (entry) out.push(entry.name);
  }
  return out;
}

/**
 * One object as an ItemView. `handle` is 0 for anything not in the gear.
 *
 * `count` overrides obj->number for both the reported stack size and the value
 * quantity. It exists for the hypothetical loadouts in agent/loadout.ts, where
 * "three of the five potions I am carrying" and "one of the twelve on that
 * shelf" are real cases and the object itself must not be touched to express
 * them. Absent, the object's own number is used, which is every live read.
 *
 * `shopWare` marks a ware on a shop's shelf (not the home's). The shop screen
 * names every ware by its kind, object_desc with ODESC_STORE (obj-desc.c:494),
 * so the view does too.
 */
export function itemView(
  handle: number,
  obj: GameObject,
  state: GameState,
  deps: AgentViewDeps,
  count?: number,
  shopWare = false,
): ItemView {
  const number = count ?? obj.number;
  /* object_flavor_is_aware. Until the player knows a flavoured kind, the fields
   * that would name it name the flavour instead, as object_kind_name does for
   * the knowledge menu: `label` is the flavour text, `kindKey` is
   * `flavor:<fidx>`, `sval` is the negated flavour index and `kindId` is left
   * out. A negative sval never matches a real one, and two unidentified
   * flavours still differ. A kind with no flavour is known on sight. */
  const isAware = deps.aware ?? state.isAware ?? ((): boolean => true);
  const kindAware = isAware(obj.kind);
  const flavoured = state.hasFlavor?.(obj.kind) ?? tvalCanHaveFlavor(obj.tval);
  const aware = kindAware || !flavoured || shopWare;
  const flavor = aware ? undefined : state.flavorGlyph?.(obj.kind);
  /* Everything below that says what the object IS comes from its known twin
   * (upstream obj->known, objectKnownShadow), the same record object_desc and the
   * inspect screen read. A mod sees what the player knows: an unidentified ego
   * reads as plain gear, and an unlearned rune adds nothing. The kind, weight and
   * base dice and armour are known on sight. */
  const p = state.actor.player;
  const knownDesc = knownDescOf(state, true);
  const known = objectKnownShadow(obj, p, state.runeEnv, knownDesc);
  const modifiers: Array<{ code: string; value: number }> = [];
  for (let i = 0; i < known.modifiers.length; i++) {
    const value = known.modifiers[i] ?? 0;
    if (value === 0) continue;
    const code = OBJ_MOD_NAMES[i];
    if (code) modifiers.push({ code, value });
  }

  const brands: string[] = [];
  if (known.brands) {
    for (let i = 0; i < known.brands.length; i++) {
      if (!known.brands[i]) continue;
      const code = state.brands[i]?.code;
      if (code) brands.push(code);
    }
  }

  const slays: string[] = [];
  if (known.slays) {
    for (let i = 0; i < known.slays.length; i++) {
      if (!known.slays[i]) continue;
      const code = state.slays[i]?.code;
      if (code) slays.push(code);
    }
  }

  const resists: Array<{ element: string; level: number }> = [];
  for (let i = 0; i < known.elInfo.length; i++) {
    const level = known.elInfo[i]?.resLevel ?? 0;
    if (level === 0) continue;
    const name = ELEMENT_ENTRIES[i]?.name;
    if (name) resists.push({ element: name, level });
  }

  const curses: string[] = [];
  if (known.curses) {
    for (let i = 0; i < known.curses.length; i++) {
      const power = known.curses[i]?.power ?? 0;
      if (power <= 0) continue;
      /* Curse names resolve from the always-present RuneEnv curse table (real
       * in production, inert [null] in the worldless harness), then the
       * optional registry dep, then the numeric index as a last resort. */
      curses.push(
        state.runeEnv.curses[i]?.name ??
          deps.reg?.curses[i]?.name ??
          String(i),
      );
    }
  }

  const view: ItemView = {
    handle,
    kindKey: aware ? `kind:${obj.kind.kidx}` : `flavor:${flavor ? flavor.fidx : "none"}`,
    ...(handle > 0 ? { itemKey: `gear:${handle}` } : {}),
    nameColor: tvalIsBook(obj.tval) && !playerObjectToBook(state.actor.player, obj)
      ? "slate" : obj.kind.base.attr,
    label: aware ? obj.kind.name : (state.flavorText?.(obj.kind) ?? flavor?.text ?? ""),
    aware,
    tval: obj.tval,
    sval: aware ? obj.sval : -(flavor?.fidx ?? 1),
    pval: known.pval,
    number,
    weight: obj.weight,
    ac: known.ac,
    toA: known.toA,
    toH: known.toH,
    toD: known.toD,
    dd: known.dd,
    ds: known.ds,
    ego: known.ego !== null,
    artifact: known.artifact !== null,
    flags: ofCodes(objectFlagsKnown(obj, p, state.runeEnv, knownDesc)),
    modifiers,
    brands,
    slays,
    resists,
    curses,
    egoName: known.ego?.name ?? null,
    artifactName: known.artifact?.name ?? null,
    activation: known.activation !== null,
    timeout: obj.timeout,
    inscription: obj.note ?? null,
  };
  if (deps.describe) view.name = deps.describe(obj);
  if (deps.ignored) view.ignored = deps.ignored(obj);
  if (deps.resolver && aware) {
    const kindId = deps.resolver.kindIdOrNull(obj.kind.kidx);
    if (kindId !== null) view.kindId = kindId;
  }
  if (deps.reg) {
    /* object_value reads the player's own awareness, shop or not: an unknown
     * flavour is worth its tval's base price, never the kind's cost. */
    view.value = objectValue(deps.reg, obj, number, kindAware, { p, env: state.runeEnv, deps: knownDesc });
  }
  return view;
}

/**
 * The derived facts playerViewFor reads off the live actor, supplied explicitly
 * so a HYPOTHETICAL loadout can be described in exactly the same shape (see
 * agent/loadout.ts). Absent, the live values are used, which is the ordinary
 * perceive path.
 *
 * Only the fields a loadout can move are here. Level, experience, gold, grid,
 * timed status and the rest are properties of the character rather than of what
 * it is wearing, so a simulated view reports the live ones.
 */
export interface PlayerViewDerived {
  playerState: PlayerState;
  combat: PlayerCombatState;
  speed: number;
  light: number;
  maxHp: number;
  maxSp: number;
}

/**
 * Build a PlayerView from the live game, or - with `over` - from a derive for a
 * loadout the player is not wearing.
 *
 * The live view reads the KNOWN state, p->known_state (state.knownPlayerState
 * and actor.knownCombat), the derive the character sheet prints. AC, to-hit,
 * to-dam, the object flags and the OF_AFRAID half of `fearful` are what an
 * unlearned rune on worn gear changes, and the real state would hand them to a
 * mod before the player could know them. Speed, light, blows, shots and
 * infravision come from modifiers, which calc_bonuses gates on the learned-rune
 * mask in both passes and which wielding an item teaches, so they read the
 * same in either; max HP and SP are the sidebar's. A simulated loadout passes
 * its own known_only derive as `over`, so `simulateLoadout({}).before.player`
 * and this view agree. With no known state (the worldless harness) the flags
 * read as empty, never as the real ones.
 *
 * NOTE on `skills`: this is p->skills, the birth-time level-based skill array
 * (calcSkills), NOT state->skills. It is not a function of the worn loadout, so
 * a simulated view carries the live one, exactly as the live view does. The full
 * derived skills, equipment contributions included, are on
 * DerivedStatsView.skills (player/loadout.ts).
 */
export function playerViewFor(
  state: GameState,
  deps: AgentViewDeps,
  over?: PlayerViewDerived,
): PlayerView {
  const p = state.actor.player;
  const combat = over ? over.combat : state.actor.knownCombat;
  const playerState = over ? over.playerState : state.knownPlayerState;
  const view: PlayerView = {
    race: p.race.name,
    cls: p.cls.name,
    level: p.lev,
    maxLevel: p.maxLev,
    exp: p.exp,
    maxExp: p.maxExp,
    gold: p.au,
    learnableSpells: p.upkeep.newSpells,
    depth: state.chunk.depth,
    maxDepth: p.maxDepth,
    hp: p.chp,
    maxHp: over ? over.maxHp : p.mhp,
    sp: p.csp,
    maxSp: over ? over.maxSp : p.msp,
    speed: over ? over.speed : state.actor.speed,
    /* Displayed AC is state->ac + state->to_a. */
    ac: combat.ac + combat.toA,
    toHit: combat.toH,
    toDam: combat.toD,
    stats: [...p.statCur],
    light: over ? over.light : state.actor.light,
    grid: { x: state.actor.grid.x, y: state.actor.grid.y },
    status: {
      blind: p.timed[TMD.BLIND] ?? 0,
      confused: p.timed[TMD.CONFUSED] ?? 0,
      afraid: p.timed[TMD.AFRAID] ?? 0,
      poisoned: p.timed[TMD.POISONED] ?? 0,
      cut: p.timed[TMD.CUT] ?? 0,
      stun: p.timed[TMD.STUN] ?? 0,
      paralyzed: p.timed[TMD.PARALYZED] ?? 0,
      food: p.timed[TMD.FOOD] ?? 0,
      fast: p.timed[TMD.FAST] ?? 0,
      sprint: p.timed[TMD.SPRINT] ?? 0,
      protEvil: p.timed[TMD.PROTEVIL] ?? 0,
      hero: p.timed[TMD.HERO] ?? 0,
      shero: p.timed[TMD.SHERO] ?? 0,
      shield: p.timed[TMD.SHIELD] ?? 0,
      stoneskin: p.timed[TMD.STONESKIN] ?? 0,
      blessed: p.timed[TMD.BLESSED] ?? 0,
      fastcast: p.timed[TMD.FASTCAST] ?? 0,
      resAcid: p.timed[TMD.OPP_ACID] ?? 0,
      resElec: p.timed[TMD.OPP_ELEC] ?? 0,
      resFire: p.timed[TMD.OPP_FIRE] ?? 0,
      resCold: p.timed[TMD.OPP_COLD] ?? 0,
      resPois: p.timed[TMD.OPP_POIS] ?? 0,
      /* player_of_has(p, OF_AFRAID), the flag the melee refusal reads: the
       * timed effects' flag synonyms are folded into playerState.flags by
       * calc_bonuses, alongside equipment, curses and shapes. */
      fearful: (playerState?.flags.has(OF.AFRAID) ?? false) || (p.timed[TMD.AFRAID] ?? 0) > 0,
      terror: p.timed[TMD.TERROR] ?? 0,
      amnesia: p.timed[TMD.AMNESIA] ?? 0,
      image: p.timed[TMD.IMAGE] ?? 0,
    },
    dead: state.isDead,
    winner: p.totalWinner,
    hpWarning: Math.trunc((p.mhp * (state.options?.hitpointWarn ?? 3)) / 10),
    recall: p.wordRecall,
    descent: p.deepDescent,
    skills: [...p.skills],
    shape: p.shape?.name ?? null,
    objectFlags: playerState ? ofCodes(playerState.flags) : [],
    classFlags: pfCodes(p.cls.pflags),
    seeInfra: playerState?.seeInfra ?? p.race.infravision,
    blows: combat.numBlows,
    shots: combat.numShots,
  };
  if (deps.resolver) {
    const raceId = deps.resolver.playerRaceIdOrNull(p.race.ridx);
    if (raceId !== null) view.playerRaceId = raceId;
    const classId = deps.resolver.playerClassIdOrNull(p.cls.cidx);
    if (classId !== null) view.playerClassId = classId;
  }
  return view;
}
