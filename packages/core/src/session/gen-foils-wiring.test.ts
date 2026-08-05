/**
 * Guards the three PLAYER-dependent make_object / make_gold foils into LEVEL
 * GENERATION, at the session level. PORT_TODO 2.15.
 *
 * All three existed and all three were supplied - to the two STORE paths
 * (`refreshTownStores`, `makeStoreApi`) and to nothing else. The generator's
 * objDeps came from `genDeps` in boot.ts, which built the bundle from the content
 * pack alone. So on the path these foils exist for:
 *
 *  - `canBrowseBook`: every book was browsable, so obj_kind_can_browse's
 *    rejection (obj-make.c L1185-1195) never fired. A Warrior found Magic Books
 *    on the floor at the full rate, and - because a rejection costs another
 *    get_obj_num draw and is accepted anyway one time in five - the generation
 *    RNG stream itself was off upstream's;
 *  - `timedFoil`: append_object_curse's TIMED_INC foil (obj-curse.c L159-188)
 *    never rejected a contradictory curse, also an RNG difference;
 *  - `noSelling`: make_gold's 5x dungeon inflation (obj-make.c L1310-1312) never
 *    applied to a generated floor pile, so `birth_no_selling` was half-on.
 *
 * WHY THIS COULD NOT HAVE BEEN CAUGHT BY A UNIT TEST. obj/make.test.ts proves
 * makeObject and makeGold honour each foil when given one. That is the function,
 * and the function was right. The bug was one bundle-builder not passing them -
 * exactly the shape quiver-ammo-wiring.test.ts was written for, and the rule it
 * came from: when a fix has more than one call site, guard the wiring.
 *
 * WHAT GUARDS WHICH, stated rather than implied:
 *  - the tests below cover `genDeps` -> objDeps, i.e. that a supplied foil
 *    reaches the code that reads it;
 *  - the CALL SITE in session/game.ts is guarded by the TYPE, not by a test:
 *    `foils` is a required argument whose only "nothing to supply" value is the
 *    literal "no-player", so the omission that caused this cannot be written
 *    again without saying so out loud. A test asserting the live level-change
 *    path would need a stair transition driven end to end; that is not here.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindCore, genDeps } from "./boot.js";
import type { CorePack } from "./boot.js";
import { makeGold } from "../obj/make.js";
import type { ObjectKind } from "../obj/types.js";
import type { CurseTimedFoil } from "../obj/object.js";
import { Rng } from "../rng.js";
import { TV } from "../generated/index.js";

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

/* Pack zero exactly as a host hands it to bindCore (the shape boot.test.ts uses;
 * a hand-rolled approximation silently binds an empty feature registry). */
const pack: CorePack = {
  constants: loadJson("constants"),
  terrain: loadRecords("terrain"),
  roomTemplates: loadRecords("room_template"),
  vaults: loadRecords("vault"),
  dungeonProfiles: loadRecords("dungeon_profile"),
  obj: {
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
  } as CorePack["obj"],
  mon: {
    pain: loadRecords("pain"),
    blowMethods: loadRecords("blow_methods"),
    blowEffects: loadRecords("blow_effects"),
    monsterSpells: loadRecords("monster_spell"),
    monsterBases: loadRecords("monster_base"),
    monsters: loadRecords("monster"),
    summons: loadRecords("summon"),
    pits: loadRecords("pit"),
  },
};

const reg = bindCore(pack);

describe("genDeps carries the player-dependent generation foils", () => {
  it('supplies none of the three for "no-player"', () => {
    const deps = genDeps(reg, true, "no-player");
    const obj = deps.objDeps!;

    expect(obj, "the bundle itself is built").not.toBeNull();
    expect(obj.canBrowseBook).toBeUndefined();
    expect(obj.timedFoil).toBeUndefined();
    expect(obj.noSelling).toBeUndefined();
  });

  it("passes all three straight through when a player supplies them", () => {
    const canBrowseBook = (k: ObjectKind): boolean => k.tval !== TV.MAGIC_BOOK;
    const timedFoil: CurseTimedFoil = new Map();
    const deps = genDeps(reg, true, {
      canBrowseBook,
      timedFoil,
      noSelling: true,
    });
    const obj = deps.objDeps!;

    expect(obj.canBrowseBook).toBe(canBrowseBook);
    expect(obj.timedFoil).toBe(timedFoil);
    expect(obj.noSelling).toBe(true);
  });

  it("no-selling inflates GENERATED gold five-fold, not just store gold", () => {
    /* The behavioural half: the foil has to reach the code that reads it, not
     * just sit on the bundle. Same seed both sides, so make_gold draws the same
     * value and the only difference is the *= 5 at obj-make.c L1310-1312.
     *
     * A low level keeps the value well under SHRT_MAX, so neither run takes the
     * cap branch - which draws randint0(200) and would desynchronise them. */
    const plain = makeGold(new Rng(4242), genDeps(reg, true, "no-player").objDeps!, 5, "any");
    const inflated = makeGold(
      new Rng(4242),
      genDeps(reg, true, {
        canBrowseBook: () => true,
        timedFoil: new Map() as CurseTimedFoil,
        noSelling: true,
      }).objDeps!,
      5,
      "any",
    );

    expect(plain.pval, "fixture: a small pile, so no cap branch").toBeLessThan(1000);
    expect(inflated.pval).toBe(plain.pval * 5);
  });

  /*
   * NO BEHAVIOURAL TEST FOR canBrowseBook HERE, and the reason is a fixture trap
   * worth recording. `makeObject(..., tval = TV.MAGIC_BOOK, ...)` returns null
   * against a bare `bindCore` registry, because spellbooks are NOT in object.txt
   * at all in 4.2.6 - `write_book_kind` (init.c:208) APPENDS one kind per class
   * book while parsing class.txt, and the port's equivalent is
   * `registerBookKinds` (player/spell.ts), which the session calls but a
   * registry-only fixture does not. A first draft of this file asserted a
   * get_obj_num draw-count difference and got 40 vs 40: not "no difference", but
   * "no book was ever picked, so the branch never ran".
   *
   * So the split is: obj/make.test.ts owns the behaviour (makeObject honours the
   * predicate), and the first two tests above own the WIRING (genDeps hands the
   * predicate on), which is the half that was broken. Writing a third that needs
   * a full class binding would test registerBookKinds, not this fix.
   */
});
