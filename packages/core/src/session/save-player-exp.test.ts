/**
 * rd_player (e44ac90f1) rejects a save whose experience is outside
 * 0..PY_MAX_EXP, or whose exp exceeds max_exp, before the player is built.
 * Angband 4.2.6 load.c assigned both fields unchecked. A legal save must
 * still load the values it wrote.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindPlayer } from "../player/bind.js";
import { blankPlayer } from "../player/player.js";
import { PY_MAX_EXP } from "../player/exp.js";
import { ObjRegistry } from "../obj/bind.js";
import type { ObjPackJson } from "../obj/types.js";
import { ContentIdResolver } from "../mod/ids.js";
import { deserializePlayer, serializePlayer } from "./save.js";
import type { SavedPlayer } from "./save.js";

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

const reg = new ObjRegistry({
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
} as ObjPackJson);

const players = bindPlayer({
  races: loadRecords("p_race"),
  classes: loadRecords("class"),
  properties: loadRecords("player_property"),
  timed: loadRecords("player_timed"),
  shapes: loadRecords("shape"),
  bodies: loadRecords("body"),
  history: loadRecords("history"),
  realms: loadRecords("realm"),
});

const ids = new ContentIdResolver({ objects: reg });

function savedPlayer(): SavedPlayer {
  const race = players.raceByName("Human")!;
  const cls = players.classByName("Warrior")!;
  const p = blankPlayer(race, cls, players.bodies[race.body]!);
  return JSON.parse(JSON.stringify(serializePlayer(p, ids))) as SavedPlayer;
}

function withExp(exp: number, maxExp: number): SavedPlayer {
  const data = savedPlayer();
  data.exp = exp;
  data.maxExp = maxExp;
  return data;
}

describe("rd_player experience range (e44ac90f1)", () => {
  it("loads a legal save, including the 0 and PY_MAX_EXP bounds", () => {
    const born = deserializePlayer(withExp(0, 0), players, reg, ids, []);
    expect(born.exp).toBe(0);
    expect(born.maxExp).toBe(0);

    const mid = deserializePlayer(withExp(100, 500), players, reg, ids, []);
    expect(mid.exp).toBe(100);
    expect(mid.maxExp).toBe(500);

    const cap = deserializePlayer(
      withExp(PY_MAX_EXP, PY_MAX_EXP),
      players,
      reg,
      ids,
      [],
    );
    expect(cap.exp).toBe(PY_MAX_EXP);
    expect(cap.maxExp).toBe(PY_MAX_EXP);
  });

  it("rejects experience outside 0..maxExp..PY_MAX_EXP before building the player", () => {
    const bad: Array<[number, number]> = [
      [-1, 0],
      [0, -1],
      [1, 0],
      [0, PY_MAX_EXP + 1],
      [PY_MAX_EXP + 1, PY_MAX_EXP + 1],
      [1.5, 10],
      [10, 10.5],
      [Number.NaN, 10],
      [10, Number.POSITIVE_INFINITY],
    ];
    for (const [exp, maxExp] of bad) {
      expect(() =>
        deserializePlayer(withExp(exp, maxExp), players, reg, ids, []),
      ).toThrow(/save: invalid player experience/);
    }
  });
});
