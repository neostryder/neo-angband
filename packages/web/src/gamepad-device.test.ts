import { describe, expect, it, vi } from "vitest";
import {
  STANDARD_BUTTON, buttonName, describeCapabilities, describePad, padSignature,
  type PadSnapshot,
} from "./gamepad-device";
import { defaultBindings, loadBindings, rebind, roleOf, saveBindings } from "./gamepad-bindings";

function synthPad(overrides: Partial<PadSnapshot> = {}): PadSnapshot {
  const buttons = overrides.buttons
    ?? Array.from({ length: 17 }, () => ({ pressed: false, value: 0 }));
  return {
    id: "Xbox 360 Controller (STANDARD GAMEPAD Vendor: 045e Product: 028e)",
    index: 0, mapping: "standard", connected: true,
    axes: [0, 0, 0, 0], ...overrides, buttons,
  };
}

function pressed(count: number, down: readonly number[]): PadSnapshot["buttons"] {
  return Array.from({ length: count }, (_, index) => ({
    pressed: down.includes(index), value: down.includes(index) ? 1 : 0,
  }));
}

describe("what a pad actually reports", () => {
  it("counts capabilities from the live sample, not from the claimed mapping", () => {
    // Firefox has reported the same Xbox pad as 11 buttons and 8 axes on Linux
    // where Chrome reports 17 and 4. Both have to come out playable.
    const full = describeCapabilities(synthPad());
    expect(full).toMatchObject({ buttonCount: 17, dpad: true, triggers: true, sticks: 2 });
    const lean = describeCapabilities(synthPad({
      mapping: "", buttons: pressed(11, []), axes: [0, 0, 0, 0, 0, 0, 0, 0],
    }));
    expect(lean).toMatchObject({ standard: false, dpad: false, triggers: true, sticks: 2 });
    const tiny = describeCapabilities(synthPad({ buttons: pressed(4, []), axes: [0, 0] }));
    expect(tiny).toMatchObject({ shoulders: false, triggers: false, dpad: false, sticks: 1 });
  });
  it("names the button a player can see printed on their own device", () => {
    const nintendo = describeCapabilities(synthPad({ id: "057e-2009-Pro Controller" }));
    expect(nintendo.family).toBe("nintendo");
    // The bottom face button is index 0 everywhere; Nintendo prints B on it.
    expect(buttonName(nintendo.family, STANDARD_BUTTON.faceDown)).toBe("B");
    expect(buttonName(nintendo.family, STANDARD_BUTTON.faceRight)).toBe("A");
    expect(buttonName("xbox", STANDARD_BUTTON.faceDown)).toBe("A");
    expect(buttonName("playstation", STANDARD_BUTTON.faceDown)).toBe("Cross");
    expect(buttonName("generic", STANDARD_BUTTON.dpadLeft)).toBe("D-pad left");
  });
  it("reads a Steam-presented pad as the Xbox layout it is presenting", () => {
    const steam = describeCapabilities(synthPad({ id: "28de-11ff-Steam Virtual Gamepad" }));
    expect(steam.family).toBe("xbox");
  });
  it("does not read an Xbox pad as a PlayStation one for sharing a word", () => {
    // Measured in the browser: this exact id printed R2 on a trigger stamped RT,
    // because "Wireless Controller" is also the whole of a PlayStation 4 name.
    const xbox = describeCapabilities(synthPad({
      id: "Xbox Wireless Controller (STANDARD GAMEPAD Vendor: 045e Product: 0b12)",
    }));
    expect(xbox.family).toBe("xbox");
    expect(buttonName(xbox.family, STANDARD_BUTTON.rightTrigger)).toBe("RT");
    const sony = describeCapabilities(synthPad({ id: "Wireless Controller" }));
    expect(sony.family).toBe("playstation");
  });
  it("keys saved bindings on the shape, not on the browser's id text", () => {
    const chrome = synthPad();
    const firefox = synthPad({ id: "045e-028e-Xbox 360 Wired Controller" });
    expect(padSignature(describeCapabilities(chrome)))
      .toBe(padSignature(describeCapabilities(firefox)));
    expect(describePad(describeCapabilities(chrome))).toContain("d-pad");
  });
});

describe("default layouts", () => {
  it("reaches every command on a pad with four buttons and nothing else", () => {
    const bindings = defaultBindings(describeCapabilities(synthPad({ buttons: pressed(4, []), axes: [0, 0] })));
    const roles = Object.values(bindings.buttons).map(roleOf);
    expect(roles).toContain("confirm");
    expect(roles).toContain("cancel");
    // The wheel is what makes the rest of the game reachable at all here.
    expect(roles).toContain("commands");
    expect(Object.keys(bindings.buttons).every((index) => Number(index) < 4)).toBe(true);
  });
  it("drops the modifier rather than an essential role on a three-button pad", () => {
    const bindings = defaultBindings(describeCapabilities(synthPad({ buttons: pressed(3, []), axes: [] })));
    expect(Object.values(bindings.buttons).map(roleOf))
      .toEqual(["confirm", "cancel", "commands"]);
    expect(bindings.layer).toEqual({});
  });
  it("gives a full pad shoulders for paging and triggers for the two modes", () => {
    const bindings = defaultBindings(describeCapabilities(synthPad()));
    expect(bindings.buttons[STANDARD_BUTTON.leftShoulder]).toBe("role:page-prev");
    expect(bindings.buttons[STANDARD_BUTTON.rightShoulder]).toBe("role:page-next");
    expect(bindings.buttons[STANDARD_BUTTON.leftTrigger]).toBe("role:layer");
    expect(bindings.buttons[STANDARD_BUTTON.rightTrigger]).toBe("role:commands");
    expect(bindings.layer[STANDARD_BUTTON.faceDown]).toBe("cmd:m");
    expect(bindings.layer[STANDARD_BUTTON.leftTrigger]).toBeUndefined();
  });
  it("never binds a button the pad does not report", () => {
    for (const count of [1, 2, 3, 4, 6, 8, 11, 12, 16, 17]) {
      const capabilities = describeCapabilities(synthPad({ buttons: pressed(count, []) }));
      const bindings = defaultBindings(capabilities);
      for (const index of [...Object.keys(bindings.buttons), ...Object.keys(bindings.layer)]) {
        expect(Number(index), `${count} buttons`).toBeLessThan(count);
      }
    }
  });
});

describe("remapping", () => {
  it("moves a role rather than letting two buttons claim it", () => {
    const base = defaultBindings(describeCapabilities(synthPad()));
    const moved = rebind(base, STANDARD_BUTTON.faceUp, "role:cancel");
    expect(moved.buttons[STANDARD_BUTTON.faceUp]).toBe("role:cancel");
    expect(moved.buttons[STANDARD_BUTTON.faceRight]).toBeUndefined();
    // A command binding is not a role and may legitimately repeat.
    const twice = rebind(rebind(base, 2, "cmd:i"), 3, "cmd:i");
    expect(twice.buttons[2]).toBe("cmd:i");
    expect(twice.buttons[3]).toBe("cmd:i");
  });
  it("keeps a saved change and takes new defaults for everything else", () => {
    const store = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => { store.set(key, value); },
    });
    try {
      const capabilities = describeCapabilities(synthPad());
      const signature = padSignature(capabilities);
      saveBindings(signature, rebind(defaultBindings(capabilities), STANDARD_BUTTON.faceUp, "cmd:i"));
      const loaded = loadBindings(signature, capabilities);
      expect(loaded.buttons[STANDARD_BUTTON.faceUp]).toBe("cmd:i");
      expect(loaded.buttons[STANDARD_BUTTON.rightTrigger]).toBe("role:commands");
      // Another pad's layout is untouched by the save.
      expect(loadBindings("nintendo/standard/4/2", capabilities).buttons[STANDARD_BUTTON.faceUp])
        .not.toBe("cmd:i");
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("plays with defaults when storage is unreadable or holds nonsense", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => "{\"generic/raw/4/0\":{\"buttons\":{\"0\":\"nonsense\",\"1\":\"role:cancel\"}}}",
      setItem: () => { throw new Error("denied"); },
    });
    try {
      const capabilities = describeCapabilities(synthPad({ id: "unknown", mapping: "", buttons: pressed(4, []), axes: [] }));
      const loaded = loadBindings(padSignature(capabilities), capabilities);
      expect(loaded.buttons[0]).toBe("role:confirm");
      expect(loaded.buttons[1]).toBe("role:cancel");
      expect(() => saveBindings("generic/raw/4/0", loaded)).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
