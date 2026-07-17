/**
 * Guard for the in-game Monte-Carlo collectors (wiz-stats.ts), the port's
 * answer to reference/src/wiz-stats.c behind the do_cmd_wiz_collect_* commands
 * (cmd-wizard.c L585 / L622 / L671). It checks STRUCTURAL invariants and pins
 * determinism (decision-22: the engine is a function of the seed), keeping the
 * batches tiny so CI stays fast.
 */

import { describe, expect, it } from "vitest";
import { loadGamePack } from "./pack";
import { disconnectStats, objMonStats, pitStats } from "./wiz-stats";

const pack = loadGamePack();

describe("objMonStats <- stats_collect (wiz-stats.c L1666)", () => {
  it("reports diving mode with the catalogued depth present", () => {
    const r = objMonStats(pack, {
      nsim: 1,
      simtype: 1,
      depthMin: 1,
      depthMax: 1,
    });
    expect(r.meta.mode).toBe("diving");
    expect(r.meta.nsim).toBe(1);
    expect(r.depths["1"]).toBeDefined();
  });

  it("labels the clearing simtypes", () => {
    expect(
      objMonStats(pack, { nsim: 1, simtype: 2, depthMin: 1, depthMax: 1 }).meta
        .mode,
    ).toBe("clearing");
    expect(
      objMonStats(pack, { nsim: 1, simtype: 3, depthMin: 1, depthMax: 1 }).meta
        .mode,
    ).toBe("clearing-randart");
  });

  it("is deterministic for a fixed seed", () => {
    const p = { nsim: 1, simtype: 1, depthMin: 1, depthMax: 1, baseSeed: 7 };
    expect(JSON.stringify(objMonStats(pack, p))).toBe(
      JSON.stringify(objMonStats(pack, p)),
    );
  });
});

describe("pitStats <- pit_stats (wiz-stats.c L1855)", () => {
  it("histograms the selected pit profiles within the sample bound", () => {
    const nsim = 20;
    const r = pitStats(pack, { nsim, pittype: 1, depthMin: 1, depthMax: 1 });
    const perDepth = r.perDepth["1"]!;
    expect(perDepth).toBeDefined();
    /* One selection per simulation; the named-pit columns can only hold a
     * subset (the default index 0 fallback may be an unnamed pit), so the
     * tallied total is bounded above by nsim. */
    const total = Object.values(perDepth).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(0);
    expect(total).toBeLessThanOrEqual(nsim);
  });

  it("is deterministic for a fixed seed", () => {
    const p = { nsim: 20, pittype: 1, depthMin: 1, depthMax: 1, baseSeed: 3 };
    expect(JSON.stringify(pitStats(pack, p))).toBe(
      JSON.stringify(pitStats(pack, p)),
    );
  });
});

describe("disconnectStats <- disconnect_stats (wiz-stats.c L2962)", () => {
  it("generates the requested number of levels and tallies problems", () => {
    const r = disconnectStats(pack, { nsim: 2, depth: 1, baseSeed: 1 });
    expect(r.levels).toBe(2);
    expect(r.badStarts).toBeGreaterThanOrEqual(0);
    expect(r.disconnectedAreas).toBeGreaterThanOrEqual(0);
    expect(r.stairsInaccessible).toBeGreaterThanOrEqual(0);
  });

  it("is deterministic for a fixed seed", () => {
    const p = { nsim: 2, depth: 1, stopOnDisconnect: false, baseSeed: 9 };
    expect(JSON.stringify(disconnectStats(pack, p))).toBe(
      JSON.stringify(disconnectStats(pack, p)),
    );
  });
});
