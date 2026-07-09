import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EF, RF, SQUARE } from "../generated";
import {
  EffectRegistry,
  sourceMonster,
  sourcePlayer,
} from "../effects/interpreter";
import type { EffectContext } from "../effects/interpreter";
import { registerCoreHandlers } from "../effects/handlers";
import { distance, loc, locEq } from "../loc";
import { bindProjections } from "../world/projection";
import type { ProjectionRecordJson } from "../world/projection";
import { addMon, makeState, makeRace, monReg } from "./harness";
import type { GameState } from "./context";
import { basicPlayerActor } from "./project-cast";
import { attachGameEnv } from "./effect-game-env";
import type { GameEffectEnv } from "./effect-game-env";
import {
  chooseTeleportDestination,
  registerTeleportHandlers,
  teleportMonster,
} from "./effect-teleport";

const projections = bindProjections(
  JSON.parse(
    readFileSync(
      new URL("../../../content/pack/projection.json", import.meta.url),
      "utf8",
    ),
  ).records as ProjectionRecordJson[],
);

const plainRace = monReg.races.find(
  (r) => r.rarity > 0 && !r.flags.has(RF.UNIQUE),
)!;

function registry(): EffectRegistry {
  const r = new EffectRegistry();
  registerCoreHandlers(r);
  registerTeleportHandlers(r);
  return r;
}

function env(
  state: GameState,
  game: Partial<GameEffectEnv> = {},
  msgs?: string[],
): EffectContext {
  const base: EffectContext = msgs
    ? { rng: state.rng, messages: { msg: (t) => msgs.push(t) } }
    : { rng: state.rng };
  return attachGameEnv(base, {
    state,
    cast: { projections, maxRange: 20, playerActor: basicPlayerActor(state) },
    ...game,
  });
}

describe("EF_TELEPORT", () => {
  it("moves the player to a distinct, legal grid and fires the post-move hook", () => {
    const start = loc(20, 12);
    const state = makeState({ playerGrid: start, seed: 7 });
    let postMove: boolean | null = null;
    registry().effectSimple(
      EF.TELEPORT,
      env(state, { teleport: { onPlayerPostMove: (m) => (postMove = m) } }),
      { origin: sourcePlayer(), diceString: "10" },
    );
    expect(locEq(state.actor.grid, start)).toBe(false);
    expect(state.chunk.isPassable(state.actor.grid)).toBe(true);
    expect(distance(state.actor.grid, start)).toBeGreaterThan(0);
    expect(postMove).toBe(false);
  });

  it("is deterministic for a fixed seed", () => {
    const dest = (): string => {
      const s = makeState({ playerGrid: loc(20, 12), seed: 42 });
      registry().effectSimple(EF.TELEPORT, env(s), {
        origin: sourcePlayer(),
        diceString: "10",
      });
      return `${s.actor.grid.x},${s.actor.grid.y}`;
    };
    expect(dest()).toBe(dest());
  });

  it("forbids a long teleport from a no-teleport grid", () => {
    const start = loc(20, 12);
    const state = makeState({ playerGrid: start });
    state.chunk.sqinfoOn(start, SQUARE.NO_TELEPORT);
    const msgs: string[] = [];
    registry().effectSimple(EF.TELEPORT, env(state, {}, msgs), {
      origin: sourcePlayer(),
      diceString: "20",
    });
    expect(locEq(state.actor.grid, start)).toBe(true);
    expect(msgs).toContain("Teleportation forbidden!");
  });

  it("forbids teleport with a no-teleport curse and learns it", () => {
    const start = loc(20, 12);
    const state = makeState({ playerGrid: start });
    let learned = false;
    registry().effectSimple(
      EF.TELEPORT,
      env(state, {
        teleport: { hasNoTeleport: true, onLearnNoTeleport: () => (learned = true) },
      }),
      { origin: sourcePlayer(), diceString: "10" },
    );
    expect(locEq(state.actor.grid, start)).toBe(true);
    expect(learned).toBe(true);
  });

  it("no-ops without a game env (worldless)", () => {
    const start = loc(20, 12);
    const state = makeState({ playerGrid: start });
    registry().effectSimple(
      EF.TELEPORT,
      { rng: state.rng },
      { origin: sourcePlayer(), diceString: "10" },
    );
    expect(locEq(state.actor.grid, start)).toBe(true);
  });

  it("teleports a monster (self-cast) without moving the player", () => {
    const pgrid = loc(20, 12);
    const state = makeState({ playerGrid: pgrid, seed: 3 });
    const mon = addMon(state, plainRace, loc(10, 10), { hp: 30 });
    const from = mon.grid;
    let movedMidx = -1;
    registry().effectSimple(
      EF.TELEPORT,
      env(state, { teleport: { onMonsterPostMove: (m) => (movedMidx = m) } }),
      { origin: sourceMonster(mon.midx), diceString: "10" },
    );
    expect(locEq(mon.grid, from)).toBe(false);
    expect(locEq(state.actor.grid, pgrid)).toBe(true);
    expect(movedMidx).toBe(mon.midx);
    expect(state.chunk.mon(mon.grid)).toBe(mon.midx);
  });
});

describe("EF_TELEPORT_TO", () => {
  it("lands the player at the chosen aim (Dimension Door)", () => {
    const state = makeState({ playerGrid: loc(20, 12) });
    const target = loc(10, 8);
    registry().effectSimple(
      EF.TELEPORT_TO,
      env(state, { teleport: { getAimTarget: () => target } }),
      { origin: sourcePlayer() },
    );
    expect(locEq(state.actor.grid, target)).toBe(true);
  });

  it("returns false when the aim prompt is cancelled", () => {
    const start = loc(20, 12);
    const state = makeState({ playerGrid: start });
    const ran = registry().effectSimple(
      EF.TELEPORT_TO,
      env(state, { teleport: { getAimTarget: () => null } }),
      { origin: sourcePlayer() },
    );
    expect(ran).toBe(false);
    expect(locEq(state.actor.grid, start)).toBe(true);
  });

  it("is forbidden from a no-teleport grid", () => {
    const start = loc(20, 12);
    const state = makeState({ playerGrid: start });
    state.chunk.sqinfoOn(start, SQUARE.NO_TELEPORT);
    const msgs: string[] = [];
    registry().effectSimple(
      EF.TELEPORT_TO,
      env(state, { teleport: { getAimTarget: () => loc(10, 8) } }, msgs),
      { origin: sourcePlayer() },
    );
    expect(locEq(state.actor.grid, start)).toBe(true);
    expect(msgs).toContain("Teleportation forbidden!");
  });
});

describe("EF_TELEPORT_LEVEL", () => {
  it("in the town can only sink one level", () => {
    const state = makeState();
    state.chunk.depth = 0;
    let changed: number | null = null;
    const msgs: string[] = [];
    registry().effectSimple(
      EF.TELEPORT_LEVEL,
      env(state, { teleport: { changeLevel: (d) => (changed = d) } }, msgs),
      { origin: sourcePlayer() },
    );
    expect(changed).toBe(1);
    expect(msgs).toContain("You sink through the floor.");
  });

  it("at the dungeon bottom can only rise", () => {
    const state = makeState();
    state.chunk.depth = 127;
    let changed: number | null = null;
    const msgs: string[] = [];
    registry().effectSimple(
      EF.TELEPORT_LEVEL,
      env(
        state,
        { teleport: { changeLevel: (d) => (changed = d), maxDepth: 128 } },
        msgs,
      ),
      { origin: sourcePlayer() },
    );
    expect(changed).toBe(126);
    expect(msgs).toContain("You rise up through the ceiling.");
  });

  it("a hostile teleport-level is resisted with nexus resistance", () => {
    const state = makeState();
    state.chunk.depth = 10;
    const mon = addMon(state, plainRace, loc(10, 10), { hp: 30 });
    let changed = false;
    const msgs: string[] = [];
    registry().effectSimple(
      EF.TELEPORT_LEVEL,
      env(
        state,
        { teleport: { resistsNexus: true, changeLevel: () => (changed = true) } },
        msgs,
      ),
      { origin: sourceMonster(mon.midx) },
    );
    expect(changed).toBe(false);
    expect(msgs).toContain("You resist the effect!");
  });
});

describe("chooseTeleportDestination", () => {
  it("avoids vault grids when a non-vault landing exists", () => {
    const state = makeState({ playerGrid: loc(20, 12), seed: 5 });
    /* Mark the near half of the map as vault; the far half stays open. */
    for (let y = 1; y < state.chunk.height - 1; y++) {
      for (let x = 1; x < 20; x++) state.chunk.sqinfoOn(loc(x, y), SQUARE.VAULT);
    }
    for (let i = 0; i < 20; i++) {
      const s = makeState({ playerGrid: loc(20, 12), seed: i });
      for (let y = 1; y < s.chunk.height - 1; y++) {
        for (let x = 1; x < 20; x++) s.chunk.sqinfoOn(loc(x, y), SQUARE.VAULT);
      }
      const dest = chooseTeleportDestination(s, loc(20, 12), 8, 0, true, {});
      expect(dest).not.toBeNull();
      expect(s.chunk.sqinfoHas(dest!, SQUARE.VAULT)).toBe(false);
    }
  });

  it("returns a grid near the requested distance", () => {
    const state = makeState({ playerGrid: loc(20, 12), seed: 11 });
    const dest = chooseTeleportDestination(state, loc(20, 12), 6, 0, true, {});
    expect(dest).not.toBeNull();
    /* The scorer minimises |distance - want|; the jitter keeps it close. */
    expect(distance(dest!, loc(20, 12))).toBeGreaterThan(1);
  });
});

describe("teleportMonster (project_m backing)", () => {
  it("moves the monster to a legal grid and fires the hook", () => {
    const state = makeState({ playerGrid: loc(20, 12), seed: 9 });
    const mon = addMon(state, plainRace, loc(10, 10), { hp: 30 });
    const from = mon.grid;
    let movedMidx = -1;
    teleportMonster(state, mon.midx, 8, { onMonsterPostMove: (m) => (movedMidx = m) });
    expect(locEq(mon.grid, from)).toBe(false);
    expect(state.chunk.isMonsterWalkable(mon.grid)).toBe(true);
    expect(state.chunk.mon(mon.grid)).toBe(mon.midx);
    expect(movedMidx).toBe(mon.midx);
  });
});
