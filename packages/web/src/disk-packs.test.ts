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

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { problemLines } from "./mod-problems";
import {
  NO_DISK_PACKS,
  combineDiskReports,
  diskPacks,
  loadDiskPacks,
  resetDiskPacks,
  setDiskPacks,
} from "./disk-packs";
import type { DiskPackReport, ModDirKind } from "./disk-packs";
import { resolveEnabledIds } from "./mod-store";
import { composeContentPacks } from "@rpgm-tools/neo-angband-mod-sdk";
import type { LoadedPack } from "@rpgm-tools/neo-angband-mod-sdk";

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
        dir: "D:\\game\\data\\mods",
      },
      "/mods/my-mod/manifest.json": MANIFEST("my-mod"),
      "/mods/my-mod/monster.json": { records: [{ name: "Newt" }] },
      "/mods/my-mod/object.json": { records: [] },
    });
    const r = await loadDiskPacks({ scope: DESKTOP, fetchImpl });
    expect(r.available).toBe(true);
    expect(r.dir).toBe("D:\\game\\data\\mods");
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
    expect(problemLines(r.problems)).toEqual(["screenshots: no manifest.json, so it is not a mod folder"]);
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
    expect(problemLines(r.problems).join(" ")).toContain("bad");
    expect(problemLines(r.problems).join(" ")).toContain("semver");
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
    expect(problemLines(r.problems)[0]).toContain("rename the folder");
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
    /* The mod's id is carried beside the line now, not prefixed into it, so the
     * manager can show this on pack a's own row (mod-problems.ts). */
    expect(r.problems[0]?.id).toBe("a");
    expect(problemLines(r.problems)[0]).toContain("a: object.json");
  });

  it("survives an index that is not JSON at all", async () => {
    const { fetchImpl } = serve({ "/mods/index.json": new Error("Unexpected token <") });
    const r = await loadDiskPacks({ scope: DESKTOP, fetchImpl });
    expect(r.available).toBe(true);
    expect(r.packs).toEqual([]);
    expect(problemLines(r.problems)[0]).toContain("Could not read the mods folder");
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
    expect(problemLines(r.problems)).toEqual(['load-order.json lists "ghost", which is not installed']);
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

/* ------------------------------------------------------------------ *
 * Several sources at once.
 *
 * Boot used to CHOOSE one source, and installed mods were nowhere at all -
 * loadInstalledMods had no production caller, so a mod could be downloaded,
 * digest-checked, stored, and reach nothing. Choosing is right between the shell's
 * folder and a picked one; it is wrong for installed mods, which are not an
 * alternative to having a folder.
 * ------------------------------------------------------------------ */

describe("combineDiskReports", () => {
  /** A report with one pack per id, and resolvers that name their own source. */
  function report(
    kind: ModDirKind,
    dir: string | null,
    ids: readonly string[],
    over: Partial<DiskPackReport> = {},
  ): DiskPackReport {
    const packs = ids.map((id) => ({
      manifest: { id, name: id, version: "1.0.0", shape: "content" },
      files: {},
      code: [],
      assets: [],
    }));
    const codeUrl = Object.assign(
      (id: string, file: string) => Promise.resolve(`${kind}:code:${id}/${file}`),
      { release: (url: string) => released.push(`${kind} <- ${url}`) },
    );
    return {
      packs,
      order: [],
      problems: [],
      dir,
      available: true,
      kind,
      codeUrl,
      assetUrl: (id: string, path: string) =>
        Promise.resolve(`${kind}:asset:${id}/${path}`),
      origins: [{ kind, dir, count: packs.length }],
      ...over,
    } as unknown as DiskPackReport;
  }

  let released: string[] = [];
  beforeEach(() => {
    released = [];
  });

  it("is the unavailable report when nothing is available", () => {
    expect(combineDiskReports([])).toBe(NO_DISK_PACKS);
    expect(combineDiskReports([NO_DISK_PACKS, NO_DISK_PACKS])).toBe(NO_DISK_PACKS);
  });

  it("is the report itself when only one source is live", () => {
    // Identity, not a rebuild: a single source must behave exactly as it did before
    // combining existed, resolvers and all.
    const only = report("picked", "my-mods/", ["a"]);
    expect(combineDiskReports([NO_DISK_PACKS, only, NO_DISK_PACKS])).toBe(only);
  });

  it("unions the packs of every live source", () => {
    const out = combineDiskReports([
      report("picked", "my-mods/", ["a", "b"]),
      report("installed", null, ["c"]),
    ]);
    expect(out.packs.map((p) => p.manifest.id)).toEqual(["a", "b", "c"]);
    expect(out.available).toBe(true);
    expect(out.problems).toEqual([]);
  });

  /*
   * The load-bearing one. Each source reaches bytes its own way - a loopback URL, a
   * blob over a picked File, an IndexedDB read - so one shared resolver would serve a
   * mod's files out of another mod's storage, or (more likely) nothing, and a tile
   * pack that draws no tiles says nothing about why.
   */
  it("routes each mod's resolvers to the source that holds its bytes", async () => {
    const out = combineDiskReports([
      report("picked", "my-mods/", ["a"]),
      report("installed", null, ["b"]),
    ]);
    expect(await out.assetUrl?.("a", "tiles/x.png")).toBe("picked:asset:a/tiles/x.png");
    expect(await out.assetUrl?.("b", "tiles/x.png")).toBe("installed:asset:b/tiles/x.png");
    expect(await out.codeUrl?.("a", "plugin.js")).toBe("picked:code:a/plugin.js");
    expect(await out.codeUrl?.("b", "plugin.js")).toBe("installed:code:b/plugin.js");
  });

  it("has no answer for a mod no source owns", async () => {
    const out = combineDiskReports([
      report("picked", "my-mods/", ["a"]),
      report("installed", null, ["b"]),
    ]);
    expect(await out.assetUrl?.("ghost", "x.png")).toBeNull();
    expect(await out.codeUrl?.("ghost", "plugin.js")).toBeNull();
  });

  /*
   * Releasing is destructive. A blob URL revoked by the wrong source is revoked
   * anyway - the string is unique - but its module GRAPH is not, which leaks one blob
   * per dependency per launch.
   */
  it("routes release back to the source that minted the URL", async () => {
    const out = combineDiskReports([
      report("picked", "my-mods/", ["a"]),
      report("installed", null, ["b"]),
    ]);
    const url = (await out.codeUrl?.("b", "plugin.js")) as string;
    out.codeUrl?.release?.(url);
    expect(released).toEqual(["installed <- installed:code:b/plugin.js"]);
  });

  it("keeps the FIRST source's copy of a duplicate id, and says so", () => {
    const out = combineDiskReports([
      report("picked", "my-mods/", ["shared"]),
      report("installed", null, ["shared", "other"]),
    ]);
    expect(out.packs.map((p) => p.manifest.id)).toEqual(["shared", "other"]);
    // Reported, not dropped in silence: the player has two mods claiming one name.
    expect(problemLines(out.problems)).toEqual(["shared: two sources offer this mod (folder you chose and installed); the folder you chose one is loaded",
    ]);
  });

  it("routes the winner's resolvers, not the loser's", async () => {
    const out = combineDiskReports([
      report("picked", "my-mods/", ["shared"]),
      report("installed", null, ["shared"]),
    ]);
    expect(await out.assetUrl?.("shared", "x.png")).toBe("picked:asset:shared/x.png");
  });

  it("keeps a source with no resolvers from answering for its own mods", async () => {
    const out = combineDiskReports([
      report("picked", "my-mods/", ["a"], { codeUrl: null, assetUrl: null }),
      report("installed", null, ["b"]),
    ]);
    // `a` came from a data-only source, so it has no files to serve - and must not
    // borrow the other source's, which would read another mod's storage.
    expect(await out.assetUrl?.("a", "x.png")).toBeNull();
    expect(await out.assetUrl?.("b", "x.png")).toBe("installed:asset:b/x.png");
  });

  it("is null-resolvered only when NO source can serve", () => {
    const bare = { codeUrl: null, assetUrl: null };
    const out = combineDiskReports([
      report("picked", "my-mods/", ["a"], bare),
      report("installed", null, ["b"], bare),
    ]);
    expect(out.codeUrl).toBeNull();
    expect(out.assetUrl).toBeNull();
  });

  it("orders only ids that actually loaded, once each", () => {
    const out = combineDiskReports([
      report("picked", "my-mods/", ["a", "b"], { order: ["b", "a", "ghost"] }),
      report("installed", null, ["a", "c"], { order: ["a", "c"] }),
    ]);
    // `a` lost its collision to the folder copy, so it is ordered by that one and not
    // twice; `ghost` is in no source's packs.
    expect(out.order).toEqual(["b", "a", "c"]);
  });

  it("carries EVERY origin, so no surface has to claim one describes them all", () => {
    const out = combineDiskReports([
      report("picked", "my-mods/", ["a", "b"]),
      report("installed", null, ["c"]),
    ]);
    expect(out.origins).toEqual([
      { kind: "picked", dir: "my-mods/", count: 2 },
      { kind: "installed", dir: null, count: 1 },
    ]);
    // dir/kind still describe the PRIMARY, which is the one a player copies into.
    expect(out.kind).toBe("picked");
    expect(out.dir).toBe("my-mods/");
  });

  it("concatenates each source's own problems", () => {
    const out = combineDiskReports([
      report("picked", "my-mods/", ["a"], {
        problems: [{ id: null, why: "a folder gripe" }],
      }),
      report("installed", null, ["b"], {
        problems: [{ id: "b", why: "an install gripe" }],
      }),
    ]);
    expect(problemLines(out.problems)).toEqual(["a folder gripe", "b: an install gripe"]);
  });
});
