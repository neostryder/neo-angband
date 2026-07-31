/**
 * The mods-folder row in the mod manager.
 *
 * Small, but it guards the failure this whole feature can fail as: a folder the
 * player chose, named on screen, contributing nothing, with nothing said about why.
 * The three states have to be visibly different from each other.
 */

import { describe, expect, it } from "vitest";
import { modFolderRow, modSourceLine, noFolderPickerLines } from "./mods";
import { UI_GOLD, UI_TEXT } from "./ui-colors";

describe("modFolderRow", () => {
  it("invites a choice when no folder is remembered", () => {
    const row = modFolderRow(null, false);
    expect(row.label).toBe("Choose a mods folder...");
    expect(row.lapsed).toBe(false);
    expect(row.color).toBe(UI_TEXT);
  });

  it("names the folder when it is being read", () => {
    const row = modFolderRow("my-mods", true);
    expect(row.label).toBe("Mods folder: my-mods");
    expect(row.lapsed).toBe(false);
    expect(row.color).toBe(UI_TEXT);
  });

  it("flags a remembered folder the browser will not read", () => {
    const row = modFolderRow("my-mods", false);
    expect(row.lapsed).toBe(true);
    expect(row.label).toContain("my-mods");
    expect(row.label).toContain("RECONNECT");
    /* A different colour as well as different text: the row is a warning, and it
     * sits in a list where every other row is ordinary. */
    expect(row.color).toBe(UI_GOLD);
    expect(row.color).not.toBe(modFolderRow("my-mods", true).color);
  });

  it("says something different in all three states", () => {
    const labels = new Set([
      modFolderRow(null, false).label,
      modFolderRow("m", true).label,
      modFolderRow("m", false).label,
    ]);
    expect(labels.size).toBe(3);
  });
});

describe("modSourceLine", () => {
  /**
   * The line on the mods-sources screen that says where a player's mods came from.
   *
   * It used to be a template with both numbers always printed, and de-bundling turned the
   * first one into a permanent zero: the game ships no mods, so "0 bundled with the game"
   * would sit forever on the screen a player opens to find out where their mods ARE. A
   * number that can only be zero is not information, it is furniture.
   */
  it("drops the bundled clause entirely when nothing is bundled", () => {
    expect(modSourceLine(0, 2, "installed")).toBe("2 installed.");
    expect(modSourceLine(0, 0, "from this folder")).toBe("0 from this folder.");
    expect(modSourceLine(0, 3, "installed")).not.toContain("bundled");
  });

  it("keeps the OTHER count even at zero", () => {
    /* "0 mods found in it." is true and reads as "this game has no mods" - so the count
     * stays, because it is what tells a player the FOLDER is the empty part. */
    expect(modSourceLine(0, 0, "from this folder")).toContain("0");
  });

  it("prints both when something IS bundled", () => {
    /* Not dead code: a build that bundles a mod again must not silently lose the clause
     * that stops the folder count reading as the whole answer. */
    expect(modSourceLine(3, 1, "from this folder")).toBe(
      "3 bundled with the game, 1 from this folder.",
    );
  });
});

describe("noFolderPickerLines", () => {
  /**
   * The Firefox/Safari message. Its previous version said the mod list was "a fixed set"
   * of mods "bundled into the app" - two claims that are both false now, on the one screen
   * a player without a directory picker would open to find out what they can do. It went
   * unnoticed because nothing asserted anything about it: it was inline text inside a
   * screen function, and screen functions get read, not tested.
   */
  const text = noFolderPickerLines().map((l) => l.text).join(" ");

  it("does not claim the mod list is fixed or bundled", () => {
    expect(text).not.toMatch(/fixed set/iu);
    expect(text).not.toMatch(/bundled into the app/iu);
  });

  it("names the route that DOES work in this browser", () => {
    expect(text).toContain("Install a mod...");
    /* And says why it is safe, because "download from the internet" is the part a
     * cautious player would otherwise stop at. */
    expect(text).toMatch(/digest/iu);
  });

  it("says plainly that nothing is missing", () => {
    /* The sentence that replaces the wrong one. Without it the screen is a list of what
     * this browser cannot do, which reads as a downgrade even when nothing is lost. */
    expect(text).toMatch(/Nothing is missing from your mod list/u);
  });

  it("still mentions the folder route as the Chromium extra it is", () => {
    expect(text).toMatch(/Chrome and Edge/u);
    expect(text).toMatch(/desktop build/u);
  });
});
