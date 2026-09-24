import { describe, expect, it } from "vitest";
import {
  DELVE_FORMAT_VERSION,
  DELVE_MAGIC,
  buildDelveFile,
  classifyDelveInstalled,
  decodeDelve,
  delveFilename,
  delveFlagChoices,
  encodeDelve,
  resolveDelveEnabledIds,
  resolveDelveImportPlan,
  resolveDelveModVersion,
  selectDelveMods,
  type DelveDiscover,
  type DelveDiscoveredMod,
  type DelveMod,
} from "./mod-delve";

function mod(over: Partial<DelveMod> = {}): DelveMod {
  return {
    id: "qol",
    name: "Quality of Life",
    repo: "neostryder/neo-angband-mod-qol",
    tag: "v1.4.0",
    version: "1.4.0",
    enabled: true,
    flags: { "qol.autoDig": true, "qol.showDamage": false },
    ...over,
  };
}

function discovered(over: Partial<DelveDiscoveredMod> = {}): DelveDiscoveredMod {
  return {
    repo: "neostryder/neo-angband-mod-qol",
    tag: "v1.4.0",
    version: "1.4.0",
    compatible: true,
    engineNote: null,
    ...over,
  };
}

describe("encodeDelve / decodeDelve round-trip", () => {
  it("round-trips a full file, mods and options included", () => {
    const file = buildDelveFile({
      name: "Ironman race ruleset",
      description: "Matches #ironman-race.",
      createdAt: "2026-08-23T18:04:00.000Z",
      createdWithEngine: "0.20.0",
      mods: [
        mod(),
        mod({ id: "bug-fixes", name: "Unofficial bug fixes", enabled: false, flags: {} }),
      ],
      options: {
        birth: { birth_point_based: true, birth_no_selling: false },
        game: {
          values: { rogue_like_commands: false, auto_more: true },
          hitpointWarn: 3,
          delayFactor: 40,
          lazymoveDelay: 0,
        },
      },
    });
    const text = encodeDelve(file);
    const decoded = decodeDelve(text);
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.recognized).toBe(true);
    expect(decoded.file).toEqual(file);
    expect(decoded.file.magic).toBe(DELVE_MAGIC);
    expect(decoded.file.formatVersion).toBe(DELVE_FORMAT_VERSION);
  });

  it("round-trips with no options block at all", () => {
    const file = buildDelveFile({
      name: "Bare",
      createdAt: "2026-08-23T18:04:00.000Z",
      createdWithEngine: "0.20.0",
      mods: [mod()],
    });
    const decoded = decodeDelve(encodeDelve(file));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.file.options).toBeUndefined();
  });

  it("preserves the raw flag CHOICE, not a resolved value", () => {
    const file = buildDelveFile({
      name: "x",
      createdAt: "now",
      createdWithEngine: "0.20.0",
      mods: [mod({ flags: { "qol.autoDig": false } })],
    });
    const decoded = decodeDelve(encodeDelve(file));
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(decoded.file.mods[0]?.flags).toEqual({ "qol.autoDig": false });
  });
});

describe("decodeDelve gating", () => {
  it("refuses non-JSON before reading anything else", () => {
    const r = decodeDelve("not json at all {{{");
    expect(r.ok).toBe(false);
  });

  it("refuses a wrong or missing magic, before checking the version", () => {
    const wrong = decodeDelve(JSON.stringify({ magic: "neo-angband-character", formatVersion: 999 }));
    expect(wrong.ok).toBe(false);
    const missing = decodeDelve(JSON.stringify({ formatVersion: 1, mods: [] }));
    expect(missing.ok).toBe(false);
  });

  it("refuses a file with no formatVersion at all", () => {
    const r = decodeDelve(JSON.stringify({ magic: DELVE_MAGIC, mods: [] }));
    expect(r.ok).toBe(false);
  });

  it("refuses an unparseable shape even under a recognised magic, naming the version", () => {
    const r = decodeDelve(
      JSON.stringify({ magic: DELVE_MAGIC, formatVersion: 47, mods: "not-a-list" }),
    );
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.why).toContain("47");
  });

  it("degrades rather than refuses a future formatVersion whose shape still parses", () => {
    const r = decodeDelve(
      JSON.stringify({
        magic: DELVE_MAGIC,
        formatVersion: 2,
        name: "future",
        createdAt: "now",
        createdWithEngine: "0.99.0",
        mods: [{ id: "qol", repo: "neostryder/neo-angband-mod-qol", tag: "v2.0.0", enabled: true, flags: {} }],
        somethingThisBuildHasNeverHeardOf: true,
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.recognized).toBe(false);
      expect(r.file.mods).toHaveLength(1);
    }
  });

  it("skips a malformed mod entry rather than refusing the whole file", () => {
    const r = decodeDelve(
      JSON.stringify({
        magic: DELVE_MAGIC,
        formatVersion: 1,
        name: "x",
        createdAt: "now",
        createdWithEngine: "0.20.0",
        mods: [
          { id: "qol", repo: "neostryder/neo-angband-mod-qol", tag: "v1.0.0", enabled: true, flags: {} },
          { name: "no id or repo, malformed" },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.file.mods).toHaveLength(1);
  });
});

describe("selectDelveMods: off means absent", () => {
  it("drops an unchecked mod entirely rather than marking it disabled", () => {
    const candidates = [mod({ id: "qol" }), mod({ id: "bug-fixes", repo: "x/y" })];
    const out = selectDelveMods(candidates, new Set(["qol"]));
    expect(out.map((m) => m.id)).toEqual(["qol"]);
    expect(out.find((m) => m.id === "bug-fixes")).toBeUndefined();
  });

  it("always writes enabled:true for whatever the checklist accepted", () => {
    const out = selectDelveMods([mod({ enabled: false })], new Set(["qol"]));
    expect(out[0]?.enabled).toBe(true);
  });
});

describe("classifyDelveInstalled", () => {
  it("classifies not-installed, same-version, and different-version", () => {
    expect(classifyDelveInstalled(mod({ tag: "v1.4.0" }), null)).toBe("not-installed");
    expect(classifyDelveInstalled(mod({ tag: "v1.4.0" }), "v1.4.0")).toBe("same-version");
    expect(classifyDelveInstalled(mod({ tag: "v1.4.0" }), "v1.3.0")).toBe("different-version");
  });
});

describe("resolveDelveModVersion: the version-mismatch walk", () => {
  it("uses the named tag exactly as named when it installs cleanly", async () => {
    const discover: DelveDiscover = async (ref) => {
      expect(ref.tag).toBe("v1.4.0");
      return { ok: true, mod: discovered({ tag: "v1.4.0", compatible: true }) };
    };
    const r = await resolveDelveModVersion(mod({ tag: "v1.4.0" }), discover);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.usedRequestedTag).toBe(true);
      expect(r.mod.tag).toBe("v1.4.0");
    }
  });

  it("falls back to the newest-runnable walk when the named tag will not run here", async () => {
    let sawPinned = false;
    let sawWalk = false;
    const discover: DelveDiscover = async (ref) => {
      if (ref.tag === "v2.0.0") {
        sawPinned = true;
        return { ok: true, mod: discovered({ tag: "v2.0.0", compatible: false, engineNote: "too new" }) };
      }
      sawWalk = true;
      return { ok: true, mod: discovered({ tag: "v1.4.0", compatible: true }) };
    };
    const r = await resolveDelveModVersion(mod({ tag: "v2.0.0" }), discover);
    expect(sawPinned).toBe(true);
    expect(sawWalk).toBe(true);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.usedRequestedTag).toBe(false);
      expect(r.mod.tag).toBe("v1.4.0");
    }
  });

  it("falls back to the walk when the named tag cannot be found at all", async () => {
    const discover: DelveDiscover = async (ref) =>
      ref.tag === "v9.9.9"
        ? { ok: false, problem: "not found at this tag (HTTP 404)" }
        : { ok: true, mod: discovered({ tag: "v1.4.0", compatible: true }) };
    const r = await resolveDelveModVersion(mod({ tag: "v9.9.9" }), discover);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.mod.tag).toBe("v1.4.0");
  });

  it("reports a mod unreachable when nothing in the walk runs here", async () => {
    const discover: DelveDiscover = async () => ({
      ok: true,
      mod: discovered({ compatible: false, engineNote: "needs a newer game" }),
    });
    const r = await resolveDelveModVersion(mod(), discover);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("newer game");
  });

  it("reports a mod unreachable when the repository itself cannot be reached", async () => {
    const discover: DelveDiscover = async () => ({ ok: false, problem: "could not reach GitHub" });
    const r = await resolveDelveModVersion(mod(), discover);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain("GitHub");
  });
});

describe("resolveDelveImportPlan: one bad mod does not cost the rest", () => {
  it("resolves every entry independently, including one whose discover rejects", async () => {
    const entries = [mod({ id: "ok" }), mod({ id: "boom", repo: "x/boom" })];
    const discover: DelveDiscover = async (ref) => {
      if (ref.repo === "x/boom") throw new Error("network exploded");
      return { ok: true, mod: discovered({ tag: ref.tag ?? "v1.4.0", compatible: true }) };
    };
    const plan = await resolveDelveImportPlan(entries, new Map(), discover);
    expect(plan).toHaveLength(2);
    const ok = plan.find((r) => r.entry.id === "ok");
    const boom = plan.find((r) => r.entry.id === "boom");
    expect(ok?.resolution?.ok).toBe(true);
    expect(boom?.resolution?.ok).toBe(false);
    if (boom?.resolution?.ok === false) expect(boom.resolution.reason).toContain("network exploded");
  });

  it("does not resolve a same-version row over the network at all", async () => {
    let calls = 0;
    const discover: DelveDiscover = async (ref) => {
      calls++;
      return { ok: true, mod: discovered({ tag: ref.tag ?? "v1.4.0", compatible: true }) };
    };
    const plan = await resolveDelveImportPlan(
      [mod({ id: "qol", tag: "v1.4.0" })],
      new Map([["qol", "v1.4.0"]]),
      discover,
    );
    expect(plan[0]?.state).toBe("same-version");
    expect(plan[0]?.resolution).toBeUndefined();
    expect(calls).toBe(0);
  });
});

describe("resolveDelveEnabledIds: merge or replace", () => {
  it("replace mode matches the file exactly, dropping anything not named", () => {
    const out = resolveDelveEnabledIds({
      currentEnabled: ["already-on", "will-be-dropped"],
      entries: [
        { id: "qol", enabled: true },
        { id: "bug-fixes", enabled: false },
      ],
      replace: true,
    });
    expect(out).toEqual(["qol"]);
  });

  it("add mode keeps everything already on and adds the named-enabled mods", () => {
    const out = resolveDelveEnabledIds({
      currentEnabled: ["already-on"],
      entries: [{ id: "qol", enabled: true }],
      replace: false,
    });
    expect(out).toEqual(["already-on", "qol"]);
  });

  it("add mode turns off a mod the file explicitly names enabled:false", () => {
    const out = resolveDelveEnabledIds({
      currentEnabled: ["already-on"],
      entries: [{ id: "already-on", enabled: false }],
      replace: false,
    });
    expect(out).toEqual([]);
  });

  it("add mode never touches a mod the file does not name", () => {
    const out = resolveDelveEnabledIds({
      currentEnabled: ["untouched"],
      entries: [{ id: "qol", enabled: true }],
      replace: false,
    });
    expect(out).toContain("untouched");
  });
});

describe("delveFlagChoices", () => {
  it("pools flags across every accepted mod into one flat map", () => {
    const out = delveFlagChoices([
      mod({ flags: { "qol.autoDig": true } }),
      mod({ id: "bug-fixes", flags: { "bugfix.foo": false } }),
    ]);
    expect(out).toEqual({ "qol.autoDig": true, "bugfix.foo": false });
  });
});

describe("delveFilename", () => {
  it("produces a safe filename with the .ndelve extension", () => {
    expect(delveFilename("Ironman race ruleset!")).toMatch(/\.ndelve$/);
    expect(delveFilename("")).toBe("delve.ndelve");
  });
});
