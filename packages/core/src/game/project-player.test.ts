import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PROJ, TMD } from "../generated";
import { loc } from "../loc";
import { Rng } from "../rng";
import { TMD_MAX } from "../player/types";
import { bindProjections } from "../world/projection";
import type { ProjectionRecordJson } from "../world/projection";
import { projectPlayer } from "./project-player";
import type {
  PlayerProjActor,
  ProjectPlayerCtx,
  ProjectPlayerHooks,
  ProjectPlayerSource,
} from "./project-player";

const projections = bindProjections(
  JSON.parse(
    readFileSync(
      new URL("../../../content/pack/projection.json", import.meta.url),
      "utf8",
    ),
  ).records as ProjectionRecordJson[],
);

const PLAYER_GRID = loc(5, 5);

function actor(overrides: Partial<PlayerProjActor> = {}): PlayerProjActor {
  return {
    chp: 100,
    mhp: 100,
    lev: 10,
    isDead: false,
    timed: new Int16Array(TMD_MAX),
    hitpointWarn: 3,
    resistLevel: () => 0,
    reduction: { damRed: 0, percDamRed: 0 },
    minusAc: () => false,
    ...overrides,
  };
}

const monsterSource: ProjectPlayerSource = {
  isPlayer: false,
  isMonster: true,
  monsterVisible: true,
  killer: "an orc",
};

function ctx(
  a: PlayerProjActor,
  hooks: ProjectPlayerHooks = {},
  origin: ProjectPlayerSource = monsterSource,
  power = 0,
): ProjectPlayerCtx {
  return {
    rng: new Rng(1),
    actor: a,
    playerGrid: PLAYER_GRID,
    projections,
    origin,
    power,
    hooks,
  };
}

describe("projectPlayer - gating", () => {
  it("returns false when the player is not in the grid", () => {
    const a = actor();
    const res = projectPlayer(ctx(a), 0, loc(6, 6), 50, PROJ.FIRE, false);
    expect(res).toBe(false);
    expect(a.chp).toBe(100);
  });

  it("does not affect the projecting player unless self is set", () => {
    const a = actor();
    const playerSrc: ProjectPlayerSource = {
      isPlayer: true,
      isMonster: false,
      killer: "yourself",
    };
    const res = projectPlayer(ctx(a, {}, playerSrc), 0, PLAYER_GRID, 50, PROJ.FIRE, false);
    expect(res).toBe(false);
    expect(a.chp).toBe(100);
  });
});

describe("projectPlayer - damage", () => {
  it("applies unresisted damage", () => {
    const a = actor();
    projectPlayer(ctx(a), 0, PLAYER_GRID, 40, PROJ.FIRE, false);
    expect(a.chp).toBe(60);
  });

  it("deals no damage to an immune player", () => {
    const a = actor({ resistLevel: (t) => (t === PROJ.FIRE ? 3 : 0) });
    projectPlayer(ctx(a), 0, PLAYER_GRID, 40, PROJ.FIRE, false);
    expect(a.chp).toBe(100);
  });

  it("scales self-inflicted damage down by ten", () => {
    const a = actor();
    const playerSrc: ProjectPlayerSource = {
      isPlayer: true,
      isMonster: false,
      killer: "yourself",
    };
    projectPlayer(ctx(a, {}, playerSrc), 0, PLAYER_GRID, 50, PROJ.FIRE, true);
    expect(a.chp).toBe(95); /* 50 / 10 = 5 */
  });

  it("applies the player's damage reduction", () => {
    const a = actor({ reduction: { damRed: 10, percDamRed: 0 } });
    projectPlayer(ctx(a), 0, PLAYER_GRID, 40, PROJ.FIRE, false);
    expect(a.chp).toBe(70); /* 40 - 10 = 30 */
  });

  it("kills the player and runs the take_hit death hook", () => {
    const a = actor({ chp: 10 });
    let died = 0;
    projectPlayer(ctx(a, { takeHit: { onDeath: () => died++ } }), 0, PLAYER_GRID, 40, PROJ.FIRE, false);
    expect(a.isDead).toBe(true);
    expect(died).toBe(1);
  });
});

describe("projectPlayer - messages and side effects", () => {
  it("announces a blind hit with the projection's blind description", () => {
    const a = actor();
    a.timed[TMD.BLIND] = 10;
    const messages: string[] = [];
    projectPlayer(ctx(a, { message: (t) => messages.push(t) }), 0, PLAYER_GRID, 40, PROJ.FIRE, false);
    expect(messages.some((m) => m.startsWith("You are hit by"))).toBe(true);
  });

  it("applies extra damage returned by the side-effect hook", () => {
    const a = actor();
    projectPlayer(
      ctx(a, { onSideEffects: () => 15 }),
      0,
      PLAYER_GRID,
      40,
      PROJ.FIRE,
      false,
    );
    expect(a.chp).toBe(45); /* 100 - 40 base - 15 extra */
  });

  it("passes the adjusted damage and power to the side-effect hook", () => {
    const a = actor();
    let seenDam = -1;
    let seenPower = -1;
    projectPlayer(
      ctx(
        a,
        {
          onSideEffects: (c) => {
            seenDam = c.dam;
            seenPower = c.power;
            return 0;
          },
        },
        monsterSource,
        80,
      ),
      0,
      PLAYER_GRID,
      40,
      PROJ.FIRE,
      false,
    );
    expect(seenDam).toBe(40);
    expect(seenPower).toBe(80);
  });
});

describe("projectPlayer - smart learn (update_smart_learn, project-player.c L852)", () => {
  it("teaches a monster source the player's resist to the projection type", () => {
    const a = actor();
    const learned: number[] = [];
    projectPlayer(
      ctx(a, { smartLearn: (typ) => learned.push(typ) }),
      0,
      PLAYER_GRID,
      40,
      PROJ.FIRE,
      false,
    );
    expect(learned).toEqual([PROJ.FIRE]);
  });

  it("still fires when the player is immune (before the damage gate, C L852 < L895)", () => {
    const a = actor({ resistLevel: (t) => (t === PROJ.FIRE ? 3 : 0) });
    const learned: number[] = [];
    projectPlayer(
      ctx(a, { smartLearn: (typ) => learned.push(typ) }),
      0,
      PLAYER_GRID,
      40,
      PROJ.FIRE,
      false,
    );
    expect(a.chp).toBe(100); /* immune: no damage */
    expect(learned).toEqual([PROJ.FIRE]); /* but the monster still learns */
  });

  it("does not fire for a player-source projection (only SRC_MONSTER, C L841)", () => {
    const a = actor();
    const playerSrc: ProjectPlayerSource = {
      isPlayer: true,
      isMonster: false,
      killer: "yourself",
    };
    const learned: number[] = [];
    projectPlayer(
      ctx(a, { smartLearn: (typ) => learned.push(typ) }, playerSrc),
      0,
      PLAYER_GRID,
      50,
      PROJ.FIRE,
      true,
    );
    expect(learned).toEqual([]);
  });
});
