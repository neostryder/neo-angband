import { describe, expect, it } from "vitest";
import { MAX_PROMPT_ASKS, modalPumpAction } from "./mod-pump";

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

  describe("a purchase prompt inside the store", () => {
    const buying = { storeOpen: false, holdsIntent: true, switchedOff: false, storeModal: true,
      promptKind: "quantity", holdsReply: true, promptAsks: 0 };

    it("asks the controller to answer a quantity or confirm prompt", () => {
      expect(modalPumpAction(buying)).toBe("drive-prompt");
      expect(modalPumpAction({ ...buying, promptKind: "confirm" })).toBe("drive-prompt");
    });

    it("keeps Escape for the -more- pager", () => {
      expect(modalPumpAction({ ...buying, promptKind: "ack" })).toBe("escape");
    });

    it("keeps Escape for a controller that cannot reply to prompts", () => {
      expect(modalPumpAction({ ...buying, holdsReply: false })).toBe("escape");
    });

    it("keeps Escape outside the store and with no prompt open", () => {
      expect(modalPumpAction({ ...buying, storeModal: false })).toBe("escape");
      expect(modalPumpAction({ ...buying, promptKind: null })).toBe("escape");
    });

    it("presses Escape once a controller has had its asks and left the prompt open", () => {
      expect(modalPumpAction({ ...buying, promptAsks: MAX_PROMPT_ASKS - 1 })).toBe("drive-prompt");
      expect(modalPumpAction({ ...buying, promptAsks: MAX_PROMPT_ASKS })).toBe("escape");
    });

    it("never asks a controller the player switched off", () => {
      expect(modalPumpAction({ ...buying, switchedOff: true })).toBe("escape");
    });
  });
});
