import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  colorTableFormat,
  keymapFormat,
  parseDocument,
  soundMappingFormat,
  subwindowLayoutFormat,
  visualOverrideFormat,
} from "@rpgm-tools/neo-angband-mod-sdk";
import {
  HostDir,
  MemoryHost,
  NULL_HOST,
  colorChannel,
  resetColorTable,
  setHost,
  type GlyphTable,
  type PrefDeps,
} from "@rpgm-tools/neo-angband-core";
import { clearKeymaps, keymapFind } from "./keymap-store";
import { convertStoredUserPrefFiles } from "./pref-documents";

const race = { ridx: 1, name: "Kobold" };
const glyphs = { gamedata: { races: [race], features: [], kinds: [] } } as unknown as GlyphTable;
const deps = {
  monsters: { races: [race], raceByName: (name: string) => name === race.name ? race : null },
  features: {},
  objects: { kinds: [], flavors: [] },
  traps: [],
} as unknown as PrefDeps;

describe("stored user preference conversion", () => {
  let files: MemoryHost;
  let stored: Map<string, string>;

  beforeEach(() => {
    files = new MemoryHost();
    stored = new Map();
    setHost(files);
    clearKeymaps();
    resetColorTable();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => { stored.set(key, value); },
      removeItem: (key: string) => { stored.delete(key); },
    });
  });

  afterEach(() => {
    setHost(NULL_HOST);
    resetColorTable();
    clearKeymaps();
    vi.unstubAllGlobals();
  });

  function convert(): void {
    convertStoredUserPrefFiles({ glyphs, deps, applyLayout: () => undefined });
  }

  it("moves visual, sound, color, keymap, layout and mod-block lines into documents", () => {
    const layout = JSON.stringify({
      enabled: { messages: true },
      tree: { kind: "split", axis: "v", ratio: 0.7,
        first: { kind: "leaf", id: "main" }, second: { kind: "leaf", id: "messages" } },
      mapTileMode: 0,
    });
    files.write(HostDir.USER, "Bilbo.prf", [
      "monster:Kobold:4:107",
      "sound:HIT:plc_hit_hay",
      "color:1:0:4:5:6",
      "keymap-act:q[Enter]",
      "keymap-input:0:F5",
      `neo-subwindows:${layout}`,
      "mod-block:qol-zoom:8:10:12",
    ].join("\n"));
    convert();
    expect(files.read(HostDir.USER, "Bilbo.prf")).toBeNull();
    expect(parseDocument(stored.get("neo-angband:visual-overrides")!, visualOverrideFormat).ok).toBe(true);
    expect(parseDocument(stored.get("neo-angband:sound-mappings")!, soundMappingFormat).ok).toBe(true);
    expect(parseDocument(stored.get("neo-angband:colors")!, colorTableFormat).ok).toBe(true);
    expect(parseDocument(stored.get("neo-angband:keymaps")!, keymapFormat).ok).toBe(true);
    const subwindows = parseDocument(stored.get("neo-angband:subwindows")!, subwindowLayoutFormat);
    expect(subwindows.ok).toBe(true);
    if (subwindows.ok) expect(subwindows.data.modBlocks).toEqual({ "qol-zoom": "8:10:12" });
    expect(colorChannel(1, 1)).toBe(4);
    expect(keymapFind("orig", "F5")).toBe("q[Enter]");
  });

  it("keeps the old file when a destination is from a future version", () => {
    const future = JSON.stringify({ format: visualOverrideFormat.format, schemaVersion: 99, data: {} });
    stored.set("neo-angband:visual-overrides", future);
    files.write(HostDir.USER, "Bilbo.prf", "monster:Kobold:4:107");
    convert();
    expect(stored.get("neo-angband:visual-overrides")).toBe(future);
    expect(files.read(HostDir.USER, "Bilbo.prf")).toBe("monster:Kobold:4:107");
  });

  it("keeps a file whose include cannot be read", () => {
    files.write(HostDir.USER, "Bilbo.prf", "%:missing.prf\ncolor:1:0:4:5:6");
    convert();
    expect(files.read(HostDir.USER, "Bilbo.prf")).not.toBeNull();
    expect(stored.has("neo-angband:colors")).toBe(false);
  });
});
