/**
 * The guard is the part worth testing. `window.open` itself is the browser's, but
 * WHICH url reaches it is this game's decision, and the urls here are built from a
 * mod's recorded origin rather than written into the build.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { isOpenableUrl, openExternalUrl } from "./external-link";

/* The suite runs in node, so the window this module reaches for is supplied here
 * and taken away again. That is also the shape of the real degradation: no DOM
 * means nothing is opened, and the last test asserts exactly that. */
const g = globalThis as { window?: unknown };
const had = "window" in g;
const before = g.window;

function withWindow(open: (...a: unknown[]) => unknown): void {
  g.window = { open };
}

afterEach(() => {
  vi.restoreAllMocks();
  if (had) g.window = before;
  else delete g.window;
});

describe("which urls may be opened", () => {
  it("takes http and https", () => {
    expect(isOpenableUrl("https://github.com/a/b/issues")).toBe(true);
    expect(isOpenableUrl("http://example.test/x")).toBe(true);
  });

  it("refuses every other scheme, which is the point of asking", () => {
    /* A scheme other than http reaches the operating system's handler for it
     * rather than a browser, and these are reached from data the game did not
     * author. `javascript:` is the one that would run in the game's own page. */
    for (const url of [
      "file:///C:/Windows/System32",
      "javascript:alert(1)",
      "data:text/html,<h1>x</h1>",
      "ms-settings:privacy",
      "vbscript:x",
    ]) {
      expect(isOpenableUrl(url), url).toBe(false);
    }
  });

  it("refuses what is not a url at all", () => {
    expect(isOpenableUrl("")).toBe(false);
    expect(isOpenableUrl("github.com/a/b")).toBe(false);
    expect(isOpenableUrl("   ")).toBe(false);
  });
});

describe("opening one", () => {
  it("asks for a new tab with no handle back into the game", () => {
    /* noopener matters: without it the opened page gets a live `window.opener`
     * pointing at the running game. */
    const open = vi.fn();
    withWindow(open);
    expect(openExternalUrl("https://github.com/a/b/issues")).toBe(true);
    expect(open).toHaveBeenCalledWith(
      "https://github.com/a/b/issues",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("never calls the browser for a url it refused", () => {
    const open = vi.fn();
    withWindow(open);
    expect(openExternalUrl("javascript:alert(1)")).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });

  it("says so rather than throwing when the browser refuses", () => {
    withWindow(() => {
      throw new Error("blocked");
    });
    expect(openExternalUrl("https://github.com/a/b/issues")).toBe(false);
  });

  it("opens nothing, and says so, where there is no browser at all", () => {
    delete (globalThis as { window?: unknown }).window;
    expect(openExternalUrl("https://github.com/a/b/issues")).toBe(false);
  });
});
