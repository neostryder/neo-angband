/**
 * The persistent on-screen sign that a Linoleum pack is converting in the
 * background (#124). Mirrors autoplayer-banner.test.ts's coverage: pins what
 * the banner says, that it shows and hides on demand, that a second show
 * updates the same element rather than stacking a duplicate, and that
 * neither function throws when the document is missing or hostile.
 */

import { afterEach, describe, expect, it } from "vitest";
import { hideTileConversionBanner, showTileConversionBanner } from "./tile-conversion-banner";

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
  hideTileConversionBanner();
  delete (globalThis as { document?: unknown }).document;
});

describe("showTileConversionBanner", () => {
  it("names the pack and that graphics apply once conversion finishes", () => {
    installFakeDom();
    showTileConversionBanner("Shockbolt");
    const banner = document.getElementById("neo-tile-conversion-banner") as unknown as FakeEl | null;
    expect(banner, "a banner element was appended").not.toBeNull();
    expect(banner!.textContent).toContain("Shockbolt");
    expect(banner!.textContent.toLowerCase()).toContain("stays playable");
  });

  it("marks itself as a status region rather than a blocking dialog", () => {
    /* Not something the player must act on before continuing - a passive
     * readout while conversion runs underneath, same as autoplayer-banner.ts. */
    installFakeDom();
    showTileConversionBanner("Shockbolt");
    const banner = document.getElementById("neo-tile-conversion-banner") as unknown as FakeEl | null;
    expect(banner!.attrs.get("role")).toBe("status");
  });

  it("updates the same element on a second call instead of stacking a duplicate", () => {
    installFakeDom();
    showTileConversionBanner("Shockbolt");
    showTileConversionBanner("Gervais");
    const banner = document.getElementById("neo-tile-conversion-banner") as unknown as FakeEl | null;
    expect(banner!.textContent).toContain("Gervais");
    expect(banner!.textContent).not.toContain("Shockbolt");
  });

  it("does not throw when there is no document at all", () => {
    delete (globalThis as { document?: unknown }).document;
    expect(() => showTileConversionBanner("Shockbolt")).not.toThrow();
  });

  it("does not throw when the document is hostile", () => {
    (globalThis as { document?: unknown }).document = {
      createElement: () => {
        throw new Error("the DOM is gone too");
      },
      getElementById: () => null,
    };
    expect(() => showTileConversionBanner("Shockbolt")).not.toThrow();
  });
});

describe("hideTileConversionBanner", () => {
  it("removes the element the banner appended", () => {
    installFakeDom();
    showTileConversionBanner("Shockbolt");
    expect(document.getElementById("neo-tile-conversion-banner")).not.toBeNull();
    hideTileConversionBanner();
    expect(document.getElementById("neo-tile-conversion-banner")).toBeNull();
  });

  it("is safe to call when the banner was never shown", () => {
    installFakeDom();
    expect(() => hideTileConversionBanner()).not.toThrow();
  });

  it("does not throw when there is no document at all", () => {
    delete (globalThis as { document?: unknown }).document;
    expect(() => hideTileConversionBanner()).not.toThrow();
  });

  it("lets a later showTileConversionBanner append a fresh element", () => {
    /* Proves `shown` is reset on hide - otherwise a second show after a hide
     * would try to update an element no longer in the document and the
     * banner would silently stop appearing. */
    installFakeDom();
    showTileConversionBanner("Shockbolt");
    hideTileConversionBanner();
    showTileConversionBanner("Shockbolt");
    expect(document.getElementById("neo-tile-conversion-banner")).not.toBeNull();
  });
});
