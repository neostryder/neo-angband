import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Rng } from "../rng";
import { bindPlayer } from "../player/bind";
import { blankPlayer } from "../player/player";
import type { Player } from "../player/player";
import { ObjRegistry } from "./bind";
import type { ObjPackJson, ObjectKind } from "./types";
import { objectNew, tvalIsJewelry } from "./object";
import {
  buildRuneList,
  FlavorKnowledge,
  makeRuneEnv,
  NOOP_FLAVOR_AWARE_DEPS,
  OBJ_NOTICE,
  objectLearnUnknownRune,
  playerKnowObjectAwareness,
} from "./knowledge";
import type { RuneEnv } from "./knowledge";
import { objectKnownShadow } from "./known-object";
import type { KnownDesc } from "./known-object";
import { deserializePlayer, serializePlayer } from "../session/save";
import type { SavedPlayer } from "../session/save";
import { ContentIdResolver } from "../mod/ids";

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

const ids = new ContentIdResolver({ objects: reg });

function makePlayer(): Player {
  const race = players.raceByName("Human")!;
  const cls = players.classByName("Warrior")!;
  return blankPlayer(race, cls, players.bodies[race.body]!);
}

/** A RuneEnv with nothing equipped, matching the learn-test fixture. */
function makeEnv(): RuneEnv {
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
}

/** A KnownDesc backed by a live FlavorKnowledge (what desc.ts feeds). */
function knownDescOf(flavor: FlavorKnowledge): KnownDesc {
  return {
    isAware: (kind) => flavor.isAware(kind),
    isTried: (kind) => flavor.wasTried(kind),
  };
}

const ordinaryKind = (pred: (k: ObjectKind) => boolean): ObjectKind => {
  const k = reg.kinds.find((kk) => kk.kidx < reg.ordinaryKindCount && pred(kk));
  if (!k) throw new Error("no matching ordinary kind");
  return k;
};

/** objectNew + the base-field copies object_prep makes (tval/dice/ac/weight). */
function mkObj(kind: ObjectKind): ReturnType<typeof objectNew> {
  const obj = objectNew(kind);
  obj.tval = kind.tval;
  obj.sval = kind.sval;
  obj.dd = kind.dd;
  obj.ds = kind.ds;
  obj.ac = kind.ac;
  obj.weight = kind.weight;
  obj.number = 1;
  return obj;
}

/** Strip every rune-bearing property off an object instance (a "blank" item). */
function stripRunes(obj: ReturnType<typeof objectNew>): void {
  obj.toA = 0;
  obj.toH = 0;
  obj.toD = 0;
  obj.modifiers.fill(0);
  obj.flags.wipe();
  obj.brands = null;
  obj.slays = null;
  obj.curses = null;
  for (const e of obj.elInfo) {
    e.resLevel = 0;
    e.flags = 0;
  }
}

describe("known shadow dd/ds/ac runes (obj-knowledge.c L830-838, L1039-1041)", () => {
  it("shows base damage dice of an UNASSESSED weapon (dd/ds known from birth)", () => {
    const p = makePlayer();
    const env = makeEnv();
    const flavor = new FlavorKnowledge(reg.ordinaryKindCount);
    const kind = ordinaryKind((k) => k.dd > 0 && k.ds > 0);
    const obj = mkObj(kind);
    expect(obj.notice & OBJ_NOTICE.ASSESSED).toBe(0); // unassessed

    const shadow = objectKnownShadow(obj, p, env, knownDescOf(flavor));

    /* Base dice are obvious birth knowledge: they show even before ID. Before
     * this fix the port approximated dd/ds by the ASSESSED bit, so an
     * unassessed weapon wrongly reported dd = ds = 0. */
    expect(shadow.dd).toBe(kind.dd);
    expect(shadow.ds).toBe(kind.ds);
  });

  it("shows base ac of an UNASSESSED armour piece", () => {
    const p = makePlayer();
    const env = makeEnv();
    const flavor = new FlavorKnowledge(reg.ordinaryKindCount);
    const kind = ordinaryKind((k) => k.ac > 0);
    const obj = mkObj(kind);
    expect(obj.notice & OBJ_NOTICE.ASSESSED).toBe(0);

    const shadow = objectKnownShadow(obj, p, env, knownDescOf(flavor));
    expect(shadow.ac).toBe(kind.ac);
  });

  it("dd/ds/ac start at 1 and survive a save -> load round-trip", () => {
    const p = makePlayer();
    expect(p.objKnown.dd).toBe(1);
    expect(p.objKnown.ds).toBe(1);
    expect(p.objKnown.ac).toBe(1);

    const data = JSON.parse(
      JSON.stringify(serializePlayer(p, ids)),
    ) as SavedPlayer;
    const loaded = deserializePlayer(data, players, reg, ids);
    expect(loaded.objKnown.dd).toBe(1);
    expect(loaded.objKnown.ds).toBe(1);
    expect(loaded.objKnown.ac).toBe(1);
  });

  it("a legacy save WITHOUT dd/ds/ac deserializes them to 1 (obvious knowledge)", () => {
    const p = makePlayer();
    const data = JSON.parse(
      JSON.stringify(serializePlayer(p, ids)),
    ) as SavedPlayer;
    /* Simulate a save written before dd/ds/ac existed. */
    delete data.objKnown!.dd;
    delete data.objKnown!.ds;
    delete data.objKnown!.ac;

    const loaded = deserializePlayer(data, players, reg, ids);
    expect(loaded.objKnown.dd).toBe(1);
    expect(loaded.objKnown.ds).toBe(1);
    expect(loaded.objKnown.ac).toBe(1);
  });
});

describe("player_know_object awareness side effect (obj-knowledge.c L1163-1175)", () => {
  it("assessing a special (non-jewelry) artifact kind marks its flavor aware", () => {
    const p = makePlayer();
    const env = makeEnv();
    const rng = new Rng(11);
    const runes = buildRuneList(env);
    const flavor = new FlavorKnowledge(reg.ordinaryKindCount);

    const kind = reg.kinds.find(
      (k) => k.kidx >= reg.ordinaryKindCount && !tvalIsJewelry(k.tval),
    );
    if (!kind) throw new Error("no special non-jewelry artifact kind");
    const obj = mkObj(kind);
    stripRunes(obj);
    expect(flavor.isAware(kind)).toBe(false);

    /* Learn to assessment (the assess branch fires player_know_object). */
    let learned = true;
    while (learned) {
      learned = objectLearnUnknownRune(
        rng,
        p,
        env,
        obj,
        runes,
        flavor,
        NOOP_FLAVOR_AWARE_DEPS,
      );
    }
    expect(obj.notice & OBJ_NOTICE.ASSESSED).toBe(OBJ_NOTICE.ASSESSED);
    expect(flavor.isAware(kind)).toBe(true);
  });

  it("assessing jewelry whose non-curse runes are all known marks it aware", () => {
    const p = makePlayer();
    const env = makeEnv();
    const rng = new Rng(12);
    const runes = buildRuneList(env);
    const flavor = new FlavorKnowledge(reg.ordinaryKindCount);

    const kind = ordinaryKind((k) => tvalIsJewelry(k.tval));
    const obj = mkObj(kind);
    stripRunes(obj); /* no non-curse runes -> all trivially known */
    expect(flavor.isAware(kind)).toBe(false);

    /* Blank jewelry: the first call finds no unknown runes, assesses, and the
     * jewelry branch (non_curse_runes_known) fires object_flavor_aware. */
    const learned = objectLearnUnknownRune(
      rng,
      p,
      env,
      obj,
      runes,
      flavor,
      NOOP_FLAVOR_AWARE_DEPS,
    );
    expect(learned).toBe(false);
    expect(obj.notice & OBJ_NOTICE.ASSESSED).toBe(OBJ_NOTICE.ASSESSED);
    expect(flavor.isAware(kind)).toBe(true);
  });

  it("does NOT become aware while the object is still unassessed", () => {
    const p = makePlayer();
    const env = makeEnv();
    const runes = buildRuneList(env);
    const flavor = new FlavorKnowledge(reg.ordinaryKindCount);

    const kind = reg.kinds.find(
      (k) => k.kidx >= reg.ordinaryKindCount && !tvalIsJewelry(k.tval),
    )!;
    const obj = mkObj(kind);
    stripRunes(obj);
    expect(obj.notice & OBJ_NOTICE.ASSESSED).toBe(0);

    /* player_know_object early-returns for the unassessed (L1033). */
    playerKnowObjectAwareness(p, env, obj, runes, flavor, NOOP_FLAVOR_AWARE_DEPS);
    expect(flavor.isAware(kind)).toBe(false);
  });

  it("the display path (objectKnownShadow) never mutates awareness", () => {
    const p = makePlayer();
    const env = makeEnv();
    const flavor = new FlavorKnowledge(reg.ordinaryKindCount);

    /* An ASSESSED special artifact: player_know_object WOULD make it aware, but
     * describing it must not. */
    const kind = reg.kinds.find(
      (k) => k.kidx >= reg.ordinaryKindCount && !tvalIsJewelry(k.tval),
    )!;
    const obj = mkObj(kind);
    stripRunes(obj);
    obj.notice |= OBJ_NOTICE.ASSESSED;
    expect(flavor.isAware(kind)).toBe(false);

    objectKnownShadow(obj, p, env, knownDescOf(flavor));
    expect(flavor.isAware(kind)).toBe(false); // unchanged by a describe call
  });
});
