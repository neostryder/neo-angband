import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OF, TRF } from "../generated";
import { loc } from "../loc";
import { SKILL } from "../player/types";
import { EffectRegistry } from "../effects/interpreter";
import { registerCoreHandlers } from "../effects/handlers";
import { bindProjections } from "../world/projection";
import type { ProjectionRecordJson } from "../world/projection";
import { bindTraps, lookupTrap } from "../world/trap";
import type { TrapRecordJson } from "../world/trap";
import { basicPlayerActor } from "./project-cast";
import { registerAttackHandlers } from "./effect-attack";
import { registerMonsterHandlers } from "./effect-monster";
import { registerTeleportHandlers } from "./effect-teleport";
import {
  calcUnlockingChance,
  disarmAux,
  hitTrap,
  installTraps,
  pickTrap,
  placeTrap,
  squareDoorPower,
  squareIsPlayerTrap,
  squareIsVisibleTrap,
  squareRevealTrap,
  squareSetDoorLock,
  squareSetTrapTimeout,
  squareTrap,
} from "./trap";
import type { TrapDeps } from "./trap";
import { createDefaultRegistry, processPlayer } from "./player-turn";
import { makeState, plReg } from "./harness";
import type { GameState } from "./context";
import { FEAT } from "../generated";

function loadRecords<T>(name: string): T[] {
  return (
    JSON.parse(
      readFileSync(
        new URL(`../../../content/pack/${name}.json`, import.meta.url),
        "utf8",
      ),
    ) as { records: T[] }
  ).records;
}

const kinds = bindTraps(loadRecords<TrapRecordJson>("trap"));
const projections = bindProjections(
  loadRecords<ProjectionRecordJson>("projection"),
);

function effectDeps(state: GameState): NonNullable<TrapDeps["effects"]> {
  const registry = new EffectRegistry();
  registerCoreHandlers(registry);
  registerAttackHandlers(registry);
  registerMonsterHandlers(registry);
  registerTeleportHandlers(registry);
  return {
    registry,
    cast: { projections, maxRange: 20, playerActor: basicPlayerActor(state) },
    envDeps: { timedTable: plReg.timed },
  };
}

function deps(state: GameState, over: Partial<TrapDeps> = {}): TrapDeps {
  return { kinds, effects: effectDeps(state), ...over };
}

const pitIdx = kinds.find((k) => k.desc === "pit")!.tidx;
const trapdoorIdx = kinds.find((k) => k.desc === "trap door")!.tidx;

describe("bindTraps (trap.txt)", () => {
  it("binds the full kind table with flags, power and effects", () => {
    expect(kinds.length).toBe(40);
    const pit = kinds[pitIdx]!;
    expect(pit.flags.has(TRF.TRAP)).toBe(true);
    expect(pit.flags.has(TRF.FLOOR)).toBe(true);
    expect(pit.flags.has(TRF.PIT)).toBe(true);
    expect(pit.effect[0]!.eff).toBe("DAMAGE");
    expect(pit.saveFlags).toContain(OF.FEATHER);
    expect(pit.power.base).toBe(90);
  });

  it("lookupTrap finds kinds by description", () => {
    expect(lookupTrap(kinds, "door lock")!.flags.has(TRF.LOCK)).toBe(true);
    expect(lookupTrap(kinds, "glyph of warding")!.flags.has(TRF.GLYPH)).toBe(true);
  });
});

describe("placeTrap / pickTrap", () => {
  it("places a specific trap kind on a grid", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    placeTrap(state, loc(10, 10), pitIdx, 5, deps(state));
    expect(squareIsPlayerTrap(state, loc(10, 10))).toBe(true);
    expect(squareTrap(state, loc(10, 10))[0]!.kind.desc).toBe("pit");
  });

  it("picks a random player trap by rarity at depth; none in town", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.chunk.depth = 10;
    const idx = pickTrap(state, state.chunk.feat(loc(10, 10)), 10, deps(state));
    expect(idx).toBeGreaterThan(0);
    expect(kinds[idx]!.flags.has(TRF.TRAP)).toBe(true);

    state.chunk.depth = 0;
    expect(pickTrap(state, 1, 10, deps(state))).toBe(-1);
  });
});

describe("squareRevealTrap", () => {
  it("reveals when the search skill beats the trap power", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.chunk.depth = 5;
    placeTrap(state, loc(10, 10), pitIdx, 5, deps(state));
    expect(squareIsVisibleTrap(state, loc(10, 10))).toBe(false);

    /* Harness skills are 20, pit power ~90: not noticed. */
    expect(squareRevealTrap(state, loc(10, 10), false, deps(state))).toBe(false);
    /* Forced reveal always works. */
    expect(squareRevealTrap(state, loc(10, 10), true, deps(state))).toBe(true);
    expect(squareIsVisibleTrap(state, loc(10, 10))).toBe(true);
  });
});

describe("hitTrap", () => {
  it("a pit damages the player through the effect stack", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    state.actor.player.chp = 100;
    const d = deps(state);
    placeTrap(state, loc(10, 10), pitIdx, 5, d);
    hitTrap(state, loc(10, 10), -1, d);
    expect(state.actor.player.chp).toBeLessThan(100); // 2d6 landed
  });

  it("the FEATHER save flag evades the pit entirely", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    state.actor.player.chp = 100;
    const d = deps(state, {
      env: { playerHasFlag: (f): boolean => f === OF.FEATHER },
    });
    d.kinds = kinds;
    placeTrap(state, loc(10, 10), pitIdx, 5, d);
    hitTrap(state, loc(10, 10), -1, d);
    expect(state.actor.player.chp).toBe(100);
  });

  it("a trap door signals a level change", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    state.chunk.depth = 5;
    const d = deps(state);
    placeTrap(state, loc(10, 10), trapdoorIdx, 5, d);
    hitTrap(state, loc(10, 10), -1, d);
    expect(state.generateLevel).toBe(true);
  });

  it("a disabled trap does not fire", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    state.actor.player.chp = 100;
    const d = deps(state);
    placeTrap(state, loc(10, 10), pitIdx, 5, d);
    squareSetTrapTimeout(state, loc(10, 10), -1, 20);
    hitTrap(state, loc(10, 10), -1, d);
    expect(state.actor.player.chp).toBe(100);
  });
});

describe("door locks (trap.c L706)", () => {
  it("locks a closed door and reads back the power", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.chunk.setFeat(loc(6, 5), FEAT.CLOSED);
    const d = deps(state);
    expect(squareDoorPower(state, loc(6, 5), d)).toBe(0);
    squareSetDoorLock(state, loc(6, 5), 5, d);
    expect(squareDoorPower(state, loc(6, 5), d)).toBe(5);
    /* Not a door, no lock. */
    squareSetDoorLock(state, loc(7, 5), 5, d);
    expect(squareDoorPower(state, loc(7, 5), d)).toBe(0);
  });

  it("calcUnlockingChance matches the upstream formula", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    /* Harness DISARM_PHYS is 20: 20 - 4*3 = 8. */
    expect(calcUnlockingChance(state, 3)).toBe(8);
    /* Floors at 2. */
    expect(calcUnlockingChance(state, 10)).toBe(2);
  });
});

describe("disarm and the step hook", () => {
  it("a skilled player disarms a visible trap", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.actor.combat = {
      ...state.actor.combat,
      skills: state.actor.combat.skills.map((v, i) =>
        i === SKILL.DISARM_PHYS ? 200 : v,
      ),
    };
    const d = deps(state);
    placeTrap(state, loc(6, 5), pitIdx, 5, d);
    squareRevealTrap(state, loc(6, 5), true, d);

    const registry = createDefaultRegistry();
    installTraps(state, registry, d);
    const commands = [{ code: "disarm", dir: 6 }];
    state.nextCommand = (): { code: string; dir?: number } | null =>
      commands.shift() ?? null;
    const result = processPlayer(state, registry);
    expect(result.energyUsed).toBe(state.z.moveEnergy);
    expect(squareIsPlayerTrap(state, loc(6, 5))).toBe(false);
  });

  it("an invisible trap cannot be disarmed", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const d = deps(state);
    placeTrap(state, loc(6, 5), pitIdx, 5, d);
    expect(disarmAux(state, loc(6, 5), d)).toBeDefined(); // aux itself works
    const registry = createDefaultRegistry();
    installTraps(state, registry, d);
    const commands = [{ code: "disarm", dir: 6 }];
    state.nextCommand = (): { code: string; dir?: number } | null =>
      commands.shift() ?? null;
    expect(processPlayer(state, registry).energyUsed).toBe(0);
  });

  it("stepping onto a trap triggers it through the walk wiring", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.actor.player.chp = 100;
    const d = deps(state);
    placeTrap(state, loc(6, 5), pitIdx, 5, d);

    const registry = createDefaultRegistry();
    installTraps(state, registry, d);
    const commands = [{ code: "walk", dir: 6 }];
    state.nextCommand = (): { code: string; dir?: number } | null =>
      commands.shift() ?? null;
    processPlayer(state, registry);
    expect(state.actor.grid).toEqual(loc(6, 5));
    expect(state.actor.player.chp).toBeLessThan(100);
  });
});
