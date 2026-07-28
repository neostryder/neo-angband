/**
 * Mods read from a real directory.
 *
 * Two things this has to get right, and both are about a hostile or careless
 * folder rather than a happy path:
 *
 * 1. A mods directory is PLAYER-SUPPLIED DATA. A hand-edited manifest, a
 *    half-copied folder, a text file someone renamed to .json - none of them may
 *    stop the game booting. Every failure becomes one line the mod manager can
 *    show, which is the same contract z-file.c has when it returns NULL instead
 *    of dying.
 * 2. Who decides what is ENABLED. An external manager's load-order.json and the
 *    player's own toggle can disagree, and the answer has to be stable across
 *    launches - a mod that comes back after being turned off looks broken.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  NO_DISK_PACKS,
  diskPacks,
  loadDiskPacks,
  resetDiskPacks,
  setDiskPacks,
} from "./disk-packs";
import { resolveEnabledIds } from "./mod-store";
import { composeContentPacks } from "@neo-angband/mod-sdk";
import type { LoadedPack } from "@neo-angband/mod-sdk";

afterEach(() => {
  resetDiskPacks();
});

/** A fake mods directory: path -> JSON value. Anything else 404s. */
function serve(tree: Record<string, unknown>) {
  const seen: string[] = [];
  const fetchImpl = async (
    url: string,
  ): Promise<{ ok: boolean; json(): Promise<unknown> }> => {
    seen.push(url);
    if (!(url in tree)) return { ok: false, json: () => Promise.resolve(null) };
    const v = tree[url];
    if (v instanceof Error) throw v;
    return { ok: true, json: () => Promise.resolve(v) };
  };
  return { fetchImpl, seen };
}

const DESKTOP = {
  neoDesktop: { modsIndexUrl: "/mods/index.json", modsBaseUrl: "/mods" },
};

const MANIFEST = (id: string) => ({
  id,
  name: `Mod ${id}`,
  version: "1.0.0",
  shape: "content",
});

describe("loadDiskPacks: no directory", () => {
  it("reports unavailable in a plain browser tab", async () => {
    const r = await loadDiskPacks({ scope: {} });
    expect(r).toEqual(NO_DISK_PACKS);
    expect(r.available).toBe(false);
  });

  it("reports unavailable when the shell exposes no mod URLs", async () => {
    /* An older preload, or one that offers the host bridge and nothing else. */
    const r = await loadDiskPacks({ scope: { neoDesktop: { isDesktop: true } } });
    expect(r.available).toBe(false);
  });

  it("never fetches anything without those URLs", async () => {
    const { fetchImpl, seen } = serve({});
    await loadDiskPacks({ scope: {}, fetchImpl });
    expect(seen).toEqual([]);
  });
});

describe("loadDiskPacks: reading packs", () => {
  it("reads a pack's manifest and every record file", async () => {
    const { fetchImpl } = serve({
      "/mods/index.json": {
        packs: [{ id: "my-mod", files: ["manifest.json", "monster.json", "object.json"] }],
        order: [],
        dir: "D:\\game\\neo-angband-data\\mods",
      },
      "/mods/my-mod/manifest.json": MANIFEST("my-mod"),
      "/mods/my-mod/monster.json": { records: [{ name: "Newt" }] },
      "/mods/my-mod/object.json": { records: [] },
    });
    const r = await loadDiskPacks({ scope: DESKTOP, fetchImpl });
    expect(r.available).toBe(true);
    expect(r.dir).toBe("D:\\game\\neo-angband-data\\mods");
    expect(r.problems).toEqual([]);
    expect(r.packs).toHaveLength(1);
    /* Keyed WITHOUT .json, which is the shape the composer expects - the same
     * keys a bundled pack's glob produces. */
    expect(Object.keys(r.packs[0]!.files).sort()).toEqual(["monster", "object"]);
    expect(r.packs[0]!.manifest.id).toBe("my-mod");
  });

  it("does not treat manifest.json as a record file", async () => {
    const { fetchImpl } = serve({
      "/mods/index.json": { packs: [{ id: "a", files: ["manifest.json"] }] },
      "/mods/a/manifest.json": MANIFEST("a"),
    });
    const r = await loadDiskPacks({ scope: DESKTOP, fetchImpl });
    expect(r.packs[0]!.files).toEqual({});
  });

  it("reads several packs, and keeps the index's order", async () => {
    const { fetchImpl } = serve({
      "/mods/index.json": {
        packs: [
          { id: "aaa", files: ["manifest.json"] },
          { id: "bbb", files: ["manifest.json"] },
        ],
      },
      "/mods/aaa/manifest.json": MANIFEST("aaa"),
      "/mods/bbb/manifest.json": MANIFEST("bbb"),
    });
    const r = await loadDiskPacks({ scope: DESKTOP, fetchImpl });
    expect(r.packs.map((p) => p.manifest.id)).toEqual(["aaa", "bbb"]);
  });
});

describe("loadDiskPacks: a folder that is not a usable mod", () => {
  it("reports a folder with no manifest instead of guessing", async () => {
    const { fetchImpl } = serve({
      "/mods/index.json": { packs: [{ id: "screenshots", files: ["a.json"] }] },
    });
    const r = await loadDiskPacks({ scope: DESKTOP, fetchImpl });
    expect(r.packs).toEqual([]);
    expect(r.problems).toEqual(["screenshots: no manifest.json, so it is not a mod folder"]);
  });

  it("reports a manifest that fails validation, and keeps the good packs", async () => {
    const { fetchImpl } = serve({
      "/mods/index.json": {
        packs: [
          { id: "bad", files: ["manifest.json"] },
          { id: "good", files: ["manifest.json"] },
        ],
      },
      /* No version, so validateManifest rejects it. */
      "/mods/bad/manifest.json": { id: "bad", name: "Bad", shape: "content" },
      "/mods/good/manifest.json": MANIFEST("good"),
    });
    const r = await loadDiskPacks({ scope: DESKTOP, fetchImpl });
    expect(r.packs.map((p) => p.manifest.id)).toEqual(["good"]);
    expect(r.problems.join(" ")).toContain("bad");
    expect(r.problems.join(" ")).toContain("semver");
  });

  it("refuses a folder whose manifest claims a different id", async () => {
    /* Every other surface - the enabled set, the load order, a save's
     * provenance - keys off the manifest id, so a folder called one thing and
     * enabled as another is a mod the player cannot find on disk. */
    const { fetchImpl } = serve({
      "/mods/index.json": { packs: [{ id: "folder-name", files: ["manifest.json"] }] },
      "/mods/folder-name/manifest.json": MANIFEST("something-else"),
    });
    const r = await loadDiskPacks({ scope: DESKTOP, fetchImpl });
    expect(r.packs).toEqual([]);
    expect(r.problems[0]).toContain("rename the folder");
  });

  it("keeps a pack when ONE of its record files is unreadable", async () => {
    const { fetchImpl } = serve({
      "/mods/index.json": {
        packs: [{ id: "a", files: ["manifest.json", "monster.json", "object.json"] }],
      },
      "/mods/a/manifest.json": MANIFEST("a"),
      "/mods/a/monster.json": { records: [] },
      /* object.json missing from the tree: 404. */
    });
    const r = await loadDiskPacks({ scope: DESKTOP, fetchImpl });
    expect(r.packs).toHaveLength(1);
    expect(Object.keys(r.packs[0]!.files)).toEqual(["monster"]);
    expect(r.problems[0]).toContain("a/object.json");
  });

  it("survives an index that is not JSON at all", async () => {
    const { fetchImpl } = serve({ "/mods/index.json": new Error("Unexpected token <") });
    const r = await loadDiskPacks({ scope: DESKTOP, fetchImpl });
    expect(r.available).toBe(true);
    expect(r.packs).toEqual([]);
    expect(r.problems[0]).toContain("Could not read the mods folder");
  });

  it("survives an index of the wrong shape", async () => {
    for (const body of [null, 42, "nope", [1, 2, 3]]) {
      const { fetchImpl } = serve({ "/mods/index.json": body });
      const r = await loadDiskPacks({ scope: DESKTOP, fetchImpl });
      expect(r.packs).toEqual([]);
    }
  });

  it("ignores index entries that are not pack descriptions", async () => {
    const { fetchImpl } = serve({
      "/mods/index.json": { packs: [null, 5, "x", {}, { id: "" }] },
    });
    const r = await loadDiskPacks({ scope: DESKTOP, fetchImpl });
    expect(r.packs).toEqual([]);
    expect(r.problems).toEqual([]);
  });
});

describe("loadDiskPacks: load-order.json", () => {
  it("keeps the manager's order for packs that resolved", async () => {
    const { fetchImpl } = serve({
      "/mods/index.json": {
        packs: [
          { id: "aaa", files: ["manifest.json"] },
          { id: "bbb", files: ["manifest.json"] },
        ],
        order: ["bbb", "aaa"],
      },
      "/mods/aaa/manifest.json": MANIFEST("aaa"),
      "/mods/bbb/manifest.json": MANIFEST("bbb"),
    });
    const r = await loadDiskPacks({ scope: DESKTOP, fetchImpl });
    expect(r.order).toEqual(["bbb", "aaa"]);
  });

  it("reports an ordered id that is not installed", async () => {
    /* A manager that deployed, then the folder was deleted by hand. Silence here
     * would leave the player wondering why their mod does nothing. */
    const { fetchImpl } = serve({
      "/mods/index.json": { packs: [], order: ["ghost"] },
    });
    const r = await loadDiskPacks({ scope: DESKTOP, fetchImpl });
    expect(r.order).toEqual([]);
    expect(r.problems).toEqual(['load-order.json lists "ghost", which is not installed']);
  });

  it("treats a missing or malformed order as no order", async () => {
    for (const order of [undefined, null, "aaa", { aaa: 1 }, [1, 2]]) {
      const { fetchImpl } = serve({
        "/mods/index.json": { packs: [{ id: "aaa", files: ["manifest.json"] }], order },
        "/mods/aaa/manifest.json": MANIFEST("aaa"),
      });
      const r = await loadDiskPacks({ scope: DESKTOP, fetchImpl });
      expect(r.order).toEqual([]);
      expect(r.packs).toHaveLength(1);
    }
  });
});

describe("the latch", () => {
  it("starts empty and holds what boot installs", async () => {
    expect(diskPacks().available).toBe(false);
    const { fetchImpl } = serve({
      "/mods/index.json": { packs: [{ id: "a", files: ["manifest.json"] }] },
      "/mods/a/manifest.json": MANIFEST("a"),
    });
    setDiskPacks(await loadDiskPacks({ scope: DESKTOP, fetchImpl }));
    expect(diskPacks().packs.map((p) => p.manifest.id)).toEqual(["a"]);
  });
});

describe("who decides what is enabled", () => {
  const discovered = ["qol", "deployed"];

  it("enables what an external manager deployed and ordered", async () => {
    /* Nothing stored (first run), a manager put "deployed" in load-order.json:
     * deploying it IS the request to enable it. */
    expect(
      resolveEnabledIds({ url: null, stored: null, discovered, diskOrder: ["deployed"] }),
    ).toEqual(["deployed"]);
  });

  it("appends a deployed mod AFTER the player's own set", async () => {
    /* Load order is the array order, so a deployed pack loads last and does not
     * silently reorder the mods the player already had. */
    expect(
      resolveEnabledIds({
        url: null,
        stored: ["qol"],
        discovered,
        diskOrder: ["deployed"],
      }),
    ).toEqual(["qol", "deployed"]);
  });

  it("keeps a deployed mod OFF once the player turns it off", async () => {
    /* The case that matters: without the explicit choice the disk order would
     * union it back in every launch and the mod would look like it refused to
     * turn off. */
    expect(
      resolveEnabledIds({
        url: null,
        stored: ["qol"],
        discovered,
        diskOrder: ["deployed"],
        choices: { deployed: false },
      }),
    ).toEqual(["qol"]);
  });

  it("lets the player turn off a mod they had enabled, deployed or not", async () => {
    expect(
      resolveEnabledIds({
        url: null,
        stored: ["qol", "deployed"],
        discovered,
        diskOrder: ["deployed"],
        choices: { qol: false, deployed: false },
      }),
    ).toEqual([]);
  });

  it("does not double-list a mod that is both stored and deployed", async () => {
    expect(
      resolveEnabledIds({
        url: null,
        stored: ["deployed"],
        discovered,
        diskOrder: ["deployed"],
      }),
    ).toEqual(["deployed"]);
  });

  it("still lets ?mods= win outright", async () => {
    /* The one-off testing override has to mean exactly what it says, or a
     * reproduction is not one. */
    expect(
      resolveEnabledIds({
        url: [],
        stored: ["qol"],
        discovered,
        diskOrder: ["deployed"],
        choices: { deployed: true },
      }),
    ).toEqual([]);
  });

  it("behaves exactly as before when there is no mods directory", async () => {
    /* The web build's permanent state: no diskOrder, no choices. */
    expect(resolveEnabledIds({ url: null, stored: null, discovered })).toEqual([]);
    expect(resolveEnabledIds({ url: null, stored: ["qol"], discovered })).toEqual(["qol"]);
  });
});

describe("a disk pack reaches the composer", () => {
  it("composes its patch over a core record, from the fetched files alone", async () => {
    /* The link the mod-manager screenshot cannot show: that a pack read off disk
     * is not merely LISTED but is the same thing the composer already accepts.
     * Everything here comes out of loadDiskPacks - nothing is hand-built - so
     * this fails if the fetched `files` map is keyed or shaped differently from
     * a bundled pack's. */
    const { fetchImpl } = serve({
      "/mods/index.json": {
        packs: [{ id: "disk-hound", files: ["manifest.json", "monster.json"] }],
        order: ["disk-hound"],
      },
      "/mods/disk-hound/manifest.json": {
        ...MANIFEST("disk-hound"),
        dependencies: { core: "*" },
      },
      "/mods/disk-hound/monster.json": {
        patches: { "core:grip-farmer-maggot-s-dog": { name: "Grip, the Folder Hound" } },
        records: [{ name: "Folder Newt", hp: 3 }],
      },
    });
    const report = await loadDiskPacks({ scope: DESKTOP, fetchImpl });
    const pack = report.packs[0]!;

    const core: LoadedPack = {
      manifest: { id: "core", name: "Angband", version: "1.0.0", shape: "content" },
      files: {
        monster: {
          records: [
            { name: "Kobold", hp: 8 },
            { name: "Grip, Farmer Maggot's Dog", hp: 5 },
          ],
        },
      },
    };
    const composed = composeContentPacks([
      core,
      { manifest: pack.manifest, files: pack.files } as unknown as LoadedPack,
    ]);
    const names = (composed.records["monster"] as { name: string }[]).map((m) => m.name);
    /* The patch landed on the core record, and the added record follows it. */
    expect(names).toEqual(["Kobold", "Grip, the Folder Hound", "Folder Newt"]);
  });
});
