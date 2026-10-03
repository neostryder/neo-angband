/**
 * Released builds of the game fetch mods/registry.json from master, so every
 * change to that file is read by parsers that can no longer be changed. These
 * tests run the parser those builds shipped (a frozen copy in
 * test-fixtures/released-registry-parser) over the committed file and over the
 * shapes this build writes into it.
 *
 * The property relied on: the released parser reads "schema", "name" and "mods"
 * and ignores every other top-level key. That is why community mods live in a
 * "community" key and not behind a schema bump, which the released parser
 * refuses.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseRegistry } from "./mod-curated";

/* Imported by URL at run time, so the frozen copy stays outside this package's
 * compiled sources (tsconfig's rootDir is src). It has the same signature as
 * today's parser, which is what the type below says. */
const FROZEN = new URL(
  "../test-fixtures/released-registry-parser/mod-curated.ts",
  import.meta.url,
).href;
const { parseRegistry: releasedParse } = (await import(
  /* @vite-ignore */ FROZEN
)) as typeof import("./mod-curated");

const FILE = join(import.meta.dirname, "..", "..", "..", "mods", "registry.json");
const committed = (): string => readFileSync(FILE, "utf8");
const repos = (list: ReadonlyArray<{ repo: string }>): string[] => list.map((r) => r.repo);

describe("the frozen parser", () => {
  it("imports nothing from today's sources, so a later change cannot move it", () => {
    const dir = join(import.meta.dirname, "..", "test-fixtures", "released-registry-parser");
    let imports = 0;
    for (const file of readdirSync(dir)) {
      const from = [...readFileSync(join(dir, file), "utf8").matchAll(/^import .* from "([^"]+)";$/gmu)].map(
        (m) => m[1],
      );
      for (const path of from) expect(path, `${file} imports ${String(path)}`).toMatch(/^\.\/[^/]+$/u);
      imports += from.length;
    }
    expect(imports).toBeGreaterThan(0);
  });
});

describe("the committed registry, read by a released build", () => {
  it("reads cleanly, with the same first-party list this build reads", () => {
    const old = releasedParse(committed(), "mods/registry.json");
    const now = parseRegistry(committed(), "mods/registry.json");
    expect(old.ok).toBe(true);
    expect(now.ok).toBe(true);
    if (!old.ok || !now.ok) return;
    expect(old.registry.problems).toEqual([]);
    expect(old.registry.mods.length).toBeGreaterThan(0);
    expect(repos(old.registry.mods)).toEqual(repos(now.registry.mods));
  });
});

describe("a community list, read by a released build", () => {
  const withCommunity = JSON.stringify({
    schema: 1,
    name: "Neo Angband recommended mods",
    mods: [{ repo: "neostryder/neo-angband-mod-qol" }],
    community: [{ repo: "someone/neo-angband-mod-example" }, "not even an object"],
  });

  it("is ignored: the first-party list is read as before, with no problem reported", () => {
    /* Even a malformed community entry costs a released build nothing, because
     * it never looks at the key. */
    const old = releasedParse(withCommunity, "mods/registry.json");
    expect(old.ok).toBe(true);
    if (!old.ok) return;
    expect(repos(old.registry.mods)).toEqual(["neostryder/neo-angband-mod-qol"]);
    expect(old.registry.problems).toEqual([]);
  });

  it("is read by this build", () => {
    const now = parseRegistry(withCommunity, "mods/registry.json");
    expect(now.ok).toBe(true);
    if (!now.ok) return;
    expect(repos(now.registry.mods)).toEqual(["neostryder/neo-angband-mod-qol"]);
    expect(repos(now.registry.community)).toEqual(["someone/neo-angband-mod-example"]);
    expect(now.registry.problems).toHaveLength(1);
  });

  it("could not have been a schema bump, which a released build refuses outright", () => {
    const bumped = releasedParse(
      JSON.stringify({ schema: 2, mods: [{ repo: "neostryder/neo-angband-mod-qol" }] }),
      "mods/registry.json",
    );
    expect(bumped.ok).toBe(false);
  });
});
