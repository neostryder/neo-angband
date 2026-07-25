import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OF, TMD, TRF } from "../generated";
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
import { registerTerrainHandlers } from "./effect-terrain";
import {
  calcUnlockingChance,
  disarmAux,
  hitTrap,
  installChunkFeatHook,
  installTraps,
  pickTrap,
  placeTrap,
  squareDoorPower,
  squareIsPlayerTrap,
  squareIsVisibleTrap,
  squareIsWarded,
  squareIsWebbed,
  squareRevealTrap,
  squareSetDoorLock,
  squareSetTrapTimeout,
  squareTrap,
} from "./trap";
import type { TrapDeps } from "./trap";
import { createDefaultRegistry, processPlayer } from "./player-turn";
import { runAction } from "./player-path";
import { makeState, plReg } from "./harness";
import type { GameState } from "./context";
import { FEAT, SQUARE } from "../generated";
import { movePlayer } from "./context";
import { thrustAway } from "./thrust";
import { Rng } from "../rng";

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
  registerTerrainHandlers(registry);
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
const webIdx = kinds.find((k) => k.flags.has(TRF.WEB))!.tidx;

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

  it("installTraps refuses to disarm an invisible trap (visibility guard)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const msgs: string[] = [];
    const d = deps(state, { env: { msg: (t): void => { msgs.push(t); } } });
    placeTrap(state, loc(6, 5), pitIdx, 5, d);
    /* Live guard: not visible, not known as disarmable. */
    expect(squareIsVisibleTrap(state, loc(6, 5))).toBe(false);
    expect(squareIsPlayerTrap(state, loc(6, 5))).toBe(true);

    const registry = createDefaultRegistry();
    installTraps(state, registry, d);
    const commands = [{ code: "disarm", dir: 6 }];
    state.nextCommand = (): { code: string; dir?: number } | null =>
      commands.shift() ?? null;
    /* installTraps (trap.ts:713-716): zero energy, trap remains, refuse msg. */
    expect(processPlayer(state, registry).energyUsed).toBe(0);
    expect(squareIsPlayerTrap(state, loc(6, 5))).toBe(true);
    expect(msgs.some((m) => m.includes("nothing there to disarm"))).toBe(true);
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

  it("TRF_DELAY fires on leave via player_leaving (mon-util.c:503-515)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const d = deps(state);
    const blockFall = kinds.find((k) => k.desc === "block fall trap")!;
    placeTrap(state, loc(5, 5), blockFall.tidx, 5, d);
    installTraps(state, createDefaultRegistry(), d);
    /* Immediate (delayed=0) must not fire DELAY traps. */
    hitTrap(state, loc(5, 5), 0, d);
    expect(state.chunk.feat(loc(5, 5))).not.toBe(FEAT.GRANITE);
    /* Leaving the grid fires delayed=1 (player_leaving via movePlayer). */
    movePlayer(state, loc(6, 5));
    expect(state.actor.grid).toEqual(loc(6, 5));
    expect(state.chunk.feat(loc(5, 5))).toBe(FEAT.GRANITE);
  });

  it("TRF_DELAY fires when thrust leaves the square (monster_swap player_leaving)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const d = deps(state);
    const blockFall = kinds.find((k) => k.desc === "block fall trap")!;
    placeTrap(state, loc(5, 5), blockFall.tidx, 5, d);
    installTraps(state, createDefaultRegistry(), d);
    /* thrust_away via monster_swap (mon-util.c:609-612): player_leaving. */
    thrustAway(state, loc(3, 5), loc(5, 5), 2);
    expect(state.actor.grid).not.toEqual(loc(5, 5));
    expect(state.chunk.feat(loc(5, 5))).toBe(FEAT.GRANITE);
  });

  it("disarmAux applies no_light penalty (cmd-cave.c:812-817 / cave-view.c:914-917)", () => {
    const make = (seen: boolean): boolean => {
      const state = makeState({ playerGrid: loc(5, 5), seed: 99 });
      state.actor.combat = {
        ...state.actor.combat,
        skills: state.actor.combat.skills.map((v, i) =>
          i === SKILL.DISARM_PHYS ? 50 : v,
        ),
      };
      if (seen) state.chunk.sqinfoOn(state.actor.grid, SQUARE.SEEN);
      else state.chunk.sqinfoOff(state.actor.grid, SQUARE.SEEN);
      const d = deps(state);
      placeTrap(state, loc(6, 5), pitIdx, 5, d);
      squareRevealTrap(state, loc(6, 5), true, d);
      /*
       * First randint0(100)=10: lit chance~50 disarms; dark chance floor(50/10)=5
       * fails, second roll 0 -> "failed to disarm" (not set-off).
       */
      let n100 = 0;
      const base = state.rng;
      state.rng = {
        ...base,
        randint0: (n: number): number =>
          n === 100 ? (n100++ === 0 ? 10 : 0) : base.randint0(n),
      } as Rng;
      disarmAux(state, loc(6, 5), d);
      return !squareIsPlayerTrap(state, loc(6, 5));
    };
    expect(make(true)).toBe(true);
    expect(make(false)).toBe(false);
  });

  it("setFeat to non-trappable terrain destroys traps (cave-square.c:1256-1259)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const d = deps(state);
    placeTrap(state, loc(10, 10), pitIdx, 5, d);
    installChunkFeatHook(state);
    expect(squareIsPlayerTrap(state, loc(10, 10))).toBe(true);
    state.chunk.setFeat(loc(10, 10), FEAT.GRANITE);
    expect(squareIsPlayerTrap(state, loc(10, 10))).toBe(false);
  });

  it("squareIsWarded is only glyph of warding, not decoy (cave-square.c:751-755)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const d = deps(state);
    const glyph = kinds.find((k) => k.desc === "glyph of warding")!;
    const decoy = kinds.find((k) => k.desc === "decoy")!;
    placeTrap(state, loc(10, 10), glyph.tidx, 0, d);
    placeTrap(state, loc(11, 10), decoy.tidx, 0, d);
    expect(squareIsWarded(state, loc(10, 10))).toBe(true);
    expect(squareIsWarded(state, loc(11, 10))).toBe(false);
  });
});

describe("run web ordering (cmd-cave.c:1368-1381)", () => {
  it("clears a web before refusing a confused run", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const messages: string[] = [];
    state.msg = (text): void => {
      messages.push(text);
    };
    state.actor.player.timed[TMD.CONFUSED] = 5;
    const d = deps(state);
    placeTrap(state, state.actor.grid, webIdx, 5, d);

    const used = runAction(state, { code: "run", dir: 6 });

    expect(used).toBe(state.z.moveEnergy);
    expect(squareIsWebbed(state, state.actor.grid)).toBe(false);
    expect(messages).toEqual(["You clear the web."]);
  });
});
