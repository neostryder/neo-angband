// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { browserKeydown } from "./input-door";
import type { LayoutNode } from "./subwindow-layout";
import { mountSubwindowShell } from "./subwindow-shell";

const tree: LayoutNode = { kind: "split", axis: "h", ratio: 0.7, first: { kind: "leaf", id: "main" },
  second: { kind: "split", axis: "v", ratio: 0.5, first: { kind: "leaf", id: "inventory" },
    second: { kind: "leaf", id: "messages" } } };

function setup() {
  document.body.innerHTML = '<div id="host"><div id="main"><canvas></canvas></div></div>';
  const host = document.getElementById("host")!;
  const mainSlot = document.getElementById("main")!;
  Object.defineProperty(host, "clientWidth", { value: 900, configurable: true });
  Object.defineProperty(host, "clientHeight", { value: 600, configurable: true });
  const changes: LayoutNode[] = [];
  const shell = mountSubwindowShell({ host, mainSlot, labels: {},
    onTreeChange(next) { changes.push(next); shell.apply(next); } });
  shell.apply(tree);
  shell.setGameLive(true);
  const leaf = shell.slot("inventory")!;
  leaf.setPointerCapture = () => {};
  const preview = host.querySelector<HTMLElement>(".tile-drop-preview")!;
  return { shell, leaf, preview, changes,
    dragging: () => host.classList.contains("tile-host-dragging") };
}

function pointer(type: string, x: number, y: number, extra: { buttons?: number; pointerType?: string } = {}): PointerEvent {
  const event = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent;
  Object.defineProperties(event, { button: { value: 2 }, pointerId: { value: 1 },
    clientX: { value: x }, clientY: { value: y },
    buttons: { value: extra.buttons ?? 2 }, pointerType: { value: extra.pointerType ?? "mouse" } });
  return event;
}

/* Right-drags the inventory panel from its title bar to (x, y). */
function startDrag(page: ReturnType<typeof setup>, x: number, y: number): void {
  page.leaf.querySelector(".tile-title")!.dispatchEvent(pointer("pointerdown", 200, 430));
  window.dispatchEvent(pointer("pointermove", x, y));
}

afterEach(() => { document.body.replaceChildren(); });

describe("cancelling a panel drag", () => {
  it("clears the drop preview when the panel is let go where it started", () => {
    const page = setup();
    startDrag(page, 200, 200);
    expect(page.dragging()).toBe(true);
    expect(page.preview.hidden).toBe(false);
    window.dispatchEvent(pointer("pointermove", 200, 430));
    window.dispatchEvent(pointer("pointerup", 200, 430, { buttons: 0 }));
    expect(page.preview.hidden).toBe(true);
    expect(page.dragging()).toBe(false);
    expect(page.changes).toEqual([]);
    page.shell.destroy();
  });

  it("puts the panel back on Escape and keeps the key from the game", () => {
    const page = setup();
    startDrag(page, 200, 300);
    const key = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    browserKeydown(key);
    expect(key.defaultPrevented).toBe(true);
    expect(page.preview.hidden).toBe(true);
    expect(page.dragging()).toBe(false);
    window.dispatchEvent(pointer("pointerup", 200, 300, { buttons: 0 }));
    expect(page.changes).toEqual([]);
    const menu = new Event("contextmenu", { bubbles: true, cancelable: true });
    page.leaf.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
    page.shell.destroy();
  });

  it("gives Escape back to the game when nothing is being dragged", () => {
    const page = setup();
    const key = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    browserKeydown(key);
    expect(key.defaultPrevented).toBe(false);
    page.shell.destroy();
  });

  it("ends a drag whose release the page never received", () => {
    const page = setup();
    startDrag(page, 200, 300);
    window.dispatchEvent(pointer("pointermove", 210, 310, { buttons: 0 }));
    expect(page.dragging()).toBe(false);
    expect(page.preview.hidden).toBe(true);
    window.dispatchEvent(pointer("pointerup", 210, 310, { buttons: 0 }));
    expect(page.changes).toEqual([]);
    page.shell.destroy();
  });

  it("ends a drag when the window loses focus", () => {
    const page = setup();
    startDrag(page, 200, 300);
    window.dispatchEvent(new Event("blur"));
    expect(page.dragging()).toBe(false);
    expect(page.preview.hidden).toBe(true);
    page.shell.destroy();
  });
});
