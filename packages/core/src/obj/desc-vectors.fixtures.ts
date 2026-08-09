/**
 * The registry, player and rune environment the object-naming vectors are
 * recorded against, built from the real shipped content pack.
 *
 * SEPARATE FILE, and it reads the disk: keeping `node:fs` out of
 * `desc-vectors.ts` means that module stays importable from anywhere. ONE copy,
 * shared by `desc-vectors.test.ts` and by `scripts/gen-desc-vectors.mjs`, so
 * the test and the generator cannot disagree about what they are measuring.
 */

import { readFileSync } from "node:fs";

import { KF } from "../generated/index.js";
import { bindPlayer } from "../player/bind.js";
import { blankPlayer } from "../player/player.js";
import type { Player } from "../player/player.js";
import { Rng } from "../rng.js";
import { ObjRegistry } from "./bind.js";
import { makeRuneEnv } from "./knowledge.js";
import type { RuneEnv } from "./knowledge.js";
import { registerBookKinds } from "../player/spell.js";
import { objectNew } from "./object.js";
import type { DescVectorFixtures } from "./desc-vectors.js";
import type { GameObject } from "./object.js";
import type { ObjPackJson, ObjectKind } from "./types.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as T;
}
function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

export function descVectorFixtures(): DescVectorFixtures {
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

  const players = bindPlayer({
    races: loadRecords("p_race"),
    classes: loadRecords("class"),
    properties: loadRecords("player_property"),
    timed: loadRecords("player_timed"),
    shapes: loadRecords("shape"),
    bodies: loadRecords("body"),
    history: loadRecords("history"),
    realms: loadRecords("realm"),
  });

  /* THE FIVE BOOK ARMS LIVE OR DIE HERE. Upstream 4.2.6 defines no book in
   * object.txt - `registerBookKinds` synthesises them from class.txt's `book:`
   * lines, exactly as upstream does at class-parse time - so a grid built from
   * the pack alone reaches 31 of the switch's 34 arms and the five book
   * templates ("& Book~ of Magic Spells #", "& Necromantic Tome~ #" ...) are
   * never exercised. Calling the REAL producer is what closes that, rather
   * than hand-building five kinds and asserting about what the producer emits.
   * `desc-vectors.test.ts` asserts the arm coverage so this cannot silently
   * come undone. */
  registerBookKinds(reg, players.classes);

  return {
    /* Everything a player can be shown, which is every kind EXCEPT the
     * INSTA_ART dummies. Not `kidx < ordinaryKindCount`: that count is stamped
     * before the book kinds are appended, so it would drop them again. */
    kinds: (): readonly ObjectKind[] =>
      reg.kinds.filter((k) => !k.kindFlags.has(KF.INSTA_ART)),

    object: (kind: ObjectKind): GameObject => {
      const obj = objectNew(kind);
      obj.tval = kind.tval;
      obj.sval = kind.sval;
      obj.dd = kind.dd;
      obj.ds = kind.ds;
      obj.ac = kind.ac;
      obj.weight = kind.weight;
      obj.number = 1;
      return obj;
    },

    /* A fixed seed, because `randcalcVaries` is the only draw in reach and a
     * moving one would make every row unstable for a reason that has nothing
     * to do with naming. */
    env: (): RuneEnv => {
      const rng = new Rng(7);
      return makeRuneEnv(
        () => null,
        (v) => rng.randcalcVaries(v),
        {
          brands: reg.brands,
          slays: reg.slays,
          curses: reg.curses,
          properties: reg.properties,
          elementNames: ["acid", "lightning", "fire", "frost"],
          msg: () => {},
        },
      );
    },

    player: (): Player => {
      const race = players.raceByName("Human")!;
      const cls = players.classByName("Warrior")!;
      return blankPlayer(race, cls, players.bodies[race.body]!);
    },
  };
}
