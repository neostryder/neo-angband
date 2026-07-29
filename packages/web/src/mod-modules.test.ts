/**
 * findSpecifiers / buildModuleGraph - a mod with SEVERAL scripts in a folder a
 * browser tab was handed.
 *
 * Two properties matter, and they pull in opposite directions:
 *
 *  - every real specifier must be found, or a dependency silently keeps its
 *    original relative text and the import dies with the browser's own message
 *    naming the wrong file;
 *  - nothing that is not a specifier may be touched, because rewriting a string in
 *    the middle of someone's program is the worst class of bug this could have -
 *    it changes behaviour without failing.
 *
 * So the negative cases are tested as carefully as the positive ones, including the
 * ones a regex over `from\s*"..."` gets wrong: a `from "x"` inside a comment, inside
 * a string, inside a template literal, and a variable actually named `from`.
 */

import { describe, expect, it } from "vitest";
import {
  buildModuleGraph,
  findSpecifiers,
  isRelative,
  resolveModulePath,
} from "./mod-modules";

/** The specifiers found, as plain strings. */
function specs(src: string): string[] {
  return findSpecifiers(src).map((s) => s.spec);
}

describe("findSpecifiers: every position the grammar allows", () => {
  it.each([
    ['import x from "./a.js";', ["./a.js"]],
    ["import x from './a.js';", ["./a.js"]],
    ['import "./side-effect.js";', ["./side-effect.js"]],
    ['import * as ns from "./a.js";', ["./a.js"]],
    ['import { a, b as c } from "./a.js";', ["./a.js"]],
    ['import def, { a } from "./a.js";', ["./a.js"]],
    ['export { a } from "./a.js";', ["./a.js"]],
    ['export * from "./a.js";', ["./a.js"]],
    ['export * as ns from "./a.js";', ["./a.js"]],
    ['const m = await import("./a.js");', ["./a.js"]],
    ['import{a}from"./a.js";', ["./a.js"]], // minified, no spaces
    ['import x from "@neo-angband/core";', ["@neo-angband/core"]], // bare, still found
  ])("finds the specifier in %s", (src, want) => {
    expect(specs(src as string)).toEqual(want);
  });

  it("finds several, in source order", () => {
    const src = [
      'import a from "./a.js";',
      'import b from "./lib/b.js";',
      'export { c } from "../shared/c.js";',
      'const d = await import("./d.js");',
    ].join("\n");
    expect(specs(src)).toEqual(["./a.js", "./lib/b.js", "../shared/c.js", "./d.js"]);
  });

  it("reports bounds that slice out exactly the quoted literal", () => {
    const src = 'import x from "./a.js";';
    const found = findSpecifiers(src)[0]!;
    expect(src.slice(found.start, found.end)).toBe('"./a.js"');
  });
});

describe("findSpecifiers: what it must NOT touch", () => {
  it.each([
    ['export default "some text";', "an exported string"],
    ['const from = "./a.js";', "a variable named from"],
    ['const o = { from: "./a.js" };', "an object key named from"],
    ['// import x from "./a.js"', "a line comment"],
    ['/* import x from "./a.js" */', "a block comment"],
    ['const s = "import x from \\"./a.js\\"";', "a string containing the syntax"],
    ["const s = `import x from \"./a.js\"`;", "a template literal"],
    ['console.log("from", "./a.js");', "an argument list"],
    ['if (import.meta.url) log("./a.js");', "import.meta plus a call"],
    ['const r = /from "\\.\\/a\\.js"/u;', "a regex literal"],
  ])("leaves %s alone", (src) => {
    expect(specs(src as string)).toEqual([]);
  });

  it("scans code inside a template substitution but not the text around it", () => {
    /* The substitution body is real code, so a dynamic import there is real; the
     * literal parts either side are not. */
    const src = 'const s = `before from "./no.js" ${await import("./yes.js")} after`;';
    expect(specs(src)).toEqual(["./yes.js"]);
  });

  it("handles a nested template without losing its place", () => {
    const src = [
      "const s = `a ${`b ${c}`} d`;",
      'import real from "./real.js";',
    ].join("\n");
    expect(specs(src)).toEqual(["./real.js"]);
  });

  it("does not mistake division for a regex", () => {
    const src = ['const half = total / 2;', 'import x from "./a.js";'].join("\n");
    expect(specs(src)).toEqual(["./a.js"]);
  });

  it("survives an unterminated string without hanging or eating the file", () => {
    const src = 'const bad = "oops\nimport x from "./a.js";';
    expect(() => specs(src)).not.toThrow();
  });
});

describe("resolveModulePath", () => {
  it.each([
    ["plugin.js", "./helper.js", "helper.js"],
    ["plugin.js", "./lib/dice.js", "lib/dice.js"],
    ["lib/dice.js", "./rng.js", "lib/rng.js"],
    ["lib/dice.js", "../plugin.js", "plugin.js"],
    ["lib/a/b.js", "../../top.js", "top.js"],
    ["plugin.js", "./lib/../helper.js", "helper.js"],
  ])("%s + %s -> %s", (from, spec, want) => {
    expect(resolveModulePath(from as string, spec as string)).toBe(want);
  });

  it("refuses to leave the pack folder", () => {
    expect(resolveModulePath("plugin.js", "../../../etc/passwd")).toBeNull();
    expect(resolveModulePath("lib/a.js", "../../secret.js")).toBeNull();
  });

  it("knows a bare specifier is not its business", () => {
    expect(isRelative("@neo-angband/core")).toBe(false);
    expect(isRelative("./a.js")).toBe(true);
    expect(isRelative("../a.js")).toBe(true);
  });
});

/* --- the graph ---------------------------------------------------------- */

/** A pack as a path -> source map, wrapped as a ModuleGraphSource. */
function pack(files: Record<string, string>): {
  source: Parameters<typeof buildModuleGraph>[1];
  built: Map<string, string>;
} {
  const built = new Map<string, string>();
  return {
    built,
    source: {
      read: (p) => Promise.resolve(files[p] ?? null),
      urlFor: (p, text) => {
        built.set(p, text);
        return `url:${p}`;
      },
    },
  };
}

describe("buildModuleGraph", () => {
  it("rewrites a relative import to the dependency's URL", async () => {
    const p = pack({
      "plugin.js": 'import { roll } from "./lib/dice.js";\nexport default { roll };',
      "lib/dice.js": "export const roll = () => 4;",
    });
    const res = await buildModuleGraph("plugin.js", p.source);
    expect(res.problem).toBeNull();
    expect(res.url).toBe("url:plugin.js");
    expect(p.built.get("plugin.js")).toContain('import { roll } from "url:lib/dice.js";');
    /* The dependency's own text is untouched - only specifiers change. */
    expect(p.built.get("lib/dice.js")).toBe("export const roll = () => 4;");
  });

  it("builds a whole tree, dependencies before the files that need them", async () => {
    const p = pack({
      "plugin.js": 'import "./a.js";\nimport "./b.js";',
      "a.js": 'import "./deep/c.js";',
      "b.js": "export const b = 1;",
      "deep/c.js": "export const c = 1;",
    });
    const res = await buildModuleGraph("plugin.js", p.source);
    expect(res.problem).toBeNull();
    expect(res.files).toEqual(["plugin.js", "a.js", "deep/c.js", "b.js"]);
    /* Post-order: a leaf must have a URL before its importer is wrapped. */
    expect([...p.built.keys()]).toEqual(["deep/c.js", "a.js", "b.js", "plugin.js"]);
    expect(res.urls).toHaveLength(4);
  });

  it("wraps a shared dependency once and points both importers at it", async () => {
    const p = pack({
      "plugin.js": 'import "./a.js";\nimport "./b.js";',
      "a.js": 'import "./shared.js";',
      "b.js": 'import "./shared.js";',
      "shared.js": "export const s = 1;",
    });
    const res = await buildModuleGraph("plugin.js", p.source);
    expect(res.problem).toBeNull();
    expect(res.urls.filter((u) => u === "url:shared.js")).toHaveLength(1);
    expect(p.built.get("a.js")).toContain('"url:shared.js"');
    expect(p.built.get("b.js")).toContain('"url:shared.js"');
  });

  it("leaves a bare specifier exactly as written", async () => {
    /* There should be none - the engine is passed in - but if a mod has one, the
     * rewriter must not invent a path for it. The import then fails with the
     * browser's message, which is the honest outcome. */
    const p = pack({ "plugin.js": 'import * as core from "@neo-angband/core";' });
    const res = await buildModuleGraph("plugin.js", p.source);
    expect(res.problem).toBeNull();
    expect(p.built.get("plugin.js")).toBe('import * as core from "@neo-angband/core";');
  });

  it("names both files in a cycle", async () => {
    const p = pack({
      "plugin.js": 'import "./a.js";',
      "a.js": 'import "./plugin.js";',
    });
    const res = await buildModuleGraph("plugin.js", p.source);
    expect(res.url).toBeNull();
    expect(res.problem).toContain("a.js");
    expect(res.problem).toContain("plugin.js");
    expect(res.problem).toContain("import each other");
  });

  it("says which file is missing, and mentions the extension when there is none", async () => {
    const withExt = await buildModuleGraph(
      "plugin.js",
      pack({ "plugin.js": 'import "./gone.js";' }).source,
    );
    expect(withExt.problem).toContain("gone.js is imported but is not in the mod folder");
    expect(withExt.problem).not.toContain("extension");

    const noExt = await buildModuleGraph(
      "plugin.js",
      pack({ "plugin.js": 'import "./helper";' }).source,
    );
    expect(noExt.problem).toContain("file extension");
    expect(noExt.problem).toContain('"./helper.js"');
  });

  it("refuses a specifier that climbs out of the mod folder", async () => {
    const res = await buildModuleGraph(
      "plugin.js",
      pack({ "plugin.js": 'import "../../other-mod/plugin.js";' }).source,
    );
    expect(res.url).toBeNull();
    expect(res.problem).toContain("outside the mod folder");
    expect(res.problem).toContain("only load its own files");
  });

  it("returns the URLs it already made when it fails, so none are leaked", async () => {
    /* a.js wraps successfully, then b.js's dependency is missing. The caller has to
     * be able to revoke a.js's blob or the mod's source stays pinned in memory for
     * the life of the document. */
    const p = pack({
      "plugin.js": 'import "./a.js";\nimport "./b.js";',
      "a.js": "export const a = 1;",
      "b.js": 'import "./gone.js";',
    });
    const res = await buildModuleGraph("plugin.js", p.source);
    expect(res.url).toBeNull();
    expect(res.urls).toContain("url:a.js");
  });

  it("reports a missing ENTRY as a problem rather than throwing", async () => {
    const res = await buildModuleGraph("plugin.js", pack({}).source);
    expect(res.url).toBeNull();
    expect(res.problem).toContain("plugin.js");
  });
});
