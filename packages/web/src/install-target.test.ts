/**
 * Browser detection for the install screens, against real user-agent strings.
 *
 * Every string below is a real one, copied rather than composed. A sniff tested
 * only against strings written to match it proves that the regex matches itself,
 * which is the exact failure this kind of code always has: the branch that never
 * fires in the wild is the one whose fixture was invented.
 *
 * The cases that carry the weight are the ones where the obvious check gets it
 * backwards. Chromium puts `Safari/` in its string, so a naive Safari test
 * catches Chrome. Firefox on iOS says `FxiOS` and never says `Firefox`. iPadOS
 * in desktop mode says `Macintosh` and nothing else distinguishes it from a Mac
 * except the touch count. Each of those has a test here because each of them
 * would send a reader to a menu item that does not exist.
 */

import { describe, expect, it } from "vitest";
import {
  detectInstallTarget,
  installInstructions,
  installRoute,
  type InstallTarget,
} from "./install-target";

/** Real strings. Touch count is the second input and only matters for Apple hardware. */
const UA = {
  chromeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  chromeMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  edgeWindows:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36 Edg/140.0.0.0",
  chromeAndroid:
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Mobile Safari/537.36",
  safariMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  safariIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
  safariIpadDesktopMode:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15",
  chromeIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/140.0.0.0 Mobile/15E148 Safari/604.1",
  firefoxIphone:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/133.0 Mobile/15E148 Safari/605.1.15",
  firefoxWindows: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
  firefoxAndroid: "Mozilla/5.0 (Android 14; Mobile; rv:133.0) Gecko/133.0 Firefox/133.0",
  /* An embedded Chromium that inserts its own product token ahead of Chrome's.
   * Read off a live one rather than imagined: an embedder is the case where a
   * sniff written around the four retail browsers quietly stops matching, and
   * a game that ships inside Electron has one of these in its own family. */
  embeddedChromium:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Claude/1.46388.4 Chrome/148.0.7778.280 Safari/537.36",
} as const;

const at = (userAgent: string, maxTouchPoints = 0): InstallTarget =>
  detectInstallTarget({ userAgent, maxTouchPoints });

describe("which install path a browser has", () => {
  it("puts Chromium on a desktop at the address bar", () => {
    expect(at(UA.chromeWindows)).toBe("chromium-desktop");
    expect(at(UA.chromeMac)).toBe("chromium-desktop");
    expect(at(UA.edgeWindows)).toBe("chromium-desktop");
  });

  it("puts Chromium on Android in the browser menu instead", () => {
    expect(at(UA.chromeAndroid)).toBe("chromium-android");
  });

  it("reads an embedded Chromium that carries its own product token", () => {
    expect(at(UA.embeddedChromium)).toBe("chromium-desktop");
  });

  it("does not read a Windows touchscreen as an iPad", () => {
    /* The iPad check is `Macintosh` AND a touch count, and the second half
     * alone is true of any touchscreen laptop. Dropping the platform half
     * would send every Windows 2-in-1 to a Share sheet it does not have. */
    expect(at(UA.chromeWindows, 10)).toBe("chromium-desktop");
    expect(at(UA.firefoxWindows, 10)).toBe("firefox");
  });

  it("does not mistake Chromium for Safari", () => {
    /* Every Chromium build carries `Safari/537.36` and always has. A Safari
     * check written before the Chromium one sends most of the desktop web to
     * a File menu that has no Add to Dock in it. */
    expect(UA.chromeMac).toContain("Safari/");
    expect(at(UA.chromeMac)).not.toBe("safari-macos");
  });

  it("sends Safari on macOS to the File menu", () => {
    expect(at(UA.safariMac)).toBe("safari-macos");
  });

  it("sends Safari on iOS to the Share sheet", () => {
    expect(at(UA.safariIphone)).toBe("safari-ios");
  });

  it("reads an iPad in desktop mode as iOS, not as a Mac", () => {
    /* iPadOS has claimed to be a Macintosh since iPadOS 13, and its string is
     * byte-identical to a Mac's. The touch count is the whole difference: no
     * Mac reports more than one. Told wrong, an iPad user is sent to a File
     * menu that iPadOS does not have. */
    expect(UA.safariIpadDesktopMode).toBe(UA.safariMac);
    expect(at(UA.safariIpadDesktopMode, 5)).toBe("safari-ios");
    expect(at(UA.safariMac, 0)).toBe("safari-macos");
  });

  it("knows a non-Safari browser on iOS can install nothing itself", () => {
    /* Chrome and Firefox on iOS are WebKit in another wrapper with no install
     * path of their own. Giving them their desktop instructions would name a
     * menu item that is not there. */
    expect(at(UA.chromeIphone)).toBe("ios-non-safari");
    expect(at(UA.firefoxIphone)).toBe("ios-non-safari");
  });

  it("reads Firefox on iOS, whose string never says Firefox", () => {
    expect(UA.firefoxIphone).not.toContain("Firefox/");
    expect(at(UA.firefoxIphone)).toBe("ios-non-safari");
  });

  it("reads Firefox everywhere else as installing nothing", () => {
    expect(at(UA.firefoxWindows)).toBe("firefox");
    expect(at(UA.firefoxAndroid)).toBe("firefox");
  });

  it("answers unknown rather than guessing", () => {
    /* A wrong guess costs a reader a hunt through a menu that has no such item.
     * The generic wording costs them nothing they did not already have. */
    expect(at("")).toBe("unknown");
    expect(at("Mozilla/5.0 (SomeConsole; Web) SomeEngine/1.0")).toBe("unknown");
  });
});

describe("what each browser is told", () => {
  const targets: InstallTarget[] = [
    "chromium-desktop",
    "chromium-android",
    "safari-ios",
    "safari-macos",
    "ios-non-safari",
    "firefox",
    "unknown",
  ];

  it("says something for every target, and nothing empty", () => {
    for (const t of targets) {
      const steps = installInstructions(t);
      expect(steps.length, t).toBeGreaterThan(0);
      for (const step of steps) expect(step.trim(), t).not.toBe("");
    }
  });

  it("fits the 78-column budget both screens paint into", () => {
    /* Both callers are fixed-width terminals that clip silently, which is how
     * the title screen's thank-you line lost its tail. A line written here is
     * painted there verbatim, so the budget belongs to this file too. */
    for (const t of targets) {
      for (const step of installInstructions(t)) {
        expect(step.length, `${t}: ${step}`).toBeLessThanOrEqual(78);
      }
    }
  });

  it("names a concrete place for every browser that can install", () => {
    /* The whole point of the change: not "look in the menu" but which menu.
     * Firefox is excluded because there is no place to name, and `unknown`
     * because naming one would be a guess. */
    const named: Record<string, RegExp> = {
      "chromium-desktop": /address bar/u,
      "chromium-android": /browser menu/u,
      "safari-ios": /Share/u,
      "safari-macos": /File menu/u,
      "ios-non-safari": /Safari/u,
    };
    for (const [target, expected] of Object.entries(named)) {
      expect(installInstructions(target as InstallTarget).join(" "), target).toMatch(expected);
    }
  });

  it("tells Firefox it cannot, instead of sending it hunting", () => {
    const steps = installInstructions("firefox").join(" ");
    expect(steps).toMatch(/cannot install/u);
    expect(steps).toMatch(/desktop app/u);
    expect(steps).not.toMatch(/Add to Home Screen|Install app|address bar/u);
    expect(installRoute("firefox")).toBe("none");
  });

  it("does not say \"below\", which is wrong on one of the two screens", () => {
    /* install-choice puts the desktop option ABOVE this block and install-local
     * puts it under, so a direction baked into the shared string is wrong on
     * one of them no matter which one it names. */
    for (const t of targets) {
      expect(installInstructions(t).join(" "), t).not.toMatch(/\b(?:below|above)\b/u);
    }
  });

  it("introduces each target the way that target actually works", () => {
    /* The lead-in is a separate decision from the steps, because the obvious
     * "this browser installs from its own menu" is false for two of them. */
    expect(installRoute("chromium-desktop")).toBe("own-menu");
    expect(installRoute("chromium-android")).toBe("own-menu");
    expect(installRoute("safari-ios")).toBe("own-menu");
    expect(installRoute("safari-macos")).toBe("own-menu");
    /* Chrome on an iPhone installs from no menu of its own; it hands off. */
    expect(installRoute("ios-non-safari")).toBe("another-browser");
    expect(installRoute("firefox")).toBe("none");
    /* Not known to have an install at all, so nothing may be promised. */
    expect(installRoute("unknown")).toBe("unrecognised");
  });
});
