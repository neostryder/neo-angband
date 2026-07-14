/**
 * Player ranged commands: fire (do_cmd_fire) and throw (do_cmd_throw), the
 * command front-ends of reference/src/player-attack.c (Angband 4.2.6). The hit
 * math is combat/ranged.ts (make_ranged_shot / make_ranged_throw); this is
 * ranged_helper - resolve the target, walk the missile along project_path, land
 * a hit on the first monster in the way, then drop the missile (subject to
 * breakage) where it comes to rest.
 *
 * The missile addresses its object by gear handle (args.handle) and its target
 * by args.dir (keypad 1-9, or DIR_TARGET = 5 to use the current target), which
 * the UI resolves before the command runs, exactly as cmd_get_item /
 * cmd_get_target do upstream.
 *
 * DEFERRED (ledgered in parity/ledger/ranged-cmd.yaml): TMD_POWERSHOT piercing
 * (pierce stays 1), the out-of-range "Fire anyway?" prompt (UI), missile /
 * equipment learn-on-attack (knowledge), the show_damage " (N)" suffix, the
 * invisible-monster "finds a mark" branch, and the crit-flavour line (the hit
 * verb still varies). The throw range uses a compact weight bound.
 */

import { MON_MSG, MSG, RF } from "../generated";
import { loc } from "../loc";
import type { Loc } from "../loc";
import { makeRangedShot, makeRangedThrow, breakageChance } from "../combat/ranged";
import { objectWeightOne, tvalIsAmmo } from "../obj/object";
import type { GameObject } from "../obj/object";
import { ODESC } from "../obj/desc";
import { projectPath } from "../world/project";
import { monsterIsObvious, monsterIsDestroyed } from "../mon/predicate";
import { gearGet, gearObjectForUse } from "./gear";
import { dropNear } from "./floor";
import { squareMonster, deleteMonster, arenaInterceptDeath } from "./context";
import type { GameState, PlayerCommand } from "./context";
import { targetOkay, targetGet } from "./target";
import { describeObject } from "./describe";
import { formatMonsterMessage, monMessageSoundType } from "./mon-message";
import type { ActionRegistry } from "./player-turn";

/* Keypad direction deltas (ddx/ddy), indexed by keypad digit 1..9. */
const DDX = [0, -1, 0, 1, -1, 0, 1, -1, 0, 1];
const DDY = [0, 1, 1, 1, 0, 0, 0, -1, -1, -1];

/**
 * ranged_helper (player-attack.c L34): fly the missile from the player toward
 * `target`, attacking the first monster along the path. `throwing` selects the
 * thrown vs launcher hit resolver. Returns whether a monster was struck (so the
 * missile's breakage uses the higher hit-chance) and where the missile landed.
 */
function rangedHelper(
  state: GameState,
  missile: GameObject,
  launcher: GameObject | null,
  dir: number,
  range: number,
  throwing: boolean,
): { hit: boolean; landing: Loc } {
  const player = state.actor.player;
  const start = state.actor.grid;

  /* Predict the target grid: the current target for DIR_TARGET, else far along
   * the chosen direction. */
  let target: Loc;
  if (dir === 5 && targetOkay(state)) {
    target = targetGet(state);
  } else {
    const dd = dir >= 1 && dir <= 9 ? dir : 5;
    target = loc(start.x + 99 * DDX[dd]!, start.y + 99 * DDY[dd]!);
  }

  /* sound(MSG_SHOOT): the loose (do_cmd_fire / do_cmd_throw). */
  state.sound?.(MSG.SHOOT);

  const path = projectPath(state.chunk, range, start, target, 0);

  let hit = false;
  let landing = start;
  for (const grid of path) {
    /* Stop before hitting an impassable, non-projectable wall. */
    if (!state.chunk.isPassable(grid) && !state.chunk.isProjectable(grid)) break;
    landing = grid;

    const mon = squareMonster(state, grid);
    if (!mon) continue;

    const monObvious = monsterIsObvious(mon);
    const dist = Math.max(
      Math.abs(grid.x - start.x),
      Math.abs(grid.y - start.y),
    );
    const percentDamage = state.options?.get("birth_percent_damage") ?? false;
    const result = throwing
      ? makeRangedThrow(
          state.rng, player, state.actor.combat, missile, mon,
          state.brands, state.slays, dist, monObvious, percentDamage,
        )
      : makeRangedShot(
          state.rng, player, state.actor.combat, missile, launcher!, mon,
          state.brands, state.slays, dist, monObvious, percentDamage,
        );

    const oName = describeObject(state, missile, ODESC.FULL | ODESC.SINGULAR);
    const mName = mon.race.flags.has(RF.UNIQUE)
      ? mon.race.name
      : `the ${mon.race.name}`;

    if (result.success) {
      hit = true;
      let dmg = result.damage;
      if (dmg <= 0) {
        dmg = 0;
        state.msg?.(`Your ${oName} fails to harm ${mName}.`);
      } else {
        state.msg?.(`Your ${oName} ${result.verb} ${mName}.`);
      }
      state.sound?.(MSG.SHOOT_HIT);
      mon.hp -= dmg;
      if (mon.hp < 0 && !arenaInterceptDeath(state, mon)) {
        const dieMsg = monsterIsDestroyed(mon) ? MON_MSG.DESTROYED : MON_MSG.DIE;
        const text = formatMonsterMessage(mon, dieMsg);
        if (text) state.msg?.(text);
        state.sound?.(monMessageSoundType(dieMsg));
        state.onPlayerKill?.(mon);
        deleteMonster(state, mon.midx);
      }
    } else {
      state.msg?.(`The ${oName} misses ${mName}.`);
    }

    /* No piercing (TMD_POWERSHOT deferred): stop at the first monster. */
    break;
  }

  return { hit, landing };
}

/** Install the fire and throw commands over the live action registry. */
export function installRangedCommands(registry: ActionRegistry): void {
  registry.register("fire", (state, cmd: PlayerCommand) => {
    const player = state.actor.player;
    const args = cmd.args ?? {};

    /* The equipped launcher. */
    const bowSlot = player.body.slots.findIndex((s) => s.type === "BOW");
    const launcher =
      bowSlot >= 0 ? gearGet(state.gear, player.equipment[bowSlot] ?? 0) : null;
    if (!launcher) {
      state.msg?.("You have nothing to fire with.");
      return 0;
    }

    const handle = typeof args["handle"] === "number" ? args["handle"] : -1;
    const src = handle >= 0 ? gearGet(state.gear, handle) : null;
    if (!src || !tvalIsAmmo(src.tval)) {
      state.msg?.("You have no ammunition to fire.");
      return 0;
    }
    if (src.tval !== state.actor.combat.ammoTval) {
      state.msg?.("That ammo cannot be fired by your current weapon.");
      return 0;
    }

    const dir = typeof args["dir"] === "number" ? args["dir"] : (cmd.dir ?? 5);
    /* Take one missile out of the stack. */
    const { obj: missile } = gearObjectForUse(state.gear, player, handle, 1);

    const range = Math.min(
      6 + 2 * Math.trunc(state.actor.combat.numShots / 10),
      state.z.maxRange,
    );
    const { hit, landing } = rangedHelper(state, missile, launcher, dir, range, false);

    /* Drop the (surviving) missile where it landed. */
    dropNear(state, missile, breakageChance(missile, hit), landing, true, {});

    const shots = Math.max(10, state.actor.combat.numShots);
    return Math.trunc((state.z.moveEnergy * 10) / shots);
  });

  registry.register("throw", (state, cmd: PlayerCommand) => {
    const player = state.actor.player;
    const args = cmd.args ?? {};

    const handle = typeof args["handle"] === "number" ? args["handle"] : -1;
    const src = handle >= 0 ? gearGet(state.gear, handle) : null;
    if (!src) {
      state.msg?.("You have nothing to throw.");
      return 0;
    }

    const dir = typeof args["dir"] === "number" ? args["dir"] : (cmd.dir ?? 5);
    const { obj: missile } = gearObjectForUse(state.gear, player, handle, 1);

    /* Heavier objects do not fly as far (do_cmd_throw's weight bound). */
    const weight = Math.max(objectWeightOne(missile), 10);
    const range = Math.min(
      Math.trunc((2 * player.lev + 40) / weight) + 1,
      state.z.maxRange,
    );

    const { hit, landing } = rangedHelper(state, missile, null, dir, range, true);
    dropNear(state, missile, breakageChance(missile, hit), landing, true, {});

    return state.z.moveEnergy;
  });
}
