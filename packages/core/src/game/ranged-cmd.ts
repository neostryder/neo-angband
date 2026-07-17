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
 * Ported here (player-attack.c ranged_helper): TMD_POWERSHOT piercing
 * (player-attack.c:1092-1095,1198-1201,1217-1219), the ay+ax/2 distance to-hit
 * penalty (cave-view.c:38 via loc.ts distance, gap 2.6), and the full
 * mon_take_hit routing so ranged hits generate fear, "flees in terror", and
 * message_pain (player-attack.c:1191-1195, gap 2.4).
 *
 * DEFERRED (ledgered in parity/ledger/ranged-cmd.yaml): the out-of-range "Fire
 * anyway?" prompt (UI), missile / equipment learn-on-attack (knowledge), the
 * show_damage " (N)" suffix, the invisible-monster "finds a mark" branch, and
 * the crit-flavour line (the hit verb still varies). The throw range uses a
 * compact weight bound.
 */

import { MON_MSG, MSG, RF, TMD } from "../generated";
import { distance, loc } from "../loc";
import type { Loc } from "../loc";
import { makeRangedShot, makeRangedThrow, breakageChance } from "../combat/ranged";
import { objectWeightOne, tvalIsAmmo, tvalIsSharpMissile } from "../obj/object";
import type { GameObject } from "../obj/object";
import { ODESC } from "../obj/desc";
import { projectPath } from "../world/project";
import { monsterIsObvious, monsterIsDestroyed } from "../mon/predicate";
import { monTakeHit } from "../mon/take-hit";
import { playerClearTimed } from "../player/timed";
import { gearGet, gearObjectForUse } from "./gear";
import { dropNear } from "./floor";
import { squareMonster, deleteMonster, arenaInterceptDeath } from "./context";
import type { GameState, PlayerCommand } from "./context";
import { targetOkay, targetGet, targetSetClosest, TARGET } from "./target";
import { describeObject } from "./describe";
import { formatMonsterMessage, formatPainMessage, monMessageSoundType } from "./mon-message";
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

  /* Piercing: TMD_POWERSHOT lets a sharp missile pass through ammo_mult
   * monsters (player-attack.c:1092-1095); every other shot stops at one. */
  let pierce = 1;
  if ((player.timed[TMD.POWERSHOT] ?? 0) > 0 && tvalIsSharpMissile(missile.tval)) {
    pierce = state.actor.combat.ammoMult;
  }

  let hit = false;
  let landing = start;
  for (const grid of path) {
    /* Stop before hitting an impassable, non-projectable wall. */
    if (!state.chunk.isPassable(grid) && !state.chunk.isProjectable(grid)) break;
    landing = grid;

    const mon = squareMonster(state, grid);
    if (!mon) continue;

    const monObvious = monsterIsObvious(mon);
    /* Distance penalty uses the ay + ax/2 metric (cave-view.c:38), not the
     * Chebyshev max, so diagonal shots are penalized faithfully (gap 2.6). */
    const dist = distance(start, grid);
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

      /* Route damage through mon_take_hit so a survivor rolls fear and a kill
       * is handled uniformly (player-attack.c:1191). Death messaging stays
       * explicit here (empty note), matching the port's ranged death lines. */
      const res = monTakeHit(state.rng, mon, dmg, "", {
        ...(state.becomeAware ? { becomeAware: state.becomeAware } : {}),
        ...(state.arenaLevel
          ? { onArenaDeath: (m) => void arenaInterceptDeath(state, m) }
          : {}),
      });
      if (res.died) {
        if (!state.arenaLevel) {
          const dieMsg = monsterIsDestroyed(mon) ? MON_MSG.DESTROYED : MON_MSG.DIE;
          const text = formatMonsterMessage(mon, dieMsg);
          if (text) state.msg?.(text);
          state.sound?.(monMessageSoundType(dieMsg));
          state.onPlayerKill?.(mon);
          deleteMonster(state, mon.midx);
        }
      } else {
        /* message_pain, then the delayed flee message (player-attack.c:1192). */
        const pain = formatPainMessage(mon, dmg);
        if (pain) state.msg?.(pain);
        if (res.fear && monsterIsObvious(mon)) {
          const flee = formatMonsterMessage(mon, MON_MSG.FLEE_IN_TERROR);
          if (flee) state.msg?.(flee);
        }
      }
    } else {
      state.msg?.(`The ${oName} misses ${mName}.`);
    }

    /* Stop the missile, or reduce its piercing effect (player-attack.c:1198). */
    pierce--;
    if (pierce > 0) continue;
    break;
  }

  /* Terminate piercing (player-attack.c:1217): player_clear_timed(p,
   * TMD_POWERSHOT, true, false) - routed through the grade machinery for the
   * on-end message when the world env is wired (RNG-free either way). */
  if ((player.timed[TMD.POWERSHOT] ?? 0) > 0) {
    const eff = state.world?.timedTable?.[TMD.POWERSHOT];
    if (eff) {
      playerClearTimed(player, eff, true, false, state.world?.timedHooks ?? {});
    } else {
      player.timed[TMD.POWERSHOT] = 0;
    }
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

  /**
   * do_cmd_fire_at_nearest (player-attack.c:1412): the "fire at nearest visible
   * monster" convenience (h in the original keyset, TAB in roguelike). Requires
   * a usable launcher, picks the first eligible ammo from the quiver, targets
   * the closest valid foe with TARGET_KILL | TARGET_QUIET (no "No Available
   * Target." message on failure), then reuses do_cmd_fire with DIR_TARGET.
   */
  const fireHandler = registry.get("fire");
  registry.register("fire-at-nearest", (state, _cmd: PlayerCommand) => {
    const player = state.actor.player;

    /* Require a usable launcher (player-attack.c:1417-1421). */
    const bowSlot = player.body.slots.findIndex((s) => s.type === "BOW");
    const launcher =
      bowSlot >= 0 ? gearGet(state.gear, player.equipment[bowSlot] ?? 0) : null;
    if (!launcher || !state.actor.combat.ammoTval) {
      state.msg?.("You have nothing to fire with.");
      return 0;
    }

    /* Find first eligible ammo in the quiver (player-attack.c:1423-1431). */
    let ammoHandle = -1;
    for (const h of state.gear.quiver ?? []) {
      if (!h) continue;
      const o = gearGet(state.gear, h);
      if (!o || o.tval !== state.actor.combat.ammoTval) continue;
      ammoHandle = h;
      break;
    }
    if (ammoHandle < 0) {
      state.msg?.("You have no ammunition in the quiver to fire.");
      return 0;
    }

    /* Require a foe (player-attack.c:1440). */
    if (!targetSetClosest(state, TARGET.KILL | TARGET.QUIET)) return 0;

    /* Fire! dir = DIR_TARGET (player-attack.c:1413,1443-1445). */
    return fireHandler
      ? fireHandler(state, { code: "fire", args: { handle: ammoHandle, dir: 5 } })
      : 0;
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
