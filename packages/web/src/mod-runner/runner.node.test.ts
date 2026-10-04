/**
 * The headless runner against real mod folders: the fixtures beside this
 * package's tests and tutorial 5 from samples/tutorials, loaded through the
 * game's own loader with nothing mocked.
 */

import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { headlessRunFormat, parseDocument, serializeDocument } from "@rpgm-tools/neo-angband-mod-sdk";
import type { HeadlessRunReport, ModFinding } from "@rpgm-tools/neo-angband-mod-sdk";
import { log } from "../logging";
import { nodeModsSource } from "./node-source";
import { runHeadless } from "./runner";

const REPO = fileURLToPath(new URL("../../../../", import.meta.url));
const FIXTURES = join(REPO, "packages", "web", "test-fixtures", "mod-runner");
const TUTORIAL_05 = join(REPO, "samples", "tutorials", "tutorial-05-hook-behaviour");

const fixture = (name: string): string => join(FIXTURES, name);

/** Run with the game's own error log kept quiet; a fixture that throws is the point. */
async function run(paths: readonly string[]): Promise<HeadlessRunReport> {
  const quiet = vi.spyOn(log, "error").mockImplementation(() => {});
  try {
    return await runHeadless({ source: nodeModsSource(paths) });
  } finally {
    quiet.mockRestore();
  }
}

function findingsOf(report: HeadlessRunReport, id: string): readonly ModFinding[] {
  return report.reports.find((r) => r.mod.id === id)?.findings ?? [];
}

const rules = (findings: readonly ModFinding[]): string[] => findings.map((f) => f.rule);

describe("the headless runner", () => {
  it("passes a known-good data mod that declares its gameplay change", async () => {
    const report = await run([fixture("good-data")]);
    expect(report.booted).toBe(true);
    expect(report.mods).toEqual([{ id: "runner-good-data", version: "1.0.0", runtime: "data", loaded: true }]);
    expect(findingsOf(report, "runner-good-data")).toEqual([]);
    expect(report.parity.outcome).toBe("not-applicable");
    expect(report.phases.filter((p) => p.outcome === "failed")).toEqual([]);
    expect(report.passed).toBe(true);
  });

  it("passes a known-good code mod, and its save matches the save with it off", async () => {
    const report = await run([TUTORIAL_05]);
    expect(report.booted).toBe(true);
    expect(report.mods).toEqual([
      { id: "tutorial-05-hook-behaviour", version: "1.0.0", runtime: "in-process", loaded: true },
    ]);
    expect(findingsOf(report, "tutorial-05-hook-behaviour")).toEqual([]);
    expect(report.parity.outcome).toBe("match");
    expect(report.parity.offDigest).toBe(report.parity.onDigest);
    const health = report.health.find((h) => h.id === "tutorial-05-hook-behaviour")!;
    expect(health.calls).toBeGreaterThan(0);
    expect(health.faults).toBe(0);
    expect(report.passed).toBe(true);
  });

  it("reports a listener that throws, and the mods after it still hear every event", async () => {
    const report = await run([fixture("thrower"), fixture("counter")]);
    expect(report.booted).toBe(true);
    const thrown = findingsOf(report, "runner-thrower");
    expect(rules(thrown)).toContain("runner/listener-fault");
    expect(thrown.find((f) => f.rule === "runner/listener-fault")!.message).toContain("the thrower listener broke");
    expect(findingsOf(report, "runner-counter")).toEqual([]);
    expect(report.events.emitted).toBeGreaterThan(0);
    expect(report.events.delivered).toBe(report.events.emitted);
    const thrower = report.health.find((h) => h.id === "runner-thrower")!;
    const counter = report.health.find((h) => h.id === "runner-counter")!;
    expect(thrower.faults).toBeGreaterThan(0);
    /* register() once per boot, then one call per arrival: the start, the stairs and the reload. */
    expect(counter.calls).toBeGreaterThanOrEqual(5);
    expect(counter.faults).toBe(0);
    expect(report.passed).toBe(false);
  });

  it("reports a listener added past the guard that stops an event reaching the rest", async () => {
    const report = await run([fixture("raw-listener"), fixture("counter")]);
    expect(report.events.delivered).toBeLessThan(report.events.emitted);
    const broken = findingsOf(report, "runner-raw-listener").find((f) => f.rule === "runner/event-isolation");
    expect(broken).toMatchObject({ severity: "serious", outcome: "found" });
    expect(broken!.message).toContain("the raw listener broke");
    expect(findingsOf(report, "runner-counter")).toEqual([]);
  });

  it("reports a mod that stalls past its per-turn budget", async () => {
    const report = await run([fixture("staller")]);
    const over = findingsOf(report, "runner-staller").find((f) => f.rule === "runner/over-budget");
    expect(over).toBeDefined();
    expect(over!.severity).toBe("warning");
    const health = report.health.find((h) => h.id === "runner-staller")!;
    expect(health.budgetMs).toBe(50);
    expect(health.overBudget).toBeGreaterThan(0);
    expect(health.worstMs).toBeGreaterThanOrEqual(80);
  });

  it("reports a mod that changes the game without declaring it", async () => {
    const report = await run([fixture("parity-liar")]);
    expect(report.parity.outcome).toBe("drift");
    expect(report.parity.offDigest).not.toBe(report.parity.onDigest);
    const drift = findingsOf(report, "runner-parity-liar").find((f) => f.rule === "runner/parity-drift");
    expect(drift).toMatchObject({ severity: "serious", kind: "packaging", outcome: "found" });
    expect(report.passed).toBe(false);
  });

  it("counts a capability the mod uses without declaring it", async () => {
    const report = await run([fixture("overreach")]);
    expect(rules(findingsOf(report, "runner-overreach"))).toContain("runner/capability-refused");
    /* Refused once per register(): at the start and again after the reload. */
    expect(report.health.find((h) => h.id === "runner-overreach")!.refusedCapabilities).toBe(2);
  });

  it("says a Worker-tier mod could not be checked rather than passing it", async () => {
    const report = await run([fixture("worker")]);
    const unsupported = findingsOf(report, "runner-worker").find((f) => f.rule === "runner/worker-unsupported");
    expect(unsupported).toMatchObject({ outcome: "could-not-check" });
    expect(unsupported!.message).toBe("Could not check: Worker tier not supported headless yet.");
    expect(report.phases).toContainEqual({
      name: "worker",
      outcome: "could-not-check",
      detail: "Worker tier not supported headless yet.",
    });
    expect(report.passed).toBe(false);
  });

  it("writes a report that validates against its format", async () => {
    const report = await run([fixture("thrower"), fixture("counter"), fixture("worker")]);
    const text = serializeDocument(headlessRunFormat, report);
    const read = parseDocument(text, headlessRunFormat);
    expect(read.ok).toBe(true);
    if (read.ok) expect(read.data).toEqual(report);
  });
});
