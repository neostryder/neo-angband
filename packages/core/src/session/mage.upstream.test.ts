/**
 * Upstream unit tests from reference/src/tests/game/mage.c
 * (suite game/mage, test_magic_missile).
 *
 * Mapping:
 * - player_make_simple("Gnome", "Mage", "Tyrion") (test-utils.c) -> startGame
 *   with raceName "Gnome" / className "Mage"; prepare_next_level +
 *   on_new_level are startGame's generation step.
 * - cmdq_push(CMD_STUDY) + cmd_set_arg_choice("spell", 0) -> the "study"
 *   action registered by installSpellCommands (game/spell-cmd.ts:294), driven
 *   through processPlayer, which IS the port's run_game_loop command step.
 * - cmdq_push(CMD_CAST) + cmd_set_arg_choice("spell", 0) +
 *   cmd_set_arg_target("target", 2) -> the "cast" action
 *   (game/spell-cmd.ts:237) with dir 2.
 * - noteq(player->csp, player->msp) -> the mana spend in spellCast
 *   (spell-cmd.ts:213-219, player-spell.c:524-533).
 *
 * The one place the port needs an argument upstream does not: the port's study
 * command takes the spellbook by gear handle, because upstream's book MENU
 * (cmd_get_item inside cmd_study) is the UI layer's job (spell-cmd.ts module
 * header, #25). The test resolves the handle the same way a front end would,
 * with playerObjectToBook over the pack.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { TMD } from "../generated/index.js";
import { PY_FOOD_FULL_DEFAULT } from "../player/birth.js";
import { gearGet } from "../game/gear.js";
import { playerObjectToBook, spellOkayToCast } from "../player/spell.js";
import { processPlayer } from "../game/player-turn.js";
import type { GameState, PlayerCommand } from "../game/context.js";
import type { ActionRegistry } from "../game/player-turn.js";
import { startGame } from "./game.js";
import type { GamePack } from "./game.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as T;
}
function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

const pack: GamePack = {
  constants: loadJson("constants"),
  terrain: loadRecords("terrain"),
  roomTemplates: loadRecords("room_template"),
  vaults: loadRecords("vault"),
  dungeonProfiles: loadRecords("dungeon_profile"),
  projection: loadRecords("projection"),
  trap: loadRecords("trap"),
  names: loadRecords("names"),
  obj: {
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
  } as GamePack["obj"],
  mon: {
    pain: loadRecords("pain"),
    blowMethods: loadRecords("blow_methods"),
    blowEffects: loadRecords("blow_effects"),
    monsterSpells: loadRecords("monster_spell"),
    monsterBases: loadRecords("monster_base"),
    monsters: loadRecords("monster"),
    summons: loadRecords("summon"),
    pits: loadRecords("pit"),
  },
  player: {
    races: loadRecords("p_race"),
    classes: loadRecords("class"),
    properties: loadRecords("player_property"),
    timed: loadRecords("player_timed"),
    shapes: loadRecords("shape"),
    bodies: loadRecords("body"),
    history: loadRecords("history"),
    realms: loadRecords("realm"),
  },
};

/** Run one command through processPlayer; returns the energy it consumed. */
function run(
  state: GameState,
  registry: ActionRegistry,
  cmd: PlayerCommand,
): number {
  const commands = [cmd];
  state.nextCommand = (): PlayerCommand | null => commands.shift() ?? null;
  return processPlayer(state, registry).energyUsed;
}

/** The gear handle of the class spellbook (upstream's cmd_get_item choice). */
function bookHandle(state: GameState): number {
  const h = state.gear.pack.find((handle) => {
    const o = gearGet(state.gear, handle);
    return o !== null && playerObjectToBook(state.actor.player, o) !== null;
  });
  expect(h).toBeDefined();
  return h!;
}

describe("game/mage (reference/src/tests/game/mage.c)", () => {
  // upstream: test_magic_missile
  it("magic_missile", () => {
    const game = startGame(pack, {
      seed: 42,
      depth: 1,
      raceName: "Gnome",
      className: "Mage",
    });
    const { state, registry } = game;
    const p = state.actor.player;

    /* eq(player_make_simple(...), true) / eq(player->is_dead, false) /
     * notnull(cave) / eq(chp, mhp) / eq(timed[TMD_FOOD], PY_FOOD_FULL - 1). */
    expect(p.race.name).toBe("Gnome");
    expect(p.cls.name).toBe("Mage");
    expect(state.isDead).toBe(false);
    expect(state.chunk).toBeTruthy();
    expect(p.chp).toBe(p.mhp);
    expect(p.timed[TMD.FOOD]).toBe(PY_FOOD_FULL_DEFAULT - 1);

    /* A newborn Mage has mana and has not learned anything yet. */
    expect(p.msp).toBeGreaterThan(0);
    expect(p.csp).toBe(p.msp);
    expect(spellOkayToCast(p, 0)).toBe(false);

    /* cmdq_push(CMD_STUDY); cmd_set_arg_choice(..., "spell", 0). */
    const handle = bookHandle(state);
    expect(run(state, registry, { code: "study", args: { handle, spell: 0 } })).toBe(
      state.z.moveEnergy,
    );
    /* Magic Missile is spell 0 of the Mage's first book (Magic for Beginners,
     * reference/lib/gamedata/class.txt), and it is now learned. */
    expect(spellOkayToCast(p, 0)).toBe(true);

    /* cmdq_push(CMD_CAST); cmd_set_arg_choice(..., "spell", 0);
     * cmd_set_arg_target(..., "target", 2) -- direction 2, south. */
    expect(run(state, registry, { code: "cast", args: { spell: 0, dir: 2 } })).toBe(
      state.z.moveEnergy,
    );

    /* noteq(player->csp, player->msp): spell_cast spends the mana whether or
     * not the concentration roll succeeded (player-spell.c:524-533, mirrored
     * at spell-cmd.ts:213-219), so one cast is enough. */
    expect(p.csp).not.toBe(p.msp);
    expect(p.csp).toBe(p.msp - 1);
  });
});
