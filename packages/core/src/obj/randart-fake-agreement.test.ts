/**
 * make_fake_artifact (obj-make.c L728) is implemented THREE times in this port:
 *
 *   - obj/artifact-fake.ts   makeFakeArtifact      - builds a real GameObject
 *   - game/spoil.ts          makeFakeArtifact      - a local second copy
 *   - obj/randart-data.ts    makeFakeArtifactPower - the SAME field mapping
 *                                                    flattened into a
 *                                                    PowerObject
 *
 * The third exists because object_power needs only a reduced shape, and it was
 * written by hand rather than derived from the first. Two hand-written copies of
 * one C function agree until they do not, and the failure here would be silent
 * and expensive: artifact_power drives the whole randart design loop, so a
 * single field mapped differently changes every generated artifact while every
 * test that compares the port against ITSELF still passes.
 *
 * So: run both over the real content pack and require the power they produce to
 * agree, artifact for artifact. This is the check that would have caught the
 * curse-timeout divergence, and it is the check that has to survive any future
 * consolidation of the three.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants.js";
import { Rng } from "../rng.js";
import { ObjRegistry } from "./bind.js";
import { makeFakeArtifact } from "./artifact-fake.js";
import { artifactPower } from "./randart-data.js";
import { objectPower } from "./power.js";
import type { PowerObject } from "./power.js";
import type { Artifact, ObjPackJson } from "./types.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as T;
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
const constants = bindConstants(loadJson("constants"));

const artifacts = reg.artifacts.filter((a): a is Artifact => !!a);

describe("the two make_fake_artifact implementations agree (obj-make.c L728)", () => {
  it("the pack supplies artifacts to compare", () => {
    /* Without this the loop below is vacuously true on an empty pack. */
    expect(artifacts.length).toBeGreaterThan(100);
  });

  it("object_power is the same whichever fake object it is handed", () => {
    const disagree: string[] = [];
    for (const art of artifacts) {
      const real = makeFakeArtifact(reg, constants, art);
      if (!real) continue; /* no base kind: artifactPower returns 0 too */
      /* GameObject carries every field PowerObject names, plus the ones
       * object_power never reads. The cast is the assertion under test: if the
       * shapes ever part, this file is where it shows. */
      const fromReal = objectPower(reg, real as unknown as PowerObject);
      const fromFlat = artifactPower(
        reg,
        art,
        "agreement",
        new Rng(1, { quick: true }),
      );
      if (fromReal !== fromFlat) {
        disagree.push(`${art.name}: real=${fromReal} flat=${fromFlat}`);
      }
    }
    expect(disagree.slice(0, 8)).toEqual([]);
  });
});
