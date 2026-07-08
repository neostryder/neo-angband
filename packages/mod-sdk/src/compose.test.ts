import { describe, expect, it } from "vitest";
import { composePacks, mergePatch } from "./compose.js";
import type { PackContent } from "./compose.js";
import { packRef, slugify, validateManifest } from "./manifest.js";
import type { PackManifest } from "./manifest.js";
import { resolveLoadOrder } from "./resolve.js";

function manifest(id: string, deps?: Record<string, string>): PackManifest {
  const m: PackManifest = { id, name: id, version: "1.0.0", shape: "content" };
  if (deps) m.dependencies = deps;
  return m;
}

const core: PackContent = {
  manifest: manifest("core"),
  files: {
    monster: {
      records: [
        { name: "Kobold", hp: 8, flags: ["EVIL"], blows: [{ method: "HIT" }] },
        { name: "Grip, Farmer Maggot's Dog", hp: 5 },
      ],
    },
  },
};

describe("manifest", () => {
  it("validates and rejects", () => {
    expect(() => validateManifest(manifest("my-pack"))).not.toThrow();
    expect(() => validateManifest({ ...manifest("Bad_ID") })).toThrow();
    expect(() =>
      validateManifest({ ...manifest("ok"), version: "1.0" }),
    ).toThrow();
    expect(() =>
      validateManifest({ ...manifest("ok"), shape: "weird" }),
    ).toThrow();
  });

  it("slugs names into stable refs", () => {
    expect(slugify("Grip, Farmer Maggot's Dog")).toBe(
      "grip-farmer-maggot-s-dog",
    );
    expect(packRef("core", "Kobold")).toBe("core:kobold");
  });
});

describe("resolveLoadOrder", () => {
  it("orders dependencies first with lexicographic ties", () => {
    const order = resolveLoadOrder([
      manifest("zeta", { core: "*" }),
      manifest("alpha", { core: "*" }),
      manifest("bridge", { alpha: "*", zeta: "*" }),
      manifest("core"),
    ]).map((m) => m.id);
    expect(order).toEqual(["core", "alpha", "zeta", "bridge"]);
  });

  it("rejects missing deps, duplicates, and cycles", () => {
    expect(() =>
      resolveLoadOrder([manifest("a", { ghost: "*" })]),
    ).toThrow(/missing pack ghost/);
    expect(() =>
      resolveLoadOrder([manifest("a"), manifest("a")]),
    ).toThrow(/duplicate/);
    expect(() =>
      resolveLoadOrder([manifest("a", { b: "*" }), manifest("b", { a: "*" })]),
    ).toThrow(/cycle/);
  });
});

describe("mergePatch", () => {
  it("merges objects, replaces arrays and scalars, null deletes", () => {
    const merged = mergePatch(
      { a: 1, nest: { x: 1, y: 2 }, list: [1, 2], gone: "bye" },
      { a: 2, nest: { y: 3 }, list: [9], gone: null },
    );
    expect(merged).toEqual({ a: 2, nest: { x: 1, y: 3 }, list: [9] });
  });
});

describe("composePacks", () => {
  it("adds, patches, replaces, and removes with provenance", () => {
    const mod: PackContent = {
      manifest: manifest("frost", { core: "*" }),
      files: {
        monster: {
          records: [{ name: "Frost Wyrm", hp: 400 }],
          patches: { "core:kobold": { hp: 12, flags: ["EVIL", "COLD"] } },
          removes: ["core:grip-farmer-maggot-s-dog"],
        },
      },
    };
    const game = composePacks([core, mod]);
    const monsters = game.get("monster");
    expect(monsters).toBeDefined();
    if (!monsters) return;

    expect([...monsters.keys()]).toEqual(["core:kobold", "frost:frost-wyrm"]);
    const kobold = monsters.get("core:kobold");
    expect(kobold?.value["hp"]).toBe(12);
    expect(kobold?.value["flags"]).toEqual(["EVIL", "COLD"]);
    expect(kobold?.value["blows"]).toEqual([{ method: "HIT" }]);
    expect(kobold?.owner).toBe("core");
    expect(kobold?.modifiedBy).toEqual(["frost"]);
    expect(monsters.get("frost:frost-wyrm")?.owner).toBe("frost");
  });

  it("total conversion: replacing core wholesale is supported", () => {
    const tc: PackContent = {
      manifest: manifest("total", { core: "*" }),
      files: {
        monster: {
          replaces: { "core:kobold": { name: "Kobold", hp: 999 } },
          removes: ["core:grip-farmer-maggot-s-dog"],
        },
      },
    };
    const monsters = composePacks([core, tc]).get("monster");
    expect(monsters?.size).toBe(1);
    expect(monsters?.get("core:kobold")?.value["hp"]).toBe(999);
    expect(monsters?.get("core:kobold")?.value["flags"]).toBeUndefined();
  });

  it("enforces the dependency-ownership rule", () => {
    const sneaky: PackContent = {
      manifest: manifest("sneaky"), // no dependency on core declared
      files: { monster: { patches: { "core:kobold": { hp: 1 } } } },
    };
    expect(() => composePacks([core, sneaky])).toThrow(
      /without declaring core/,
    );
  });

  it("rejects unknown targets and duplicate adds", () => {
    const bad: PackContent = {
      manifest: manifest("bad", { core: "*" }),
      files: { monster: { patches: { "core:nope": { hp: 1 } } } },
    };
    expect(() => composePacks([core, bad])).toThrow(/does not exist/);

    const dup: PackContent = {
      manifest: manifest("dup", { core: "*" }),
      files: {
        monster: { records: [{ name: "Same" }, { name: "Same" }] },
      },
    };
    expect(() => composePacks([core, dup])).toThrow(/duplicate record/);
  });
});
