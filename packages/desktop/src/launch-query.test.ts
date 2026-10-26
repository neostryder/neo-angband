import { describe, expect, it } from "vitest";
import { labShell, rendererQuery, SAFE_MODE_SWITCH } from "./launch-query";

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

  it("passes --log to any build, for the four level names only", () => {
    expect(rendererQuery(["--log=info"], {}, false)).toBe("?log=info");
    expect(rendererQuery(["--log=debug"], {}, true)).toBe("?log=debug");
    expect(rendererQuery(["--log=loud"], {}, false)).toBe("");
    expect(rendererQuery(["--log="], {}, false)).toBe("");
  });
  it("passes --lab-seed to a lab shell only, and only a whole 32-bit number", () => {
    expect(rendererQuery(["--lab-seed=1234"], {}, true)).toBe("?seed=1234");
    expect(rendererQuery(["--lab-seed=1234"], {}, false)).toBe("");
    expect(rendererQuery(["--lab-seed=4294967295"], {}, true)).toBe("?seed=4294967295");
    for (const bad of ["--lab-seed=", "--lab-seed=-1", "--lab-seed=1.5", "--lab-seed=abc", "--lab-seed=4294967296"]) {
      expect(rendererQuery([bad], {}, true)).toBe("");
    }
    expect(rendererQuery(["--lab-seed=7", "--lab-trust=qol"], {}, true)).toBe("?labtrust=qol&seed=7");
  });

  it("passes --lab-trust to a lab shell only", () => {
    expect(rendererQuery(["--lab-trust=anybandui,squire"], {}, true)).toBe("?labtrust=anybandui%2Csquire");
    expect(rendererQuery(["--lab-trust=anybandui,squire"], {}, false)).toBe("");
    expect(rendererQuery(["--lab-trust="], {}, true)).toBe("");
    expect(labShell()).toBe(false);
  });

  it("leaves the agent query as agent-mode writes it", () => {
    expect(rendererQuery([], { NEO_ANGBAND_AGENT: "a&b" })).toBe("?agent=a%26b");
  });
});
