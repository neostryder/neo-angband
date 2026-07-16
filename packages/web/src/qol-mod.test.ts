/**
 * The bundled qol content mod's DATA + its pack.ts passthrough.
 *
 * Ties the on-disk mod (packages/web/mods/qol/) to the zero-rules-changes
 * guarantee: every option it presets must be an INTERFACE option (never a
 * BIRTH / CHEAT / SCORE option), so filterInterfaceOverrides is a no-op on
 * clean mod data. Also exercises loadComposedInterfaceDefaults, the pack.ts
 * accessor the host threads into startGame.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OPTION_ENTRIES, filterInterfaceOverrides } from "@neo-angband/core";
import { loadComposedInterfaceDefaults } from "./pack";

const OPTION_TYPE = new Map<string, string>(
  OPTION_ENTRIES.map((e) => [e.name, e.type]),
);

function readQolOptionDefaults(): Record<string, boolean> {
  const raw = JSON.parse(
    readFileSync(new URL("../mods/qol/options.json", import.meta.url), "utf8"),
  ) as { records?: { interfaceDefaults?: Record<string, boolean> }[] };
  const out: Record<string, boolean> = {};
  for (const rec of raw.records ?? []) {
    Object.assign(out, rec.interfaceDefaults ?? {});
  }
  return out;
}

describe("qol mod data (zero rules changes)", () => {
  it("the manifest is a bundled content mod credited to the handle only", () => {
    const m = JSON.parse(
      readFileSync(new URL("../mods/qol/manifest.json", import.meta.url), "utf8"),
    ) as Record<string, string>;
    expect(m.id).toBe("qol");
    expect(m.shape).toBe("content");
    expect(m.author).toBe("neostryder (RPGM Tools)");
    expect(m.license).toBe("GPL-2.0-only");
  });

  it("every preset option exists and is an INTERFACE option (never BIRTH/CHEAT/SCORE)", () => {
    const defaults = readQolOptionDefaults();
    expect(Object.keys(defaults).length).toBeGreaterThan(0);
    for (const [name, value] of Object.entries(defaults)) {
      expect(typeof value).toBe("boolean");
      expect(OPTION_TYPE.get(name)).toBe("INTERFACE");
    }
  });

  it("the mod's data survives the core defensive filter unchanged (it is clean)", () => {
    const defaults = readQolOptionDefaults();
    expect(filterInterfaceOverrides(defaults)).toEqual(defaults);
  });
});

describe("loadComposedInterfaceDefaults (pack.ts passthrough)", () => {
  it("surfaces the qol mod's interface defaults (default-on, discovered)", () => {
    const composed = loadComposedInterfaceDefaults();
    const onDisk = readQolOptionDefaults();
    for (const [name, value] of Object.entries(onDisk)) {
      expect(composed[name]).toBe(value);
    }
  });
});
