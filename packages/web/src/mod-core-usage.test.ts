import { afterEach, describe, expect, it } from "vitest";
import * as neoCore from "@rpgm-tools/neo-angband-core";
import { coreFor, coreUsage, coreUsageRecording, resetCoreUsage, setCoreUsageRecording } from "./mod-core-usage";

afterEach(() => {
  resetCoreUsage();
});

describe("recording which core names a mod reads", () => {
  it("hands over the bare namespace while recording is off", () => {
    expect(coreUsageRecording()).toBe(false);
    expect(coreFor("quiet", neoCore)).toBe(neoCore);
    expect(coreUsage()).toEqual({});
  });

  it("records each name a mod reads, under that mod, once", () => {
    setCoreUsageRecording(true);
    const core = coreFor("reader", neoCore);
    expect(core.ENGINE_VERSION).toBe(neoCore.ENGINE_VERSION);
    expect(core.ENGINE_VERSION).toBe(neoCore.ENGINE_VERSION);
    const { composeModHooks } = core;
    expect(composeModHooks).toBe(neoCore.composeModHooks);
    expect(coreUsage()).toEqual({ reader: ["ENGINE_VERSION", "composeModHooks"] });
  });

  it("keeps two mods' reads apart and lists them in a stable order", () => {
    setCoreUsageRecording(true);
    void coreFor("zeta", neoCore).GAME_EVENT_TYPES;
    void coreFor("alpha", neoCore).subscribeEvents;
    void coreFor("alpha", neoCore).ENGINE_VERSION;
    expect(Object.keys(coreUsage())).toEqual(["alpha", "zeta"]);
    expect(coreUsage()["alpha"]).toEqual(["ENGINE_VERSION", "subscribeEvents"]);
  });

  it("does not record symbol probes or listing, and does not change what a mod sees", () => {
    setCoreUsageRecording(true);
    const core = coreFor("prober", neoCore);
    void (core as unknown as Record<symbol, unknown>)[Symbol.toStringTag];
    expect(Object.keys(core)).toEqual(Object.keys(neoCore));
    expect(coreUsage()).toEqual({});
  });

  it("records a presence check, and a name the namespace lacks", () => {
    setCoreUsageRecording(true);
    const core = coreFor("checker", neoCore);
    expect("ENGINE_VERSION" in core).toBe(true);
    expect((core as unknown as Record<string, unknown>)["noSuchExport"]).toBeUndefined();
    expect(coreUsage()).toEqual({ checker: ["ENGINE_VERSION", "noSuchExport"] });
  });
});
