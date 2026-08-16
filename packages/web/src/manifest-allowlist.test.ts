/**
 * `modManifest` (pack.ts) is an ALLOWLIST, and an allowlist that falls behind
 * its type is a feature that does not exist.
 *
 * Every mod that is DISCOVERED rather than hand-built - a bundled mod, a mod in
 * the player's folder, a mod installed from a repository - reaches the rest of
 * the host through that function. A PackManifest field it forgets to copy is a
 * field an author can write, the validator will accept, and nothing will ever
 * read. The function's own comment records this happening once already, to
 * `optionalDependencies`, `loadAfter` and `loadBefore`: all three ordering
 * inputs reached resolveLoadOrder as undefined for every discovered mod.
 *
 * It happened again immediately with `sections`, `group` and `compat` - the
 * three fields the whole compatibility model is built on - which is why this
 * census exists rather than another careful review.
 *
 * The field list is PARSED OUT OF THE INTERFACE rather than written down here,
 * so a field added to PackManifest joins the census by existing. A hand-written
 * list would be a second allowlist to forget.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { modManifest } from "./pack";

/**
 * Every member name declared on the PackManifest interface, from its source.
 *
 * Read by WORKSPACE PATH, not by resolving the package: `exports` does not
 * publish `./src/manifest.ts` and refuses the subpath outright. This is a
 * source census over a sibling package in the same repo, which is the one case
 * where reaching past the package boundary is the right answer - the published
 * `.d.ts` would work too, but it is a build artefact, so a stale one would make
 * the census pass against the wrong list.
 */
function packManifestFields(): string[] {
  const here = dirname(fileURLToPath(import.meta.url));
  const source = readFileSync(resolve(here, "../../mod-sdk/src/manifest.ts"), "utf8");
  return fieldsOf(source, "PackManifest");
}

/** Member names of one interface in `source`, ignoring comments. */
export function fieldsOf(source: string, name: string): string[] {
  const at = source.indexOf(`export interface ${name} {`);
  if (at === -1) throw new Error(`interface ${name} not found`);
  /* Brace-matched from the opening brace, so a nested object type inside a
   * member does not end the scan early. */
  const open = source.indexOf("{", at);
  let depth = 0;
  let end = open;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const body = source
    .slice(open + 1, end)
    /* Strip block and line comments first: a doc comment mentioning `foo?:` in
     * prose would otherwise be counted as a member. */
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "");

  const fields: string[] = [];
  let depthIn = 0;
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (depthIn === 0) {
      const m = /^([A-Za-z_$][\w$]*)\??\s*:/.exec(line);
      if (m?.[1]) fields.push(m[1]);
    }
    depthIn += (line.match(/[{[]/g) ?? []).length - (line.match(/[}\]]/g) ?? []).length;
    if (depthIn < 0) depthIn = 0;
  }
  return fields;
}

describe("fieldsOf (the scanner's own self-test)", () => {
  /* A census whose scanner is wrong reports a clean sweep of nothing. */
  it("finds top-level members and ignores nested ones", () => {
    const src = `export interface Thing {
  /** a doc comment mentioning fake?: string */
  alpha: string;
  beta?: number;
  nested?: {
    inner: string;
    alsoInner?: boolean;
  };
  gamma: boolean;
}`;
    expect(fieldsOf(src, "Thing")).toEqual(["alpha", "beta", "nested", "gamma"]);
  });

  it("ignores a member name that only appears in a line comment", () => {
    const src = `export interface Thing {
  // ghost: string
  real: string;
}`;
    expect(fieldsOf(src, "Thing")).toEqual(["real"]);
  });

  it("throws rather than returning nothing for an interface it cannot find", () => {
    expect(() => fieldsOf("", "Missing")).toThrow(/not found/);
  });
});

describe("modManifest copies every PackManifest field", () => {
  /** A truthy, defined value for each field - modManifest copies, never validates. */
  function populated(fields: readonly string[]): Record<string, unknown> {
    const raw: Record<string, unknown> = {};
    for (const f of fields) raw[f] = SAMPLES[f] ?? "x";
    return raw;
  }

  const SAMPLES: Record<string, unknown> = {
    id: "frost",
    name: "Frost",
    version: "1.0.0",
    shape: "content",
    facets: ["content"],
    dependencies: { core: "*" },
    optionalDependencies: { runes: "*" },
    loadAfter: ["runes"],
    loadBefore: ["mist"],
    saveSchema: 2,
    capabilities: ["command:add"],
    fields: [{ name: "bleed", files: ["object"], type: "object" }],
    modApi: 1,
    rules: [{ flag: "f", title: "t", description: "d", default: true }],
    sections: [{ id: "s", title: "S" }],
    compat: [{ with: "runes", claim: "conflicts", because: "why" }],
    tilePacks: [{ grafID: 2 }],
    nondeterministic: true,
    affectsGameplay: true,
    screenshots: ["a.png"],
  };

  it("drops nothing", () => {
    const fields = packManifestFields();
    expect(fields.length).toBeGreaterThan(15); // the scanner found a real interface
    const out = modManifest(populated(fields)) as unknown as Record<string, unknown>;
    const missing = fields.filter((f) => out[f] === undefined);
    expect(missing).toEqual([]);
  });

  it("names the three compatibility fields explicitly, since they died here once", () => {
    const out = modManifest({
      id: "frost",
      name: "Frost",
      version: "1.0.0",
      shape: "content",
      sections: [{ id: "s", title: "S" }],
      group: "cosmetic",
      compat: [{ with: "runes", claim: "conflicts", because: "why" }],
    });
    expect(out.sections).toEqual([{ id: "s", title: "S" }]);
    expect(out.group).toBe("cosmetic");
    expect(out.compat).toHaveLength(1);
  });

  it("still omits a field the manifest does not carry, rather than inventing it", () => {
    const out = modManifest({ id: "bare", name: "Bare", version: "1.0.0", shape: "content" });
    expect(out.sections).toBeUndefined();
    expect(out.group).toBeUndefined();
    expect(out.compat).toBeUndefined();
    expect(out.rules).toBeUndefined();
  });
});
