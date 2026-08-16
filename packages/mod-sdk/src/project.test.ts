/**
 * The project builder, exercised through real composition.
 *
 * A builder that assembled JSON and checked its own assembly would prove
 * nothing about what the game sees. Every test here goes through
 * `composeContentPacks` - the same function the web host calls - so what is
 * checked is the composed result, patches applied.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { draftRecord } from "./authoring.js";
import type { JsonRecord } from "./compose.js";
import type { LoadedPack } from "./loader.js";
import { ManifestError } from "./manifest.js";
import { modProject } from "./project.js";

const packDir = new URL("../../content/pack/", import.meta.url);

function packRecords(stem: string): JsonRecord[] {
  const raw: unknown = JSON.parse(readFileSync(new URL(`${stem}.json`, packDir), "utf8"));
  const records = Array.isArray(raw) ? raw : (raw as { records?: unknown[] }).records;
  if (!Array.isArray(records)) return [];
  return records.filter(
    (r): r is JsonRecord => r !== null && typeof r === "object" && !Array.isArray(r),
  );
}

const CORE_FILES = [
  "object",
  "object_base",
  "monster",
  "monster_base",
  "blow_methods",
  "blow_effects",
  "slay",
  "brand",
  "flavor",
  "pain",
  /* A config singleton, so the whole-file-replacement promotion still has a
   * file it can fire on now that object / ego_item / vault merge per record. */
  "constants",
] as const;

const coreRecords: Record<string, JsonRecord[]> = {};
for (const f of CORE_FILES) coreRecords[f] = packRecords(f);

function corePack(): LoadedPack {
  const files: Record<string, { records: JsonRecord[] }> = {};
  for (const f of CORE_FILES) files[f] = { records: packRecords(f) };
  return {
    manifest: { id: "core", name: "Neo Angband", version: "1.0.0", shape: "content" },
    files,
  } as unknown as LoadedPack;
}

const MANIFEST = {
  id: "sludge",
  name: "Sludge",
  version: "1.0.0",
  shape: "content",
  author: "an author",
  repository: "https://example.test/sludge",
  engine: ">=0.19.0",
  dependencies: { core: "*" },
};

describe("a mod project", () => {
  it("refuses a manifest that could not work, at construction", () => {
    expect(() => modProject({ ...MANIFEST, id: "" })).toThrow(ManifestError);
  });

  it("emits a mod folder: manifest.json plus one file per record file", () => {
    const files = modProject(MANIFEST)
      .add("monster", { name: "sludge fiend", base: "icky thing" })
      .emit();
    expect(files.map((f) => f.path)).toEqual(["manifest.json", "monster.json"]);
    const monster = JSON.parse(files[1]?.contents ?? "{}") as { records: JsonRecord[] };
    expect(monster.records[0]?.["name"]).toBe("sludge fiend");
  });

  it("carries every declared field into the emitted manifest", () => {
    const p = modProject(MANIFEST).declareField({
      name: "sludge",
      files: ["object"],
      type: "object",
    });
    expect(p.qualify("sludge")).toBe("sludge:sludge");
    const manifest = JSON.parse(p.emit()[0]?.contents ?? "{}") as {
      fields?: { name: string }[];
    };
    expect(manifest.fields?.map((f) => f.name)).toEqual(["sludge"]);
  });

  it("keeps the first of a field declared twice", () => {
    const p = modProject(MANIFEST)
      .declareField({ name: "sludge", files: ["object"], label: "first" })
      .declareField({ name: "sludge", files: ["monster"], label: "second" });
    expect(p.manifest().fields?.[0]?.label).toBe("first");
  });
});

describe("building against the base game", () => {
  it("adds a monster, and has nothing to complain about beyond its lore", () => {
    const drafted = draftRecord(
      "monster",
      { name: "sludge fiend", base: "icky thing", depth: 25 },
      coreRecords,
    );
    const build = modProject(MANIFEST).add("monster", drafted.record).build(corePack());
    expect(build.problems).toEqual([]);
    expect(build.ok).toBe(true);
    expect(build.findings.map((f) => f.rule)).toEqual(["monster/no-desc"]);
  });

  it("names a reference into core that does not resolve", () => {
    const build = modProject(MANIFEST)
      .add("monster", { name: "sludge fiend", base: "oooze", depth: 25 })
      .build(corePack());
    const dangling = build.findings.find((f) => f.rule === "reference/dangling");
    expect(dangling?.message).toContain('"oooze"');
  });

  it("resolves a reference the mod satisfies itself", () => {
    const build = modProject(MANIFEST)
      .add("monster_base", { name: "sludge", glyph: "j", pain: 1 })
      .add("monster", { name: "sludge fiend", base: "sludge", depth: 25 })
      .build(corePack());
    expect(build.findings.map((f) => f.rule)).not.toContain("reference/dangling");
  });

  it("checks the record a PATCH produced, not the one that was written", () => {
    /* The whole reason build() composes: a patch that breaks a reference is
     * invisible in the mod's own files, because the mod's files do not contain
     * the record it broke. */
    const build = modProject(MANIFEST)
      .patchFields("monster", "core:grip-farmer-maggot-s-dog", [
        { op: "set", path: "base", value: "oooze" },
      ])
      .build(corePack());
    expect(build.problems).toEqual([]);
    const dangling = build.findings.find((f) => f.rule === "reference/dangling");
    expect(dangling?.message).toContain('"oooze"');
  });

  it("reports a declared dependency that was not supplied, instead of throwing", () => {
    /* resolveLoadOrder throws here, and "build my half-finished mod" is the
     * commonest thing anyone does. A stack trace is not an answer. */
    const build = modProject(MANIFEST)
      .add("monster", { name: "sludge fiend", base: "icky thing", depth: 25 })
      .build();
    expect(build.ok).toBe(false);
    expect(build.findings[0]?.rule).toBe("project/unloadable");
    expect(build.findings[0]?.message).toContain("requires missing pack core");
  });

  it("says so when it was built with no base game to resolve against", () => {
    const solo = { ...MANIFEST, id: "solo", dependencies: undefined };
    const build = modProject({ ...solo, dependencies: {} })
      .add("monster", { name: "sludge fiend", base: "icky thing", depth: 25 })
      .build();
    expect(build.findings[0]?.rule).toBe("project/no-core");
  });
});

describe("adding to object, the file that used to be unaddable", () => {
  it("adds one object to the base game's 375, and keeps all 375", () => {
    /* MEASURED, AND IT USED TO BE AN ERROR. Until 2026-08-08 composition keyed
     * records by slugify(name); `object` ships names that collide under it
     * ("Acquirement" / "*Acquirement*"), so the whole file was classified
     * whole-file and this exact call replaced all 375 of core's objects.
     * ModProject promoted that to an `error` because a builder whose `ok` is
     * true for deleting the base game is lying. Composition now keys by
     * recordRefKeys and the record simply lands. */
    const drafted = draftRecord(
      "object",
      { name: "& Sludge Dagger~", type: "sword", level: 20 },
      coreRecords,
    );
    const build = modProject(MANIFEST).add("object", drafted.record).build(corePack());
    expect(build.problems).toEqual([]);
    expect(build.findings.map((f) => f.rule)).not.toContain("file/whole-file-replacement");
    expect(build.ok).toBe(true);

    const objects = build.composed?.["object"] as { name: string }[];
    expect(objects).toHaveLength(packRecords("object").length + 1);
    expect(objects.at(-1)?.name).toBe("& Sludge Dagger~");
  });

  it("does not fire when the mod only PATCHES that file", () => {
    const build = modProject(MANIFEST)
      .patchFields("object", "core:sword--main-gauche", [
        { op: "set", path: "cost", value: 999 },
      ])
      .build(corePack());
    expect(build.problems).toEqual([]);
    expect(build.findings.map((f) => f.rule)).not.toContain("file/whole-file-replacement");
    expect(build.ok).toBe(true);
  });

  it("still calls a whole-file replacement an error where one is still possible", () => {
    /* `constants` is a config SINGLETON: its identity is the file and the host
     * binds one, so shipping it means "use mine" and the previous provider's
     * record goes. That is a real thing a mod can do by accident, so the
     * promotion this describe used to test for `object` is still live - it just
     * no longer fires for the three files people actually want to add to. */
    const build = modProject(MANIFEST)
      .add("constants", { "level-max": [{ label: "monsters", value: 4096 }] })
      .build(corePack());
    const fatal = build.findings.find((f) => f.rule === "file/whole-file-replacement");
    expect(fatal?.level).toBe("error");
    expect(fatal?.message).toContain("discarding 1 record(s)");
    expect(build.ok).toBe(false);
  });
});
