/**
 * Live-path tests: main-stats dispatches wiz-stats collectors (W2-017…022).
 * Exercises runWizStats (the entry main() calls for --wiz-*), not the helpers
 * alone.
 */
import { describe, expect, it } from "vitest";
import { loadGamePack } from "./pack";
import { runWizStats } from "./main-stats";
import {
  DEFAULT_DISCONNECT_PARAMS,
  DEFAULT_OBJ_MON_PARAMS,
  DEFAULT_PIT_PARAMS,
} from "./wiz-stats";

const pack = loadGamePack();

describe("runWizStats live dispatch (main-stats --wiz-*)", () => {
  it("objmon uses DEFAULT_OBJ_MON_PARAMS as the base (W2-017/020)", () => {
    const r = runWizStats(pack, {
      wiz: "objmon",
      nsim: 1,
      depthMin: 1,
      depthMax: 1,
      baseSeed: 1,
    }) as {
      meta: { nsim: number; mode: string; divingStep: number };
      depths: Record<string, unknown>;
    };
    expect(r.meta.mode).toBe("diving");
    expect(r.meta.nsim).toBe(1);
    expect(r.meta.divingStep).toBe(DEFAULT_OBJ_MON_PARAMS.divingStep);
    expect(r.depths["1"]).toBeDefined();
  });

  it("pits uses DEFAULT_PIT_PARAMS as the base (W2-018/021)", () => {
    const r = runWizStats(pack, {
      wiz: "pits",
      nsim: 5,
      depth: 1,
      baseSeed: 2,
    }) as {
      meta: { nsim: number; pittype: number };
      perDepth: Record<string, unknown>;
    };
    expect(r.meta.nsim).toBe(5);
    expect(r.meta.pittype).toBe(DEFAULT_PIT_PARAMS.pittype);
    expect(r.perDepth["1"]).toBeDefined();
  });

  it("disconnect uses DEFAULT_DISCONNECT_PARAMS as the base (W2-019/022)", () => {
    const r = runWizStats(pack, {
      wiz: "disconnect",
      nsim: 2,
      depth: 1,
      baseSeed: 3,
    }) as {
      meta: { nsim: number; depth: number; stopOnDisconnect: boolean };
      levels: number;
    };
    expect(r.meta.nsim).toBe(2);
    expect(r.meta.depth).toBe(1);
    expect(r.meta.stopOnDisconnect).toBe(
      DEFAULT_DISCONNECT_PARAMS.stopOnDisconnect,
    );
    expect(r.levels).toBe(2);
  });
});
