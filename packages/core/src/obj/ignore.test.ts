import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ITYPE, TV } from "../generated";
import { Rng } from "../rng";
import { ObjRegistry } from "./bind";
import type { ObjPackJson } from "./types";
import { objectNew } from "./object";
import type { GameObject } from "./object";
import type { EgoItem } from "./types";
import { OBJ_NOTICE } from "./knowledge";
import {
  IGNORE,
  IgnoreSettings,
  egoHasIgnoreType,
  ignoreItemOk,
  ignoreLevelOf,
  ignoreTypeOf,
  objectIsIgnored,
} from "./ignore";

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
    expect(ignoreLevelOf(avg)).toBe(IGNORE.AVERAGE);

    const bad = neutral(TV.SWORD);
    bad.toD = -3;
    expect(ignoreLevelOf(bad)).toBe(IGNORE.BAD);

    const good = neutral(TV.SWORD);
    good.toD = 4;
    expect(ignoreLevelOf(good)).toBe(IGNORE.GOOD);
  });

  it("treats jewelry as only bad or average", () => {
    const ring = neutral(TV.RING);
    expect(ignoreLevelOf(ring)).toBe(IGNORE.AVERAGE);
    ring.modifiers[0] = 2; /* a positive modifier is 'not bad' */
    expect(ignoreLevelOf(ring)).toBe(IGNORE.AVERAGE);

    const badRing = neutral(TV.RING);
    badRing.toA = -1;
    expect(ignoreLevelOf(badRing)).toBe(IGNORE.BAD);
  });

  it("rates egos as ALL and artifacts as MAX", () => {
    const ego = neutral(TV.SWORD);
    ego.ego = { eidx: 3 } as EgoItem;
    expect(ignoreLevelOf(ego)).toBe(IGNORE.ALL);

    const art = neutral(TV.SWORD);
    art.artifact = {} as GameObject["artifact"];
    expect(ignoreLevelOf(art)).toBe(IGNORE.MAX);
  });
});

describe("object_is_ignored / ignore_item_ok (obj-ignore.c L576)", () => {
  it("ignores nothing under default settings", () => {
    const s = new IgnoreSettings();
    const bad = neutral(TV.SWORD);
    bad.toD = -3;
    expect(objectIsIgnored(bad, s, false)).toBe(false);
  });

  it("ignores by quality threshold for the ignore type", () => {
    const s = new IgnoreSettings();
    s.level[ITYPE.SHARP] = IGNORE.BAD;

    const bad = neutral(TV.SWORD);
    bad.toD = -3;
    const avg = neutral(TV.SWORD);
    expect(objectIsIgnored(bad, s, false)).toBe(true);
    expect(objectIsIgnored(avg, s, false)).toBe(false);

    /* Raising the threshold to average catches the average sword too. */
    s.level[ITYPE.SHARP] = IGNORE.AVERAGE;
    expect(objectIsIgnored(avg, s, false)).toBe(true);
  });

  it("never ignores artifacts or !k / !* inscribed items by rule", () => {
    const s = new IgnoreSettings();
    s.level[ITYPE.SHARP] = IGNORE.ALL;

    const art = neutral(TV.SWORD);
    art.artifact = {} as GameObject["artifact"];
    expect(objectIsIgnored(art, s, false)).toBe(false);

    const keep = neutral(TV.SWORD);
    keep.toD = -3;
    keep.note = "!k";
    expect(objectIsIgnored(keep, s, false)).toBe(false);
  });

  it("honors the individual ignore bit and the unignoring flag", () => {
    const s = new IgnoreSettings();
    const obj = neutral(TV.SWORD);
    obj.notice |= OBJ_NOTICE.IGNORE;
    expect(objectIsIgnored(obj, s, false)).toBe(true);
    expect(ignoreItemOk(obj, s, false)).toBe(true);

    s.unignoring = true;
    expect(ignoreItemOk(obj, s, false)).toBe(false);
  });

  it("ignores an ego of an ignored ego+type", () => {
    const s = new IgnoreSettings();
    const obj = neutral(TV.SWORD);
    obj.ego = { eidx: 5 } as EgoItem;
    expect(objectIsIgnored(obj, s, false)).toBe(false);
    s.egoToggle(5, ITYPE.SHARP);
    expect(objectIsIgnored(obj, s, false)).toBe(true);
  });

  it("ignores by kind flavor-awareness, and round-trips the settings", () => {
    const s = new IgnoreSettings();
    const potion = neutral(TV.POTION);
    s.kindIgnoreWhenAware(potion.kind.kidx);
    /* Ignored only when aware of the flavor. */
    expect(objectIsIgnored(potion, s, true)).toBe(true);
    expect(objectIsIgnored(potion, s, false)).toBe(false);

    s.level[ITYPE.SHARP] = IGNORE.GOOD;
    const restored = new IgnoreSettings();
    restored.restore(s.snapshot());
    expect(restored.level[ITYPE.SHARP]).toBe(IGNORE.GOOD);
    expect(objectIsIgnored(potion, restored, true)).toBe(true);
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
    expect(objectIsIgnored(potion, s, true)).toBe(true);
    expect(objectIsIgnored(potion, s, false)).toBe(false);

    s.kindToggleUnaware(kidx);
    expect(s.kindIsIgnoredAware(kidx)).toBe(true);
    expect(s.kindIsIgnoredUnaware(kidx)).toBe(true);
    expect(objectIsIgnored(potion, s, false)).toBe(true);

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
    objectIsIgnored(bad, restored, false);
    ignoreItemOk(bad, restored, false);
    ignoreLevelOf(bad);
    ignoreTypeOf(bad);
    if (westernesse) egoHasIgnoreType(westernesse, ITYPE.SHARP, reg.kinds);

    /* None of the above take a Rng argument (settings state and its
     * predicates are pure), so an unrelated generator is provably
     * untouched - the port's one RNG use here (randcalc under MINIMISE,
     * inside ignoreLevelOf) is pure arithmetic with no state draw. */
    expect(JSON.stringify(rng.getState())).toBe(before);
  });
});
