/**
 * The pack-derived half of the effect-info vectors.
 *
 * SEPARATE FILE, and it reads the disk: keeping node:fs out of
 * `effect-info-vectors.ts` means that module stays importable from anywhere.
 * ONE copy, shared by `effect-info-vectors.test.ts` and by
 * `scripts/gen-effect-info-vectors.mjs`, so the test and the generator cannot
 * disagree about what they are measuring.
 *
 * Only the activation summary needs this. The menu-name, description and
 * subtype families take their lookups as injected deps and are recorded against
 * synthetic ones (see the header of effect-info-vectors.ts for why that is the
 * stronger choice there); the summary resolves real TMD names against the real
 * compiled player_timed records, so it gets the real pack.
 */

import { readFileSync } from "node:fs";
import { ELEM, OF } from "../generated/index.js";
import { ObjRegistry } from "../obj/bind.js";
import type { ObjPackJson } from "../obj/types.js";
import type { RawTimedRecord } from "../obj/effects-info.js";
import type { EffectInfoVectorFixtures } from "./effect-info-vectors.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../../content/pack/${name}.json`, import.meta.url), "utf8"),
  ) as T;
}

function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

export function effectInfoVectorFixtures(): EffectInfoVectorFixtures {
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
  const timed = loadRecords<RawTimedRecord>("player_timed");

  return {
    summarizerDeps: () => ({
      timedRecords: timed,
      brands: reg.brands,
      slays: reg.slays,
      ofIndex: (n) => (OF as unknown as Record<string, number>)[n] ?? 0,
      elemIndex: (n) => (ELEM as unknown as Record<string, number>)[n] ?? -1,
    }),
    timedNames: () => timed.map((t) => t.name),
  };
}
