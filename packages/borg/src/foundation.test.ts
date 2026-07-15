/**
 * Foundation tests (P8.0): prove the Borg seam works end-to-end against the
 * frozen agent contract via the scenario harness - perception folds the view
 * into the world model, the controller advances the clock and drives commands,
 * the private RNG is isolated and reproducible, and level changes wipe memory.
 * These guard the substrate the bulk subsystems (P8.1-P8.7) build on.
 */

import { describe, expect, it } from "vitest";
import { createBorg } from "./controller";
import { perceive, makePerceiveMemo } from "./perceive";
import { BorgWorld } from "./world/model";
import { makeScenarioView, makeFakeActions } from "./harness";
import { makeBorgRng, reseedBorgRng, BORG_LOCAL_SEED } from "./rng";
import { keypadDir, distance } from "./think";

describe("world model + perception", () => {
  it("folds the player, map, monsters, and floor into the world model", () => {
    const world = new BorgWorld();
    const memo = makePerceiveMemo();
    const view = makeScenarioView({
      player: { grid: { x: 5, y: 5 }, depth: 3 },
      monsters: [{ grid: { x: 8, y: 5 }, raceIndex: 42, hp: 7, maxHp: 10 }],
      floor: { "6,5": [{ tval: 5 } as never] },
    });

    perceive(world, view, memo);

    expect(world.self.c).toEqual({ x: 5, y: 5 });
    expect(world.facts.depth).toBe(3);
    // Monster tracked and back-linked on its grid.
    const kills = [...world.kills.entries()];
    expect(kills).toHaveLength(1);
    expect(kills[0]![1].rIdx).toBe(42);
    expect(kills[0]![1].injury).toBe(30); // (10-7)/10 * 100
    expect(world.map.at(8, 5).kill).toBe(kills[0]![0]);
    // Floor object tracked and back-linked.
    const takes = [...world.takes.entries()];
    expect(takes).toHaveLength(1);
    expect(takes[0]![1].tval).toBe(5);
    expect(world.map.at(6, 5).take).toBe(takes[0]![0]);
    // The player's grid is marked observed.
    expect(world.map.at(5, 5).info & 0x01).toBe(0x01); // BORG_MARK
  });

  it("wipes remembered state when the depth changes (level change)", () => {
    const world = new BorgWorld();
    const memo = makePerceiveMemo();
    perceive(
      world,
      makeScenarioView({
        player: { depth: 1 },
        monsters: [{ grid: { x: 8, y: 5 } }],
      }),
      memo,
    );
    expect([...world.kills.entries()]).toHaveLength(1);

    // Descend: a new level with no monsters -> old memory gone.
    perceive(world, makeScenarioView({ player: { depth: 2 } }), memo);
    expect([...world.kills.entries()]).toHaveLength(0);
    expect(world.facts.depth).toBe(2);
  });

  it("preserves a monster record in place across ticks (belief accumulation)", () => {
    const world = new BorgWorld();
    const memo = makePerceiveMemo();
    perceive(
      world,
      makeScenarioView({ monsters: [{ id: 9, grid: { x: 8, y: 5 } }] }),
      memo,
    );
    const idx0 = [...world.kills.entries()][0]![0];
    perceive(
      world,
      makeScenarioView({ monsters: [{ id: 9, grid: { x: 7, y: 5 } }] }),
      memo,
    );
    const entries = [...world.kills.entries()];
    expect(entries).toHaveLength(1);
    expect(entries[0]![0]).toBe(idx0); // same slot reused
    expect(entries[0]![1].pos).toEqual({ x: 7, y: 5 });
    expect(entries[0]![1].ox).toBe(8); // old position remembered
  });
});

describe("controller cycle", () => {
  it("perceives, advances the clock once per think, and returns a command", () => {
    const { world, controller } = createBorg();
    const view = makeScenarioView({ player: { grid: { x: 5, y: 5 } } });
    const act = makeFakeActions();

    expect(world.clock).toBe(0);
    const cmd = controller(view, act);
    expect(world.clock).toBe(1);
    expect(cmd).not.toBeNull();
    controller(view, act);
    expect(world.clock).toBe(2);
  });

  // The foundation stub's fixed melee/step/hold policy was replaced by the
  // faithful borg_think_dungeon ladder in P8.6; its priority behavior is
  // covered in think.test.ts. Here we only assert the controller keeps driving
  // the game (always yields a command on a live level, never stalls).
  it("always produces a command on a live level (drives the game)", () => {
    const { controller } = createBorg();
    const view = makeScenarioView({
      player: { grid: { x: 5, y: 5 } },
      monsters: [{ grid: { x: 9, y: 5 } }],
    });
    const cmd = controller(view, makeFakeActions());
    expect(cmd).not.toBeNull();
  });

  it("yields (null) when the player is dead", () => {
    const { controller } = createBorg();
    const view = makeScenarioView({ player: { dead: true } });
    expect(controller(view, makeFakeActions())).toBeNull();
  });
});

describe("borg RNG isolation + reproducibility", () => {
  it("is quick-mode and reproducible from the fixed local seed", () => {
    const a = makeBorgRng();
    const b = makeBorgRng();
    const seqA = [a.randint0(100), a.randint0(100), a.randint0(100)];
    const seqB = [b.randint0(100), b.randint0(100), b.randint0(100)];
    expect(seqA).toEqual(seqB);
  });

  it("reseed restores the exact stream", () => {
    const r = makeBorgRng();
    const first = [r.randint0(1000), r.randint0(1000)];
    reseedBorgRng(r);
    const second = [r.randint0(1000), r.randint0(1000)];
    expect(second).toEqual(first);
  });

  it("reseeds each think so simulations are a pure function of inputs", () => {
    const { rng } = createBorg({ rngSeed: BORG_LOCAL_SEED });
    // The controller reseeds internally; here we just prove the seed is stable.
    const x = rng.randint0(500);
    reseedBorgRng(rng, BORG_LOCAL_SEED);
    expect(rng.randint0(500)).toBe(x);
  });
});

describe("geometry helpers", () => {
  it("keypadDir maps signed steps to keypad directions", () => {
    expect(keypadDir(1, 0)).toBe(6); // east
    expect(keypadDir(-1, 0)).toBe(4); // west
    expect(keypadDir(0, -1)).toBe(8); // north
    expect(keypadDir(0, 1)).toBe(2); // south
    expect(keypadDir(1, -1)).toBe(9); // north-east
    expect(keypadDir(0, 0)).toBe(5); // center
  });

  it("distance is Chebyshev (king moves)", () => {
    expect(distance(0, 0, 3, 1)).toBe(3);
    expect(distance(0, 0, 2, 2)).toBe(2);
    expect(distance(5, 5, 5, 5)).toBe(0);
  });
});
