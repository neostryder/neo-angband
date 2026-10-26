import { describe, expect, it } from "vitest";
import { modalPumpAction } from "./mod-pump";

describe("modalPumpAction", () => {
  const shopping = { storeOpen: true, holdsIntent: true, switchedOff: false };

  it("lets a controller with input:intent act in an open store", () => {
    expect(modalPumpAction(shopping)).toBe("drive-store");
  });

  it("answers every other modal with Escape, as before", () => {
    expect(modalPumpAction({ ...shopping, storeOpen: false })).toBe("escape");
  });

  it("keeps Escape for a controller that cannot submit intents", () => {
    expect(modalPumpAction({ ...shopping, holdsIntent: false })).toBe("escape");
  });

  it("closes the store of a controller the player switched off", () => {
    expect(modalPumpAction({ ...shopping, switchedOff: true })).toBe("escape");
  });
});
