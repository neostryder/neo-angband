/**
 * make_fake_artifact (obj-make.c L728) must have exactly ONE implementation.
 *
 * It used to have three: obj/artifact-fake.ts (a real GameObject),
 * game/spoil.ts (a local second copy), and obj/randart-data.ts
 * (makeFakeArtifactPower, the same field mapping flattened into the reduced
 * PowerObject that object_power reads). They were written by hand from the same
 * C function at different times, and two hand-written copies of one C function
 * agree until they do not. The failure mode was silent and expensive:
 * artifact_power drives the whole randart design loop, so a single field mapped
 * differently changes every generated artifact while every test that compares
 * the port against ITSELF still passes.
 *
 * That was not hypothetical. The flattened copy skipped copy_curses' timeout
 * roll -- harmless for object_power, which never reads a timeout, and a live
 * RNG divergence during generation, where design_artifact re-powers artifacts
 * make_bad has just cursed. Skipping object_prep is what made skipping the roll
 * look reasonable.
 *
 * All three are now one builder, so the old cross-check (run both, require the
 * same power) has nothing left to compare. What replaces it is the property
 * that made the cross-check unnecessary: this file fails if a second
 * implementation appears.
 *
 * WHAT IDENTIFIES IT is the MAXIMISE aspect, not object_prep alone. Three other
 * modules pair object_prep with copy_artifact_data and are NOT copies of this
 * function -- make_artifact (obj-make.c L797, the real artifact drop),
 * wiz_create_artifact and obj/make.ts itself -- and every one of them preps
 * with RANDOMISE, because they build objects that go into the game. MAXIMISE is
 * what make_fake_artifact does and what nothing else does, so that is the
 * predicate. A census that just looked for the two calls together would name
 * those three and have to carry an allowlist, which is a census that stops
 * meaning anything the first time the allowlist is edited.
 *
 * Attribution: neostryder / RPGM Tools.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { describe, expect, it } from "vitest";

const SRC = new URL("../", import.meta.url);

/** The one place allowed to do object_prep + copy_artifact_data. */
const BUILDER = "obj/artifact-fake.ts";

function sourceFiles(dir: URL, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const child = new URL(`${entry}${entry.includes(".") ? "" : "/"}`, dir);
    if (statSync(child).isDirectory()) {
      out.push(...sourceFiles(child, `${prefix}${entry}/`));
    } else if (entry.endsWith(".ts") && !entry.includes(".test.")) {
      out.push(`${prefix}${entry}`);
    }
  }
  return out;
}

/**
 * object_prep on the MAXIMISE aspect, followed by copy_artifact_data. That pair
 * is make_fake_artifact and nothing else - see the module note for the three
 * modules that pair the two calls on RANDOMISE and are a different C function.
 */
function isFakeArtifactBuilder(text: string): boolean {
  return (
    /\bobjectPrep\s*\([^)]*"maximise"/s.test(text) &&
    /\bcopyArtifactData\s*\(/.test(text)
  );
}

describe("make_fake_artifact has one implementation (obj-make.c L728)", () => {
  const files = sourceFiles(SRC);

  it("the sweep sees the source tree", () => {
    /* Without this, a broken walk makes every assertion below vacuous. */
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain(BUILDER);
  });

  it("the predicate can fire at all", () => {
    /* The builder itself must match, or the sweep below is a test that cannot
     * fail: a typo in either pattern would report a clean tree forever. */
    const text = readFileSync(new URL(BUILDER, SRC), "utf8");
    expect(isFakeArtifactBuilder(text)).toBe(true);
  });

  it("no other module builds a fake artifact", () => {
    const copies: string[] = [];
    for (const file of files) {
      if (file === BUILDER) continue;
      if (isFakeArtifactBuilder(readFileSync(new URL(file, SRC), "utf8"))) {
        copies.push(file);
      }
    }
    expect(copies).toEqual([]);
  });
});
