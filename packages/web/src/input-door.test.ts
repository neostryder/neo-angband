import { afterEach, describe, expect, it } from "vitest";
import type { UiInput } from "./input-door";
import {
  clearInputDoor,
  dispatchUiInput,
  inputEvents,
  onKeydown,
  setKeymapResolver,
} from "./input-door";

afterEach(clearInputDoor);

describe("the single input door", () => {
  it("keeps an analog direction continuous instead of flattening it to a key", () => {
    const received: Array<KeyboardEvent & { uiInput: UiInput }> = [];
    onKeydown((event) => received.push(event));
    dispatchUiInput({ direction: { x: 0.7986355, y: 0.601815, magnitude: 1, angleRadians: 37 * Math.PI / 180 } });
    expect(received).toHaveLength(1);
    expect(received[0]!.uiInput.key).toBeUndefined();
    expect(received[0]!.uiInput.direction?.angleRadians).toBeCloseTo(37 * Math.PI / 180);
  });

  it("gives a player keymap priority over a later input consumer", async () => {
    const modSaw: string[] = [];
    setKeymapResolver((input) => input.key?.key === "X"
      ? [{ key: { key: "q", modifiers: { ctrl: false, shift: false, alt: false, meta: false }, repeat: false } }]
      : null);
    onKeydown((event) => modSaw.push(event.key));
    dispatchUiInput({ key: { key: "X", modifiers: { ctrl: false, shift: false, alt: false, meta: false }, repeat: false } });
    expect(modSaw).toEqual([]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(modSaw).toEqual(["q"]);
  });

  it("routes a browser key through the door and lets a modal block the root", () => {
    const seen: string[] = [];
    const listeners: Array<{ readonly fn: (event: Event) => void; readonly capture: boolean }> = [];
    const fakeWindow = {
      addEventListener(_type: string, fn: (event: Event) => void, capture = false): void {
        listeners.push({ fn, capture });
      },
      removeEventListener(_type: string, fn: (event: Event) => void, capture = false): void {
        const index = listeners.findIndex((entry) => entry.fn === fn && entry.capture === capture);
        if (index >= 0) listeners.splice(index, 1);
      },
      dispatchEvent(event: Event): void {
        for (const entry of [...listeners]) entry.fn(event);
      },
    } as Pick<Window, "addEventListener" | "removeEventListener"> & { dispatchEvent(event: Event): void };
    (globalThis as { window?: unknown }).window = fakeWindow;
    inputEvents.addEventListener("keydown", () => seen.push("root"));
    inputEvents.addEventListener("keydown", (event) => {
      seen.push(`modal:${event.key}`);
      event.stopImmediatePropagation();
    }, true);
    const event = new Event("keydown", { cancelable: true }) as KeyboardEvent;
    Object.assign(event as object, { key: "Escape", ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, repeat: false });
    fakeWindow.dispatchEvent(event);
    expect(seen).toEqual(["modal:Escape"]);
    delete (globalThis as { window?: unknown }).window;
  });
});
