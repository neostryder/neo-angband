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
import type { UpdateHow, UpdatePhase, UpdateView } from "./update-ui";

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
  channel: "beta",
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
  const web: UpdateView = { ...base, how: "web", version: "a newer version", buildId: "a1b2c3d" };

  it("names the build rather than a version, because a deploy has no version", () => {
    /* Every deploy of 0.17.0 is 0.17.0. What changed is the build, and the id
     * is the only thing a player could quote back that identifies one. */
    expect(text(web)).toContain("a1b2c3d");
    expect(text(web)).not.toContain("Neo Angband a newer version");
    expect(updateFooter(web)).toContain("reload");
  });

  it("does not claim the new build is already downloaded", () => {
    /*
     * IT USED TO, and it was true then: the only signal was a service worker
     * that had already fetched and installed the build. The build-id check asks
     * the server instead, so a page can know it is out of date before anything
     * has been downloaded - and the old sentence became a promise the screen
     * could not keep. This is the assertion that caught it.
     */
    expect(text(web)).not.toContain("already downloaded");
    expect(text(web)).toContain("fetches it and reloads");
  });

  it("does not talk about folders or channels the browser does not have", () => {
    expect(text(web)).not.toContain("C:\\Games");
    expect(text(web)).not.toContain("neo-angband-data");
    expect(text(web)).not.toContain("Channel:");
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

describe("channels on the screen", () => {
  it("names the channel and says what it means, not what GitHub calls it", () => {
    /* "pre-release" is release-engineering vocabulary and tells a player
     * nothing about what they are about to run. */
    const t = text({ ...base, channel: "early" });
    expect(t).toContain("Channel: early");
    expect(t).toMatch(/every commit/u);
    expect(text({ ...base, channel: "stable" })).toMatch(/finished releases only/u);
  });

  it("is reachable with nothing to install, or the setting would be unreachable", () => {
    /* The row used to appear only when an update existed, which hid the only
     * door to the channel except in the moments it mattered least. */
    const idle: UpdateView = { ...base, phase: "uptodate" };
    expect(text(idle)).toContain("newest build on your channel");
    expect(updateFooter(idle)).toContain("C to change channel");
  });

  it("calls a move back to a slower channel what it is", () => {
    /* 0.16.0 offered to someone running 0.16.1-edge.9 is not an update, and an
     * unlabelled "is available" would read as a bug. */
    const back: UpdateView = { ...base, current: "0.16.1-edge.9", version: "0.16.0", older: true };
    const t = text(back);
    expect(t).toContain("Moving back to 0.16.0");
    expect(t).toMatch(/which is newer/u);
    expect(t).not.toContain("0.16.0 is available");
    expect(updateFooter(back)).toContain("move back and restart");
  });

  it("offers no channel in a browser, which has none to offer", () => {
    /* A page is whatever the site last deployed; there is nothing to choose. */
    expect(updateFooter({ ...base, how: "web" })).not.toContain("channel");
  });

  it("does not offer a channel change mid-download", () => {
    expect(updateFooter({ ...base, phase: "downloading" })).not.toContain("channel");
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

/**
 * THE FOOTER MUST FIT, and no existing test asked.
 *
 * main.ts paints it with `.slice(0, cols - 1)`. Adding one more key took the
 * swap-offer footer to 90 characters, and an 80-column terminal showed
 * `... - M for mod updates - ESC t`: the new key survived and the way out was
 * cut off. Every footer test above passed, because every one of them asks
 * whether a substring is PRESENT - and truncation only ever removes the end.
 *
 * Found by photographing the real screen. This is the cheaper version.
 */
describe("the footer fits the terminal it is painted on", () => {
  const HOWS: UpdateHow[] = ["swap", "manual", "web", "none"];
  const PHASES: UpdatePhase[] = ["offer", "uptodate", "downloading", "installing", "failed"];
  const MODS = [
    [],
    [{ mod: { name: "Quality of Life" } as never, from: "v0.11.0", to: "v0.13.0" }],
  ];

  for (const cols of [80, 100]) {
    it(`never exceeds ${String(cols)} columns, in any state`, () => {
      const tooLong: string[] = [];
      for (const how of HOWS) {
        for (const phase of PHASES) {
          for (const older of [false, true]) {
            for (const modUpdates of MODS) {
              const v: UpdateView = {
                ...base,
                how,
                phase,
                older,
                modUpdates: modUpdates as never,
              };
              const f = updateFooter(v, cols);
              if (f.length > cols - 1) tooLong.push(`${how}/${phase}/older=${String(older)}/mods=${String(modUpdates.length)}: ${String(f.length)} "${f}"`);
            }
          }
        }
      }
      expect(tooLong).toEqual([]);
    });
  }

  it("keeps every key it names, even when it has to shorten", () => {
    /* Eliding must not silently drop a key - that is the same failure as
     * truncation, only tidier. */
    const v: UpdateView = {
      ...base,
      how: "swap",
      phase: "offer",
      modUpdates: [{ mod: { name: "Quality of Life" } as never, from: "v0.11.0", to: "v0.13.0" }] as never,
    };
    const f = updateFooter(v, 80);
    expect(f.length).toBeLessThanOrEqual(79);
    expect(f).toContain("ENTER");
    expect(f).toContain("C");
    expect(f.includes("M: mods") || f.includes("M for mod updates")).toBe(true);
    expect(f).toContain("ESC to go back");
  });

  it("uses the full wording when there is room for it", () => {
    const v: UpdateView = {
      ...base,
      how: "swap",
      phase: "offer",
      modUpdates: [{ mod: { name: "Quality of Life" } as never, from: "v0.11.0", to: "v0.13.0" }] as never,
    };
    expect(updateFooter(v, 120)).toContain("M for mod updates");
    expect(updateFooter(v, 120)).toContain("C to change channel");
  });
});
