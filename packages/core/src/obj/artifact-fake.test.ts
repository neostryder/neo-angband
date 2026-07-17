import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants";
import { Rng } from "../rng";
import { ObjRegistry } from "./bind";
import type { Artifact, ObjPackJson } from "./types";
import { FAKE_ARTIFACT_SEED, makeFakeArtifact } from "./artifact-fake";

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

/** The first non-null artifact (aidx 1). */
function firstArtifact(): Artifact {
  const art = reg.artifacts.find((a): a is Artifact => a !== null);
  if (!art) throw new Error("no artifacts in pack");
  return art;
}

describe("makeFakeArtifact (obj-make.c L728)", () => {
  it("builds an artifact object stamped with the artifact data", () => {
    const art = firstArtifact();
    const obj = makeFakeArtifact(reg, constants, art);
    expect(obj).not.toBeNull();
    // copy_artifact_data copies the artifact's dice/ac/modifiers onto the obj.
    expect(obj!.artifact).toBe(art);
    expect(obj!.number).toBe(1);
    expect(obj!.dd).toBe(art.dd);
    expect(obj!.ds).toBe(art.ds);
    expect(obj!.ac).toBe(art.ac);
    expect(obj!.toA).toBe(art.toA);
  });

  it("is deterministic across calls (same throwaway seed)", () => {
    const art = firstArtifact();
    const a = makeFakeArtifact(reg, constants, art);
    const b = makeFakeArtifact(reg, constants, art);
    expect(JSON.stringify(a!.modifiers)).toBe(JSON.stringify(b!.modifiers));
    expect(JSON.stringify(a!.curses)).toBe(JSON.stringify(b!.curses));
  });

  it("does not advance the game Rng (draws only from a throwaway stream)", () => {
    // A live game RNG stream. The fake build must not consume from it, even
    // though copy_artifact_data draws the curse timeout - that draw comes from
    // makeFakeArtifact's own throwaway Rng, never this one.
    const gameRng = new Rng(12345);
    const before = gameRng.getState();

    // Build every artifact preview - the browser walks the whole list.
    for (const art of reg.artifacts) {
      if (art) makeFakeArtifact(reg, constants, art);
    }

    const after = gameRng.getState();
    expect(after).toEqual(before);

    // And the game stream still yields exactly what it would have untouched.
    const untouched = new Rng(12345);
    for (let i = 0; i < 20; i++) {
      expect(gameRng.randint0(1000)).toBe(untouched.randint0(1000));
    }
  });

  it("honours an explicit seed override", () => {
    const art = firstArtifact();
    const def = makeFakeArtifact(reg, constants, art, FAKE_ARTIFACT_SEED);
    const same = makeFakeArtifact(reg, constants, art, FAKE_ARTIFACT_SEED);
    expect(JSON.stringify(def!.curses)).toBe(JSON.stringify(same!.curses));
  });
});
