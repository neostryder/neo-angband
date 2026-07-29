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
 * anyway?" prompt (UI) and the crit-flavour line (the hit verb still varies).
 * The show_damage " (N)" suffix is now wired (player-attack.c:1168-1170), and
 * the invisible-monster "finds a mark" branch is now ported
 * (player-attack.c:1156-1159) - it had been listed here as deferred, which is
 * exactly how a missing player-visible message stays missing.
 * Missile / equipment / brand-slay learn-on-attack is wired below (W2-001/002/
 * 010/011; player-attack.c:1137-1140, 1255-1259, 1296-1299).
 */

import { MON_MSG, MSG, RF, STAT, TMD } from "../generated";
import { distance, loc } from "../loc";
import type { Loc } from "../loc";
import { adj_str_blow } from "../player/calcs";
import { makeRangedShot, makeRangedThrow, breakageChance } from "../combat/ranged";
import {
  learnBrandSlayFromLaunch,
  learnBrandSlayFromThrow,
} from "../combat/brand-slay";
import {
  equipLearnOnRangedAttack,
  missileLearnOnRangedAttack,
} from "../obj/knowledge";
import { objectWeightOne, tvalIsAmmo, tvalIsSharpMissile } from "../obj/object";
import type { GameObject } from "../obj/object";
import { ODESC } from "../obj/desc";
import { projectPath } from "../world/project";
import { monsterIsObvious, monsterIsDestroyed, monsterIsVisible } from "../mon/predicate";
import { getLore } from "../mon/lore";
import { monTakeHit } from "../mon/take-hit";
import { playerClearTimed } from "../player/timed";
import { gearGet, gearObjectForUse } from "./gear";
import { dropNear, floorPile, floorObjectForUse, itemIsAvailable } from "./floor";
import { invenTakeoff, playerConfuseDir } from "./obj-cmd";
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
    /* KNOWN LIMIT, not a fix: an unusable DIR_TARGET arriving here aims at the
     * player's OWN grid, because DDX[5]/DDY[5] are both 0 - a missile spent on a
     * zero-length path. Upstream cannot reach this state: cmd_get_target
     * (cmd-core.c:955-969) re-validates a stored direction and RE-PROMPTS when
     * `*target == DIR_TARGET && !target_okay()`. Core has no prompt to re-open, so
     * closing this properly means the caller re-validating before it queues the
     * command, not clamping here (clamping would fire in a direction the player
     * never chose). The web shell's aimDir does validate, so no live path reaches
     * it today; the agent/borg act seams are what could. */
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
    if (!mon) {
      /* Stop if non-projectable but passable (player-attack.c:1204-1206): the
       * missile breaks against terrain it cannot pass through, e.g. rubble. */
      if (!state.chunk.isProjectable(grid)) break;
      continue;
    }

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

    if (result.success) {
      hit = true;

      /*
       * Learn-on-hit (player-attack.c). All learning is RNG-free; it sits after
       * make_ranged_*'s to-hit/damage/crit draws and before mon_take_hit's fear
       * roll, matching the C draw order:
       *   make_ranged_shot: missile_learn(bow) then learn_brand_slay_from_launch
       *   make_ranged_throw: learn_brand_slay_from_throw
       *   ranged_helper: missile_learn(obj) then equip_learn_on_ranged_attack
       *   then object_desc (with up-to-date knowledge) then mon_take_hit
       */
      const monVisible = monsterIsVisible(mon);
      const learnMon = {
        race: mon.race,
        visible: monVisible,
        lore: getLore(state.lore, mon.race),
      };
      if (throwing) {
        learnBrandSlayFromThrow(player, state.runeEnv, missile, learnMon);
      } else {
        if (launcher) missileLearnOnRangedAttack(player, state.runeEnv, launcher);
        learnBrandSlayFromLaunch(player, state.runeEnv, missile, launcher, learnMon);
      }
      missileLearnOnRangedAttack(player, state.runeEnv, missile);
      equipLearnOnRangedAttack(player, state.runeEnv);

      /* Describe after learning so the message reflects new knowledge
       * (player-attack.c:1137-1147). */
      const oName = describeObject(state, missile, ODESC.FULL | ODESC.SINGULAR);
      const mName = mon.race.flags.has(RF.UNIQUE)
        ? mon.race.name
        : `the ${mon.race.name}`;

      let dmg = result.damage;
      if (dmg <= 0) dmg = 0;
      /* OPT(player, show_damage) (player-attack.c:1168-1170): the hit line
       * carries " (N)". Built after the dmg<=0 clamp, as upstream is, so a
       * harmless hit reads " (0)". */
      const dmgText = state.options?.get("show_damage") ? ` (${dmg})` : "";
      /* `visible` in the C is monster_is_obvious (player-attack.c:1120), NOT
       * monster_is_visible: a mimic still camouflaged as an item is "seen" but
       * is not obviously a monster, so upstream will not name it. The learn
       * paths above are the ones that use monster_is_visible (obj-slays.c:568),
       * which is why the two are kept apart here. */
      if (!monsterIsObvious(mon)) {
        /* Invisible monster (player-attack.c:1156-1159). The port had no such
         * branch, so shooting something unseen produced a message naming a
         * monster the player has no business knowing about. */
        state.msg?.(`The ${oName} finds a mark.`, MSG.SHOOT_HIT);
      } else if (dmg <= 0) {
        state.msg?.(`Your ${oName} fails to harm ${mName}${dmgText}.`, MSG.SHOOT_HIT);
      } else {
        state.msg?.(`Your ${oName} ${result.verb} ${mName}${dmgText}.`, MSG.SHOOT_HIT);
      }
      state.sound?.(MSG.SHOOT_HIT);

      /* health_track (player-attack.c:1183-1187): an OBVIOUS hit - not merely a
       * visible one - makes the victim the tracked monster. Covers fire AND
       * throw, since both route through here. Upstream's order is after the
       * message and before mon_take_hit. */
      if (monObvious) state.healthWho = mon;

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
          /* get_message_type (mon-msg.c:450): a unique's death plays
           * MSG_KILL_UNIQUE (MSG_KILL_KING for Morgoth's base). */
          const type = monMessageSoundType(dieMsg, mon.race);
          if (text) state.msg?.(text, type);
          state.sound?.(type);
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
    }
    /* No else: ranged_helper prints nothing on a miss (player-attack.c:1132
     * has an if(result.success) block and no else branch), R3. */

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

    /* The equipped launcher. do_cmd_fire duplicates player_can_fire's body
     * inline (player-attack.c:1334-1338 vs player-util.c:1206) rather than
     * calling it; player_can_fire itself is only reached through
     * player_can_fire_prereq (the 'f'/'t' key, ui-game.c:124) and the
     * context-menu row check (ui-context.c:508). */
    const bowSlot = player.body.slots.findIndex((s) => s.type === "BOW");
    const launcher =
      bowSlot >= 0 ? gearGet(state.gear, player.equipment[bowSlot] ?? 0) : null;
    if (!launcher || !state.actor.combat.ammoTval) {
      state.msg?.("You have nothing to fire with.");
      return 0;
    }

    const handle = typeof args["handle"] === "number" ? args["handle"] : -1;
    const src = handle >= 0 ? gearGet(state.gear, handle) : null;
    if (!src || !tvalIsAmmo(src.tval)) {
      /* player-attack.c:1325 cmd_get_item error string (obj_can_fire filter). */
      state.msg?.("You have no suitable ammunition to fire.");
      return 0;
    }
    /* item_is_available (player-attack.c:1338): the ammo must still be within
     * reach. This is the "two fire commands queued for the same stack" case -
     * the second one names ammo that is already gone, and the port reported it
     * as unsuitable ammunition rather than out of reach. */
    if (!itemIsAvailable(state, src)) {
      state.msg?.("That item is not within your reach.");
      return 0;
    }
    if (src.tval !== state.actor.combat.ammoTval) {
      state.msg?.("That ammo cannot be fired by your current weapon.");
      return 0;
    }

    let dir = typeof args["dir"] === "number" ? args["dir"] : (cmd.dir ?? 5);
    /* do_cmd_fire calls player_confuse_dir immediately after cmd_get_target
     * (player-attack.c:1349-1352), including its confusion RNG draw. */
    dir = playerConfuseDir(state, dir);
    /* Take one missile out of the stack. */
    const { obj: missile } = gearObjectForUse(state.gear, player, handle, 1);

    /* Fire range (player-attack.c:1310): MIN(6 + 2 * ammo_mult, max_range) -
     * the LAUNCHER damage multiplier (state.ammo_mult), not the shots-per-turn
     * rate of fire. */
    const range = Math.min(
      6 + 2 * state.actor.combat.ammoMult,
      state.z.maxRange,
    );
    const { hit, landing } = rangedHelper(state, missile, launcher, dir, range, false);

    /* Drop the (surviving) missile where it landed. */
    dropNear(state, missile, breakageChance(missile, hit), landing, true, false, {});

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

    /* do_cmd_throw resolves the missile from equip | quiver | inven | floor
     * (player-attack.c:1384-1389). A floor index takes USE_FLOOR; otherwise a
     * gear handle covers pack/quiver/equipment. */
    const floorIdx = typeof args["floor"] === "number" ? args["floor"] : -1;
    const handle = typeof args["handle"] === "number" ? args["handle"] : -1;
    let dir = typeof args["dir"] === "number" ? args["dir"] : (cmd.dir ?? 5);
    /* do_cmd_throw calls player_confuse_dir immediately after cmd_get_target
     * (player-attack.c:1392-1395), including its confusion RNG draw. */
    dir = playerConfuseDir(state, dir);

    let missile: GameObject;
    if (floorIdx >= 0) {
      const src = floorPile(state, state.actor.grid)[floorIdx] ?? null;
      if (!src) {
        state.msg?.("You have nothing to throw.");
        return 0;
      }
      missile = floorObjectForUse(state, src, 1).usable;
    } else {
      const src = handle >= 0 ? gearGet(state.gear, handle) : null;
      if (!src) {
        state.msg?.("You have nothing to throw.");
        return 0;
      }
      /* Auto-takeoff a wielded weapon before throwing it (player-attack.c:1397-
       * 1400): obj_can_throw only lets an equipped melee weapon through, so a
       * hit here is exactly that case. */
      if (player.equipment.includes(handle)) {
        invenTakeoff(state, handle);
      }
      missile = gearObjectForUse(state.gear, player, handle, 1).obj;
    }

    /* Throw range (player-attack.c:1366,1402-1403): str = adj_str_blow[
     * stat_ind[STAT_STR]]; weight = MAX(object_weight_one(obj), 10); range =
     * MIN(((str + 20) * 10) / weight, 10). Heavier objects fly less far. The
     * hard cap is 10 (NOT z_info->max_range), and the STR-blow adjustment - not
     * player level - drives it. */
    const str = adj_str_blow[state.statInd?.[STAT.STR] ?? 0] ?? 0;
    const weight = Math.max(objectWeightOne(missile), 10);
    const range = Math.min(Math.trunc(((str + 20) * 10) / weight), 10);

    const { hit, landing } = rangedHelper(state, missile, null, dir, range, true);
    dropNear(state, missile, breakageChance(missile, hit), landing, true, false, {});

    return state.z.moveEnergy;
  });
}
