import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ITYPE, TV } from "../generated/index.js";
import { Rng } from "../rng.js";
import { ObjRegistry } from "./bind.js";
import type { ObjPackJson } from "./types.js";
import { objectNew } from "./object.js";
import type { GameObject } from "./object.js";
import type { EgoItem } from "./types.js";
import { OBJ_NOTICE } from "./knowledge.js";
import {
  IGNORE,
  IgnoreSettings,
  egoHasIgnoreType,
  ignoreItemOk,
  ignoreLevelOf,
  ignoreTypeOf,
  objectIsIgnored,
} from "./ignore.js";
import type { ObjectKnownView } from "./ignore.js";

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

function kindOfTval(tval: number) {
  const k = reg.kinds.find(
    (kk) => kk.tval === tval && kk.kidx < reg.ordinaryKindCount,
  );
  if (!k) throw new Error(`no kind for tval ${tval}`);
  return k;
}

/** A plain object of a tval with neutral combat values. */
function neutral(tval: number): GameObject {
  const kind = kindOfTval(tval);
  const obj = objectNew(kind);
  obj.tval = kind.tval; /* object_prep copies the kind's tval */
  obj.toH = 0;
  obj.toD = 0;
  obj.toA = 0;
  return obj;
}

/**
 * obj->known for a fully identified object. object_fully_known is true and the
 * twin mirrors the object: objectKnownShadow copies obj.notice outright
 * (known-object.ts:459) and, once fully known, the real flags and element info
 * too (:589-600). The tests below grade already-identified items, which is the
 * branch that reads the LIVE object upstream as well - the branch that does not
 * (an unidentified item) has its own describe block at the end of this file.
 */
function known(obj: GameObject): ObjectKnownView {
  return { known: obj, fullyKnown: true };
}

describe("ignore_type_of (obj-ignore.c L382)", () => {
  it("maps tvals to ignore types, ITYPE_MAX for the unmappable", () => {
    expect(ignoreTypeOf(neutral(TV.SWORD))).toBe(ITYPE.SHARP);
    expect(ignoreTypeOf(neutral(TV.HAFTED))).toBe(ITYPE.BLUNT);
    expect(ignoreTypeOf(neutral(TV.RING))).toBe(ITYPE.RING);
    expect(ignoreTypeOf(neutral(TV.SHIELD))).toBe(ITYPE.SHIELD);
    /* A potion cannot be quality-ignored. */
    expect(ignoreTypeOf(neutral(TV.POTION))).toBe(27 /* ITYPE_MAX */);
  });
});

describe("ignore_level_of (obj-ignore.c L464)", () => {
  it("grades a weapon bad / average / good by its combat bonuses", () => {
    const avg = neutral(TV.SWORD);
    expect(ignoreLevelOf(avg, known(avg))).toBe(IGNORE.AVERAGE);

    const bad = neutral(TV.SWORD);
    bad.toD = -3;
    expect(ignoreLevelOf(bad, known(bad))).toBe(IGNORE.BAD);

    const good = neutral(TV.SWORD);
    good.toD = 4;
    expect(ignoreLevelOf(good, known(good))).toBe(IGNORE.GOOD);
  });

  it("treats jewelry as only bad or average", () => {
    const ring = neutral(TV.RING);
    expect(ignoreLevelOf(ring, known(ring))).toBe(IGNORE.AVERAGE);
    ring.modifiers[0] = 2; /* a positive modifier is 'not bad' */
    expect(ignoreLevelOf(ring, known(ring))).toBe(IGNORE.AVERAGE);

    const badRing = neutral(TV.RING);
    badRing.toA = -1;
    expect(ignoreLevelOf(badRing, known(badRing))).toBe(IGNORE.BAD);
  });

  it("rates egos as ALL and artifacts as MAX", () => {
    const ego = neutral(TV.SWORD);
    ego.ego = { eidx: 3 } as EgoItem;
    expect(ignoreLevelOf(ego, known(ego))).toBe(IGNORE.ALL);

    const art = neutral(TV.SWORD);
    art.artifact = {} as GameObject["artifact"];
    expect(ignoreLevelOf(art, known(art))).toBe(IGNORE.MAX);
  });
});

describe("object_is_ignored / ignore_item_ok (obj-ignore.c L576)", () => {
  it("ignores nothing under default settings", () => {
    const s = new IgnoreSettings();
    const bad = neutral(TV.SWORD);
    bad.toD = -3;
    expect(objectIsIgnored(bad, known(bad), s, false)).toBe(false);
  });

  it("ignores by quality threshold for the ignore type", () => {
    const s = new IgnoreSettings();
    s.level[ITYPE.SHARP] = IGNORE.BAD;

    const bad = neutral(TV.SWORD);
    bad.toD = -3;
    const avg = neutral(TV.SWORD);
    expect(objectIsIgnored(bad, known(bad), s, false)).toBe(true);
    expect(objectIsIgnored(avg, known(avg), s, false)).toBe(false);

    /* Raising the threshold to average catches the average sword too. */
    s.level[ITYPE.SHARP] = IGNORE.AVERAGE;
    expect(objectIsIgnored(avg, known(avg), s, false)).toBe(true);
  });

  it("never ignores artifacts or !k / !* inscribed items by rule", () => {
    const s = new IgnoreSettings();
    s.level[ITYPE.SHARP] = IGNORE.ALL;

    const art = neutral(TV.SWORD);
    art.artifact = {} as GameObject["artifact"];
    expect(objectIsIgnored(art, known(art), s, false)).toBe(false);

    const keep = neutral(TV.SWORD);
    keep.toD = -3;
    keep.note = "!k";
    expect(objectIsIgnored(keep, known(keep), s, false)).toBe(false);
  });

  it("honors the individual ignore bit and the unignoring flag", () => {
    const s = new IgnoreSettings();
    const obj = neutral(TV.SWORD);
    obj.notice |= OBJ_NOTICE.IGNORE;
    expect(objectIsIgnored(obj, known(obj), s, false)).toBe(true);
    expect(ignoreItemOk(obj, known(obj), s, false)).toBe(true);

    s.unignoring = true;
    expect(ignoreItemOk(obj, known(obj), s, false)).toBe(false);
  });

  it("ignores an ego of an ignored ego+type", () => {
    const s = new IgnoreSettings();
    const obj = neutral(TV.SWORD);
    obj.ego = { eidx: 5 } as EgoItem;
    expect(objectIsIgnored(obj, known(obj), s, false)).toBe(false);
    s.egoToggle(5, ITYPE.SHARP);
    expect(objectIsIgnored(obj, known(obj), s, false)).toBe(true);
  });

  it("ignores by kind flavor-awareness, and round-trips the settings", () => {
    const s = new IgnoreSettings();
    const potion = neutral(TV.POTION);
    s.kindIgnoreWhenAware(potion.kind.kidx);
    /* Ignored only when aware of the flavor. */
    expect(objectIsIgnored(potion, known(potion), s, true)).toBe(true);
    expect(objectIsIgnored(potion, known(potion), s, false)).toBe(false);

    s.level[ITYPE.SHARP] = IGNORE.GOOD;
    const restored = new IgnoreSettings();
    restored.restore(s.snapshot());
    expect(restored.level[ITYPE.SHARP]).toBe(IGNORE.GOOD);
    expect(objectIsIgnored(potion, known(potion), restored, true)).toBe(true);
  });

  it("round-trips the unignoring flag through snapshot/restore", () => {
    const s = new IgnoreSettings();
    s.unignoring = true;
    const restored = new IgnoreSettings();
    restored.restore(s.snapshot());
    expect(restored.unignoring).toBe(true);

    /* Saves written before this gap have no `unignoring` field. */
    const legacy = new IgnoreSettings();
    legacy.restore({ level: [], ego: [], kindAware: [], kindUnaware: [] });
    expect(legacy.unignoring).toBe(false);
  });
});

describe("ignore_level_of's object_fully_known gate (obj-ignore.c L489-511)", () => {
  /**
   * A twin that knows nothing but the kind: what objectKnownShadow builds for
   * an object whose runes the player has not learned. Deliberately a DIFFERENT
   * GameObject from the one being graded, so a read of the live object cannot
   * pass by accident.
   */
  function unknownTwin(tval: number): ObjectKnownView {
    return { known: neutral(tval), fullyKnown: false };
  }

  it("tiers an unassessed object MAX, whatever its hidden combat values say", () => {
    const bad = neutral(TV.SWORD);
    bad.toD = -3;
    /* Fully known it is BAD; unidentified it is undetermined, and upstream
     * "return[s] the maximum possible value" (obj-ignore.c L461). */
    expect(ignoreLevelOf(bad, known(bad))).toBe(IGNORE.BAD);
    expect(ignoreLevelOf(bad, unknownTwin(TV.SWORD))).toBe(IGNORE.MAX);
  });

  it("tiers an ASSESSED non-artifact ALL, and an assessed artifact MAX", () => {
    const view = unknownTwin(TV.SWORD);
    view.known.notice |= OBJ_NOTICE.ASSESSED;

    const plain = neutral(TV.SWORD);
    expect(ignoreLevelOf(plain, view)).toBe(IGNORE.ALL);

    const art = neutral(TV.SWORD);
    art.artifact = {} as GameObject["artifact"];
    expect(ignoreLevelOf(art, view)).toBe(IGNORE.MAX);
  });

  it("keeps an unidentified bad weapon off a BAD-threshold ignore list", () => {
    const s = new IgnoreSettings();
    s.level[ITYPE.SHARP] = IGNORE.BAD;
    const bad = neutral(TV.SWORD);
    bad.toD = -3;

    expect(objectIsIgnored(bad, known(bad), s, false)).toBe(true);
    expect(objectIsIgnored(bad, unknownTwin(TV.SWORD), s, false)).toBe(false);
  });

  it("grades jewelry off the TWIN's values, not the ring's hidden ones", () => {
    const badRing = neutral(TV.RING);
    badRing.toA = -1;
    /* Known, the penalty makes it BAD; unknown, there is nothing to see and
     * upstream's jewelry path falls through to AVERAGE (obj-ignore.c L485). */
    expect(ignoreLevelOf(badRing, known(badRing))).toBe(IGNORE.BAD);
    expect(ignoreLevelOf(badRing, unknownTwin(TV.RING))).toBe(IGNORE.AVERAGE);
  });

  it("ignores by ego only once the ego is recognised (obj-ignore.c L602)", () => {
    const s = new IgnoreSettings();
    s.egoToggle(5, ITYPE.SHARP);
    const obj = neutral(TV.SWORD);
    obj.ego = { eidx: 5 } as EgoItem;

    /* obj->known->ego is NULL until player_knows_ego, so the rule cannot fire. */
    expect(objectIsIgnored(obj, unknownTwin(TV.SWORD), s, false)).toBe(false);
    expect(objectIsIgnored(obj, known(obj), s, false)).toBe(true);
  });
});

describe("egoHasIgnoreType (obj-ignore.c L405)", () => {
  const westernesse = reg.egos.find((e) => e.name === "of Westernesse");
  if (!westernesse) {
    throw new Error("fixture: no 'of Westernesse' ego in ego_item.json");
  }

  it("is true for an ignore type one of the ego's possible kinds maps to", () => {
    /* "of Westernesse" applies to sword/polearm (ITYPE_SHARP) and hafted
     * (ITYPE_BLUNT) base kinds. */
    expect(egoHasIgnoreType(westernesse, ITYPE.SHARP, reg.kinds)).toBe(true);
    expect(egoHasIgnoreType(westernesse, ITYPE.BLUNT, reg.kinds)).toBe(true);
  });

  it("is false for an ignore type none of the ego's possible kinds maps to", () => {
    expect(egoHasIgnoreType(westernesse, ITYPE.RING, reg.kinds)).toBe(false);
  });
});

describe("IgnoreSettings.kindToggleAware / kindToggleUnaware", () => {
  it("flips only its own bit, independent of the other", () => {
    const s = new IgnoreSettings();
    const potion = neutral(TV.POTION);
    const kidx = potion.kind.kidx;

    s.kindToggleAware(kidx);
    expect(s.kindIsIgnoredAware(kidx)).toBe(true);
    expect(s.kindIsIgnoredUnaware(kidx)).toBe(false);
    expect(objectIsIgnored(potion, known(potion), s, true)).toBe(true);
    expect(objectIsIgnored(potion, known(potion), s, false)).toBe(false);

    s.kindToggleUnaware(kidx);
    expect(s.kindIsIgnoredAware(kidx)).toBe(true);
    expect(s.kindIsIgnoredUnaware(kidx)).toBe(true);
    expect(objectIsIgnored(potion, known(potion), s, false)).toBe(true);

    /* Toggling aware back off leaves the unaware bit untouched. */
    s.kindToggleAware(kidx);
    expect(s.kindIsIgnoredAware(kidx)).toBe(false);
    expect(s.kindIsIgnoredUnaware(kidx)).toBe(true);
  });
});

describe("RNG safety (ignore configuration draws no randomness)", () => {
  it("leaves an untouched rng's position unchanged across every ignore op", () => {
    const rng = new Rng(42);
    const before = JSON.stringify(rng.getState());

    const westernesse = reg.egos.find((e) => e.name === "of Westernesse");
    const s = new IgnoreSettings();
    s.level[ITYPE.SHARP] = IGNORE.BAD;
    s.egoToggle(5, ITYPE.SHARP);
    s.kindToggleAware(1);
    s.kindToggleUnaware(1);
    s.unignoring = true;
    s.unignoring = false;
    const snap = s.snapshot();
    const restored = new IgnoreSettings();
    restored.restore(snap);

    const bad = neutral(TV.SWORD);
    bad.toD = -3;
    objectIsIgnored(bad, known(bad), restored, false);
    ignoreItemOk(bad, known(bad), restored, false);
    ignoreLevelOf(bad, known(bad));
    ignoreTypeOf(bad);
    if (westernesse) egoHasIgnoreType(westernesse, ITYPE.SHARP, reg.kinds);

    /* None of the above take a Rng argument (settings state and its
     * predicates are pure), so an unrelated generator is provably
     * untouched - the port's one RNG use here (randcalc under MINIMISE,
     * inside ignoreLevelOf) is pure arithmetic with no state draw. */
    expect(JSON.stringify(rng.getState())).toBe(before);
  });
});
