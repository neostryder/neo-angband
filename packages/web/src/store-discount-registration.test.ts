/**
 * A fresh town is stocked inside startGame, but plugin register() needs the
 * finished GameState main.ts receives afterwards. The core wiring test proves
 * the real handler and stock mutation; this keeps the shell's required final
 * call after the folder-plugin registration loop.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const MAIN = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

describe("fresh-town discount registration", () => {
  it("resolves initial stock only after folder plugins register", () => {
    const folderPlugins = MAIN.indexOf("/* The FOLDER plugins' register() half.");
    const registration = MAIN.indexOf(
      "for (const loaded of activeModCode().plugins) {",
      folderPlugins,
    );
    const resolve = MAIN.indexOf("game.resolveInitialStoreDiscounts();");

    expect(folderPlugins).toBeGreaterThan(-1);
    expect(registration).toBeGreaterThan(folderPlugins);
    expect(resolve).toBeGreaterThan(registration);
  });
});
