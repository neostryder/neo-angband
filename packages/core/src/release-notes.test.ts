/**
 * The release notes on a GitHub Release are cut from CHANGELOG.md by
 * tools/changelog-section.mjs, so that there is one account of a release rather
 * than two that drift. These tests own the two ways that can go wrong quietly:
 * the extractor picking up the wrong section, and the extractor finding nothing
 * at all - which would ship a Release page reading "See CHANGELOG.md."
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error -- plain .mjs tooling, no types; see tools/changelog-section.mjs
import { changelogSection, fitToLimit } from "../../../tools/changelog-section.mjs";
// @ts-expect-error -- plain .mjs tooling, no types; see tools/version.mjs
import { projectVersion } from "../../../tools/version.mjs";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const md = readFileSync(join(repoRoot, "CHANGELOG.md"), "utf8");
const section = (v: string): string | null =>
  changelogSection(md, v) as string | null;

describe("changelogSection", () => {
  it("stops at the next heading", () => {
    const sample = [
      "# Changelog",
      "",
      "## [0.2.0]",
      "",
      "- second",
      "",
      "## [0.1.0]",
      "",
      "- first",
    ].join("\n");
    expect(changelogSection(sample, "0.2.0")).toBe("- second");
    expect(changelogSection(sample, "0.1.0")).toBe("- first");
  });

  it("accepts a heading with or without brackets", () => {
    expect(changelogSection("## 1.2.3\n\n- x", "1.2.3")).toBe("- x");
    expect(changelogSection("## [1.2.3] - 2026-01-01\n\n- x", "1.2.3")).toBe("- x");
  });

  it("does not match a longer version that starts the same way", () => {
    const sample = "## [0.1.0]\n\n- wrong\n\n## [0.1]\n\n- right";
    expect(changelogSection(sample, "0.1")).toBe("- right");
  });

  it("returns null rather than guessing when the version is absent", () => {
    expect(changelogSection("## [0.1.0]\n\n- x", "9.9.9")).toBeNull();
  });
});

describe("this repository's CHANGELOG can actually be cut", () => {
  /* The fallback exists so a release never dies at the last step, but relying
   * on it means shipping a Release page with no notes. One of the two headings
   * must be there. */
  it("has a section for the current version, or an Unreleased one", () => {
    const found = section(projectVersion() as string) ?? section("Unreleased");
    expect(found, "add a heading for this version to CHANGELOG.md").not.toBeNull();
    expect((found ?? "").length).toBeGreaterThan(200);
  });

  /* The check that was missing. 0.19.0's section reached 126,288 characters
   * against the API's 125,000, and nothing said so until the release job had
   * already built three desktop apps and a site zip and was on its last step.
   * The workflow computes the exact budget by measuring its own preamble; this
   * can only bound it, so it allows 4,000 characters for that preamble - which
   * measured 1,616 in the shipped v0.18.0 notes. Loose, and it would still have
   * failed here. */
  it("fits a release body, with room for the preamble the workflow adds", () => {
    const found = (section(projectVersion() as string) ?? section("Unreleased") ?? "") as string;
    expect(
      found.length,
      "CHANGELOG section is too long for a GitHub release body; " +
        "give this version its own `## [x.y.z]` heading instead of letting " +
        "everything accumulate under Unreleased",
    ).toBeLessThanOrEqual(125_000 - 4_000);
  });
});

describe("fitToLimit", () => {
  const long = Array.from({ length: 40 }, (_, i) => `- entry ${i} ${"x".repeat(100)}`).join("\n\n");

  it("leaves a body that already fits completely alone", () => {
    expect(fitToLimit("- one\n\n- two", 125_000, "0.19.0")).toBe("- one\n\n- two");
  });

  it("returns the whole body when no limit is given", () => {
    expect(fitToLimit(long, Number.NaN, "0.19.0")).toBe(long);
  });

  it("cuts to under the limit and says that it cut", () => {
    const fitted = fitToLimit(long, 1_000, "0.19.0") as string;
    expect(fitted.length).toBeLessThanOrEqual(1_000);
    expect(fitted).toContain("cut short");
    expect(fitted).toContain("blob/v0.19.0/CHANGELOG.md");
  });

  it("cuts on an entry boundary rather than mid-sentence", () => {
    const fitted = fitToLimit(long, 1_000, "0.19.0") as string;
    const kept = fitted.slice(0, fitted.indexOf("\n\n---\n\n"));
    /* Every line that survived is a whole entry: no half-written last one. */
    for (const line of kept.split("\n").filter(Boolean)) {
      expect(line).toMatch(/^- entry \d+ x{100}$/u);
    }
  });

  it("still returns something when one block alone is over budget", () => {
    const oneBlock = `- ${"y".repeat(5_000)}`;
    const fitted = fitToLimit(oneBlock, 900, "0.19.0") as string;
    expect(fitted.length).toBeLessThanOrEqual(900);
    expect(fitted).toContain("cut short");
  });
});
