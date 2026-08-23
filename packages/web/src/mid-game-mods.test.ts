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

import { webcrypto } from "node:crypto";

import { loadGame, saveGame, startGame } from "@rpgm-tools/neo-angband-core";
import { describe, expect, it, vi } from "vitest";
import type { DiskPackReport } from "./disk-packs";
import type { InstalledModMeta } from "./mod-install";

describe("presentNamespaces feeds loadGame the reconciliation set (mid-game add/remove)", () => {
  /* 20s, and not because the assertions are slow. This is the first import of
   * ./pack in the file, so it pays for loading and composing the ENTIRE content
   * pack - measured at 3.8s on an idle machine, which is 76% of vitest's 5s
   * default before any contention at all. Under the full suite the parallel load
   * tipped it over, and a test that fails on how busy the machine is teaches
   * nobody anything. The budget is raised rather than the work moved because the
   * work IS the subject: presentNamespaces has to be read off a real composition. */
  it("always includes core and returns namespace strings", async () => {
    const { presentNamespaces } = await import("./pack");
    const ns = presentNamespaces();
    expect(ns.has("core")).toBe(true);
    for (const n of ns) {
      expect(typeof n).toBe("string");
      expect(n.length).toBeGreaterThan(0);
    }
  }, 20_000);

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

/**
 * presentPackDigests's web wiring (issue #20): the digest sibling of
 * presentNamespaces above. loadGame's `currentPacks` option needs one
 * `SavePackRef` per present pack this host can measure right now, so it can
 * catch a pack that PATCHED a record instead of only adding one. Session mods
 * carry a whole-archive digest from staging; installed content mods carry a
 * whole-pack digest assembled from their recorded per-file hashes before boot.
 *
 * Same node-environment caveat as above: no `sessionStorage` global exists
 * here by default, so a fake one is stubbed in directly (a plain property
 * assignment, not a storage API call, so it needs no try/catch) and always
 * torn back down, mirroring session-composition.test.ts's own `store()` fake
 * for the same reason (this file's SessionStorageLike shape).
 */
function fakeSessionStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
  } as Storage;
}

/** Write one staged-mod record in the exact shape sessionMods() reads back. */
function stashSessionModRecord(mod: {
  id: string;
  version: string;
  digest: string;
}): void {
  (globalThis as { sessionStorage: Storage }).sessionStorage.setItem(
    "neo:sessionMods",
    JSON.stringify({
      v: 1,
      mods: [{ ...mod, source: "draft.zip", code: false, granted: [], zip: "" }],
    }),
  );
}

/** One installed content pack whose only contribution patches a core monster. */
function installedPatchReport(name: string): DiskPackReport {
  return {
    packs: [
      {
        manifest: {
          id: "installed-hound",
          name: "Installed Hound",
          version: "1.0.0",
          shape: "content",
          dependencies: { core: "*" },
        },
        files: {
          monster: {
            patches: {
              "core:grip-farmer-maggot-s-dog": { name },
            },
          },
        },
        code: [],
        assets: [],
      },
    ],
    order: ["installed-hound"],
    problems: [],
    dir: null,
    available: true,
    kind: "installed",
    codeUrl: null,
    assetUrl: null,
    origins: [{ kind: "installed", dir: null, count: 1 }],
  };
}

/** The two per-file hashes an installed mod has after its bytes are stored. */
function installedPatchMeta(monsterDigest: string): InstalledModMeta {
  return {
    id: "installed-hound",
    repo: "a-player/installed-hound",
    tag: "v1.0.0",
    files: ["manifest.json", "monster.json"],
    installedAt: "2026-08-23T00:00:00.000Z",
    digests: {
      "manifest.json": "a".repeat(64),
      "monster.json": monsterDigest,
    },
  };
}

describe("presentPackDigests feeds loadGame measured content-pack digests", () => {
  it("returns nothing when no session pack is staged", async () => {
    const { presentPackDigests } = await import("./pack");
    expect(presentPackDigests()).toEqual([]);
  });

  it("reports a staged session pack's id/version/digest as a SavePackRef", async () => {
    const original = (globalThis as { sessionStorage?: unknown }).sessionStorage;
    (globalThis as { sessionStorage?: unknown }).sessionStorage = fakeSessionStorage();
    try {
      stashSessionModRecord({ id: "frost", version: "1.2.0", digest: "abc123" });
      vi.resetModules();
      const { presentPackDigests } = await import("./pack");
      expect(presentPackDigests()).toEqual([
        { id: "frost", version: "1.2.0", hash: "abc123" },
      ]);
    } finally {
      if (original === undefined) {
        delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
      } else {
        (globalThis as { sessionStorage?: unknown }).sessionStorage = original;
      }
      vi.resetModules();
    }
  });

  it("skips a staged pack whose digest could not be measured (empty string, not a hash of nothing)", async () => {
    const original = (globalThis as { sessionStorage?: unknown }).sessionStorage;
    (globalThis as { sessionStorage?: unknown }).sessionStorage = fakeSessionStorage();
    try {
      stashSessionModRecord({ id: "no-subtle", version: "1.0.0", digest: "" });
      vi.resetModules();
      const { presentPackDigests } = await import("./pack");
      expect(presentPackDigests()).toEqual([]);
    } finally {
      if (original === undefined) {
        delete (globalThis as { sessionStorage?: unknown }).sessionStorage;
      } else {
        (globalThis as { sessionStorage?: unknown }).sessionStorage = original;
      }
      vi.resetModules();
    }
  });

  it("warns when an enabled installed content patch's stored bytes change", async () => {
    vi.resetModules();
    const { resetDiskPacks, setDiskPacks } = await import("./disk-packs");
    const pack = await import("./pack");
    try {
      setDiskPacks(installedPatchReport("Grip, the Installed Hound"));
      await pack.prefetchInstalledPackDigests([installedPatchMeta("b".repeat(64))], {
        crypto: webcrypto,
      });

      const savedPack = pack.loadGamePack();
      const savedMonsters = savedPack.mon as { monsters: readonly { name: string }[] };
      expect(savedMonsters.monsters.some((monster) => monster.name === "Grip, the Installed Hound")).toBe(
        true,
      );
      const saved = saveGame(
        startGame(savedPack, { seed: 20260823, depth: 1, className: "Warrior" }),
      );
      const before = pack.presentPackDigests().find((entry) => entry.id === "installed-hound");
      expect(before).toBeDefined();
      if (!before) throw new Error("installed pack digest was not prefetched");
      if (!before.hash) throw new Error("installed pack digest was empty");
      if (!saved.manifest) throw new Error("save has no pack manifest");
      /* loadGamePack owns the web composition, while this core save fixture owns
       * its manifest explicitly, as the core issue #20 proof does. The entry is
       * exactly what the host's save path writes once `currentPacks` is supplied. */
      saved.manifest.packs.push(before);
      saved.manifest.loadOrder.push(before.id);

      /* A re-install with changed monster bytes changes both the composed patch
       * and InstalledModMeta.digests. The next synchronous boot only sees the
       * prefetched aggregate, which is enough for loadGame to report the change. */
      setDiskPacks(installedPatchReport("Grip, the Changed Installed Hound"));
      await pack.prefetchInstalledPackDigests([installedPatchMeta("c".repeat(64))], {
        crypto: webcrypto,
      });
      const changedPack = pack.loadGamePack();
      const changedMonsters = changedPack.mon as { monsters: readonly { name: string }[] };
      expect(
        changedMonsters.monsters.some(
          (monster) => monster.name === "Grip, the Changed Installed Hound",
        ),
      ).toBe(true);

      const restored = loadGame(changedPack, saved, pack.presentNamespaces(), {
        currentPacks: pack.presentPackDigests(),
      });
      expect(restored.mismatchedPacks).toEqual(["installed-hound"]);
    } finally {
      resetDiskPacks();
      vi.resetModules();
    }
  }, 30_000);
});
