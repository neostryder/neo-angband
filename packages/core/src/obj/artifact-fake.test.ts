import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants.js";
import { Rng } from "../rng.js";
import { ObjRegistry } from "./bind.js";
import type { Artifact, ObjPackJson } from "./types.js";
import { FAKE_ARTIFACT_SEED, makeFakeArtifact } from "./artifact-fake.js";

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
  /** A throwaway preview stream, as the knowledge browser passes. */
  const preview = (): Rng => new Rng(FAKE_ARTIFACT_SEED);

  it("builds an artifact object stamped with the artifact data", () => {
    const art = firstArtifact();
    const obj = makeFakeArtifact(reg, constants, art, preview());
    expect(obj).not.toBeNull();
    // copy_artifact_data copies the artifact's dice/ac/modifiers onto the obj.
    expect(obj!.artifact).toBe(art);
    expect(obj!.number).toBe(1);
    expect(obj!.dd).toBe(art.dd);
    expect(obj!.ds).toBe(art.ds);
    expect(obj!.ac).toBe(art.ac);
    expect(obj!.toA).toBe(art.toA);
  });

  it("is deterministic across calls at the same seed", () => {
    const art = firstArtifact();
    const a = makeFakeArtifact(reg, constants, art, preview());
    const b = makeFakeArtifact(reg, constants, art, preview());
    expect(JSON.stringify(a!.modifiers)).toBe(JSON.stringify(b!.modifiers));
    expect(JSON.stringify(a!.curses)).toBe(JSON.stringify(b!.curses));
  });

  /*
   * WHICH STREAM IS THE CALLER'S CHOICE, and these two tests bracket the
   * mechanism from both sides. A preview must leave the game stream alone; the
   * randart generator must draw from the stream it hands in, because upstream
   * does. A default parameter here would satisfy the first and silently break
   * the second - which is exactly what happened before 2026-08-07.
   */
  it("does not touch a stream it was not given", () => {
    const gameRng = new Rng(12345);
    const before = gameRng.getState();

    // Build every artifact preview - the browser walks the whole list.
    for (const art of reg.artifacts) {
      if (art) makeFakeArtifact(reg, constants, art, preview());
    }

    const after = gameRng.getState();
    expect(after).toEqual(before);

    // And the game stream still yields exactly what it would have untouched.
    const untouched = new Rng(12345);
    for (let i = 0; i < 20; i++) {
      expect(gameRng.randint0(1000)).toBe(untouched.randint0(1000));
    }
  });

  it("DOES draw from the stream it is given, for a cursed artifact", () => {
    /* copy_curses rolls randcalc(time, 0, RANDOMISE) per non-zero slot
     * (obj-curse.c L36). Find an artifact that has one; if the pack ever stops
     * carrying a cursed artifact, the assertion below says so rather than
     * passing on an empty search. */
    const cursed = reg.artifacts.find(
      (a): a is Artifact =>
        !!a &&
        !!(a.curses ?? reg.lookupKind(a.tval, a.sval)?.curses),
    );
    expect(cursed, "pack supplies a cursed artifact").toBeDefined();

    const rng = new Rng(999);
    makeFakeArtifact(reg, constants, cursed!, rng);
    expect(rng.getState()).not.toEqual(new Rng(999).getState());
  });
});
