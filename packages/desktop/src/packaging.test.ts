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
  mac?: { target?: unknown[]; artifactName?: string };
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

describe("the macOS bundle gets a signature of some kind", () => {
  /*
   * THE FOURTH THING THIS FILE IS ABOUT, and the one with the worst symptom.
   *
   * With no Apple Developer identity, MacPackager.sign finds nothing and returns
   * false, so nothing seals the bundle: measured on the 0.15.3 zip, ZERO
   * `_CodeSignature` directories, on the app and on all four helper apps. On
   * Apple Silicon that is not "unsigned", it is unrunnable - the kernel requires
   * at least an ad-hoc signature on an arm64 Mach-O, and macOS reports the
   * refusal as "is damaged and can't be opened".
   *
   * A NAME IS NOT A HOOK, which is the lesson of the desktopName/syncDesktopName
   * pair three blocks up: the config can point at a script that is not there, and
   * electron-builder would only find out during a release. So the file is read,
   * and it has to export the hook and reach for codesign.
   */
  const afterPack = (manifest.build as unknown as { afterPack?: string }).afterPack;

  it("declares an afterPack hook", () => {
    expect(afterPack, "no afterPack: the macOS app ships with no signature").toBeTruthy();
  });

  it("the hook file exists and ad-hoc signs", () => {
    const src = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "..", afterPack ?? ""),
      "utf8",
    );
    expect(src).toContain("exports.default");
    /* `-` IS the ad-hoc identity; signing with anything else here would need a
     * certificate this project does not have. */
    expect(src).toMatch(/"--sign",\s*"-"/u);
    expect(src).toContain("darwin");
    /* And it must not be able to fail a release: Windows and Linux artifacts of
     * the same run do not deserve to die for a macOS signing problem. */
    expect(src).toContain("catch");
  });
});

describe("what we tell a macOS user to do is what macOS does", () => {
  /*
   * THE DEFECT: three places told the reader to "right-click the app and choose
   * Open". That was the standard answer for a decade, and Apple deleted the
   * bypass in macOS 15 Sequoia - on 15 and later it produces exactly the same
   * refusal as a double-click. So the instructions did not merely omit the real
   * route (System Settings -> Privacy & Security -> Open Anyway), they sent
   * people down one that cannot work, on the newest OS, for an app whose own
   * dialog offers nothing but Done and Move to Trash.
   *
   * Instructions rot silently, and this is the shape that rots worst: advice
   * that USED to be right. So it is asserted rather than reviewed, in every file
   * that carries it - and the assertion is on the ABSENCE of the dead advice as
   * well as the presence of the live route, because adding the new steps without
   * deleting the old ones leaves two answers and no way to tell which is current.
   */
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const SOURCES = ["README.md", "docs/INSTALL.md", ".github/workflows/release.yml"];

  for (const rel of SOURCES) {
    const text = readFileSync(join(ROOT, rel), "utf8");

    it(`${rel} does not give the right-click -> Open advice Apple removed`, () => {
      /* Ctrl-click too: it is the same gesture under another name, and it is the
       * spelling Apple's own old documentation used. Verified against the exact
       * sentence that was in all three files - "right-click the app and choose
       * *Open*" - and against "Ctrl-click the app and choose Open". */
      expect(text).not.toMatch(
        /(right-?click|ctrl-?click)[^.\n]{0,40}(and )?(choose|select)\s+\*?Open\*?/iu,
      );
    });

    it(`${rel} names the route that works: Privacy & Security -> Open Anyway`, () => {
      expect(text).toMatch(/Privacy & Security/u);
      expect(text).toMatch(/Open Anyway/u);
    });
  }

  it("says which build Apple Silicon wants, since both are on the page", () => {
    for (const rel of SOURCES) {
      const text = readFileSync(join(ROOT, rel), "utf8");
      expect(text, rel).toMatch(/arm64|Apple Silicon/u);
    }
  });

  it("does not offer the Intel build as a thing that runs through Rosetta", () => {
    /*
     * THE SAME ROT, TWICE IN ONE RELEASE. The right-click assertion above exists
     * because advice that used to be right is the kind that rots silently. These
     * three files then said, in the same paragraph, "the Intel one runs on an
     * M-series Mac through Rosetta 2 - it works and it is slower", which was
     * true when written and is being withdrawn under it: macOS 27 deletes
     * Rosetta 2 during installation, and macOS 28 keeps it only for a named set
     * of old games. On a Mac without it the Intel build does not run slowly, it
     * does not run.
     *
     * That also retires a CAUSAL claim this file used to make - that an unsigned
     * arm64 bundle reads as a bad download and pushes people onto the Intel
     * build and Rosetta, so a signing fault surfaces as a speed complaint. The
     * signing defect is real and measured either way; the speed story needed
     * Rosetta to exist, so it is gone rather than restated.
     */
    for (const rel of SOURCES) {
      const text = readFileSync(join(ROOT, rel), "utf8");
      expect(text, rel).not.toMatch(/(runs?|running)[^.\n]{0,60}(through|via|under)\s+Rosetta/iu);
    }
  });
});

describe("a macOS download says which Mac it is for", () => {
  /*
   * THE DEFECT: the release page carried `Neo.Angband-0.16.0-arm64.dmg` and
   * `Neo.Angband-0.16.0.dmg`, and the second one is the INTEL build. Nothing
   * says so. electron-builder's default artifactName interpolates `${arch}`
   * only when the arch is not x64, so the Intel artifact is the one with no
   * label - and beside an explicitly-labelled arm64 file, an unlabelled one
   * reads as "the normal one", or as universal - it was read as universal on
   * the release page within a day of being uploaded.
   *
   * The cost is not cosmetic and it is getting worse: Apple is withdrawing
   * Rosetta 2 (macOS 27 removes it at install, macOS 28 keeps it for a named
   * set of old games), so on a current Apple Silicon Mac the mislabelled file
   * does not run slowly, it does not run.
   *
   * `arch` is therefore mandatory in the template. Asserted on the STRING
   * rather than on a produced filename because these artifacts only exist
   * after a twenty-minute release build - the whole premise of this file.
   */
  it("puts the architecture in every macOS artifact name", () => {
    const template = build.mac?.artifactName;
    expect(
      template,
      "mac.artifactName is unset, so electron-builder omits the arch on x64 and " +
        "the Intel build ships with no label",
    ).toBeTruthy();
    expect(template).toContain("${arch}");
  });

  it("declares both architectures, since neither is universal", () => {
    /* If a universal target ever replaces these, this test should be the thing
     * that fails and gets rewritten - not the download page. */
    const json = JSON.stringify(build.mac?.target ?? []);
    expect(json).toContain("arm64");
    expect(json).toContain("x64");
  });
});

describe("publishing an 0.x release does not present it as stable", () => {
  /*
   * Draft and pre-release are different claims. The workflow has always drafted
   * - publishing is a human decision - but a draft says nothing about the
   * software, and pressing publish on an 0.x tag without --prerelease marks it
   * "Latest release". An alpha would then be the thing GitHub's API, the
   * repository sidebar and every "download latest" link point at.
   */
  const workflow = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", ".github", "workflows", "release.yml"),
    "utf8",
  );

  it("passes --prerelease for a 0.x tag", () => {
    expect(workflow).toContain("--prerelease");
    /* And it must be CONDITIONAL: hard-coding it would keep flagging releases
     * as pre-release after 1.0, which is the same defect facing the other way. */
    expect(workflow).toMatch(/0\.\*\)/u);
  });

  it("still drafts, so a human is the last gate", () => {
    expect(workflow).toContain("--draft");
  });
});

describe("the updater's two halves name the same repository", () => {
  /*
   * The string is deliberately NOT shared, because the two copies answer
   * different questions: the renderer's decides which API to ASK, and the main
   * process's decides what it is willing to FETCH. Only the second is a security
   * boundary - a renderer talked into a different catalogue must not be able to
   * bring its own download host with it.
   *
   * Two copies of a rule is how one of them quietly stops matching, though (see
   * the duplicated-check family of bugs in this codebase), so the agreement is
   * asserted rather than assumed.
   */
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
  const read = (rel: string): string => readFileSync(join(ROOT, rel), "utf8");
  const repoIn = (src: string): string | undefined =>
    /UPDATE_REPO = "([^"]+)"/u.exec(src)?.[1];

  it("agrees on the repository", () => {
    const renderer = repoIn(read("packages/web/src/update.ts"));
    const main = repoIn(read("packages/desktop/src/updater.ts"));
    expect(renderer, "no UPDATE_REPO in web/src/update.ts").toBeTruthy();
    expect(main).toBe(renderer);
  });

  it("names THIS project, not whatever repo was convenient to test against", () => {
    /*
     * Agreement is symmetric, so it cannot see the one edit most likely to
     * happen: this feature is untestable end-to-end until a release is
     * published, so verifying it meant temporarily pointing the check at a repo
     * that already had some - upstream angband/angband. That edit was reverted
     * and the agreement test above caught it only because one half was patched.
     * Patch both, which is the natural thing to do when the first attempt does
     * not work, and every check in this suite goes green while the game offers
     * players somebody else's version numbers as a Neo Angband upgrade.
     *
     * So the value is asserted, not just its consistency. A real repository
     * change is one line here; a debugging pointer is a failure.
     */
    for (const rel of ["packages/web/src/update.ts", "packages/desktop/src/updater.ts"]) {
      expect(repoIn(read(rel)), rel).toBe("neostryder/neo-angband");
    }
  });

  it("promises the player the same directory the swap script actually skips", () => {
    /*
     * The update screen tells the player their characters survive, and names the
     * folder. The swap script skips exactly the entries in PRESERVE. Those live
     * in different packages and the web one cannot import the desktop one - the
     * dependency runs the other way - so the string is written twice, and this is
     * the assertion that stops the copies drifting. A reassurance that names the
     * wrong folder is worse than none, because it is believed.
     */
    const preserved = /PRESERVE: readonly string\[\] = \[([^\]]*)\]/u
      .exec(read("packages/desktop/src/update-plan.ts"))?.[1];
    expect(preserved, "no PRESERVE list in update-plan.ts").toBeTruthy();
    const names = [...(preserved ?? "").matchAll(/"([^"]+)"/gu)].map((m) => m[1] ?? "");
    expect(names.length).toBeGreaterThan(0);
    const screen = read("packages/web/src/update-ui.ts");
    for (const name of names) {
      expect(screen, `the update screen never mentions ${name}`).toContain(name);
    }
  });

  it("keeps the download host check in the main process, not the renderer", () => {
    /* If this moved to the renderer it would be advice, not a gate. */
    expect(read("packages/desktop/src/updater.ts")).toContain("isAllowedAssetUrl");
    expect(read("packages/web/src/update.ts")).not.toContain("isAllowedAssetUrl");
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
