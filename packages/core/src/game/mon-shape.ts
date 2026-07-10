/**
 * Monster shapechanging, ported from reference/src/mon-util.c (Angband
 * 4.2.6): monster_change_shape (L1590) and monster_revert_shape (L1686).
 * The MON_TMD_CHANGED timer drives them (mon-timed.c L195): raising the
 * timer changes shape (a failure restores the old timer), and the timer
 * running out reverts - the game-layer timed calls pass these as the
 * MonShapeHooks seam so mon/timed.ts stays below game/.
 *
 * A monster with preferred shapes (race shape: lines) picks one - a
 * direct race, or a random race of the given base at depth + 5
 * (monster_base_shape_okay). Otherwise it becomes something it could
 * summon (the RST_SUMMON spell mask -> selectShape). Names in messages
 * are the race name until MDESC (#25).
 */

import { FLAG_START, NO_FLAG } from "../bitflag";
import type { Loc } from "../loc";
import type { Monster } from "../mon/monster";
import type { MonsterRace } from "../mon/types";
import { monsterIsObvious, monsterPassesWalls } from "../mon/predicate";
import { RST, createMonSpellMask } from "../mon/spell";
import type { MonsterSpell } from "../mon/types";
import type { GameState } from "./context";
import { selectShape } from "./mon-place";
import type { SummonDeps } from "./mon-place";
import type { SummonEffectEnv } from "./effect-summon";
import { teleportMonster } from "./effect-teleport";
import type { TeleportEnv } from "./effect-teleport";

/** Everything a shapechange needs beyond the state. */
export interface MonShapeDeps {
  /** The summon table + allocation (the summon-derived shape path). */
  summon?: SummonEffectEnv;
  /** The bound monster spells, for the summon-spell subtype lookup. */
  spells?: ReadonlyMap<number, MonsterSpell>;
  /** Teleport seams for the emergency unstick. */
  teleport?: TeleportEnv;
}

/** The "shimmers and changes!" announcement for an obvious monster. */
function shimmerMessage(state: GameState, mon: Monster): void {
  if (monsterIsObvious(mon)) {
    state.msg?.(`${mon.race.name} shimmers and changes!`);
  }
}

/** Emergency teleport if the new form cannot stand where it is. */
function unstick(state: GameState, mon: Monster, deps: MonShapeDeps): void {
  if (
    !monsterPassesWalls(mon) &&
    !state.chunk.isMonsterWalkable(mon.grid as Loc)
  ) {
    teleportMonster(state, mon.midx, 1, deps.teleport ?? {});
  }
}

/**
 * monster_change_shape (L1590): pick the new race - a preferred shape
 * (race or random-of-base at depth + 5), or something the monster could
 * summon - swap it in (keeping original_race and adjusting speed by the
 * race difference), and teleport out of any newly-illegal grid. Returns
 * whether the monster is now shapechanged.
 */
export function monsterChangeShape(
  state: GameState,
  mon: Monster,
  deps: MonShapeDeps = {},
): boolean {
  let race: MonsterRace | null = null;
  const shapes = mon.race.shapes;
  const table = deps.summon?.place.table;

  if (shapes.length > 0) {
    /* Use the monster's preferred shapes if any. */
    const shape = shapes[state.rng.randint0(shapes.length)]!;
    if (shape.race) {
      /* Simple. */
      race = shape.race;
    } else if (shape.base && table) {
      /* Choose a race of the given base (monster_base_shape_okay). */
      table.prep((r) => r.base === shape.base);
      race = table.getMonNum(
        state.rng,
        state.chunk.depth + 5,
        state.chunk.depth,
      );
      table.prep(null);
    }
  } else if (deps.summon && deps.spells) {
    /* Choose something the monster can summon. */
    const summonSpells = createMonSpellMask(RST.SUMMON);
    summonSpells.inter(mon.race.spellFlags);

    /* Count possibilities. */
    const poss: number[] = [];
    for (
      let i = summonSpells.next(FLAG_START);
      i !== NO_FLAG;
      i = summonSpells.next(i + 1)
    ) {
      poss.push(i);
    }

    if (poss.length > 0) {
      /* Pick one and read its summon subtype. */
      const index = poss[state.rng.randint0(poss.length)]!;
      const spell = deps.spells.get(index);
      const typeName = spell?.effects[0]?.type ?? null;
      const summonType = typeName
        ? deps.summon.summons.nameToIdx(typeName)
        : -1;

      if (summonType >= 0) {
        const summonDeps: SummonDeps = {
          ...deps.summon.place,
          summons: deps.summon.summons,
          ...(summonType === deps.summon.summons.nameToIdx("KIN")
            ? { kinBase: mon.race.base }
            : {}),
        };
        race = selectShape(state, summonType, summonDeps);
      }
    }
  }

  /* Print a message immediately, update visuals. */
  shimmerMessage(state, mon);

  /* Set the race. */
  if (race) {
    if (!mon.originalRace) mon.originalRace = mon.race;
    mon.race = race;
    mon.mspeed += mon.race.speed - mon.originalRace.speed;
  }

  /* Emergency teleport if needed. */
  unstick(state, mon, deps);

  return mon.originalRace !== null;
}

/**
 * monster_revert_shape (L1686): back to the original race, adjusting
 * speed and teleporting out of any newly-illegal grid. Returns whether a
 * reversion happened.
 */
export function monsterRevertShape(
  state: GameState,
  mon: Monster,
  deps: MonShapeDeps = {},
): boolean {
  if (!mon.originalRace) return false;

  shimmerMessage(state, mon);
  mon.mspeed += mon.originalRace.speed - mon.race.speed;
  mon.race = mon.originalRace;
  mon.originalRace = null;

  unstick(state, mon, deps);
  return true;
}
