import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EF, MSG, RF, SQUARE } from "../generated/index.js";
import {
  EffectRegistry,
  sourceMonster,
  sourcePlayer,
} from "../effects/interpreter.js";
import type { EffectContext } from "../effects/interpreter.js";
import { registerCoreHandlers } from "../effects/handlers.js";
import { distance, loc, locEq } from "../loc.js";
import { bindProjections } from "../world/projection.js";
import type { ProjectionRecordJson } from "../world/projection.js";
import { addMon, makeState, monReg } from "./harness.js";
import { showMonsterMessages } from "./mon-message.js";
import type { GameState } from "./context.js";
import { basicPlayerActor } from "./project-cast.js";
import { attachGameEnv } from "./effect-game-env.js";
import type { GameEffectEnv } from "./effect-game-env.js";
import {
  chooseTeleportDestination,
  registerTeleportHandlers,
  teleportMonster,
  teleportPlayer,
  teleportPlayerLevel,
  teleportPlayerTo,
} from "./effect-teleport.js";
import { caveFindDecoy } from "./effect-mon-origin.js";
import { targetIsSet, targetSetLocation } from "./target.js";

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

  /*
   * "Report failure (very unlikely)" (effect-handler-general.c:2636-2652) has
   * TWO arms, and the port only had the player's. The monster arm was written
   * off as lore (#19) long after the monster message queue landed, so a
   * caster whose teleport found nowhere to go said nothing at all.
   *
   * isWarded disqualifies every grid for a MONSTER mover
   * (has_teleport_destination_prereqs), which is how the destination search is
   * driven to fail without a doctored map.
   */
  it("a monster whose teleport fails looks briefly puzzled, if it is seen", () => {
    const lines: string[] = [];
    const state = makeState({ playerGrid: loc(20, 12), seed: 3 });
    state.msg = (t): void => {
      lines.push(t);
    };
    const mon = addMon(state, plainRace, loc(19, 12), { hp: 30 });
    const from = mon.grid;
    state.chunk.sqinfoOn(mon.grid, SQUARE.SEEN);

    registry().effectSimple(
      EF.TELEPORT,
      env(state, { teleport: { isWarded: () => true } }),
      { origin: sourceMonster(mon.midx), diceString: "10" },
    );

    /* It did not move, and it complained. */
    expect(locEq(mon.grid, from)).toBe(true);
    showMonsterMessages(state);
    expect(lines.join(" ")).toContain("looks briefly puzzled");
  });

  it("...and says nothing when the caster is out of sight", () => {
    /* square_isseen(cave, mon->grid) is the gate: an unseen monster fumbling a
     * teleport gives nothing away. Without this the test above would pass on a
     * handler that ignored the seen check entirely. */
    const lines: string[] = [];
    const state = makeState({ playerGrid: loc(20, 12), seed: 3 });
    state.msg = (t): void => {
      lines.push(t);
    };
    const mon = addMon(state, plainRace, loc(5, 5), { hp: 30 });
    state.chunk.sqinfoOff(mon.grid, SQUARE.SEEN);

    registry().effectSimple(
      EF.TELEPORT,
      env(state, { teleport: { isWarded: () => true } }),
      { origin: sourceMonster(mon.midx), diceString: "10" },
    );
    showMonsterMessages(state);
    expect(lines.join(" ")).not.toContain("puzzled");
  });
});

describe("EF_TELEPORT_TO", () => {
  it("lands the player at the chosen aim (Dimension Door)", () => {
    const state = makeState({ playerGrid: loc(20, 12) });
    const target = loc(10, 8);
    targetSetLocation(state, target);
    expect(targetIsSet(state)).toBe(true);
    registry().effectSimple(
      EF.TELEPORT_TO,
      env(state, { teleport: { getAimTarget: () => target } }),
      { origin: sourcePlayer() },
    );
    expect(locEq(state.actor.grid, target)).toBe(true);
    expect(targetIsSet(state)).toBe(false);
  });

  it("identifies but does not prompt or move on an arena level", () => {
    const start = loc(20, 12);
    const state = makeState({ playerGrid: start });
    state.arenaLevel = true;
    let prompts = 0;
    const ran = registry().effectSimple(
      EF.TELEPORT_TO,
      env(state, {
        teleport: {
          getAimTarget: () => {
            prompts++;
            return loc(10, 8);
          },
        },
      }),
      { origin: sourcePlayer() },
    );
    expect(ran).toBe(true);
    expect(prompts).toBe(0);
    expect(locEq(state.actor.grid, start)).toBe(true);
  });

  it("destroys a seen decoy instead of teleporting the player to the caster", () => {
    const start = loc(20, 12);
    const state = makeState({ playerGrid: start });
    const caster = addMon(state, plainRace, loc(10, 8), { hp: 30 });
    state.decoy = loc(15, 10);
    expect(caveFindDecoy(state)).not.toBeNull();

    registry().effectSimple(EF.TELEPORT_TO, env(state), {
      origin: sourceMonster(caster.midx),
    });

    expect(caveFindDecoy(state)).toBeNull();
    expect(locEq(state.actor.grid, start)).toBe(true);
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
  it("identifies but does not change depth on an arena level", () => {
    const state = makeState();
    state.chunk.depth = 0;
    state.arenaLevel = true;
    let changed: number | null = null;
    const ran = registry().effectSimple(
      EF.TELEPORT_LEVEL,
      env(state, { teleport: { changeLevel: (d) => (changed = d) } }),
      { origin: sourcePlayer() },
    );
    expect(ran).toBe(true);
    expect(changed).toBeNull();
  });

  it("destroys a live decoy instead of changing the player's level", () => {
    const state = makeState();
    state.chunk.depth = 0;
    state.decoy = loc(10, 8);
    let changed: number | null = null;

    registry().effectSimple(
      EF.TELEPORT_LEVEL,
      env(state, { teleport: { changeLevel: (d) => (changed = d) } }),
      { origin: sourcePlayer() },
    );

    expect(caveFindDecoy(state)).toBeNull();
    expect(changed).toBeNull();
  });

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

describe("EF_ALTER_REALITY", () => {
  it("regenerates the current level in place", () => {
    const state = makeState();
    state.chunk.depth = 12;
    let changed: number | null = null;
    const msgs: string[] = [];
    registry().effectSimple(
      EF.ALTER_REALITY,
      env(state, { teleport: { changeLevel: (d) => (changed = d) } }, msgs),
      { origin: sourcePlayer() },
    );
    expect(changed).toBe(12);
    expect(msgs).toContain("The world changes!");
  });

  it("refuses inside a single-combat arena, without identifying", () => {
    /* effect-handler-general.c:1186-1187 returns BEFORE setting ident, so an
     * arena use neither regenerates the level nor teaches the scroll.
     * Regenerating here would have discarded the arena and the opponent. */
    const state = makeState();
    state.chunk.depth = 12;
    state.arenaLevel = true;
    let changed: number | null = null;
    const msgs: string[] = [];
    const ctx = env(state, { teleport: { changeLevel: (d) => (changed = d) } }, msgs);
    registry().effectSimple(EF.ALTER_REALITY, ctx, { origin: sourcePlayer() });
    expect(changed).toBeNull();
    expect(msgs).not.toContain("The world changes!");
  });
});

describe("EF_TELEPORT in an arena (effect-handler-general.c:2529-2530)", () => {
  it("does not move the player", () => {
    /* NOT ASSERTED HERE, and deliberately: upstream computes the distance
     * damroll in a local INITIALISER (L2510-2511), so it runs before the arena
     * refusal returns, and the port matches that. The ordering is not
     * observable through this seam - effectSimple does its own dice work
     * around the handler and dominates the stream - so it is recorded in
     * effect-teleport.ts rather than covered by a fixture that cannot tell the
     * two placements apart. Two placements were measured (28 vs 30 draws on
     * this fixture); no assertion available here distinguishes them. */
    const arena = makeState({ playerGrid: loc(20, 12), seed: 99 });
    arena.chunk.depth = 12;
    arena.arenaLevel = true;
    registry().effectSimple(EF.TELEPORT, env(arena), {
      origin: sourcePlayer(),
      diceString: "10+2d8",
    });
    expect(arena.actor.grid).toEqual(loc(20, 12));
  });

  it("still teleports with the flag clear, on the same setup", () => {
    const state = makeState({ playerGrid: loc(20, 12), seed: 99 });
    state.chunk.depth = 12;
    registry().effectSimple(EF.TELEPORT, env(state), {
      origin: sourcePlayer(),
      diceString: "10+2d8",
    });
    expect(state.actor.grid).not.toEqual(loc(20, 12));
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

/*
 * PORT_TODO 3.26. MSG_TELEPORT, MSG_TPOTHER and MSG_TPLEVEL sat in the
 * generated table with no caller: every teleport in the game was silent, and
 * `sound()` is not something a message test can notice. These assert the code
 * that reaches state.sound, which is the channel a sound pack subscribes to.
 */
function sounds(state: GameState): number[] {
  const out: number[] = [];
  state.sound = (type: number): void => void out.push(type);
  return out;
}

describe("teleport sounds (PORT_TODO 3.26)", () => {
  it("EF_TELEPORT plays MSG_TELEPORT when the player moves", () => {
    const state = makeState({ playerGrid: loc(20, 12), seed: 7 });
    const heard = sounds(state);
    registry().effectSimple(EF.TELEPORT, env(state), {
      origin: sourcePlayer(),
      diceString: "10",
    });
    expect(heard).toEqual([MSG.TELEPORT]);
  });

  it("EF_TELEPORT plays MSG_TPOTHER when a monster teleports itself", () => {
    const state = makeState({ playerGrid: loc(20, 12), seed: 11 });
    const mon = addMon(state, plainRace, loc(10, 10), { hp: 30 });
    const heard = sounds(state);
    registry().effectSimple(EF.TELEPORT, env(state), {
      origin: sourceMonster(mon.midx),
      diceString: "10",
      subtype: 0,
    });
    expect(heard).toEqual([MSG.TPOTHER]);
  });

  it("a blocked teleport is silent, because upstream's sound is past the return", () => {
    const start = loc(20, 12);
    const state = makeState({ playerGrid: start, seed: 7 });
    state.chunk.sqinfoOn(start, SQUARE.NO_TELEPORT);
    const heard = sounds(state);
    registry().effectSimple(EF.TELEPORT, env(state), {
      origin: sourcePlayer(),
      diceString: "100",
    });
    expect(heard).toEqual([]);
  });

  it("EF_TELEPORT_TO plays MSG_TELEPORT", () => {
    const state = makeState({ playerGrid: loc(20, 12), seed: 3 });
    const mon = addMon(state, plainRace, loc(26, 12), { hp: 30 });
    const heard = sounds(state);
    registry().effectSimple(
      EF.TELEPORT_TO,
      env(state, { teleport: {} }),
      { origin: sourcePlayer(), x: mon.grid.x, y: mon.grid.y },
    );
    expect(heard).toEqual([MSG.TELEPORT]);
  });

  it("EF_TELEPORT_LEVEL plays MSG_TPLEVEL and types the message with it", () => {
    const state = makeState();
    state.chunk.depth = 0;
    const heard = sounds(state);
    const typed: (string | undefined)[] = [];
    const base: EffectContext = {
      rng: state.rng,
      messages: { msg: (_t, msgt) => void typed.push(msgt) },
    };
    registry().effectSimple(
      EF.TELEPORT_LEVEL,
      attachGameEnv(base, {
        state,
        cast: { projections, maxRange: 20, playerActor: basicPlayerActor(state) },
        teleport: { changeLevel: () => {} },
      }),
      { origin: sourcePlayer() },
    );
    expect(heard).toEqual([MSG.TPLEVEL]);
    expect(typed).toEqual(["TPLEVEL"]);
  });

  it("teleportMonster plays MSG_TPOTHER, not the player's sound", () => {
    const state = makeState({ playerGrid: loc(20, 12), seed: 9 });
    const mon = addMon(state, plainRace, loc(10, 10), { hp: 30 });
    const heard = sounds(state);
    teleportMonster(state, mon.midx, 8, {});
    expect(heard).toEqual([MSG.TPOTHER]);
  });
});

/*
 * The three sound sites the first mutation pass could not kill, because
 * nothing anywhere drove them: teleportPlayer and teleportPlayerTo are only
 * reachable from PROJ_NEXUS's random branches (player-side.ts:394,405), and
 * the TPLEVEL "up" arm needs a depth the town test cannot have.
 */
describe("the teleport helpers PROJ_NEXUS dispatches to", () => {
  it("teleportPlayer plays MSG_TELEPORT and moves the player", () => {
    const start = loc(20, 12);
    const state = makeState({ playerGrid: start, seed: 13 });
    const heard = sounds(state);
    teleportPlayer(state, 20, {});
    expect(heard).toEqual([MSG.TELEPORT]);
    expect(locEq(state.actor.grid, start)).toBe(false);
  });

  it("teleportPlayerTo plays MSG_TELEPORT and lands near the aim", () => {
    const state = makeState({ playerGrid: loc(20, 12), seed: 5 });
    const aim = loc(30, 18);
    const heard = sounds(state);
    teleportPlayerTo(state, aim, {});
    expect(heard).toEqual([MSG.TELEPORT]);
    expect(distance(state.actor.grid, aim)).toBeLessThanOrEqual(2);
  });

  it("teleportPlayerLevel's UP arm plays MSG_TPLEVEL too, not just the down one", () => {
    const state = makeState();
    state.chunk.depth = 5;
    const heard = sounds(state);
    const said: [string, string | undefined][] = [];
    /* maxDepth 6 forces down false (depth >= maxDepth - 1), leaving up. */
    teleportPlayerLevel(
      state,
      { maxDepth: 6, changeLevel: () => {} },
      (t, msgt) => void said.push([t, msgt]),
      false,
    );
    expect(said).toEqual([["You rise up through the ceiling.", "TPLEVEL"]]);
    expect(heard).toEqual([MSG.TPLEVEL]);
  });
});
