/**
 * What the (U)pdate screen tells the player.
 *
 * The screen is asserted rather than reviewed because it is the only warning
 * before an operation that replaces every file in a folder. Two claims on it
 * have to be true: that the save directory survives, and that a failure leaves
 * the player where they were. If either sentence drifts from what the code does,
 * the screen becomes a lie told at exactly the wrong moment.
 */

import { describe, expect, it } from "vitest";
import { elidePath, humanBytes, percent, progressBar, updateFooter, updateLines } from "./update-ui";
import type { UpdateView } from "./update-ui";

/**
 * The directory the swap script skips. Written out rather than imported from
 * `packages/desktop`: the web package cannot reference the desktop one (it would
 * invert the dependency, and tsc's project references say so). That leaves two
 * copies of a load-bearing string, so the AGREEMENT between them is asserted in
 * packages/desktop/src/packaging.test.ts, which is allowed to read both files.
 */
const SAVE_DIR = "neo-angband-data";

const base: UpdateView = {
  how: "swap",
  current: "0.16.0",
  version: "0.17.0",
  installRoot: "C:\\Games\\Neo Angband",
  assetName: "Neo.Angband-0.17.0-win.zip",
  phase: "offer",
  releaseUrl: "https://example.invalid/releases",
};

const text = (v: UpdateView): string => updateLines(v).map((l) => l.text).join("\n");

describe("the offer, on an install that can replace itself", () => {
  it("names both versions, so 'update' is not an act of faith", () => {
    expect(text(base)).toContain("0.17.0 is available");
    expect(text(base)).toContain("running 0.16.0");
  });

  it("names the folder it is about to replace", () => {
    expect(text(base)).toContain("C:\\Games\\Neo Angband");
  });

  it("cuts a long install path in the MIDDLE, and says it cut it", () => {
    /* Found by screenshotting the real screen: a deep path ran off the right
     * edge and the terminal stopped drawing it, which reads as a complete path
     * that looks a bit odd. The end of a path is the part that identifies it. */
    const deep = `C:\\Users\\someone\\AppData\\Local\\Temp\\a-very-long-folder\\${"x".repeat(40)}\\Neo Angband`;
    const line = updateLines({ ...base, installRoot: deep })
      .map((l) => l.text)
      .find((t) => t.includes("every file in"));
    expect(line).toBeTruthy();
    expect(line!.length).toBeLessThanOrEqual(80);
    expect(line).toContain("...");
    expect(line).toContain("C:\\Users");
    expect(line).toContain("Neo Angband");
  });

  it("leaves a path that already fits completely alone", () => {
    expect(elidePath("C:\\Games\\Neo Angband")).toBe("C:\\Games\\Neo Angband");
    expect(elidePath("C:\\Games\\Neo Angband")).not.toContain("...");
  });

  it("promises the save directory survives, using its real name", () => {
    /* The promise and the code that keeps it must use the same string: the swap
     * script skips exactly the entries in PRESERVE. A screen that named a
     * different folder would be reassuring and wrong. */
    expect(text(base)).toContain(SAVE_DIR);
  });

  it("says a failure leaves you on the version you have", () => {
    expect(text(base)).toMatch(/leaves you on the version you have/u);
  });

  it("tells the player what ENTER does before they press it", () => {
    expect(updateFooter(base)).toContain("ENTER to update and restart");
  });
});

describe("the offer, when this copy cannot replace itself", () => {
  const manual: UpdateView = { ...base, how: "manual" };

  it("says WHY, because 'cannot' on its own reads as a bug", () => {
    /* Both reasons are things the player did deliberately and can undo. */
    expect(text(manual)).toContain("portable");
    expect(text(manual)).toMatch(/protected folder/u);
  });

  it("offers the releases page instead of a dead end", () => {
    expect(text(manual)).toContain("https://example.invalid/releases");
    expect(updateFooter(manual)).toContain("releases page");
  });

  it("does not promise an in-place update it will not perform", () => {
    expect(text(manual)).not.toMatch(/restarts the game on the new version/u);
  });
});

describe("the offer, in a browser", () => {
  const web: UpdateView = { ...base, how: "web", version: "a newer version" };

  it("says the new build is already here, because it is", () => {
    expect(text(web)).toContain("already downloaded");
    expect(updateFooter(web)).toContain("reload");
  });

  it("does not talk about folders the browser does not have", () => {
    expect(text(web)).not.toContain("C:\\Games");
    expect(text(web)).not.toContain("neo-angband-data");
  });
});

describe("while it downloads", () => {
  const going: UpdateView = { ...base, phase: "downloading", received: 50 * 1024 * 1024, total: 160 * 1024 * 1024 };

  it("shows a bar, a size and a percentage", () => {
    const t = text(going);
    expect(t).toContain("50.0 MB of 160 MB");
    expect(t).toContain("31%");
    expect(t).toMatch(/\[=+ +\]/u);
  });

  it("offers a way out", () => {
    expect(updateFooter(going)).toContain("ESC");
  });

  it("does not claim to be finished when the server sent no length", () => {
    /* total 0 with a full bar would read as "done" for the whole download. */
    const unknown: UpdateView = { ...going, total: 0 };
    expect(progressBar(1, 0)).toContain("?");
    expect(percent(1, 0)).toBeNull();
    expect(text(unknown)).not.toContain("100%");
  });
});

describe("when it fails", () => {
  const failed: UpdateView = { ...base, phase: "failed", error: "the download did not match its published checksum" };

  it("leads with the fact that nothing changed", () => {
    const t = text(failed);
    expect(t).toContain("Nothing was changed");
    expect(t).toContain("characters have not been touched");
  });

  it("shows the real reason rather than a shrug", () => {
    expect(text(failed)).toContain("did not match its published checksum");
  });

  it("still offers the manual download", () => {
    expect(text(failed)).toContain("https://example.invalid/releases");
    expect(updateFooter(failed)).toContain("try again");
  });
});

describe("the arithmetic", () => {
  it("reads sizes the way a download dialog does", () => {
    expect(humanBytes(0)).toBe("0 B");
    expect(humanBytes(2048)).toBe("2 KB");
    expect(humanBytes(1.5 * 1024 * 1024)).toBe("1.5 MB");
    expect(humanBytes(162343507)).toBe("155 MB");
    expect(humanBytes(-1)).toBe("?");
    expect(humanBytes(Number.NaN)).toBe("?");
  });

  it("clamps a bar that would overrun its own width", () => {
    /* content-length can undercount a chunked transfer. */
    expect(progressBar(999, 100, 10)).toBe(`[${"=".repeat(8)}]`);
    expect(percent(999, 100)).toBe(100);
  });

  it("draws an empty bar at zero rather than a missing one", () => {
    expect(progressBar(0, 100, 10)).toBe(`[${" ".repeat(8)}]`);
  });
});
