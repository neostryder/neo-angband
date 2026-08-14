import { describe, expect, it } from "vitest";

import { discoverMod, listTagRefs, listTags, type DiscoverEnv } from "./mod-discover";

/** A fetch over a fixed URL->body map, counting what was asked for. */
function fakeNet(
  routes: Record<string, string | number>,
): { env: DiscoverEnv; asked: string[] } {
  const asked: string[] = [];
  const env: DiscoverEnv = {
    engineVersion: "0.18.0",
    fetch: (url) => {
      asked.push(url);
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
  return { env, asked };
}

const TAGS = "https://api.github.com/repos/a/b/tags?per_page=100";
const TREE = (tag: string): string =>
  `https://api.github.com/repos/a/b/git/trees/${tag}?recursive=1`;
const RAW = (tag: string, path: string): string =>
  `https://raw.githubusercontent.com/a/b/refs/tags/${tag}/${path}`;

const tagList = (...names: string[]): string =>
  JSON.stringify(names.map((name) => ({ name })));

/** A tags-API response the way GitHub actually shapes it: name plus the commit
 * SHA it currently resolves to. */
const tagListSha = (...entries: ReadonlyArray<readonly [string, string]>): string =>
  JSON.stringify(entries.map(([name, sha]) => ({ name, commit: { sha } })));

const tree = (
  entries: ReadonlyArray<readonly [string, number]>,
  dirs: readonly string[] = [],
): string =>
  JSON.stringify({
    tree: [
      ...entries.map(([path, size]) => ({ path, type: "blob", size })),
      ...dirs.map((path) => ({ path, type: "tree" })),
    ],
  });

const MANIFEST = {
  id: "qol",
  name: "Quality of Life",
  version: "1.2.0",
  shape: "content",
  description: "Conveniences Angband does not have.",
};

describe("listTags", () => {
  it("returns the orderable tags newest first", () => {
    const { env } = fakeNet({ [TAGS]: tagList("v0.9.0", "v1.0.0", "latest", "v0.10.0") });
    return expect(listTags("a/b", env)).resolves.toEqual(["v1.0.0", "v0.10.0", "v0.9.0"]);
  });

  it("says WHICH request was rate-limited, and that it clears itself", () => {
    /* 403 from api.github.com is the one failure a player will actually hit, and
     * "it failed" would send them looking for a fault that is not theirs. */
    const { env } = fakeNet({ [TAGS]: 403 });
    return expect(listTags("a/b", env)).rejects.toThrow(/rate-limiting[\s\S]*try again/u);
  });
});

describe("listTagRefs: the SHA GitHub already sends alongside every tag name", () => {
  it("reads the commit each tag resolves to, newest first", async () => {
    const { env } = fakeNet({
      [TAGS]: tagListSha(["v0.9.0", "sha-old"], ["v1.0.0", "sha-new"]),
    });
    expect(await listTagRefs("a/b", env)).toEqual([
      { name: "v1.0.0", sha: "sha-new" },
      { name: "v0.9.0", sha: "sha-old" },
    ]);
  });

  it("reads null, not a throw, when an entry has no commit at all", async () => {
    /* The response `listTags` has always parsed: no `commit` field, the shape
     * every existing fixture in this file uses. Backward compatible with the
     * OLD shape of response this parsed before SHAs were read from it. */
    const { env } = fakeNet({ [TAGS]: tagList("v1.0.0") });
    expect(await listTagRefs("a/b", env)).toEqual([{ name: "v1.0.0", sha: null }]);
  });

  it("still returns exactly the names listTags always has", async () => {
    /* listTags is now implemented in terms of this - a caller must not be able
     * to tell (mod-refresh.ts's refreshOne calls it and expects string[]). */
    const { env } = fakeNet({
      [TAGS]: tagListSha(["v0.9.0", "s1"], ["v1.0.0", "s2"], ["latest", "s3"]),
    });
    expect(await listTags("a/b", env)).toEqual(["v1.0.0", "v0.9.0"]);
  });
});

describe("discoverMod: everything the row says comes from the MOD", () => {
  it("reads name, description and version out of the repository's manifest", async () => {
    const { env } = fakeNet({
      [TAGS]: tagList("v1.0.0", "v1.2.0"),
      [RAW("v1.2.0", "manifest.json")]: JSON.stringify(MANIFEST),
      [TREE("v1.2.0")]: tree([
        ["manifest.json", 400],
        ["plugin.js", 5000],
        ["plugin.ts", 999_999],
      ]),
    });

    const r = await discoverMod({ repo: "a/b" }, env);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mod.id).toBe("qol");
    expect(r.mod.name).toBe("Quality of Life");
    expect(r.mod.version).toBe("1.2.0");
    expect(r.mod.description).toBe("Conveniences Angband does not have.");
    /* Newest tag, not the first the API listed. */
    expect(r.mod.tag).toBe("v1.2.0");
    expect(r.mod.tags).toEqual(["v1.2.0", "v1.0.0"]);
  });

  it("installs a PINNED tag rather than the newest, when one was named", async () => {
    const { env } = fakeNet({
      [TAGS]: tagList("v1.0.0", "v2.0.0"),
      [RAW("v1.0.0", "manifest.json")]: JSON.stringify(MANIFEST),
      [TREE("v1.0.0")]: tree([["manifest.json", 400]]),
    });

    const r = await discoverMod({ repo: "a/b", tag: "v1.0.0" }, env);

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.mod.tag).toBe("v1.0.0");
  });

  it("still resolves a pinned tag when the tag LIST cannot be read", async () => {
    /* The player named a version; a rate-limited tags call is no reason to
     * refuse it. The row just cannot say what else exists. */
    const { env } = fakeNet({
      [TAGS]: 403,
      [RAW("v1.0.0", "manifest.json")]: JSON.stringify(MANIFEST),
      [TREE("v1.0.0")]: tree([["manifest.json", 400]]),
    });

    const r = await discoverMod({ repo: "a/b", tag: "v1.0.0" }, env);

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mod.tags).toEqual([]);
      /* Nothing to learn a SHA from when the tags call itself could not be read -
       * unknown, not a guess and not a refusal to install. */
      expect(r.mod.sha).toBeNull();
    }
  });

  it("carries the SHA the resolved tag currently points to", async () => {
    const { env } = fakeNet({
      [TAGS]: tagListSha(["v1.0.0", "sha-old"], ["v1.2.0", "sha-current"]),
      [RAW("v1.2.0", "manifest.json")]: JSON.stringify(MANIFEST),
      [TREE("v1.2.0")]: tree([["manifest.json", 400]]),
    });

    const r = await discoverMod({ repo: "a/b" }, env);

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.mod.tag).toBe("v1.2.0");
      expect(r.mod.sha).toBe("sha-current");
    }
  });

  it("carries null when the resolved tag's own entry has no SHA", async () => {
    const { env } = fakeNet({
      [TAGS]: tagList("v1.2.0"), // the old-shaped fixture: no commit field at all
      [RAW("v1.2.0", "manifest.json")]: JSON.stringify(MANIFEST),
      [TREE("v1.2.0")]: tree([["manifest.json", 400]]),
    });

    const r = await discoverMod({ repo: "a/b" }, env);

    expect(r.ok).toBe(true);
    if (r.ok) expect(r.mod.sha).toBeNull();
  });

  it("refuses a repository with no version, and says a branch is not one", async () => {
    const { env } = fakeNet({ [TAGS]: tagList("main", "latest") });
    const r = await discoverMod({ repo: "a/b" }, env);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toMatch(/no released version[\s\S]*branch is not a version/u);
  });

  it("takes the payload the manifest declares, archives included", async () => {
    const { env, asked } = fakeNet({
      [TAGS]: tagList("v1.2.0"),
      [RAW("v1.2.0", "manifest.json")]: JSON.stringify({
        ...MANIFEST,
        payload: { files: ["manifest.json"], archives: ["packs/art.zip"] },
      }),
      [TREE("v1.2.0")]: tree([
        ["manifest.json", 400],
        ["packs/art.zip", 2_000_000],
        ["tools/pack.mjs", 100],
      ]),
    });

    const r = await discoverMod({ repo: "a/b" }, env);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mod.payload).toEqual([
      { kind: "file", path: "manifest.json" },
      { kind: "archive", path: "packs/art.zip" },
    ]);
    expect(r.mod.guessedPayload).toBe(false);
    /* The size is the DECLARED files' size, not the repository's. */
    expect(r.mod.bytes).toBe(2_000_400);
    /* Three requests for a whole mod, not one per file. */
    expect(asked).toHaveLength(3);
  });

  it("falls back to the tree for a repository that declares nothing", async () => {
    /* A third-party mod that has never heard of `payload` still installs. */
    const { env } = fakeNet({
      [TAGS]: tagList("v1.2.0"),
      [RAW("v1.2.0", "manifest.json")]: JSON.stringify(MANIFEST),
      [TREE("v1.2.0")]: tree(
        [
          ["manifest.json", 400],
          ["plugin.js", 5000],
          ["README.md", 200],
          ["plugin.ts", 999_999],
          ["package.json", 300],
          [".github/workflows/ci.yml", 50],
        ],
        ["packs"],
      ),
    });

    const r = await discoverMod({ repo: "a/b" }, env);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mod.guessedPayload).toBe(true);
    expect(r.mod.payload.map((p) => p.path)).toEqual([
      "README.md",
      "manifest.json",
      "plugin.js",
    ]);
    expect(r.mod.bytes).toBe(5600);
  });

  it("refuses when nothing declares a payload AND the tree cannot be read", async () => {
    const { env } = fakeNet({
      [TAGS]: tagList("v1.2.0"),
      [RAW("v1.2.0", "manifest.json")]: JSON.stringify(MANIFEST),
      [TREE("v1.2.0")]: 403,
    });

    const r = await discoverMod({ repo: "a/b" }, env);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toMatch(/does not say which of its files are the mod/u);
  });

  it("keeps a declared payload when the tree fails, minus the size", async () => {
    /* The tree is only needed for the FALLBACK and for the byte count. A mod that
     * said what it ships must not lose its install to a rate-limited API call. */
    const { env } = fakeNet({
      [TAGS]: tagList("v1.2.0"),
      [RAW("v1.2.0", "manifest.json")]: JSON.stringify({
        ...MANIFEST,
        payload: { files: ["manifest.json", "plugin.js"] },
      }),
      [TREE("v1.2.0")]: 403,
    });

    const r = await discoverMod({ repo: "a/b" }, env);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mod.payload).toHaveLength(2);
    expect(r.mod.bytes).toBeNull();
  });

  it("refuses a payload with no manifest.json in it", async () => {
    /* readModDir would reject the folder later; catching it here lets the message
     * name the manifest field that is wrong. */
    const { env } = fakeNet({
      [TAGS]: tagList("v1.2.0"),
      [RAW("v1.2.0", "manifest.json")]: JSON.stringify({
        ...MANIFEST,
        payload: { files: ["plugin.js"] },
      }),
      [TREE("v1.2.0")]: tree([["plugin.js", 10]]),
    });

    const r = await discoverMod({ repo: "a/b" }, env);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toMatch(/does not include manifest\.json/u);
  });

  it("accepts an ARCHIVE-only payload, whose manifest is inside the zip", async () => {
    /* The manifest.json check can only run on a payload of plain files: an
     * archive's manifest is inside a zip nothing has opened yet. Requiring it
     * anyway refused a perfectly good tiles mod, which is what the live canary
     * against neo-linoleum found - its entire payload is seven archives. The
     * installer makes this check on the UNPACKED result, where it can be answered.
     */
    const { env } = fakeNet({
      [TAGS]: tagList("v1.2.0"),
      [RAW("v1.2.0", "manifest.json")]: JSON.stringify({
        ...MANIFEST,
        payload: { archives: ["dist/mod.zip", "dist/tiles.zip"] },
      }),
      [TREE("v1.2.0")]: tree([
        ["dist/mod.zip", 9000],
        ["dist/tiles.zip", 10_000_000],
      ]),
    });

    const r = await discoverMod({ repo: "a/b" }, env);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mod.payload).toEqual([
      { kind: "archive", path: "dist/mod.zip" },
      { kind: "archive", path: "dist/tiles.zip" },
    ]);
    expect(r.mod.bytes).toBe(10_009_000);
  });

  it("still requires manifest.json when every entry IS a plain file", async () => {
    const { env } = fakeNet({
      [TAGS]: tagList("v1.2.0"),
      [RAW("v1.2.0", "manifest.json")]: JSON.stringify({
        ...MANIFEST,
        payload: { files: ["plugin.js"] },
      }),
      [TREE("v1.2.0")]: tree([["plugin.js", 10]]),
    });

    const r = await discoverMod({ repo: "a/b" }, env);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toMatch(/does not include manifest\.json/u);
  });

  it("gets its compatibility verdict from the loader, not a second copy", async () => {
    /* A row that promised what load time refuses is the failure this reuse
     * prevents. `engine` is the MOD's claim; the verdict is the loader's. */
    const { env } = fakeNet({
      [TAGS]: tagList("v1.2.0"),
      [RAW("v1.2.0", "manifest.json")]: JSON.stringify({
        ...MANIFEST,
        engine: ">=99.0.0",
        modApi: 1,
      }),
      [TREE("v1.2.0")]: tree([["manifest.json", 400]]),
    });

    const r = await discoverMod({ repo: "a/b" }, env);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mod.engine).toBe(">=99.0.0");
    expect(r.mod.compatible).toBe(false);
    expect(r.mod.engineNote).toContain("99.0.0");
  });

  it("treats a mod that declares no range as compatible, as the loader does", async () => {
    const { env } = fakeNet({
      [TAGS]: tagList("v1.2.0"),
      [RAW("v1.2.0", "manifest.json")]: JSON.stringify(MANIFEST),
      [TREE("v1.2.0")]: tree([["manifest.json", 400]]),
    });

    const r = await discoverMod({ repo: "a/b" }, env);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mod.engine).toBeNull();
    expect(r.mod.compatible).toBe(true);
  });

  it("never throws - a bad repository is a problem string on its own row", async () => {
    const { env } = fakeNet({});
    const r = await discoverMod({ repo: "a/b" }, env);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem.length).toBeGreaterThan(0);
  });

  it("reports a manifest that is not JSON as such, not as a network fault", async () => {
    const { env } = fakeNet({
      [TAGS]: tagList("v1.2.0"),
      [RAW("v1.2.0", "manifest.json")]: "<!doctype html><h1>404</h1>",
      [TREE("v1.2.0")]: tree([["manifest.json", 400]]),
    });

    const r = await discoverMod({ repo: "a/b" }, env);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toMatch(/not valid JSON/u);
  });

  it("refuses a manifest with no id, which is also the folder name", async () => {
    const { env } = fakeNet({
      [TAGS]: tagList("v1.2.0"),
      [RAW("v1.2.0", "manifest.json")]: JSON.stringify({ name: "x", version: "1.0.0" }),
      [TREE("v1.2.0")]: tree([["manifest.json", 400]]),
    });

    const r = await discoverMod({ repo: "a/b" }, env);

    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toMatch(/declares no id/u);
  });
});

describe("discoverMod: the player's channel decides which version", () => {
  /* One repository with a release and a newer beta, asked three times. */
  const routes = {
    [TAGS]: tagList("v1.2.0", "v1.3.0-beta.1"),
    [RAW("v1.2.0", "manifest.json")]: JSON.stringify(MANIFEST),
    [RAW("v1.3.0-beta.1", "manifest.json")]: JSON.stringify({ ...MANIFEST, version: "1.3.0-beta.1" }),
    [TREE("v1.2.0")]: tree([["manifest.json", 100]]),
    [TREE("v1.3.0-beta.1")]: tree([["manifest.json", 110]]),
  };

  it("offers a stable game the release, not the beta", async () => {
    const { env } = fakeNet(routes);
    const r = await discoverMod({ repo: "a/b" }, { ...env, channel: "stable" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mod.tag).toBe("v1.2.0");
    expect(r.mod.version).toBe("1.2.0");
    /* And says what it is holding back, so the row is not simply mysterious. */
    expect(r.mod.channelHeld).toBe("v1.3.0-beta.1");
    /* The version list offered is the channel's, not the repository's. */
    expect(r.mod.tags).toEqual(["v1.2.0"]);
  });

  it("offers a beta game the beta", async () => {
    const { env } = fakeNet(routes);
    const r = await discoverMod({ repo: "a/b" }, { ...env, channel: "beta" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.mod.tag).toBe("v1.3.0-beta.1");
    expect(r.mod.channelHeld).toBeNull();
  });

  it("honours a tag the PLAYER pinned, whatever the channel says", async () => {
    /* Naming a version is a more specific instruction than a channel preference,
     * and silently declining a URL somebody typed is the worst of both. */
    const { env } = fakeNet(routes);
    const r = await discoverMod(
      { repo: "a/b", tag: "v1.3.0-beta.1" },
      { ...env, channel: "stable" },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.mod.tag).toBe("v1.3.0-beta.1");
  });

  it("blames the CHANNEL, not the mod, when every version is filtered out", async () => {
    /* These need opposite advice - one is answered on the update screen, the other
     * by the mod's author - so they must not share a message. */
    const { env } = fakeNet({
      [TAGS]: tagList("v1.3.0-beta.1"),
      [RAW("v1.3.0-beta.1", "manifest.json")]: JSON.stringify(MANIFEST),
    });
    const r = await discoverMod({ repo: "a/b" }, { ...env, channel: "stable" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problem).toContain("v1.3.0-beta.1");
    expect(r.problem).toMatch(/stable channel/u);
    expect(r.problem).toMatch(/update screen/u);
    /* Must NOT accuse the author of shipping no version. */
    expect(r.problem).not.toMatch(/no released version/u);
  });

  it("still says 'no version at all' when that is the truth", async () => {
    const { env } = fakeNet({ [TAGS]: tagList("latest", "nightly") });
    const r = await discoverMod({ repo: "a/b" }, { ...env, channel: "stable" });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.problem).toMatch(/no released version/u);
    expect(r.problem).not.toMatch(/channel/u);
  });
});
