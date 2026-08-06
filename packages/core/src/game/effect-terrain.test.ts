import { describe, expect, it } from "vitest";
import { EF, ELEM, FEAT, MON_TMD, RF, SQUARE, TMD } from "../generated/index.js";
import { distance, loc, locEq, locSum, DDGRID_DDD } from "../loc.js";
import {
  EffectRegistry,
  sourceMonster,
  sourcePlayer,
  sourceTrap,
} from "../effects/interpreter.js";
import type { EffectContext, EffectPlayer } from "../effects/interpreter.js";
import { registerCoreHandlers } from "../effects/handlers.js";
import { FLOOR, GRANITE, addMon, makeRace, makeState } from "./harness.js";
import type { GameState } from "./context.js";
import { basicPlayerActor } from "./project-cast.js";
import { attachGameEnv } from "./effect-game-env.js";
import type { GameEffectEnv } from "./effect-game-env.js";
import { floorCarry, floorPile } from "./floor.js";
import {
  knownFeat,
  knownObject,
  squareIsKnown,
  squareKnowPile,
  squareMemorize,
} from "./known.js";
import { objectNew } from "../obj/object.js";
import { OBJ_NOTICE } from "../obj/knowledge.js";
import { ArtifactState } from "../obj/make.js";
import type { Artifact, ObjectKind } from "../obj/types.js";
import { OptionState } from "../player/options.js";
import {
  lightRoom,
  registerTerrainHandlers,
  wizLightLevel,
} from "./effect-terrain.js";

function registry(): EffectRegistry {
  const r = new EffectRegistry();
  registerCoreHandlers(r);
  registerTerrainHandlers(r);
  return r;
}

/** A minimal player env backing the timed / damage sinks the handlers use. */
function playerEnv(state: GameState): EffectPlayer {
  const p = state.actor.player;
  return {
    timed: {
      timed: (i) => p.timed[i] ?? 0,
      setTimed: (i, v) => {
        p.timed[i] = v;
        return true;
      },
      incTimed: (i, v) => {
        p.timed[i] = (p.timed[i] ?? 0) + v;
        return true;
      },
      decTimed: (i, v) => {
        p.timed[i] = Math.max(0, (p.timed[i] ?? 0) - v);
        return true;
      },
      clearTimed: (i) => {
        p.timed[i] = 0;
        return true;
      },
    },
    applyDamageReduction: (dam) => dam,
    takeHit: (dam) => {
      p.chp -= dam;
    },
  };
}

function env(
  state: GameState,
  game: Partial<GameEffectEnv> = {},
  msgs?: string[],
): EffectContext {
  const base: EffectContext = {
    rng: state.rng,
    player: playerEnv(state),
    ...(msgs ? { messages: { msg: (t: string) => msgs.push(t) } } : {}),
  };
  return attachGameEnv(base, {
    state,
    cast: {
      projections: [],
      maxRange: 20,
      playerActor: basicPlayerActor(state),
    },
    ...game,
  });
}

/** Flag a rectangle as a room (like the generators do). */
function markRoom(state: GameState, x1: number, y1: number, x2: number, y2: number): void {
  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      state.chunk.sqinfoOn(loc(x, y), SQUARE.ROOM);
    }
  }
}

/** A synthetic floor object. */
let nextKidx = 900;
function makeObj(): ReturnType<typeof objectNew> {
  const kind = {
    kidx: nextKidx++,
    tval: 5,
    name: "Junk",
    base: { maxStack: 40 },
  } as unknown as ObjectKind;
  const obj = objectNew(kind);
  obj.number = 1;
  return obj;
}

describe("EF_RUBBLE (effect-handler-general.c L2939)", () => {
  it("drops rubble into the empty grids around the player", () => {
    const state = makeState({ playerGrid: loc(10, 10), seed: 3 });
    registry().effectSimple(EF.RUBBLE, env(state), { origin: sourcePlayer() });

    let rubble = 0;
    for (let d = 0; d < 8; d++) {
      const g = locSum(loc(10, 10), DDGRID_DDD[d]!);
      const feat = state.chunk.feat(g);
      if (feat === FEAT.RUBBLE || feat === FEAT.PASS_RUBBLE) rubble++;
    }
    expect(rubble).toBeGreaterThanOrEqual(1);
    expect(rubble).toBeLessThanOrEqual(3);
  });

  it("no-ops without a game env (worldless)", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    registry().effectSimple(
      EF.RUBBLE,
      { rng: state.rng },
      { origin: sourcePlayer() },
    );
    for (let d = 0; d < 8; d++) {
      const g = locSum(loc(10, 10), DDGRID_DDD[d]!);
      expect(state.chunk.isFloor(g)).toBe(true);
    }
  });
});

describe("EF_GRANITE (effect-handler-general.c L2991)", () => {
  it("raises a granite wall on the originating trap's grid", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    registry().effectSimple(EF.GRANITE, env(state), {
      origin: sourceTrap({ grid: loc(5, 5) }),
    });
    expect(state.chunk.isGranite(loc(5, 5))).toBe(true);
  });

  it("does nothing for a non-trap origin", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    registry().effectSimple(EF.GRANITE, env(state), {
      origin: sourcePlayer(),
    });
    expect(state.chunk.isFloor(loc(5, 5))).toBe(true);
  });
});

describe("EF_CREATE_STAIRS (effect-handler-general.c L1975)", () => {
  it("creates down stairs in town (depth 0 forces down)", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    state.chunk.depth = 0;
    const ran = registry().effectSimple(EF.CREATE_STAIRS, env(state), {
      origin: sourcePlayer(),
    });
    expect(ran).toBe(true);
    expect(state.chunk.isDownstairs(loc(10, 10))).toBe(true);
  });

  it("creates up stairs on the bottom level", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    state.chunk.depth = state.z.maxDepth - 1;
    registry().effectSimple(EF.CREATE_STAIRS, env(state), {
      origin: sourcePlayer(),
    });
    expect(state.chunk.isUpstairs(loc(10, 10))).toBe(true);
  });

  it("refuses a non-floor grid with its message", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    state.chunk.setFeat(loc(10, 10), FEAT.RUBBLE);
    const msgs: string[] = [];
    const ran = registry().effectSimple(EF.CREATE_STAIRS, env(state, {}, msgs), {
      origin: sourcePlayer(),
    });
    expect(ran).toBe(false);
    expect(msgs).toContain("There is no empty floor here.");
  });

  it("pushes objects off the grid first", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    state.chunk.depth = 0;
    floorCarry(state, loc(10, 10), makeObj());
    registry().effectSimple(EF.CREATE_STAIRS, env(state), {
      origin: sourcePlayer(),
    });
    expect(state.chunk.isStairs(loc(10, 10))).toBe(true);
    expect(state.floor.get(10 * state.chunk.width + 10) ?? []).toHaveLength(0);
  });

  it("refuses under birth_levels_persist (L1985-1989)", () => {
    /* A staircase conjured after generation is not in the level's join list,
     * so the neighbour it appears to lead to would be built with no matching
     * stair. Upstream refuses; the port only refused in arenas. */
    const state = makeState({ playerGrid: loc(10, 10) });
    state.chunk.depth = 5;
    state.options = new OptionState({
      overrides: { birth_levels_persist: true },
    });
    const msgs: string[] = [];
    const ran = registry().effectSimple(EF.CREATE_STAIRS, env(state, {}, msgs), {
      origin: sourcePlayer(),
    });
    expect(ran).toBe(false);
    expect(msgs).toContain("Nothing happens!");
    expect(state.chunk.isStairs(loc(10, 10))).toBe(false);
  });

  it("still works with the option OFF, on the same setup", () => {
    /* The control: without this the refusal above could be coming from
     * anything about the fixture. */
    const state = makeState({ playerGrid: loc(10, 10) });
    state.chunk.depth = 5;
    state.options = new OptionState({
      overrides: { birth_levels_persist: false },
    });
    const ran = registry().effectSimple(EF.CREATE_STAIRS, env(state), {
      origin: sourcePlayer(),
    });
    expect(ran).toBe(true);
    expect(state.chunk.isStairs(loc(10, 10))).toBe(true);
  });

  it.each([
    ["an arena", { arena: true, persist: false }],
    ["a persistent level", { arena: false, persist: true }],
  ])("reports the floor before refusing, on %s", (_name, { arena, persist }) => {
    /* effect-handler-general.c tests square_isfloor FIRST (L1979) and only
     * then the persist/arena refusal (L1985). The port had the two the other
     * way round, so a blocked grid IN AN ARENA - the one refusal it did
     * implement - named the wrong reason. */
    const state = makeState({ playerGrid: loc(10, 10) });
    state.chunk.depth = 5;
    state.chunk.setFeat(loc(10, 10), FEAT.RUBBLE);
    state.arenaLevel = arena;
    state.options = new OptionState({
      overrides: { birth_levels_persist: persist },
    });
    const msgs: string[] = [];
    registry().effectSimple(EF.CREATE_STAIRS, env(state, {}, msgs), {
      origin: sourcePlayer(),
    });
    expect(msgs).toContain("There is no empty floor here.");
    expect(msgs).not.toContain("Nothing happens!");
  });
});

describe("EF_LIGHT_AREA / EF_DARKEN_AREA (effect-handler-general.c L3026)", () => {
  it("lights the room around the player", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    markRoom(state, 8, 8, 14, 12);
    const msgs: string[] = [];
    registry().effectSimple(EF.LIGHT_AREA, env(state, {}, msgs), {
      origin: sourcePlayer(),
    });
    expect(msgs).toContain("You are surrounded by a white light.");
    expect(state.chunk.sqinfoHas(loc(8, 8), SQUARE.GLOW)).toBe(true);
    expect(state.chunk.sqinfoHas(loc(14, 12), SQUARE.GLOW)).toBe(true);
    /* Non-room grids stay dark. */
    expect(state.chunk.sqinfoHas(loc(20, 10), SQUARE.GLOW)).toBe(false);
  });

  it("lighting the room always wakes a sleeping smart monster", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    markRoom(state, 8, 8, 14, 12);
    const mon = addMon(state, makeRace({ flags: [RF.SMART] }), loc(12, 10));
    mon.mTimed[MON_TMD.SLEEP] = 100;
    lightRoom(state, loc(10, 10), true);
    expect(mon.mTimed[MON_TMD.SLEEP]).toBe(0);
  });

  it("darkens the room and blinds an unresisting player caster", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    markRoom(state, 8, 8, 14, 12);
    lightRoom(state, loc(10, 10), true);
    const msgs: string[] = [];
    registry().effectSimple(EF.DARKEN_AREA, env(state, {}, msgs), {
      origin: sourcePlayer(),
    });
    expect(msgs).toContain("Darkness surrounds you.");
    expect(state.chunk.sqinfoHas(loc(8, 8), SQUARE.GLOW)).toBe(false);
    const blind = state.actor.player.timed[TMD.BLIND] ?? 0;
    expect(blind).toBeGreaterThanOrEqual(4);
    expect(blind).toBeLessThanOrEqual(8);
  });

  it("a monster-cast darkness does not blind the player", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    markRoom(state, 8, 8, 14, 12);
    const mon = addMon(state, makeRace(), loc(12, 10));
    registry().effectSimple(EF.DARKEN_AREA, env(state), {
      origin: sourceMonster(mon.midx),
    });
    expect(state.actor.player.timed[TMD.BLIND] ?? 0).toBe(0);
  });

  it("a monster targeting another monster darkens that monster's room (5.4)", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    /* The victim's room, lit and away from the player. */
    markRoom(state, 14, 14, 18, 18);
    lightRoom(state, loc(16, 16), true);
    const victim = addMon(state, makeRace(), loc(16, 16));
    const caster = addMon(state, makeRace(), loc(12, 12));
    caster.target.midx = victim.midx;

    const msgs: string[] = [];
    registry().effectSimple(EF.DARKEN_AREA, env(state, {}, msgs), {
      origin: sourceMonster(caster.midx),
    });
    /* The victim's room goes dark, targeting it rather than the player. */
    expect(state.chunk.sqinfoHas(loc(16, 16), SQUARE.GLOW)).toBe(false);
    expect(msgs.some((m) => m.startsWith("Darkness surrounds the "))).toBe(true);
    expect(msgs).not.toContain("Darkness surrounds you.");
    expect(state.actor.player.timed[TMD.BLIND] ?? 0).toBe(0);
  });
});

describe("EF_LIGHT_LEVEL / EF_DARKEN_LEVEL (effect-handler-general.c L3003)", () => {
  it("lights the whole level, with the full-form message", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const msgs: string[] = [];
    registry().effectSimple(EF.LIGHT_LEVEL, env(state, {}, msgs), {
      origin: sourcePlayer(),
      diceString: "1",
    });
    expect(msgs).toContain(
      "An image of your surroundings forms in your mind...",
    );
    /* Every open grid (and its wall neighbours) glows. */
    expect(state.chunk.sqinfoHas(loc(3, 3), SQUARE.GLOW)).toBe(true);
    expect(state.chunk.sqinfoHas(loc(30, 20), SQUARE.GLOW)).toBe(true);
    expect(state.chunk.sqinfoHas(loc(1, 1), SQUARE.GLOW)).toBe(true);
  });

  it("darkens the whole level", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    wizLightLevel(state, true, true);
    const msgs: string[] = [];
    registry().effectSimple(EF.DARKEN_LEVEL, env(state, {}, msgs), {
      origin: sourcePlayer(),
      diceString: "1",
    });
    expect(msgs).toContain("A great blackness rolls through the dungeon...");
    expect(state.chunk.sqinfoHas(loc(3, 3), SQUARE.GLOW)).toBe(false);
    expect(state.chunk.sqinfoHas(loc(30, 20), SQUARE.GLOW)).toBe(false);
  });

  /*
   * wiz_light (cave-map.c:417-479) and wiz_dark (:490-546) are line-for-line
   * identical apart from sqinfo_on vs sqinfo_off of SQUARE_GLOW. Everything
   * below is a property only the C body has; each assertion was verified to
   * FAIL against the previous port body (which memorized unconditionally, had
   * no mark/forget pass, ignored `full`, and called a forgetMap() that has no
   * upstream counterpart).
   */
  describe("wiz_light / wiz_dark body (cave-map.c:417 / :490)", () => {
    /** A 3x3 granite block so its faces are non-floor neighbours. */
    const withWallBlock = (state: GameState): void => {
      for (let y = 4; y <= 6; y++) {
        for (let x = 4; x <= 6; x++) state.chunk.setFeat(loc(x, y), GRANITE);
      }
    };

    it("memorizes only non-floor neighbours, never plain floor (cave-map.c:439)", () => {
      const state = makeState({ playerGrid: loc(10, 10) });
      withWallBlock(state);
      wizLightLevel(state, true, true);
      /* The block's grids are non-floor: remembered. */
      expect(squareIsKnown(state, loc(4, 4))).toBe(true);
      /* Open floor away from any wall: lit but NOT remembered. */
      expect(state.chunk.sqinfoHas(loc(20, 12), SQUARE.GLOW)).toBe(true);
      expect(squareIsKnown(state, loc(20, 12))).toBe(false);
    });

    it("wiz_dark memorizes exactly as wiz_light does, only darkening (cave-map.c:508-513)", () => {
      const lit = makeState({ playerGrid: loc(10, 10) });
      const dark = makeState({ playerGrid: loc(10, 10) });
      withWallBlock(lit);
      withWallBlock(dark);
      wizLightLevel(lit, true, true);
      wizLightLevel(dark, false, true);
      /* Identical knowledge... */
      expect(Array.from(dark.known.feat)).toEqual(Array.from(lit.known.feat));
      expect(squareIsKnown(dark, loc(4, 4))).toBe(true);
      /* ...opposite lighting. */
      expect(dark.chunk.sqinfoHas(loc(20, 12), SQUARE.GLOW)).toBe(false);
      expect(lit.chunk.sqinfoHas(loc(20, 12), SQUARE.GLOW)).toBe(true);
    });

    it("forgets a misremembered grid this pass did not mark (cave-map.c:456-459)", () => {
      const state = makeState({ playerGrid: loc(10, 10) });
      const stale = loc(20, 12); // open floor, no wall neighbour
      /* Remember it as granite while the live grid is floor: memory is bad. */
      state.chunk.setFeat(stale, GRANITE);
      squareMemorize(state, stale);
      state.chunk.setFeat(stale, FLOOR);
      expect(squareIsKnown(state, stale)).toBe(true);

      wizLightLevel(state, true, true);

      /* Unmarked (plain floor, so never memorized/marked) and misremembered
       * -> square_forget. */
      expect(squareIsKnown(state, stale)).toBe(false);
    });

    it("refreshes a stale wall memory and clears MARK afterwards (cave-map.c:439-442 / :463-470)", () => {
      const state = makeState({ playerGrid: loc(10, 10) });
      withWallBlock(state);
      const face = loc(4, 4); // in the block, so non-floor: marked + memorized
      /* Seed a stale FLOOR memory of what is really granite. */
      state.chunk.setFeat(face, FLOOR);
      squareMemorize(state, face);
      state.chunk.setFeat(face, GRANITE);
      expect(knownFeat(state, face)).toBe(FLOOR);

      wizLightLevel(state, true, true);

      /* Marked and memorized by a neighbouring open grid's pass, so the memory
       * is refreshed rather than blanked. */
      expect(knownFeat(state, face)).toBe(GRANITE);
      /*
       * The unmark sweep leaves no MARK inside 1..h-2 / 1..w-2. This is
       * savefile-visible state (wr_dungeon_aux writes every SQUARE_* byte), so
       * a missing sweep would round-trip a stuck flag.
       *
       * NOTE: the `!square_ismark` half of the forget condition is provably
       * REDUNDANT in 4.2.6 - a grid is marked only where it is also memorized
       * (cave-map.c:441 sits inside the same if as :440's square_memorize), and
       * a just-memorized grid can never be square_ismemorybad. It is ported
       * anyway because core keeps the upstream body; only the sweep and the
       * forget pass itself are observable.
       */
      for (let y = 1; y < state.chunk.height - 1; y++) {
        for (let x = 1; x < state.chunk.width - 1; x++) {
          expect(state.chunk.sqinfoHas(loc(x, y), SQUARE.MARK)).toBe(false);
        }
      }
    });

    it("threads `full`: know_pile when full, sense_pile otherwise (cave-map.c:445-452)", () => {
      const full = makeState({ playerGrid: loc(10, 10) });
      const sensed = makeState({ playerGrid: loc(10, 10) });
      const grid = loc(20, 12);
      for (const st of [full, sensed]) floorCarry(st, grid, makeObj());
      wizLightLevel(full, true, true);
      wizLightLevel(sensed, true, false);
      /* square_know_pile records the KIND; square_sense_pile records the
       * "something is here" marker. */
      expect(knownObject(full, grid)?.seen).toBe(true);
      expect(knownObject(sensed, grid)).not.toBeNull();
      expect(knownObject(sensed, grid)?.seen).toBe(false);
    });

    it("wiz_dark senses/knows piles too - it is not a forget-everything", () => {
      const state = makeState({ playerGrid: loc(10, 10) });
      const grid = loc(20, 12);
      floorCarry(state, grid, makeObj());
      wizLightLevel(state, false, true);
      expect(knownObject(state, grid)?.seen).toBe(true);
    });

    it("isCurrentCave=false is glow-only (the `c != cave` guard, generate.c:1109)", () => {
      const state = makeState({ playerGrid: loc(10, 10) });
      withWallBlock(state);
      const grid = loc(20, 12);
      floorCarry(state, grid, makeObj());
      wizLightLevel(state, true, false, false);
      expect(state.chunk.sqinfoHas(grid, SQUARE.GLOW)).toBe(true);
      expect(squareIsKnown(state, loc(4, 4))).toBe(false);
      expect(knownObject(state, grid)).toBeNull();
    });

    it("draws no RNG", () => {
      const state = makeState({ playerGrid: loc(10, 10) });
      const before = state.rng.getState();
      wizLightLevel(state, true, true);
      wizLightLevel(state, false, false);
      expect(state.rng.getState()).toEqual(before);
    });
  });
});

describe("EF_DESTRUCTION (effect-handler-attack.c L1169)", () => {
  it("only shakes the ground in town", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    state.chunk.depth = 0;
    const mon = addMon(state, makeRace(), loc(12, 10));
    const msgs: string[] = [];
    registry().effectSimple(EF.DESTRUCTION, env(state, {}, msgs), {
      origin: sourcePlayer(),
      radius: 5,
    });
    expect(msgs).toContain("The ground shakes for a moment.");
    expect(state.monsters[mon.midx]).toBe(mon);
  });

  it("deletes monsters, destroys objects and rebuilds terrain in the circle", () => {
    const state = makeState({ playerGrid: loc(10, 10), seed: 7 });
    state.chunk.depth = 5;
    const near = addMon(state, makeRace(), loc(12, 10));
    const far = addMon(state, makeRace(), loc(25, 10));
    floorCarry(state, loc(9, 10), makeObj());
    state.chunk.setFeat(loc(11, 10), FEAT.LESS);

    registry().effectSimple(EF.DESTRUCTION, env(state), {
      origin: sourcePlayer(),
      radius: 5,
    });

    /* The nearby monster is deleted (not killed); the distant one lives. */
    expect(state.monsters[near.midx]).toBeNull();
    expect(state.monsters[far.midx]).toBe(far);
    /* Objects in the circle are destroyed. */
    expect(state.floor.get(10 * state.chunk.width + 9) ?? []).toHaveLength(0);
    /* Stairs survive; the terrain outside the circle is untouched. */
    expect(state.chunk.isStairs(loc(11, 10))).toBe(true);
    expect(state.chunk.isFloor(loc(25, 10))).toBe(true);
    /* The player's own grid is spared. */
    expect(state.chunk.isPassable(loc(10, 10))).toBe(true);
  });

  it("forgets every affected remembered square, including the spared player grid", () => {
    const state = makeState({ playerGrid: loc(10, 10), seed: 7 });
    state.chunk.depth = 5;
    const remembered: ReturnType<typeof loc>[] = [];
    for (let y = 7; y <= 13; y++) {
      for (let x = 7; x <= 13; x++) {
        const grid = loc(x, y);
        if (distance(state.actor.grid, grid) > 3) continue;
        squareMemorize(state, grid);
        remembered.push(grid);
      }
    }
    const spared = makeObj();
    floorCarry(state, state.actor.grid, spared);
    squareKnowPile(state, state.actor.grid);
    expect(remembered.every((grid) => squareIsKnown(state, grid))).toBe(true);
    expect(knownObject(state, state.actor.grid)).not.toBeNull();

    registry().effectSimple(EF.DESTRUCTION, env(state), {
      origin: sourcePlayer(),
      radius: 3,
    });

    expect(remembered.every((grid) => !squareIsKnown(state, grid))).toBe(true);
    /* square_forget (cave-square.c:1580) is terrain-only, so the remembered
     * pile on the spared player grid survives the *Destruction*
     * (effect-handler-attack.c:1206 forgets, :1210 `continue`s on the player
     * grid before touching objects). map_info's object loop (cave-map.c:155)
     * is not gated on square_isknown, so upstream still draws it. */
    expect(knownObject(state, state.actor.grid)).not.toBeNull();
    expect(floorPile(state, state.actor.grid)).toContain(spared);
  });

  it.each([
    { known: false, loseArts: false, staysCreated: false, history: 0 },
    { known: true, loseArts: false, staysCreated: true, history: 1 },
    { known: false, loseArts: true, staysCreated: true, history: 1 },
  ])(
    "updates the artifact registry before destruction (known=$known, birth_lose_arts=$loseArts)",
    ({ known, loseArts, staysCreated, history }) => {
      const state = makeState({ playerGrid: loc(10, 10), seed: 7 });
      state.chunk.depth = 5;
      state.options = new OptionState({
        overrides: { birth_lose_arts: loseArts },
      });
      state.artifacts = new ArtifactState(2);
      state.artifacts.markCreated(1, true);
      const art = { aidx: 1, name: "Test Artifact" } as Artifact;
      const obj = makeObj();
      obj.artifact = art;
      if (known) obj.notice |= OBJ_NOTICE.ASSESSED;
      const grid = loc(9, 10);
      floorCarry(state, grid, obj);
      const lost: Artifact[] = [];
      state.onArtifactLost = (lostArt) => lost.push(lostArt);

      registry().effectSimple(EF.DESTRUCTION, env(state), {
        origin: sourcePlayer(),
        radius: 2,
      });

      /* ArtifactState.isCreated is the registry gate makeArtifact uses before
       * allowing this fixed artifact to regenerate (obj/make.ts:954-955). */
      expect(state.artifacts.isCreated(art.aidx)).toBe(staysCreated);
      expect(lost).toHaveLength(history);
      expect(floorPile(state, grid)).toHaveLength(0);
    },
  );

  it("a light-subtype blast blinds an unresisting player", () => {
    const state = makeState({ playerGrid: loc(10, 10), seed: 7 });
    state.chunk.depth = 5;
    const msgs: string[] = [];
    registry().effectSimple(EF.DESTRUCTION, env(state, {}, msgs), {
      origin: sourcePlayer(),
      radius: 3,
      subtype: ELEM.LIGHT,
    });
    expect(msgs).toContain("There is a searing blast of light!");
    const blind = state.actor.player.timed[TMD.BLIND] ?? 0;
    expect(blind).toBeGreaterThanOrEqual(11);
    expect(blind).toBeLessThanOrEqual(20);
  });
});

describe("EF_EARTHQUAKE (effect-handler-attack.c L1290)", () => {
  it("only shakes the ground in town", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    state.chunk.depth = 0;
    const msgs: string[] = [];
    registry().effectSimple(EF.EARTHQUAKE, env(state, {}, msgs), {
      origin: sourcePlayer(),
      radius: 10,
    });
    expect(msgs).toContain("The ground shakes for a moment.");
    for (let x = 5; x <= 15; x++) {
      expect(state.chunk.isFloor(loc(x, 10))).toBe(true);
    }
  });

  it("shuffles terrain in the radius but never walls in the player", () => {
    const state = makeState({ playerGrid: loc(10, 10), seed: 11, w: 60, h: 40 });
    state.chunk.depth = 5;
    const msgs: string[] = [];
    registry().effectSimple(EF.EARTHQUAKE, env(state, {}, msgs), {
      origin: sourcePlayer(),
      radius: 10,
    });
    expect(msgs).toContain("The ground shakes! The ceiling caves in!");
    /* Some grids inside the radius turned to wall. */
    let walls = 0;
    for (let y = 1; y <= 20; y++) {
      for (let x = 1; x <= 20; x++) {
        if (state.chunk.isMineralWall(loc(x, y))) walls++;
      }
    }
    expect(walls).toBeGreaterThan(0);
    /* The player's grid is never buried. */
    expect(state.chunk.isPassable(state.actor.grid)).toBe(true);
  });

  it("hurts or displaces a player caught in the quake (seed sweep)", () => {
    let affected = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const state = makeState({ playerGrid: loc(12, 10), seed, w: 60, h: 40 });
      state.chunk.depth = 5;
      /* A monster epicentre two grids away can mark the player's grid. */
      const mon = addMon(state, makeRace(), loc(10, 10));
      registry().effectSimple(EF.EARTHQUAKE, env(state), {
        origin: sourceMonster(mon.midx),
        radius: 8,
      });
      const p = state.actor.player;
      if (p.chp < p.mhp || !locEq(state.actor.grid, loc(12, 10))) affected++;
      expect(state.chunk.isPassable(state.actor.grid)).toBe(true);
    }
    expect(affected).toBeGreaterThan(0);
  });

  it("buries or damages monsters on quaked grids (seed sweep)", () => {
    let harmed = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const state = makeState({ playerGrid: loc(25, 10), seed, w: 60, h: 40 });
      state.chunk.depth = 5;
      const mon = addMon(state, makeRace(), loc(11, 10));
      registry().effectSimple(EF.EARTHQUAKE, env(state), {
        origin: sourcePlayer(),
        radius: 15,
        y: 0,
        x: 0,
      });
      const live = state.monsters[mon.midx];
      if (!live || live.hp < live.maxhp) harmed++;
    }
    expect(harmed).toBeGreaterThan(0);
  });

  it("a KILL_WALL monster shrugs the quake off", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const state = makeState({ playerGrid: loc(25, 10), seed, w: 60, h: 40 });
      state.chunk.depth = 5;
      const mon = addMon(state, makeRace({ flags: [RF.KILL_WALL] }), loc(11, 10));
      registry().effectSimple(EF.EARTHQUAKE, env(state), {
        origin: sourcePlayer(),
        radius: 15,
      });
      expect(state.monsters[mon.midx]).toBe(mon);
      expect(mon.hp).toBe(mon.maxhp);
    }
  });
});
