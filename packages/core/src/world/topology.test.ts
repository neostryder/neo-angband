import { describe, expect, it } from "vitest";
import { bindWorld } from "./topology.js";

describe("bindWorld", () => {
  it("uses world.json's named links instead of adjacent numeric depths", () => {
    const topology = bindWorld(
      [
        { level: { depth: 0, name: "Town", up: "None", down: "Angband 2" } },
        { level: { depth: 1, name: "Angband 1", up: "None", down: "None" } },
        { level: { depth: 2, name: "Angband 2", up: "Town", down: "None" } },
      ],
      3,
    );

    expect(topology.nextDepth(0, 1)).toBe(2);
    expect(topology.nextDepth(2, -1)).toBe(0);
    expect(topology.canTravel(1, 1)).toBe(false);
    expect(topology.nameAtDepth(2)).toBe("Angband 2");
  });

  it("rejects a link that does not name a composed level", () => {
    expect(() =>
      bindWorld(
        [{ level: { depth: 0, name: "Town", up: "None", down: "Missing" } }],
        1,
      ),
    ).toThrow(/invalid down reference Missing/u);
  });
});
