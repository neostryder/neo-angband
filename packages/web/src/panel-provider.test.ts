// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { modPluginContext } from "./mod-context";
import { bindPanelProviders, registerPanelKind, syncPanelProviders, unregisterAllPanelKinds } from "./panel-provider";
import { mountSubwindowShell } from "./subwindow-shell";
import { browserKeydown, clearInputDoor, inputEvents, installBrowserAdapter, setDomKeyboardOwner } from "./input-door";
import { containsLeaf, removeLeaf, selectTab, type LayoutNode } from "./subwindow-layout";
import type { PanelMount } from "./mod-plugin";

const main: LayoutNode = { kind: "leaf", id: "main" };
const withPanel: LayoutNode = { kind: "split", axis: "v", ratio: 0.7,
  first: main, second: { kind: "leaf", id: "sample:editor" } };

function setup(initial: LayoutNode = withPanel) {
  document.body.innerHTML = '<div id="host"><div id="main"><canvas></canvas></div></div>';
  const host = document.getElementById("host")!;
  const mainSlot = document.getElementById("main")!;
  Object.defineProperty(host, "clientWidth", { value: 900 });
  Object.defineProperty(host, "clientHeight", { value: 600 });
  let tree = initial;
  const shell = mountSubwindowShell({ host, mainSlot, labels: {},
    onTreeChange(next) { tree = next; shell.apply(tree); },
    onViewChange: syncPanelProviders,
  });
  shell.apply(tree);
  const unbind = bindPanelProviders({ shell, tree: () => tree,
    changeTree(next) { tree = next; shell.apply(tree); },
  });
  shell.setGameLive(true);
  return { shell, tree: () => tree, change(next: LayoutNode) { tree = next; shell.apply(tree); },
    close() { unbind(); shell.destroy(); } };
}

afterEach(() => {
  unregisterAllPanelKinds();
  clearInputDoor();
  document.body.replaceChildren();
});

describe("tiled panel providers", () => {
  it("requires the existing panel capability on ctx.ui", () => {
    expect(modPluginContext("sample", {}).ui).toBeUndefined();
    const ctx = modPluginContext("sample", {}, undefined, {}, {
      capabilities: { has: (name: string) => name === "ui:panel.mount" } as never,
    });
    expect(ctx.ui?.registerPanelKind).toBeTypeOf("function");
  });

  it("shows a missing mod placeholder and fills the same slot on registration", () => {
    const page = setup();
    const slot = page.shell.slot("sample:editor")!;
    expect(slot.textContent).toContain("The panel's mod (sample) is not loaded.");
    const mount = vi.fn();
    const unregister = registerPanelKind("sample", { kind: "editor", label: "Editor", mount });
    expect(mount).toHaveBeenCalledOnce();
    expect(slot.querySelector(".tile-panel-placeholder")).toBeNull();
    unregister();
    expect(slot.textContent).toContain("not loaded");
    slot.querySelector<HTMLButtonElement>(".tile-panel-placeholder button")!.click();
    expect(containsLeaf(page.tree(), "sample:editor")).toBe(false);
    page.close();
  });

  it("mounts once in a shadow root, reports tab and resize changes, and cleans up", () => {
    let panel: PanelMount | undefined;
    const states: Array<{ active: boolean; width: number }> = [];
    const cleanup = vi.fn();
    const mount = vi.fn((host: PanelMount) => {
      panel = host;
      host.onStateChange((state) => states.push({ active: state.active, width: state.bounds.width }));
      return cleanup;
    });
    const unregister = registerPanelKind("sample", { kind: "editor", label: "Editor", mount });
    const page = setup();
    expect(mount).toHaveBeenCalledOnce();
    expect(panel?.root).toBeInstanceOf(ShadowRoot);
    expect(panel?.root.host.closest(".tile-body")).not.toBeNull();
    const grouped: LayoutNode = { kind: "split", axis: "v", ratio: 0.7,
      first: main, second: { kind: "leaf", id: "sample:editor", tabs: ["sample:editor", "messages"] } };
    page.change(selectTab(grouped, "messages"));
    expect(states.at(-1)?.active).toBe(false);
    page.change(selectTab(grouped, "sample:editor"));
    expect(states.at(-1)?.active).toBe(true);
    const body = page.shell.bounds("sample:editor")!;
    Object.defineProperty(body, "clientWidth", { value: 240, configurable: true });
    window.dispatchEvent(new Event("resize"));
    expect(states.at(-1)?.width).toBe(240);
    page.change(removeLeaf(page.tree(), "sample:editor"));
    expect(cleanup).toHaveBeenCalledOnce();
    page.change(withPanel);
    expect(mount).toHaveBeenCalledTimes(2);
    unregister();
    expect(cleanup).toHaveBeenCalledTimes(2);
    page.close();
  });

  it("reports focus and returns it to the game on a dungeon click", () => {
    let panel: PanelMount | undefined;
    const focus: boolean[] = [];
    const unregister = registerPanelKind("sample", { kind: "editor", label: "Editor", mount(host) {
      panel = host;
      host.onStateChange((state) => focus.push(state.focused));
    } });
    const page = setup();
    panel!.requestFocus();
    expect(focus.at(-1)).toBe(true);
    document.getElementById("main")!.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(focus.at(-1)).toBe(false);
    unregister();
    page.close();
  });

  it("routes typing in a provider field away from the game while a native panel keeps arrow keys", () => {
    clearInputDoor();
    installBrowserAdapter(window);
    const seen: string[] = [];
    inputEvents.addEventListener("keydown", (event) => seen.push(event.key));
    let field: HTMLInputElement | undefined;
    const unregister = registerPanelKind("sample", { kind: "editor", label: "Editor", mount(panel) {
      field = document.createElement("input");
      panel.root.appendChild(field);
    } });
    const page = setup();
    field!.focus();
    field!.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true, composed: true }));
    expect(seen).toEqual([]);
    const native = document.createElement("section");
    native.className = "tile-leaf";
    document.body.appendChild(native);
    native.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowLeft", bubbles: true }));
    expect(seen).toContain("ArrowLeft");
    unregister();
    page.close();
  });

  it("offers Escape to the overlay before leaving a focused tiled field", () => {
    let field: HTMLInputElement | undefined;
    const unregister = registerPanelKind("sample", { kind: "editor", label: "Editor", mount(panel) {
      field = document.createElement("input");
      panel.root.appendChild(field);
    } });
    const page = setup();
    field!.focus();
    let overlay = true;
    const modalEscape = vi.fn(() => overlay);
    setDomKeyboardOwner({ owns: () => false, escape: modalEscape });
    const event = { key: "Escape", repeat: false, isComposing: false, isTrusted: true,
      composedPath: () => [field, field!.getRootNode(), (field!.getRootNode() as ShadowRoot).host],
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;
    browserKeydown(event);
    expect(modalEscape).toHaveBeenCalledOnce();
    expect(field!.getRootNode() instanceof ShadowRoot && (field!.getRootNode() as ShadowRoot).activeElement).toBe(field);
    overlay = false;
    browserKeydown(event);
    expect(modalEscape).toHaveBeenCalledTimes(2);
    expect((field!.getRootNode() as ShadowRoot).activeElement).toBeNull();
    unregister();
    page.close();
  });
});
