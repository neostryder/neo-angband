import { describe, expect, it } from "vitest";
import { bootPhase, onBootPhaseChanged, setBootPhase } from "./presentation-phase";

describe("the presentation boot phase", () => {
  it("reports title, birth and play transitions once and stops after unsubscribe", () => {
    setBootPhase("title");
    const heard: string[] = [];
    const off = onBootPhaseChanged((phase) => {
      expect(bootPhase()).toBe(phase);
      heard.push(phase);
    });
    setBootPhase("birth");
    setBootPhase("birth");
    setBootPhase("title");
    setBootPhase("birth");
    setBootPhase("play");
    off();
    setBootPhase("title");
    expect(heard).toEqual(["birth", "title", "birth", "play"]);
  });
});
