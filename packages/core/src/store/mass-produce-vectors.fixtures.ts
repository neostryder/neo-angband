/**
 * The object registry and per-kind objects a mass-produce vector is run
 * against, built from the real shipped content pack.
 *
 * SEPARATE FILE, and it reads the disk: keeping node:fs out of
 * `mass-produce-vectors.ts` means that module stays importable from anywhere.
 * ONE copy, shared by `mass-produce-vectors.test.ts` and by
 * `scripts/gen-mass-produce-vectors.mjs`, so the test and the generator cannot
 * disagree about what they are measuring.
 */

import { readFileSync } from "node:fs";
import { bindConstants } from "../constants.js";
import { ObjRegistry } from "../obj/bind.js";
import { objectPrep } from "../obj/make.js";
import type { GameObject } from "../obj/object.js";
import type { ObjPackJson } from "../obj/types.js";
import { Rng } from "../rng.js";
import type { MassProduceFixtures } from "./mass-produce-vectors.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as T;
}

export function massProduceFixtures(): MassProduceFixtures {
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

  /* Object names repeat in core's own data (45 duplicates), so the vectors are
   * keyed by index-qualified name rather than name alone - two kinds sharing
   * "Light" must still produce two rows. */
  const names = reg.kinds.map((k, i) => `${String(i)}:${k?.name ?? "?"}`);

  return {
    reg,
    kindNames: () => names,
    make(kindName): GameObject | null {
      const idx = Number(kindName.split(":")[0]);
      const kind = reg.kinds[idx];
      if (!kind) return null;
      /* "minimise" so the object carries no random bonus: the vector measures
       * mass_produce, not object_prep's rolls. */
      return objectPrep(new Rng(7), reg, constants, kind, 0, "minimise");
    },
  };
}
