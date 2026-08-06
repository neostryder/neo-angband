import { describe, expect, it } from "vitest";
import { TMD } from "../generated/index.js";
import { loc } from "../loc.js";
import { createDefaultRegistry } from "./player-turn.js";
import {
  LOOP_STATUS,
  checkForPlayerInterrupt,
  decreaseTimeouts,
  playerAdjustHpPrecise,
  playerAdjustManaPrecise,
  processWorld,
  runGameLoop,
} from "./loop.js";
import { makePlayer, makeState } from "./harness.js";
import { installRunning } from "./player-path.js";
import type { GameState, InterruptResponse } from "./context.js";

describe("player_adjust_*_precise", () => {
  it("saturates the hp fixed-point accumulator at INT32_MIN", () => {
    /* reference/src/tests/player/util.c:160-167 */
    const p = makePlayer();
    p.chp = -32768;
    p.chpFrac = 0;
    p.mhp = 50;

    playerAdjustHpPrecise(p, -131072);

    expect(p.chp).toBe(-32768);
    expect(p.chpFrac).toBe(0);
  });

  it("uses the same int32 saturation before splitting mana", () => {
    const p = makePlayer();
    p.csp = 32767;
    p.cspFrac = 0;
    p.msp = 32767;

    expect(playerAdjustManaPrecise(p, 196608)).toBe(0);
    expect(p.csp).toBe(32767);
    expect(p.cspFrac).toBe(0);
  });
});

describe("runGameLoop", () => {
  it("a normal-speed walk advances the game turn by 10 and returns for input", () => {
    const state = makeState({
      playerGrid: loc(15, 10),
      speed: 110,
      commands: [{ code: "walk", dir: 6 }],
    });
    state.actor.energy = state.z.moveEnergy; /* ready to act */

    const status = runGameLoop(state, createDefaultRegistry());

    expect(status).toBe(LOOP_STATUS.INPUT);
    expect(state.actor.grid).toEqual(loc(16, 10));
    /* One normal action == move_energy / turn_energy(110) == 10 game turns. */
    expect(state.turn).toBe(10);
    expect(state.actor.energy).toBe(state.z.moveEnergy);
  });

  it("returns for input immediately when no command is queued", () => {
    const state = makeState({ commands: [] });
    state.actor.energy = state.z.moveEnergy;
    const status = runGameLoop(state, createDefaultRegistry());
    expect(status).toBe(LOOP_STATUS.INPUT);
    expect(state.turn).toBe(0);
  });

  it("signals a level change when the player descends", () => {
    const state = makeState({ commands: [{ code: "descend" }] });
    state.actor.energy = state.z.moveEnergy;
    const status = runGameLoop(state, createDefaultRegistry());
    expect(status).toBe(LOOP_STATUS.LEVEL_CHANGE);
    expect(state.generateLevel).toBe(true);
  });
});

/**
 * check_for_player_interrupt (ui-game.c:645-666), signalled by process_player at
 * game-world.c:937. Without it a run cannot be stopped by the player at all: the
 * engine re-queues CMD_RUN after every step (player-path.c run_step) and the loop
 * drains that queue without ever asking the host for anything.
 */
describe("check_for_player_interrupt", () => {
  /**
   * A state ready to run east across the open field, with a message sink and a
   * registry carrying the real running engine (installRunning replaces the
   * default registry's "run" stub).
   */
  function runner(): {
    state: ReturnType<typeof makeState>;
    reg: ReturnType<typeof createDefaultRegistry>;
    msgs: string[];
  } {
    const msgs: string[] = [];
    const state = makeState({
      playerGrid: loc(5, 10),
      commands: [{ code: "run", dir: 6 }],
    });
    state.actor.energy = state.z.moveEnergy;
    state.msg = (t: string): void => {
      msgs.push(t);
    };
    const reg = createDefaultRegistry();
    installRunning(reg);
    return { state, reg, msgs };
  }

  it("drives a whole run inside one call when no host hook is installed", () => {
    /* The headless contract: the CLI harnesses, the borg and every other test
     * see exactly the behaviour they saw before the seam existed. */
    const { state, reg } = runner();

    const status = runGameLoop(state, reg);

    expect(status).toBe(LOOP_STATUS.INPUT);
    expect(state.actor.grid.x).toBeGreaterThan(7); /* many steps, one call */
    expect(state.run?.running).toBe(0);
  });

  it("hands control back between run steps for a host that must poll", () => {
    const { state, reg } = runner();
    state.checkInterrupt = () => "pause";

    const first = runGameLoop(state, reg);

    /* One step taken, then PAUSE - and the continuation is still queued, which
     * is what makes the next call a resume rather than a restart. */
    expect(first).toBe(LOOP_STATUS.PAUSE);
    expect(state.actor.grid.x).toBe(6);
    expect(state.cmdQueue).toEqual([{ code: "run", dir: 0 }]);
    expect(state.run?.running).toBeGreaterThan(0);

    const second = runGameLoop(state, reg);
    expect(second).toBe(LOOP_STATUS.PAUSE);
    expect(state.actor.grid.x).toBe(7);
  });

  it("pumping a run step by step lands exactly where one call would", () => {
    /* The equivalence proof: pausing must consume nothing and decide nothing. */
    const solo = runner();
    runGameLoop(solo.state, solo.reg);

    const { state, reg } = runner();
    state.checkInterrupt = () => "pause";
    let status = runGameLoop(state, reg);
    let pumps = 1;
    while (status === LOOP_STATUS.PAUSE && pumps < 500) {
      status = runGameLoop(state, reg);
      pumps++;
    }

    expect(status).toBe(LOOP_STATUS.INPUT);
    expect(pumps).toBeGreaterThan(1); /* it really was pumped, not run once */
    expect(state.actor.grid).toEqual(solo.state.actor.grid);
    expect(state.turn).toBe(solo.state.turn);
  });

  it("cancels the run on a keypress, saying so (ui-game.c:663)", () => {
    const { state, reg, msgs } = runner();
    let polls = 0;
    state.checkInterrupt = () => (++polls === 1 ? "cancel" : "pause");

    const status = runGameLoop(state, reg);

    /* disturb() flushed the queued continuation, so the loop went straight back
     * for input with the player one step along. */
    expect(status).toBe(LOOP_STATUS.INPUT);
    expect(msgs).toContain("Cancelled.");
    expect(state.run?.running).toBe(0);
    expect(state.cmdQueue ?? []).toEqual([]);
    expect(state.actor.grid.x).toBe(6);
  });

  it("never pauses outside a run, a repeat or a rest (the C's gate)", () => {
    /* A single walk must not be pumped: the gate is what keeps ordinary play
     * synchronous, and a host answering "pause" unconditionally proves it. */
    const state = makeState({
      playerGrid: loc(5, 10),
      commands: [{ code: "walk", dir: 6 }],
    });
    state.actor.energy = state.z.moveEnergy;
    state.checkInterrupt = () => "pause";

    expect(runGameLoop(state, createDefaultRegistry())).toBe(LOOP_STATUS.INPUT);
    expect(state.actor.grid).toEqual(loc(6, 10));
  });

  /* The three arms of the C's gate, read straight off the function: only a run,
   * a pending repeat or a rest on a 128-game-turn boundary polls the keyboard at
   * all. Exercised directly because the repeat and rest arms need a command that
   * keeps re-queueing itself, and in this port the rest lifecycle lives in the
   * host (WP-11) rather than in the loop. */
  describe("the gate", () => {
    /** A RunState with `running` steps left and nothing else going on. */
    function runState(running: number): NonNullable<GameState["run"]> {
      return {
        curDir: 6,
        oldDir: 0,
        openArea: true,
        breakRight: false,
        breakLeft: false,
        running,
        firstStep: false,
        stepCount: 0,
      };
    }

    /** A polling host that records how often it was asked. */
    function polled(state: GameState): () => number {
      let polls = 0;
      state.checkInterrupt = (): InterruptResponse => {
        polls++;
        return "pause";
      };
      return () => polls;
    }

    it("never polls the keyboard during ordinary play", () => {
      const state = makeState();
      const polls = polled(state);
      expect(checkForPlayerInterrupt(state)).toBe("go");
      expect(polls()).toBe(0);
    });

    it("polls while running (player->upkeep->running)", () => {
      const state = makeState();
      const polls = polled(state);
      state.run = runState(5);
      expect(checkForPlayerInterrupt(state)).toBe("pause");
      expect(polls()).toBe(1);
    });

    it("polls while a repeat is pending (cmd_get_nrepeats() > 0)", () => {
      /* nrepeats lives on the queued command in this port, so a pending repeat
       * is one sitting in cmdQueue with repeatRemaining left. */
      const state = makeState();
      polled(state);
      state.cmdQueue = [{ code: "tunnel", dir: 6, repeatRemaining: 2 }];
      expect(checkForPlayerInterrupt(state)).toBe("pause");

      /* A queued command with no repeats left is not a repeat. */
      state.cmdQueue = [{ code: "tunnel", dir: 6 }];
      expect(checkForPlayerInterrupt(state)).toBe("go");
    });

    it("polls only every 128th game turn while resting", () => {
      const state = makeState();
      polled(state);
      state.resting = { count: 20, turnsRested: 0 };

      state.turn = 256; /* !(turn & 0x7F) */
      expect(checkForPlayerInterrupt(state)).toBe("pause");
      state.turn = 257;
      expect(checkForPlayerInterrupt(state)).toBe("go");
      state.turn = 384;
      expect(checkForPlayerInterrupt(state)).toBe("pause");
    });

    it("flushes, disturbs and says Cancelled. on a key (ui-game.c:660-663)", () => {
      const msgs: string[] = [];
      const state = makeState();
      state.msg = (t: string): void => {
      msgs.push(t);
    };
      state.run = runState(5);
      state.cmdQueue = [{ code: "run", dir: 0 }];
      state.checkInterrupt = () => "cancel";

      /* "go", not "cancel": the C keeps going into process_player's command
       * loop, which finds the flushed queue empty and asks for a new command. */
      expect(checkForPlayerInterrupt(state)).toBe("go");
      expect(msgs).toEqual(["Cancelled."]);
      expect(state.run.running).toBe(0);
      expect(state.cmdQueue).toEqual([]);
    });
  });
});

describe("process_world upkeep", () => {
  it("regenerates HP with the exact fixed-point formula when hurt and fed", () => {
    const state = makeState();
    const p = state.actor.player;
    p.mhp = 1000;
    p.chp = 500;
    p.chpFrac = 0;
    p.timed[TMD.FOOD] = 5000; /* Full: PY_REGEN_NORMAL with fed bonus */

    processWorld(state);

    /* percent = 197 * (100 + floor(50/3)) / 100 = 228; gain = 1000*228 + 1442. */
    expect(p.chp).toBe(503);
    expect(p.chpFrac).toBe(32834);
  });

  it("does not regenerate HP at full health", () => {
    const state = makeState();
    const p = state.actor.player;
    p.mhp = 1000;
    p.chp = 1000;
    p.chpFrac = 0;
    p.timed[TMD.FOOD] = 5000; /* fed, so no starvation damage confounds this */
    processWorld(state);
    expect(p.chp).toBe(1000);
    expect(p.chpFrac).toBe(0);
  });

  it("regenerates HP on the ten-turn cadence during the loop", () => {
    const state = makeState({
      playerGrid: loc(15, 10),
      commands: [{ code: "walk", dir: 6 }],
    });
    state.actor.energy = state.z.moveEnergy;
    const p = state.actor.player;
    p.mhp = 1000;
    p.chp = 500;
    p.chpFrac = 0;
    p.timed[TMD.FOOD] = 5000;

    runGameLoop(state, createDefaultRegistry());

    /* process_world ran once during the 10-turn advance (at turn 0). */
    expect(p.chp).toBeGreaterThan(500);
  });

  it("counts timed effects down (food is exempt)", () => {
    const state = makeState();
    const p = state.actor.player;
    p.timed[TMD.AFRAID] = 5;
    p.timed[TMD.FOOD] = 5000;

    decreaseTimeouts(state);

    expect(p.timed[TMD.AFRAID]).toBe(4);
    expect(p.timed[TMD.FOOD]).toBe(5000);
  });
});

/**
 * daycount (game-world.c:572), PORT_TODO 5.9.
 *
 * The accumulator was already here; nothing tested it. The row that tracked it
 * said "there is no daycount in packages/core or packages/web", which is how a
 * built-but-unproven feature ends up on a work list - so these are the two
 * assertions that would have answered the question by running the code.
 */
describe("daycount accrues in the dungeon only (game-world.c:572)", () => {
  it("ticks once per store day below town, and never in town", () => {
    const deep = makeState();
    deep.chunk.depth = 5;
    deep.turn = 10 * deep.z.storeTurns;
    processWorld(deep);
    expect(deep.daycount).toBe(1);

    /* The very next world tick is not a multiple, so nothing accrues. */
    deep.turn += 10;
    processWorld(deep);
    expect(deep.daycount).toBe(1);

    deep.turn = 20 * deep.z.storeTurns;
    processWorld(deep);
    expect(deep.daycount).toBe(2);

    /* In town the same turn number takes the daybreak branch instead
     * (game-world.c:545-573 is an if/else), so the shops age only while the
     * player is away - which is the whole point of deferring the update. */
    const town = makeState();
    town.chunk.depth = 0;
    town.turn = 10 * town.z.storeTurns;
    processWorld(town);
    expect(town.daycount ?? 0).toBe(0);
  });
});
