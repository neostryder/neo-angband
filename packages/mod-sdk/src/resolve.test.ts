import { describe, expect, it } from "vitest";
import type { PackManifest } from "./manifest.js";
import { resolveLoadOrder, ResolveError } from "./resolve.js";

/** Build a minimal manifest for resolver tests; only set the fields these tests need. */
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
  it("orders dependencies first, breaking ties by the caller's input order", () => {
    /* zeta is listed before alpha and neither depends on the other, so zeta
     * loads first - the resolver must not re-alphabetise the caller's list. */
    const order = resolveLoadOrder([
      manifest("core"),
      manifest("zeta", { dependencies: { core: "*" } }),
      manifest("alpha", { dependencies: { core: "*" } }),
      manifest("bridge", { dependencies: { alpha: "*", zeta: "*" } }),
    ]).map((m) => m.id);
    expect(order).toEqual(["core", "zeta", "alpha", "bridge"]);
  });

  it("reverses that order when the caller reverses it", () => {
    /* The companion of the test above, and the one that actually proves the
     * player's reorder reaches the resolver: same packs, same edges, alpha and
     * zeta swapped in the input, and the output swaps with it. Neither order is
     * alphabetical for both runs, so a lexical tie-break fails one of them. */
    const order = resolveLoadOrder([
      manifest("core"),
      manifest("alpha", { dependencies: { core: "*" } }),
      manifest("zeta", { dependencies: { core: "*" } }),
      manifest("bridge", { dependencies: { alpha: "*", zeta: "*" } }),
    ]).map((m) => m.id);
    expect(order).toEqual(["core", "alpha", "zeta", "bridge"]);
  });

  it("keeps the base game first even when a mod's id sorts before it", () => {
    /* A third-party mod that forgets `dependencies: {core: "*"}` used to compose
     * BEFORE the base game purely because "aaa-overhaul" < "core", so core then
     * overwrote it. Nothing pins core explicitly; being first in the caller's
     * list is what does it, which is how every host already builds the list. */
    const order = resolveLoadOrder([
      manifest("core"),
      manifest("aaa-overhaul"),
    ]).map((m) => m.id);
    expect(order).toEqual(["core", "aaa-overhaul"]);
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
    // No edge was created, so the caller's order stands untouched.
    expect(order).toEqual(["zed", "alpha"]);
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
  /* This block used to assert "produces the same order regardless of input array
   * order", which stated the defect as a guarantee: it is exactly the behaviour
   * that made the mod manager's "Move later (loads last, wins conflicts)" row a
   * no-op. Determinism means SAME input -> same output, not ANY input -> same
   * output. The two assertions below are what that actually requires: repeatable
   * for a fixed input, and dependency edges honoured under every input order. */
  const packs = [
    manifest("core"),
    manifest("alpha", { dependencies: { core: "*" } }),
    manifest("zeta", { dependencies: { core: "*" } }),
    manifest("bridge", { dependencies: { alpha: "*", zeta: "*" } }),
    manifest("loose"),
  ];

  const shuffles = [
    [packs[4], packs[3], packs[2], packs[1], packs[0]],
    [packs[2], packs[0], packs[4], packs[3], packs[1]],
    [packs[1], packs[2], packs[3], packs[4], packs[0]],
    [packs[3], packs[1], packs[0], packs[2], packs[4]],
  ] as PackManifest[][];

  it("is repeatable: one input order always yields one output order", () => {
    for (const input of [packs, ...shuffles]) {
      const first = resolveLoadOrder(input).map((m) => m.id);
      for (let again = 0; again < 3; again++) {
        expect(resolveLoadOrder(input).map((m) => m.id)).toEqual(first);
      }
    }
  });

  it("honours every dependency edge under any input order", () => {
    for (const input of [packs, ...shuffles]) {
      const order = resolveLoadOrder(input).map((m) => m.id);
      expect([...order].sort()).toEqual(
        ["alpha", "bridge", "core", "loose", "zeta"],
      );
      const at = (id: string): number => order.indexOf(id);
      /* The edges declared above, checked as edges rather than as one expected
       * sequence - a fixed sequence cannot tell a satisfied graph from an
       * imposed order. */
      expect(at("core")).toBeLessThan(at("alpha"));
      expect(at("core")).toBeLessThan(at("zeta"));
      expect(at("alpha")).toBeLessThan(at("bridge"));
      expect(at("zeta")).toBeLessThan(at("bridge"));
    }
  });

  it("lets the input order decide between two packs the graph leaves free", () => {
    /* alpha and zeta are siblings under core with no edge between them, so the
     * caller - the player's list, or load-order.json - is what decides. */
    const core = manifest("core");
    const alpha = manifest("alpha", { dependencies: { core: "*" } });
    const zeta = manifest("zeta", { dependencies: { core: "*" } });
    expect(resolveLoadOrder([core, alpha, zeta]).map((m) => m.id)).toEqual([
      "core",
      "alpha",
      "zeta",
    ]);
    expect(resolveLoadOrder([core, zeta, alpha]).map((m) => m.id)).toEqual([
      "core",
      "zeta",
      "alpha",
    ]);
  });
});
