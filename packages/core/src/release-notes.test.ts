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
import { changelogSection } from "../../../tools/changelog-section.mjs";
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
});
