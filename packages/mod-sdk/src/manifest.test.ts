import { describe, expect, it } from "vitest";
import { manifestFields, validateManifest } from "./manifest.js";

const bare = { id: "sample", name: "Sample", version: "1.0.0", shape: "content" };

describe("manifestFields", () => {
  it("unwraps supported manifest documents and preserves bare manifests", () => {
    expect(manifestFields(bare)).toEqual(bare);
    expect(manifestFields({ format: "neo-angband/mod/manifest", schemaVersion: 1, data: bare })).toEqual(bare);
    expect(validateManifest({ format: "neo-angband/mod/manifest", schemaVersion: 1, data: bare })).toEqual(validateManifest(bare));
  });

  it("rejects malformed manifest documents", () => {
    expect(manifestFields({ format: "neo-angband/mod/manifest", schemaVersion: 2, data: bare })).toBeUndefined();
    expect(manifestFields({ format: "neo-angband/mod/manifest", schemaVersion: 1, extra: true, data: bare })).toBeUndefined();
    expect(manifestFields({ format: "neo-angband/mod/manifest", schemaVersion: 1, data: [] })).toBeUndefined();
  });
});
