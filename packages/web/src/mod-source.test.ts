import { describe, expect, it } from "vitest";

import {
  isPayloadPath,
  newestTag,
  originConflict,
  parseRepoRef,
  payloadFromTree,
  repoPageUrl,
  tagsApiUrl,
  treeApiUrl,
  type TreeEntry,
} from "./mod-source";
import type { InstalledModMeta } from "./mod-install";

const ok = (input: string): { repo: string; tag?: string } => {
  const r = parseRepoRef(input);
  if (!r.ok) throw new Error(`expected a ref, got: ${r.problem}`);
  return r.ref;
};

describe("parseRepoRef", () => {
  it("takes the three things a player actually has to hand", () => {
    expect(ok("neostryder/neo-angband-mod-qol")).toEqual({
      repo: "neostryder/neo-angband-mod-qol",
    });
    expect(ok("https://github.com/neostryder/neo-angband-mod-qol")).toEqual({
      repo: "neostryder/neo-angband-mod-qol",
    });
    expect(ok("github.com/neostryder/neo-angband-mod-qol/")).toEqual({
      repo: "neostryder/neo-angband-mod-qol",
    });
  });

  it("reads a /tree/ or /releases/tag/ URL as a PINNED TAG", () => {
    /* Not a branch. A branch is whatever was pushed last, so installing one
     * produces a mod whose bytes change under it - the moving target every
     * pinned reference in this project exists to avoid. */
    expect(ok("https://github.com/a/b/tree/v1.2.3")).toEqual({
      repo: "a/b",
      tag: "v1.2.3",
    });
    expect(ok("https://github.com/a/b/releases/tag/v1.2.3")).toEqual({
      repo: "a/b",
      tag: "v1.2.3",
    });
  });

  it("strips a trailing .git and percent-decodes a tag", () => {
    expect(ok("git@nothing/a/b.git".replace("git@nothing/", ""))).toEqual({
      repo: "a/b",
    });
    expect(ok("github.com/a/b/tree/v1.0.0%2Bbuild")).toEqual({
      repo: "a/b",
      tag: "v1.0.0+build",
    });
  });

  it("refuses what is not a repository, by name", () => {
    for (const bad of ["", "   ", "neostryder", "/", "a//b"]) {
      const r = parseRepoRef(bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.problem.length).toBeGreaterThan(0);
    }
  });

  it("refuses a non-GitHub URL rather than silently mangling it", () => {
    const r = parseRepoRef("https://gitlab.com/a/b");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toMatch(/github\.com/u);
  });
});

describe("URLs", () => {
  it("asks the API for tags and the tree, and github.com for the page", () => {
    expect(tagsApiUrl("a/b")).toBe("https://api.github.com/repos/a/b/tags?per_page=100");
    expect(treeApiUrl("a/b", "v1.0.0")).toBe(
      "https://api.github.com/repos/a/b/git/trees/v1.0.0?recursive=1",
    );
    expect(repoPageUrl("a/b")).toBe("https://github.com/a/b");
    expect(repoPageUrl("a/b", "v1.0.0")).toBe("https://github.com/a/b/tree/v1.0.0");
  });

  it("encodes a tag that needs it", () => {
    expect(treeApiUrl("a/b", "v1.0.0+x")).toContain("v1.0.0%2Bx");
  });
});

describe("newestTag", () => {
  it("orders by version, not by string or by API order", () => {
    /* A string sort puts v0.9.0 above v0.10.0, and the API's own order is by
     * commit date, which a re-tag can invert. */
    expect(newestTag(["v0.9.0", "v0.10.0", "v0.2.0"])).toBe("v0.10.0");
  });

  it("skips a tag that is not a version rather than guessing", () => {
    expect(newestTag(["latest", "nightly", "v1.0.0"])).toBe("v1.0.0");
    /* First in the list, and still skipped - the bug this guards is "whatever
     * came back first". */
    expect(newestTag(["latest", "v1.0.0", "v1.1.0"])).toBe("v1.1.0");
  });

  it("is null when nothing in the repository can be ordered", () => {
    expect(newestTag([])).toBeNull();
    expect(newestTag(["latest", "main"])).toBeNull();
  });

  it("handles prereleases through the shared comparator", () => {
    expect(newestTag(["v1.0.0-rc1", "v1.0.0"])).toBe("v1.0.0");
  });
});

describe("payloadFromTree (the fallback for a repo that declares nothing)", () => {
  const tree = (paths: readonly string[]): TreeEntry[] =>
    paths.map((path) => ({ path, type: "blob", size: 10 }));

  it("keeps what a mod folder needs and drops build scaffolding", () => {
    const { files } = payloadFromTree(
      tree([
        "manifest.json",
        "plugin.js",
        "README.md",
        "LICENSE.md",
        "plugin.ts",
        "plugin.test.ts",
        "package.json",
        "package-lock.json",
        "tsconfig.json",
        "vitest.config.mjs",
        "tools/pack.mjs",
        ".github/workflows/ci.yml",
        ".gitignore",
        "node_modules/x/index.js",
      ]),
    );
    expect(files).toEqual(["LICENSE.md", "README.md", "manifest.json", "plugin.js"]);
  });

  it("drops directory entries, so an empty folder is not stored as a file", () => {
    const { files } = payloadFromTree([
      { path: "packs", type: "tree" },
      { path: "manifest.json", type: "blob", size: 4 },
    ]);
    expect(files).toEqual(["manifest.json"]);
  });

  it("totals the bytes so a row can say the size before downloading", () => {
    const { bytes } = payloadFromTree([
      { path: "manifest.json", type: "blob", size: 400 },
      { path: "plugin.js", type: "blob", size: 5000 },
      { path: "plugin.ts", type: "blob", size: 999_999 },
    ]);
    expect(bytes).toBe(5400);
  });

  it("is deterministic in order, whatever the API returned", () => {
    const a = payloadFromTree(tree(["b.js", "a.js", "manifest.json"])).files;
    const b = payloadFromTree(tree(["manifest.json", "a.js", "b.js"])).files;
    expect(a).toEqual(b);
  });

  it("excludes a dot-directory at any depth, not just the root", () => {
    expect(isPayloadPath("a/.hidden/x.js")).toBe(false);
    expect(isPayloadPath("a/b/.env")).toBe(false);
    expect(isPayloadPath("a/b/c.js")).toBe(true);
  });
});

describe("originConflict (trust on first use)", () => {
  const meta = (repo: string): InstalledModMeta => ({
    id: "qol",
    repo,
    tag: "v1.0.0",
    files: ["manifest.json"],
    installedAt: "2026-01-01T00:00:00.000Z",
  });

  it("lets a first install through, and a reinstall from the same place", () => {
    expect(originConflict(null, "a/b")).toBeNull();
    expect(originConflict(meta("a/b"), "a/b")).toBeNull();
  });

  it("refuses a copy of an installed mod from somewhere else, naming both", () => {
    const problem = originConflict(meta("neostryder/qol"), "someoneelse/qol");
    expect(problem).not.toBeNull();
    expect(problem).toContain("neostryder/qol");
    expect(problem).toContain("someoneelse/qol");
  });

  it("does not cry wolf over GitHub's case-insensitive names", () => {
    /* A false alarm here is worse than none: it teaches the player to click
     * through the one warning that means something. */
    expect(originConflict(meta("NeoStryder/QoL"), "neostryder/qol")).toBeNull();
  });
});
