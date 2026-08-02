/**
 * The crash screen, which only ever runs when everything else has stopped
 * working - so the two properties worth pinning are what it SAYS and that it
 * cannot itself throw.
 */

import { afterEach, describe, expect, it } from "vitest";
import { crashReport, resetCrashScreen, showCrashScreen } from "./crash-screen";

/* --- the smallest document that lets the overlay build ------------------- */

interface FakeEl {
  tagName: string;
  id: string;
  type?: string;
  textContent: string;
  style: { cssText: string };
  children: FakeEl[];
  setAttribute(k: string, v: string): void;
  addEventListener(t: string, fn: () => void): void;
  append(...kids: FakeEl[]): void;
  remove(): void;
}

function el(tagName: string): FakeEl {
  const node: FakeEl = {
    tagName,
    id: "",
    textContent: "",
    style: { cssText: "" },
    children: [],
    setAttribute: () => {},
    addEventListener: () => {},
    append: (...kids) => void node.children.push(...kids),
    remove: () => {},
  };
  return node;
}

function installFakeDom(): { body: FakeEl; byId: Map<string, FakeEl> } {
  const body = el("body");
  const byId = new Map<string, FakeEl>();
  const doc = {
    createElement: (tag: string) => {
      const node = el(tag);
      /* Registered lazily so `id` assignments after creation are visible. */
      queueMicrotask(() => {
        if (node.id) byId.set(node.id, node);
      });
      return node;
    },
    getElementById: (id: string) => byId.get(id) ?? null,
    body,
    documentElement: body,
  };
  (globalThis as { document?: unknown }).document = doc;
  return { body, byId };
}

/** Every string anywhere in the overlay tree. */
function allText(node: FakeEl): string {
  return [node.textContent, ...node.children.map(allText)].join(" ");
}

afterEach(() => {
  resetCrashScreen();
  delete (globalThis as { document?: unknown }).document;
});

describe("crashReport", () => {
  it("carries the four things a maintainer cannot get any other way", () => {
    const err = new Error("boom");
    err.stack = "Error: boom\n  at somewhere";
    const text = crashReport(err, "the game was running", "0.14.0", "Firefox/148");
    expect(text).toContain("0.14.0"); // which build - decides if it still exists
    expect(text).toContain("the game was running"); // what it was doing
    expect(text).toContain("Firefox/148"); // where
    expect(text).toContain("at somewhere"); // the stack, not just the message
  });

  it("survives a thrown non-Error", () => {
    expect(crashReport("just a string", "x", "1.0.0")).toContain("just a string");
    expect(crashReport({ odd: true }, "x", "1.0.0")).toContain("odd");
    expect(crashReport(undefined, "x", "1.0.0")).toContain("1.0.0");
    /* A cyclic object is exactly the sort of thing an error handler must not
     * die on, because JSON.stringify throws on it. */
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(() => crashReport(cyclic, "x", "1.0.0")).not.toThrow();
  });

  it("omits the user agent line rather than printing an empty one", () => {
    expect(crashReport(new Error("b"), "x", "1.0.0")).not.toContain("\n\n\n");
  });
});

describe("showCrashScreen", () => {
  it("leads with the fact the save is safe, then how to report it", () => {
    const { body } = installFakeDom();
    showCrashScreen(new Error("boom"), "booting", "0.14.0");

    const overlay = body.children[0];
    expect(overlay, "nothing was appended to the body").toBeDefined();
    const text = allText(overlay!);

    /* The order matters as much as the presence: the first thing a player
     * fears after a crash in a permadeath game is that the character is gone. */
    const safeAt = text.indexOf("have not been touched");
    const reportAt = text.indexOf("github.com/neostryder/neo-angband/issues");
    expect(safeAt).toBeGreaterThan(-1);
    expect(reportAt).toBeGreaterThan(-1);
    expect(safeAt).toBeLessThan(reportAt);

    expect(text).toContain("discord.gg");
    expect(text).toContain("0.14.0");
    expect(text).toContain("boom");
  });

  it("offers a way out that is not a reload", () => {
    /* A global handler will sometimes catch something benign. Covering the
     * game permanently for that would be a worse bug than the one it caught. */
    const { body } = installFakeDom();
    showCrashScreen(new Error("boom"), "booting", "0.14.0");
    const labels = (body.children[0]?.children ?? []).flatMap((c) =>
      c.children.map((b) => b.textContent),
    );
    expect(labels).toContain("Close and carry on");
    expect(labels).toContain("Reload the game");
    expect(labels).toContain("Copy this report");
  });

  it("shows the FIRST error, not the latest", () => {
    /* The first one happened while the program was still in a state worth
     * describing; the cascade after it usually describes the wreckage. */
    const { body } = installFakeDom();
    showCrashScreen(new Error("the real one"), "booting", "0.14.0");
    showCrashScreen(new Error("a consequence"), "booting", "0.14.0");
    expect(body.children).toHaveLength(1);
    expect(allText(body.children[0]!)).toContain("the real one");
    expect(allText(body.children[0]!)).not.toContain("a consequence");
  });

  it("does not throw when there is no document at all", () => {
    delete (globalThis as { document?: unknown }).document;
    expect(() => showCrashScreen(new Error("boom"), "booting", "0.14.0")).not.toThrow();
  });

  it("does not throw when the document is hostile", () => {
    (globalThis as { document?: unknown }).document = {
      createElement: () => {
        throw new Error("the DOM is gone too");
      },
      getElementById: () => null,
    };
    expect(() => showCrashScreen(new Error("boom"), "booting", "0.14.0")).not.toThrow();
  });
});
