// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { bindPanelProviders, registerPanelKind, syncPanelProviders, unregisterAllPanelKinds } from "./panel-provider";
import { containsLeaf, removeLeaf, restoreDockPlace, type DropZone, type FloatRect, type LayoutNode } from "./subwindow-layout";
import { mountSubwindowShell } from "./subwindow-shell";
import { parseSubwindowDocument, rememberDockTree, serializeSubwindowDocument,
  setSubwindowEnabled, DEFAULT_SUBWINDOW_SETTINGS, type SubwindowState } from "./subwindows";
import { DEFAULT_WM_SETTINGS } from "./wm-settings";

const main: LayoutNode = { kind: "leaf", id: "main" };
const docked: LayoutNode = { kind: "split", axis: "v", ratio: 0.7,
  first: main, second: { kind: "leaf", id: "messages" } };

function setup(tree: LayoutNode = docked) {
  document.body.innerHTML = '<div id="host"><div id="main"><canvas></canvas></div></div>';
  const host = document.getElementById("host")!;
  const mainSlot = document.getElementById("main")!;
  Object.defineProperty(host, "clientWidth", { value: 900, configurable: true });
  Object.defineProperty(host, "clientHeight", { value: 600, configurable: true });
  let state: SubwindowState = { enabled: { ...DEFAULT_SUBWINDOW_SETTINGS, messages: true }, tree };
  let lastZone: DropZone | undefined;
  const apply = () => shell.apply(state.tree, state.floats, state.places);
  const shell = mountSubwindowShell({ host, mainSlot, labels: {}, onViewChange: syncPanelProviders,
    onTreeChange(next) { state = rememberDockTree(state, next); apply(); },
    onFloat(id, rect) {
      state = { ...state, tree: removeLeaf(state.tree, id), floats: [...state.floats ?? [], rect],
        places: { ...state.places, [id]: { dock: state.tree,
          float: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, last: "float" } } };
      apply();
    },
    onDockFloat(id, zone) {
      lastZone = zone;
      const rect = state.floats!.find((entry) => entry.id === id)!;
      const tree = restoreDockPlace(state.tree, id, state.places![id]!.dock!)!;
      state = rememberDockTree({ ...state, floats: state.floats!.filter((entry) => entry.id !== id),
        places: { ...state.places, [id]: { ...state.places![id],
          float: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }, last: "dock" } } }, tree);
      apply();
    },
    onFloatsChange(floats: FloatRect[]) { state = { ...state, floats }; },
  });
  apply();
  const unbind = bindPanelProviders({ shell, tree: () => state.tree,
    changeTree(next) { state = { ...state, tree: next }; apply(); } });
  shell.setGameLive(true);
  return { host, shell, state: () => state, lastZone: () => lastZone,
    change(next: SubwindowState) { state = next; apply(); },
    close() { unbind(); shell.destroy(); } };
}

afterEach(() => { unregisterAllPanelKinds(); document.body.replaceChildren(); });

describe("floating subwindows", () => {
  it("floats and docks at the remembered position without offering Float on main", () => {
    const page = setup();
    expect(page.shell.slot("main")!.querySelector(".tile-float-action")).toBeNull();
    page.change({ ...page.state(), floats: [{ id: "main", x: 0, y: 0, width: 0.4, height: 0.4 }] });
    expect(page.shell.floatingIds()).toEqual([]);
    page.change({ ...page.state(), floats: [] });
    page.shell.slot("messages")!.querySelector<HTMLButtonElement>(".tile-float-action")!.click();
    expect(page.state().floats?.map((entry) => entry.id)).toEqual(["messages"]);
    expect(containsLeaf(page.state().tree, "messages")).toBe(false);
    expect(page.shell.slot("messages")!.classList.contains("tile-floating")).toBe(true);
    page.shell.slot("messages")!.querySelector<HTMLButtonElement>(".tile-dock-action")!.click();
    expect(page.state().tree).toEqual(docked);
    expect(page.state().floats).toEqual([]);
    page.close();
  });

  it("uses the dock zones when a title bar is dragged over a tile edge", () => {
    const page = setup();
    page.shell.slot("messages")!.querySelector<HTMLButtonElement>(".tile-float-action")!.click();
    const leaf = page.shell.slot("messages")!;
    leaf.setPointerCapture = () => {};
    const pointer = (type: string, x: number, y: number) => {
      const event = new Event(type, { bubbles: true }) as PointerEvent;
      Object.defineProperties(event, { button: { value: 0 }, pointerId: { value: 1 },
        clientX: { value: x }, clientY: { value: y } });
      return event;
    };
    leaf.querySelector(".tile-title")!.dispatchEvent(pointer("pointerdown", 300, 150));
    window.dispatchEvent(pointer("pointermove", 10, 300));
    window.dispatchEvent(pointer("pointerup", 10, 300));
    expect(page.lastZone()?.kind).toBe("dock");
    expect(page.state().floats).toEqual([]);
    page.close();
  });

  it("restores hidden floats and docks, then projects floats when the switch is off", () => {
    const page = setup();
    page.shell.slot("messages")!.querySelector<HTMLButtonElement>(".tile-float-action")!.click();
    const floating = page.state().floats![0]!;
    page.change(setSubwindowEnabled(page.state(), "messages", false));
    expect(page.state().floats).toEqual([]);
    page.change(setSubwindowEnabled(page.state(), "messages", true));
    expect(page.state().floats).toEqual([floating]);
    page.shell.setFeatures({ ...DEFAULT_WM_SETTINGS, floatingWindows: false });
    expect(page.shell.slot("messages")!.classList.contains("tile-floating")).toBe(false);
    expect(page.shell.slot("messages")!.hidden).toBe(false);
    expect(page.shell.slot("messages")!.querySelector<HTMLButtonElement>(".tile-float-action")!.hidden).toBe(true);
    expect(page.state().floats).toEqual([floating]);
    page.shell.setFeatures(DEFAULT_WM_SETTINGS);
    expect(page.shell.slot("messages")!.classList.contains("tile-floating")).toBe(true);
    page.close();
    const other = setup();
    other.change(setSubwindowEnabled(other.state(), "messages", false));
    other.change(setSubwindowEnabled(other.state(), "messages", true));
    expect(other.state().tree).toEqual(docked);
    other.close();
  });

  it("clamps a float after the viewport shrinks and shows a missing mod placeholder", () => {
    const modTree: LayoutNode = { kind: "split", axis: "v", ratio: 0.7,
      first: main, second: { kind: "leaf", id: "sample:editor" } };
    const page = setup(modTree);
    page.shell.slot("sample:editor")!.querySelector<HTMLButtonElement>(".tile-float-action")!.click();
    const slot = page.shell.slot("sample:editor")!;
    expect(slot.textContent).toContain("This panel's mod is not installed.");
    page.change({ ...page.state(), floats: [{ id: "sample:editor", x: 0.9, y: 0.9, width: 0.5, height: 0.5 }] });
    Object.defineProperty(page.host, "clientWidth", { value: 300, configurable: true });
    Object.defineProperty(page.host, "clientHeight", { value: 200, configurable: true });
    window.dispatchEvent(new Event("resize"));
    expect(Number.parseFloat(slot.style.left) + Number.parseFloat(slot.style.width)).toBeLessThanOrEqual(300);
    expect(Number.parseFloat(slot.style.top) + Number.parseFloat(slot.style.height)).toBeLessThanOrEqual(200);
    page.close();
  });

  it("uses a mod panel's minimum size for its float", () => {
    const tree: LayoutNode = { kind: "split", axis: "v", ratio: 0.7,
      first: main, second: { kind: "leaf", id: "sample:editor" } };
    registerPanelKind("sample", { kind: "editor", label: "Editor",
      minSize: { width: 270, height: 180 }, mount() {} });
    const page = setup(tree);
    page.shell.slot("sample:editor")!.querySelector<HTMLButtonElement>(".tile-float-action")!.click();
    page.change({ ...page.state(), floats: [{ id: "sample:editor", x: 0, y: 0,
      width: 0.1, height: 0.1 }] });
    const slot = page.shell.slot("sample:editor")!;
    expect(Number.parseFloat(slot.style.width)).toBeGreaterThanOrEqual(270);
    expect(Number.parseFloat(slot.style.height)).toBeGreaterThanOrEqual(180);
    page.close();
  });

  it("exports and imports a floating panel with its remembered dock", () => {
    const page = setup();
    page.shell.slot("messages")!.querySelector<HTMLButtonElement>(".tile-float-action")!.click();
    const state = page.state();
    const parsed = parseSubwindowDocument(serializeSubwindowDocument(state));
    expect(parsed?.floats).toEqual(state.floats);
    expect(parsed?.places?.messages?.dock).toEqual(docked);
    page.close();
  });

  it("shows a title label after floating a tab", () => {
    const tree: LayoutNode = { kind: "split", axis: "v", ratio: 0.7, first: main,
      second: { kind: "leaf", id: "messages", tabs: ["messages", "inventory"] } };
    const page = setup(tree);
    const slot = page.shell.slot("messages")!;
    expect(slot.querySelector<HTMLElement>(".tile-title-label")!.hidden).toBe(true);
    slot.querySelector<HTMLButtonElement>(".tile-float-action")!.click();
    expect(slot.querySelector<HTMLElement>(".tile-title-label")!.hidden).toBe(false);
    expect(slot.querySelector<HTMLElement>(".tile-tabs")!.hidden).toBe(true);
    page.close();
  });
});
