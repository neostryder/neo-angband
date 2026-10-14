import { describe, expect, it } from "vitest";
import { publicModList } from "./mod-list";
import type { PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";

const manifest = (id: string, publicFlags?: string[]): PackManifest => ({
  id, name: id, version: "1.0.0", shape: "plugin", ...(publicFlags ? { publicFlags } : {}),
});

describe("public mod list", () => {
  it("reads the loaded enabled set and excludes private settings", () => {
    const manifests = new Map([
      ["interface", manifest("interface")],
      ["qol", manifest("qol", ["qol.autoDig"])],
      ["disabled", manifest("disabled")],
    ]);
    const flags = new Map([["qol", { "qol.autoDig": true, "qol.private": false }]]);
    expect(publicModList([], manifests, new Set(), flags)).toEqual([]);
    const first = publicModList(["interface", "qol", "disabled"], manifests, new Set(["interface", "qol"]), flags);
    expect(first).toEqual([
      { id: "interface", version: "1.0.0" },
      { id: "qol", version: "1.0.0", flags: { "qol.autoDig": true } },
    ]);
    expect(JSON.stringify(first)).not.toContain("private");
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(first[1]?.flags)).toBe(true);
    const changed = publicModList(["qol"], manifests, new Set(["qol"]), new Map([["qol", { "qol.autoDig": false }]]));
    expect(changed[0]?.flags).toEqual({ "qol.autoDig": false });
    const afterReload = publicModList(["interface"], manifests, new Set(["interface"]), flags);
    expect(afterReload).toEqual([{ id: "interface", version: "1.0.0" }]);
    expect(first).toHaveLength(2);
  });
});
