/**
 * A mod folder may contribute MORE THAN ONE KIND of thing (mod-sdk facets).
 *
 * WHY THIS FILE EXISTS, because it is the assertion whose absence hid the defect.
 * `shape` was exclusive and the two halves of the loader gated on opposite
 * values: mod-code.ts loaded code only for `shape: "plugin"`, pack.ts composed
 * records only for `shape: "content"`. Both halves had thorough tests. Both
 * passed. Nothing anywhere asserted ONE manifest against BOTH gates, so the
 * folder layout docs/modding/PLUGINS.md promises -
 *
 *     my-mod/  manifest.json  plugin.js  monster.json  tiles/orc.png
 *
 * - could never work, and the way it failed was silent: declare "plugin" and
 * monster.json is dropped from composition while the code loads fine.
 *
 * So every test here drives the two paths TOGETHER. A per-path test cannot find
 * this class of bug no matter how careful it is; only a test that crosses the
 * seam can.
 */

import { describe, expect, it } from "vitest";
import { problemLines } from "./mod-problems";
import {
  composeContentPacks,
  hasFacet,
  packFacets,
  validateManifest,
  ManifestError,
  type LoadedPack,
  type PackManifest,
} from "@rpgm-tools/neo-angband-mod-sdk";
import { loadModCode, PLUGIN_FILE } from "./mod-code";
import { activePackSetFrom } from "./pack";
import type { CodeUrlResolver, DiskPack } from "./disk-packs";
import { MOD_API_VERSION } from "./mod-plugin";

/** The hybrid manifest under test: contributes records AND code. */
function hybridManifest(over: Partial<PackManifest> = {}): PackManifest {
  return {
    id: "orc-overhaul",
    name: "Orc Overhaul",
    version: "1.0.0",
    shape: "content",
    facets: ["content", "plugin"],
    modApi: MOD_API_VERSION,
    dependencies: { core: "*" },
    ...over,
  } as PackManifest;
}

/**
 * The same mod with NO `facets` key at all - the back-compat shape. Written by
 * deleting the key rather than setting it undefined, because
 * exactOptionalPropertyTypes draws exactly that distinction and "absent" is the
 * case under test.
 */
function shapeOnlyManifest(shape: PackManifest["shape"], over: Partial<PackManifest> = {}): PackManifest {
  const m = { ...hybridManifest(over), shape } as Record<string, unknown>;
  delete m["facets"];
  return m as unknown as PackManifest;
}

/** The same mod as the loader sees it: a folder with code AND a record file. */
function hybridPack(manifest: PackManifest): DiskPack {
  return {
    manifest,
    files: { monster: [{ name: "Cave Orc", speed: 110 }] },
    code: [PLUGIN_FILE],
    assets: ["tiles/orc.png"],
  };
}

/** The same mod as the composer sees it: a record contribution. */
function hybridContribution(manifest: PackManifest): LoadedPack {
  return {
    manifest,
    files: {
      monster: {
        fieldPatches: { "core:kobold": [{ op: "add", path: "speed", value: 5 }] },
      },
    },
  } as unknown as LoadedPack;
}

function corePack(): LoadedPack {
  return {
    manifest: { id: "core", name: "Angband", version: "1.0.0", shape: "content" },
    files: { monster: { records: [{ name: "Kobold", speed: 110 }] } },
  } as unknown as LoadedPack;
}

function resolver(): CodeUrlResolver {
  return ((id: string, file: string) =>
    Promise.resolve(`mem://${id}/${file}`)) as CodeUrlResolver;
}

/** A plugin module whose default export is a valid, minimal ModPlugin. */
function pluginModule(): unknown {
  return {
    default: {
      api: MOD_API_VERSION,
      hooks: () => ({}),
    },
  };
}

async function loadOne(pack: DiskPack) {
  return loadModCode({
    packs: [pack],
    codeUrl: resolver(),
    enabled: () => true,
    consented: () => [],
    importer: () => Promise.resolve(pluginModule()),
  });
}

/** The composed speed of core's kobold, which the hybrid's field patch raises. */
function kobold(composed: { records: Record<string, unknown[]> }): unknown {
  const recs = composed.records["monster"] ?? [];
  return (recs.find((r) => (r as { name?: string }).name === "Kobold") as
    | { speed?: unknown }
    | undefined)?.speed;
}

describe("a mod folder that ships code AND records", () => {
  it("loads its code and composes its records from ONE manifest", async () => {
    const manifest = hybridManifest();

    /* Half one: the code gate. Under the exclusive `shape` this manifest said
     * "content", so this was a refusal. */
    const code = await loadOne(hybridPack(manifest));
    expect(code.problems).toEqual([]);
    expect(code.plugins.map((p) => p.id)).toEqual(["orc-overhaul"]);

    /* Half two: the REAL composition gate (pack.ts activePackSetFrom), same
     * manifest. Under the exclusive `shape` the only way to pass the gate above
     * was to say "plugin", and then this dropped the pack before the composer
     * ever saw it - so the patch vanished without a word. Driving the actual
     * selector matters: asserting composeContentPacks alone would have passed
     * against the broken code, because the composer was never the thing filtering. */
    const selected = activePackSetFrom(
      new Map([
        [
          manifest.id,
          {
            manifest: manifest as unknown,
            files: {
              monster: {
                fieldPatches: {
                  "core:kobold": [{ op: "add", path: "speed", value: 5 }],
                },
              },
            } as Record<string, unknown>,
          },
        ],
      ]),
      [manifest.id],
    );
    expect(selected.map((p) => p.manifest.id)).toEqual(["core", "orc-overhaul"]);

    const composed = composeContentPacks([corePack(), hybridContribution(manifest)]);
    expect(composed.problems).toEqual([]);
    expect(kobold(composed)).toBe(115);
  });

  it("drops a plugin-only pack from the record set, and keeps a hybrid in it", () => {
    /* The gate, both directions, through the real selector. */
    const hybrid = hybridManifest();
    const pluginOnly = shapeOnlyManifest("plugin", { id: "code-only" });
    const mods = new Map([
      [hybrid.id, { manifest: hybrid as unknown, files: {} as Record<string, unknown> }],
      [
        pluginOnly.id,
        { manifest: pluginOnly as unknown, files: {} as Record<string, unknown> },
      ],
    ]);
    const ids = activePackSetFrom(mods, [hybrid.id, pluginOnly.id]).map(
      (p) => p.manifest.id,
    );
    expect(ids).toEqual(["core", "orc-overhaul"]);
  });

  it("composes records for a PLUGIN-shaped hybrid too, which is the spelling that broke", async () => {
    /* The other legal spelling, and the one that actually reproduces the bug.
     * `facets` must contain `shape`, so a hybrid may be written either way:
     *
     *   { shape: "content", facets: ["content", "plugin"] }   <- the test above
     *   { shape: "plugin",  facets: ["plugin", "content"] }   <- this one
     *
     * The first slips past the OLD pack.ts gate by accident, because its shape
     * already read "content". Only this one discriminates it: under
     * `shape !== "content"` its records were dropped while its code loaded, which
     * is exactly the silent failure an author shipping a monster with behaviour
     * would have hit. Found by mutation-testing the fix and noticing the pack.ts
     * mutation survived. */
    const manifest = hybridManifest({ shape: "plugin", facets: ["plugin", "content"] });

    const code = await loadOne(hybridPack(manifest));
    expect(code.problems).toEqual([]);
    expect(code.plugins.map((p) => p.id)).toEqual(["orc-overhaul"]);

    const selected = activePackSetFrom(
      new Map([
        [
          manifest.id,
          {
            manifest: manifest as unknown,
            files: {} as Record<string, unknown>,
          },
        ],
      ]),
      [manifest.id],
    );
    expect(selected.map((p) => p.manifest.id)).toEqual(["core", "orc-overhaul"]);
  });

  it("carries its own record files to the plugin as ctx.data", async () => {
    const code = await loadOne(hybridPack(hybridManifest()));
    expect(code.plugins[0]?.data).toEqual({
      monster: [{ name: "Cave Orc", speed: 110 }],
    });
  });

  it("still refuses code when the plugin facet is not declared", async () => {
    /* The consent property, unchanged: shipping plugin.js is not consent to run
     * it. A folder listing must not be able to imply the declaration. */
    const manifest = hybridManifest({ facets: ["content"] });
    const code = await loadOne(hybridPack(manifest));
    expect(code.plugins).toEqual([]);
    expect(code.problems).toHaveLength(1);
    const why = problemLines(code.problems)[0] as string;
    expect(why).toContain("does not declare the \"plugin\" facet");
    /* And the message must name the fix, not just the refusal. */
    expect(why).toContain('"facets": ["content", "plugin"]');
  });

  it("composes nothing for a plugin-only pack, exactly as before", () => {
    /* Back-compat: a manifest with no `facets` behaves as its single shape did. */
    const pluginOnly = shapeOnlyManifest("plugin");
    expect(hasFacet(pluginOnly, "content")).toBe(false);
    expect(hasFacet(pluginOnly, "plugin")).toBe(true);
    expect([...packFacets(pluginOnly)]).toEqual(["plugin"]);
  });

  it("treats a shape-only manifest as exactly that one facet", () => {
    const content = shapeOnlyManifest("content");
    expect([...packFacets(content)]).toEqual(["content"]);
    expect(hasFacet(content, "plugin")).toBe(false);
  });
});

describe("facets validation", () => {
  const base = {
    id: "m",
    name: "M",
    version: "1.0.0",
    shape: "content",
  };

  it("accepts a facets list containing the shape", () => {
    expect(() =>
      validateManifest({ ...base, facets: ["content", "plugin"] }),
    ).not.toThrow();
  });

  it("rejects a facets list that omits the shape", () => {
    /* The invariant that keeps the two fields from contradicting each other -
     * without it every consumer would have to pick which field to trust, which
     * is how the exclusive shape produced a documented-but-impossible layout. */
    expect(() => validateManifest({ ...base, facets: ["plugin"] })).toThrow(
      ManifestError,
    );
    expect(() => validateManifest({ ...base, facets: ["plugin"] })).toThrow(
      /must include its shape "content"/u,
    );
  });

  it("rejects an unknown facet, an empty list, and a duplicate", () => {
    expect(() => validateManifest({ ...base, facets: ["sound"] })).toThrow(
      /facet must be one of/u,
    );
    expect(() => validateManifest({ ...base, facets: [] })).toThrow(
      /non-empty array/u,
    );
    expect(() =>
      validateManifest({ ...base, facets: ["content", "content"] }),
    ).toThrow(/listed twice/u);
  });
});
