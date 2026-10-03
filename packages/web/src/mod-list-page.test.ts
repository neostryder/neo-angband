/**
 * docs/MOD_LIST.md and the script that builds it (tools/mod-list.mjs), offline.
 *
 * The script needs the network and runs by hand, so nothing here calls it for
 * real. What these tests hold is the part that can drift without anyone running
 * it: the committed page has to name every repository in mods/registry.json and
 * mods/listed.json, in the right section, and nothing else. Adding a mod to a
 * list without rebuilding the page fails here.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  escapeMarkdown,
  modFacts,
  pageRepos,
  pickRelease,
  readSources,
  renderPage,
  // @ts-expect-error -- plain .mjs tooling, no types; see tools/mod-list.mjs
} from "../../../tools/mod-list.mjs";

interface Source {
  repo: string;
  inGame: boolean;
}
interface Found {
  firstParty: string[];
  community: string[];
  unreleased: string[];
}

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const lower = (list: readonly string[]): string[] => list.map((r) => r.toLowerCase()).sort();

const fact = (repo: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  repo,
  id: repo.split("/")[1],
  name: `Name of ${repo}`,
  description: "First paragraph.\n\nSecond paragraph.",
  author: "someone",
  engine: ">=1.0.0",
  tag: "v1.0.0",
  prerelease: false,
  date: "2026-10-01",
  releaseUrl: `https://github.com/${repo}/releases/tag/v1.0.0`,
  docs: `https://github.com/${repo}/blob/v1.0.0/README.md`,
  inGame: true,
  ...over,
});

describe("the committed mod list page", () => {
  const sources = readSources(repoRoot) as { firstParty: Source[]; community: Source[] };
  const page = readFileSync(join(repoRoot, "docs", "MOD_LIST.md"), "utf8");
  const found = pageRepos(page) as Found;

  it("names every first-party repository in the source lists, and no other", () => {
    const listed = lower(found.firstParty);
    const expected = lower(sources.firstParty.map((s) => s.repo)).filter(
      (r) => !lower(found.unreleased).includes(r),
    );
    expect(listed).toEqual(expected);
  });

  it("names every community repository in the source lists, and no other", () => {
    const listed = lower(found.community);
    const expected = lower(sources.community.map((s) => s.repo)).filter(
      (r) => !lower(found.unreleased).includes(r),
    );
    expect(listed).toEqual(expected);
  });

  it("only leaves off repositories that are in the source lists", () => {
    const all = lower([...sources.firstParty, ...sources.community].map((s) => s.repo));
    for (const repo of lower(found.unreleased)) expect(all).toContain(repo);
  });

  it("lists the page-only first-party mods without putting them in the game's list", () => {
    /* mods/listed.json is the page's own addition; the game reads registry.json
     * only, so nothing in listed.json can reach the Recommended screen. */
    const registry = JSON.parse(
      readFileSync(join(repoRoot, "mods", "registry.json"), "utf8"),
    ) as { mods: Array<{ repo: string }>; community?: Array<{ repo: string }> };
    const inGame = lower([...registry.mods, ...(registry.community ?? [])].map((e) => e.repo));
    const pageOnly = sources.firstParty.filter((s) => !s.inGame);
    expect(pageOnly.length).toBeGreaterThan(0);
    for (const s of pageOnly) expect(inGame).not.toContain(s.repo.toLowerCase());
  });

  it("is plain ASCII", () => {
    expect([...page].filter((c) => c !== "\n" && (c < " " || c > "~"))).toEqual([]);
  });
});

describe("renderPage", () => {
  it("shows an empty community list as a sentence, not a bare heading", () => {
    const page = renderPage({ firstParty: [fact("a/one")], community: [], unreleased: [] }) as string;
    expect(page).toContain("## Community mods");
    expect(page).toContain("No community mods are listed yet.");
    expect(pageRepos(page)).toEqual({ firstParty: ["a/one"], community: [], unreleased: [] });
  });

  it("puts each group under its own heading, and says where each installs from", () => {
    const page = renderPage({
      firstParty: [fact("a/one"), fact("a/two", { inGame: false })],
      community: [fact("c/three")],
      unreleased: ["a/four"],
    }) as string;
    expect(pageRepos(page)).toEqual({
      firstParty: ["a/one", "a/two"],
      community: ["c/three"],
      unreleased: ["a/four"],
    });
    expect(page).not.toContain("No community mods are listed yet.");
    expect(page).toContain("- In the game: install it by repository address");
    expect(page).toContain("- In the game: **Recommended mods...**, under **Community mods**");
    expect(page).toContain("First paragraph.\n\nSecond paragraph.");
  });

  it("says when the newest release is a pre-release, and when no engine range is declared", () => {
    const page = renderPage({
      firstParty: [fact("a/one", { prerelease: true, engine: null })],
      community: [],
      unreleased: [],
    }) as string;
    expect(page).toContain("(marked as a pre-release)");
    expect(page).toContain("- Game builds: any (the manifest declares no range)");
  });

  it("prints a manifest's text as text, so a community description cannot add markup", () => {
    const page = renderPage({
      firstParty: [],
      community: [fact("c/x", { name: "<b>Bold</b>", description: "[click](http://x) | ## no" })],
      unreleased: [],
    }) as string;
    expect(page).not.toContain("<b>");
    expect(page).not.toContain("[click](http://x)");
    expect(escapeMarkdown("a_b*c")).toBe("a\\_b\\*c");
  });
});

describe("pickRelease", () => {
  const rel = (tag: string, at: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
    tag_name: tag,
    published_at: at,
    draft: false,
    prerelease: false,
    ...over,
  });

  it("takes the newest full release over a newer pre-release, and never a draft", () => {
    const picked = pickRelease([
      rel("v3.0.0", "2026-10-03T00:00:00Z", { draft: true }),
      rel("v2.1.0-edge.1", "2026-10-02T00:00:00Z", { prerelease: true }),
      rel("v2.0.0", "2026-10-01T00:00:00Z"),
      rel("v1.0.0", "2026-09-01T00:00:00Z"),
    ]) as { tag_name: string };
    expect(picked.tag_name).toBe("v2.0.0");
  });

  it("falls back to a pre-release only when there is no full release", () => {
    const picked = pickRelease([rel("v0.2.0", "2026-10-02T00:00:00Z", { prerelease: true })]) as {
      tag_name: string;
    };
    expect(picked.tag_name).toBe("v0.2.0");
    expect(pickRelease([rel("v1.0.0", "2026-10-02T00:00:00Z", { draft: true })])).toBeNull();
  });
});

describe("modFacts", () => {
  type Reply = { status: number; body?: unknown };
  const fakeFetch =
    (routes: Record<string, Reply>) =>
    (url: string): Promise<{ ok: boolean; status: number; json(): Promise<unknown>; text(): Promise<string> }> => {
      const r = routes[url] ?? { status: 404 };
      return Promise.resolve({
        ok: r.status >= 200 && r.status < 300,
        status: r.status,
        json: () => Promise.resolve(r.body),
        text: () => Promise.resolve(typeof r.body === "string" ? r.body : JSON.stringify(r.body)),
      });
    };
  const api = "https://api.github.com/repos/a/one/releases?per_page=50";
  const raw = (file: string): string => `https://raw.githubusercontent.com/a/one/refs/tags/v1.2.0/${file}`;

  it("reads the manifest at the release tag and links the docs there", async () => {
    const facts = (await modFacts("a/one", {
      fetch: fakeFetch({
        [api]: {
          status: 200,
          body: [
            {
              tag_name: "v1.2.0",
              published_at: "2026-09-30T12:00:00Z",
              draft: false,
              prerelease: false,
              html_url: "https://github.com/a/one/releases/tag/v1.2.0",
            },
          ],
        },
        [raw("manifest.json")]: {
          status: 200,
          body: { id: "one", name: "One", description: "Does one thing.", engine: ">=1.20.0" },
        },
        [raw("README.md")]: { status: 200, body: "readme" },
      }),
    })) as Record<string, unknown>;
    expect(facts).toMatchObject({
      repo: "a/one",
      id: "one",
      name: "One",
      tag: "v1.2.0",
      date: "2026-09-30",
      engine: ">=1.20.0",
      prerelease: false,
      docs: "https://github.com/a/one/blob/v1.2.0/README.md",
    });
  });

  it("reports a repository with no published release as missing", async () => {
    const facts = (await modFacts("a/one", {
      fetch: fakeFetch({ [api]: { status: 200, body: [] } }),
    })) as Record<string, unknown>;
    expect(facts).toEqual({ repo: "a/one", missing: "no published release" });
  });
});
