import { afterEach, describe, expect, it } from "vitest";
import type { UiInput } from "./input-door";
import {
  clearInputDoor,
  dispatchUiInput,
  inputEvents,
  onKeydown,
  setDomKeyboardOwner,
  setKeymapResolver,
} from "./input-door";

afterEach(clearInputDoor);

function key(key: string) {
  return { key: { key, modifiers: { ctrl: false, shift: false, alt: false, meta: false }, repeat: false } };
}

function macrotask(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

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

  it("leaves a modal's literal key alone instead of expanding its player keymap", async () => {
    const rootMayOwnInput = false;
    const seen: string[] = [];
    setKeymapResolver(
      (input) => input.key?.key === "X" ? [key("q")] : null,
      { enabled: () => rootMayOwnInput },
    );
    inputEvents.addEventListener("keydown", (event) => {
      seen.push(`modal:${event.key}`);
      event.stopImmediatePropagation();
    }, true);
    inputEvents.addEventListener("keydown", (event) => seen.push(`root:${event.key}`));

    dispatchUiInput(key("X"));
    await macrotask();

    expect(seen).toEqual(["modal:X"]);
  });

  it("sends a keymap trigger to the interrupt owner while a run is pumping", async () => {
    const rootMayOwnInput = false;
    let interrupted = false;
    const seen: string[] = [];
    setKeymapResolver(
      (input) => input.key?.key === "X" ? [key("q")] : null,
      { enabled: () => rootMayOwnInput },
    );
    inputEvents.addEventListener("keydown", (event) => {
      seen.push(event.key);
      interrupted = true;
      event.preventDefault();
    });

    dispatchUiInput(key("X"));
    await macrotask();

    expect(interrupted).toBe(true);
    expect(seen).toEqual(["X"]);
  });

  it("queues a keymap expansion once without recursively resolving its output", async () => {
    const resolved: string[] = [];
    const seen: string[] = [];
    setKeymapResolver((input) => {
      const trigger = input.key?.key ?? "";
      resolved.push(trigger);
      return trigger === "X" || trigger === "q" ? [key("q")] : null;
    });
    onKeydown((event) => seen.push(event.key));

    dispatchUiInput(key("X"));
    await macrotask();

    expect(resolved).toEqual(["X"]);
    expect(seen).toEqual(["q"]);
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
    expect((event as KeyboardEvent & { uiInput?: UiInput }).uiInput?.key?.key).toBe("Escape");
    delete (globalThis as { window?: unknown }).window;
  });
});

/**
 * The DOM keyboard owner: the one guard that lets a real `<input>` on this page
 * be typed into at all.
 *
 * Every modal handler behind this door calls `preventDefault` and
 * `stopImmediatePropagation` unconditionally, so without the guard a focused
 * field receives nothing and its keystrokes are read as game commands instead -
 * typing a name walks the character across the level. What is pinned here is
 * therefore not a feature but a shape: the game stands down for exactly the keys
 * the owner claims, and the owner is asked about Escape whether it claims the
 * key or not.
 */
describe("the DOM keyboard owner", () => {
  function browserDoor(): {
    press: (key: string) => KeyboardEvent;
    seen: string[];
  } {
    const seen: string[] = [];
    const listeners: Array<(event: Event) => void> = [];
    const fakeWindow = {
      addEventListener(_type: string, fn: (event: Event) => void): void {
        listeners.push(fn);
      },
      removeEventListener(_type: string, fn: (event: Event) => void): void {
        const at = listeners.indexOf(fn);
        if (at >= 0) listeners.splice(at, 1);
      },
    } as Pick<Window, "addEventListener" | "removeEventListener">;
    (globalThis as { window?: unknown }).window = fakeWindow;
    inputEvents.addEventListener("keydown", (event) => seen.push(event.key));
    return {
      seen,
      press: (key: string): KeyboardEvent => {
        const event = new Event("keydown", { cancelable: true }) as KeyboardEvent;
        Object.assign(event as object, {
          key, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, repeat: false,
        });
        for (const fn of [...listeners]) fn(event);
        return event;
      },
    };
  }

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("withholds a claimed key from the game without cancelling it", () => {
    const door = browserDoor();
    setDomKeyboardOwner({ owns: (event) => event.key === "x", escape: () => false });
    const mine = door.press("x");
    const theirs = door.press("y");
    expect(door.seen).toEqual(["y"]);
    /* NOT cancelled, which is the whole point: the event carries on to the field
     * the player is typing into. Cancelling it would have made the guard a way
     * to lose keystrokes rather than a way to route them. */
    expect(mine.defaultPrevented).toBe(false);
    expect(theirs.defaultPrevented).toBe(false);
  });

  it("asks about Escape even when the owner would not have claimed the key", () => {
    const door = browserDoor();
    const asked: string[] = [];
    /* `owns` says no to everything, and the hatch still works - because focus
     * drifting back to the game is the case where the player most needs it. */
    setDomKeyboardOwner({
      owns: () => false,
      escape: (event) => {
        asked.push(event.key);
        return true;
      },
    });
    const event = door.press("Escape");
    expect(asked).toEqual(["Escape"]);
    expect(door.seen).toEqual([]);
    expect(event.defaultPrevented).toBe(true);
  });

  it("gives Escape back to the game when the owner has nothing to close", () => {
    const door = browserDoor();
    setDomKeyboardOwner({ owns: () => false, escape: () => false });
    const event = door.press("Escape");
    /* Otherwise an owner that is installed for the whole session but currently
     * holds nothing would swallow Escape in a game with no panel in sight. */
    expect(door.seen).toEqual(["Escape"]);
    expect(event.defaultPrevented).toBe(false);
  });

  it("is the game's door again once the owner is cleared", () => {
    const door = browserDoor();
    setDomKeyboardOwner({ owns: () => true, escape: () => false });
    door.press("x");
    setDomKeyboardOwner(undefined);
    door.press("y");
    expect(door.seen).toEqual(["y"]);
  });
});
