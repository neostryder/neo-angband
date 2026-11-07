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
    /* Schema 1 fields inside a schema 2 envelope: no api, no runtime. */
    expect(manifestFields({ format: "neo-angband/mod/manifest", schemaVersion: 2, data: bare })).toBeUndefined();
    expect(manifestFields({ format: "neo-angband/mod/manifest", schemaVersion: 3, data: bare })).toBeUndefined();
    expect(manifestFields({ format: "neo-angband/mod/manifest", schemaVersion: 1, extra: true, data: bare })).toBeUndefined();
    expect(manifestFields({ format: "neo-angband/mod/manifest", schemaVersion: 1, data: [] })).toBeUndefined();
  });
});

it("bounds declared permissions before normalization or consent rendering", () => {
  const capabilities = Array.from({ length: 257 }, (_, index) => "event:test-" + index);
  expect(() => validateManifest({ ...bare, capabilities })).toThrow();
  expect(() => validateManifest({ format: "neo-angband/mod/manifest", schemaVersion: 2,
    data: { ...bare, shape: "plugin", api: ">=2.0.0 <3.0.0", runtime: "worker", entry: "worker.js", capabilities } })).toThrow();
});
