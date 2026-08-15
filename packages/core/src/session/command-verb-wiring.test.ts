/**
 * A mod's own command has a VERB, and the inscription confirm reads it.
 *
 * WHAT THIS EXISTS TO CATCH. `cmdVerb` (cmd.ts) looked its answer up in
 * `COMMAND_INFO`, which is keyed by the closed `CommandCode` union - upstream's
 * game_cmds[], and core keeps it closed. A mod registers its own command code
 * through "registry:command" as a FREE STRING, so no entry could ever exist for
 * it, `cmdVerb` returned null, and `itemAllowPrompt` fell through to
 * `ITEM_ALLOW_FALLBACK_VERB`. A player who had inscribed `!z` on a Potion of
 * Death and pressed a mod's key was asked "Really do that with your Potion of
 * Death?" for an action that had a perfectly good name.
 *
 * So this file does not assert that a map has a key. Asserting the map has the
 * key passes while the prompt still reads "do that with", which is the false
 * green this repository keeps re-earning. It starts a REAL game, takes a REAL
 * object out of the player's gear, inscribes it, installs the verb the way a mod
 * does - through the capability-gated facade, over `state.commandVerbs`, AFTER
 * the game is wired, because that is when a plugin's register() runs - and then
 * reads the RENDERED PROMPT, assembled by the same `itemAllowPrompt` the shell
 * calls with the same arguments (main.ts, allowChosenItem).
 *
 * The CONTROL is the first test: the identical call with no verb installed,
 * observed producing the generic fallback, so "the mod's verb reached the
 * sentence" is a statement that had a way to be false.
 *
 * This is a UI STRING and nothing else. The command's BEHAVIOUR still lives in
 * the `ActionRegistry` that row 3 of docs/modding/MOD_REACH.md already scores
 * reachable; `COMMAND_INFO` itself is untouched and stays closed.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { startGame } from "./game.js";
import type { GamePack, StartedGame } from "./game.js";
import type { GameState } from "../game/context.js";
import type { GameObject } from "../obj/object.js";
import { COMMAND_INFO, CommandVerbTable, cmdVerb } from "../cmd.js";
import { ITEM_ALLOW_FALLBACK_VERB, itemAllowPrompt } from "../game/inscription-confirm.js";
import { describeObject } from "../game/describe.js";
import { createModRegistryHost } from "../mod/registry-host.js";
import type { ModRegistryHost } from "../mod/registry-host.js";
import { AgentCapabilityError } from "../agent/types.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../../content/pack/${name}.json`, import.meta.url), "utf8"),
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
  quest: loadRecords("quest"),
  store: loadRecords("store"),
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

/** The mod's command: a free string code, its key, and the name it deserves. */
const MOD_CODE = "overhaul:dance";
const MOD_KEY = "z";
const MOD_VERB = "dance with";

interface Started {
  game: StartedGame;
  state: GameState;
  /** The capability-gated facade, built exactly as the web host builds it. */
  host: ModRegistryHost;
}

/**
 * A live game plus the registry facade a trusted plugin is handed, wired over
 * the same two targets main.ts wires (`registry` and `state.commandVerbs`).
 */
function started(seed: number, caps?: { has: (c: string) => boolean }): Started {
  const game = startGame(pack, { seed, depth: 1, className: "Warrior" });
  return {
    game,
    state: game.state,
    host: createModRegistryHost(
      { commands: game.registry, commandVerbs: game.state.commandVerbs ?? null },
      caps,
    ),
  };
}

/** A real object out of the player's own gear, inscribed so it asks. */
function inscribedFromGear(state: GameState, note: string): GameObject {
  const handle = state.gear.pack[0] ?? 0;
  const obj = handle ? state.gear.store.get(handle) : undefined;
  expect(obj, "fixture: the player starts with something in the pack").toBeDefined();
  obj!.note = note;
  return obj!;
}

/** get_item_allow's finished question, assembled the way main.ts assembles it. */
function renderedPrompt(s: Started, obj: GameObject, code: string, key = MOD_KEY): string {
  const ask = itemAllowPrompt(
    obj,
    key,
    code,
    false,
    (o) => describeObject(s.state, o),
    s.state.commandVerbs,
  );
  expect(ask, "the !<key> inscription should owe a confirmation").not.toBeNull();
  return ask!.prompt;
}

describe("the inscription confirm names a MOD's command", () => {
  it("CONTROL: with no verb installed, the prompt reads the generic fallback", () => {
    const s = started(4401);
    /* The mod's command is real - it is in the ActionRegistry processPlayer
     * looks a queued code up in - and it still has no name. */
    s.host.commands.register(MOD_CODE, () => 100);
    expect(s.game.registry.has(MOD_CODE)).toBe(true);

    const obj = inscribedFromGear(s.state, `!${MOD_KEY}`);
    const prompt = renderedPrompt(s, obj, MOD_CODE);
    expect(prompt).toContain(ITEM_ALLOW_FALLBACK_VERB);
    expect(prompt).not.toContain(MOD_VERB);
  });

  it("with setVerb, the RENDERED PROMPT carries the mod's verb", () => {
    const s = started(4401);
    s.host.commands.register(MOD_CODE, () => 100);
    s.host.commands.setVerb(MOD_CODE, MOD_VERB);

    const obj = inscribedFromGear(s.state, `!${MOD_KEY}`);
    const prompt = renderedPrompt(s, obj, MOD_CODE);
    /* The whole sentence, not a substring: "Really %s" (ui-object.c:667) then
     * verify_object's "%s %s? " (obj-util.c:1085), trailing space and all. */
    expect(prompt).toBe(`Really ${MOD_VERB} ${describeObject(s.state, obj)}? `);
    expect(prompt).not.toContain(ITEM_ALLOW_FALLBACK_VERB);
  });

  it("still says core's own verb for core's own command", () => {
    /* Candidate zero: the table is SEEDED from COMMAND_INFO, so adding the seam
     * cannot change a single sentence a stock game shows. */
    const s = started(4402);
    const obj = inscribedFromGear(s.state, "!q");
    const ask = itemAllowPrompt(
      obj,
      "q",
      "quaff",
      false,
      (o) => describeObject(s.state, o),
      s.state.commandVerbs,
    );
    expect(ask!.prompt).toBe(`Really quaff ${describeObject(s.state, obj)}? `);
  });

  it("lets a second mod WRAP the verb a first mod (or core) installed", () => {
    const s = started(4403);
    expect(s.host.commands.verbFor("quaff")).toBe("quaff");
    s.host.commands.setVerb("quaff", `carefully ${s.host.commands.verbFor("quaff")}`);

    const obj = inscribedFromGear(s.state, "!q");
    const prompt = renderedPrompt(s, obj, "quaff", "q");
    expect(prompt).toContain("Really carefully quaff ");
  });
});

describe("wireGame publishes the verb table, per game", () => {
  it("seeds it with core's verbs and leaves COMMAND_INFO alone", () => {
    const s = started(4501);
    const verbs = s.state.commandVerbs;
    expect(verbs).toBeInstanceOf(CommandVerbTable);
    expect(verbs!.codes()).toEqual([...COMMAND_INFO.keys()]);
    for (const [code, info] of COMMAND_INFO) expect(verbs!.verbFor(code)).toBe(info.verb);

    /* A COPY, not the module table. COMMAND_INFO is a ReadonlyMap and stays
     * one; nothing here can reach it. */
    const before = COMMAND_INFO.size;
    verbs!.set("leak-check", "leak");
    expect(COMMAND_INFO.size).toBe(before);
    expect(COMMAND_INFO.has("leak-check" as never)).toBe(false);
    /* And the bare cmdVerb - no table - is unchanged by any of it. */
    expect(cmdVerb("leak-check")).toBeNull();
    expect(cmdVerb("quaff")).toBe("quaff");
  });

  it("does not carry one character's mod verb into the next game", () => {
    /* The standing rule for every registry here: per game, never per module.
     * A module-level singleton would have the SECOND character's inscription
     * confirm reading a verb from a mod that character never played with. */
    const first = started(4502);
    first.host.commands.setVerb(MOD_CODE, MOD_VERB);
    expect(first.state.commandVerbs!.verbFor(MOD_CODE)).toBe(MOD_VERB);

    const second = started(4503);
    expect(second.state.commandVerbs).not.toBe(first.state.commandVerbs);
    expect(second.state.commandVerbs!.verbFor(MOD_CODE)).toBeNull();

    const obj = inscribedFromGear(second.state, `!${MOD_KEY}`);
    expect(renderedPrompt(second, obj, MOD_CODE)).toContain(ITEM_ALLOW_FALLBACK_VERB);
  });

  it("is gated by registry:command, like the action it names", () => {
    /* Naming a command is part of adding one, so it shares the capability
     * rather than inventing a second string for one UI sentence. */
    const s = started(4504, { has: (c) => c === "registry:room" });
    expect(() => s.host.commands.setVerb(MOD_CODE, MOD_VERB)).toThrow(AgentCapabilityError);
    expect(() => s.host.commands.setVerb(MOD_CODE, MOD_VERB)).toThrow(/registry:command/);
    expect(() => s.host.commands.verbFor(MOD_CODE)).toThrow(/registry:command/);
  });
});
