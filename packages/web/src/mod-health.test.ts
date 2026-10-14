/**
 * The per-mod health monitor: fault counting, the three-in-200
 * switch-off and its sliding window, time budgets and the hard ceiling,
 * rejected promises, attribution, and the switch-off notice's wording.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_TURN_BUDGET_MS,
  FAULT_LIMIT,
  FAULT_WINDOW_TURNS,
  HARD_CEILING_MS,
  MAX_PERIOD_MS,
  ModHealthMonitor,
  ModSwitchedOffError,
  configureModHealth,
  manifestBudgetFor,
  modHealth,
  switchOffNotice,
  turnBudgetMs,
  type ModOverBudget,
  type ModSwitchOff,
} from "./mod-health";

/** A monitor on a hand-turned clock and turn counter. */
function rig(extra: { enforce?: boolean; budget?: number } = {}) {
  let turn = 0;
  let clock = 0;
  const offs: ModSwitchOff[] = [];
  const over: ModOverBudget[] = [];
  const monitor = new ModHealthMonitor({
    turn: () => turn,
    now: () => clock,
    enforce: extra.enforce ?? true,
    ...(extra.budget === undefined ? {} : { budgetFor: () => extra.budget! }),
    onSwitchOff: (off) => offs.push(off),
    onOverBudget: (r) => over.push(r),
  });
  return {
    monitor,
    offs,
    over,
    setTurn: (t: number) => {
      turn = t;
    },
    /** Move the fake clock without any mod code running. */
    wait: (ms: number) => {
      clock += ms;
    },
    /** A mod call that takes `ms` on the fake clock. */
    spend: (ms: number) => () => {
      clock += ms;
    },
    boom: (message = "boom") => () => {
      throw new Error(message);
    },
  };
}

function throwsAt(r: ReturnType<typeof rig>, id: string, turn: number): void {
  r.setTurn(turn);
  expect(() => r.monitor.run(id, "test hook", r.boom())).toThrow("boom");
}

describe("fault counting and switch-off", () => {
  it("switches a mod off on its third fault within the window, once", () => {
    const r = rig();
    throwsAt(r, "noisy", 10);
    throwsAt(r, "noisy", 20);
    expect(r.monitor.isOff("noisy")).toBe(false);
    throwsAt(r, "noisy", 30);
    expect(r.monitor.isOff("noisy")).toBe(true);
    expect(r.offs).toEqual([{ id: "noisy", site: "test hook", why: "boom", turn: 30 }]);
    expect(FAULT_LIMIT).toBe(3);
  });

  it("refuses a switched-off mod before its code runs", () => {
    const r = rig();
    for (const t of [1, 2, 3]) throwsAt(r, "noisy", t);
    const fn = vi.fn();
    expect(() => r.monitor.run("noisy", "test hook", fn)).toThrow(ModSwitchedOffError);
    expect(fn).not.toHaveBeenCalled();
  });

  it("still runs teardown for a switched-off mod when asked to", () => {
    const r = rig();
    for (const t of [1, 2, 3]) throwsAt(r, "noisy", t);
    const fn = vi.fn(() => "done");
    expect(r.monitor.run("noisy", "uninstall()", fn, { always: true })).toBe("done");
  });

  it("keeps faults apart per mod", () => {
    const r = rig();
    throwsAt(r, "a", 1);
    throwsAt(r, "b", 2);
    throwsAt(r, "a", 3);
    throwsAt(r, "b", 4);
    expect(r.monitor.isOff("a")).toBe(false);
    expect(r.monitor.isOff("b")).toBe(false);
    throwsAt(r, "a", 5);
    expect(r.monitor.isOff("a")).toBe(true);
    expect(r.monitor.isOff("b")).toBe(false);
  });

  it("counts but never switches off while enforcement is off", () => {
    const r = rig({ enforce: false });
    for (const t of [1, 2, 3, 4, 5]) throwsAt(r, "noisy", t);
    expect(r.monitor.isOff("noisy")).toBe(false);
    expect(r.offs).toEqual([]);
    expect(r.monitor.stats()[0]?.faults).toBe(5);
  });
});

describe("the sliding window", () => {
  it("forgets a fault once it is FAULT_WINDOW_TURNS turns old", () => {
    const r = rig();
    throwsAt(r, "noisy", 0);
    throwsAt(r, "noisy", 100);
    /* Turn 200: the fault at 0 has left the window, so this is the second. */
    throwsAt(r, "noisy", FAULT_WINDOW_TURNS);
    expect(r.monitor.isOff("noisy")).toBe(false);
    /* Turn 299: 100 and 200 are both still in, so this is the third. */
    throwsAt(r, "noisy", 299);
    expect(r.monitor.isOff("noisy")).toBe(true);
  });

  it("counts a fault 199 turns old", () => {
    const r = rig();
    throwsAt(r, "noisy", 0);
    throwsAt(r, "noisy", 1);
    throwsAt(r, "noisy", FAULT_WINDOW_TURNS - 1);
    expect(r.monitor.isOff("noisy")).toBe(true);
  });

  it("drops faults from a later turn than now (another character loaded)", () => {
    const r = rig();
    throwsAt(r, "noisy", 5000);
    throwsAt(r, "noisy", 5001);
    throwsAt(r, "noisy", 10);
    expect(r.monitor.isOff("noisy")).toBe(false);
  });

  it("keeps the session total on the profiler after faults leave the window", () => {
    const r = rig();
    throwsAt(r, "noisy", 0);
    throwsAt(r, "noisy", 500);
    throwsAt(r, "noisy", 1000);
    expect(r.monitor.isOff("noisy")).toBe(false);
    expect(r.monitor.stats()[0]?.faults).toBe(3);
  });
});

describe("rejected promises", () => {
  it("counts a rejection as a fault and hands the promise back unchanged", async () => {
    const r = rig();
    const promise = Promise.reject(new Error("later"));
    const back = r.monitor.run("async", "event listener", () => promise);
    expect(back).toBe(promise);
    await expect(back).rejects.toThrow("later");
    expect(r.monitor.stats()[0]?.faults).toBe(1);
  });

  it("switches off on three rejections", async () => {
    const r = rig();
    for (const t of [1, 2, 3]) {
      r.setTurn(t);
      const p = r.monitor.run("async", "event listener", () => Promise.reject(new Error(`no ${t}`)));
      await p.catch(() => undefined);
    }
    expect(r.monitor.isOff("async")).toBe(true);
    expect(r.offs[0]?.why).toBe("no 3");
  });

  it("does not count a resolved promise", async () => {
    const r = rig();
    await r.monitor.run("async", "event listener", () => Promise.resolve(1));
    expect(r.monitor.stats()[0]?.faults).toBe(0);
  });
});

describe("attribution and timing", () => {
  it("charges nested calls to the inner mod only", () => {
    const r = rig();
    r.monitor.run("outer", "register()", () => {
      r.spend(5)();
      r.monitor.run("inner", "shared value", r.spend(20));
      r.spend(3)();
    });
    const byId = new Map(r.monitor.stats().map((s) => [s.id, s]));
    expect(byId.get("outer")?.cpuMs).toBe(8);
    expect(byId.get("inner")?.cpuMs).toBe(20);
    expect(byId.get("inner")?.worstSite).toBe("shared value");
  });

  it("counts calls and keeps the worst one with its site", () => {
    const r = rig();
    r.monitor.run("m", "a", r.spend(2));
    r.monitor.run("m", "b", r.spend(9));
    r.monitor.run("m", "c", r.spend(4));
    const s = r.monitor.stats()[0]!;
    expect(s.calls).toBe(3);
    expect(s.cpuMs).toBe(15);
    expect(s.worstMs).toBe(9);
    expect(s.worstSite).toBe("b");
  });

  it("returns the mod's answer through the page monitor", () => {
    modHealth().reset();
    expect(modHealth().run("m", "test", () => 2 + 3)).toBe(5);
    expect(modHealth().stats()[0]?.calls).toBe(1);
  });

  it("adds Worker payload bytes and leaves them null where none was sent", () => {
    const r = rig();
    r.monitor.run("plain", "x", () => undefined);
    r.monitor.recordPayload("worker", 100);
    r.monitor.recordPayload("worker", 28);
    const byId = new Map(r.monitor.stats().map((s) => [s.id, s]));
    expect(byId.get("plain")?.payloadBytes).toBeNull();
    expect(byId.get("worker")?.payloadBytes).toBe(128);
  });
});

describe("time budgets", () => {
  it("reads the manifest of the named mod and keeps the default for undeclared budgets", () => {
    const manifests = [{ id: "slow", budget: { msPerTurn: 120 } }, { id: "plain" }, { id: "oversized", budget: { msPerTurn: 900 } }];
    expect(manifestBudgetFor("slow", manifests)).toBe(120);
    expect(manifestBudgetFor("plain", manifests)).toBe(50);
    expect(manifestBudgetFor("missing", manifests)).toBe(50);
    expect(manifestBudgetFor("oversized", manifests)).toBe(500);
  });
  it("defaults to 50 ms and caps a declared budget at 500 ms", () => {
    expect(DEFAULT_TURN_BUDGET_MS).toBe(50);
    expect(HARD_CEILING_MS).toBe(500);
    expect(turnBudgetMs()).toBe(50);
    expect(turnBudgetMs(120)).toBe(120);
    expect(turnBudgetMs(9000)).toBe(500);
    expect(turnBudgetMs(-1)).toBe(50);
    expect(turnBudgetMs(Number.NaN)).toBe(50);
  });

  it("records going over budget once per turn, summed across calls", () => {
    const r = rig();
    r.setTurn(1);
    r.monitor.run("slow", "a", r.spend(30));
    expect(r.over).toEqual([]);
    r.monitor.run("slow", "b", r.spend(30));
    r.monitor.run("slow", "c", r.spend(30));
    expect(r.over).toEqual([{ id: "slow", turn: 1, ms: 60, budgetMs: 50, ceiling: false }]);
    r.setTurn(2);
    r.monitor.run("slow", "a", r.spend(30));
    expect(r.over).toHaveLength(1);
    expect(r.monitor.stats()[0]?.overBudget).toBe(1);
    expect(r.monitor.stats()[0]?.faults).toBe(0);
  });

  it("starts a fresh period on newPeriod without a turn passing", () => {
    const r = rig();
    r.monitor.run("slow", "a", r.spend(40));
    r.monitor.newPeriod();
    r.monitor.run("slow", "a", r.spend(40));
    expect(r.over).toEqual([]);
  });

  it("starts a fresh period after MAX_PERIOD_MS of wall time with no turn", () => {
    const r = rig();
    r.monitor.run("idle-drawer", "frontend present", r.spend(30));
    r.wait(MAX_PERIOD_MS);
    r.monitor.run("idle-drawer", "frontend present", r.spend(30));
    expect(r.over).toEqual([]);
    r.monitor.run("idle-drawer", "frontend present", r.spend(30));
    expect(r.over).toHaveLength(1);
  });

  it("uses the budget the lookup gives", () => {
    const r = rig({ budget: 100 });
    r.monitor.run("slow", "a", r.spend(80));
    expect(r.over).toEqual([]);
    r.monitor.run("slow", "a", r.spend(30));
    expect(r.over[0]?.budgetMs).toBe(100);
  });

  it("lets the first ceiling breach in the window go and counts each later one as a fault", () => {
    const r = rig();
    r.setTurn(1);
    r.monitor.run("hog", "a", r.spend(HARD_CEILING_MS + 1));
    expect(r.over[0]?.ceiling).toBe(true);
    expect(r.over[0]?.budgetMs).toBe(HARD_CEILING_MS);
    expect(r.monitor.stats()[0]?.faults).toBe(0);
    r.setTurn(2);
    r.monitor.run("hog", "a", r.spend(HARD_CEILING_MS + 1));
    r.setTurn(3);
    r.monitor.run("hog", "a", r.spend(HARD_CEILING_MS + 1));
    expect(r.monitor.stats()[0]?.faults).toBe(2);
    expect(r.monitor.isOff("hog")).toBe(false);
    r.setTurn(4);
    r.monitor.run("hog", "a", r.spend(HARD_CEILING_MS + 1));
    expect(r.monitor.isOff("hog")).toBe(true);
    expect(r.offs[0]?.why).toMatch(/over the 500 ms limit/);
    expect(r.monitor.stats()[0]?.ceilingBreaches).toBe(4);
  });

  it("counts one breach per turn however many calls cross it", () => {
    const r = rig();
    r.setTurn(1);
    for (let i = 0; i < 5; i++) r.monitor.run("hog", "a", r.spend(150));
    expect(r.monitor.stats()[0]?.ceilingBreaches).toBe(1);
    expect(r.monitor.stats()[0]?.faults).toBe(0);
  });
});

describe("switchOffNotice", () => {
  const off: ModSwitchOff = { id: "kept-failing", site: "messageText hook", why: "x is undefined", turn: 9 };

  it("names the mod by its proper name and never by its id", () => {
    const text = switchOffNotice(off, "Better Messages").join("\n");
    expect(text).toMatch(/^Better Messages kept failing/);
    expect(text).not.toContain("kept-failing");
    expect(text).toContain("messageText hook");
    expect(text).toContain("x is undefined");
    expect(text).toMatch(/report/i);
  });

  it("is worded without a name when none is known", () => {
    const text = switchOffNotice(off, undefined).join("\n");
    expect(text).toMatch(/^A mod kept failing/);
    expect(text).not.toContain("kept-failing");
  });
});

describe("a Worker mod's broker figures", () => {
  it("keeps response latency, network time and stale replies apart from CPU time", () => {
    const r = rig();
    r.monitor.run("w", "Worker view.world", r.spend(2));
    r.monitor.recordReply("w", 4);
    r.monitor.recordReply("w", 10);
    r.monitor.recordNetWait("w", 250);
    r.monitor.recordStale("w");
    expect(r.monitor.stats()[0]).toMatchObject({ cpuMs: 2, replies: 2, replyMs: 14, worstReplyMs: 10, netMs: 250, stale: 1 });
  });

  it("switches a stalled Worker off at once, enforcement or not, with the stall notice", () => {
    const r = rig({ enforce: false });
    r.monitor.switchOff("w", "heartbeat", new Error("its Worker went 5 seconds without answering the game"));
    expect(r.monitor.isOff("w")).toBe(true);
    expect(r.offs).toMatchObject([{ id: "w", site: "heartbeat", reason: "stall" }]);
    expect(() => r.monitor.run("w", "Worker view.world", r.spend(1))).toThrow(ModSwitchedOffError);
    r.monitor.switchOff("w", "heartbeat", new Error("again"));
    expect(r.offs).toHaveLength(1);
    const text = switchOffNotice(r.offs[0]!, "Map Notes").join("\n");
    expect(text).toMatch(/^Map Notes stopped responding/u);
    expect(text).toContain("Its Worker went 5 seconds without answering the game, so the game stopped it.");
    expect(text).not.toContain("heartbeat");
    expect(text).not.toMatch(/failed \d+ times/u);
  });
});

describe("with no mods", () => {
  afterEach(() => {
    modHealth().reset();
  });

  it("has nothing to report and never calls its listeners", () => {
    const onSwitchOff = vi.fn();
    const onOverBudget = vi.fn();
    modHealth().reset();
    configureModHealth({ turn: () => 7, enforce: true, onSwitchOff, onOverBudget });
    modHealth().newPeriod();
    expect(modHealth().stats()).toEqual([]);
    expect(onSwitchOff).not.toHaveBeenCalled();
    expect(onOverBudget).not.toHaveBeenCalled();
  });
});
