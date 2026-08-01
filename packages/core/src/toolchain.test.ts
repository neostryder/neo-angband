/**
 * The toolchain versions are written down in more than one file. This is the
 * thing that makes them agree.
 *
 * `packageManager` in the root package.json is the only one with teeth - corepack
 * and pnpm/action-setup both read it - so everything else is a COPY, and a copy
 * is what drifts. Three separate constants once claimed to hold the engine
 * version and two of them were a whole release line behind, each with a comment
 * saying it was kept in sync. A comment asserting two things are kept in sync is
 * a confession that nothing enforces it; these are the assertions instead.
 *
 * Pinning the RELATIONSHIP, never the literal: a test that hardcodes "11.18.0"
 * has to be edited on every bump, which is exactly when someone edits it to
 * whatever makes the run green.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const repoRoot = new URL("../../../", import.meta.url);
const read = (p: string): string => readFileSync(fileURLToPath(new URL(p, repoRoot)), "utf8");

const rootManifest = JSON.parse(read("package.json")) as { packageManager: string };
const [pm, pmVersion] = rootManifest.packageManager.split("@");

const WORKFLOWS = ["ci.yml", "pages.yml", "mod-canary.yml", "publish-npm.yml"] as const;

describe("the pnpm version", () => {
  it("is pinned in packageManager, exactly, with no range", () => {
    expect(pm).toBe("pnpm");
    /* A range here would defeat the point: corepack would resolve it differently
     * on different days, and the lockfile is written by whichever it picked. */
    expect(pmVersion).toMatch(/^\d+\.\d+\.\d+$/u);
  });

  it("is the version CONTRIBUTING.md tells a new contributor to install", () => {
    const contributing = read("CONTRIBUTING.md");
    expect(
      contributing,
      `CONTRIBUTING.md must name pnpm ${pmVersion}, the packageManager version`,
    ).toContain(`\`${pmVersion}\``);
  });
});

describe("the Node version", () => {
  const nvmrc = read(".nvmrc").trim();

  it("is a bare major, so .nvmrc tracks the line and not a patch", () => {
    expect(nvmrc).toMatch(/^\d+$/u);
  });

  it.each(WORKFLOWS)("is the same one %s asks setup-node for", (workflow) => {
    const yaml = read(`.github/workflows/${workflow}`);
    const asked = [...yaml.matchAll(/^\s*node-version:\s*(\S+)\s*$/gmu)].map((m) => m[1]);
    /* Zero matches would pass a `.every()` silently - the classic empty-set
     * green - so the count is asserted first. */
    expect(asked.length, `${workflow} declares no node-version`).toBeGreaterThan(0);
    for (const v of asked) expect(v, `${workflow} asks for Node ${v}, .nvmrc says ${nvmrc}`).toBe(nvmrc);
  });
});

describe("the GitHub Actions", () => {
  it.each(WORKFLOWS)("%s pins every action to a major tag, never a floating branch", (workflow) => {
    const yaml = read(`.github/workflows/${workflow}`);
    const uses = [...yaml.matchAll(/^\s*-?\s*uses:\s*(\S+)\s*$/gmu)].map((m) => m[1] as string);
    expect(uses.length, `${workflow} uses no actions`).toBeGreaterThan(0);
    for (const ref of uses) {
      /* Local composite actions (./.github/actions/...) carry no ref at all. */
      if (ref.startsWith("./")) continue;
      expect(ref, `${workflow}: ${ref} is not pinned to a tag`).toMatch(/@(v\d+(\.\d+)*|[0-9a-f]{40})$/u);
    }
  });
});
