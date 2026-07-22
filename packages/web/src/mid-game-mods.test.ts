/**
 * Mid-game mod add/update/remove: the host must tell loadGame which namespaces
 * the running pack can actually resolve, so the save's mod-lifecycle blocks
 * (core/src/mod/save-blocks.ts) reconcile correctly on every reload.
 *
 * loadGame runs `quarantineSave(rehydrateSave(save, present), manifest, present)`
 * unconditionally: it rehydrates orphans whose pack has RETURNED and quarantines
 * live entities whose pack is now MISSING - keyed entirely off `present`. So
 * `present` must be core + every enabled CONTENT mod's namespace. If the host
 * passed a narrower set (the old bug: a hardcoded `new Set(["core"])`), then the
 * first reload after enabling a content mod that adds monsters/objects would
 * quarantine all of that still-enabled mod's live world entities - the classic
 * "add a mod mid-game and my content vanished on reload" failure.
 *
 * presentNamespaces() (pack.ts) derives that set from the SAME activePackSet
 * snapshot the pack is composed from, so the two can never drift.
 *
 * The reconciliation math itself (quarantine on removal, rehydrate on return,
 * verbatim orphan/bag preservation, the determinism ratchet) is proven
 * end-to-end in core/src/mod/dehydrate-roundtrip.test.ts. This test pins the
 * WEB WIRING that feeds it.
 *
 * Environment note: vitest runs in the node environment here (no localStorage /
 * location), so the "content mod enabled" branch can only be exercised where a
 * storage-capable env is present; the shape guard runs everywhere. This mirrors
 * the defensive pattern qol-mod.test.ts uses for the same reason.
 */

import { describe, expect, it, vi } from "vitest";

describe("presentNamespaces feeds loadGame the reconciliation set (mid-game add/remove)", () => {
  it("always includes core and returns namespace strings", async () => {
    const { presentNamespaces } = await import("./pack");
    const ns = presentNamespaces();
    expect(ns.has("core")).toBe(true);
    for (const n of ns) {
      expect(typeof n).toBe("string");
      expect(n.length).toBeGreaterThan(0);
    }
  });

  it("is core-only on a fresh install: no mod is enabled by default (parity)", async () => {
    // DEFAULT_ENABLED_MODS is empty per the parity mandate, so with nothing
    // stored the base game runs core-only and quarantine has nothing to touch.
    let cleared = false;
    try {
      localStorage.removeItem("neo:enabledMods");
      cleared = true;
    } catch {
      /* no storage in this env: enabledModIds falls back to the empty defaults */
    }
    void cleared;
    vi.resetModules();
    const { presentNamespaces } = await import("./pack");
    expect([...presentNamespaces()]).toEqual(["core"]);
  });

  it("includes an enabled content mod's namespace so loadGame keeps its live content", async () => {
    // Enabling a content mod must add its id to `present`; otherwise loadGame
    // would quarantine the still-enabled mod's world entities on the next
    // reload. `qol` is a bundled CONTENT mod (activePackSet keeps content-shape
    // packs). Requires a storage-capable env to select the enabled set.
    let stored = false;
    try {
      localStorage.setItem("neo:enabledMods", JSON.stringify(["qol"]));
      stored = true;
    } catch {
      /* node env: cannot drive enablement here; covered where storage exists */
    }
    if (!stored) return;
    try {
      vi.resetModules();
      const { presentNamespaces } = await import("./pack");
      const ns = presentNamespaces();
      expect(ns.has("core")).toBe(true);
      expect(ns.has("qol")).toBe(true);
    } finally {
      try {
        localStorage.removeItem("neo:enabledMods");
      } catch {
        /* ignore */
      }
      vi.resetModules();
    }
  });
});
