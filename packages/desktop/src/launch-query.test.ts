import { describe, expect, it } from "vitest";
import { rendererQuery, SAFE_MODE_SWITCH } from "./launch-query";

describe("rendererQuery", () => {
  it("is empty for an ordinary launch", () => {
    expect(rendererQuery(["Neo Angband.exe"], {})).toBe("");
  });

  it("turns --safe-mode into the renderer's safe flag", () => {
    expect(rendererQuery(["Neo Angband.exe", SAFE_MODE_SWITCH], {})).toBe("?safe=1");
  });

  it("carries an agent and safe mode together", () => {
    expect(rendererQuery([SAFE_MODE_SWITCH], { NEO_ANGBAND_AGENT: "demo-wanderer" })).toBe(
      "?agent=demo-wanderer&safe=1",
    );
  });

  it("matches the switch exactly", () => {
    /* A value or a near-miss spelling is not the switch; guessing would start
     * a player's game without mods they did not ask to lose. */
    expect(rendererQuery(["--safe-mode=0", "--safemode", "-safe-mode"], {})).toBe("");
  });

  it("leaves the agent query as agent-mode writes it", () => {
    expect(rendererQuery([], { NEO_ANGBAND_AGENT: "a&b" })).toBe("?agent=a%26b");
  });
});
