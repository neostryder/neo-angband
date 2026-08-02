/**
 * The electron-builder configuration, checked before a tag spends twenty
 * minutes finding out.
 *
 * THE DEFECT THIS EXISTS FOR. The first release workflow built Windows and
 * macOS and failed on Linux, with:
 *
 *   executableName contains characters that cannot be safely used in file
 *   paths: @rpgm-toolsneo-angband-desktop
 *
 * Left unset, `linux.executableName` is derived from the package `name`, and
 * ours is scoped. Windows and macOS name their output from `productName`, so
 * they were fine - which is exactly why nobody found it: two thirds of the
 * matrix went green and the draft release looked plausible until you counted
 * the files in it.
 *
 * A build config is only ever exercised by a build, and the build that
 * exercises it is the one at the end of a release. These are the properties
 * that can be checked in a second instead.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

interface BuildConfig {
  productName: string;
  win?: { target?: unknown[] };
  mac?: { target?: unknown[] };
  linux?: {
    target?: unknown[];
    executableName?: string;
    desktopName?: string;
    artifactName?: string;
  };
}

const manifest = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"),
    "utf8",
  ),
) as { name: string; version: string; build: BuildConfig };

const build = manifest.build;

/** electron-builder's own rule for a name it will put in a path. */
const SAFE_IN_A_PATH = /^[A-Za-z0-9 ._-]+$/u;

describe("the Linux build can name its own executable", () => {
  it("sets executableName rather than inheriting the scoped package name", () => {
    expect(
      build.linux?.executableName,
      `linux.executableName is unset, so electron-builder will derive it from ` +
        `"${manifest.name}" and refuse the result`,
    ).toBeTruthy();
  });

  it("uses only characters electron-builder will put in a path", () => {
    const name = build.linux?.executableName ?? "";
    expect(SAFE_IN_A_PATH.test(name), `"${name}" is not path-safe`).toBe(true);
    /* The specific failure: a scope survives as a bare @, and the slash is
     * dropped rather than replaced, which is how the two halves ran together. */
    expect(name).not.toContain("@");
    expect(name).not.toContain("/");
  });

  it("names the desktop entry, so a running window links to it", () => {
    expect(build.linux?.desktopName).toBeTruthy();
  });
});

describe("every platform still produces something", () => {
  it("builds for all three", () => {
    expect(build.win?.target, "no Windows targets").toBeTruthy();
    expect(build.mac?.target, "no macOS targets").toBeTruthy();
    expect(build.linux?.target, "no Linux targets").toBeTruthy();
  });

  it("has a productName that is itself path-safe", () => {
    /* Windows and macOS artifact names come from this one, so the same class
     * of failure lands there if it ever grows a colon or a slash. */
    expect(SAFE_IN_A_PATH.test(build.productName)).toBe(true);
  });
});
