import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants";
import { Rng } from "../rng";
import { loc } from "../loc";
import { ObjRegistry } from "../obj/bind";
import type { ObjPackJson } from "../obj/types";
import { historyFindArtifact, historyIsArtifactKnown } from "../player/history";
import { makeState } from "./harness";
import { artifactHistoryName, historyStamp } from "./history";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as T;
}

const objPack: ObjPackJson = {
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

function artifactByName(suffix: string) {
  const art = reg.artifacts.find((a) => a?.name === suffix);
  if (!art) throw new Error(`no artifact named "${suffix}" in the pack`);
  return art;
}

describe("historyStamp (player-history.c history_add_with_flags L115-121)", () => {
  it("reads dlev/clev/turn off live GameState", () => {
    const state = makeState({ playerGrid: loc(3, 3) });
    state.chunk.depth = 7;
    state.actor.player.lev = 12;
    state.actor.totalEnergy = 45678;
    const stamp = historyStamp(state);
    expect(stamp).toEqual({ dlev: 7, clev: 12, turn: 456 }); // trunc(45678/100)
  });
});

describe("artifactHistoryName (player-history.c get_artifact_name L197-215)", () => {
  it('produces the exact spoiled name ("the Phial of Galadriel")', () => {
    const state = makeState({ playerGrid: loc(3, 3) });
    const phial = artifactByName("of Galadriel");
    const name = artifactHistoryName(state, reg, constants, phial);
    expect(name).toBe("the Phial of Galadriel");
  });

  it("draws NO RNG (objectPrep 'maximise' is pure arithmetic)", () => {
    const state = makeState({ playerGrid: loc(3, 3) });
    state.rng = new Rng(999);
    const phial = artifactByName("of Galadriel");
    const before = state.rng.getState();
    artifactHistoryName(state, reg, constants, phial);
    const after = state.rng.getState();
    expect(after).toEqual(before);
  });

  it("historyFindArtifact via artifactHistoryName also draws no RNG end to end", () => {
    const state = makeState({ playerGrid: loc(3, 3) });
    state.rng = new Rng(4242);
    const phial = artifactByName("of Galadriel");
    const before = state.rng.getState();
    const stamp = historyStamp(state);
    historyFindArtifact(
      state.actor.player,
      phial,
      stamp.dlev,
      stamp.clev,
      stamp.turn,
      (a) => artifactHistoryName(state, reg, constants, a),
    );
    const after = state.rng.getState();
    expect(after).toEqual(before);
    expect(historyIsArtifactKnown(state.actor.player, phial)).toBe(true);
    expect(state.actor.player.hist[0]!.event).toBe("Found the Phial of Galadriel");
  });
});
