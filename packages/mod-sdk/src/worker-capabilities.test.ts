/**
 * The retired Worker capability names, mapped to the one vocabulary.
 */
import { describe, expect, it } from "vitest";
import { convertManifestV1 } from "./manifest-v2.js";
import { unifiedCapabilities, unifiedCapability, WORKER_CAPABILITY_ALIASES } from "./worker-capabilities.js";
import { capabilityTiers, matchCapability } from "./capability-vocabulary.js";

describe("the Worker capability aliases", () => {
  it("maps each retired name to its API 2 name, or to nothing", () => {
    expect(unifiedCapability("ui:panel")).toBe("ui:panel.mount");
    expect(unifiedCapability("state:model.read")).toBe("state:player.read");
    expect(unifiedCapability("prefs:read")).toBeNull();
    expect(unifiedCapability("command:submit")).toBeNull();
    expect(unifiedCapability("state:map.read")).toBe("state:map.read");
  });

  it("never grants a wildcard", () => {
    expect(unifiedCapability("*")).toBeNull();
    expect(unifiedCapabilities(["*", "ui:panel", "ui:panel.mount", "prefs:write"])).toEqual(["ui:panel.mount"]);
  });

  it("maps every alias to a name the vocabulary knows, which a Worker mod may hold", () => {
    for (const target of Object.values(WORKER_CAPABILITY_ALIASES)) {
      if (target === null) continue;
      expect(matchCapability(target)).not.toBeNull();
      expect(capabilityTiers(target)).toContain("worker");
    }
  });

  it("is applied when a schema 1 Worker manifest converts", () => {
    const converted = convertManifestV1({
      id: "old", name: "Old", version: "1.0.0", shape: "plugin", modApi: 2, runtime: "worker", workerEntry: "main.js",
      capabilities: ["ui:panel", "prefs:read", "state:model.read"],
    });
    expect(converted.capabilities).toEqual(["ui:panel.mount", "state:player.read"]);
  });
});
