import { describe, expect, it } from "vitest";
import { composeContentPacks } from "./loader.js";
import type { LoadedPack } from "./loader.js";
import type { PackManifest } from "./manifest.js";

function manifest(id: string, deps?: Record<string, string>): PackManifest {
  const m: PackManifest = { id, name: id, version: "1.0.0", shape: "content" };
  if (deps) m.dependencies = deps;
  return m;
}

/** A minimal core pack: named monster records + a nameless config file. */
function corePack(): LoadedPack {
  return {
    manifest: manifest("core"),
    files: {
      monster: {
        records: [
          { name: "Kobold", hp: 8, flags: ["EVIL"] },
          { name: "Grip, Farmer Maggot's Dog", hp: 5 },
        ],
      },
      // nameless / index-keyed: not per-record addressable -> passthrough
      names: { records: [{ section: 2, word: ["foo", "bar"] }] },
    },
  };
}

describe("composeContentPacks", () => {
  it("is record-identical (by reference and order) for the base game alone", () => {
    const core = corePack();
    const composed = composeContentPacks([core]);

    // Same objects, same order - routing pack zero through compose is a no-op.
    expect(composed.records["monster"]).toEqual(core.files["monster"]?.records);
    expect(composed.records["monster"]?.[0]).toBe(
      core.files["monster"]?.records?.[0],
    );
    expect(composed.records["monster"]?.[1]).toBe(
      core.files["monster"]?.records?.[1],
    );
    expect(composed.composedFiles).toContain("monster");
    expect(composed.passthroughFiles).toContain("names");
  });

  it("adds a mod's new records after core's, in load order", () => {
    const mod: LoadedPack = {
      manifest: manifest("beasts", { core: "*" }),
      files: { monster: { records: [{ name: "Frost Wyrm", hp: 400 }] } },
    };
    const composed = composeContentPacks([mod, corePack()]); // deliberately mod-first
    const names = (composed.records["monster"] as { name: string }[]).map(
      (m) => m.name,
    );
    expect(names).toEqual(["Kobold", "Grip, Farmer Maggot's Dog", "Frost Wyrm"]);
  });

  it("applies a mod's coarse patch to a core record", () => {
    const mod: LoadedPack = {
      manifest: manifest("buff", { core: "*" }),
      files: { monster: { patches: { "core:kobold": { hp: 99 } } } },
    };
    const composed = composeContentPacks([corePack(), mod]);
    const kobold = (composed.records["monster"] as { name: string; hp: number }[]).find(
      (m) => m.name === "Kobold",
    );
    expect(kobold?.hp).toBe(99);
  });

  it("applies a mod's field patch to a core record", () => {
    const mod: LoadedPack = {
      manifest: manifest("tweak", { core: "*" }),
      files: {
        monster: {
          fieldPatches: { "core:kobold": [{ op: "add", path: "hp", value: 5 }] },
        },
      },
    };
    const composed = composeContentPacks([corePack(), mod]);
    const kobold = (composed.records["monster"] as { name: string; hp: number }[]).find(
      (m) => m.name === "Kobold",
    );
    expect(kobold?.hp).toBe(13); // 8 + 5
  });

  it("applies a mod's removal of a core record", () => {
    const mod: LoadedPack = {
      manifest: manifest("cull", { core: "*" }),
      files: { monster: { removes: ["core:grip-farmer-maggot-s-dog"] } },
    };
    const composed = composeContentPacks([corePack(), mod]);
    const names = (composed.records["monster"] as { name: string }[]).map(
      (m) => m.name,
    );
    expect(names).toEqual(["Kobold"]);
  });

  it("passes nameless files through last-in-load-order-wins", () => {
    const mod: LoadedPack = {
      manifest: manifest("renamer", { core: "*" }),
      files: { names: { records: [{ section: 2, word: ["zap"] }] } },
    };
    const composed = composeContentPacks([corePack(), mod]);
    expect(composed.records["names"]).toEqual([{ section: 2, word: ["zap"] }]);
    expect(composed.passthroughFiles).toContain("names");
  });

  it("falls back to passthrough (no throw) when record names collide", () => {
    const dupCore: LoadedPack = {
      manifest: manifest("core"),
      files: {
        object: {
          records: [
            { name: "Torch", tval: "light" },
            { name: "Torch", tval: "light" }, // colliding slug
          ],
        },
      },
    };
    const composed = composeContentPacks([dupCore]);
    expect(composed.passthroughFiles).toContain("object");
    expect(composed.records["object"]).toHaveLength(2);
  });
});
