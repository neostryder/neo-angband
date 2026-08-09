/**
 * The registry the tval KIND vectors are recorded against, built from the real
 * shipped content pack.
 *
 * SEPARATE FILE, and it reads the disk: keeping `node:fs` out of
 * `tval-vectors.ts` means that module stays importable from anywhere - the
 * predicate half of the table needs nothing but the generated tval list. ONE
 * copy, shared by `tval-vectors.test.ts` and by `scripts/gen-tval-vectors.mjs`,
 * so the test and the generator cannot disagree about what they are measuring.
 *
 * REAL kinds rather than synthetic ones, on purpose. `kindIsGood`'s three arms
 * read three different fields - armour reads `toA`, weapons read `toH` and
 * `toD`, ammo reads nothing - and everything else falls through to `KF_GOOD`.
 * A hand-built kind would be an assertion about what the pack producer emits,
 * and an unchecked one; the shipped pack is the thing the game actually runs.
 */

import { readFileSync } from "node:fs";

import { ObjRegistry } from "./bind.js";
import type { ObjPackJson } from "./types.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as T;
}

/**
 * A registry over the shipped pack. No projections are bound: neither
 * `kindIsGood` nor `objectValueBase` reads one, and binding what a measurement
 * does not use invites the next reader to think it does.
 */
export function tvalVectorRegistry(): ObjRegistry {
  return new ObjRegistry({
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
}
