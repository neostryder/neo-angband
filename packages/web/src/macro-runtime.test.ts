import { describe, expect, it } from "vitest";
import { clearKeymaps, keymapFind } from "./keymap-store";
import { createModKeymaps } from "./macro-runtime";

describe("the consented plugin keymap facade", () => {
  it("binds a free trigger through the live store and never replaces one", () => {
    clearKeymaps();
    const state = { options: { get: () => false } } as never;
    const keymaps = createModKeymaps(state);
    expect(keymaps.isBindableTriggerKey("F1")).toBe(true);
    expect(keymaps.bind("F1", "A")).toBe(true);
    expect(keymapFind("orig", "F1")).toBe("A");
    expect(keymaps.isBindableTriggerKey("F1")).toBe(false);
    expect(keymaps.bind("F1", "m")).toBe(false);
    expect(keymapFind("orig", "F1")).toBe("A");
  });
});
