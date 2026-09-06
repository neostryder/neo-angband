import { describe, expect, it } from "vitest";
import { clearKeymaps, keymapAdd, keymapFind } from "./keymap-store";
import { createModKeymaps, releaseModKeymaps } from "./macro-runtime";

describe("the consented plugin keymap facade", () => {
  it("binds a free trigger through the live store and never replaces one", () => {
    clearKeymaps();
    const state = { options: { get: () => false } } as never;
    const keymaps = createModKeymaps("first", state);
    expect(keymaps.isBindableTriggerKey("F1")).toBe(true);
    expect(keymaps.bind("F1", "A")).toBe(true);
    expect(keymapFind("orig", "F1")).toBe("A");
    expect(keymaps.isBindableTriggerKey("F1")).toBe(false);
    expect(keymaps.bind("F1", "m")).toBe(false);
    expect(keymapFind("orig", "F1")).toBe("A");
  });

  it("lists and rebinds only the calling mod's bindings", () => {
    clearKeymaps();
    const state = { options: { get: () => false } } as never;
    const first = createModKeymaps("first", state);
    const second = createModKeymaps("second", state);
    keymapAdd("orig", "P", "player");
    expect(first.bind("F1", "A")).toBe(true);
    expect(second.bind("F2", "B")).toBe(true);

    expect(first.entries()).toEqual([{ trigger: "F1", action: "A" }]);
    expect(second.entries()).toEqual([{ trigger: "F2", action: "B" }]);
    expect(first.rebind("F1", "C")).toBe(true);
    expect(keymapFind("orig", "F1")).toBe("C");
    expect(first.rebind("F2", "no")).toBe(false);
    expect(first.rebind("P", "no")).toBe(false);
    expect(keymapFind("orig", "F2")).toBe("B");
    expect(keymapFind("orig", "P")).toBe("player");
  });

  it("removes only its own binding and preserves a player takeover on teardown", () => {
    clearKeymaps();
    const state = { options: { get: () => false } } as never;
    const first = createModKeymaps("first", state);
    const second = createModKeymaps("second", state);
    expect(first.bind("F1", "A")).toBe(true);
    expect(second.bind("F2", "B")).toBe(true);
    expect(first.remove("F2")).toBe(false);
    expect(first.remove("F1")).toBe(true);
    expect(keymapFind("orig", "F1")).toBeNull();

    expect(first.bind("F1", "A")).toBe(true);
    keymapAdd("orig", "F1", "player");
    releaseModKeymaps("first");
    releaseModKeymaps("second");
    expect(keymapFind("orig", "F1")).toBe("player");
    expect(keymapFind("orig", "F2")).toBeNull();
  });
});
