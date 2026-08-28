/**
 * The invariants that make this package publishable to npm.
 *
 * WHY THIS LIVES IN CORE. tsc emits import specifiers verbatim, so
 * `export * from "./rng"` stays extensionless in dist/index.js. A bundler resolves
 * that; Node does not. Measured on 2026-07-31, before this file existed:
 *
 *   node -e 'import("packages/core/dist/index.js")'
 *   -> ERR_MODULE_NOT_FOUND  file:///.../packages/core/dist/rng
 *
 * The whole engine - 1697 exports - was unimportable outside a bundler, and
 * nothing in the repository noticed, because the web app and vitest both run
 * through Vite. 4612 specifiers in this package had to gain `.js`. The test that
 * would have caught it belongs beside them.
 *
 * The rest of the file guards the smaller packaging claims that are easy to make
 * and easy to break: `private: true` left on, a README that is listed but absent,
 * `files` that no longer excludes the 248 compiled test modules.
 *
 * NOT covered here, on purpose: whether the TARBALL is importable. A file scan
 * cannot know that - the bytes npm ships are the only evidence. That is
 * tools/check-npm-package.mjs, which packs each package, extracts it into an
 * empty directory and imports it with plain Node. CI runs it.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, existsSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
// @ts-expect-error -- plain .mjs tooling, no types; see tools/publishable.mjs
import { publishablePackages } from "../../../tools/publishable.mjs";
// @ts-expect-error -- plain .mjs tooling, no types; see tools/npm-pack-result.mjs
import { packResult } from "../../../tools/npm-pack-result.mjs";

const packagesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * The packages published to npm. Anything here must satisfy every claim below;
 * a package NOT here is a bundler target and may import however it likes.
 *
 * DERIVED, not listed. This was `["core", "mod-sdk"]` with a comment asking a
 * human to keep it in step with `PUBLISHABLE` in tools/check-npm-package.mjs and
 * with two `for pkg in core mod-sdk` loops in publish-npm.yml - four copies of
 * one fact. `private: true` is not a proxy for the answer, it IS the answer: npm
 * refuses to publish a package carrying it. So the set is "what npm would
 * publish", read from the manifests, and making the next package publishable is
 * one deleted field rather than four edits three of which nothing would catch.
 */
const PUBLISHED = publishablePackages(join(packagesDir, "..")) as string[];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

/**
 * Relative import specifiers with no explicit extension, one entry per site.
 *
 * Comment lines are dropped first: combat/index.ts's own doc comment says
 * `directly from "./combat"` as prose, and that is not an import. Stripping is
 * line-based rather than a full parse because a specifier and its `from` are
 * always on one line in this codebase - `import` lines are never wrapped.
 */
function extensionlessImports(file: string): string[] {
  const found: string[] = [];
  for (const raw of readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = raw.replace(/\/\/.*$/, "");
    if (/^\s*\*/.test(line)) continue;
    for (const m of line.matchAll(/(?:\bfrom\s*"|\bimport\s*\(\s*"|\bimport\s*")(\.[^"]*)"/g)) {
      const spec = m[1] as string;
      if (!/\.(js|json|css|png|txt|prf|md|mjs|cjs)$/.test(spec)) found.push(`${file}: ${spec}`);
    }
  }
  return found;
}

describe("the publishable set itself", () => {
  /*
   * A derived list has a failure mode a literal does not: it can come back
   * SHORT and every test below still passes, because describe.each over fewer
   * packages simply asserts less. Marking core private by accident would turn
   * this whole file green while breaking the release.
   */
  it("found the packages, and did not come back empty", () => {
    expect(PUBLISHED.length).toBeGreaterThanOrEqual(3);
  });

  it("always includes the two packages the mod ABI is made of", () => {
    /* core and mod-sdk are what a mod author installs. Their leaving this set is
     * never a decision - it is a mistake in a manifest - so it is pinned by name
     * even though the set is otherwise derived. `content` is not pinned: it is a
     * data package and dropping it would be a legitimate choice. */
    expect(PUBLISHED).toContain("core");
    expect(PUBLISHED).toContain("mod-sdk");
  });

  it("excludes the packages that are applications, not libraries", () => {
    /* The other direction: a `private: true` accidentally deleted would start
     * publishing the desktop shell and the web app to npm on the next tag. */
    for (const app of ["web", "desktop", "cli", "mcp", "borg"]) {
      expect(PUBLISHED, `${app} must not be published`).not.toContain(app);
    }
  });
});

describe("`npm pack --json`, whichever npm answers", () => {
  /*
   * The release check packs each package and reads back the tarball's filename.
   * npm 11 answers with an ARRAY of one object; npm 12 answers with an OBJECT
   * keyed by package name. tools/check-npm-package.mjs read the array shape, so
   * on npm 12 it threw `object is not iterable` for EVERY package - including
   * core, which was green in CI the whole time, because CI ran it on the npm
   * Node 24 bundles and only the release path installed npm@latest.
   *
   * Fixing that without a test would just buy the next shape change the same
   * free pass, and this is a function nothing else can reach: the checker packs
   * real tarballs at import time, so it cannot be imported by a test. That is
   * why packResult lives in tools/npm-pack-result.mjs on its own.
   *
   * These are recorded outputs, not invented ones - both were captured from a
   * real `npm pack --json` run.
   */
  const NPM_11 = JSON.stringify([
    { id: "@rpgm-tools/neo-angband-core@0.11.0", filename: "rpgm-tools-neo-angband-core-0.11.0.tgz", size: 4194304 },
  ]);
  const NPM_12 = JSON.stringify({
    "@rpgm-tools/neo-angband-core": {
      id: "@rpgm-tools/neo-angband-core@0.11.0",
      filename: "rpgm-tools-neo-angband-core-0.11.0.tgz",
      size: 4194304,
    },
  });

  it.each([
    ["npm 11 (array of one)", NPM_11],
    ["npm 12 (keyed by package name)", NPM_12],
  ])("reads the filename and size out of %s", (_label, stdout) => {
    const entry = packResult(stdout, "core") as { filename: string; size: number };
    expect(entry.filename).toBe("rpgm-tools-neo-angband-core-0.11.0.tgz");
    expect(entry.size).toBe(4194304);
  });

  it("refuses a shape it does not recognise instead of returning undefined", () => {
    /* The failure that matters is the QUIET one. Returning an entry with no
     * filename sends `undefined` into join(), and the error surfaces hundreds of
     * lines later as a missing tarball rather than as an unknown npm. */
    expect(() => packResult(JSON.stringify({ ok: true }), "core")).toThrow(/no filename in it/u);
    expect(() => packResult(JSON.stringify([]), "core")).toThrow(/no filename in it/u);
  });
});

describe.each(PUBLISHED)("@rpgm-tools/neo-angband-%s is publishable", (pkg) => {
  const root = join(packagesDir, pkg);
  const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as Record<
    string,
    unknown
  >;

  it("imports every relative module with an explicit .js extension", () => {
    const offenders = sourceFiles(join(root, "src")).flatMap(extensionlessImports);
    expect(offenders).toEqual([]);
  });

  it("scanned a real source tree, so an empty result means something", () => {
    /* Guards the guard: a typo'd path would make the test above vacuous. */
    const files = sourceFiles(join(root, "src"));
    expect(files.length).toBeGreaterThan(10);
    const specifiers = files.flatMap((f) =>
      [...readFileSync(f, "utf8").matchAll(/\bfrom\s*"(\.[^"]*)"/g)].map((m) => m[1]),
    );
    expect(specifiers.length).toBeGreaterThan(10);
  });

  it("is not marked private, and publishes publicly", () => {
    expect(manifest["private"]).toBeUndefined();
    expect(manifest["publishConfig"]).toEqual({ access: "public" });
  });

  it("does NOT ask for provenance, which trusted publishing attaches on its own", () => {
    /* Not a style preference. `provenance: true` forces provenance on EVERY publish,
     * and provenance cannot be generated outside a cloud CI runner - so it breaks
     * the one manual publish a brand-new package needs before it has a settings page
     * to configure a trusted publisher on. The flag looks like a safety improvement,
     * which is exactly why its absence needs a test rather than a comment. */
    const publishConfig = manifest["publishConfig"] as Record<string, unknown>;
    expect(publishConfig["provenance"]).toBeUndefined();
  });

  it("publishes under the scope the org actually owns", () => {
    /* The org name IS the scope, and half a rename is worse than none: a package
     * whose manifest still said the old scope would publish under a name nobody
     * owns, and npm would answer with a 404 that reads like a network problem. */
    expect(manifest["name"]).toBe(`@rpgm-tools/neo-angband-${pkg}`);
  });

  it("declares where it came from, so npm can show a repository and issues link", () => {
    expect(manifest["repository"]).toMatchObject({
      type: "git",
      url: "git+https://github.com/neostryder/neo-angband.git",
      directory: `packages/${pkg}`,
    });
    expect(typeof manifest["bugs"]).toBe("string");
    expect(typeof manifest["homepage"]).toBe("string");
  });

  it("ships the README and LICENCE it lists, and they exist on disk", () => {
    const files = manifest["files"] as string[];
    expect(files).toContain("README.md");
    expect(files).toContain("LICENSE.md");
    expect(existsSync(join(root, "README.md"))).toBe(true);
    expect(existsSync(join(root, "LICENSE.md"))).toBe(true);
  });

  it("excludes compiled test modules from the tarball", () => {
    /* src/ holds tests beside sources, so `dist` alone would publish them and
     * they import vitest - which this package does not depend on. */
    const files = manifest["files"] as string[];
    for (const pattern of ["!**/*.test.js", "!**/*.test.d.ts", "!**/*.test.ts"]) {
      expect(files).toContain(pattern);
    }
  });

  it("ships the thing it is FOR, not only its dist", () => {
    /* A `files` list that compiles and imports cleanly can still leave out the
     * payload. `content` is the case that makes this worth a test: its point is
     * the 45 compiled JSON files in pack/, and a tarball with a working
     * `compileGamedata` export and no pack/ would satisfy every other assertion
     * in this file while being useless to the consumer who installed it. */
    const files = manifest["files"] as string[];
    const payload: Record<string, string> = { content: "pack", "mod-sdk": "docs" };
    const required = payload[pkg];
    if (required === undefined) return;
    expect(files, `${pkg} must ship ${required}/`).toContain(required);
    expect(
      readdirSync(join(root, required)).length,
      `${required}/ is listed but empty`,
    ).toBeGreaterThan(0);
  });

  it("regenerates a payload directory it does not hand-maintain, before every pack", () => {
    /* mod-sdk/docs/ is generated FROM docs/modding/, not edited in place (see
     * scripts/sync-docs.mjs's own header). The files entry alone is not enough:
     * it ships whatever happens to be sitting in docs/ at commit time, which
     * silently went stale for a real, shipped feature (ctx.display, MOD_SEAMS.md)
     * once a version-bump revert also dropped this wiring - undetected until a
     * consumer's own build broke on a missing tutorial. `prepack` is what npm runs
     * on every `pack`/`publish`, with or without a prior manual `build`. */
    const generated: Record<string, string> = { "mod-sdk": "sync-docs" };
    const script = generated[pkg];
    if (script === undefined) return;
    const scripts = manifest["scripts"] as Record<string, string>;
    expect(scripts["prepack"]).toBe(`pnpm run ${script}`);
    expect(scripts[script]).toMatch(/^node scripts\//);
  });

  it("resolves its own entry points to files the build actually emits", () => {
    const exports = manifest["exports"] as Record<string, unknown>;
    for (const [subpath, entry] of Object.entries(exports)) {
      if (typeof entry === "string") continue; // "./package.json"
      const { types, default: js } = entry as { types: string; default: string };
      expect(existsSync(join(root, js)), `${subpath} -> ${js}`).toBe(true);
      expect(existsSync(join(root, types)), `${subpath} -> ${types}`).toBe(true);
    }
  });
});

/**
 * The release workflow authenticates by identity, not by secret.
 *
 * These read the YAML as text rather than parsing it, because what is being
 * asserted is the ABSENCE of a token - and the shape a reintroduced token would
 * take is unknown, so a text search over the whole file catches more of them than
 * a lookup at one key would.
 */
describe("publish-npm.yml publishes without a token", () => {
  const workflow = readFileSync(
    join(packagesDir, "..", ".github", "workflows", "publish-npm.yml"),
    "utf8",
  );

  it("requests the OIDC token GitHub mints for the job", () => {
    expect(workflow).toMatch(/id-token:\s*write/);
  });

  it("holds no npm credential of any kind", () => {
    /* npm's 2026-07-08 changelog stops 2FA-bypass granular tokens publishing in
     * January 2027. A token added back here would keep working for months and then
     * stop, at whichever release happened to fall after the cutoff - so the moment
     * to catch it is when it is added, not when it breaks. */
    for (const credential of ["NPM_TOKEN", "NODE_AUTH_TOKEN", "_authToken"]) {
      expect(workflow, credential).not.toContain(credential);
    }
  });

  it("derives the package list instead of hardcoding one", () => {
    /* The workflow is the copy that fails SILENTLY: a package its loop does not
     * name is not published and nothing says so - the job is green, the release
     * looks done, and the package is simply missing from the registry. Asserted
     * in both directions, because "calls the script" and "no longer hardcodes"
     * are different claims and the first can be true while a stale literal
     * remains next to it. */
    expect(workflow).toContain("node tools/publishable.mjs");
    /* Against the workflow with its COMMENTS STRIPPED. This caught itself
     * immediately: the comment explaining the change quotes the old
     * `for pkg in core mod-sdk` it replaced, and the assertion matched the
     * explanation rather than the code. Prose is not behaviour, in either
     * direction - the same trap the pre-commit-hook test records. */
    const code = workflow
      .split("\n")
      .filter((l) => !/^\s*#/u.test(l))
      .join("\n");
    expect(code, "a hardcoded package loop is back").not.toMatch(/for pkg in [a-z]/u);
  });

  it("asserts the npm version instead of assuming the runner's", () => {
    /* An npm older than 11.5.1 does not report that it cannot do OIDC. It quietly
     * falls back to looking for a token, and fails with ENEEDAUTH - which reads as
     * a permissions problem and sends you to the wrong page. */
    expect(workflow).toContain("11.5.1");
  });
});

describe("the mod SDK ships its plugin builder", () => {
  /**
   * `neo-angband-mod-build` is the reason the SDK is published rather than merely
   * versioned: it is what lets a mod repository - anyone's - build the `plugin.js` the
   * game will load, under the same ABI rules the first-party mods are held to.
   *
   * Two ways it could silently stop being usable, and neither shows up in a test of the
   * tool itself: the `bin` mapping could be dropped, or `files` could stop including
   * `bin/` so the tarball ships without it. Both leave every existing checkout working
   * perfectly and every fresh `npm i` broken.
   */
  const sdk = JSON.parse(
    readFileSync(new URL("../../mod-sdk/package.json", import.meta.url), "utf8"),
  ) as { bin?: Record<string, string>; files?: string[] };

  it("maps the bin under a name a mod author can run", () => {
    expect(sdk.bin?.["neo-angband-mod-build"]).toBe("bin/neo-angband-mod-build.mjs");
  });

  it("includes bin/ in the published files, so the tarball actually carries it", () => {
    expect(sdk.files).toContain("bin");
  });

  it("and the file the mapping points at exists", () => {
    /* Guards both of the above: a mapping to a missing file installs a broken command. */
    const src = readFileSync(
      new URL("../../mod-sdk/bin/neo-angband-mod-build.mjs", import.meta.url),
      "utf8",
    );
    expect(src.startsWith("#!/usr/bin/env node")).toBe(true);
    /* The guarantee that is the whole point of the tool living here rather than being
     * copied into each mod repo. */
    expect(src).toContain("external-bare-specifiers");
  });
});
