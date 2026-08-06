/**
 * PORT_TODO 5.3: the customised-defaults option files reach a real character.
 *
 * A WIRING test, and for the same reason 7.4 needed one. option-file.test.ts
 * proves the writer emits option.c's bytes and the reader parses parser.c's
 * grammar; neither proves that a NEW CHARACTER opens on those values, which is
 * the entire feature. The port's previous position was that "the game save IS
 * the persistence" - true for a character that exists, and no help at all at
 * birth, where the file is the only carrier.
 *
 * So this writes a customised file through a host, boots a game, and reads the
 * live OptionState. The two controls matter as much as the assertion: with no
 * file the store must be byte-identical to the table, and an explicit birth
 * choice must still beat the file.
 */
import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { OPTION_ENTRIES } from "../generated/options.js";
import { HostDir, NULL_HOST, setHost } from "../host/io.js";
import type { HostIo } from "../host/io.js";
import { OptionState } from "../player/options.js";
import { optionsSaveCustomText } from "../player/options-file.js";
import { startGame } from "./game.js";
import type { GamePack } from "./game.js";

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

/** A host whose USER directory is a Map. */
function memHost(files: Map<string, string>): HostIo {
  return {
    ...NULL_HOST,
    displayPath: (dir, name) => `${dir}/${name}`,
    exists: (dir, name) => dir === HostDir.USER && files.has(name),
    read: (dir, name) => (dir === HostDir.USER ? (files.get(name) ?? null) : null),
    write: (dir, name, text) => {
      if (dir !== HostDir.USER) return "create-failed";
      files.set(name, text);
      return "ok";
    },
  };
}

/** An INTERFACE and a BIRTH option, each inverted from its table default. */
const IFACE = OPTION_ENTRIES.find((e) => e.type === "INTERFACE")!;
const BIRTH = OPTION_ENTRIES.find((e) => e.type === "BIRTH")!;
const CHEAT = OPTION_ENTRIES.find((e) => e.type === "CHEAT")!;

/** A file for `page` with every one of its options flipped. */
function invertedFile(page: string): string {
  const opts: Record<string, boolean> = {};
  for (const e of OPTION_ENTRIES) if (e.type === page) opts[e.name] = !e.normal;
  return optionsSaveCustomText(opts, page);
}

/** state.options is optional on GameState; a booted game always has one. */
function opts(game: ReturnType<typeof boot>): OptionState {
  const o = game.state.options;
  if (!o) throw new Error("fixture: a booted game must have an OptionState");
  return o;
}

function boot(files: Map<string, string>, overrides?: Record<string, boolean>) {
  setHost(memHost(files));
  return startGame(pack, {
    seed: 1,
    ...(overrides ? { optionOverrides: overrides } : {}),
  });
}

afterEach(() => setHost(NULL_HOST));

describe("options_init_defaults reaches a booted character (PORT_TODO 5.3)", () => {
  it("CONTROL: with no customised file the store is the table, exactly", () => {
    const game = boot(new Map());
    for (const e of OPTION_ENTRIES) {
      expect(opts(game).get(e.name), e.name).toBe(e.normal);
    }
  });

  it("a customised INTERFACE file changes what a new character starts with", () => {
    const game = boot(new Map([["customized_interface_options.txt", invertedFile("INTERFACE")]]));
    expect(opts(game).get(IFACE.name)).toBe(!IFACE.normal);
    /* And only that page moved. */
    for (const e of OPTION_ENTRIES) {
      if (e.type !== "INTERFACE") expect(opts(game).get(e.name), e.name).toBe(e.normal);
    }
  });

  it("a customised BIRTH file reaches the FROZEN birth snapshot, not just the live value", () => {
    /* birthValue() is the immutable record the score screen and the save read.
     * A file that only moved the live value would leave the character's birth
     * options saying something different from how it was actually generated. */
    const game = boot(new Map([["customized_birth_options.txt", invertedFile("BIRTH")]]));
    expect(opts(game).get(BIRTH.name)).toBe(!BIRTH.normal);
    expect(opts(game).birthValue(BIRTH.name)).toBe(!BIRTH.normal);
  });

  it("an explicit birth CHOICE still beats the customised file", () => {
    /* options_init_defaults runs in player_init, long before the birth screen
     * writes anything, so the choice is applied last and wins. */
    const game = boot(new Map([["customized_birth_options.txt", invertedFile("BIRTH")]]), {
      [BIRTH.name]: BIRTH.normal,
    });
    expect(opts(game).get(BIRTH.name)).toBe(BIRTH.normal);
    expect(opts(game).birthValue(BIRTH.name)).toBe(BIRTH.normal);
  });

  it("a customised CHEAT file is IGNORED: init restores only BIRTH and INTERFACE", () => {
    /* option.c L198-199 names those two pages and no others. This is the
     * assertion that would fail if someone 'helpfully' looped every page. */
    const game = boot(new Map([["customized_cheat_options.txt", invertedFile("CHEAT")]]));
    expect(opts(game).get(CHEAT.name)).toBe(CHEAT.normal);
  });

  it("a malformed file leaves the page on the table defaults rather than failing to start", () => {
    const files = new Map([
      ["customized_interface_options.txt", "option:not_a_real_option:maybe\ngarbage\n"],
    ]);
    const game = boot(files);
    for (const e of OPTION_ENTRIES) {
      if (e.type === "INTERFACE") expect(opts(game).get(e.name), e.name).toBe(e.normal);
    }
  });

  it("the two scalars keep their post-file defaults (option.c L201, L204)", () => {
    const game = boot(new Map([["customized_interface_options.txt", invertedFile("INTERFACE")]]));
    expect(opts(game).delayFactor).toBe(40);
    expect(opts(game).hitpointWarn).toBe(3);
  });
});
