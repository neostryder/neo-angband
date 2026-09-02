import { describe, expect, it } from "vitest";
import {
  gameUpdateModFailureLines,
  runGameUpdatePass,
  shouldOfferGameUpdateMods,
  type ModUpdateFailure,
} from "./game-update-pass";
import type { ModUpgrade } from "./mod-refresh";

const qol: ModUpgrade = {
  id: "qol",
  name: "Quality of Life",
  repo: "neostryder/neo-angband-mod-qol",
  from: "v1.0.0",
  to: "v1.1.0",
};

const tiles: ModUpgrade = {
  id: "tiles",
  repo: "neostryder/neo-angband-mod-tiles",
  from: "v2.0.0",
  to: "v2.1.0",
};

describe("the game update's optional mod pass", () => {
  it("offers the extra choice only when a compatible installed mod is actually behind", () => {
    expect(shouldOfferGameUpdateMods([])).toBe(false);
    expect(shouldOfferGameUpdateMods([qol])).toBe(true);
  });

  it("updates the selected mod tags and then the game when the player accepts both", async () => {
    const events: string[] = [];
    await runGameUpdatePass("game-and-mods", [qol, tiles], {
      updateMod: async (update) => {
        events.push(`mod:${update.id}:${update.to}`);
        return null;
      },
      reportModFailures: async () => {
        events.push("report");
      },
      updateGame: async () => {
        events.push("game");
      },
    });
    expect(events).toEqual(["mod:qol:v1.1.0", "mod:tiles:v2.1.0", "game"]);
  });

  it("leaves mods alone when the player chooses the existing game-only update", async () => {
    const events: string[] = [];
    await runGameUpdatePass("game-only", [qol], {
      updateMod: async () => {
        events.push("mod");
        return null;
      },
      reportModFailures: async () => {
        events.push("report");
      },
      updateGame: async () => {
        events.push("game");
      },
    });
    expect(events).toEqual(["game"]);
  });

  it("reports a failed mod by name and still completes the game update", async () => {
    const events: string[] = [];
    let report: readonly ModUpdateFailure[] = [];
    const result = await runGameUpdatePass("game-and-mods", [qol, tiles], {
      updateMod: async (update) => {
        events.push(`mod:${update.id}`);
        return update.id === "qol" ? "network timeout" : null;
      },
      reportModFailures: async (failures) => {
        events.push("report");
        report = failures;
      },
      updateGame: async () => {
        events.push("game");
        return "updated";
      },
    });

    expect(result.game).toBe("updated");
    expect(events).toEqual(["mod:qol", "mod:tiles", "report", "game"]);
    expect(gameUpdateModFailureLines(report).join("\n")).toContain("Quality of Life (v1.0.0 -> v1.1.0): network timeout");
    expect(gameUpdateModFailureLines(report).join("\n")).toContain("Mods -> Update installed mods");
  });
});
