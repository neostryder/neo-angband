/**
 * Upstream unit tests from reference/src/tests/player/digging.c
 *
 * Mapping: test_autoswap_side_effects -> the real tunnel command and findPath.
 *
 * Upstream pushes CMD_TUNNEL through cmdq and then calls find_path(); both
 * reach player_best_digger (player-util.c L744), which temporarily wields the
 * pack's best digger and recomputes calc_bonuses with update=false. The point
 * of the test is that this round trip leaves chp/chp_frac/csp/csp_frac
 * untouched: with update=true, calc_bonuses clamps chp to mhp and csp to msp,
 * and the equipped weapon in the fixture grants +8 INT/WIS/CON while the pack
 * digger grants none, so a leaky swap would visibly move them.
 *
 * The port routes the same swap through state.bestDiggerDigging
 * (game/cave-cmd.ts tunnelAux L485, game/player-path.ts rubblePenalty L387),
 * which session/game.ts L688-709 builds from playerBestDiggerDigging plus
 * calcBonuses({ update: false }). That closure is reproduced verbatim here so
 * the test exercises the production path, not a stand-in: the assertions run
 * against the real cave command through processPlayer.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants";
import { FEAT, OBJ_MOD, TV } from "../generated";
import { loc } from "../loc";
import { ObjRegistry } from "../obj/bind";
import type { ObjPackJson } from "../obj/types";
import { objectPrep } from "../obj/make";
import type { GameObject } from "../obj/object";
import { playerBestDiggerDigging } from "../player/best-digger";
import { calcBonuses } from "../player/calcs";
import { SKILL } from "../player/types";
import { Rng } from "../rng";
import { installCaveCommands } from "./cave-cmd";
import type { GameState } from "./context";
import { gearAdd, gearGet, wieldSlot } from "./gear";
import { findPath } from "./player-path";
import { createDefaultRegistry, processPlayer } from "./player-turn";
import { GRANITE, makeState, plReg } from "./harness";
import { squareMemorize } from "./known";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as T;
}

const objPack = {
  objectBase: loadJson("object_base"),
  object: loadJson("object"),
  egoItem: loadJson("ego_item"),
  artifact: loadJson("artifact"),
  curse: loadJson("curse"),
  brand: loadJson("brand"),
  slay: loadJson("slay"),
  activation: loadJson("activation"),
  objectProperty: loadJson("object_property"),
  flavor: loadJson("flavor"),
} as ObjPackJson;

const reg = new ObjRegistry(objPack);
const constants = bindConstants(loadJson("constants"));

function prep(tval: number, sval: number): GameObject {
  const k = reg.lookupKind(tval, sval);
  if (!k) throw new Error(`no kind ${tval}/${sval}`);
  return objectPrep(new Rng(1), reg, constants, k, 0, "minimise");
}

/**
 * state.bestDiggerDigging, reproduced from session/game.ts L688-709 (the only
 * production wiring). calc_bonuses runs with update=false, which is exactly
 * the property under test.
 */
function wireBestDigger(state: GameState): { calls: number } {
  const counter = { calls: 0 };
  state.bestDiggerDigging = (): number => {
    counter.calls++;
    const p = state.actor.player;
    const equipment = p.equipment.map((h) => (h ? gearGet(state.gear, h) : null));
    const weaponSlot = p.body.slots.findIndex((s) => s.type === "WEAPON");
    return playerBestDiggerDigging(
      equipment,
      [...state.gear.store.values()],
      weaponSlot,
      (equip) =>
        calcBonuses(p, {
          equipment: equip,
          timedEffects: plReg.timed,
          curses: reg.curses,
          update: false,
          depth: state.chunk.depth,
          isDaytime: false,
        }).skills[SKILL.DIGGING] ?? 0,
    );
  };
  return counter;
}

describe("player/digging (reference/src/tests/player/digging.c)", () => {
  // upstream: test_autoswap_side_effects
  it("autoswap side effects", () => {
    const state = makeState({ w: 9, h: 9, playerGrid: loc(5, 4) });
    const p = state.actor.player;

    /* A weapon that positively affects hit points and mana (digging.c L69-86). */
    const weapon = prep(TV.SWORD, 1);
    weapon.toH = 8;
    weapon.toD = 8;
    weapon.modifiers[OBJ_MOD.STR] = 0;
    weapon.modifiers[OBJ_MOD.INT] = 8;
    weapon.modifiers[OBJ_MOD.WIS] = 8;
    weapon.modifiers[OBJ_MOD.CON] = 8;
    weapon.modifiers[OBJ_MOD.TUNNEL] = 0;

    /* Better for digging, but affects neither hit points nor mana (L88-102). */
    const digger = prep(TV.DIGGING, 1);
    digger.toH = 0;
    digger.toD = 0;
    digger.modifiers[OBJ_MOD.STR] = 4;
    digger.modifiers[OBJ_MOD.INT] = 0;
    digger.modifiers[OBJ_MOD.WIS] = 0;
    digger.modifiers[OBJ_MOD.CON] = 0;
    digger.modifiers[OBJ_MOD.TUNNEL] = 8;

    /* Equip the weapon; the digger goes in the pack (L104-137). */
    const wh = gearAdd(state.gear, weapon);
    const weaponSlot = wieldSlot(p.body, weapon.tval, p.equipment);
    p.equipment[weaponSlot] = wh;
    state.gear.pack.push(gearAdd(state.gear, digger));

    const swap = wireBestDigger(state);
    /* The swap must actually change the DIGGING skill, or the fixture proves
     * nothing: the digger's +8 TUNNEL has to beat the wielded weapon's 0. */
    const wielded = calcBonuses(p, {
      equipment: p.equipment.map((h) => (h ? gearGet(state.gear, h) : null)),
      timedEffects: plReg.timed,
      curses: reg.curses,
      update: false,
      depth: state.chunk.depth,
      isDaytime: false,
    }).skills[SKILL.DIGGING] ?? 0;
    expect(state.bestDiggerDigging!()).toBeGreaterThan(wielded);
    swap.calls = 0;

    const registry = createDefaultRegistry();
    installCaveCommands(registry);

    /* Give the player something difficult to dig, west of them (L163). */
    state.chunk.setFeat(loc(4, 4), GRANITE);
    /* do_cmd_tunnel_test's knowledge gate (cmd-cave.c:456-459): upstream's
     * test runs in a lit room where the grid is already known. */
    squareMemorize(state, loc(4, 4));

    /* Rest until hit points and mana are fully recovered (L178-183). */
    p.mhp = 50;
    p.chp = 50;
    p.chpFrac = 0;
    p.msp = 30;
    p.csp = 30;
    p.cspFrac = 0;
    const oldChp = p.chp;
    const oldCsp = p.csp;

    /* Dig out the granite: cmdq_push(CMD_TUNNEL), direction 4 (L190-193). */
    const commands = [{ code: "tunnel" as const, dir: 4 }];
    state.nextCommand = () => commands.shift() ?? null;
    processPlayer(state, registry);
    /* The command really reached the autoswap (do_cmd_tunnel_aux L485). */
    expect(swap.calls).toBeGreaterThan(0);
    expect(commands).toHaveLength(0);
    expect(p.chp).toBe(oldChp);
    expect(p.chpFrac).toBe(0);
    expect(p.csp).toBe(oldCsp);
    expect(p.cspFrac).toBe(0);

    /* Pathfinding autoswaps to price rubble, then swaps back (L203). */
    state.chunk.setFeat(loc(6, 6), FEAT.RUBBLE);
    swap.calls = 0;
    findPath(state, state.actor.grid, loc(7, 7));
    /* find_path really priced the rubble via the autoswap (rubblePenalty L387). */
    expect(swap.calls).toBeGreaterThan(0);
    expect(p.chp).toBe(oldChp);
    expect(p.chpFrac).toBe(0);
    expect(p.csp).toBe(oldCsp);
    expect(p.cspFrac).toBe(0);
  });
});
