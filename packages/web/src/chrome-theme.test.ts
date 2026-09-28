// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { CapabilitySet } from "@rpgm-tools/neo-angband-mod-sdk";
import { CHROME_PROPERTIES, applyChromeTheme, colorChannels, validateChromeTheme } from "./chrome-theme";
import { createDisplayOwnership } from "./display-ownership";
import { modPluginContext } from "./mod-context";
import type { ModDisplay } from "./mod-plugin";

const INDEX_HTML = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "index.html"), "utf8");

function display(extra: Partial<ModDisplay> = {}): ModDisplay {
  return {
    snapshot: () => ({ mode: "play" }),
    onKey: () => () => undefined,
    setGrid: () => undefined,
    setCamera: () => undefined,
    setMapView: () => undefined,
    setSidebarExtent: () => undefined,
    setTileScaling: () => undefined,
    setFullMapOverview: () => undefined,
    setStoreItemNameEllipsis: () => undefined,
    setStoreSelectionDescription: () => undefined,
    setQuiverItemization: () => undefined,
    setMonsterListColorKey: () => undefined,
    setVisualFilter: () => undefined,
    repaint: () => undefined,
    ...extra,
  } as unknown as ModDisplay;
}

function capabilities(list: string[]) {
  return CapabilitySet.fromManifest({
    id: "painter", name: "Painter", version: "1.0.0", shape: "plugin", facets: ["plugin"], modApi: 1, capabilities: list,
  });
}

describe("window chrome theme", () => {
  it("draws every chrome rule from a property the theme can set", () => {
    for (const property of CHROME_PROPERTIES) expect(INDEX_HTML).toContain(`${property}:`);
    expect(INDEX_HTML).toContain('font-family: "Angband 8x13"');
  });

  it("accepts the colours, sizes and switches it documents", () => {
    const theme = validateChromeTheme({ accent: "#80b891", page: "rgb(7, 11, 13)", radius: 5, fontSize: 12, shadow: true, font: "\"Anyband UI\"" });
    expect(theme).toEqual({ accent: "#80b891", page: "rgb(7, 11, 13)", radius: 5, fontSize: 12, shadow: true, font: "\"Anyband UI\"" });
    expect(Object.isFrozen(theme)).toBe(true);
    expect(colorChannels("#fa0")).toBe("255, 170, 0");
  });

  it("refuses unknown keys and values that could reach outside a property", () => {
    expect(() => validateChromeTheme({ background: "#000" })).toThrow(/no setting called background/);
    expect(() => validateChromeTheme({ accent: "red; display: none" })).toThrow(/not a colour/);
    expect(() => validateChromeTheme({ font: "x; } body { display: none" })).toThrow(/font family/);
    expect(() => validateChromeTheme({ radius: 40 })).toThrow(/0 to 16/);
    expect(() => validateChromeTheme(null)).toThrow(/object/);
  });

  it("sets the properties, and clearing puts the game's own look back", () => {
    const root = document.createElement("div");
    applyChromeTheme(validateChromeTheme({ accent: "#80b891", radius: 5, shadow: true }), root);
    expect(root.style.getPropertyValue("--chrome-accent")).toBe("#80b891");
    expect(root.style.getPropertyValue("--chrome-accent-rgb")).toBe("128, 184, 145");
    expect(root.style.getPropertyValue("--chrome-radius")).toBe("5px");
    applyChromeTheme(null, root);
    for (const property of CHROME_PROPERTIES) expect(root.style.getPropertyValue(property)).toBe("");
  });

  it("needs display:filter, and a bad theme never reaches the host", () => {
    const setChromeTheme = vi.fn();
    const host = display({ setChromeTheme, getChromeTheme: () => null });
    expect(() => modPluginContext("painter", {}, undefined, {}, { display: host, capabilities: capabilities([]) })
      .display?.setChromeTheme?.({ accent: "#80b891" })).toThrow(/display:filter/);
    const allowed = modPluginContext("painter", {}, undefined, {}, { display: host, capabilities: capabilities(["display:filter"]) }).display!;
    expect(() => allowed.setChromeTheme?.({ accent: "not a colour" })).toThrow(/not a colour/);
    expect(setChromeTheme).not.toHaveBeenCalled();
    allowed.setChromeTheme?.({ accent: "#80b891" });
    expect(setChromeTheme).toHaveBeenLastCalledWith({ accent: "#80b891" });
    allowed.setChromeTheme?.(null);
    expect(setChromeTheme).toHaveBeenLastCalledWith(null);
  });

  it("keeps each mod's request and restores the earlier one when a mod goes", () => {
    const setChromeTheme = vi.fn();
    const owned = createDisplayOwnership(display({ setChromeTheme }));
    owned.forMod("first").setChromeTheme?.({ accent: "#ff0000" });
    owned.forMod("second").setChromeTheme?.({ accent: "#00ff00" });
    expect(setChromeTheme).toHaveBeenLastCalledWith({ accent: "#00ff00" });
    owned.clear("second");
    expect(setChromeTheme).toHaveBeenLastCalledWith({ accent: "#ff0000" });
    owned.clear("first");
    expect(setChromeTheme).toHaveBeenLastCalledWith(null);
  });
});
