/**
 * The persistent on-screen sign that an autoplayer holds the keyboard (#125).
 *
 * Before this existed there was nothing on screen for however long a mod held
 * the keyboard - only a one-shot chat line printed on the way OUT. These tests
 * pin what the banner says, that it shows and hides on demand, that a second
 * show updates the same element rather than stacking a duplicate, and that
 * neither function throws when the document is missing or hostile - the same
 * guarantee crash-screen.ts and safe-mode.ts hold themselves to, because this
 * runs inside a boot/pump path that must not itself become a new failure.
 */

import { afterEach, describe, expect, it } from "vitest";
import { hideAutoplayerBanner, showAutoplayerBanner } from "./autoplayer-banner";

/* --- the smallest document that lets the banner build --------------------- */

interface FakeEl {
  tagName: string;
  id: string;
  textContent: string;
  style: { cssText: string };
  attrs: Map<string, string>;
  setAttribute(k: string, v: string): void;
  append(...kids: FakeEl[]): void;
  remove(): void;
}

function el(tagName: string): FakeEl {
  const node: FakeEl = {
    tagName,
    id: "",
    textContent: "",
    style: { cssText: "" },
    attrs: new Map(),
    setAttribute: (k, v) => void node.attrs.set(k, v),
    append: () => {},
    remove: () => {
      removed.add(node);
    },
  };
  return node;
}

let removed: Set<FakeEl>;

function installFakeDom(): { body: FakeEl; byId: Map<string, FakeEl> } {
  removed = new Set();
  const body = el("body");
  const byId = new Map<string, FakeEl>();
  const appended: FakeEl[] = [];
  body.append = (...kids: FakeEl[]) => void appended.push(...kids);
  const doc = {
    createElement: (tag: string) => el(tag),
    getElementById: (id: string) => {
      const found = appended.find((n) => n.id === id && !removed.has(n));
      return found ?? null;
    },
    body,
    documentElement: body,
  };
  (globalThis as { document?: unknown }).document = doc;
  return { body, byId };
}

afterEach(() => {
  hideAutoplayerBanner();
  delete (globalThis as { document?: unknown }).document;
});

describe("showAutoplayerBanner", () => {
  it("names the mod and how to take the keyboard back", () => {
    installFakeDom();
    showAutoplayerBanner("borg");
    const banner = document.getElementById("neo-autoplayer-banner") as unknown as FakeEl | null;
    expect(banner, "a banner element was appended").not.toBeNull();
    expect(banner!.textContent).toContain("borg");
    expect(banner!.textContent.toLowerCase()).toContain("press any key");
  });

  it("marks itself as a status region rather than a blocking dialog", () => {
    /* Unlike crash-screen.ts and safe-mode.ts's alertdialog overlays, this is
     * not something the player must act on before continuing - it is a
     * passive readout, and its ARIA role has to say so. */
    installFakeDom();
    showAutoplayerBanner("borg");
    const banner = document.getElementById("neo-autoplayer-banner") as unknown as FakeEl | null;
    expect(banner!.attrs.get("role")).toBe("status");
  });

  it("updates the same element on a second call instead of stacking a duplicate", () => {
    installFakeDom();
    showAutoplayerBanner("borg");
    showAutoplayerBanner("otherMod");
    const banner = document.getElementById("neo-autoplayer-banner") as unknown as FakeEl | null;
    expect(banner!.textContent).toContain("otherMod");
    expect(banner!.textContent).not.toContain("borg has the keyboard");
  });

  it("does not throw when there is no document at all", () => {
    delete (globalThis as { document?: unknown }).document;
    expect(() => showAutoplayerBanner("borg")).not.toThrow();
  });

  it("does not throw when the document is hostile", () => {
    (globalThis as { document?: unknown }).document = {
      createElement: () => {
        throw new Error("the DOM is gone too");
      },
      getElementById: () => null,
    };
    expect(() => showAutoplayerBanner("borg")).not.toThrow();
  });
});

describe("hideAutoplayerBanner", () => {
  it("removes the element the banner appended", () => {
    installFakeDom();
    showAutoplayerBanner("borg");
    expect(document.getElementById("neo-autoplayer-banner")).not.toBeNull();
    hideAutoplayerBanner();
    expect(document.getElementById("neo-autoplayer-banner")).toBeNull();
  });

  it("is safe to call when the banner was never shown", () => {
    installFakeDom();
    expect(() => hideAutoplayerBanner()).not.toThrow();
  });

  it("does not throw when there is no document at all", () => {
    delete (globalThis as { document?: unknown }).document;
    expect(() => hideAutoplayerBanner()).not.toThrow();
  });

  it("lets a later showAutoplayerBanner append a fresh element", () => {
    /* Proves `shown` is reset on hide - otherwise a second show after a hide
     * would try to update an element that is no longer in the document and
     * the banner would silently stop appearing. */
    installFakeDom();
    showAutoplayerBanner("borg");
    hideAutoplayerBanner();
    showAutoplayerBanner("borg");
    expect(document.getElementById("neo-autoplayer-banner")).not.toBeNull();
  });
});
