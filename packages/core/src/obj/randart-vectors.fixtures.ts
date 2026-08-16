/**
 * The registry and constants a randart vector is recorded against, built from
 * the real shipped content pack.
 *
 * SEPARATE FILE, and it reads the disk: keeping node:fs out of
 * `randart-vectors.ts` means that module stays importable from anywhere. ONE
 * copy, shared by `randart-vectors.test.ts` and by
 * `scripts/gen-randart-vectors.mjs`, so the test and the generator cannot
 * disagree about what they are measuring.
 *
 * The projections are bound for a reason that is not decoration: `add_brand`
 * (obj-randart.c:1951) compares the brand it picked against `projections[i].name`
 * to grant the matching resist, so a registry without them cannot run
 * `do_randart` at all.
 */

import { readFileSync } from "node:fs";
import { bindConstants } from "../constants.js";
import type { Constants } from "../constants.js";
import { bindProjections } from "../world/projection.js";
import type { ProjectionRecordJson } from "../world/projection.js";
import { ObjRegistry } from "./bind.js";
import type { ObjPackJson } from "./types.js";
import type { RandartVectorFixtures } from "./randart-vectors.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../../content/pack/${name}.json`, import.meta.url), "utf8"),
  ) as T;
}

export function randartVectorFixtures(): RandartVectorFixtures {
  /* Parsed ONCE; a fresh ObjRegistry is built per call from the same records,
   * because the whole-set family wants a registry no earlier seed has run
   * against. */
  const pack = {
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
  const projectionRecords = loadJson<{ records: ProjectionRecordJson[] }>(
    "projection",
  ).records;
  const constants = bindConstants(loadJson("constants"));

  return {
    registry(): ObjRegistry {
      const reg = new ObjRegistry(pack);
      reg.projections = bindProjections(projectionRecords);
      return reg;
    },
    constants: (): Constants => constants,
  };
}
