import { describe, expect, it } from "vitest";
import type { PackManifest } from "./manifest.js";
import { resolveLoadOrder, ResolveError } from "./resolve.js";

/** Build a minimal manifest for resolver tests; only set the fields we need. */
function manifest(
  id: string,
  extra?: Partial<
    Pick<
      PackManifest,
      | "version"
      | "dependencies"
      | "optionalDependencies"
      | "loadAfter"
      | "loadBefore"
    >
  >,
): PackManifest {
  const m: PackManifest = {
    id,
    name: id,
    version: extra?.version ?? "1.0.0",
    shape: "content",
  };
  if (extra?.dependencies) m.dependencies = extra.dependencies;
  if (extra?.optionalDependencies) m.optionalDependencies = extra.optionalDependencies;
  if (extra?.loadAfter) m.loadAfter = extra.loadAfter;
  if (extra?.loadBefore) m.loadBefore = extra.loadBefore;
  return m;
}

describe("resolveLoadOrder: dependency graph", () => {
  it("orders dependencies first with lexicographic ties", () => {
    const order = resolveLoadOrder([
      manifest("zeta", { dependencies: { core: "*" } }),
      manifest("alpha", { dependencies: { core: "*" } }),
      manifest("bridge", { dependencies: { alpha: "*", zeta: "*" } }),
      manifest("core"),
    ]).map((m) => m.id);
    expect(order).toEqual(["core", "alpha", "zeta", "bridge"]);
  });

  it("rejects a missing required dependency", () => {
    expect(() =>
      resolveLoadOrder([manifest("a", { dependencies: { ghost: "*" } })]),
    ).toThrow(ResolveError);
    expect(() =>
      resolveLoadOrder([manifest("a", { dependencies: { ghost: "*" } })]),
    ).toThrow(/requires missing pack ghost/);
  });

  it("rejects a dependency cycle, naming the stuck packs", () => {
    expect(() =>
      resolveLoadOrder([
        manifest("a", { dependencies: { b: "*" } }),
        manifest("b", { dependencies: { a: "*" } }),
      ]),
    ).toThrow(/cycle/);
    try {
      resolveLoadOrder([
        manifest("a", { dependencies: { b: "*" } }),
        manifest("b", { dependencies: { a: "*" } }),
      ]);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ResolveError);
      expect((err as Error).message).toMatch(/a/);
      expect((err as Error).message).toMatch(/b/);
    }
  });
});

describe("resolveLoadOrder: version ranges", () => {
  it("throws a plain-language error on a required-dependency version mismatch", () => {
    expect(() =>
      resolveLoadOrder([
        manifest("runes", { version: "1.4.0" }),
        manifest("frost", { dependencies: { runes: ">=2.0.0" } }),
      ]),
    ).toThrow(/frost requires runes >=2\.0\.0 but 1\.4\.0 is installed/);
  });

  it("passes when the installed version satisfies the range", () => {
    const order = resolveLoadOrder([
      manifest("runes", { version: "2.3.0" }),
      manifest("frost", { dependencies: { runes: ">=2.0.0" } }),
    ]).map((m) => m.id);
    expect(order).toEqual(["runes", "frost"]);
  });

  it("checks optional-dependency versions only when the pack is present", () => {
    expect(() =>
      resolveLoadOrder([
        manifest("runes", { version: "1.0.0" }),
        manifest("frost", { optionalDependencies: { runes: "^2.0.0" } }),
      ]),
    ).toThrow(/frost requires runes \^2\.0\.0 but 1\.0\.0 is installed/);
  });

  it("skips an absent optional dependency: no error, no ordering constraint", () => {
    const order = resolveLoadOrder([
      manifest("zed", { optionalDependencies: { ghost: "*" } }),
      manifest("alpha"),
    ]).map((m) => m.id);
    // No edge was created, so lexicographic order wins outright.
    expect(order).toEqual(["alpha", "zed"]);
  });

  it("orders a present optional dependency before its dependent", () => {
    const order = resolveLoadOrder([
      manifest("frost", { optionalDependencies: { runes: "*" } }),
      manifest("runes"),
    ]).map((m) => m.id);
    expect(order).toEqual(["runes", "frost"]);
  });
});

describe("resolveLoadOrder: loadAfter / loadBefore", () => {
  it("honors loadAfter among present packs", () => {
    const order = resolveLoadOrder([
      manifest("zed", { loadAfter: ["alpha"] }),
      manifest("alpha"),
    ]).map((m) => m.id);
    expect(order).toEqual(["alpha", "zed"]);
  });

  it("honors loadBefore as the mirror edge", () => {
    const order = resolveLoadOrder([
      manifest("alpha", { loadBefore: ["zed"] }),
      manifest("zed"),
    ]).map((m) => m.id);
    expect(order).toEqual(["alpha", "zed"]);
  });

  it("ignores loadAfter/loadBefore entries naming an absent pack", () => {
    const order = resolveLoadOrder([
      manifest("alpha", { loadAfter: ["ghost"], loadBefore: ["also-ghost"] }),
    ]).map((m) => m.id);
    expect(order).toEqual(["alpha"]);
  });

  it("rejects a cycle created purely from loadAfter/loadBefore hints", () => {
    // a after b (edge b->a) and b after a (edge a->b): a cycle.
    expect(() =>
      resolveLoadOrder([
        manifest("a", { loadAfter: ["b"] }),
        manifest("b", { loadAfter: ["a"] }),
      ]),
    ).toThrow(/cycle/);
  });

  it("rejects a cycle created by mixing a hard dependency with a loadAfter hint", () => {
    // a depends on b (b before a), but a also declares loadBefore b (a before b).
    expect(() =>
      resolveLoadOrder([
        manifest("a", { dependencies: { b: "*" }, loadBefore: ["b"] }),
        manifest("b"),
      ]),
    ).toThrow(/cycle/);
  });

  it("does not double-count an edge declared both as a dependency and as loadAfter", () => {
    // Same edge from two sources should not corrupt the Kahn in-degree count.
    const order = resolveLoadOrder([
      manifest("frost", {
        dependencies: { runes: "*" },
        loadAfter: ["runes"],
      }),
      manifest("runes"),
    ]).map((m) => m.id);
    expect(order).toEqual(["runes", "frost"]);
  });
});

describe("resolveLoadOrder: determinism", () => {
  it("produces the same order regardless of input array order", () => {
    const packs = [
      manifest("core"),
      manifest("alpha", { dependencies: { core: "*" } }),
      manifest("zeta", { dependencies: { core: "*" } }),
      manifest("bridge", { dependencies: { alpha: "*", zeta: "*" } }),
      manifest("loose"),
    ];

    const baseline = resolveLoadOrder(packs).map((m) => m.id);

    // A handful of shuffles of the same manifest set.
    const shuffles = [
      [packs[4], packs[3], packs[2], packs[1], packs[0]],
      [packs[2], packs[0], packs[4], packs[3], packs[1]],
      [packs[1], packs[2], packs[3], packs[4], packs[0]],
      [packs[3], packs[1], packs[0], packs[2], packs[4]],
    ];
    for (const shuffled of shuffles) {
      expect(
        resolveLoadOrder(shuffled as PackManifest[]).map((m) => m.id),
      ).toEqual(baseline);
    }
  });
});
