/**
 * `createModReader`: `ctx.readMod` resolves through the SAME functions the
 * mods screen's "install from a repository" door calls (`parseRepoRef`,
 * `discoverMod`), never a second copy of that walk.
 */

import { describe, expect, it } from "vitest";
import { createModReader, type ReadDoorDeps } from "./mod-read-runtime";
import type { DiscoverEnv, DiscoverResponse } from "./mod-discover";

/** A fetch over a fixed URL->body map - the same fixture shape mod-discover.test.ts uses. */
function fakeNet(routes: Record<string, string | number>): ReadDoorDeps {
  const env: DiscoverEnv = {
    engineVersion: "0.18.0",
    fetch: (url): Promise<DiscoverResponse> => {
      const body = routes[url];
      if (body === undefined) {
        return Promise.resolve({ ok: false, status: 404, text: () => Promise.resolve("") });
      }
      if (typeof body === "number") {
        return Promise.resolve({ ok: false, status: body, text: () => Promise.resolve("") });
      }
      return Promise.resolve({ ok: true, status: 200, text: () => Promise.resolve(body) });
    },
  };
  return { env: () => env };
}

const TAGS = "https://api.github.com/repos/a/b/tags?per_page=100";
const TREE = (tag: string): string =>
  `https://api.github.com/repos/a/b/git/trees/${tag}?recursive=1`;
const RAW = (tag: string, path: string): string =>
  `https://raw.githubusercontent.com/a/b/refs/tags/${tag}/${path}`;

const tagList = (...names: string[]): string =>
  JSON.stringify(names.map((name) => ({ name })));

const tree = (entries: ReadonlyArray<readonly [string, number]>): string =>
  JSON.stringify({ tree: entries.map(([path, size]) => ({ path, type: "blob", size })) });

const MANIFEST = {
  id: "qol",
  name: "Quality of Life",
  version: "1.2.0",
  shape: "content",
  description: "Conveniences Angband does not have.",
};

describe("createModReader: real resolution", () => {
  it("resolves owner/repo to the manifest and payload listing, exactly as discoverMod does", async () => {
    const deps = fakeNet({
      [TAGS]: tagList("v1.2.0"),
      [RAW("v1.2.0", "manifest.json")]: JSON.stringify(MANIFEST),
      [TREE("v1.2.0")]: tree([
        ["manifest.json", 400],
        ["plugin.js", 5000],
      ]),
    });
    const readMod = createModReader(deps);
    const r = await readMod("a/b");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mod.id).toBe("qol");
    expect(r.mod.name).toBe("Quality of Life");
    expect(r.mod.version).toBe("1.2.0");
    expect(r.mod.compatible).toBe(true);
    /* The listing, not the bytes: paths only. */
    expect(r.mod.payload).toEqual([
      { kind: "file", path: "manifest.json" },
      { kind: "file", path: "plugin.js" },
    ]);
  });

  it("also resolves a github.com URL and a pinned-tag tree URL, the same as the install door", async () => {
    const deps = fakeNet({
      [TAGS]: tagList("v1.0.0", "v1.2.0"),
      [RAW("v1.0.0", "manifest.json")]: JSON.stringify({ ...MANIFEST, version: "1.0.0" }),
      [TREE("v1.0.0")]: tree([["manifest.json", 400]]),
    });
    const readMod = createModReader(deps);
    const r = await readMod("https://github.com/a/b/tree/v1.0.0");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mod.tag).toBe("v1.0.0");
    expect(r.mod.version).toBe("1.0.0");
  });
});

describe("createModReader: refuses rather than guesses", () => {
  it("refuses cleanly, never throwing, on a reference that does not even parse", async () => {
    const readMod = createModReader(fakeNet({}));
    const r = await readMod("not a repository");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problem.length).toBeGreaterThan(0);
  });

  it("refuses cleanly on a repository with no runnable version", async () => {
    const deps = fakeNet({ [TAGS]: tagList("not-a-version") });
    const readMod = createModReader(deps);
    const r = await readMod("a/b");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problem.length).toBeGreaterThan(0);
  });

  it("refuses an engine-incompatible resolution instead of handing back compatible: false", async () => {
    /* discoverMod itself can answer {ok: true, mod} with mod.compatible ===
     * false (its own way of showing a row "here is the newest version, and
     * here is why it will not run"). A plugin asking what a mod IS has no use
     * for one it could not itself run, so this is the one rule createModReader
     * adds on top of discoverMod's own answer. */
    const deps = fakeNet({
      [TAGS]: tagList("v1.2.0"),
      [RAW("v1.2.0", "manifest.json")]: JSON.stringify({
        ...MANIFEST,
        engine: ">=99.0.0",
        modApi: 1,
      }),
      [TREE("v1.2.0")]: tree([["manifest.json", 400]]),
    });
    const readMod = createModReader(deps);
    const r = await readMod("a/b");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problem).toContain("99.0.0");
  });

  it("refuses with the host's own sentence on a repository with no tags at all", async () => {
    const readMod = createModReader(fakeNet({ [TAGS]: 404 }));
    const r = await readMod("a/b");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problem.length).toBeGreaterThan(0);
  });
});
