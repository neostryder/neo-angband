import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_REGISTRY_URL,
  fetchRegistry,
  parseRegistry,
  type RegistryEnv,
} from "./mod-curated";

const URL_ = "https://example.test/registry.json";

const doc = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    schema: 1,
    name: "Somebody's picks",
    mods: [{ repo: "a/one" }, { repo: "b/two" }],
    ...over,
  });

describe("parseRegistry", () => {
  it("reads a list of repositories and nothing about the mods themselves", () => {
    const r = parseRegistry(doc(), URL_);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.registry.name).toBe("Somebody's picks");
    expect(r.registry.url).toBe(URL_);
    expect(r.registry.mods).toEqual([{ repo: "a/one" }, { repo: "b/two" }]);
    expect(r.registry.problems).toEqual([]);
  });

  it("keeps the curator's ORDER, which is the one thing a list contributes", () => {
    const r = parseRegistry(doc({ mods: [{ repo: "z/last" }, { repo: "a/first" }] }), URL_);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.registry.mods.map((m) => m.repo)).toEqual(["z/last", "a/first"]);
  });

  it("accepts a full GitHub URL, through the same parser a player types into", () => {
    /* A registry must not be able to express a reference a player could not have
     * typed - in particular it must not be able to smuggle in a branch. */
    const r = parseRegistry(
      doc({ mods: [{ repo: "https://github.com/a/one/tree/v1.2.3" }] }),
      URL_,
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.registry.mods).toEqual([{ repo: "a/one", tag: "v1.2.3" }]);
  });

  it("loses one bad ENTRY, not the whole list, and says which", () => {
    /* Twenty repositories should not be lost to a typo in the nineteenth. */
    const r = parseRegistry(
      doc({ mods: [{ repo: "a/one" }, { repo: "" }, "nonsense", { repo: "b/two" }] }),
      URL_,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.registry.mods.map((m) => m.repo)).toEqual(["a/one", "b/two"]);
    expect(r.registry.problems).toHaveLength(2);
    expect(r.registry.problems[0]).toContain("entry 2");
    expect(r.registry.problems[1]).toContain("entry 3");
  });

  it("reports a duplicate rather than quietly deduplicating it", () => {
    /* A list that names one repository twice is a list somebody edited without
     * looking, and the curator is the only person who can fix that. */
    const r = parseRegistry(doc({ mods: [{ repo: "a/one" }, { repo: "A/One" }] }), URL_);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.registry.mods).toHaveLength(1);
    expect(r.registry.problems[0]).toMatch(/listed more than once/u);
  });

  it("refuses a document that is not a registry at all", () => {
    for (const bad of ["", "[]", "null", "12", "not json"]) {
      expect(parseRegistry(bad, URL_).ok).toBe(false);
    }
  });

  it("refuses a document with no schema version", () => {
    const r = parseRegistry(JSON.stringify({ mods: [] }), URL_);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toMatch(/no schema version/u);
  });

  it("blames the GAME, not the file, for a schema from the future", () => {
    /* The file is presumably fine and this build is the old one. Telling the
     * player their list is broken would send them to the wrong person. */
    const r = parseRegistry(doc({ schema: 99 }), URL_);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.problem).toMatch(/newer kind of registry/u);
      expect(r.problem).toMatch(/Updating the game/u);
    }
  });

  it("falls back to the URL when the list does not name itself", () => {
    const r = parseRegistry(doc({ name: undefined }), URL_);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.registry.name).toBe(URL_);
  });

  it("accepts an empty list - a curator with nothing to recommend yet", () => {
    const r = parseRegistry(doc({ mods: [] }), URL_);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.registry.mods).toEqual([]);
  });
});

describe("fetchRegistry", () => {
  const envWith = (
    reply: { ok: boolean; status: number; body?: string } | Error,
  ): RegistryEnv => ({
    fetch: () =>
      reply instanceof Error
        ? Promise.reject(reply)
        : Promise.resolve({
            ok: reply.ok,
            status: reply.status,
            text: () => Promise.resolve(reply.body ?? ""),
          }),
  });

  it("parses a good reply", async () => {
    const r = await fetchRegistry(URL_, envWith({ ok: true, status: 200, body: doc() }));
    expect(r.ok).toBe(true);
  });

  it("says an unreachable list does not affect installed mods", async () => {
    /* A player offline, or behind a filter, needs to know the mods they already
     * have are fine - otherwise a failed list read reads as a broken install. */
    const r = await fetchRegistry(URL_, envWith(new Error("offline")));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toMatch(/already installed are unaffected/u);
  });

  it("distinguishes 'no registry there' from 'refused'", async () => {
    const four = await fetchRegistry(URL_, envWith({ ok: false, status: 404 }));
    expect(four.ok).toBe(false);
    if (!four.ok) expect(four.problem).toMatch(/no registry there/u);

    const five = await fetchRegistry(URL_, envWith({ ok: false, status: 503 }));
    expect(five.ok).toBe(false);
    if (!five.ok) expect(five.problem).toMatch(/refused \(HTTP 503\)/u);
  });

  it("never throws", async () => {
    await expect(
      fetchRegistry(URL_, envWith({ ok: true, status: 200, body: "{" })),
    ).resolves.toMatchObject({ ok: false });
  });
});

describe("the registry this repository ships", () => {
  const FILE = join(import.meta.dirname, "..", "..", "..", "mods", "registry.json");
  const body = (): string => readFileSync(FILE, "utf8");

  it("is a registry this build can read", () => {
    const r = parseRegistry(body(), "mods/registry.json");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.registry.problems).toEqual([]);
    expect(r.registry.mods.length).toBeGreaterThan(0);
  });

  it("is where DEFAULT_REGISTRY_URL points", () => {
    /* The one place the build knows about mods at all, so it has to be the file
     * that is actually committed - a default pointing at a path this repository
     * does not serve would fail only in production. */
    expect(DEFAULT_REGISTRY_URL).toContain("/neostryder/neo-angband/");
    expect(DEFAULT_REGISTRY_URL).toMatch(/\/mods\/registry\.json$/u);
  });

  it("says NOTHING about any mod except where to find it", () => {
    /* The whole point. If a name, a version, a description or a digest ever
     * appears in an entry here, the build has started knowing about mods again -
     * which is the thing this redesign exists to stop. */
    const parsed = JSON.parse(body()) as { mods: Array<Record<string, unknown>> };
    for (const entry of parsed.mods) {
      expect(Object.keys(entry)).toEqual(["repo"]);
    }
  });
});
