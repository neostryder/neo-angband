import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlSurface, cancelAction, directionActions, keyAction } from "./control-surface";
import { clearInputDoor, inputEvents } from "./input-door";
import { STANDARD_BUTTON, type PadSnapshot } from "./gamepad-device";
import { GamepadAdapter, startGamepadRuntime, type ConnectedPad, type GamepadHost } from "./gamepad-input";
import { DEFAULT_REPEAT } from "./gamepad-analog";

function synthPad(overrides: Partial<PadSnapshot> = {}): PadSnapshot {
  const buttons = overrides.buttons
    ?? Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
  return {
    id: "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b12)",
    index: 0, mapping: "standard", connected: true,
    axes: [0, 0, 0, 0], ...overrides, buttons,
  };
}

function withButtons(down: readonly number[], overrides: Partial<PadSnapshot> = {}): PadSnapshot {
  return synthPad({
    ...overrides,
    buttons: Array.from({ length: 17 }, (_, index) => ({
      pressed: down.includes(index), value: down.includes(index) ? 1 : 0,
    })),
  });
}

/** Everything the door delivers, which is what the game would have seen. */
function recorder(): { keys: string[]; dispose: () => void } {
  const keys: string[] = [];
  const listener = (event: KeyboardEvent): void => {
    keys.push(`${event.ctrlKey ? "^" : ""}${event.key}`);
  };
  inputEvents.addEventListener("keydown", listener, true);
  return { keys, dispose: () => inputEvents.removeEventListener("keydown", listener, true) };
}

function stubHost(overrides: Partial<GamepadHost> = {}): GamepadHost & { pads: readonly ConnectedPad[] } {
  const host = {
    pads: [] as readonly ConnectedPad[],
    overlayOpen: () => false,
    overlayMove: vi.fn(),
    overlayConfirm: vi.fn(),
    overlayCancel: vi.fn(),
    overlayPage: vi.fn(),
    toggleWheel: vi.fn(),
    toggleLegend: vi.fn(),
    stop: vi.fn(),
    padsChanged: vi.fn(),
    ...overrides,
  };
  return host as GamepadHost & { pads: readonly ConnectedPad[] };
}

/** Two samples, because a new direction is only answered on the second. */
function hold(adapter: GamepadAdapter, pad: PadSnapshot, at = 0): void {
  adapter.poll([pad], at);
  adapter.poll([pad], at + 16);
}

afterEach(() => { clearInputDoor(); });

describe("connection", () => {
  it("adopts a pad on its first sample and reports what it can do", () => {
    const surface = new ControlSurface();
    const seen: ConnectedPad[][] = [];
    const adapter = new GamepadAdapter(surface, stubHost({
      padsChanged: (pads) => { seen.push([...pads]); },
    }));
    adapter.poll([synthPad()], 0);
    adapter.poll([], 16);
    expect(seen).toHaveLength(2);
    expect(seen[0]![0]!.capabilities.buttonCount).toBe(17);
    expect(seen[0]![0]!.bindings.buttons[STANDARD_BUTTON.faceDown]).toBe("role:confirm");
    expect(seen[1]).toEqual([]);
  });
  it("samples rather than trusting a connection event, and idles when no pad answers", () => {
    const surface = new ControlSurface();
    const listeners = new Map<string, () => void>();
    const frames: (() => void)[] = [];
    const timers: (() => void)[] = [];
    let pads: PadSnapshot[] = [];
    const runtime = startGamepadRuntime(surface, stubHost(), {
      target: {
        addEventListener: (type: string, listener: EventListenerOrEventListenerObject) =>
          listeners.set(type, listener as () => void),
        removeEventListener: () => listeners.clear(),
      } as unknown as Window,
      frame: (callback) => { frames.push(() => callback(0)); return frames.length; },
      cancelFrame: () => {},
      timer: (callback) => { timers.push(callback); return timers.length; },
      cancelTimer: () => {},
      now: () => 0,
      source: { getGamepads: () => pads as unknown as (Gamepad | null)[] },
    });
    // Nothing connected: a slow check, not an animation-rate loop.
    expect(frames).toHaveLength(0);
    expect(timers).toHaveLength(1);
    pads = [synthPad()];
    listeners.get("gamepadconnected")?.();
    expect(runtime.adapter.connected()).toHaveLength(1);
    expect(frames).toHaveLength(1);
    runtime.stop();
    frames.pop()!();
    expect(frames).toHaveLength(0);
  });
});

describe("the game screen", () => {
  it("walks with the stick, the cross, and neither at once", () => {
    const surface = new ControlSurface();
    surface.setCommands(() => true, () => []);
    const log = recorder();
    const adapter = new GamepadAdapter(surface, stubHost());
    hold(adapter, synthPad({ axes: [0.9, -0.9, 0, 0] }));
    expect(log.keys).toEqual(["9"]);
    adapter.poll([synthPad()], 32); // Centred.
    hold(adapter, withButtons([STANDARD_BUTTON.dpadDown, STANDARD_BUTTON.dpadLeft]), 48);
    // A cross reaches the diagonals by holding two of its buttons.
    expect(log.keys).toEqual(["9", "1"]);
    log.dispose();
  });
  it("will not walk while the shell says a command cannot start", () => {
    const surface = new ControlSurface();
    surface.setCommands(() => false, () => []);
    const log = recorder();
    hold(new GamepadAdapter(surface, stubHost()), synthPad({ axes: [0, 0.9, 0, 0] }));
    expect(log.keys).toEqual([]);
    log.dispose();
  });
  it("repeats a held direction on the game's own clock, not the frame rate", () => {
    const surface = new ControlSurface();
    surface.setCommands(() => true, () => []);
    const log = recorder();
    const adapter = new GamepadAdapter(surface, stubHost());
    const pad = synthPad({ axes: [0.9, 0, 0, 0] });
    for (let now = 0; now <= DEFAULT_REPEAT.initialDelayMs + 48; now += 16) adapter.poll([pad], now);
    expect(log.keys).toEqual(["6", "6"]);
    log.dispose();
  });
  it("keeps the second stick off the map", () => {
    const surface = new ControlSurface();
    surface.setCommands(() => true, () => []);
    const log = recorder();
    hold(new GamepadAdapter(surface, stubHost()), synthPad({ axes: [0, 0, 0, -0.9] }));
    expect(log.keys).toEqual([]);
    log.dispose();
  });
});

describe("commands", () => {
  it("runs the command a binding names rather than pressing that command's key", () => {
    const surface = new ControlSurface();
    const fire = vi.fn();
    surface.setCommands(() => true, () => [
      { id: "fire", label: "Fire at nearest target", category: "Action commands", key: "h", run: fire },
    ]);
    const log = recorder();
    const adapter = new GamepadAdapter(surface, stubHost());
    adapter.poll([withButtons([STANDARD_BUTTON.faceUp])], 0);
    expect(fire).toHaveBeenCalledTimes(1);
    // No literal `h` crossed the door: what the roguelike keyset does to that
    // letter therefore cannot change which command this button runs.
    expect(log.keys).toEqual([]);
    log.dispose();
  });
  it("refuses to start a command inside a prompt", () => {
    const surface = new ControlSurface();
    const run = vi.fn();
    surface.setCommands(() => true, () => [
      { id: "get", label: "Pick up objects", category: "Manage items", key: "g", run },
    ]);
    surface.push({ kind: "item", label: "Throw which item?" });
    const adapter = new GamepadAdapter(surface, stubHost());
    adapter.poll([withButtons([STANDARD_BUTTON.faceLeft])], 0);
    expect(run).not.toHaveBeenCalled();
  });
  it("reads the second layer while the modifier is held, in the same frame", () => {
    const surface = new ControlSurface();
    const cast = vi.fn();
    const quaff = vi.fn();
    surface.setCommands(() => true, () => [
      { id: "cast", label: "Cast a spell", category: "Information", key: "m", run: cast },
      { id: "quaff", label: "Quaff a potion", category: "Items", key: "q", run: quaff },
    ]);
    const adapter = new GamepadAdapter(surface, stubHost());
    adapter.poll([withButtons([STANDARD_BUTTON.leftTrigger, STANDARD_BUTTON.faceDown])], 0);
    expect(cast).toHaveBeenCalledTimes(1);
    adapter.poll([withButtons([STANDARD_BUTTON.leftTrigger])], 16);
    adapter.poll([withButtons([STANDARD_BUTTON.leftTrigger, STANDARD_BUTTON.faceRight])], 32);
    expect(quaff).toHaveBeenCalledTimes(1);
  });
});

describe("prompts", () => {
  it("answers a direction prompt through the prompt's own reply", () => {
    const surface = new ControlSurface();
    const answers: string[] = [];
    const replies = directionActions().map((action) => ({
      ...action, run: () => answers.push(action.label),
    }));
    surface.push({ kind: "direction", label: "Choose a direction", replies: [...replies, cancelAction()] });
    const adapter = new GamepadAdapter(surface, stubHost());
    hold(adapter, synthPad({ axes: [-0.9, 0, 0, 0] }));
    expect(answers).toEqual(["W"]);
  });
  it("routes Cancel to the prompt's own cancel rather than to a bare Escape", () => {
    const surface = new ControlSurface();
    const cancelled = vi.fn();
    surface.push({
      kind: "check", label: "Really?",
      replies: [keyAction("Yes", "y"), { ...cancelAction(), run: cancelled }],
    });
    const adapter = new GamepadAdapter(surface, stubHost());
    adapter.poll([withButtons([STANDARD_BUTTON.faceRight])], 0);
    expect(cancelled).toHaveBeenCalledTimes(1);
  });
  it("moves the cursor in a list instead of choosing a row, and drops diagonals", () => {
    const surface = new ControlSurface();
    const chosen = vi.fn();
    surface.push({
      kind: "item", label: "Throw which item?",
      rows: [{ id: "row:0", label: "Flask", selected: true, run: chosen }],
    });
    const log = recorder();
    const adapter = new GamepadAdapter(surface, stubHost());
    hold(adapter, synthPad({ axes: [0, 0.9, 0, 0] }));
    adapter.poll([synthPad()], 32);
    hold(adapter, synthPad({ axes: [0.9, -0.9, 0, 0] }), 48);
    expect(log.keys).toEqual(["ArrowDown"]);
    expect(chosen).not.toHaveBeenCalled();
    log.dispose();
  });
  it("pages an item list through its own sources before falling back to a key", () => {
    const surface = new ControlSurface();
    const switched: string[] = [];
    surface.push({
      kind: "item", label: "Throw which item?",
      replies: [
        { id: "source:0", label: "Inventory", selected: true, run: () => switched.push("Inventory") },
        { id: "source:1", label: "Floor", run: () => switched.push("Floor") },
        cancelAction(),
      ],
    });
    const log = recorder();
    const adapter = new GamepadAdapter(surface, stubHost());
    adapter.poll([withButtons([STANDARD_BUTTON.rightShoulder])], 0);
    expect(switched).toEqual(["Floor"]);
    expect(log.keys).toEqual([]);
    log.dispose();
  });
  it("falls back to a page key where a prompt offers no sources", () => {
    const surface = new ControlSurface();
    surface.push({ kind: "menu", label: "Commands" });
    const log = recorder();
    const adapter = new GamepadAdapter(surface, stubHost());
    adapter.poll([withButtons([STANDARD_BUTTON.leftShoulder])], 0);
    expect(log.keys).toEqual(["PageUp"]);
    log.dispose();
  });
  it("leaves a text prompt's caret to the text prompt", () => {
    const surface = new ControlSurface();
    surface.push({
      kind: "text", label: "Name",
      text: { value: "", maxLength: 15, submit: () => {} },
    });
    const log = recorder();
    hold(new GamepadAdapter(surface, stubHost()), synthPad({ axes: [0, 0.9, 0, 0] }));
    expect(log.keys).toEqual([]);
    log.dispose();
  });
});

describe("controller overlays", () => {
  it("hands direction, confirm and cancel to an open overlay", () => {
    const surface = new ControlSurface();
    surface.setCommands(() => true, () => []);
    const host = stubHost({ overlayOpen: () => true });
    const log = recorder();
    const adapter = new GamepadAdapter(surface, host);
    hold(adapter, synthPad({ axes: [0, -0.9, 0, 0] }));
    adapter.poll([withButtons([STANDARD_BUTTON.faceDown])], 32);
    adapter.poll([withButtons([])], 48);
    adapter.poll([withButtons([STANDARD_BUTTON.faceRight])], 64);
    expect(host.overlayMove).toHaveBeenCalledWith(8);
    expect(host.overlayConfirm).toHaveBeenCalledTimes(1);
    expect(host.overlayCancel).toHaveBeenCalledTimes(1);
    // Nothing reached the game while the overlay owned the pad.
    expect(log.keys).toEqual([]);
    log.dispose();
  });
  it("swallows the press the mapping screen is waiting for", () => {
    const surface = new ControlSurface();
    const run = vi.fn();
    surface.setCommands(() => true, () => [
      { id: "get", label: "Pick up objects", category: "Manage items", key: "g", run },
    ]);
    const adapter = new GamepadAdapter(surface, stubHost());
    const seen: number[] = [];
    adapter.captureButton((index) => seen.push(index));
    adapter.poll([withButtons([STANDARD_BUTTON.faceLeft])], 0);
    expect(seen).toEqual([STANDARD_BUTTON.faceLeft]);
    expect(run).not.toHaveBeenCalled();
    expect(adapter.capturing()).toBe(false);
    // The capture is spent, so the next press is a command again.
    adapter.poll([withButtons([])], 16);
    adapter.poll([withButtons([STANDARD_BUTTON.faceLeft])], 32);
    expect(run).toHaveBeenCalledTimes(1);
  });
});
