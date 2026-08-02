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
import { createRequire } from "node:module";

interface BuildConfig {
  productName: string;
  win?: { target?: unknown[] };
  mac?: { target?: unknown[] };
  linux?: {
    target?: unknown[];
    executableName?: string;
    syncDesktopName?: boolean;
    artifactName?: string;
  };
}

const manifest = JSON.parse(
  readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "package.json"),
    "utf8",
  ),
) as { name: string; version: string; homepage?: string; author?: string; desktopName?: string; build: BuildConfig };

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

});

describe("the config is one electron-builder will accept", () => {
  /*
   * THE SECOND FAILURE, and the more instructive one. The fix above shipped
   * with `desktopName` and `synchronizeDesktopName` under `linux`. Neither
   * exists - the option is `syncDesktopName` - and `LinuxConfiguration` sets
   * `additionalProperties: false`, so electron-builder refused the whole
   * object. It validates the ENTIRE config on every platform, so a bad key
   * under `linux` failed the Windows and macOS jobs too: attempt one built two
   * platforms of three, attempt two built none.
   *
   * The test that was supposed to catch it asserted `linux.desktopName` was
   * truthy. It passed, because the config and the test were written by the same
   * hand in the same minute with the same wrong key - a test agreeing with its
   * author rather than with the tool. So the check is now against
   * electron-builder's OWN scheme.json, which ships in the package it is
   * checking and moves when the builder moves.
   */
  const scheme = JSON.parse(
    readFileSync(
      createRequire(import.meta.url).resolve("app-builder-lib/scheme.json"),
      "utf8",
    ),
  ) as {
    definitions: Record<
      string,
      { properties?: Record<string, unknown>; additionalProperties?: boolean }
    >;
  };

  /** Keys the schema does not define, for a section that forbids extras. */
  function unknownKeys(section: string, value: object | undefined): string[] {
    const def = scheme.definitions[section];
    expect(def, `${section} is not in electron-builder's schema`).toBeDefined();
    if (def?.additionalProperties !== false) return [];
    const known = new Set(Object.keys(def.properties ?? {}));
    return Object.keys(value ?? {}).filter((k) => !known.has(k));
  }

  for (const [section, key] of [
    ["LinuxConfiguration", "linux"],
    ["WindowsConfiguration", "win"],
    ["MacConfiguration", "mac"],
    ["NsisOptions", "nsis"],
  ] as const) {
    it(`uses no invented keys under ${key}`, () => {
      const value = (build as unknown as Record<string, object | undefined>)[key];
      expect(
        unknownKeys(section, value),
        `electron-builder does not know these ${key} options, and it refuses ` +
          `the whole config - including on the other two platforms`,
      ).toEqual([]);
    });
  }

  it("still asks for a desktop entry, and puts each half where it is read", () => {
    /* Kept as its own assertion rather than folded into the schema check: the
     * schema says a key is spelled right, not that we set it - and this
     * particular setting is SPLIT across two places, which is what made it easy
     * to get wrong twice. `syncDesktopName` is a build option;
     * `desktopName` is manifest metadata at the ROOT (LinuxTargetHelper reads
     * `packager.info.metadata.desktopName`), and putting it under `linux` is
     * what produced an invalid configuration object. Verified by running
     * electron-builder locally until the warning stopped. */
    expect(build.linux?.syncDesktopName).toBe(true);
    expect(manifest.desktopName).toMatch(/\.desktop$/u);
  });
});

describe("the Linux package targets have the metadata they demand", () => {
  /*
   * THE THIRD FAILURE, and the reason this block enumerates rather than
   * spot-checks. With the schema finally satisfied, the Linux job got as far as
   * `FpmTarget.checkOptions()` and stopped on
   *
   *   Please specify project homepage
   *
   * fpm builds the .deb, and it wants packaging metadata that no other target
   * asks for. Each of these was found one tag at a time; the list below is read
   * off `app-builder-lib/out/targets/FpmTarget.js` -
   * `computeFpmMetaInfoOptions()` - which is where they are enforced, so all of
   * them are checked at once instead of one per release.
   *
   * `computePackageUrl()` accepts `homepage`, or falls back to a GitHub
   * `repository` field. Both are set; the test requires the explicit one,
   * because the fallback depends on the repository being parseable as GitHub
   * and that is a longer chain to be quietly wrong about.
   */
  const NEEDS_FPM = new Set(["deb", "rpm", "freebsd", "pacman", "apk", "p5p"]);
  const targets = (build.linux?.target ?? []).map((t) =>
    typeof t === "string" ? t : ((t as { target?: string }).target ?? ""),
  );

  it("declares a homepage, which fpm refuses to build without", () => {
    if (!targets.some((t) => NEEDS_FPM.has(t))) return;
    expect(
      manifest.homepage,
      `linux.target includes ${targets.filter((t) => NEEDS_FPM.has(t)).join(", ")}, ` +
        `and fpm fails the whole Linux job without a homepage`,
    ).toMatch(/^https?:\/\//u);
  });

  it("names a maintainer, or an author with an email for one to be built from", () => {
    if (!targets.some((t) => NEEDS_FPM.has(t))) return;
    const maintainer = (build.linux as { maintainer?: string } | undefined)?.maintainer;
    const authorEmail = /<[^>]+@[^>]+>/u.test(manifest.author ?? "");
    expect(
      Boolean(maintainer) || authorEmail,
      "fpm needs linux.maintainer, or an author with an email address",
    ).toBe(true);
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
