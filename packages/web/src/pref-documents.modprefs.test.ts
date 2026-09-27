/**
 * A mod's JSON preference resource runs through the pref grammar as directive
 * lines (#288). These tests pin the lines each format renders to, and check
 * that the real grammar applies them with no errors and that nothing is
 * written into the player's stored preference documents.
 */
import { describe, expect, it } from "vitest";
import {
  autoinscriptionFormat,
  colorTableFormat,
  entryRendererFormat,
  keymapFormat,
  serializeDocument,
  soundMappingFormat,
  subwindowLayoutFormat,
  visualOverrideFormat,
} from "@rpgm-tools/neo-angband-mod-sdk";
import { bindCore, FEAT, GlyphTable, glyphTableSink, processPrefText, type PrefSink } from "@rpgm-tools/neo-angband-core";
import { loadGamePack } from "./pack";
import { modPreferenceText } from "./pref-documents";

describe("modPreferenceText", () => {
  it("renders visual overrides, including message colours", () => {
    const text = modPreferenceText(serializeDocument(visualOverrideFormat, {
      monsters: [{ name: "Kobold", color: 4, glyph: "k" }],
      features: [{ code: "FLOOR", lighting: "all", color: 1, glyph: "." }],
      messages: [{ message: 3, color: 4 }],
    }));
    expect(text).toBe(["monster:Kobold:4:107", "feat:FLOOR:*:1:46", "message:3:Red"].join("\n"));
  });

  it("renders colours in palette order", () => {
    const sample = colorTableFormat.sample!;
    const text = modPreferenceText(serializeDocument(colorTableFormat, sample))!;
    const lines = text.split("\n");
    expect(lines).toHaveLength(sample.colors.length);
    expect(lines[0]).toBe("color:0:0:0:0:0");
  });

  it("renders sounds, auto-inscriptions, entry renderers and keymaps", () => {
    expect(modPreferenceText(serializeDocument(soundMappingFormat, soundMappingFormat.sample)))
      .toBe("sound:HIT:plc_hit_hay plc_hit_body");
    expect(modPreferenceText(serializeDocument(autoinscriptionFormat, autoinscriptionFormat.sample)))
      .toBe("inscribe:potion:Cure Light Wounds:@q1");
    expect(modPreferenceText(serializeDocument(entryRendererFormat, entryRendererFormat.sample)))
      .toBe("entry-renderer:HEALTH:rR:w:*");
    const keys = modPreferenceText(serializeDocument(keymapFormat, keymapFormat.sample))!.split("\n");
    expect(keys[0]!.startsWith("keymap-act:")).toBe(true);
    expect(keys[1]).toBe("keymap-input:0:X");
  });

  it("refuses a subwindow layout, an unknown format and a malformed document", () => {
    expect(modPreferenceText(serializeDocument(subwindowLayoutFormat, subwindowLayoutFormat.sample))).toBeNull();
    expect(modPreferenceText(JSON.stringify({ format: "neo-angband/prefs/nothing", schemaVersion: 1, data: {} }))).toBeNull();
    expect(modPreferenceText("feat:FLOOR:*:1:46")).toBeNull();
    expect(modPreferenceText(JSON.stringify({ format: visualOverrideFormat.format, schemaVersion: 1, data: { monsters: "k" } }))).toBeNull();
  });

  it("applies through the real grammar with no errors and stores nothing", () => {
    const reg = bindCore(loadGamePack());
    const table = new GlyphTable({
      features: reg.features.allFeatures(),
      kinds: reg.objects.kinds,
      races: reg.monsters.races,
      traps: reg.traps,
      flavors: reg.objects.flavors,
    });
    const seen: string[] = [];
    const extra: Partial<PrefSink> = {
      addAutoinscription: (kidx, note) => seen.push(`note ${kidx} ${note}`),
      entryRenderer: (name) => seen.push(`renderer ${name}`),
      sound: (type) => seen.push(`sound ${type}`),
      colorTable: (index) => seen.push(`color ${index}`),
      keymapInput: (mode, trigger) => seen.push(`key ${mode} ${trigger}`),
      messageColor: (index, color) => seen.push(`message ${index} ${color}`),
    };
    const deps = { features: reg.features, objects: reg.objects, monsters: reg.monsters, traps: reg.traps };
    const docs = [
      serializeDocument(visualOverrideFormat, {
        features: [{ code: "FLOOR", lighting: "all", color: 1, glyph: "." }],
        messages: [{ message: 3, color: 4 }],
      }),
      serializeDocument(autoinscriptionFormat, autoinscriptionFormat.sample),
      serializeDocument(entryRendererFormat, entryRendererFormat.sample),
      serializeDocument(soundMappingFormat, soundMappingFormat.sample),
      serializeDocument(colorTableFormat, colorTableFormat.sample),
      serializeDocument(keymapFormat, keymapFormat.sample),
    ];
    for (const doc of docs) {
      expect(processPrefText(modPreferenceText(doc)!, deps, glyphTableSink(table, extra))).toEqual([]);
    }
    expect(table.featGlyph(0, FEAT["FLOOR"] as number)).toEqual({ attr: 1, char: "." });
    expect(seen).toContain("renderer HEALTH");
    expect(seen).toContain("sound HIT");
    expect(seen).toContain("message 3 4");
    expect(seen.some((row) => row.startsWith("note "))).toBe(true);
    expect(seen.some((row) => row.startsWith("key 0 X"))).toBe(true);
    expect(seen.filter((row) => row.startsWith("color "))).toHaveLength(colorTableFormat.sample!.colors.length);
    expect(typeof localStorage === "undefined" || localStorage.length === 0).toBe(true);
  });
});
