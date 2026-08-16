import { describe, expect, it } from "vitest";

import {
  isPayloadPath,
  newestTag,
  originConflict,
  parseRepoRef,
  payloadFromTree,
  repoPageUrl,
  tagIsPrerelease,
  tagsApiUrl,
  tagsInChannel,
  treeApiUrl,
  type TreeEntry,
} from "./mod-source";
import { releasesIn } from "./update";
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

describe("the mod channel is the GAME's channel", () => {
  const TAGS = ["v0.12.0", "v0.13.0", "v0.14.0-beta.1", "v0.14.0-edge.7"];

  it("gives stable only the plain releases", () => {
    expect(tagsInChannel("stable", TAGS).tags).toEqual(["v0.12.0", "v0.13.0"]);
  });

  it("gives beta the pre-releases as well, but not the per-commit builds", () => {
    expect(tagsInChannel("beta", TAGS).tags).toEqual([
      "v0.12.0",
      "v0.13.0",
      "v0.14.0-beta.1",
    ]);
  });

  it("gives early everything", () => {
    expect(tagsInChannel("early", TAGS).tags).toEqual(TAGS);
  });

  it("is INCLUSIVE DOWNWARD, so choosing beta never costs access to a mod", () => {
    /* The failure this prevents: a mod that has only ever cut plain releases would
     * be invisible to every beta and early player if a channel saw only its own
     * kind of version. Which is nearly every mod - three of the four in the curated
     * registry have never published a prerelease. */
    const releasesOnly = ["v1.0.0", "v1.1.0"];
    for (const channel of ["stable", "beta", "early"] as const) {
      expect(tagsInChannel(channel, releasesOnly).tags, channel).toEqual(releasesOnly);
    }
  });

  it("reports the newest version it held back, so a row can say why", () => {
    /* Otherwise a player on stable sees the game offer 0.13.0 while GitHub shows
     * 0.14.0-beta.1 and concludes the game is broken. */
    expect(tagsInChannel("stable", TAGS).held).toBe("v0.14.0-edge.7");
    expect(tagsInChannel("beta", TAGS).held).toBe("v0.14.0-edge.7");
    expect(tagsInChannel("early", TAGS).held).toBeNull();
  });

  it("does not report a held version that a newer allowed one supersedes", () => {
    /* An old prerelease is not being kept from anybody: v0.13.0 is newer. Reporting
     * it would put a permanent "your channel is holding something back" note on a
     * row that is showing the newest thing there is. */
    expect(tagsInChannel("stable", ["v0.12.0-beta.1", "v0.13.0"]).held).toBeNull();
  });

  it("agrees with the game's own updater about what a channel means", () => {
    /* THE POINT. Not "these two look similar" - the same rule, exercised through
     * both doors, asserted to give the same answer. If channelAccepts is ever
     * copied instead of called, one of these stops matching.
     *
     * Note releasesIn is fed prerelease=true for the plain versions, because that
     * is what GitHub reports for every 0.x release here; the mod side derives it
     * from the tag. The asymmetry is deliberate and is why the flag is a parameter. */
    for (const channel of ["stable", "beta", "early"] as const) {
      const viaTags = tagsInChannel(channel, TAGS).tags;
      const viaReleases = releasesIn(
        channel,
        TAGS.map((t) => ({
          tag: t,
          version: t,
          prerelease: tagIsPrerelease(t),
          draft: false,
          url: "",
          assets: [],
          notes: null,
        })),
      ).map((r) => r.version);
      expect(viaTags, channel).toEqual(viaReleases);
    }
  });
});

describe("tagIsPrerelease", () => {
  it("reads the suffix, with or without the v", () => {
    expect(tagIsPrerelease("v1.2.3")).toBe(false);
    expect(tagIsPrerelease("1.2.3")).toBe(false);
    expect(tagIsPrerelease("v1.2.3-beta.1")).toBe(true);
    expect(tagIsPrerelease("1.2.3-rc.1")).toBe(true);
    expect(tagIsPrerelease("v0.18.1-edge.15")).toBe(true);
  });

  it("does not call an unreadable tag a prerelease", () => {
    /* It sorts nowhere, newestTag already declines to pick it, and guessing would
     * put it on a channel it was never meant for. */
    for (const tag of ["latest", "nightly", "my-mod-v1", "", "release-2"]) {
      expect(tagIsPrerelease(tag), tag).toBe(false);
    }
  });

  it("does not mistake build metadata for a prerelease", () => {
    /* `+build.5` is not a prerelease and has no hyphen, so it never reaches the
     * comparator at all. Measured, not assumed: compareSemver answers null for it -
     * the SDK's parser does not accept build metadata - so a version carrying it is
     * unorderable and newestTag declines to pick it either way. */
    expect(tagIsPrerelease("v1.2.3+build.5")).toBe(false);
  });

  it("does not call a hyphen it cannot parse a prerelease", () => {
    /* The comparator path, exercised: these DO have a hyphen, so the only thing
     * standing between them and the beta channel is compareSemver declining to rank
     * them below a release. Measured: it answers null for both. */
    for (const tag of ["v1.2.3-", "v1.2-x"]) {
      expect(tagIsPrerelease(tag), tag).toBe(false);
    }
  });

  it("DOES accept an odd suffix the comparator can still rank", () => {
    /* `beta..1` is not something anybody should tag, but compareSemver reads it and
     * ranks it below 1.2.3, so it is a prerelease and belongs on the beta channel.
     * The rule is "what the comparator says", not "what looks tidy" - and this is
     * the case where those two answers differ, so it is written down rather than
     * left to be rediscovered. */
    expect(tagIsPrerelease("v1.2.3-beta..1")).toBe(true);
  });
});
