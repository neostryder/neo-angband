/**
 * The mods-folder row in the mod manager.
 *
 * Small, but it guards the failure this whole feature can fail as: a folder the
 * player chose, named on screen, contributing nothing, with nothing said about why.
 * The three states have to be visibly different from each other.
 */

import { describe, expect, it } from "vitest";
import { modFolderRow } from "./mods";
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
