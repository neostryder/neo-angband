import { describe, expect, it, vi } from "vitest";
import {
  createAgentView,
  HIST,
  startGame,
  totalPoints,
  type GameState,
  type HistoryInfo,
  type ObjectInfoExtras,
} from "@rpgm-tools/neo-angband-core";
import { loadGamePack } from "./pack";
import { buildRunReport, characterHistory, createRunReports, RUN_REPORT_MESSAGES } from "./run-report";
import { log } from "./logging";
import { MessageLog } from "./messages";

const { state, booted } = startGame(loadGamePack(), { seed: 99, depth: 3 });

const extras: ObjectInfoExtras = {
  projections: booted.registries.projections ?? [],
  constants: booted.registries.constants,
  timedDesc: (i) => state.world?.timedTable[i]?.desc ?? "",
  summonDesc: (i) => booted.registries.monsters.summons[i]?.desc ?? "",
};

function entry(type: number, event: string, extra = 0): HistoryInfo {
  return { type: (1 << type) | extra, dlev: 4, clev: 7, aIdx: 0, turn: 1234, event };
}

describe("ctx.character.history (characterHistory)", () => {
  it("names each entry's kind and keeps the screen's text", () => {
    const p = state.actor.player;
    const saved = p.hist;
    p.hist = [
      entry(HIST.PLAYER_BIRTH, "Began the quest."),
      entry(HIST.GAIN_LEVEL, "Reached level 7"),
      entry(HIST.SLAY_UNIQUE, "Killed Grip, Farmer Maggot's Dog"),
      entry(HIST.ARTIFACT_KNOWN, "Found the Phial of Galadriel", 1 << HIST.ARTIFACT_LOST),
      entry(HIST.USER_INPUT, "A note of my own"),
    ];
    try {
      const history = characterHistory(state);
      expect(history.map((e) => e.kind)).toEqual(["birth", "level", "unique", "artifact", "note"]);
      expect(history[3]).toEqual({
        kind: "artifact",
        text: "Found the Phial of Galadriel",
        turn: 1234,
        depth: 4,
        level: 7,
        lost: true,
      });
      expect(history[0]!.lost).toBe(false);
      expect(Object.isFrozen(history[0])).toBe(true);
    } finally {
      p.hist = saved;
    }
  });

  it("shows a display hook's text, as the history screen does", () => {
    const p = state.actor.player;
    const saved = { hist: p.hist, hooks: state.modHooks };
    p.hist = [entry(HIST.USER_INPUT, "raw")];
    (state as { modHooks: GameState["modHooks"] }).modHooks = {
      ...state.modHooks,
      historyDisplay: () => "expanded",
    } as GameState["modHooks"];
    try {
      expect(characterHistory(state)[0]!.text).toBe("expanded");
    } finally {
      p.hist = saved.hist;
      (state as { modHooks: GameState["modHooks"] }).modHooks = saved.hooks;
    }
  });
});

describe("buildRunReport", () => {
  const view = () => createAgentView(state, undefined, {
    reg: booted.registries.objects,
    inspect: {
      objectInfo: extras,
      races: booted.registries.monsters.races,
      loreDeps: () => ({}) as never,
      projections: booted.registries.projections ?? [],
    },
  });

  it("copies the run's facts, belongings and last messages into one frozen value", () => {
    const p = state.actor.player;
    p.diedFrom = "a Cave spider";
    const log = new MessageLog();
    for (let i = 0; i < RUN_REPORT_MESSAGES + 5; i++) log.push(`message ${i}`);
    log.push("You die.");
    const report = buildRunReport({
      state,
      view: view(),
      messages: log.all(),
      key: "lineage-1",
      sheet: null,
      scored: true,
      endedAt: 42,
    });
    expect(report).toMatchObject({
      outcome: "death",
      cause: "a Cave spider",
      key: "lineage-1",
      race: p.race.name,
      cls: p.cls.name,
      level: p.lev,
      maxDepth: p.maxDepth,
      depth: state.chunk.depth,
      gold: p.au,
      turn: state.turn,
      score: totalPoints(p),
      scored: true,
      endedAt: 42,
    });
    expect(report.messages).toHaveLength(RUN_REPORT_MESSAGES);
    expect(report.messages.at(-1)).toEqual({ text: "You die.", count: 1 });

    const carried = view().equipment().filter(Boolean).length + view().inventory().length;
    expect(report.belongings.filter((b) => b.location !== "home").length).toBeGreaterThanOrEqual(carried);
    expect(report.belongings.length).toBeGreaterThan(0);
    const first = report.belongings[0]!;
    expect(first.recall?.title).toBeTruthy();
    expect(Object.isFrozen(report.belongings)).toBe(true);
    expect(Object.isFrozen(first)).toBe(true);
  });

  it("reads a winner and a retirement from the cause and the winner flag", () => {
    const p = state.actor.player;
    const saved = { winner: p.totalWinner, cause: p.diedFrom };
    const input = { state, view: view(), messages: [], key: null, sheet: null, scored: false, endedAt: 0 };
    try {
      p.diedFrom = "Retiring";
      expect(buildRunReport(input).outcome).toBe("retired");
      p.diedFrom = "Ripe Old Age";
      p.totalWinner = true;
      expect(buildRunReport(input).outcome).toBe("winner");
    } finally {
      p.totalWinner = saved.winner;
      p.diedFrom = saved.cause;
    }
  });
});

describe("createRunReports", () => {
  it("keeps the latest report and tells each listener once, past a failing one", () => {
    const reports = createRunReports();
    expect(reports.last()).toBeNull();
    const seen = vi.fn();
    const error = vi.spyOn(log, "error").mockImplementation(() => {});
    reports.onEnd(() => {
      throw new Error("broken mod");
    });
    const off = reports.onEnd(seen);
    const report = { outcome: "death" } as never;
    reports.publish(report);
    expect(seen).toHaveBeenCalledWith(report);
    expect(reports.last()).toBe(report);
    off();
    reports.publish(report);
    expect(seen).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
