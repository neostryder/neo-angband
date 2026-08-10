/**
 * MOD_REACH gap 12: record schemas are checked AT LOAD, not only in the builder.
 *
 * The row said the SDK's header claimed schema validation and "no such code
 * exists". Half of that was wrong, and the wrong half is the interesting one:
 * `checkRecords` over `RECORD_BLUEPRINTS` was fully built and thoroughly tested,
 * and its only caller was `ModProject.build` - the tool a mod AUTHOR runs. A mod
 * installed from a zip, hand-edited in the mods folder, or built by any other
 * tool had never been near it. The mechanism was present; the reach was not.
 *
 * So the tests here are about REACH, and every one of them goes through
 * `composeContentPacks` - the same function the web and desktop hosts call -
 * rather than calling the checker directly. Composition against the REAL content
 * pack, because the blueprint is measured from that pack and a synthetic core
 * would be a fixture agreeing with itself.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import type { JsonRecord } from "./compose.js";
import { composeContentPacks } from "./loader.js";
import type { LoadedPack } from "./loader.js";
import { modProject } from "./project.js";
import { checkPacks, composedObjects } from "./validate.js";

const packDir = new URL("../../content/pack/", import.meta.url);

function packRecords(stem: string): JsonRecord[] {
  const raw: unknown = JSON.parse(readFileSync(new URL(`${stem}.json`, packDir), "utf8"));
  const records = Array.isArray(raw) ? raw : (raw as { records?: unknown[] }).records;
  if (!Array.isArray(records)) return [];
  return records.filter(
    (r): r is JsonRecord => r !== null && typeof r === "object" && !Array.isArray(r),
  );
}

/* Enough of core for a monster to resolve its base, its blows and its drops.
 * `artifact` is deliberately absent: it is where core's own data raises most of
 * its self-warnings, and including it would let "the base game is quiet" pass
 * for the wrong reason. */
const CORE_FILES = [
  "monster",
  "monster_base",
  "blow_methods",
  "blow_effects",
  "object",
  "object_base",
  "pain",
] as const;

function corePack(): LoadedPack {
  const files: Record<string, { records: JsonRecord[] }> = {};
  for (const f of CORE_FILES) files[f] = { records: packRecords(f) };
  return {
    manifest: { id: "core", name: "Neo Angband", version: "1.0.0", shape: "content" },
    files,
  } as unknown as LoadedPack;
}

/** A monster that composes cleanly: a real core record under a new name. */
function goodMonster(): JsonRecord {
  const template = packRecords("monster").find((r) => r["name"] === "scrawny cat");
  if (template === undefined) throw new Error("core monster.json has no scrawny cat");
  return { ...template, name: "sludge fiend" };
}

function mod(files: Record<string, unknown>, id = "sludge"): LoadedPack {
  return {
    manifest: { id, name: id, version: "1.0.0", shape: "content" },
    files,
  } as unknown as LoadedPack;
}

/** Findings from composing core plus these packs, as the host would. */
function findingsFor(...packs: LoadedPack[]) {
  return composeContentPacks([corePack(), ...packs]).findings;
}

describe("the base game is not reported on", () => {
  it("composing core alone raises nothing", () => {
    /* THE ANTI-WOLF-CRYING CONTROL. A player with no mods installed must see an
     * empty list, and this is not free: core's own data does raise warnings
     * against core's own blueprint - see the test below, which measures them. If
     * the base-game exclusion ever broke, every boot would open the mod manager
     * on a wall of complaints about the game itself. */
    expect(composeContentPacks([corePack()]).findings).toEqual([]);
  });

  it("and it is EXCLUDED, not merely quiet", () => {
    /* The other half, and without it the test above is a check that cannot fail.
     * Run the same checker over the same records with no `baseId` and core has
     * plenty to say about itself - upstream warts the port keeps on purpose. So
     * the empty list above is the exclusion working, not the checker sleeping. */
    const composed = composeContentPacks([corePack()]);
    const unfiltered = checkPacks([corePack()], composedObjects(composed.records), {
      minLevel: "warn",
    });
    expect(unfiltered.length).toBeGreaterThan(0);
    expect(unfiltered.every((f) => f.packId === "core")).toBe(true);
  });
});

describe("a mod's records are checked, and the finding names the mod", () => {
  it("a field written as the wrong type is reported", () => {
    const broken = { ...goodMonster(), "hit-points": "lots" };
    const findings = findingsFor(mod({ monster: { records: [broken] } }));

    const typed = findings.filter((f) => f.rule === "field/type");
    expect(typed.map((f) => ({ pack: f.packId, file: f.file, field: f.field }))).toEqual([
      { pack: "sludge", file: "monster", field: "hit-points" },
    ]);
    /* The message has to be readable on a mod's row without a legend. */
    expect(typed[0]?.message).toContain("sludge fiend");
    expect(typed[0]?.message).toContain("core always writes it as number");
  });

  it("a well-formed mod raises nothing (the control)", () => {
    /* Without this, every assertion in this file would pass against a checker
     * that flagged anything a mod touched. */
    expect(findingsFor(mod({ monster: { records: [goodMonster()] } }))).toEqual([]);
  });

  it("two mods are reported separately, each on its own id", () => {
    const findings = findingsFor(
      mod({ monster: { records: [{ ...goodMonster(), "hit-points": "lots" }] } }, "one"),
      mod({ monster: { records: [{ ...goodMonster(), name: "bog wraith", speed: "fast" }] } }, "two"),
    );
    expect(
      findings.map((f) => `${f.packId}/${f.field ?? ""}`).sort(),
    ).toEqual(["one/hit-points", "two/speed"]);
  });
});

describe("a PATCH is checked as the record it produced", () => {
  /* The case the shared subject selection exists for, and the one a naive
   * implementation gets wrong in a way that makes the whole check useless. A
   * patch body is `{"speed": "fast"}` - no `name`, no `depth`, none of the
   * fields every core monster has - so checking the patch AS WRITTEN would put
   * a required-field error on every legitimate patch in existence. What has to
   * be checked is the record the patch left behind. */
  /* `dependencies` is not decoration. A pack may only patch its own records or a
   * DECLARED dependency's, and without this the composer refuses the patch - at
   * which point both tests below pass against a mod that contributed nothing.
   * That is why each asserts `problems` is empty first: a refused patch and a
   * clean one produce the same empty findings list, and only the refusal channel
   * can tell them apart. */
  const patched = (body: JsonRecord): LoadedPack =>
    ({
      manifest: {
        id: "sludge",
        name: "sludge",
        version: "1.0.0",
        shape: "content",
        dependencies: { core: "1.0.0" },
      },
      files: { monster: { patches: { "core:scrawny-cat": body } } },
    }) as unknown as LoadedPack;

  it("reports what the patch broke", () => {
    const composed = composeContentPacks([corePack(), patched({ speed: "fast" })]);
    expect(composed.problems).toEqual([]);
    expect(
      composed.findings.map((f) => ({ rule: f.rule, field: f.field, pack: f.packId })),
    ).toEqual([{ rule: "field/type", field: "speed", pack: "sludge" }]);
  });

  it("and says nothing about the fields the patch does not mention", () => {
    /* A patch that changes one number is not a record with one field. If the
     * subject were the patch body, this would raise a required-field error for
     * every field core's monsters carry - dozens of them, on a mod that did
     * nothing wrong. */
    const composed = composeContentPacks([corePack(), patched({ speed: 120 })]);
    expect({ problems: composed.problems, findings: composed.findings }).toEqual({
      problems: [],
      findings: [],
    });
  });
});

describe("what the load-time check does NOT say", () => {
  it("hints are for the builder, not for the player's mod manager", () => {
    /* The floor is a real decision and this measures it. A record missing an
     * optional field core usually writes is drafting advice; putting dozens of
     * those on a working mod's row would bury the one line that matters. */
    const sparse: JsonRecord = { name: "sludge fiend", base: "insect", depth: 1, rarity: 1 };
    const loaded = findingsFor(mod({ monster: { records: [sparse] } }));
    expect(loaded.some((f) => f.level === "hint")).toBe(false);

    const composed = composeContentPacks([corePack(), mod({ monster: { records: [sparse] } })]);
    const everything = checkPacks(
      [mod({ monster: { records: [sparse] } })],
      composedObjects(composed.records),
    );
    /* The same records, no floor: the hints are there, and were filtered rather
     * than never generated. */
    expect(everything.some((f) => f.level === "hint")).toBe(true);
  });

  it("a mod is never dropped or altered for a finding", () => {
    /* REPORT, NEVER REFUSE. The blueprint is a measurement of core's data, and a
     * mod coining a new value is doing something legal - so a finding costs
     * nothing. The record is in the game exactly as written. */
    const broken = { ...goodMonster(), "hit-points": "lots" };
    const composed = composeContentPacks([corePack(), mod({ monster: { records: [broken] } })]);
    expect(composed.findings.length).toBeGreaterThan(0);
    expect(composed.problems).toEqual([]);
    const landed = (composed.records["monster"] ?? []).find(
      (r) => (r as JsonRecord)["name"] === "sludge fiend",
    );
    expect((landed as JsonRecord)["hit-points"]).toBe("lots");
  });
});

describe("a section the player switched off is not reported on", () => {
  const sectioned = (): LoadedPack =>
    ({
      manifest: {
        id: "sludge",
        name: "sludge",
        version: "1.0.0",
        shape: "content",
        sections: [{ id: "extra", name: "Extra monsters", priority: "normal" }],
      },
      files: {
        monster: {
          sections: {
            extra: { records: [{ ...goodMonster(), "hit-points": "lots" }] },
          },
        },
      },
    }) as unknown as LoadedPack;

  it("says nothing when the part is off", () => {
    /* A disabled part's contributions do not exist - the same rule a disabled
     * mod's hooks follow. Warning about a record the player deliberately turned
     * off would be the worst kind of noise: unactionable and self-inflicted. */
    const composed = composeContentPacks([corePack(), sectioned()], {
      sections: { sludge: { extra: false } },
    });
    expect(composed.findings).toEqual([]);
  });

  it("and reports it when the part is on (the control)", () => {
    /* Without this, the row above would pass against a checker that cannot see
     * a sectioned contribution at all. */
    const composed = composeContentPacks([corePack(), sectioned()], {
      sections: { sludge: { extra: true } },
    });
    expect(composed.findings.map((f) => f.field)).toEqual(["hit-points"]);
  });
});

describe("the builder and the loader cannot disagree", () => {
  it("every warning a mod's BUILD reports, its LOAD reports too", () => {
    /* THE POINT OF SHARING THE SUBJECT SELECTION. Before this, the builder chose
     * which records a mod was answerable for and the loader chose nothing at
     * all, so there was no way for the two to disagree and no way for them to
     * agree either. Now they call one function, and this is what says so. */
    const broken = { ...goodMonster(), "hit-points": "lots" };
    const project = modProject({
      id: "sludge",
      name: "Sludge",
      version: "1.0.0",
      shape: "content",
      description: "a test mod",
    }).add("monster", broken);

    const built = project
      .build(corePack())
      .findings.filter((f) => f.level !== "hint")
      .map((f) => `${f.rule}/${f.field ?? ""}`);
    const loaded = findingsFor(mod({ monster: { records: [broken] } })).map(
      (f) => `${f.rule}/${f.field ?? ""}`,
    );

    expect(built.length).toBeGreaterThan(0);
    expect(loaded.sort()).toEqual(built.sort());
  });
});
