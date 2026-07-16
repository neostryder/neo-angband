import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants";
import { FlagSet } from "../bitflag";
import { MFLAG, OF, RF, SQUARE, TV } from "../generated";
import { OF_SIZE } from "../player/types";
import type { PlayerState } from "../player/calcs";
import { getLore } from "../mon/lore";
import type { Monster } from "../mon/monster";
import type { GameState } from "./context";
import { loc } from "../loc";
import { Rng } from "../rng";
import { ObjRegistry } from "../obj/bind";
import type { ObjPackJson } from "../obj/types";
import { objectPrep } from "../obj/make";
import type { GameObject } from "../obj/object";
import { floorCarry, floorExcise, floorPile } from "./floor";
import {
  becomeAware,
  caveIlluminateKnown,
  forgetMap,
  knownFeat,
  knownObject,
  noteSpots,
  squareApparentLookInPreposition,
  squareApparentLookPrefix,
  squareApparentName,
  squareForget,
  squareIsInteresting,
  squareIsKnown,
  squareKnowPile,
  squareMemorize,
  squareMemoryBad,
  squareSensePile,
  tickMonsterMarks,
  updateMon,
  updateMonsters,
} from "./known";
import { FLOOR, GRANITE, addMon, featureReg, makeRace, makeState } from "./harness";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as T;
}

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

function makeObj(tval: number): GameObject {
  const kind = reg.kinds.find(
    (k) => k.tval === tval && k.kidx < reg.ordinaryKindCount,
  );
  if (!kind) throw new Error(`no ordinary kind for tval ${tval}`);
  return objectPrep(new Rng(9), reg, constants, kind, 0, "average");
}

describe("terrain memory (square_memorize / square_forget)", () => {
  it("remembers and forgets terrain", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const grid = loc(12, 10);
    expect(squareIsKnown(state, grid)).toBe(false);
    expect(knownFeat(state, grid)).toBe(-1);

    squareMemorize(state, grid);
    expect(squareIsKnown(state, grid)).toBe(true);
    expect(knownFeat(state, grid)).toBe(FLOOR);

    squareForget(state, grid);
    expect(squareIsKnown(state, grid)).toBe(false);
  });

  it("memory goes stale when the world changes (square_ismemorybad)", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const grid = loc(12, 10);
    squareMemorize(state, grid);
    expect(squareMemoryBad(state, grid)).toBe(false);

    state.chunk.setFeat(grid, GRANITE);
    /* The player still remembers floor. */
    expect(knownFeat(state, grid)).toBe(FLOOR);
    expect(squareMemoryBad(state, grid)).toBe(true);
  });
});

describe("square_know_pile find-on-sight (object_touch, obj-knowledge.c L971)", () => {
  const firstArtifact = reg.artifacts.find((a) => a) ?? null;

  function artifactObj(): GameObject {
    const obj = makeObj(TV.SWORD);
    obj.artifact = firstArtifact;
    return obj;
  }

  it("logs an artifact the player steps onto (its own grid)", () => {
    const pgrid = loc(10, 10);
    const state = makeState({ playerGrid: pgrid });
    const found: unknown[] = [];
    state.onArtifactFound = (a) => found.push(a);

    floorCarry(state, pgrid, artifactObj());
    squareKnowPile(state, pgrid);

    expect(found).toEqual([firstArtifact]);
  });

  it("does NOT log an artifact merely seen at a distance", () => {
    const pgrid = loc(10, 10);
    const far = loc(5, 5);
    const state = makeState({ playerGrid: pgrid });
    const found: unknown[] = [];
    state.onArtifactFound = (a) => found.push(a);

    floorCarry(state, far, artifactObj());
    squareKnowPile(state, far);

    expect(found).toEqual([]);
  });
});

describe("cave_illuminate (cave-map.c L555, runtime)", () => {
  it("relights an interior floor grid at the day/night boundary and updates knowledge", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const floorGrid = loc(5, 5); // interior, surrounded by floor (openField)

    /* Dawn: daytime lights every grid and (since it has a floor/stairs
     * neighbor) memorizes it. */
    caveIlluminateKnown(state, true);
    expect(state.chunk.sqinfoHas(floorGrid, SQUARE.GLOW)).toBe(true);
    expect(squareIsKnown(state, floorGrid)).toBe(true);
    expect(knownFeat(state, floorGrid)).toBe(FLOOR);

    /* Nightfall: a plain (non-bright) floor grid goes dark and is forgotten,
     * exactly like cave_unlight(). */
    caveIlluminateKnown(state, false);
    expect(state.chunk.sqinfoHas(floorGrid, SQUARE.GLOW)).toBe(false);
    expect(squareIsKnown(state, floorGrid)).toBe(false);

    /* Dawn again: relit and re-memorized. */
    caveIlluminateKnown(state, true);
    expect(state.chunk.sqinfoHas(floorGrid, SQUARE.GLOW)).toBe(true);
    expect(squareIsKnown(state, floorGrid)).toBe(true);
  });

  it("is RNG-free", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const before = state.rng.getState();
    caveIlluminateKnown(state, true);
    caveIlluminateKnown(state, false);
    expect(state.rng.getState()).toEqual(before);
  });
});

describe("object memory (square_know_pile / square_sense_pile)", () => {
  it("knowPile remembers the pile head and forgets stale memories", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const grid = loc(12, 10);
    const obj = makeObj(TV.POTION);
    floorCarry(state, grid, obj);

    squareKnowPile(state, grid);
    expect(knownObject(state, grid)).toEqual({
      ch: obj.kind.dChar,
      attr: obj.kind.dAttr,
    });

    /* The object is picked up: knowing the (empty) pile clears memory. */
    floorExcise(state, grid, obj);
    expect(floorPile(state, grid)).toEqual([]);
    squareKnowPile(state, grid);
    expect(knownObject(state, grid)).toBeNull();
  });

  it("sensePile marks an unknown something without identifying it", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const grid = loc(12, 10);
    floorCarry(state, grid, makeObj(TV.SWORD));

    squareSensePile(state, grid);
    expect(knownObject(state, grid)).toEqual({ ch: null, attr: "" });

    /* An exact memory is not downgraded by a later sense. */
    squareKnowPile(state, grid);
    const exact = knownObject(state, grid);
    squareSensePile(state, grid);
    expect(knownObject(state, grid)).toEqual(exact);
  });

  it("a predicate restricts what is remembered", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const grid = loc(12, 10);
    floorCarry(state, grid, makeObj(TV.SWORD));
    squareKnowPile(state, grid, (o) => o.tval === TV.POTION);
    /* Nothing matching: memory untouched, but the pile is not empty so
     * nothing is forgotten either. */
    expect(knownObject(state, grid)).toBeNull();
  });
});

/**
 * Give the state a derived PlayerState with just the fields update_mon reads
 * (the OF flag set and see_infra). update_mon touches nothing else on it.
 */
function withPlayerState(
  state: GameState,
  opts: { telepathy?: boolean; seeInvis?: boolean; seeInfra?: number } = {},
): void {
  const flags = new FlagSet(OF_SIZE);
  if (opts.telepathy) flags.on(OF.TELEPATHY);
  if (opts.seeInvis) flags.on(OF.SEE_INVIS);
  state.playerState = {
    flags,
    seeInfra: opts.seeInfra ?? 0,
  } as unknown as PlayerState;
}

/** A grid is fully lit and in view (SEEN implies VIEW upstream). */
function lightAndView(state: GameState, grid: ReturnType<typeof loc>): void {
  state.chunk.sqinfoOn(grid, SQUARE.VIEW);
  state.chunk.sqinfoOn(grid, SQUARE.SEEN);
}

/** The lore sight counter for a monster's race. */
function getLoreSights(state: GameState, mon: Monster): number {
  return getLore(state.lore, mon.race).sights;
}

describe("noteSpots (note_spot + update_mon)", () => {
  it("memorizes seen grids with their piles", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const grid = loc(12, 10);
    floorCarry(state, grid, makeObj(TV.POTION));
    state.chunk.sqinfoOn(grid, SQUARE.SEEN);

    noteSpots(state);
    expect(squareIsKnown(state, grid)).toBe(true);
    expect(knownObject(state, grid)).not.toBeNull();
    /* An unseen grid stays unknown. */
    expect(squareIsKnown(state, loc(20, 10))).toBe(false);
  });

  it("keeps monster visibility flags in step with the view", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const mon = addMon(state, makeRace(), loc(12, 10));
    lightAndView(state, mon.grid);

    noteSpots(state);
    expect(mon.mflag.has(MFLAG.VISIBLE)).toBe(true);
    expect(mon.mflag.has(MFLAG.VIEW)).toBe(true);

    /* Out of view: the flag fades. */
    state.chunk.sqinfoOff(mon.grid, SQUARE.SEEN);
    state.chunk.sqinfoOff(mon.grid, SQUARE.VIEW);
    noteSpots(state);
    expect(mon.mflag.has(MFLAG.VISIBLE)).toBe(false);
    expect(mon.mflag.has(MFLAG.VIEW)).toBe(false);
  });

  it("an illuminated monster records a fresh sighting in the lore", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const mon = addMon(state, makeRace(), loc(12, 10));
    lightAndView(state, mon.grid);

    noteSpots(state);
    expect(getLoreSights(state, mon)).toBe(1);
    /* Already visible: no double count. */
    noteSpots(state);
    expect(getLoreSights(state, mon)).toBe(1);
  });
});

describe("update_mon telepathy", () => {
  it("senses an out-of-LOS non-empty-mind monster (visible, not in view)", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    withPlayerState(state, { telepathy: true });
    /* No VIEW / SEEN: the monster is out of line of sight. */
    const mon = addMon(state, makeRace(), loc(12, 10));

    updateMon(state, mon, true);
    expect(mon.mflag.has(MFLAG.VISIBLE)).toBe(true);
    expect(mon.mflag.has(MFLAG.VIEW)).toBe(false);
    /* Telepathy learns the mind flags. */
    const lore = getLore(state.lore, mon.race);
    expect(lore.flags.has(RF.EMPTY_MIND)).toBe(true);
    expect(lore.flags.has(RF.WEIRD_MIND)).toBe(true);
    expect(lore.flags.has(RF.SMART)).toBe(true);
    expect(lore.flags.has(RF.STUPID)).toBe(true);
  });

  it("does not sense an EMPTY_MIND monster", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    withPlayerState(state, { telepathy: true });
    const mon = addMon(state, makeRace({ flags: [RF.EMPTY_MIND] }), loc(12, 10));

    updateMon(state, mon, true);
    expect(mon.mflag.has(MFLAG.VISIBLE)).toBe(false);
  });

  it("is suppressed on a NO_ESP square", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    withPlayerState(state, { telepathy: true });
    const mon = addMon(state, makeRace(), loc(12, 10));
    state.chunk.sqinfoOn(mon.grid, SQUARE.NO_ESP);

    updateMon(state, mon, true);
    expect(mon.mflag.has(MFLAG.VISIBLE)).toBe(false);
  });
});

describe("update_mon infravision", () => {
  it("reveals a warm-blooded monster in the dark within radius", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    withPlayerState(state, { seeInfra: 5 });
    const mon = addMon(state, makeRace(), loc(12, 10));
    /* In view but unlit (no SEEN): only infravision can reveal it. */
    state.chunk.sqinfoOn(mon.grid, SQUARE.VIEW);

    updateMon(state, mon, true);
    expect(mon.mflag.has(MFLAG.VISIBLE)).toBe(true);
    expect(mon.mflag.has(MFLAG.VIEW)).toBe(true);
    expect(getLore(state.lore, mon.race).flags.has(RF.COLD_BLOOD)).toBe(true);
  });

  it("does not reveal a cold-blooded monster in the dark", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    withPlayerState(state, { seeInfra: 5 });
    const mon = addMon(state, makeRace({ flags: [RF.COLD_BLOOD] }), loc(12, 10));
    state.chunk.sqinfoOn(mon.grid, SQUARE.VIEW);

    updateMon(state, mon, true);
    expect(mon.mflag.has(MFLAG.VISIBLE)).toBe(false);
    /* The cold blood is still learned. */
    expect(getLore(state.lore, mon.race).flags.has(RF.COLD_BLOOD)).toBe(true);
  });
});

describe("update_mon see-invisible", () => {
  it("hides an invisible monster in LOS without see-invisible", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    withPlayerState(state, { seeInfra: 0 });
    const ghost = addMon(state, makeRace({ flags: [RF.INVISIBLE] }), loc(12, 10));
    lightAndView(state, ghost.grid);

    updateMon(state, ghost, true);
    expect(ghost.mflag.has(MFLAG.VISIBLE)).toBe(false);
    /* Invisibility is learned from the illumination attempt. */
    expect(getLore(state.lore, ghost.race).flags.has(RF.INVISIBLE)).toBe(true);
  });

  it("reveals an invisible monster in LOS with see-invisible", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    withPlayerState(state, { seeInvis: true, seeInfra: 0 });
    const ghost = addMon(state, makeRace({ flags: [RF.INVISIBLE] }), loc(12, 10));
    lightAndView(state, ghost.grid);

    updateMon(state, ghost, true);
    expect(ghost.mflag.has(MFLAG.VISIBLE)).toBe(true);
  });
});

describe("update_mon distance and determinism", () => {
  it("full=true writes the octagonal distance, full=false leaves cdis", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const mon = addMon(state, makeRace(), loc(16, 13));
    /* dy=3, dx=6 -> 6 + (3>>1) = 7. */
    updateMon(state, mon, true);
    expect(mon.cdis).toBe(7);

    mon.grid = loc(11, 10);
    updateMon(state, mon, false);
    expect(mon.cdis).toBe(7); /* unchanged: full=false keeps cdis */
  });

  it("draws no RNG", () => {
    /* Two identically-seeded states; only one runs the visibility pass. If
     * updateMonsters draws nothing, the next RNG value is the same on both. */
    const build = (): GameState => {
      const s = makeState({ seed: 777, playerGrid: loc(10, 10) });
      withPlayerState(s, { telepathy: true });
      addMon(s, makeRace(), loc(12, 10));
      lightAndView(s, loc(12, 10));
      return s;
    };
    const a = build();
    updateMonsters(a, true);
    const b = build();
    expect(a.rng.randint0(1_000_000)).toBe(b.rng.randint0(1_000_000));
  });
});

describe("tickMonsterMarks (process_world detection fade)", () => {
  it("a detection MARK survives one refresh, then fades", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const ghost = addMon(state, makeRace({ flags: [RF.INVISIBLE] }), loc(12, 10));

    /* Detected: MARK + SHOW, and update_mon keeps it VISIBLE while MARKed. */
    ghost.mflag.on(MFLAG.MARK);
    ghost.mflag.on(MFLAG.SHOW);
    updateMon(state, ghost, true);
    expect(ghost.mflag.has(MFLAG.VISIBLE)).toBe(true);

    /* First tick: SHOW present, so MARK is kept (SHOW then cleared). */
    tickMonsterMarks(state);
    expect(ghost.mflag.has(MFLAG.MARK)).toBe(true);
    expect(ghost.mflag.has(MFLAG.SHOW)).toBe(false);

    /* Second tick: SHOW gone, so MARK is dropped and the monster fades. */
    tickMonsterMarks(state);
    expect(ghost.mflag.has(MFLAG.MARK)).toBe(false);
    expect(ghost.mflag.has(MFLAG.VISIBLE)).toBe(false);
  });

  it("update_mon only reads MARK; it never clears MARK or SHOW", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const mon = addMon(state, makeRace(), loc(12, 10));
    mon.mflag.on(MFLAG.MARK);
    mon.mflag.on(MFLAG.SHOW);

    updateMon(state, mon, true);
    expect(mon.mflag.has(MFLAG.VISIBLE)).toBe(true);
    expect(mon.mflag.has(MFLAG.MARK)).toBe(true);
    expect(mon.mflag.has(MFLAG.SHOW)).toBe(true);
  });
});

describe("forgetMap (wiz_dark's forgetting half)", () => {
  it("erases all memory and DTRAP marks", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const grid = loc(12, 10);
    squareMemorize(state, grid);
    floorCarry(state, grid, makeObj(TV.POTION));
    squareKnowPile(state, grid);
    state.chunk.sqinfoOn(grid, SQUARE.DTRAP);

    forgetMap(state);
    expect(squareIsKnown(state, grid)).toBe(false);
    expect(knownObject(state, grid)).toBeNull();
    expect(state.chunk.sqinfoHas(grid, SQUARE.DTRAP)).toBe(false);
  });
});

describe("squareApparentName / squareApparentLookPrefix / squareApparentLookInPreposition (cave-square.c)", () => {
  const MORE = featureReg.byCodeName("MORE").fidx; // "down staircase", TF_INTERESTING
  const LAVA = featureReg.byCodeName("LAVA").fidx; // custom look-prefix "some"
  const OPEN = featureReg.byCodeName("OPEN").fidx; // custom look-in-preposition "in"

  it("falls back to an indefinite article when the feature has no look-prefix", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const grid = loc(12, 10);
    state.chunk.setFeat(grid, MORE);
    squareMemorize(state, grid);
    expect(squareApparentName(state, grid)).toBe("down staircase");
    expect(squareApparentLookPrefix(state, grid)).toBe("a ");
  });

  it("uses the feature's own look-prefix override when it has one", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const grid = loc(12, 10);
    state.chunk.setFeat(grid, LAVA);
    squareMemorize(state, grid);
    expect(squareApparentLookPrefix(state, grid)).toBe("some");
  });

  it("uses the feature's own look-in-preposition override when it has one", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const grid = loc(12, 10);
    state.chunk.setFeat(grid, OPEN);
    squareMemorize(state, grid);
    // terrain.txt's own data for OPEN has no trailing space (unlike the
    // "on " default); reproduced verbatim rather than "fixed" here.
    expect(squareApparentLookInPreposition(state, grid)).toBe("in");
  });

  it("defaults the look-in-preposition to 'on ' otherwise", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const grid = loc(12, 10);
    state.chunk.setFeat(grid, FLOOR);
    squareMemorize(state, grid);
    expect(squareApparentLookInPreposition(state, grid)).toBe("on ");
  });

  it("reads 'unknown grid' for a grid the player has never memorized", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const grid = loc(20, 20);
    expect(squareIsKnown(state, grid)).toBe(false);
    expect(squareApparentName(state, grid)).toBe("unknown grid");
  });
});

describe("squareIsInteresting (cave-square.c square_isinteresting, read against knowledge)", () => {
  it("is false for an unmemorized grid", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    expect(squareIsInteresting(state, loc(20, 20))).toBe(false);
  });

  it("is true for a memorized TF_INTERESTING feature (a down staircase)", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const grid = loc(12, 10);
    state.chunk.setFeat(grid, featureReg.byCodeName("MORE").fidx);
    squareMemorize(state, grid);
    expect(squareIsInteresting(state, grid)).toBe(true);
  });

  it("is false for a memorized plain floor", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const grid = loc(12, 10);
    state.chunk.setFeat(grid, FLOOR);
    squareMemorize(state, grid);
    expect(squareIsInteresting(state, grid)).toBe(false);
  });
});

describe("becomeAware (mon-util.c become_aware, L711)", () => {
  it("is a no-op for a monster that is not camouflaged", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const mon = addMon(state, makeRace(), loc(12, 10));
    let msgs = 0;
    state.msg = () => {
      msgs++;
    };
    becomeAware(state, mon);
    expect(mon.mflag.has(MFLAG.CAMOUFLAGE)).toBe(false);
    expect(msgs).toBe(0);
  });

  it("clears MFLAG_CAMOUFLAGE and learns RF_UNAWARE into the race's lore", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const race = makeRace({ flags: [RF.UNAWARE] });
    const mon = addMon(state, race, loc(12, 10));
    mon.mflag.on(MFLAG.CAMOUFLAGE);

    becomeAware(state, mon);

    expect(mon.mflag.has(MFLAG.CAMOUFLAGE)).toBe(false);
    expect(getLore(state.lore, race).flags.has(RF.UNAWARE)).toBe(true);
  });

  it("does not learn RF_UNAWARE for a race that lacks the flag", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const race = makeRace();
    const mon = addMon(state, race, loc(12, 10));
    mon.mflag.on(MFLAG.CAMOUFLAGE);

    becomeAware(state, mon);

    expect(getLore(state.lore, race).flags.has(RF.UNAWARE)).toBe(false);
  });

  it("removes a mimicked floor object, breaks the mimicry link both ways, and messages when the square is seen", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const mon = addMon(state, makeRace(), loc(12, 10));
    mon.mflag.on(MFLAG.CAMOUFLAGE);
    mon.mimickedObj = 1; // any nonzero handle (mimic placement is not ported)
    const obj = makeObj(TV.SWORD);
    floorCarry(state, mon.grid, obj);
    obj.mimickingMIdx = mon.midx;
    lightAndView(state, mon.grid);

    const msgs: string[] = [];
    state.msg = (t) => msgs.push(t);

    becomeAware(state, mon);

    expect(mon.mflag.has(MFLAG.CAMOUFLAGE)).toBe(false);
    expect(mon.mimickedObj).toBe(0);
    expect(obj.mimickingMIdx).toBe(0);
    expect(floorPile(state, mon.grid)).not.toContain(obj);
    expect(msgs).toHaveLength(1);
    expect(msgs[0]).toMatch(/^The .+ was really a monster!$/);
  });

  it("still clears the mimicry link when the square is not seen, but sends no message", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const mon = addMon(state, makeRace(), loc(12, 10));
    mon.mflag.on(MFLAG.CAMOUFLAGE);
    mon.mimickedObj = 1;
    const obj = makeObj(TV.SWORD);
    floorCarry(state, mon.grid, obj);
    obj.mimickingMIdx = mon.midx;
    /* Not memorized/seen: squareIsSeen reads SQUARE.SEEN, left unset here. */

    const msgs: string[] = [];
    state.msg = (t) => msgs.push(t);

    becomeAware(state, mon);

    expect(mon.mimickedObj).toBe(0);
    expect(floorPile(state, mon.grid)).not.toContain(obj);
    expect(msgs).toHaveLength(0);
  });

  it("leaves mon.mimickedObj as-is when no floor object matches the handle (defensive, unreached in play)", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const mon = addMon(state, makeRace(), loc(12, 10));
    mon.mflag.on(MFLAG.CAMOUFLAGE);
    mon.mimickedObj = 1;

    becomeAware(state, mon);

    expect(mon.mflag.has(MFLAG.CAMOUFLAGE)).toBe(false);
    expect(mon.mimickedObj).toBe(1);
  });

  it("draws no RNG (rng.getState() is unchanged across a plain reveal and a mimic reveal)", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const mon = addMon(state, makeRace({ flags: [RF.UNAWARE] }), loc(12, 10));
    mon.mflag.on(MFLAG.CAMOUFLAGE);
    mon.mimickedObj = 1;
    const obj = makeObj(TV.SWORD);
    floorCarry(state, mon.grid, obj);
    obj.mimickingMIdx = mon.midx;
    lightAndView(state, mon.grid);

    const before = state.rng.getState();
    becomeAware(state, mon);
    expect(state.rng.getState()).toEqual(before);
  });

  it("RF_MIMIC_INV: gives the monster a copy of the object, still deletes the floor item, draws no RNG (mon-util.c L740-758)", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const mon = addMon(state, makeRace({ flags: [RF.MIMIC_INV] }), loc(12, 10));
    mon.mflag.on(MFLAG.CAMOUFLAGE);
    mon.mimickedObj = 1;
    const obj = makeObj(TV.SWORD);
    obj.pval = 7;
    floorCarry(state, mon.grid, obj);
    obj.mimickingMIdx = mon.midx;
    lightAndView(state, mon.grid);

    const before = state.rng.getState();
    becomeAware(state, mon);

    /* object_copy draws no RNG. */
    expect(state.rng.getState()).toEqual(before);
    /* The floor item is gone and the mimicry is cleared both ways. */
    expect(floorPile(state, mon.grid)).not.toContain(obj);
    expect(obj.mimickingMIdx).toBe(0);
    expect(mon.mimickedObj).toBe(0);
    /* The monster now holds an independent, value-equal copy. */
    expect(mon.heldObj).toHaveLength(1);
    const held = mon.heldObj[0]!;
    expect(held).not.toBe(obj);
    expect(held.kind).toBe(obj.kind);
    expect(held.pval).toBe(7);
    expect(held.heldMIdx).toBe(mon.midx);
    expect(held.mimickingMIdx).toBe(0);
  });

  it("does NOT give a copy when the race lacks RF_MIMIC_INV", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const mon = addMon(state, makeRace({ flags: [RF.UNAWARE] }), loc(12, 10));
    mon.mflag.on(MFLAG.CAMOUFLAGE);
    mon.mimickedObj = 1;
    const obj = makeObj(TV.SWORD);
    floorCarry(state, mon.grid, obj);
    obj.mimickingMIdx = mon.midx;
    lightAndView(state, mon.grid);

    becomeAware(state, mon);

    expect(floorPile(state, mon.grid)).not.toContain(obj);
    expect(mon.heldObj).toHaveLength(0);
  });
});
