import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MFLAG, MON_TMD, PROJ, RF } from "../generated";
import { loc } from "../loc";
import type { Monster } from "../mon/monster";
import { PROJECT } from "../world/project";
import { bindProjections } from "../world/projection";
import type { ProjectionRecordJson } from "../world/projection";
import { addMon, makeState, monReg } from "./harness";
import { projectMonster } from "./project-monster";
import type { ProjectMonsterCtx, ProjectMonsterHooks } from "./project-monster";
import type { GameState } from "./context";

const projections = bindProjections(
  JSON.parse(
    readFileSync(
      new URL("../../../content/pack/projection.json", import.meta.url),
      "utf8",
    ),
  ).records as ProjectionRecordJson[],
);

/** A non-unique race lacking fire immunity / vulnerability, for clean damage. */
const plainRace = monReg.races.find(
  (r) =>
    r.rarity > 0 &&
    !r.flags.has(RF.UNIQUE) &&
    !r.flags.has(RF.IM_FIRE) &&
    !r.flags.has(RF.HURT_FIRE) &&
    !r.flags.has(RF.NO_FEAR),
)!;

function recorder(extra: Partial<ProjectMonsterHooks> = {}) {
  const state = {
    messages: [] as Array<{ mon: Monster; msg: number }>,
    kills: 0,
    monsterDeaths: 0,
    teleports: [] as Array<{ distance: number }>,
    thrusts: 0,
    updates: 0,
  };
  const hooks: ProjectMonsterHooks = {
    message: (mon, msg) => state.messages.push({ mon, msg }),
    onKill: () => state.kills++,
    onMonsterDeath: () => state.monsterDeaths++,
    teleport: (_m, distance) => state.teleports.push({ distance }),
    thrustAway: () => state.thrusts++,
    onUpdate: () => state.updates++,
    ...extra,
  };
  return { hooks, state };
}

/** Build a driver context for a player-sourced projection. */
function playerCtx(
  gs: GameState,
  hooks: ProjectMonsterHooks,
): ProjectMonsterCtx {
  return {
    state: gs,
    projections,
    origin: { isPlayer: true, monster: 0, grid: gs.actor.grid, charm: false },
    hooks,
  };
}

describe("projectMonster - gating", () => {
  it("misses a grid with no monster", () => {
    const gs = makeState();
    const rec = recorder();
    const res = projectMonster(playerCtx(gs, rec.hooks), 0, loc(5, 5), 20, PROJ.FIRE, PROJECT.KILL);
    expect(res.didHit).toBe(false);
  });

  it("misses an impassable (wall) grid", () => {
    const gs = makeState();
    const rec = recorder();
    /* (0,0) is granite border. */
    const res = projectMonster(playerCtx(gs, rec.hooks), 0, loc(0, 0), 20, PROJ.FIRE, PROJECT.KILL);
    expect(res.didHit).toBe(false);
  });

  it("never affects the projecting monster", () => {
    const gs = makeState();
    const caster = addMon(gs, plainRace, loc(6, 6), { hp: 50 });
    const rec = recorder();
    const pctx: ProjectMonsterCtx = {
      state: gs,
      projections,
      origin: { isPlayer: false, monster: caster.midx, grid: caster.grid, charm: false },
      hooks: rec.hooks,
    };
    const res = projectMonster(pctx, 0, loc(6, 6), 20, PROJ.FIRE, PROJECT.KILL);
    expect(res.didHit).toBe(false);
    expect(caster.hp).toBe(50);
  });
});

describe("projectMonster - player damage", () => {
  it("damages a monster and reports a hit", () => {
    const gs = makeState();
    const mon = addMon(gs, plainRace, loc(7, 7), { hp: 50 });
    const rec = recorder();
    const res = projectMonster(playerCtx(gs, rec.hooks), 0, loc(7, 7), 20, PROJ.FIRE, PROJECT.KILL);
    expect(res.didHit).toBe(true);
    expect(mon.hp).toBe(30);
  });

  it("kills a monster, runs onKill, and removes it from the level", () => {
    const gs = makeState();
    const mon = addMon(gs, plainRace, loc(8, 8), { hp: 10 });
    const idx = mon.midx;
    const rec = recorder();
    const res = projectMonster(playerCtx(gs, rec.hooks), 0, loc(8, 8), 40, PROJ.FIRE, PROJECT.KILL);
    expect(res.didHit).toBe(true);
    expect(rec.state.kills).toBe(1);
    expect(gs.monsters[idx]).toBeNull();
    expect(gs.chunk.mon(loc(8, 8))).toBe(0);
  });
});

describe("projectMonster - status and side effects", () => {
  it("applies a stun timer without dealing damage (MON_STUN)", () => {
    const gs = makeState();
    const mon = addMon(gs, plainRace, loc(9, 9), { hp: 50 });
    const rec = recorder();
    projectMonster(playerCtx(gs, rec.hooks), 0, loc(9, 9), 8, PROJ.MON_STUN, PROJECT.KILL);
    expect(mon.hp).toBe(50); /* no damage */
    expect(mon.mTimed[MON_TMD.STUN]).toBeGreaterThan(0);
  });

  it("teleports via the hook for AWAY_ALL, dealing no damage", () => {
    const gs = makeState();
    const mon = addMon(gs, plainRace, loc(10, 10), { hp: 50 });
    const rec = recorder();
    projectMonster(playerCtx(gs, rec.hooks), 0, loc(10, 10), 25, PROJ.AWAY_ALL, PROJECT.KILL);
    expect(mon.hp).toBe(50);
    expect(rec.state.teleports).toEqual([{ distance: 25 }]);
  });

  it("requests a thrust for PROJ_FORCE against a non-breather", () => {
    const gs = makeState();
    addMon(gs, plainRace, loc(11, 11), { hp: 100 });
    const rec = recorder();
    projectMonster(playerCtx(gs, rec.hooks), 0, loc(11, 11), 40, PROJ.FORCE, PROJECT.KILL);
    expect(rec.state.thrusts).toBe(1);
  });

  it("skips a monster that resists a hurt-only projection (LIGHT_WEAK)", () => {
    const gs = makeState();
    const mon = addMon(gs, plainRace, loc(12, 12), { hp: 50 });
    const rec = recorder();
    /* plainRace has no HURT_LIGHT -> hurt_only zeroes damage -> not skipped,
     * but LIGHT_WEAK deals 0. Use a truly skipped case: SLEEP_UNDEAD on a
     * non-undead sets skipped. */
    const res = projectMonster(
      playerCtx(gs, rec.hooks),
      0,
      loc(12, 12),
      10,
      PROJ.SLEEP_UNDEAD,
      PROJECT.KILL,
    );
    expect(res.didHit).toBe(false);
    expect(mon.mTimed[MON_TMD.SLEEP]).toBe(0);
  });
});

describe("projectMonster - monster source", () => {
  it("kills another monster and runs onMonsterDeath (not onKill)", () => {
    const gs = makeState();
    const caster = addMon(gs, plainRace, loc(5, 5), { hp: 50 });
    const victim = addMon(gs, plainRace, loc(6, 6), { hp: 10 });
    const vidx = victim.midx;
    const rec = recorder();
    const pctx: ProjectMonsterCtx = {
      state: gs,
      projections,
      origin: { isPlayer: false, monster: caster.midx, grid: caster.grid, charm: false },
      hooks: rec.hooks,
    };
    const res = projectMonster(pctx, 0, loc(6, 6), 40, PROJ.FIRE, PROJECT.KILL);
    expect(res.didHit).toBe(true);
    expect(rec.state.monsterDeaths).toBe(1);
    expect(rec.state.kills).toBe(0);
    expect(gs.monsters[vidx]).toBeNull();
  });

  it("caps monster-vs-monster damage on an arena level (6.10)", () => {
    /* project-mon.c L1044: on an arena level a non-player attack can only
     * reduce a monster to 0 hp, never kill it (as for uniques). */
    const gs = makeState();
    gs.arenaLevel = true;
    const caster = addMon(gs, plainRace, loc(5, 5), { hp: 50 });
    const victim = addMon(gs, plainRace, loc(6, 6), { hp: 10 });
    const vidx = victim.midx;
    const rec = recorder();
    const pctx: ProjectMonsterCtx = {
      state: gs,
      projections,
      origin: { isPlayer: false, monster: caster.midx, grid: caster.grid, charm: false },
      hooks: rec.hooks,
    };
    const res = projectMonster(pctx, 0, loc(6, 6), 40, PROJ.FIRE, PROJECT.KILL);
    expect(res.didHit).toBe(true);
    expect(rec.state.monsterDeaths).toBe(0);
    expect(gs.monsters[vidx]).not.toBeNull();
    expect(victim.hp).toBe(0);
  });

  it("does not kill a same-race breather target under PROJECT_SAFE", () => {
    const gs = makeState();
    const caster = addMon(gs, plainRace, loc(5, 5), { hp: 50 });
    const ally = addMon(gs, plainRace, loc(6, 6), { hp: 10 });
    const rec = recorder();
    const pctx: ProjectMonsterCtx = {
      state: gs,
      projections,
      origin: { isPlayer: false, monster: caster.midx, grid: caster.grid, charm: false },
      hooks: rec.hooks,
    };
    const res = projectMonster(pctx, 0, loc(6, 6), 40, PROJ.FIRE, PROJECT.KILL | PROJECT.SAFE);
    expect(res.didHit).toBe(false);
    expect(ally.hp).toBe(10);
  });
});

describe("projectMonster - obvious / wake", () => {
  it("wakes a sleeping monster hit by a waking projection", () => {
    const gs = makeState();
    const mon = addMon(gs, plainRace, loc(13, 13), { hp: 50 });
    mon.mTimed[MON_TMD.SLEEP] = 20;
    mon.mflag.on(MFLAG.VISIBLE);
    const rec = recorder();
    projectMonster(playerCtx(gs, rec.hooks), 0, loc(13, 13), 20, PROJ.FIRE, PROJECT.KILL);
    expect(mon.mTimed[MON_TMD.SLEEP]).toBe(0);
  });
});

describe("projectMonster - become_aware (mimic reveal)", () => {
  it("reveals a camouflaged monster hit by player damage (mon_take_hit's becomeAware)", () => {
    const gs = makeState();
    const mon = addMon(gs, plainRace, loc(16, 16), { hp: 50 });
    mon.mflag.on(MFLAG.CAMOUFLAGE);
    let revealed: Monster | null = null;
    const rec = recorder({ becomeAware: (m) => { revealed = m; } });
    projectMonster(playerCtx(gs, rec.hooks), 0, loc(16, 16), 20, PROJ.FIRE, PROJECT.KILL);
    expect(revealed).toBe(mon);
    expect(mon.hp).toBe(30);
  });

  it("reveals a camouflaged in-view monster that stops an effect (PROJECT_STOP), even with no damage", () => {
    const gs = makeState();
    const mon = addMon(gs, plainRace, loc(14, 14), { hp: 50 });
    mon.mflag.on(MFLAG.CAMOUFLAGE);
    mon.mflag.on(MFLAG.VIEW);
    let revealed: Monster | null = null;
    const rec = recorder({ becomeAware: (m) => { revealed = m; } });
    projectMonster(
      playerCtx(gs, rec.hooks),
      0,
      loc(14, 14),
      0,
      PROJ.FIRE,
      PROJECT.KILL | PROJECT.STOP,
    );
    expect(revealed).toBe(mon);
    expect(mon.hp).toBe(50);
  });

  it("does not call becomeAware for a normal (non-camouflaged) monster", () => {
    const gs = makeState();
    const mon = addMon(gs, plainRace, loc(15, 15), { hp: 50 });
    let called = false;
    const rec = recorder({ becomeAware: () => { called = true; } });
    projectMonster(playerCtx(gs, rec.hooks), 0, loc(15, 15), 20, PROJ.FIRE, PROJECT.KILL);
    expect(mon.hp).toBe(30);
    expect(called).toBe(false);
  });
});
