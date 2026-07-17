/**
 * Golden-scenario runner - the port's answer to upstream's main-test.c
 * scripted play.
 *
 * Each scenario births a game from a FIXED seed, drives the real turn loop
 * (startGame + runGameLoop + the command queue - the same seam the web shell
 * and the Borg mod use) through a fixed command sequence, and asserts a
 * deterministic end-state. These are end-to-end smoke tests of the whole loop:
 * birth -> command -> world upkeep -> outcome, with no web/DOM.
 *
 * Expected end-state constants are captured from the port at the pinned seed
 * and asserted exactly, so a change that perturbs the loop (movement, energy,
 * item use, level change) trips a scenario. They are deterministic by
 * construction (decision 22: the engine is a function of the seed).
 */

import {
  LOOP_STATUS,
  gearGet,
  runGameLoop,
  startGame,
  TMD,
} from "@neo-angband/core";
import type { GamePack, PlayerCommand } from "@neo-angband/core";

/** The outcome of one scenario. */
export interface ScenarioResult {
  name: string;
  ok: boolean;
  /** Human-readable failed assertions (empty when ok). */
  failures: string[];
  /** Observed end-state values, surfaced for the terminal and for debugging. */
  observed: Record<string, unknown>;
}

/** A small assertion collector so one scenario reports every failure at once. */
class Checks {
  readonly failures: string[] = [];
  readonly observed: Record<string, unknown> = {};

  eq(label: string, actual: unknown, expected: unknown): void {
    this.observed[label] = actual;
    if (!Object.is(actual, expected)) {
      this.failures.push(`${label}: expected ${String(expected)}, got ${String(actual)}`);
    }
  }

  ok(label: string, cond: boolean, detail?: string): void {
    this.observed[label] = cond;
    if (!cond) this.failures.push(`${label}: ${detail ?? "expected true"}`);
  }
}

/** Feed a fixed command list to state.nextCommand, one per loop step. */
function queue(commands: PlayerCommand[]): () => PlayerCommand | null {
  const q = [...commands];
  return () => q.shift() ?? null;
}

/**
 * Scenario 1: a Human Warrior is born at depth 1, waits five turns, and stays
 * put and alive with an advanced world clock. Exercises birth + world upkeep +
 * the "hold" command through the loop.
 */
function scenarioBirthAndWait(pack: GamePack): ScenarioResult {
  const c = new Checks();
  const game = startGame(pack, { seed: 20260715, depth: 1 });
  const { state, registry } = game;
  const spawn = { ...state.actor.grid };

  c.eq("level", state.actor.player.lev, 1);
  c.eq("speed", state.actor.speed, 110); // Human Warrior base.
  c.ok("mhp>0", state.actor.player.mhp > 0);

  state.nextCommand = queue([
    { code: "hold" },
    { code: "hold" },
    { code: "hold" },
    { code: "hold" },
    { code: "hold" },
  ]);
  const status = runGameLoop(state, registry);

  c.eq("loopStatus", status, LOOP_STATUS.INPUT);
  c.eq("alive", state.actor.player.chp > 0 && !state.isDead, true);
  c.eq("stayedPut.x", state.actor.grid.x, spawn.x);
  c.eq("stayedPut.y", state.actor.grid.y, spawn.y);
  c.eq("turn", state.turn, EXPECTED.birthAndWait.turn);
  c.eq("mhp", state.actor.player.mhp, EXPECTED.birthAndWait.mhp);

  return { name: "birth-and-wait", ok: c.failures.length === 0, failures: c.failures, observed: c.observed };
}

/**
 * Scenario 2: a born Warrior quaffs its starting Berserk Strength potion and
 * is healed and enraged. Exercises the object-command effect stack end to end
 * (cmd-obj.c quaff -> the effect interpreter -> timed-effect + heal).
 */
function scenarioQuaffBerserk(pack: GamePack): ScenarioResult {
  const c = new Checks();
  const game = startGame(pack, { seed: 20260715, depth: 1 });
  const { state, registry } = game;
  const p = state.actor.player;

  const handle = state.gear.pack.find((h) => {
    const o = gearGet(state.gear, h);
    return o !== null && o.kind.name === "Berserk Strength";
  });
  c.ok("hasBerserkPotion", handle !== undefined);
  if (handle === undefined) {
    return { name: "quaff-berserk", ok: false, failures: c.failures, observed: c.observed };
  }

  p.chp = 1; // hurt, so the heal is observable.
  state.nextCommand = queue([{ code: "quaff", args: { handle } }]);
  runGameLoop(state, registry);

  c.ok("healed", p.chp > 1, `chp=${p.chp}`);
  c.ok("berserkRunning", (p.timed[TMD.SHERO] ?? 0) > 0, `SHERO=${p.timed[TMD.SHERO]}`);

  return { name: "quaff-berserk", ok: c.failures.length === 0, failures: c.failures, observed: c.observed };
}

/**
 * Scenario 3: descending from depth 1 to depth 2 rebuilds the level in place -
 * the same GameState, a deeper chunk, the player re-placed, max_depth tracked -
 * and the loop keeps running on the new level. Exercises the changeLevel seam
 * (dungeon_change_level + prepare_next_level) plus loop continuity.
 */
function scenarioDescend(pack: GamePack): ScenarioResult {
  const c = new Checks();
  const game = startGame(pack, { seed: 20260715, depth: 1 });
  const { state, registry } = game;

  c.eq("startDepth", state.chunk.depth, 1);
  game.changeLevel(2);
  state.generateLevel = false;

  c.eq("newDepth", state.chunk.depth, 2);
  c.eq("maxDepth", state.actor.player.maxDepth, 2);
  c.ok("playerPlaced", state.chunk.mon(state.actor.grid) === -1, "player marker missing");
  c.ok("monstersPopulated", state.monsters.length > 1, `monsters=${state.monsters.length}`);

  const turnBefore = state.turn;
  state.nextCommand = queue([{ code: "hold" }]);
  const status = runGameLoop(state, registry);
  c.eq("loopStatus", status, LOOP_STATUS.INPUT);
  c.ok("loopAdvanced", state.turn > turnBefore, `turn ${turnBefore}->${state.turn}`);
  c.eq("monsterCount", state.monsters.length, EXPECTED.descend.monsterCount);

  return { name: "descend", ok: c.failures.length === 0, failures: c.failures, observed: c.observed };
}

/**
 * Captured golden end-state values (port, pinned seeds). Regenerate with
 * `pnpm --filter @neo-angband/cli scenarios --print` and paste the observed
 * numbers here if an intentional change moves them.
 */
const EXPECTED = {
  birthAndWait: { turn: 60, mhp: 19 },
  descend: { monsterCount: 35 },
} as const;

/** Run every golden scenario and return their results. */
export function runScenarios(pack: GamePack): ScenarioResult[] {
  return [
    scenarioBirthAndWait(pack),
    scenarioQuaffBerserk(pack),
    scenarioDescend(pack),
  ];
}

/** Render scenario results as a short human-readable report. */
export function formatScenarioResults(results: ScenarioResult[]): string {
  const lines: string[] = [];
  for (const r of results) {
    lines.push(`${r.ok ? "PASS" : "FAIL"}  ${r.name}`);
    for (const f of r.failures) lines.push(`      - ${f}`);
  }
  const passed = results.filter((r) => r.ok).length;
  lines.push(`scenarios: ${passed}/${results.length} passed`);
  return lines.join("\n");
}
