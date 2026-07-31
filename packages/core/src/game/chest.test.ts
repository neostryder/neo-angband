import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants.js";
import { SQUARE, STAT, TMD, TV } from "../generated/index.js";
import { loc } from "../loc.js";
import type { Loc } from "../loc.js";
import { SKILL } from "../player/types.js";
import { Rng } from "../rng.js";
import { ObjRegistry } from "../obj/bind.js";
import type { ObjPackJson } from "../obj/types.js";
import { ArtifactState, ObjAllocState, makeObject, objectPrep } from "../obj/make.js";
import type { MakeDeps } from "../obj/make.js";
import { tvalIsChest } from "../obj/object.js";
import { CHEST_QUERY } from "../obj/chest.js";
import { EffectRegistry } from "../effects/interpreter.js";
import { registerCoreHandlers } from "../effects/handlers.js";
import { registerGeneralHandlers } from "./effect-general.js";
import { basicPlayerActor } from "./project-cast.js";
import { floorCarry, floorPile } from "./floor.js";
import { createDefaultRegistry, processPlayer } from "./player-turn.js";
import type { CaveCmdDeps } from "./cave-cmd.js";
import { installCaveCommands } from "./cave-cmd.js";
import { makeState, plReg } from "./harness.js";
import type { GameState } from "./context.js";
import {
  chestCheck,
  chestDeath,
  chestTrap,
  countChests,
  doCmdDisarmChest,
  doCmdOpenChest,
} from "./chest.js";
import type { ChestCmdDeps, ChestEffectsBundle } from "./chest.js";

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

function freshMakeDeps(): MakeDeps {
  return {
    reg,
    alloc: new ObjAllocState(reg, constants),
    constants,
    artifacts: new ArtifactState(reg.artifacts.length),
    noArtifacts: false,
  };
}

/** A real chest object of the given kind name (e.g. "Small wooden chest"). */
/**
 * Non-chest objects within drop_near's 7x7 placement scan of `grid`. Chest loot
 * goes down with prefer_pile = false (obj-chest.c:532), so it does not all land
 * on one square.
 */
function droppedNear(state: GameState, grid: Loc): number {
  let n = 0;
  for (let dy = -3; dy <= 3; dy++) {
    for (let dx = -3; dx <= 3; dx++) {
      const g = loc(grid.x + dx, grid.y + dy);
      if (!state.chunk.inBounds(g)) continue;
      n += floorPile(state, g).filter((o) => !tvalIsChest(o.tval)).length;
    }
  }
  return n;
}

function chestObj(name: string, seed = 1) {
  const sval = reg.lookupSval(TV.CHEST, name);
  const kind = reg.lookupKind(TV.CHEST, sval)!;
  const rng = new Rng(seed);
  return objectPrep(rng, reg, constants, kind, kind.level, "randomise");
}

/** The effects bundle chest_trap needs, with DAMAGE/TIMED_INC/DRAIN_STAT live. */
function effectsBundle(): ChestEffectsBundle {
  const registry = new EffectRegistry();
  registerCoreHandlers(registry);
  registerGeneralHandlers(registry);
  return {
    registry,
    cast: { projections: [], maxRange: 20, playerActor: undefined as never },
    envDeps: { timedTable: plReg.timed },
    general: {},
  };
}

/** state.actor.combat.skills is readonly; replace it immutably for tests. */
function setSkill(state: GameState, skill: number, value: number): void {
  state.actor.combat = {
    ...state.actor.combat,
    skills: state.actor.combat.skills.map((v, i) => (i === skill ? value : v)),
  };
}

function cmdDeps(state: GameState, over: Partial<ChestCmdDeps> = {}): ChestCmdDeps {
  const bundle = effectsBundle();
  bundle.cast = {
    projections: [],
    maxRange: 20,
    playerActor: basicPlayerActor(state),
  };
  return {
    makeDeps: freshMakeDeps(),
    floorEnv: {},
    effects: bundle,
    env: { expGain: () => undefined },
    ...over,
  };
}

describe("chestCheck / countChests (obj-chest.c L423-483)", () => {
  it("chestCheck finds the first matching chest by query type", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const empty = chestObj("Small wooden chest");
    empty.pval = 0;
    const locked = chestObj("Small iron chest");
    locked.pval = 1;
    const trapped = chestObj("Small steel chest");
    trapped.pval = 2;
    floorCarry(state, loc(6, 5), empty);
    floorCarry(state, loc(7, 5), locked);
    floorCarry(state, loc(8, 5), trapped);

    expect(chestCheck(state, loc(6, 5), CHEST_QUERY.ANY)).toBe(empty);
    expect(chestCheck(state, loc(6, 5), CHEST_QUERY.OPENABLE)).toBeNull(); // pval 0
    expect(chestCheck(state, loc(7, 5), CHEST_QUERY.OPENABLE)).toBe(locked);
    expect(chestCheck(state, loc(7, 5), CHEST_QUERY.TRAPPED)).toBeNull(); // pval 1, untrapped
    expect(chestCheck(state, loc(8, 5), CHEST_QUERY.TRAPPED)).toBe(trapped);
    expect(chestCheck(state, loc(9, 5), CHEST_QUERY.ANY)).toBeNull();
  });

  it("countChests scans the 9-grid neighbourhood including the player's own grid", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const underfoot = chestObj("Small wooden chest");
    underfoot.pval = 1;
    const adjacent = chestObj("Small iron chest");
    adjacent.pval = 1;
    floorCarry(state, loc(5, 5), underfoot);
    floorCarry(state, loc(6, 5), adjacent);

    const result = countChests(state, CHEST_QUERY.OPENABLE);
    expect(result.count).toBe(2);
  });
});

describe("chest_trap (obj-chest.c L545)", () => {
  it("fires the matching trap's message and effect, table order", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.actor.player.chp = 100;
    state.actor.player.statCur[STAT.STR] = 18;
    state.actor.player.statMax[STAT.STR] = 18;
    const obj = chestObj("Small iron chest");
    obj.pval = 4; // poison needle / STR: DAMAGE 1d4 then DRAIN_STAT:STR
    const msgs: string[] = [];
    chestTrap(state, obj, {
      effects: effectsBundle(),
      env: { msg: (t) => msgs.push(t) },
    });
    expect(msgs).toContain("A small needle has pricked you!");
    expect(state.actor.player.chp).toBeLessThan(100);
    expect(state.actor.player.statCur[STAT.STR]).toBeLessThan(18);
  });

  it("an exploding chest destroys itself INSIDE chest_trap, before chest_death runs", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.actor.player.chp = 1000;
    const grid = loc(6, 5);
    const obj = chestObj("Large steel chest");
    obj.pval = 64; // explosion device only
    obj.originDepth = 10;
    floorCarry(state, grid, obj);

    const msgs: string[] = [];
    const deps = cmdDeps(state);
    chestTrap(state, obj, { ...deps, env: { msg: (t) => msgs.push(t) } });
    expect(obj.pval).toBe(0); // destroy fired and broke the walk
    expect(msgs).toContain(
      "There is a sudden explosion! Everything inside the chest is destroyed!",
    );

    // chest_death runs AFTER chest_trap in do_cmd_open_chest; with pval
    // already zeroed by the explosion, it must be a complete no-op - the
    // exploded chest drops NO loot.
    chestDeath(state, grid, obj, deps);
    const pile = floorPile(state, grid);
    expect(pile.filter((o) => !tvalIsChest(o.tval)).length).toBe(0);
  });

  it("a trap combining multiple set bits fires each one in ascending pval order", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.actor.player.chp = 100;
    const obj = chestObj("Small wooden chest");
    obj.pval = 2 | 4; // gas trap (pval 2) + poison needle/STR (pval 4)
    const msgs: string[] = [];
    chestTrap(state, obj, {
      effects: effectsBundle(),
      env: { msg: (t) => msgs.push(t) },
    });
    expect(msgs).toEqual([
      "A puff of green gas surrounds you!",
      "A small needle has pricked you!",
    ]);
    expect(state.actor.player.timed[TMD.POISONED]).toBeGreaterThan(0);
  });
});

describe("chest_death (obj-chest.c L498)", () => {
  it("a wooden chest drops exactly 1 item, good, out of depth for origin_depth+5", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const grid = loc(6, 5);
    const chest = chestObj("Small wooden chest");
    chest.pval = 1;
    chest.originDepth = 3;
    const deps = cmdDeps(state);

    chestDeath(state, grid, chest, deps);
    /* prefer_pile = false (obj-chest.c:532), so with only one item it lands on
     * the chest's own grid; see droppedNear for the multi-item case. */
    const dropped = floorPile(state, grid).filter((o) => !tvalIsChest(o.tval));
    expect(dropped.length).toBe(1);
    expect(dropped[0]!.origin).toBe(2 /* ORIGIN.CHEST */);
    expect(dropped[0]!.originDepth).toBe(3);
    expect(chest.pval).toBe(0);
  });

  it("iron chests drop 2, steel chests drop 3", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const deps = cmdDeps(state);

    /* Chest loot is dropped with prefer_pile = FALSE (obj-chest.c:532), so
     * drop_find_grid's mixed-type penalty applies and items of different kinds
     * scatter over the 7x7 scan rather than piling on the chest's grid. Count
     * across the scan, not at one grid. */
    const iron = chestObj("Small iron chest");
    iron.pval = 1;
    chestDeath(state, loc(6, 5), iron, deps);
    expect(droppedNear(state, loc(6, 5))).toBe(2);

    const steel = chestObj("Small steel chest");
    steel.pval = 1;
    chestDeath(state, loc(16, 5), steel, deps);
    expect(droppedNear(state, loc(16, 5))).toBe(3);
  });

  it("an already-empty chest (pval 0) is a no-op", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const chest = chestObj("Small wooden chest");
    chest.pval = 0;
    const deps = cmdDeps(state);
    chestDeath(state, loc(6, 5), chest, deps);
    expect(floorPile(state, loc(6, 5)).length).toBe(0);
  });

  it("the chest-retry branch is structurally present but unreachable for stock data", () => {
    // chest_death always calls make_object with good=true (obj-chest.c
    // L522), and kindIsGood (make.ts) never returns true for TV.CHEST (no
    // chest kind carries KF.GOOD, nor matches any of the tval-specific
    // cases) - so the "great" allocation table make_object draws from can
    // never itself contain a chest kind. The `if (tvalIsChest(treasure))
    // continue;` retry is therefore dead code for the shipped data, same
    // as chest_death's randint1(3) fallback (obj-chest.c comment). Ported
    // faithfully anyway (obj/chest.ts / game/chest.ts) for a future mod
    // that adds a KF.GOOD chest kind. This test pins that reachability
    // fact rather than forcing the branch (which would need a mocked
    // make_object - this codebase's tests always drive the real RNG).
    const probeDeps = freshMakeDeps();
    let anyChest = false;
    for (let s = 1; s <= 3000 && !anyChest; s++) {
      const obj = makeObject(new Rng(s), probeDeps, 6, true, false, false, 0, 1);
      if (obj && tvalIsChest(obj.tval)) anyChest = true;
    }
    expect(anyChest).toBe(false);
  });
});

describe("do_cmd_open_chest (obj-chest.c L580)", () => {
  it("picks the lock, then drops loot and empties the chest", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.chunk.sqinfoOn(state.actor.grid, SQUARE.SEEN); // no_light penalty off
    setSkill(state, SKILL.DISARM_PHYS, 200);
    const grid = loc(6, 5);
    const chest = chestObj("Small wooden chest");
    chest.pval = 1; // locked, no traps
    chest.originDepth = 2;
    floorCarry(state, grid, chest);

    const msgs: string[] = [];
    const deps = cmdDeps(state, { env: { msg: (t) => msgs.push(t) } });
    const more = doCmdOpenChest(state, grid, chest, deps);

    expect(more).toBe(false);
    expect(msgs).toContain("You have picked the lock.");
    expect(chest.pval).toBe(0);
    /* prefer_pile = false (obj-chest.c:532): the loot need not land on the
     * chest's own grid, so count across drop_near's scan. */
    expect(droppedNear(state, grid)).toBe(1);
  });

  it("a failed lock pick may repeat and does not open the chest", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    // Leave the grid unseen (no_light penalty) and give a weak skill, so
    // j collapses to the floor of 2 - overwhelmingly likely to fail once.
    setSkill(state, SKILL.DISARM_PHYS, 0);
    const grid = loc(6, 5);
    const chest = chestObj("Small steel chest");
    chest.pval = 30; // locked, high difficulty
    floorCarry(state, grid, chest);

    const msgs: string[] = [];
    const deps = cmdDeps(state, { env: { msg: (t) => msgs.push(t) } });
    doCmdOpenChest(state, grid, chest, deps);
    expect(chest.pval).not.toBe(0); // still on the floor pile, unopened
  });

  it("fires the trap before dropping loot when opened", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.chunk.sqinfoOn(state.actor.grid, SQUARE.SEEN);
    setSkill(state, SKILL.DISARM_PHYS, 200);
    state.actor.player.chp = 100;
    const grid = loc(6, 5);
    const chest = chestObj("Small iron chest");
    chest.pval = 1 | 4; // locked + poison needle/STR
    chest.originDepth = 2;
    floorCarry(state, grid, chest);

    const msgs: string[] = [];
    const deps = cmdDeps(state, { env: { msg: (t) => msgs.push(t) } });
    doCmdOpenChest(state, grid, chest, deps);

    expect(msgs).toContain("You have picked the lock.");
    expect(msgs).toContain("A small needle has pricked you!");
    expect(state.actor.player.chp).toBeLessThan(100);
    expect(chest.pval).toBe(0);
  });
});

describe("do_cmd_disarm_chest (obj-chest.c L659)", () => {
  it("an untrapped chest cannot be disarmed", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const chest = chestObj("Small wooden chest");
    chest.pval = 1; // locked, no traps
    chest.knownPval = 1; // the player has searched it (obj-chest.c:702)
    const msgs: string[] = [];
    const deps = cmdDeps(state, { env: { msg: (t) => msgs.push(t) } });
    const more = doCmdDisarmChest(state, chest, deps);
    expect(more).toBe(false);
    expect(msgs).toContain("The chest is not trapped.");
    expect(chest.pval).toBe(1);
  });

  it("a skilled player disarms a trapped chest and negates the pval", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.chunk.sqinfoOn(state.actor.grid, SQUARE.SEEN);
    setSkill(state, SKILL.DISARM_PHYS, 200);
    const chest = chestObj("Small iron chest");
    chest.pval = 4; // poison needle/STR (physical)
    chest.knownPval = 4; // trap found by search (obj-chest.c:702)
    let exp = 0;
    const deps = cmdDeps(state, { env: { expGain: (n) => (exp = n) } });
    const more = doCmdDisarmChest(state, chest, deps);
    expect(more).toBe(false);
    expect(chest.pval).toBe(-4);
    expect(exp).toBe(4);
  });

  it("the two-roll miss path fires the trap on a full miss", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    // No light seen + zero skill: diff floors at 2, so both the disarm
    // and the "avoid setting it off" rolls overwhelmingly fail.
    setSkill(state, SKILL.DISARM_PHYS, 0);
    setSkill(state, SKILL.DISARM_MAGIC, 0);
    state.actor.player.chp = 100;
    const chest = chestObj("Small iron chest");
    chest.pval = 4; // poison needle/STR
    chest.knownPval = 4;
    const msgs: string[] = [];
    const deps = cmdDeps(state, { env: { msg: (t) => msgs.push(t) } });

    // Search for a seed landing on the third branch (trap fires): both
    // rolls >= diff(2). Very likely on the first try (98% per roll).
    let seed = -1;
    for (let s = 1; s < 50 && seed < 0; s++) {
      const probe = new Rng(s);
      const r1 = probe.randint0(100);
      const r2 = probe.randint0(100);
      if (r1 >= 2 && r2 >= 2) seed = s;
    }
    expect(seed).toBeGreaterThan(0);
    state.rng = new Rng(seed);

    const more = doCmdDisarmChest(state, chest, deps);
    expect(more).toBe(false);
    expect(msgs).toContain("You set off a trap!");
    expect(msgs).toContain("A small needle has pricked you!");
    expect(state.actor.player.chp).toBeLessThan(100);
  });
});

describe("installCaveCommands: chest wiring (dir 5 underfoot, chest-vs-door)", () => {
  function caveDeps(state: GameState, msgs: string[]): CaveCmdDeps {
    return {
      makeDeps: freshMakeDeps(),
      env: { msg: (t) => msgs.push(t) },
      chestDeps: cmdDeps(state, { env: { msg: (t) => msgs.push(t) } }),
    };
  }

  /** Queue exactly one command; nextCommand drains the SAME array so a
   * failed (0-energy) action does not re-feed processPlayer's do-while
   * forever. */
  function queueOne(
    state: GameState,
    cmd: { code: string; dir?: number },
  ): void {
    const commands = [cmd];
    state.nextCommand = (): { code: string; dir?: number } | null =>
      commands.shift() ?? null;
  }

  it("open resolves dir 5 to the player's own grid for a chest underfoot", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.chunk.sqinfoOn(state.actor.grid, SQUARE.SEEN);
    setSkill(state, SKILL.DISARM_PHYS, 200);
    const chest = chestObj("Small wooden chest");
    chest.pval = 1;
    chest.originDepth = 1;
    floorCarry(state, state.actor.grid, chest);

    const registry = createDefaultRegistry();
    const msgs: string[] = [];
    installCaveCommands(registry, caveDeps(state, msgs));
    queueOne(state, { code: "open", dir: 5 });
    const result = processPlayer(state, registry);

    expect(result.energyUsed).toBe(state.z.moveEnergy);
    expect(msgs).toContain("You have picked the lock.");
    expect(chest.pval).toBe(0);
    /* prefer_pile = false (obj-chest.c:532): the chest's own grid already holds
     * the chest, so the mixed-type penalty can push the loot to a neighbour. */
    expect(droppedNear(state, state.actor.grid)).toBe(1);
  });

  it("open still opens a door when there is no chest there", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    // No chest at (6,5) and no closed door either: "You see nothing there
    // to open." with no turn spent.
    const registry = createDefaultRegistry();
    const msgs: string[] = [];
    installCaveCommands(registry, caveDeps(state, msgs));
    queueOne(state, { code: "open", dir: 6 });
    const result = processPlayer(state, registry);
    expect(result.energyUsed).toBe(0);
    /* An unknown grid fails do_cmd_open_test's knowledge gate first
     * (cmd-cave.c:151-154), before the "nothing to open" arm. */
    expect(msgs).toContain("You see nothing there.");
  });

  it("disarm merges with the sibling floor-trap disarm: a trapped chest wins first", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.chunk.sqinfoOn(state.actor.grid, SQUARE.SEEN);
    setSkill(state, SKILL.DISARM_PHYS, 200);
    const chest = chestObj("Small iron chest");
    chest.pval = 4; // poison needle/STR
    chest.knownPval = 4;
    floorCarry(state, loc(6, 5), chest);

    const registry = createDefaultRegistry(); // "disarm" is the stock stub here
    const msgs: string[] = [];
    installCaveCommands(registry, caveDeps(state, msgs));
    queueOne(state, { code: "disarm", dir: 6 });
    const result = processPlayer(state, registry);

    expect(result.energyUsed).toBe(state.z.moveEnergy);
    expect(chest.pval).toBe(-4);
  });

  it("disarm falls through to the prior action when no chest is present", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const registry = createDefaultRegistry();
    // No chest anywhere; the stock "disarm" stub spends no energy.
    installCaveCommands(registry, caveDeps(state, []));
    queueOne(state, { code: "disarm", dir: 6 });
    const result = processPlayer(state, registry);
    expect(result.energyUsed).toBe(0);
  });
});
