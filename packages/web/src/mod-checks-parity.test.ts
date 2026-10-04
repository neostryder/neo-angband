/**
 * The SDK's fixed checks carry their own copies of the installer's limits and
 * payload filter, because the SDK cannot import the game. These tests keep the
 * copies equal to the game's, so a mod the author's checker passes is a mod
 * the installer accepts.
 */

import { ARCHIVE_LIMITS, isPayloadPath as sdkIsPayloadPath } from "@rpgm-tools/neo-angband-mod-sdk";
import { describe, expect, it } from "vitest";

import { ZIP_LIMITS } from "./mod-archive";
import { isPayloadPath } from "./mod-source";

describe("the fixed checks use the installer's own limits", () => {
  it("has the same archive limits", () => {
    expect({ ...ARCHIVE_LIMITS }).toEqual({ ...ZIP_LIMITS });
  });

  it("filters a repository into the same payload", () => {
    const paths = [
      "manifest.json",
      "plugin.js",
      "README.md",
      ".github/workflows/ci.yml",
      ".gitignore",
      "node_modules/acorn/package.json",
      "tools/build.mjs",
      "package.json",
      "package-lock.json",
      "tsconfig.json",
      "tsconfig.build.json",
      "vitest.config.ts",
      "src/plugin.ts",
      "data/spawns.json",
      "dist/pack.zip",
      "docs/tools/notes.md",
    ];
    for (const path of paths) expect(sdkIsPayloadPath(path), path).toBe(isPayloadPath(path));
  });
});
