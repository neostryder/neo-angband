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

const packagesDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * The packages published to npm. Anything here must satisfy every claim below;
 * a package NOT here is a bundler target and may import however it likes.
 */
const PUBLISHED = ["core", "mod-sdk"] as const;

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

describe.each(PUBLISHED)("@neo-angband/%s is publishable", (pkg) => {
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

  it("is not marked private, and publishes publicly with provenance", () => {
    expect(manifest["private"]).toBeUndefined();
    expect(manifest["publishConfig"]).toEqual({ access: "public", provenance: true });
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
