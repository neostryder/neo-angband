/**
 * The generation context a glyph vector is recorded against, built from the
 * real shipped content pack.
 *
 * SEPARATE FILE, and it reads the disk: keeping node:fs out of
 * `glyph-vectors.ts` means that module stays importable from anywhere. ONE
 * copy, shared by `glyph-vectors.test.ts` and by
 * `scripts/gen-glyph-vectors.mjs`, so the test and the generator cannot
 * disagree about what they are measuring.
 *
 * The deps are REAL - the object allocator, the monster allocation table, the
 * trap kinds - because a vault's `8` places a monster and an object and rolls
 * a trap's power, and a deps-less Gen would record nothing at exactly the
 * glyphs whose decoding is most worth pinning.
 */

import { readFileSync } from "node:fs";
import { bindConstants } from "../constants.js";
import type { ConstantsJson } from "../constants.js";
import { FEAT, SQUARE } from "../generated/index.js";
import { Rng } from "../rng.js";
import { Chunk } from "../world/chunk.js";
import { FeatureRegistry } from "../world/feature.js";
import type { TerrainRecordJson } from "../world/feature.js";
import { bindTraps } from "../world/trap.js";
import type { TrapRecordJson } from "../world/trap.js";
import { ObjRegistry } from "../obj/bind.js";
import type { ObjPackJson } from "../obj/types.js";
import { ArtifactState, ObjAllocState } from "../obj/make.js";
import type { MakeDeps } from "../obj/make.js";
import { bindMonsters } from "../mon/bind.js";
import type { MonsterPackRecords } from "../mon/bind.js";
import { MonAllocTable } from "../mon/make.js";
import { resolvePits } from "./gen-monster.js";
import { Dun, Gen, fillRectangle } from "./util.js";
import type { MonPlaceDeps } from "./util.js";
import { loadRoomTemplates, loadVaults } from "./room.js";
import type { RoomTemplateRecordJson, VaultRecordJson } from "./room.js";
import type { GlyphVectorFixtures } from "./glyph-vectors.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../../content/pack/${name}.json`, import.meta.url), "utf8"),
  ) as T;
}

function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

export function glyphVectorFixtures(): GlyphVectorFixtures {
  const reg = new FeatureRegistry(loadRecords<TerrainRecordJson>("terrain"));
  const constants = bindConstants(loadJson<ConstantsJson>("constants"));
  const trapKinds = bindTraps(loadRecords<TrapRecordJson>("trap"));

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

  const monPack: MonsterPackRecords = {
    pain: loadRecords("pain"),
    blowMethods: loadRecords("blow_methods"),
    blowEffects: loadRecords("blow_effects"),
    monsterSpells: loadRecords("monster_spell"),
    monsterBases: loadRecords("monster_base"),
    monsters: loadRecords("monster"),
    summons: loadRecords("summon"),
    pits: loadRecords("pit"),
  };

  const templates = loadRoomTemplates(loadRecords<RoomTemplateRecordJson>("room_template"));
  const vaults = loadVaults(loadRecords<VaultRecordJson>("vault"), constants.maxDepth);

  return {
    makeGen(width, height, depth, seed) {
      /* A fresh registry per Gen: the allocator and the artifact state both
       * carry per-level memory, and a vector must not see the previous one. */
      const objReg = new ObjRegistry(objPack);
      const objDeps: MakeDeps = {
        reg: objReg,
        alloc: new ObjAllocState(objReg, constants),
        constants,
        artifacts: new ArtifactState(objReg.artifacts.length),
        noArtifacts: false,
      };
      const monReg = bindMonsters(monPack, { maxSight: constants.maxSight });
      const monDeps: MonPlaceDeps = {
        table: new MonAllocTable(monReg.races, {
          maxDepth: constants.maxDepth,
          oodChance: constants.oodMonsterChance,
          oodAmount: constants.oodMonsterAmount,
        }),
        pits: resolvePits(monReg),
      };

      const c = new Chunk(reg, height, width);
      c.depth = depth;
      fillRectangle(c, 0, 0, height - 1, width - 1, FEAT.GRANITE, SQUARE.NONE);
      return new Gen(
        c,
        new Rng(seed),
        reg,
        constants,
        new Dun(constants),
        objDeps,
        monDeps,
        trapKinds,
      );
    },
    templates: () => templates,
    vaults: () => vaults,
  };
}
