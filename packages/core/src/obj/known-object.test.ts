import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { Rng } from "../rng.js";
import { bindPlayer } from "../player/bind.js";
import { blankPlayer } from "../player/player.js";
import type { Player } from "../player/player.js";
import { ObjRegistry } from "./bind.js";
import type { ObjPackJson, ObjectKind } from "./types.js";
import { objectNew, tvalIsJewelry } from "./object.js";
import {
  buildRuneList,
  FlavorKnowledge,
  makeRuneEnv,
  NOOP_FLAVOR_AWARE_DEPS,
  OBJ_NOTICE,
  objectLearnUnknownRune,
  playerKnowObjectAwareness,
} from "./knowledge.js";
import type { RuneEnv } from "./knowledge.js";
import {
  KNOWN_STATE,
  knownBonusView,
  objectFlagsKnown,
  objectGrab,
  objectKnownShadow,
  objectSee,
  objectSense,
  objectTouch,
} from "./known-object.js";
import type { KnownDesc, KnownFloorDeps, KnownState } from "./known-object.js";
import { ELEM, OF, TV } from "../generated/index.js";
import { deserializePlayer, serializePlayer } from "../session/save.js";
import type { SavedPlayer } from "../session/save.js";
import { ContentIdResolver } from "../mod/ids.js";

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

describe("object_touch / object_grab (obj-knowledge.c L960-1013, gap 4.8)", () => {
  it("object_touch marks the object ASSESSED (L964)", () => {
    const obj = mkObj(ordinaryKind((k) => !tvalIsJewelry(k.tval)));
    expect(obj.notice & OBJ_NOTICE.ASSESSED).toBe(0);
    objectTouch(obj);
    expect(obj.notice & OBJ_NOTICE.ASSESSED).toBe(OBJ_NOTICE.ASSESSED);
  });

  it("fires the player_know_object awareness hook (L967)", () => {
    const obj = mkObj(ordinaryKind(() => true));
    const known: unknown[] = [];
    objectTouch(obj, { onKnow: (o) => known.push(o) });
    expect(known).toEqual([obj]);
  });

  it("logs a touched artifact via history_find_artifact (L970-971)", () => {
    const art = reg.artifacts.find((a) => a !== null)!;
    const obj = mkObj(ordinaryKind(() => true));
    obj.artifact = art;
    const found: number[] = [];
    objectTouch(obj, { onArtifactFound: (aidx) => found.push(aidx) });
    expect(found).toEqual([art.aidx]);
  });

  it("does not log non-artifacts", () => {
    const obj = mkObj(ordinaryKind(() => true));
    const found: number[] = [];
    objectTouch(obj, { onArtifactFound: (aidx) => found.push(aidx) });
    expect(found).toEqual([]);
  });

  it("the ASSESSED bit reveals the artifact name through the known shadow (L963)", () => {
    const art = reg.artifacts.find((a) => a !== null)!;
    const obj = mkObj(ordinaryKind(() => true));
    obj.artifact = art;
    const p = makePlayer();
    const env = makeEnv();
    const flavor = new FlavorKnowledge(reg.ordinaryKindCount);
    const deps = knownDescOf(flavor);

    expect(objectKnownShadow(obj, p, env, deps).artifact).toBeNull();
    objectTouch(obj);
    expect(objectKnownShadow(obj, p, env, deps).artifact).toBe(art);
  });

  it("object_grab reduces to object_touch in the on-demand twin model (L1012)", () => {
    const art = reg.artifacts.find((a) => a !== null)!;
    const obj = mkObj(ordinaryKind(() => true));
    obj.artifact = art;
    const found: number[] = [];
    const known: unknown[] = [];
    objectGrab(obj, {
      onArtifactFound: (aidx) => found.push(aidx),
      onKnow: (o) => known.push(o),
    });
    expect(obj.notice & OBJ_NOTICE.ASSESSED).toBe(OBJ_NOTICE.ASSESSED);
    expect(found).toEqual([art.aidx]);
    expect(known).toEqual([obj]);
  });
});

describe("objectKnownShadow progressive-sensing gate (obj-knowledge.c L1027-1035, gap 4.8)", () => {
  const setup = () => {
    const p = makePlayer();
    const env = makeEnv();
    const flavor = new FlavorKnowledge(reg.ordinaryKindCount);
    const kind = ordinaryKind((k) => k.dd > 0 && k.ds > 0 && k.ac === 0);
    return { p, env, deps: knownDescOf(flavor), obj: mkObj(kind), kind };
  };

  it("a SEEN object gets base properties (the default state)", () => {
    const { p, env, deps, obj, kind } = setup();
    const shadow = objectKnownShadow(obj, p, env, deps);
    expect(shadow.dd).toBe(kind.dd);
    expect(shadow.ds).toBe(kind.ds);
  });

  it("an only-SENSED object gets no ID at all (L1030)", () => {
    const { p, env, deps, obj } = setup();
    const shadow = objectKnownShadow(obj, p, env, deps, KNOWN_STATE.SENSED);
    /* player_know_object returns before object_set_base_known - not even the
     * base dice are filled. */
    expect(shadow.dd).toBe(0);
    expect(shadow.ds).toBe(0);
    expect(shadow.ac).toBe(0);
  });

  it("an UNSEEN object gets no ID at all (L1029)", () => {
    const { p, env, deps, obj } = setup();
    const shadow = objectKnownShadow(obj, p, env, deps, KNOWN_STATE.UNSEEN);
    expect(shadow.dd).toBe(0);
    expect(shadow.ds).toBe(0);
  });
});

describe("object_see / object_sense (obj-knowledge.c L862-955, gap 4.8)", () => {
  /** A reduced known-cave floor that tracks one grid's KnownState. */
  function fakeFloor(initial: KnownState = KNOWN_STATE.UNSEEN) {
    let st: KnownState = initial;
    const calls: string[] = [];
    const deps: KnownFloorDeps = {
      state: () => st,
      setSeen: () => {
        st = KNOWN_STATE.SEEN;
        calls.push("seen");
      },
      setSensed: (_obj, isMoney) => {
        st = KNOWN_STATE.SENSED;
        calls.push(isMoney ? "sensed-money" : "sensed-item");
      },
      setNumber: () => {
        calls.push("number");
      },
    };
    return { deps, calls, state: () => st };
  }

  it("progresses unseen -> sensed -> seen -> number", () => {
    const obj = mkObj(ordinaryKind(() => true));
    const floor = fakeFloor();

    objectSense(obj, floor.deps); /* L862: new sensed marker */
    expect(floor.state()).toBe(KNOWN_STATE.SENSED);

    objectSee(obj, floor.deps); /* L934-936: sensed -> exact */
    expect(floor.state()).toBe(KNOWN_STATE.SEEN);

    objectSee(obj, floor.deps); /* L937-939: exact -> just refresh number */
    expect(floor.state()).toBe(KNOWN_STATE.SEEN);

    expect(floor.calls).toEqual(["sensed-item", "seen", "number"]);
  });

  it("object_see on an unseen object makes an exact memory directly (L909-927)", () => {
    const obj = mkObj(ordinaryKind(() => true));
    const floor = fakeFloor();
    objectSee(obj, floor.deps);
    expect(floor.state()).toBe(KNOWN_STATE.SEEN);
    expect(floor.calls).toEqual(["seen"]);
  });

  it("object_sense leaves an already-known grid untouched (L868-869)", () => {
    const obj = mkObj(ordinaryKind(() => true));
    const floor = fakeFloor(KNOWN_STATE.SEEN);
    objectSense(obj, floor.deps);
    expect(floor.state()).toBe(KNOWN_STATE.SEEN);
    expect(floor.calls).toEqual([]);
  });

  it("object_sense marks money with the treasure kind (L886-888)", () => {
    const obj = mkObj(ordinaryKind(() => true));
    obj.tval = TV.GOLD;
    const floor = fakeFloor();
    objectSense(obj, floor.deps);
    expect(floor.calls).toEqual(["sensed-money"]);
  });
});

/**
 * object_flags_known (obj-util.c:364) and the view calc_bonuses' known_only
 * pass reads off it (PORT_TODO 2.6).
 */
describe("objectFlagsKnown / knownBonusView (obj-util.c:364)", () => {
  it("carries only the flags whose runes are learned", () => {
    const p = makePlayer();
    const env = makeEnv();
    const flavor = new FlavorKnowledge(reg.ordinaryKindCount);
    const obj = mkObj(ordinaryKind((k) => k.tval === TV.SOFT_ARMOR));
    stripRunes(obj);
    obj.notice |= OBJ_NOTICE.ASSESSED;
    obj.flags.on(OF.FEATHER);

    expect(
      objectFlagsKnown(obj, p, env, knownDescOf(flavor)).has(OF.FEATHER),
    ).toBe(false);

    p.objKnown.flags.on(OF.FEATHER);
    expect(
      objectFlagsKnown(obj, p, env, knownDescOf(flavor)).has(OF.FEATHER),
    ).toBe(true);
  });

  it("adds an AWARE kind's own flags even with the rune unlearned", () => {
    /*
     * The half of object_flags_known that the known TWIN cannot supply
     * (L373-375). Recognising a Ring of Free Action by its flavour tells you
     * what it does; the rune has nothing to do with it. A shadow-only
     * implementation would answer "no free action" for a ring the player has
     * used for fifty levels.
     */
    const kind = reg.kinds.find(
      (k) =>
        k.kidx < reg.ordinaryKindCount &&
        k.tval === TV.RING &&
        k.flags.has(OF.FREE_ACT),
    );
    expect(kind, "fixture: the pack ships a ring with OF_FREE_ACT").toBeTruthy();

    const p = makePlayer();
    const env = makeEnv();
    const flavor = new FlavorKnowledge(reg.ordinaryKindCount);
    const obj = mkObj(kind!);
    obj.flags.union(kind!.flags);
    obj.notice |= OBJ_NOTICE.ASSESSED;

    expect(
      objectFlagsKnown(obj, p, env, knownDescOf(flavor)).has(OF.FREE_ACT),
      "unaware and no rune: nothing is known",
    ).toBe(false);

    flavor.objectFlavorAware(kind!, NOOP_FLAVOR_AWARE_DEPS);
    expect(
      objectFlagsKnown(obj, p, env, knownDescOf(flavor)).has(OF.FREE_ACT),
      "aware of the flavour: the kind's own flags are known",
    ).toBe(true);
  });

  it("passes the combat bonuses straight through, and gates the resist", () => {
    const p = makePlayer();
    const env = makeEnv();
    const flavor = new FlavorKnowledge(reg.ordinaryKindCount);
    const obj = mkObj(ordinaryKind((k) => k.tval === TV.SOFT_ARMOR));
    stripRunes(obj);
    obj.notice |= OBJ_NOTICE.ASSESSED;
    obj.toA = 5;
    obj.toD = 3;
    obj.elInfo[ELEM.FIRE]!.resLevel = 1;

    /*
     * ALL THREE COMBAT RUNES ARE GRANTED AT BIRTH, and this is the measurement
     * that corrects PORT_TODO 2.6's own example.
     * do_cmd_accept_character (player-birth.c:1264-1267) sets
     * obj_k->to_a = to_h = to_d = 1 under the comment "Hack - player knows all
     * combat runes.  Maybe make them not runes? NRM". So the three gates
     * calc_bonuses opens at 1997 / 2001 / 2004 can never CLOSE on an ordinary
     * character: the row's claim that an unlearned +to_a is hidden from the
     * sidebar was describing a rune nobody has to learn.
     *
     * What known_state really withholds is resists and object flags.
     */
    expect([p.objKnown.toA, p.objKnown.toH, p.objKnown.toD]).toEqual([1, 1, 1]);

    const blind = knownBonusView(obj, p, env, knownDescOf(flavor));
    expect(blind.toA).toBe(5);
    expect(blind.toD).toBe(3);
    expect(blind.elInfo[ELEM.FIRE]?.resLevel).toBe(0);

    p.objKnown.elInfo[ELEM.FIRE]!.resLevel = 1;
    expect(
      knownBonusView(obj, p, env, knownDescOf(flavor)).elInfo[ELEM.FIRE]
        ?.resLevel,
    ).toBe(1);
  });

  it("withholds everything from an object that has not been assessed", () => {
    /*
     * player_know_object returns after the base properties for an object that
     * is seen but not touched (obj-knowledge.c:1033-1035), so a worn item the
     * player has never handled contributes no bonus at all to known_state -
     * the one path on which the combat gates DO close.
     */
    const p = makePlayer();
    const env = makeEnv();
    const flavor = new FlavorKnowledge(reg.ordinaryKindCount);
    const obj = mkObj(ordinaryKind((k) => k.tval === TV.SOFT_ARMOR));
    stripRunes(obj);
    obj.toA = 5;
    obj.toD = 3;
    expect(obj.notice & OBJ_NOTICE.ASSESSED).toBe(0);

    const view = knownBonusView(obj, p, env, knownDescOf(flavor));
    expect(view.toA).toBe(0);
    expect(view.toD).toBe(0);

    obj.notice |= OBJ_NOTICE.ASSESSED;
    expect(knownBonusView(obj, p, env, knownDescOf(flavor)).toA).toBe(5);
  });
});
