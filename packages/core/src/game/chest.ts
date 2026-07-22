/**
 * Live chests, ported from reference/src/obj-chest.c's GameState-dependent
 * half (chest_check, count_chests, chest_trap, chest_death) plus the
 * do_cmd_open / do_cmd_disarm chest branches of reference/src/cmd-cave.c
 * (Angband 4.2.6). The pure pval/trap-table model (pick_chest_traps,
 * unlock_chest, the predicates, chest_trap_name) lives in obj/chest.ts,
 * mirroring the world/trap.ts (pure) vs game/trap.ts (live) split.
 *
 * Knowledge simplifications (with #24): chest_check's ignore_item_ok gate
 * and the CHEST_TRAPPED `obj->known && obj->known->pval` check both
 * collapse to "everything is known", matching the current shell (see the
 * parity notes on this gap). The disarm guard cascade's "I don't see any
 * traps" branch is unreachable under that collapse (it only fires when a
 * chest's traps are not yet known), so only the two reachable branches
 * (not trapped / trapped) are implemented.
 */

import type { Loc } from "../loc";
import { DDGRID_DDD, locSum } from "../loc";
import { OF, ORIGIN, TMD } from "../generated";
import { SKILL } from "../player/types";
import type { GameObject } from "../obj/object";
import { tvalIsChest } from "../obj/object";
import { CHEST_QUERY, CHEST_TRAPS, isTrappedChest } from "../obj/chest";
import type { ChestQuery } from "../obj/chest";
import type { MakeDeps } from "../obj/make";
import { makeObject } from "../obj/make";
import type { FloorEnv } from "./floor";
import { dropNear, floorPile } from "./floor";
import { squareIsSeen } from "../world/view";
import { sourceChestTrap } from "../effects/interpreter";
import { buildObjectEffectChain } from "./obj-cmd";
import type { ObjCmdDeps } from "./obj-cmd";
import { buildEffectContext } from "./effect-env";
import { attachGameEnv } from "./effect-game-env";
import type { GameState } from "./context";

/* CHEST_QUERY / ChestQuery are obj/chest.ts's own exports (the index barrel
 * re-exports that module directly); not re-exported again from here to
 * avoid a duplicate/ambiguous barrel export. Import them from "../obj/chest"
 * when needed alongside this module's chestCheck/chestDeath/etc. */

/** Hooks for messages and unported subsystems; all optional. */
export interface ChestEnv {
  msg?: (text: string) => void;
  /** player_exp_gain on a pick/disarm. */
  expGain?: (amount: number) => void;
  /** player_of_has(OF_TRAP_IMMUNE), for the equip-learn no-op path (#13). */
  playerHasFlag?: (ofFlag: number) => boolean;
}

/** The effect stack shared with traps (session/game.ts assembles this once). */
export type ChestEffectsBundle = Pick<
  ObjCmdDeps,
  "registry" | "cast" | "envDeps" | "inject" | "teleport" | "general" | "item" | "summon"
>;

/** Everything chest_trap needs beyond the state. */
export interface ChestEffectDeps {
  effects?: ChestEffectsBundle;
  env?: ChestEnv;
}

/** Everything chest_death needs beyond the state. */
export interface ChestLootDeps {
  makeDeps: MakeDeps;
  floorEnv?: FloorEnv;
}

/** Everything do_cmd_open_chest / do_cmd_disarm_chest need beyond the state. */
export interface ChestCmdDeps {
  effects?: ChestEffectsBundle;
  env?: ChestEnv;
  makeDeps: MakeDeps;
  floorEnv?: FloorEnv;
}

/**
 * player_is_trapsafe (player-path.ts owns the canonical copy; duplicated
 * here as a one-line derived read to avoid a game/chest <-> game/player-path
 * import cycle through cave-cmd.ts). The OF_TRAP_IMMUNE equipment half is
 * #13, deferred, same as upstream's other half.
 */
function playerIsTrapsafe(state: GameState): boolean {
  return (state.actor.player.timed[TMD.TRAPSAFE] ?? 0) > 0;
}

/** no_light (cave-view.c L913): the player's own grid is not currently seen. */
function noLight(state: GameState): boolean {
  return !squareIsSeen(state.chunk, state.actor.grid);
}

/**
 * chest_check (obj-chest.c L423): the first floor-pile chest at grid
 * matching the query. ignore_item_ok is deferred (#24): nothing is ignored.
 */
export function chestCheck(
  state: GameState,
  grid: Loc,
  checkType: ChestQuery,
): GameObject | null {
  for (const obj of floorPile(state, grid)) {
    switch (checkType) {
      case CHEST_QUERY.ANY:
        if (tvalIsChest(obj.tval)) return obj;
        break;
      case CHEST_QUERY.OPENABLE:
        if (tvalIsChest(obj.tval) && obj.pval !== 0) return obj;
        break;
      case CHEST_QUERY.TRAPPED:
        if (isTrappedChest(obj)) return obj;
        break;
    }
  }
  return null;
}

/**
 * count_chests (obj-chest.c L459): how many of the 9 grids around (and
 * under) the player hold a matching chest, and the last one found.
 */
export function countChests(
  state: GameState,
  checkType: ChestQuery,
): { count: number; grid: Loc | null } {
  let count = 0;
  let grid: Loc | null = null;
  for (const off of DDGRID_DDD) {
    const g = locSum(state.actor.grid, off);
    if (!chestCheck(state, g, checkType)) continue;
    count++;
    grid = g;
  }
  return { count, grid };
}

/**
 * chest_trap (obj-chest.c L545): fire every trap set in the chest's pval,
 * in ascending-pval table order. A trap with `destroy` zeroes the pval and
 * stops the walk immediately (so a later chest_death sees an empty chest -
 * an exploded chest drops no loot).
 */
export function chestTrap(
  state: GameState,
  obj: GameObject,
  deps: ChestEffectDeps,
): void {
  const traps = obj.pval;
  if (traps <= 0) return;
  const env = deps.env ?? {};

  for (const trap of CHEST_TRAPS) {
    if (!(trap.pval & traps)) continue;
    if (trap.msg) env.msg?.(trap.msg);
    if (trap.effect.length && deps.effects) {
      const chain = buildObjectEffectChain(trap.effect, state, deps.effects.inject);
      if (chain) {
        const ctx = attachGameEnv(buildEffectContext(state, deps.effects.envDeps), {
          state,
          cast: deps.effects.cast,
          ...(deps.effects.envDeps.takeHitHooks
            ? { takeHitHooks: deps.effects.envDeps.takeHitHooks }
            : {}),
          ...(deps.effects.teleport ? { teleport: deps.effects.teleport } : {}),
          ...(deps.effects.general ? { general: deps.effects.general } : {}),
          ...(deps.effects.item ? { item: deps.effects.item } : {}),
          ...(deps.effects.summon ? { summon: deps.effects.summon } : {}),
        });
        deps.effects.registry.effectDo(chain, ctx, {
          origin: sourceChestTrap(trap),
          aware: false,
        });
      }
    }
    if (trap.destroy) {
      obj.pval = 0;
      break;
    }
  }
}

/**
 * chest_death (obj-chest.c L498): drop the chest's loot (1/2/3 items for
 * wooden/iron/steel, randint1(3) otherwise - unreachable for the shipped
 * kinds), good and (for a Large chest) great, out of depth for the level
 * the chest was generated at (origin_depth + 5). A null or chest result
 * retries WITHOUT decrementing the count, matching upstream's `continue`.
 * A zero pval (already empty, or just exploded) is a no-op.
 */
export function chestDeath(
  state: GameState,
  grid: Loc,
  chest: GameObject,
  deps: ChestLootDeps,
): void {
  if (!chest.pval) return;

  const name = chest.kind.name;
  const large = name.includes("Large");
  let number: number;
  if (name.includes("wooden")) number = 1;
  else if (name.includes("iron")) number = 2;
  else if (name.includes("steel")) number = 3;
  else number = state.rng.randint1(3);

  const level = chest.originDepth + 5;
  while (number > 0) {
    const treasure = makeObject(
      state.rng,
      deps.makeDeps,
      level,
      true,
      large,
      false,
      0,
      state.chunk.depth,
    );
    if (!treasure) continue;
    /* Chests never spawn inside chests (obj-chest.c L525-528). Ported
     * faithfully, though it is dead code for the shipped data: makeObject
     * is always called with good=true here, and no chest ObjectKind is
     * ever "good" (kindIsGood in obj/make.ts), so the "great" allocation
     * table this draws from can never itself contain a chest kind. See
     * game/chest.test.ts's reachability test. */
    if (tvalIsChest(treasure.tval)) continue;

    treasure.origin = ORIGIN.CHEST;
    treasure.originDepth = chest.originDepth;
    dropNear(state, treasure, 0, grid, true, deps.floorEnv ?? {});
    number--;
  }

  chest.pval = 0;
}

/**
 * do_cmd_open_chest (obj-chest.c L580): attempt to pick the lock (if any),
 * then - if opened - fire any traps (before the loot, so a destroyed chest
 * drops nothing) and drop the loot. Returns whether the command may repeat.
 */
export function doCmdOpenChest(
  state: GameState,
  grid: Loc,
  obj: GameObject,
  deps: ChestCmdDeps,
): boolean {
  const env = deps.env ?? {};
  let flag = true;
  let more = false;

  if (obj.pval > 0) {
    flag = false;
    let i = state.actor.combat.skills[SKILL.DISARM_PHYS] ?? 0;
    const p = state.actor.player;
    if ((p.timed[TMD.BLIND] ?? 0) > 0 || noLight(state)) i = Math.trunc(i / 10);
    if ((p.timed[TMD.CONFUSED] ?? 0) > 0 || (p.timed[TMD.IMAGE] ?? 0) > 0) {
      i = Math.trunc(i / 10);
    }
    let j = i - obj.pval;
    if (j < 2) j = 2;

    if (state.rng.randint0(100) < j) {
      env.msg?.("You have picked the lock.");
      env.expGain?.(1);
      flag = true;
    } else {
      more = true;
      env.msg?.("You failed to pick the lock.");
    }
  }

  if (flag) {
    if (!playerIsTrapsafe(state)) {
      chestTrap(state, obj, deps);
    } else if (obj.pval > 0 && (env.playerHasFlag?.(OF.TRAP_IMMUNE) ?? false)) {
      /* Learn trap immunity (equip_learn_flag): deferred, #13. */
    }
    chestDeath(state, grid, obj, deps);
  }

  return more;
}

/**
 * do_cmd_disarm_chest (obj-chest.c L659): pick the disarm skill (magic,
 * physical, or the average of both, by what traps are present), then two
 * sequential rolls - one to disarm, one to avoid setting the trap off -
 * before the trap fires on a full miss. Returns whether the command may
 * repeat.
 */
export function doCmdDisarmChest(
  state: GameState,
  obj: GameObject,
  deps: ChestCmdDeps,
): boolean {
  const env = deps.env ?? {};
  let physical = false;
  let magic = false;
  for (const trap of CHEST_TRAPS) {
    if (!(trap.pval & obj.pval)) continue;
    if (trap.magic) magic = true;
    else physical = true;
  }

  let skill = state.actor.combat.skills[SKILL.DISARM_PHYS] ?? 0;
  if (magic) {
    skill = physical
      ? Math.trunc(
          ((state.actor.combat.skills[SKILL.DISARM_MAGIC] ?? 0) +
            (state.actor.combat.skills[SKILL.DISARM_PHYS] ?? 0)) /
            2,
        )
      : (state.actor.combat.skills[SKILL.DISARM_MAGIC] ?? 0);
  }

  const p = state.actor.player;
  if ((p.timed[TMD.BLIND] ?? 0) > 0 || noLight(state)) skill = Math.trunc(skill / 10);
  if ((p.timed[TMD.CONFUSED] ?? 0) > 0 || (p.timed[TMD.IMAGE] ?? 0) > 0) {
    skill = Math.trunc(skill / 10);
  }

  let diff = skill - obj.pval;
  if (diff < 2) diff = 2;

  /* The obj->known->pval / ignore_item_ok "I don't see any traps" guard is
   * unreachable under the everything-known simplification (#24): it only
   * ever fires when the chest's traps are not yet known to the player, so
   * only the two reachable branches below are ported. */
  if (!isTrappedChest(obj)) {
    env.msg?.("The chest is not trapped.");
    return false;
  }

  if (state.rng.randint0(100) < diff) {
    env.msg?.("You have disarmed the chest.");
    env.expGain?.(obj.pval);
    obj.pval = -obj.pval;
    return false;
  }
  if (state.rng.randint0(100) < diff) {
    env.msg?.("You failed to disarm the chest.");
    return true;
  }

  if (!playerIsTrapsafe(state)) {
    env.msg?.("You set off a trap!");
    chestTrap(state, obj, deps);
  } else if (env.playerHasFlag?.(OF.TRAP_IMMUNE)) {
    /* Learn trap immunity (equip_learn_flag): deferred, #13. */
  }
  return false;
}
