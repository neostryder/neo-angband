import { describe, expect, it } from "vitest";
import { createBootSaveGate } from "./boot-save-gate";

describe("boot save gate", () => {
  it("refuses saves until opened and remembers that one was asked for", () => {
    const gate = createBootSaveGate();
    expect(gate.admit()).toBe(false);
    expect(gate.admit()).toBe(false);
    expect(gate.open()).toBe(true);
    expect(gate.admit()).toBe(true);
  });

  it("asks for no catch-up save when nothing was requested early", () => {
    const gate = createBootSaveGate();
    expect(gate.open()).toBe(false);
    expect(gate.admit()).toBe(true);
  });

  it("reports a missed save only once", () => {
    const gate = createBootSaveGate();
    gate.admit();
    expect(gate.open()).toBe(true);
    expect(gate.open()).toBe(false);
  });
});
