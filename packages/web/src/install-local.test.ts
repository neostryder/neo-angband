/**
 * The (I)nstall locally page, and the three claims it must never make.
 *
 * A page like this is written as marketing and is wrong within a month, so the
 * tests are mostly about what it does NOT say. Each of these was checked against
 * the code that would have to implement it:
 *
 *   - saves do not become real files on the desktop build (it is this same bundle
 *     in Electron, keeping its roster in localStorage under the loopback origin);
 *   - the shell opens ONE window, so there are no subwindows to promise;
 *   - the shell reports signals: false, so there is no panic save to promise.
 *
 * The page reads live HostCapabilities rather than a hardcoded list, so the last
 * two would start being true on their own if the shell ever changed. The tests
 * drive both capability sets to prove that is real and not decoration.
 */

import { describe, expect, it } from "vitest";
import type { HostCapabilities } from "@rpgm-tools/neo-angband-core";
import { installLines, offerInstall, type InstallContext } from "./install-local";

/** What a browser tab reports (host-browser.ts). */
const TAB: HostCapabilities = {
  realFiles: false,
  argv: false,
  signals: false,
  termCount: 1,
  directories: false,
};

function ctx(over: Partial<InstallContext> = {}): InstallContext {
  return {
    isDesktop: false,
    isStandalone: false,
    canPickFolder: true,
    canPromptInstall: true,
    caps: TAB,
    ...over,
  };
}

const text = (c: InstallContext): string =>
  installLines(c)
    .map((l) => l.text)
    .join("\n");

describe("whether the offer appears at all", () => {
  it("is offered in a browser tab", () => {
    expect(offerInstall({ isDesktop: false })).toBe(true);
  });

  it("is NOT offered under the desktop shell", () => {
    /* The offer is "install this on your computer" and it already is. */
    expect(offerInstall({ isDesktop: true })).toBe(false);
  });

  it("IS still offered to an installed PWA", () => {
    /* That is a browser app; the desktop half of the page still has things to
     * tell it, and hiding the page would hide the character-transfer
     * instructions with it. */
    expect(offerInstall({ isDesktop: false })).toBe(true);
  });
});

describe("the three claims it must never make", () => {
  const all = text(ctx()) + text(ctx({ isStandalone: true })) + text(ctx({ canPickFolder: false }));

  it("never says installing makes your saves real files", () => {
    /* FALSE: the desktop build keeps the roster in localStorage under the
     * loopback origin, exactly as a tab does. */
    expect(all).not.toMatch(/saves?[^.\n]*(real file|on disk|back ?up)/iu);
  });

  it("says outright that saves are NOT the reason to install", () => {
    /* Not enough to omit the false claim: a player will assume it. */
    expect(text(ctx())).toMatch(/Saves are NOT the reason/u);
  });

  it("never promises subwindows or a panic save while the shell has neither", () => {
    expect(all).not.toMatch(/extra terminal windows( are| will)/iu);
    expect(text(ctx())).toContain("not delivered");
  });

  it("says the panic save IS delivered when the host reports signals", () => {
    /* The point of reading live capabilities: this line changes without the page
     * being edited. */
    expect(text(ctx({ caps: { ...TAB, signals: true } }))).toContain("now delivered");
  });
});

describe("what it does promise", () => {
  it("leads with the one-click browser install when one is available", () => {
    const lines = installLines(ctx());
    expect(lines[0]?.text).toContain("Install as an app");
    expect(text(ctx())).toContain("ENTER");
  });

  it("tells a browser with no install prompt where to look instead", () => {
    /* Firefox and desktop Safari never fire beforeinstallprompt, and iOS Safari
     * installs from the Share sheet. A button that does nothing is worse than a
     * sentence. */
    const t = text(ctx({ canPromptInstall: false }));
    expect(t).not.toMatch(/Press ENTER on this page to install/u);
    expect(t).toMatch(/Add to Home Screen|Install/u);
  });

  it("drops the install pitch once it IS installed", () => {
    const t = text(ctx({ isStandalone: true }));
    expect(t).toContain("You are running the installed app");
    expect(t).not.toContain("Install as an app");
  });

  it("names the mods folder as the real desktop advantage", () => {
    expect(text(ctx())).toMatch(/REAL MODS FOLDER/u);
    expect(text(ctx())).toMatch(/Vortex|Mod Organizer/u);
  });

  it("is harder on a browser that cannot hand over a folder at all", () => {
    const with_ = text(ctx({ canPickFolder: true }));
    const without = text(ctx({ canPickFolder: false }));
    expect(with_).not.toBe(without);
    expect(without).toContain("cannot hand the game a folder");
  });

  it("states the parity position, and lists what is shared", () => {
    const t = text(ctx());
    expect(t).toContain("What is the same either way");
    expect(t).toMatch(/Shockbolt/u);
    expect(t).toMatch(/not cut down in a browser/u);
  });

  it("explains the character transfer, with the keys", () => {
    const t = text(ctx());
    expect(t).toMatch(/do NOT follow you/u);
    expect(t).toMatch(/press Shift-X on a character/u);
    expect(t).toMatch(/press Shift-M there/u);
  });
});

describe("every line is renderable", () => {
  it("uses only tones the shell has a colour for", () => {
    const tones = new Set(installLines(ctx()).map((l) => l.tone));
    for (const t of tones) expect(["head", "body", "dim", "good", "warn"]).toContain(t);
  });

  it("fits an 80-column terminal", () => {
    /* The screen is a GlyphTerm, so a line past the width is silently truncated -
     * which is how a sentence loses its last three words and nobody notices. */
    /* EVERY branch, which this loop did not have: the no-install-prompt text was
     * two sentences on one line and overran by 30 columns, and the live screen
     * showed it truncated mid-word while this test was green. A width check is
     * only as good as its fixture set. */
    const all = [
      ctx(),
      ctx({ isStandalone: true }),
      ctx({ canPickFolder: false }),
      ctx({ canPromptInstall: false }),
      ctx({ caps: { ...TAB, signals: true, realFiles: true } }),
    ];
    for (const c of all) {
      for (const line of installLines(c)) {
        expect(line.text.length, line.text).toBeLessThanOrEqual(78);
      }
    }
  });
});
