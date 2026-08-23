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

import { ELEMENT_ENTRIES, OBJECT_FLAG_ENTRIES, TMD } from "../generated/index.js";
import type { FlagSet } from "../bitflag.js";
import type { GameState } from "../game/context.js";
import type { GameObject } from "../obj/object.js";
import { OBJ_MOD_NAMES } from "../obj/bind.js";
import { objectValue } from "../obj/value.js";
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
 * One object as an ItemView. `handle` is 0 for anything not in the gear.
 *
 * `count` overrides obj->number for both the reported stack size and the value
 * quantity. It exists for the hypothetical loadouts in agent/loadout.ts, where
 * "three of the five potions I am carrying" and "one of the twelve on that
 * shelf" are real cases and the object itself must not be touched to express
 * them. Absent, the object's own number is used, which is every live read.
 */
export function itemView(
  handle: number,
  obj: GameObject,
  state: GameState,
  deps: AgentViewDeps,
  count?: number,
): ItemView {
  const number = count ?? obj.number;
  const modifiers: Array<{ code: string; value: number }> = [];
  for (let i = 0; i < obj.modifiers.length; i++) {
    const value = obj.modifiers[i] ?? 0;
    if (value === 0) continue;
    const code = OBJ_MOD_NAMES[i];
    if (code) modifiers.push({ code, value });
  }

  const brands: string[] = [];
  if (obj.brands) {
    for (let i = 0; i < obj.brands.length; i++) {
      if (!obj.brands[i]) continue;
      const code = state.brands[i]?.code;
      if (code) brands.push(code);
    }
  }

  const slays: string[] = [];
  if (obj.slays) {
    for (let i = 0; i < obj.slays.length; i++) {
      if (!obj.slays[i]) continue;
      const code = state.slays[i]?.code;
      if (code) slays.push(code);
    }
  }

  const resists: Array<{ element: string; level: number }> = [];
  for (let i = 0; i < obj.elInfo.length; i++) {
    const level = obj.elInfo[i]?.resLevel ?? 0;
    if (level === 0) continue;
    const name = ELEMENT_ENTRIES[i]?.name;
    if (name) resists.push({ element: name, level });
  }

  const curses: string[] = [];
  if (obj.curses) {
    for (let i = 0; i < obj.curses.length; i++) {
      const power = obj.curses[i]?.power ?? 0;
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
    label: obj.kind.name,
    tval: obj.tval,
    sval: obj.sval,
    pval: obj.pval,
    number,
    weight: obj.weight,
    ac: obj.ac,
    toA: obj.toA,
    toH: obj.toH,
    toD: obj.toD,
    dd: obj.dd,
    ds: obj.ds,
    ego: obj.ego !== null,
    artifact: obj.artifact !== null,
    flags: ofCodes(obj.flags),
    modifiers,
    brands,
    slays,
    resists,
    curses,
    egoName: obj.ego?.name ?? null,
    artifactName: obj.artifact?.name ?? null,
    activation: obj.activation !== null,
    timeout: obj.timeout,
    inscription: obj.note ?? null,
  };
  if (deps.resolver) {
    const kindId = deps.resolver.kindIdOrNull(obj.kind.kidx);
    if (kindId !== null) view.kindId = kindId;
  }
  if (deps.reg) {
    const aware = deps.aware ?? ((): boolean => true);
    view.value = objectValue(deps.reg, obj, number, aware(obj.kind));
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
  const combat = over ? over.combat : state.actor.combat;
  const playerState = over ? over.playerState : state.playerState;
  const view: PlayerView = {
    race: p.race.name,
    cls: p.cls.name,
    level: p.lev,
    maxLevel: p.maxLev,
    exp: p.exp,
    maxExp: p.maxExp,
    gold: p.au,
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
    },
    dead: state.isDead,
    winner: p.totalWinner,
    skills: [...p.skills],
    shape: p.shape?.name ?? null,
    objectFlags: playerState ? ofCodes(playerState.flags) : [],
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
