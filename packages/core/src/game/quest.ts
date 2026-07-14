/**
 * The quest system, ported from reference/src/player-quest.c (Angband 4.2.6):
 * the standard quest table (bound from quest.json), the per-character quest
 * history, and the on-death bookkeeping that culminates in the game's WIN
 * CONDITION - slaying Morgoth.
 *
 * The base game ships two quests (quest.txt): Sauron on depth 99 and Morgoth
 * on depth 100, each requiring a single kill. Killing the last incomplete
 * quest's guardian sets player->total_winner and prints the victory message.
 *
 * Provenance and RNG: the whole subsystem is RNG-free EXCEPT build_quest_stairs
 * (player-quest.c L187), whose scatter loop draws from the game RNG - and even
 * that fires only when a quest is completed on a grid that cannot hold a
 * staircase directly, staggering to a neighbouring grid. The common case (a
 * guardian dying on open floor) consumes no RNG.
 *
 * The parser-side pieces of player-quest.c (init/finish_parse_quest,
 * player_quests_free) have no analogue here: quest.json is already compiled and
 * the player quest list is a plain array reset at birth, so there is nothing to
 * free.
 */

import { FEAT } from "../generated";
import type { Loc } from "../loc";
import type { MonsterRegistry } from "../mon/bind";
import type { MonsterRace } from "../mon/types";
import type { Monster } from "../mon/monster";
import type { Player, PlayerQuest } from "../player/player";
import { scatter } from "../world/scatter";
import type { GameState } from "./context";
import { pushObject } from "./project-feat";
import { floorPile } from "./floor";

/** One record of quest.json (quest.txt): a guardian, its depth and count. */
export interface QuestRecordJson {
  name: string;
  level: number;
  /** The guardian monster's name, resolved to a race at bind time. */
  race: string;
  /** max_num: kills needed to complete the quest. */
  number: number;
}

/**
 * A bound standard quest (struct quest): the registry template every new
 * character's quest history is copied from (player_quests_reset).
 */
export interface Quest {
  /** quest->index: position in the quest table (file order). */
  index: number;
  name: string;
  level: number;
  /** quest->race: the resolved guardian race. */
  race: MonsterRace;
  /** quest->max_num. */
  maxNum: number;
}

/**
 * finish_parse_quest (player-quest.c L90): build the direct-access quest table
 * from the compiled records, resolving each race by name (lookup_monster). The
 * JSON records are already in file order, so `index` is just the array
 * position - no linked-list reversal is needed.
 */
export function bindQuests(
  records: readonly QuestRecordJson[],
  monsters: MonsterRegistry,
): Quest[] {
  return records.map((rec, index) => {
    const race = monsters.raceByName(rec.race);
    if (!race) {
      throw new Error(
        `quest: could not find race '${rec.race}' for quest '${rec.name}'`,
      );
    }
    return { index, name: rec.name, level: rec.level, race, maxNum: rec.number };
  });
}

/**
 * player_quests_reset (player-quest.c L157): copy the standard quest table into
 * the player's quest history, with every kill count reset to zero. Called at
 * birth (generatePlayer / startGame).
 */
export function playerQuestsReset(p: Player, quests: readonly Quest[]): void {
  p.quests = quests.map((q) => ({
    name: q.name,
    level: q.level,
    race: q.race.ridx,
    maxNum: q.maxNum,
    curNum: 0,
  }));
}

/**
 * is_quest (player-quest.c L140): is `level` a quest level for this player?
 * Town (level 0) is never a quest; otherwise true when any of the player's
 * quests is fought on that depth.
 */
export function isQuest(p: Player, level: number): boolean {
  /* Town is never a quest. */
  if (!level) return false;
  for (const q of p.quests) {
    if (q.level === level) return true;
  }
  return false;
}

/**
 * square_changeable (cave-square.c L868): a grid that may be "destroyed" - no
 * permanent walls, shops or stairs, and no artifact lying on it. Reimplemented
 * locally (the effect-terrain.c copy is module-private) so build_quest_stairs
 * matches upstream's staircase-placement guard exactly.
 */
function squareChangeable(state: GameState, grid: Loc): boolean {
  const c = state.chunk;
  if (c.isPerm(grid) || c.isShop(grid) || c.isStairs(grid)) return false;
  for (const obj of floorPile(state, grid)) {
    if (obj.artifact) return false;
  }
  return true;
}

/**
 * build_quest_stairs (player-quest.c L187): create the magical down-staircase
 * that appears when a quest guardian falls. Staggers away from a grid that
 * cannot take a staircase (passable, not a door, but not changeable - e.g. a
 * mineral vein or rubble) to a nearby one, pushes any objects off the chosen
 * grid, announces the staircase and sets FEAT_MORE.
 *
 * The scatter(cave, ..., 1, false) draw is the only RNG in the quest system;
 * it fires only while the loop guard holds (a rare death location), so a
 * guardian dying on open floor - which is changeable - consumes no RNG.
 */
function buildQuestStairs(state: GameState, grid: Loc): void {
  const c = state.chunk;

  /* Stagger around until the grid can hold a staircase. */
  while (
    !squareChangeable(state, grid) &&
    c.isPassable(grid) &&
    !c.isDoor(grid)
  ) {
    const newGrid = scatter(c, state.rng, grid, 1, false);
    /* scatter leaves the output untouched when no grid is feasible; mirror
     * that by keeping the current grid rather than looping forever. */
    if (!newGrid) break;
    grid = newGrid;
  }

  /* Push any objects. */
  pushObject(state, grid);

  /* Explain the staircase. */
  state.msg?.("A magical staircase appears...");

  /* Create stairs down. */
  c.setFeat(grid, FEAT.MORE);

  /* Update the visuals (PU_UPDATE_VIEW | PU_MONSTERS). */
  state.updateFov?.(state);
}

/**
 * quest_check (player-quest.c L219): the now-dead monster `m` may be a quest
 * guardian. Increments the matching quest's kill count when the current depth
 * and race line up; on completion clears the quest (level = 0) and builds the
 * escape staircase; and when no incomplete quests remain, wins the game.
 *
 * Returns whether a quest was completed by this death. The bookkeeping order
 * (increment -> mark complete -> count remaining -> act) matches upstream
 * exactly, so the "last quest" detection is identical.
 */
export function questCheck(state: GameState, p: Player, m: Monster): boolean {
  let total = 0;
  let completed = false;

  /* Mark quests as complete. */
  for (const q of p.quests) {
    /* Note completed quests. */
    if (state.chunk.depth === q.level && m.race.ridx === q.race) {
      q.curNum++;

      if (q.curNum === q.maxNum) {
        q.level = 0;
        completed = true;
      }
    }

    /* Count incomplete quests. */
    if (q.level) total++;
  }

  if (completed) {
    /* Build magical stairs. */
    buildQuestStairs(state, m.grid);

    /* Nothing left, game over... */
    if (total === 0) {
      p.totalWinner = true;
      state.msg?.("*** CONGRATULATIONS ***");
      state.msg?.("You have won the game!");
      state.msg?.("You may retire (key is shift-q) when you are ready.");
    }

    return true;
  }

  return false;
}
