/**
 * The headless runner against real mod folders: the fixtures beside this
 * package's tests and tutorial 5 from samples/tutorials, loaded through the
 * game's own loader with nothing mocked.
 */

import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { describe, expect, it, vi } from "vitest";
import { CapabilitySet, headlessRunFormat, parseDocument, serializeDocument } from "@rpgm-tools/neo-angband-mod-sdk";
import type { HeadlessRunReport, ModFinding } from "@rpgm-tools/neo-angband-mod-sdk";
import { log } from "../logging";
import { nodeModsSource } from "./node-source";
import { runHeadless } from "./runner";
import type { ModPlugin } from "../mod-plugin";
import { api2Plugin } from "../mod-api2-shim";

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

async function withPlugin(files: Record<string, string>, check: (folder: string) => Promise<void>): Promise<void> {
  const folder = mkdtempSync(join(tmpdir(), "neo-runner-"));
  try {
    writeFileSync(join(folder, "manifest.json"), JSON.stringify({
      format: "neo-angband/mod/manifest", schemaVersion: 1,
      data: { id: "runner-probe", name: "Runner probe", version: "1.0.0", shape: "plugin", modApi: 1 },
    }));
    for (const [file, content] of Object.entries(files)) writeFileSync(join(folder, file), content);
    await check(folder);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

async function probe(plugin: ModPlugin): Promise<HeadlessRunReport> {
  return await runHeadless({ source: nodeModsSource([fixture("counter")]), importer: async () => ({ default: plugin }) });
}

describe("the headless runner", () => {
  it("loads an API 2 folder and registers through engine.core during composition", async () => {
    const source = nodeModsSource([fixture("counter")]);
    let compositions = 0;
    let starts = 0;
    const report = await runHeadless({ source: { ...source, readJson: async (id, file) => file === "manifest.json" ? {
      format: "neo-angband/mod/manifest", schemaVersion: 2,
      data: { id, name: "Engine probe", version: "1.0.0", facets: ["plugin"], runtime: "in-process", api: ">=2.0.0 <3.0.0", capabilities: ["engine:access"] },
    } : source.readJson(id, file) }, importer: async () => ({ default: {
      api: ">=2.0.0 <3.0.0",
      hooks: ({ engine }: import("@rpgm-tools/neo-angband-mod-sdk").Api2HookContext) => {
        if (!engine) throw new Error("no engine during composition");
        engine.core.effectInfoRegistry().subtype.set("engine-probe", () => 7);
        compositions += 1;
        return {};
      },
      start: (mod: import("@rpgm-tools/neo-angband-mod-sdk").ModApi2) => {
        if (mod.engine?.core.effectInfoRegistry().subtype.handlerFor("engine-probe")?.("probe", {} as never) !== 7) throw new Error("composition registration was lost");
        starts += 1;
      },
    } }) });
    expect(report.passed).toBe(true);
    expect(compositions).toBeGreaterThan(0);
    expect(starts).toBe(2);
  });

  it("runs a first-party API 2 toy controller through the legacy controller seam", async () => {
    let decisions = 0;
    const caps = CapabilitySet.fromManifest({ id: "runner-counter", name: "Controller probe", version: "1.0.0", shape: "plugin", capabilities: ["input:intent", "state:*.read"] });
    const plugin = api2Plugin({ api: ">=2.0.0 <3.0.0", controller: (mod, input) => {
      decisions += 1;
      void mod.act.submit(input.token, { kind: "command", command: { code: "hold" } });
    } }, () => ({ grants: caps, tier: "first-party" }));
    const source = nodeModsSource([fixture("counter")]);
    const report = await runHeadless({ source: { ...source, readJson: async (id, file) => {
      const value = await source.readJson(id, file);
      return file === "manifest.json" ? { ...(value as Record<string, unknown>), affectsGameplay: true,
        capabilities: ["command:add", "input:intent", "state:*.read"] } : value;
    } }, importer: async () => ({ default: plugin }) });
    expect(report.passed).toBe(true);
    expect(decisions).toBeGreaterThan(5);
    expect(report.health[0]!.faults).toBe(0);
  });
  it("retains invalid manifest candidates", async () => {
    const source = nodeModsSource([fixture("counter")]);
    const report = await runHeadless({ source: { ...source, readJson: async () => ({}) } });
    expect(report.mods).toContainEqual({ id: "runner-counter", runtime: "data", loaded: false });
    expect(rules(findingsOf(report, "runner-counter"))).toContain("runner/load-problem");
    expect(report.passed).toBe(false);
  });

  it("fails unreadable directories and retains the load error", async () => {
    const source = nodeModsSource([]);
    const report = await runHeadless({ source: { ...source, list: async () => { throw new Error("directory denied"); } } });
    expect(report.phases).toContainEqual({ name: "load", outcome: "failed", detail: expect.stringContaining("directory denied") });
    expect(report.passed).toBe(false);
  });

  /* The CLI starts its own Vite loader, so its deadline includes a cold module graph. */
  it.each([
    ["during import", 'Promise.reject("broken import"); await new Promise((resolve) => setTimeout(resolve, 30)); export default { api: 1, register() {} };'],
    ["during registration", 'export default { api: 1, register() { Promise.reject("broken registration"); } };'],
    ["after a delayed callback", 'export default { api: 1, register() { setTimeout(() => Promise.reject("broken delay"), 500); } };'],
  ])("fails unattributed rejections %s", async (_when, content) => {
    await withPlugin({ "plugin.js": content }, async (folder) => {
      const result = spawnSync(process.execPath, [join(REPO, "packages/web/scripts/mod-runner.mjs"), folder], {
        cwd: REPO, encoding: "utf8", windowsHide: true, timeout: 90000,
      });
      expect(result.error).toBeUndefined();
      const report = JSON.parse(result.stdout).data as HeadlessRunReport;
      expect(report.unattributedRejections, JSON.stringify(report.reports)).toBeGreaterThan(0);
      expect(report.passed).toBe(false);
      expect(result.status).toBe(1);
    });
  }, 95000);

  it("waits for returned callback promises", async () => {
    const report = await probe({ api: 1, register: (() => new Promise((_resolve, reject) => {
      setTimeout(() => reject(new Error("delayed returned failure")), 500);
    })) as NonNullable<ModPlugin["register"]> });
    await new Promise((resolve) => setTimeout(resolve, 600));
    expect(rules(findingsOf(report, "runner-counter"))).toContain("runner/unhandled-rejection");
    expect(report.passed).toBe(false);
  });

  it("fails callback promises that exceed the completion deadline", async () => {
    const report = await probe({ api: 1, register: (() => new Promise(() => {})) as NonNullable<ModPlugin["register"]> });
    expect(rules(findingsOf(report, "runner-counter"))).toContain("runner/async-unfinished");
    expect(report.passed).toBe(false);
  });

  it.each(["throws", "omits a result"])("fails a Worker host that %s", async (failure) => {
    const report = await runHeadless({ source: nodeModsSource([fixture("worker")]), workerHost: {
      check: async () => {
        if (failure === "throws") throw new Error("Worker check failed");
        return new Map();
      },
    } });
    expect(report.phases).toContainEqual({ name: "worker", outcome: "failed", detail: expect.any(String) });
    expect(report.passed).toBe(false);
  });

  it("accepts an explicit result for every Worker", async () => {
    const report = await runHeadless({ source: nodeModsSource([fixture("worker")]), workerHost: {
      check: async () => new Map([["runner-worker", []]]),
    } });
    expect(report.phases).toContainEqual({ name: "worker", outcome: "passed" });
    expect(report.passed).toBe(true);
  });

  it("registers plugins in enabled order", async () => {
    const registered: string[] = [];
    await runHeadless({
      source: nodeModsSource([fixture("counter"), fixture("thrower")]),
      enable: ["runner-thrower", "runner-counter"],
      importer: async (url) => ({ default: { api: 1, register() { registered.push(url.includes("thrower") ? "thrower" : "counter"); } } }),
    });
    expect(registered).toEqual(["thrower", "counter", "thrower", "counter"]);
  });

  it("preserves character storage through save and reload", async () => {
    const values: unknown[] = [];
    const report = await probe({ api: 1, register(_host, ctx) {
      values.push(ctx.characterStore?.get());
      ctx.characterStore!.set({ saved: true });
    } });
    expect(values).toEqual([null, { saved: true }]);
    expect(rules(findingsOf(report, "runner-counter"))).not.toContain("runner/register-fault");
    expect(report.passed).toBe(true);
  });

  it("starts a fresh module graph for repeated runs", async () => {
    await withPlugin({
      "state.mjs": "export const seen = new Set();",
      "plugin.js": 'import { seen } from "./state.mjs"; export default { api: 1, register(_host, ctx) { if (seen.has(ctx.newCharacter)) throw new Error("stale module state"); seen.add(ctx.newCharacter); } };',
    }, async (folder) => {
      const first = await run([folder]);
      const second = await run([folder]);
      expect(first.passed).toBe(true);
      expect(rules(findingsOf(second, "runner-probe"))).not.toContain("runner/register-fault");
      expect(second.passed).toBe(true);
    });
  });

  it("tears down after a session failure and records cleanup faults", async () => {
    const listener = (): void => {};
    const quiet = vi.spyOn(log, "error").mockImplementation(() => {});
    let uninstalled = 0;
    try {
      const report = await probe({ api: 1, register(_host, ctx) {
        process.on("beforeExit", listener);
        ctx.state!.onEventFault = (_type, error) => { throw error; };
        ctx.state!.events!.on("dungeonlevel", () => { throw new Error("session failed"); });
      }, uninstall() {
        process.off("beforeExit", listener);
        uninstalled += 1;
        throw new Error("cleanup failed");
      } });
      expect(uninstalled).toBe(1);
      expect(process.listeners("beforeExit")).not.toContain(listener);
      expect(report.phases).toContainEqual({ name: "teardown", outcome: "failed", detail: expect.stringContaining("uninstall() failed") });
      expect(rules(findingsOf(report, "runner-counter"))).toContain("runner/teardown-fault");
    } finally {
      process.off("beforeExit", listener);
      quiet.mockRestore();
    }
  });

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
