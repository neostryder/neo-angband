/**
 * The real content a project_f vector is run against.
 *
 * SEPARATE FILE, and it reads the disk: keeping node:fs out of
 * `project-feat-vectors.ts` means that module stays importable from anywhere.
 * ONE copy, shared by `project-feat-vectors.test.ts` and by
 * `scripts/gen-project-feat-vectors.mjs`, so the test and the generator cannot
 * disagree about what they are measuring - which is the whole point of a
 * recording.
 */

import { readFileSync } from "node:fs";
import { bindConstants } from "../constants.js";
import { bindTraps } from "../world/trap.js";
import type { TrapRecordJson } from "../world/trap.js";
import { ObjRegistry } from "../obj/bind.js";
import { ArtifactState, ObjAllocState, objectPrep } from "../obj/make.js";
import type { MakeDeps } from "../obj/make.js";
import type { ObjPackJson } from "../obj/types.js";
import { Rng } from "../rng.js";
import { addMon, makeState, monReg } from "./harness.js";
import { floorCarry } from "./floor.js";
import { placeTrap, squareRevealTrap, squareSetDoorLock } from "./trap.js";
import type { TrapDeps } from "./trap.js";
import type { ProjectFeatFixtures } from "./project-feat-vectors.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as T;
}

function records<T>(name: string): T[] {
  const raw = loadJson<T[] | { records: T[] }>(name);
  return Array.isArray(raw) ? raw : raw.records;
}

export function projectFeatFixtures(): ProjectFeatFixtures {
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
  /* A FULL MakeDeps, not a cast: KILL_WALL's rubble find calls make_object and
   * its gold-vein arm calls make_gold, and both draw from the RNG. A stubbed
   * generator would make the vectors record the stub's draw count instead of
   * the game's, which is the one thing rngProbe exists to catch. */
  const makeDeps: MakeDeps = {
    reg,
    alloc: new ObjAllocState(reg, constants),
    constants,
    artifacts: new ArtifactState(reg.artifacts.length),
    noArtifacts: false,
  };
  const trapDeps: TrapDeps = {
    kinds: bindTraps(records<TrapRecordJson>("trap")),
  };

  /* One arbitrary but FIXED kind for the object the scenario drops, so
   * push_object has something real to move and the count is stable. */
  const kind = reg.kinds.find((k) => k !== null && k !== undefined);
  const race = monReg.races.find((r) => r.base && r.blows.length > 0);

  return {
    makeState: (seed) => makeState({ seed }),
    makeDeps,
    trapDeps,
    addMonster(state, grid) {
      if (!race) return false;
      addMon(state, race, grid);
      return true;
    },
    addObject(state, grid) {
      if (!kind) return;
      const obj = objectPrep(new Rng(3), reg, constants, kind, 0, "minimise");
      floorCarry(state, grid, obj);
    },
    addTrap(state, grid, name) {
      const kindIdx = trapDeps.kinds.findIndex((t) => t?.name === name);
      if (kindIdx < 0) return;
      placeTrap(state, grid, kindIdx, 1, trapDeps);
      /* REVEALED, deliberately. square_isdisarmabletrap gates on the trap being
       * VISIBLE, so an unrevealed trap sends every KILL_TRAP row down the
       * door-lock branch instead - which is how a 3,120-row recording covered
       * "The trap seizes up." zero times on its first pass. */
      squareRevealTrap(state, grid, true, trapDeps);
    },
    lockDoor(state, grid) {
      if (!state.chunk.isDoor(grid)) return;
      squareSetDoorLock(state, grid, 5, trapDeps);
    },
  };
}
