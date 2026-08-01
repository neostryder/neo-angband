import { describe, expect, it } from "vitest";
import type { PackManifest } from "./manifest.js";
import { collectSortEdges, sortModOrder, SORT_TIERS } from "./sort.js";

function manifest(id: string, extra: Partial<PackManifest> = {}): PackManifest {
  return { id, name: id, version: "1.0.0", shape: "content", ...extra };
}

/** Just the ids, for readable expectations. */
const order = (...args: Parameters<typeof sortModOrder>): string[] =>
  sortModOrder(...args).order;

describe("sortModOrder: it returns a complete permutation", () => {
  it("keeps every pack exactly once", () => {
    const packs = [manifest("a"), manifest("b"), manifest("c")];
    expect(order(packs).sort()).toEqual(["a", "b", "c"]);
  });

  it("handles an empty set", () => {
    expect(sortModOrder([])).toEqual({ order: [], dropped: [], unresolvable: [] });
  });

  /* A sort that reshuffles packs it had no reason to move is one the player
   * cannot check, and an unreviewable proposal is one they decline. */
  it("leaves an unconstrained set in its current order", () => {
    const packs = [manifest("a"), manifest("b"), manifest("c")];
    expect(order(packs, { current: ["c", "a", "b"] })).toEqual(["c", "a", "b"]);
  });

  it("puts a pack the current order does not mention at the end, not the front", () => {
    const packs = [manifest("a"), manifest("new"), manifest("b")];
    expect(order(packs, { current: ["a", "b"] })).toEqual(["a", "b", "new"]);
  });
});

describe("sortModOrder: the tiers", () => {
  it("puts a dependency before its dependent whatever the current order says", () => {
    const packs = [manifest("lib"), manifest("app", { dependencies: { lib: "*" } })];
    expect(order(packs, { current: ["app", "lib"] })).toEqual(["lib", "app"]);
  });

  it("orders by group when nothing else applies", () => {
    const packs = [
      manifest("skin", { group: "cosmetic" }),
      manifest("base", { group: "framework" }),
    ];
    expect(order(packs, { current: ["skin", "base"] })).toEqual(["base", "skin"]);
  });

  it("honours loadAfter", () => {
    const packs = [manifest("a", { loadAfter: ["b"] }), manifest("b")];
    expect(order(packs, { current: ["a", "b"] })).toEqual(["b", "a"]);
  });

  it("honours loadBefore as the mirror of loadAfter", () => {
    const packs = [manifest("a"), manifest("b", { loadBefore: ["a"] })];
    expect(order(packs, { current: ["a", "b"] })).toEqual(["b", "a"]);
  });

  it("lets a player pin beat an author's hint", () => {
    const packs = [manifest("a", { loadAfter: ["b"] }), manifest("b")];
    const r = sortModOrder(packs, { pins: [{ id: "a", before: ["b"] }] });
    expect(r.order).toEqual(["a", "b"]);
    expect(r.dropped.map((d) => d.tier)).toEqual(["author"]);
  });

  it("lets a hard dependency beat a player pin", () => {
    const packs = [manifest("lib"), manifest("app", { dependencies: { lib: "*" } })];
    const r = sortModOrder(packs, { pins: [{ id: "app", before: ["lib"] }] });
    expect(r.order).toEqual(["lib", "app"]);
    expect(r.dropped.map((d) => d.tier)).toEqual(["player"]);
  });

  it("lets an author hint beat a group", () => {
    const packs = [
      manifest("skin", { group: "cosmetic", loadBefore: ["base"] }),
      manifest("base", { group: "framework" }),
    ];
    const r = sortModOrder(packs);
    expect(r.order).toEqual(["skin", "base"]);
    expect(r.dropped.map((d) => d.tier)).toEqual(["group"]);
  });

  it("ranks the tiers strongest-first", () => {
    expect(SORT_TIERS).toEqual(["hard", "player", "author", "group"]);
  });
});

describe("sortModOrder: compat claims", () => {
  const claiming = (claim: "prefer-mine" | "prefer-theirs", range?: string) =>
    manifest("frost", {
      compat: [
        { with: "runes", claim, because: "We both set kobold speed.", ...(range ? { range } : {}) },
      ],
    });

  /* Later wins, so "mine should win" means mine loads AFTER theirs. */
  it("prefer-mine puts the claimant last", () => {
    expect(order([claiming("prefer-mine"), manifest("runes")], { current: ["frost", "runes"] })).toEqual([
      "runes",
      "frost",
    ]);
  });

  it("prefer-theirs puts the claimant first", () => {
    expect(order([claiming("prefer-theirs"), manifest("runes")], { current: ["runes", "frost"] })).toEqual([
      "frost",
      "runes",
    ]);
  });

  it("ignores a claim whose range does not cover the installed version", () => {
    const packs = [claiming("prefer-mine", "<2.0.0"), manifest("runes", { version: "3.0.0" })];
    expect(order(packs, { current: ["frost", "runes"] })).toEqual(["frost", "runes"]);
  });

  it("applies a claim whose range does cover it", () => {
    const packs = [claiming("prefer-mine", "<2.0.0"), manifest("runes", { version: "1.4.0" })];
    expect(order(packs, { current: ["frost", "runes"] })).toEqual(["runes", "frost"]);
  });

  /* A typo in a claim about someone else's mod must not throw and must not
   * silently decide the order. */
  it("ignores a claim with an unparseable range instead of throwing", () => {
    const packs = [claiming("prefer-mine", "gibberish"), manifest("runes")];
    expect(() => sortModOrder(packs)).not.toThrow();
    expect(order(packs, { current: ["frost", "runes"] })).toEqual(["frost", "runes"]);
  });

  it("ignores a claim about a pack that is not installed", () => {
    expect(order([claiming("prefer-mine")])).toEqual(["frost"]);
  });

  it("carries the author's reason into the edge, for the player to read", () => {
    const edges = collectSortEdges([claiming("prefer-mine"), manifest("runes")]);
    const claim = edges.find((e) => e.tier === "author");
    expect(claim?.reason).toContain("We both set kobold speed.");
  });

  it("names the scope in the reason when the claim has one", () => {
    const scoped = manifest("frost", {
      sections: [{ id: "kobolds", title: "K" }],
      compat: [
        { with: "runes", claim: "prefer-mine", scope: ["kobolds"], because: "speed." },
      ],
    });
    const edges = collectSortEdges([scoped, manifest("runes")]);
    expect(edges.find((e) => e.tier === "author")?.reason).toContain("kobolds");
  });

  it("makes no ordering edge for conflicts or patches claims", () => {
    for (const claim of ["conflicts", "patches"] as const) {
      const m = manifest("frost", {
        sections: [{ id: "s", title: "S" }],
        compat: [{ with: "runes", claim, scope: ["s"], because: "why" }],
      });
      const edges = collectSortEdges([m, manifest("runes")]);
      expect(edges.filter((e) => e.tier === "author")).toEqual([]);
    }
  });
});

describe("sortModOrder: a cycle is a decision, not a failure", () => {
  /* THE CASE THIS WHOLE TIER EXISTS FOR. loadAfter/loadBefore used to be hard
   * edges, so two mods each claiming priority produced "dependency cycle among
   * packs" and the entire set refused to launch - with neither author having
   * done anything unreasonable. */
  it("resolves two mods that each demand to load last", () => {
    const packs = [manifest("a", { loadAfter: ["b"] }), manifest("b", { loadAfter: ["a"] })];
    const r = sortModOrder(packs, { current: ["a", "b"] });
    expect(r.order.sort()).toEqual(["a", "b"]);
    expect(r.dropped).toHaveLength(1);
    expect(r.unresolvable).toEqual([]);
  });

  it("says which suggestion it dropped and shows the cycle", () => {
    const packs = [manifest("a", { loadAfter: ["b"] }), manifest("b", { loadAfter: ["a"] })];
    const [d] = sortModOrder(packs).dropped;
    expect(d?.reason).toMatch(/asks to load after/);
    expect(d?.cycle.sort()).toEqual(["a", "b"]);
  });

  it("drops the weakest edge in the cycle, not an arbitrary one", () => {
    /* group says base -> skin; the author of skin says the opposite. The GROUP
     * edge is the one nobody wrote about this pair, so it loses. */
    const packs = [
      manifest("base", { group: "framework" }),
      manifest("skin", { group: "cosmetic", loadBefore: ["base"] }),
    ];
    const r = sortModOrder(packs);
    expect(r.dropped.map((d) => d.tier)).toEqual(["group"]);
    expect(r.order).toEqual(["skin", "base"]);
  });

  it("resolves a three-mod cycle", () => {
    const packs = [
      manifest("a", { loadAfter: ["c"] }),
      manifest("b", { loadAfter: ["a"] }),
      manifest("c", { loadAfter: ["b"] }),
    ];
    const r = sortModOrder(packs, { current: ["a", "b", "c"] });
    expect(r.order.sort()).toEqual(["a", "b", "c"]);
    expect(r.dropped).toHaveLength(1);
  });

  /* A hard cycle is a genuinely impossible mod set. The sorter still answers
   * with a complete order so the manager can render the list, and reports it
   * apart from "two authors disagreed and I picked one". */
  it("reports a hard dependency cycle as unresolvable rather than dropping one", () => {
    const packs = [
      manifest("a", { dependencies: { b: "*" } }),
      manifest("b", { dependencies: { a: "*" } }),
    ];
    const r = sortModOrder(packs);
    expect(r.unresolvable).toHaveLength(1);
    expect(r.unresolvable[0]?.sort()).toEqual(["a", "b"]);
    expect(r.dropped).toEqual([]);
    expect(r.order.sort()).toEqual(["a", "b"]);
  });

  it("still terminates when hard and soft cycles are tangled together", () => {
    const packs = [
      manifest("a", { dependencies: { b: "*" }, loadAfter: ["c"] }),
      manifest("b", { dependencies: { a: "*" } }),
      manifest("c", { loadAfter: ["a"] }),
    ];
    const r = sortModOrder(packs);
    expect(r.order.sort()).toEqual(["a", "b", "c"]);
  });
});

describe("sortModOrder: determinism", () => {
  /* The proposal reaches the savefile's mod-set fingerprint, so two machines
   * given the same inputs must drop the same edge and answer the same order. */
  const tangled = [
    manifest("a", { loadAfter: ["b"], group: "tweaks" }),
    manifest("b", { loadAfter: ["c"], group: "content" }),
    manifest("c", { loadAfter: ["a"], group: "cosmetic" }),
    manifest("d", { dependencies: { a: "*" } }),
  ];

  it("gives the same answer every time", () => {
    const first = sortModOrder(tangled, { current: ["d", "c", "b", "a"] });
    for (let i = 0; i < 10; i++) {
      expect(sortModOrder(tangled, { current: ["d", "c", "b", "a"] })).toEqual(first);
    }
  });

  it("drops the same edge every time", () => {
    const first = sortModOrder(tangled).dropped.map((d) => `${d.from}>${d.to}`);
    for (let i = 0; i < 10; i++) {
      expect(sortModOrder(tangled).dropped.map((d) => `${d.from}>${d.to}`)).toEqual(first);
    }
  });

  it("is a fixed point: sorting its own output changes nothing", () => {
    const once = sortModOrder(tangled, { current: ["d", "c", "b", "a"] }).order;
    expect(sortModOrder(tangled, { current: once }).order).toEqual(once);
  });
});

describe("collectSortEdges", () => {
  it("makes no edge for a dependency that is not installed", () => {
    const edges = collectSortEdges([manifest("app", { dependencies: { ghost: "*" } })]);
    expect(edges).toEqual([]);
  });

  it("makes no edge for a pin naming a pack that is not installed", () => {
    const edges = collectSortEdges([manifest("a")], [{ id: "a", after: ["ghost"] }]);
    expect(edges).toEqual([]);
  });

  /* Only between CONSECUTIVE occupied groups: transitivity does the rest, and
   * the all-pairs version is quadratic for no added ordering. */
  it("does not emit all-pairs group edges across a gap", () => {
    const packs = [
      manifest("f", { group: "framework" }),
      manifest("c", { group: "cosmetic" }),
      manifest("l", { group: "late" }),
    ];
    const groups = collectSortEdges(packs).filter((e) => e.tier === "group");
    expect(groups.map((e) => `${e.from}>${e.to}`)).toEqual(["f>c", "c>l"]);
  });

  it("still orders across an empty group by transitivity", () => {
    const packs = [manifest("f", { group: "framework" }), manifest("l", { group: "late" })];
    expect(order(packs, { current: ["l", "f"] })).toEqual(["f", "l"]);
  });

  it("sorts a pack with no group as the default group", () => {
    const packs = [manifest("plain"), manifest("skin", { group: "cosmetic" })];
    expect(order(packs, { current: ["skin", "plain"] })).toEqual(["plain", "skin"]);
  });
});
