/**
 * ctx.display.setTerminalGround: the request's validation and consent gate, the
 * per-mod ownership it shares with the other display setters, and the pixels the
 * terminal actually fills.
 */
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CapabilitySet } from "@rpgm-tools/neo-angband-mod-sdk";
import { validateTerminalGround } from "./terminal-ground";
import { createDisplayOwnership } from "./display-ownership";
import { modPluginContext } from "./mod-context";
import type { ModDisplay } from "./mod-plugin";
import { GlyphTerm } from "./term";
import { UI_BG } from "./ui-colors";

const MAIN_TS_SOURCE = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

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
    id: "painter", name: "Painter", version: "1.0.0", shape: "plugin", modApi: 1, capabilities: list,
  });
}

describe("terminal ground requests", () => {
  it("accepts the chrome theme's colour forms and defaults the scope to subwindows", () => {
    expect(validateTerminalGround({ color: "#070b0d" })).toEqual({ color: "#070b0d", scope: "subwindows" });
    expect(validateTerminalGround({ color: "rgb(7, 11, 13)", scope: "all" })).toEqual({ color: "rgb(7, 11, 13)", scope: "all" });
    expect(() => validateTerminalGround({ color: "black" })).toThrow(/color/);
    expect(() => validateTerminalGround({ color: "#070b0d", scope: "map" })).toThrow(/scope/);
    expect(() => validateTerminalGround({ color: "#070b0d", colour: "#000" })).toThrow(/colour/);
  });

  it("needs display:filter and validates before it reaches the host", () => {
    const setTerminalGround = vi.fn();
    const host = display({ setTerminalGround, getTerminalGround: () => null });
    const denied = modPluginContext("painter", {}, undefined, {}, { capabilities: capabilities([]), display: host }).display;
    expect(() => denied?.setTerminalGround?.({ color: "#070b0d" })).toThrow(/display:filter/);
    const allowed = modPluginContext("painter", {}, undefined, {}, { capabilities: capabilities(["display:filter"]), display: host }).display;
    expect(() => allowed?.setTerminalGround?.({ color: "nope" })).toThrow(/color/);
    expect(setTerminalGround).not.toHaveBeenCalled();
    allowed?.setTerminalGround?.({ color: "#070b0d" });
    expect(setTerminalGround).toHaveBeenLastCalledWith({ color: "#070b0d", scope: "subwindows" });
    allowed?.setTerminalGround?.(null);
    expect(setTerminalGround).toHaveBeenLastCalledWith(null);
  });

  it("keeps each mod's request and restores the earlier one when a mod goes", () => {
    let current: unknown = null;
    const owned = createDisplayOwnership(display({
      setTerminalGround: (value) => { current = value; },
      getTerminalGround: () => current as never,
    }));
    owned.forMod("first").setTerminalGround?.({ color: "#ff0000", scope: "all" });
    owned.forMod("second").setTerminalGround?.({ color: "#00ff00", scope: "subwindows" });
    expect(owned.forMod("first").getTerminalGround?.()).toEqual({ color: "#00ff00", scope: "subwindows" });
    owned.clear("second");
    expect(current).toEqual({ color: "#ff0000", scope: "all" });
    owned.clear("first");
    expect(current).toBeNull();
  });

  it("the host applies the scope to subwindow terminals, including ones opened later", () => {
    expect(MAIN_TS_SOURCE).toMatch(/for \(const panel of subwindowTerms\.values\(\)\) panel\.setGround\(color\);/);
    expect(MAIN_TS_SOURCE).toMatch(/term\.setGround\(terminalGround\?\.scope === "all" \? color : null\);/);
    expect(MAIN_TS_SOURCE).toMatch(/next\.setGround\(terminalGround\?\.color \?\? null\);/);
  });
});

describe("the ground the terminal paints", () => {
  const fills: string[] = [];
  const saved: Record<string, unknown> = {};

  function recordingCanvas(): HTMLCanvasElement {
    const ctx = {
      setTransform: () => undefined,
      fillRect() { fills.push(String(this.fillStyle)); },
      strokeRect: () => undefined,
      drawImage: () => undefined,
      fillText: () => undefined,
      measureText: (t: string) => ({ width: t.length * 8 }),
      createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }),
      putImageData: () => undefined,
      imageSmoothingEnabled: false,
      textBaseline: "top",
      font: "",
      fillStyle: "",
      strokeStyle: "",
      lineWidth: 1,
    };
    return {
      width: 0, height: 0, style: {} as CSSStyleDeclaration,
      getContext: () => ctx, addEventListener: () => undefined,
      getBoundingClientRect: () => ({ left: 0, top: 0 }) as DOMRect,
    } as unknown as HTMLCanvasElement;
  }

  beforeEach(() => {
    fills.length = 0;
    for (const k of ["window", "document", "ResizeObserver"]) saved[k] = (globalThis as Record<string, unknown>)[k];
    (globalThis as Record<string, unknown>).window = {
      innerWidth: 1280, innerHeight: 800, devicePixelRatio: 1,
      addEventListener: () => undefined, removeEventListener: () => undefined,
    };
    (globalThis as Record<string, unknown>).document = { documentElement: {}, createElement: () => recordingCanvas() };
    (globalThis as Record<string, unknown>).ResizeObserver = class { observe(): void { /* never resizes */ } };
  });

  afterEach(() => {
    for (const [k, v] of Object.entries(saved)) (globalThis as Record<string, unknown>)[k] = v;
  });

  it("fills the canvas and plain cells with the ground, and keeps explicit backgrounds and the grid", () => {
    const term = new GlyphTerm(recordingCanvas(), { minCols: 32, minRows: 18, fontPx: 18, reflow: false, bitmapFont: null });
    term.print(0, 0, "a", "#ffffff");
    term.print(1, 0, "b", "#ffffff", UI_BG);
    term.print(2, 0, "c", "#ffffff", "#123456");
    term.flush();
    expect(fills).not.toContain("#070b0d");
    fills.length = 0;
    term.setGround("#070b0d");
    term.flush();
    expect(fills[0], "the full-repaint fill").toBe("#070b0d");
    expect(fills.filter((f) => f === "#070b0d").length).toBeGreaterThanOrEqual(3);
    expect(fills).toContain("#123456");
    expect(fills).not.toContain(UI_BG);
    expect(term.snapshotColored()[0]?.slice(0, 3)).toEqual([
      { ch: "a", fg: "#ffffff" },
      { ch: "b", fg: "#ffffff", bg: UI_BG },
      { ch: "c", fg: "#ffffff", bg: "#123456" },
    ]);
    fills.length = 0;
    term.setGround(null);
    term.flush();
    expect(fills[0]).toBe(UI_BG);
  });
});
