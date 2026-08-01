/**
 * Exactly one file in this package may import a runtime VALUE from the engine.
 *
 * The Borg's destination is its own mod repository, where the plugin builder
 * refuses a bundled copy of `@rpgm-tools/neo-angband-core` - a plugin carrying its
 * own engine gets its own registries while the game runs on another set. A mod
 * receives the live engine as `ctx.core` instead.
 *
 * So every bare value import here is a line that has to be rewritten on the way
 * out, and the point of `core-api.ts` is that there is one of them. This test is
 * what keeps that true. Without it the funnel holds until the next person adds
 * `import { FEAT } from "@rpgm-tools/neo-angband-core"` at the top of a new file,
 * which nothing else in the repository would notice - it compiles, it runs, and
 * it is only wrong in a build that has not happened yet.
 *
 * TYPE-ONLY IMPORTS ARE FINE AND ARE NOT COUNTED. They are erased, they cost the
 * mod nothing, and funnelling them would hide which engine types each module
 * actually speaks in. 28 of the 37 files that mention the package are type-only.
 */

import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const srcRoot = dirname(fileURLToPath(import.meta.url));
const ENGINE = "@rpgm-tools/neo-angband-core";

/** The single file allowed to name the engine as a value source. */
const FUNNEL = "core-api.ts";

/**
 * Every `.ts` that ends up in the plugin bundle.
 *
 * Tests are excluded and that is not a loophole: the builder bundles the
 * plugin's entry graph, tests are not in it, and they run under vitest with a
 * real `node_modules` where the bare specifier resolves. Five of them import
 * engine values today, quite correctly.
 */
function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) sourceFiles(p, out);
    else if (name.endsWith(".ts") && !name.endsWith(".test.ts")) out.push(p);
  }
  return out;
}

/**
 * Import/export statements naming the engine that are NOT `import type` /
 * `export type`. Matched across lines, because a multi-specifier list is
 * routinely wrapped.
 */
function valueImportsOfEngine(text: string): string[] {
  const found: string[] = [];
  const statement = /(?:^|\n)\s*(import|export)\b([\s\S]*?)from\s+["']([^"']+)["']/gu;
  for (const m of text.matchAll(statement)) {
    if (m[3] !== ENGINE) continue;
    const body = m[2] ?? "";
    /* `import type {...}` and `export type {...}` erase entirely. A list whose
     * every specifier is individually `type X` erases too, but one bare
     * specifier alongside them does not - so check for a non-type specifier
     * rather than for the absence of the word "type". */
    if (/^\s*type\s/u.test(body)) continue;
    const inner = /\{([\s\S]*)\}/u.exec(body)?.[1];
    if (inner !== undefined) {
      const specifiers = inner
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0);
      if (specifiers.every((s) => s.startsWith("type "))) continue;
    }
    found.push(`${m[1]} ... from "${ENGINE}"`);
  }
  return found;
}

describe("only core-api.ts reaches the engine for a runtime value", () => {
  const files = sourceFiles(srcRoot);

  it("finds the package's sources at all", () => {
    /* A census that scanned nothing would pass every assertion below it. */
    expect(files.length).toBeGreaterThan(50);
  });

  it("has exactly one value importer, and it is the funnel", () => {
    const offenders = files
      .filter((f) => valueImportsOfEngine(readFileSync(f, "utf8")).length > 0)
      .map((f) => relative(srcRoot, f).replaceAll("\\", "/"));
    expect(offenders).toEqual([FUNNEL]);
  });

  it("still counts a value import when it sees one", () => {
    /* The regex is the whole guard, so prove it fires on each shape it must
     * catch and stays quiet on each shape it must not. */
    expect(valueImportsOfEngine(`import { FEAT } from "${ENGINE}";`)).toHaveLength(1);
    expect(valueImportsOfEngine(`export { TV } from "${ENGINE}";`)).toHaveLength(1);
    expect(
      valueImportsOfEngine(`import {\n  A,\n  type B,\n} from "${ENGINE}";`),
    ).toHaveLength(1);
    expect(valueImportsOfEngine(`import type { X } from "${ENGINE}";`)).toHaveLength(0);
    expect(valueImportsOfEngine(`export type { X } from "${ENGINE}";`)).toHaveLength(0);
    expect(
      valueImportsOfEngine(`import {\n  type A,\n  type B,\n} from "${ENGINE}";`),
    ).toHaveLength(0);
    expect(valueImportsOfEngine(`import { FEAT } from "./core-api.js";`)).toHaveLength(0);
  });
});
