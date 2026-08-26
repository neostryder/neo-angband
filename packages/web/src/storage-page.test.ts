/**
 * The storage warning screen.
 *
 * What is asserted is what a player has to come away with, not the prose: that the
 * page names the things that destroy a roster, that it says MODS go too, that it
 * tells them how to make a backup, and that no line is wide enough to be cut off
 * by the 80-column terminal - the end of a line is where its warning is.
 */

import { describe, expect, it } from "vitest";
import { storageLines, type StoragePageInput } from "./storage-page";

const WEB: StoragePageInput = {
  desktop: false,
  origin: "https://neostryder.github.io",
  characters: 7,
  mods: 4,
  persisted: true,
  usage: 72_680_000,
  quota: 292_500_000_000,
};

const DESKTOP: StoragePageInput = {
  ...WEB,
  desktop: true,
  home: "C:\\Games\\Neo Angband\\data",
  origin: "http://127.0.0.1:45871",
};

const text = (i: StoragePageInput): string =>
  storageLines(i)
    .map((l) => l.text)
    .join("\n");

describe("what the page has to say", () => {
  it("names every routine action that destroys everything", () => {
    const t = text(WEB);
    expect(t).toContain("Clear browsing data");
    expect(t).toContain("Clear site data");
    /* The one a player is least likely to connect to their game, and the one that
     * runs without them being at the keyboard. */
    expect(t).toContain("Disk Cleanup");
    expect(t).toContain("CCleaner");
    expect(t).toContain("automation");
  });

  it("says the MODS go with the characters", () => {
    /* The half that is easy to leave out: mods are in IndexedDB and the roster is
     * in localStorage, and a player has no reason to know those share a fate. */
    const t = text(WEB);
    expect(t).toContain("MODS");
    expect(t).toContain("same storage");
  });

  it("says how to make a backup, with the actual keys", () => {
    const t = text(WEB);
    expect(t).toContain("Shift-X");
    expect(t).toContain("Shift-M");
  });

  it("says that death makes the loss unrecoverable", () => {
    expect(text(WEB)).toContain("Death is permanent");
  });

  it("counts what is at stake, and reads correctly at one of each", () => {
    expect(text(WEB)).toContain("7 characters and 4 mods");
    expect(text({ ...WEB, characters: 1, mods: 1 })).toContain("1 character and 1 mod");
    expect(text({ ...WEB, characters: 0, mods: 0 })).toContain("no characters and no mods");
  });

  it("no line can be truncated by the terminal", () => {
    /* term.print slices at cols - 1 = 79. A row at exactly 80 loses its last
     * character silently, which is how a warning ends up reading as a statement. */
    for (const input of [WEB, DESKTOP, { ...WEB, usage: null, quota: null }]) {
      for (const line of storageLines(input)) {
        expect(line.text.length, `too wide: ${line.text}`).toBeLessThanOrEqual(79);
      }
    }
  });
});

describe("the two shells say different true things", () => {
  it("the desktop build names the folder, and that it can be copied", () => {
    const t = text(DESKTOP);
    expect(t).toContain("C:\\Games\\Neo Angband\\data");
    expect(t).toContain("copy that whole folder");
    /* Not the loopback origin, which is a number a player can do nothing with. */
    expect(t).not.toContain("127.0.0.1");
  });

  it("the desktop build warns about the folder, the web build about the profile", () => {
    expect(text(DESKTOP)).toContain("data folder, or uninstalling");
    expect(text(WEB)).toContain("Resetting the browser");
  });

  it("the web build names the origin and that a roster does not follow you", () => {
    const t = text(WEB);
    expect(t).toContain("https://neostryder.github.io");
    expect(t).toContain("will not appear there");
  });

  it("falls back to the origin when the shell did not say where home is", () => {
    expect(text({ ...DESKTOP, home: undefined })).toContain("127.0.0.1:45871");
  });
});

describe("the eviction half is reported, never promised", () => {
  it("says persistence covers only the browser's own housekeeping", () => {
    const t = text(WEB);
    expect(t).toContain("marked persistent");
    expect(t).toContain("only part of the above it covers");
  });

  it("tells an unprotected origin what would earn it", () => {
    const t = text({ ...WEB, persisted: false });
    expect(t).toContain("NOT marked persistent");
    expect(t).toContain("Installing the game as an app");
  });

  it("reports usage in units a player reads, and omits it when unknown", () => {
    expect(text(WEB)).toContain("Using 73 MB of 293 GB");
    expect(text({ ...WEB, usage: 7_680_000 })).toContain("Using 7.7 MB");
    expect(text({ ...WEB, usage: 240_000 })).toContain("Using 240 kB");
    expect(text({ ...WEB, usage: null, quota: null })).not.toContain("Using");
    /* A quota of zero is an engine that will not say, not an origin with no room. */
    expect(text({ ...WEB, quota: 0 })).not.toContain("Using");
  });
});
