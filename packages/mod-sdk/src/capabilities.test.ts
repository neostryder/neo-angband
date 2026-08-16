import { describe, expect, it } from "vitest";
import {
  CapabilityError,
  CapabilitySet,
  parseCapability,
} from "./capabilities.js";
import type { PackManifest, PackShape } from "./manifest.js";

/** Build a minimal manifest for capability tests; only set the fields we need. */
function manifest(
  shape: PackShape,
  extra?: Partial<Pick<PackManifest, "capabilities" | "nondeterministic" | "affectsGameplay">>,
): PackManifest {
  const m: PackManifest = {
    id: "frost",
    name: "Frost",
    version: "1.0.0",
    shape,
  };
  if (extra?.capabilities) m.capabilities = extra.capabilities;
  if (extra?.nondeterministic !== undefined) {
    m.nondeterministic = extra.nondeterministic;
  }
  if (extra?.affectsGameplay !== undefined) {
    m.affectsGameplay = extra.affectsGameplay;
  }
  return m;
}

describe("parseCapability: valid forms", () => {
  it("parses command:add", () => {
    expect(parseCapability("command:add")).toEqual({
      kind: "command",
      action: "add",
    });
  });

  it("parses event:<name>", () => {
    expect(parseCapability("event:turn-start")).toEqual({
      kind: "event",
      name: "turn-start",
    });
  });

  it("parses state:<domain>.read", () => {
    expect(parseCapability("state:party.read")).toEqual({
      kind: "state",
      domain: "party",
      access: "read",
    });
  });

  it("parses the state:*.read wildcard", () => {
    expect(parseCapability("state:*.read")).toEqual({
      kind: "state",
      domain: "*",
      access: "read",
    });
  });

  it("parses network:<host>", () => {
    expect(parseCapability("network:api.example.com")).toEqual({
      kind: "network",
      host: "api.example.com",
    });
  });

  it("parses the network:* wildcard", () => {
    expect(parseCapability("network:*")).toEqual({
      kind: "network",
      host: "*",
    });
  });

  it("parses registry:<domain> for each override domain", () => {
    for (const domain of [
      "effect",
      "room",
      "command",
      "monster",
      "vocab",
    ] as const) {
      expect(parseCapability(`registry:${domain}`)).toEqual({
        kind: "registry",
        domain,
      });
    }
  });

  it("parses the registry:* wildcard", () => {
    expect(parseCapability("registry:*")).toEqual({
      kind: "registry",
      domain: "*",
    });
  });

  it("parses ui:<region>.replace for each HUD region, and the wildcard", () => {
    for (const region of ["messages", "sidebar", "status"] as const) {
      expect(parseCapability(`ui:${region}.replace`)).toEqual({
        kind: "ui",
        region,
        action: "replace",
      });
    }
    expect(parseCapability("ui:*.replace")).toEqual({
      kind: "ui",
      region: "*",
      action: "replace",
    });
  });

  it("rejects ui:map.replace - the dungeon is display:replace's", () => {
    /* One region answering to two capabilities would be two answers to "who
     * draws this", and the one a mod would reach for is the wrong one. */
    expect(() => parseCapability("ui:map.replace")).toThrow(CapabilityError);
    expect(() => parseCapability("ui:sidebar")).toThrow(CapabilityError);
    expect(() => parseCapability("ui:*")).toThrow(CapabilityError);
  });

  it("parses ui:region.create as the ui kind with a different ACTION (#261)", () => {
    expect(parseCapability("ui:region.create")).toEqual({
      kind: "ui",
      region: "region",
      action: "create",
    });
  });

  it("has no create wildcard and no replace/create crossovers (#261)", () => {
    /* There is no set of region names to range over - the region does not exist
     * until the mod declares it - so a wildcard here would be a wildcard over
     * nothing. And the six replaceable names are not creatable: `ui:sidebar
     * .create` is not "make me a sidebar", it is a typo. */
    expect(() => parseCapability("ui:*.create")).toThrow(CapabilityError);
    expect(() => parseCapability("ui:sidebar.create")).toThrow(CapabilityError);
    expect(() => parseCapability("ui:region.replace")).toThrow(CapabilityError);
  });
});

describe("backup:folder (#133)", () => {
  it("parses backup:folder as its own kind, with no domain and no wildcard", () => {
    expect(parseCapability("backup:folder")).toEqual({
      kind: "backup",
      action: "folder",
    });
  });

  it("rejects backup:file and backup:* - there is deliberately no wildcard", () => {
    expect(() => parseCapability("backup:file")).toThrow(CapabilityError);
    expect(() => parseCapability("backup:*")).toThrow(CapabilityError);
  });

  it("registry:* does not cover it, same as display:replace", () => {
    const wild = CapabilitySet.fromManifest(
      manifest("plugin", { capabilities: ["registry:*"] }),
    );
    expect(wild.has("backup:folder")).toBe(false);
  });

  it("grants exactly backup:folder and nothing else", () => {
    const set = CapabilitySet.fromManifest(
      manifest("plugin", { capabilities: ["backup:folder"] }),
    );
    expect(set.has("backup:folder")).toBe(true);
    expect(set.has("display:replace")).toBe(false);
  });
});

describe("parseCapability: rejects garbage", () => {
  it("rejects an unknown capability kind", () => {
    expect(() => parseCapability("filesystem:read")).toThrow(CapabilityError);
  });

  it("rejects command with a bogus action", () => {
    expect(() => parseCapability("command:remove")).toThrow(CapabilityError);
  });

  it("rejects a malformed event name", () => {
    expect(() => parseCapability("event:")).toThrow(CapabilityError);
    expect(() => parseCapability("event:Turn-Start")).toThrow(CapabilityError);
  });

  it("rejects a state capability missing .read", () => {
    expect(() => parseCapability("state:party")).toThrow(CapabilityError);
    expect(() => parseCapability("state:party.write")).toThrow(CapabilityError);
  });

  it("rejects an empty network host", () => {
    expect(() => parseCapability("network:")).toThrow(CapabilityError);
  });

  it("rejects a bare unprefixed string", () => {
    expect(() => parseCapability("party.read")).toThrow(CapabilityError);
  });

  it("accepts registry:profile, the dungeon-profile override domain", () => {
    expect(parseCapability("registry:profile")).toEqual({
      kind: "registry",
      domain: "profile",
    });
  });

  it("accepts registry:projection, the projection-handler domain", () => {
    /* The grammar is an ALLOWLIST, so a domain the registry host gates but the
     * regex has never heard of is refused at install with a typo error - the
     * capability would look declared and never be granted. Added when the
     * projection registries got a producer; asserted so the next domain cannot
     * be half-added the same way. */
    expect(parseCapability("registry:projection")).toEqual({
      kind: "registry",
      domain: "projection",
    });
  });

  it("rejects an unknown registry domain", () => {
    expect(() => parseCapability("registry:player")).toThrow(CapabilityError);
    expect(() => parseCapability("registry:")).toThrow(CapabilityError);
  });

  it("names the bad capability in the error message", () => {
    expect(() => parseCapability("nonsense")).toThrow(/nonsense/);
  });
});

describe("CapabilitySet.fromManifest: shape gating", () => {
  it("throws when a content pack requests capabilities", () => {
    expect(() =>
      CapabilitySet.fromManifest(
        manifest("content", { capabilities: ["command:add"] }),
      ),
    ).toThrow(CapabilityError);
    expect(() =>
      CapabilitySet.fromManifest(
        manifest("content", { capabilities: ["command:add"] }),
      ),
    ).toThrow(/only shape "plugin" packs may request capabilities/);
  });

  it("throws when a tiles pack requests capabilities", () => {
    expect(() =>
      CapabilitySet.fromManifest(
        manifest("tiles", { capabilities: ["network:*"] }),
      ),
    ).toThrow(CapabilityError);
  });

  it("allows a content pack with no capabilities field", () => {
    expect(() => CapabilitySet.fromManifest(manifest("content"))).not.toThrow();
  });

  it("allows a plugin with no capabilities requested", () => {
    const set = CapabilitySet.fromManifest(manifest("plugin"));
    expect(set.has("command:add")).toBe(false);
  });
});

describe("CapabilitySet: has / check", () => {
  it("grants exact command:add", () => {
    const set = CapabilitySet.fromManifest(
      manifest("plugin", { capabilities: ["command:add"] }),
    );
    expect(set.has("command:add")).toBe(true);
    expect(() => set.check("command:add")).not.toThrow();
  });

  it("does not grant an ungranted command", () => {
    const set = CapabilitySet.fromManifest(manifest("plugin"));
    expect(set.has("command:add")).toBe(false);
  });

  it("grants an exact event and rejects a different one", () => {
    const set = CapabilitySet.fromManifest(
      manifest("plugin", { capabilities: ["event:turn-start"] }),
    );
    expect(set.has("event:turn-start")).toBe(true);
    expect(set.has("event:turn-end")).toBe(false);
  });

  it("grants an exact state read and rejects a different domain", () => {
    const set = CapabilitySet.fromManifest(
      manifest("plugin", { capabilities: ["state:party.read"] }),
    );
    expect(set.has("state:party.read")).toBe(true);
    expect(set.has("state:dungeon.read")).toBe(false);
  });

  it("state:*.read grants any specific domain read", () => {
    const set = CapabilitySet.fromManifest(
      manifest("plugin", { capabilities: ["state:*.read"] }),
    );
    expect(set.has("state:party.read")).toBe(true);
    expect(set.has("state:dungeon.read")).toBe(true);
  });

  it("a specific state grant does not satisfy the wildcard request", () => {
    const set = CapabilitySet.fromManifest(
      manifest("plugin", { capabilities: ["state:party.read"] }),
    );
    expect(set.has("state:*.read")).toBe(false);
  });

  it("grants an exact registry domain and rejects a different one", () => {
    const set = CapabilitySet.fromManifest(
      manifest("plugin", { capabilities: ["registry:effect"] }),
    );
    expect(set.has("registry:effect")).toBe(true);
    expect(set.has("registry:monster")).toBe(false);
  });

  it("registry:* grants every override domain", () => {
    const set = CapabilitySet.fromManifest(
      manifest("plugin", { capabilities: ["registry:*"] }),
    );
    expect(set.has("registry:effect")).toBe(true);
    expect(set.has("registry:room")).toBe(true);
    expect(set.has("registry:profile")).toBe(true);
    expect(set.has("registry:command")).toBe(true);
    expect(set.has("registry:monster")).toBe(true);
    expect(set.has("registry:vocab")).toBe(true);
  });

  it("grants one HUD region and refuses the other two", () => {
    const set = CapabilitySet.fromManifest(
      manifest("plugin", { capabilities: ["ui:sidebar.replace"] }),
    );
    expect(set.has("ui:sidebar.replace")).toBe(true);
    expect(set.has("ui:status.replace")).toBe(false);
    expect(set.has("ui:messages.replace")).toBe(false);
  });

  it("ui:*.replace grants every region", () => {
    const set = CapabilitySet.fromManifest(
      manifest("plugin", { capabilities: ["ui:*.replace"] }),
    );
    expect(set.has("ui:messages.replace")).toBe(true);
    expect(set.has("ui:sidebar.replace")).toBe(true);
    expect(set.has("ui:status.replace")).toBe(true);
  });

  /* ----------------------------------------------------------------------- *
   * THE ACTION IS PART OF THE GRANT (#261).
   *
   * `grantCovers`' ui arm compared only `region`, which was invisible for as
   * long as `action` had one value: every ui capability was a `.replace`, so
   * comparing it would have been comparing a constant to itself. The moment
   * `ui:region.create` existed, `ui:*.replace` covered it - a mod granted "draw
   * the vitals instead of the game" silently inherited "put new furniture of
   * your own on the player's screen", which is a grant nobody showed them and
   * nobody approved.
   *
   * THIS IS WHY IT NEEDS ITS OWN TEST RATHER THAN RIDING ON A REAL MOD. There
   * is no manifest in the repository that would fail: the escalation is only
   * reachable from a capability string that did not exist until this commit, so
   * the subject has to be CONSTRUCTED. A fix with no failing subject behind it
   * is a claim, and this file is where the claim is made checkable.
   * ----------------------------------------------------------------------- */
  it("ui:*.replace does NOT cover ui:region.create - the wildcard is over regions, not actions (#261)", () => {
    const set = CapabilitySet.fromManifest(
      manifest("plugin", { capabilities: ["ui:*.replace"] }),
    );
    /* The control: the wildcard still does the job it was granted for, so a
     * "false" below cannot be a wildcard that stopped working altogether. */
    expect(set.has("ui:sidebar.replace")).toBe(true);
    expect(set.has("ui:region.create")).toBe(false);
  });

  it("ui:region.create does not cover any replace, wildcard or named (#261)", () => {
    /* The other direction, which the region-name comparison alone WOULD have
     * caught for the named regions and would not have caught if the create
     * string had ever been spelled with a "*". Asserted so that the two halves
     * of the arm are both pinned rather than only the half that broke. */
    const set = CapabilitySet.fromManifest(
      manifest("plugin", { capabilities: ["ui:region.create"] }),
    );
    expect(set.has("ui:region.create")).toBe(true);
    expect(set.has("ui:sidebar.replace")).toBe(false);
    expect(set.has("ui:menu.replace")).toBe(false);
    expect(set.has("ui:screen.replace")).toBe(false);
    expect(set.has("display:replace")).toBe(false);
  });

  it("the map and the HUD are two consents, in BOTH directions", () => {
    /* Taking the dungeon is not taking the vitals, and taking the whole
     * interface is not taking the dungeon. A mod that wants both says both. */
    const map = CapabilitySet.fromManifest(
      manifest("plugin", { capabilities: ["display:replace"] }),
    );
    expect(map.has("ui:sidebar.replace")).toBe(false);
    const hud = CapabilitySet.fromManifest(
      manifest("plugin", { capabilities: ["ui:*.replace"] }),
    );
    expect(hud.has("display:replace")).toBe(false);
    /* And the override wildcard reaches neither. */
    const wild = CapabilitySet.fromManifest(
      manifest("plugin", { capabilities: ["registry:*"] }),
    );
    expect(wild.has("ui:sidebar.replace")).toBe(false);
    expect(wild.has("display:replace")).toBe(false);
  });

  it("grants an exact network host and rejects a different host", () => {
    const set = CapabilitySet.fromManifest(
      manifest("plugin", { capabilities: ["network:api.example.com"] }),
    );
    expect(set.has("network:api.example.com")).toBe(true);
    expect(set.has("network:evil.example.com")).toBe(false);
  });

  it("network:* grants any host", () => {
    const set = CapabilitySet.fromManifest(
      manifest("plugin", { capabilities: ["network:*"] }),
    );
    expect(set.has("network:anything.example.com")).toBe(true);
  });

  it("check() throws a helpful, non-empty, author-facing message naming the capability", () => {
    const set = CapabilitySet.fromManifest(manifest("plugin"));
    expect(() => set.check("state:party.read")).toThrow(CapabilityError);
    try {
      set.check("state:party.read");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(CapabilityError);
      const message = (err as Error).message;
      expect(message.length).toBeGreaterThan(0);
      expect(message).toMatch(/state:party\.read/);
      expect(message).toMatch(/capabilities/);
    }
  });

  it("does not cross-grant between different kinds sharing a name", () => {
    const set = CapabilitySet.fromManifest(
      manifest("plugin", { capabilities: ["event:add"] }),
    );
    expect(set.has("command:add")).toBe(false);
  });
});

describe("CapabilitySet: nondeterministic surfacing", () => {
  it("defaults to deterministic (false) when unset", () => {
    const set = CapabilitySet.fromManifest(manifest("plugin"));
    expect(set.isNondeterministic()).toBe(false);
  });

  it("surfaces nondeterministic: true from the manifest", () => {
    const set = CapabilitySet.fromManifest(
      manifest("plugin", { nondeterministic: true }),
    );
    expect(set.isNondeterministic()).toBe(true);
  });

  it("surfaces nondeterministic: false explicitly", () => {
    const set = CapabilitySet.fromManifest(
      manifest("plugin", { nondeterministic: false }),
    );
    expect(set.isNondeterministic()).toBe(false);
  });
});

describe("CapabilitySet: gameplay-affecting surfacing", () => {
  it("surfaces affectsGameplay: true from the manifest", () => {
    expect(CapabilitySet.fromManifest(manifest("content", { affectsGameplay: true })).isAffectsGameplay()).toBe(true);
  });

  it("defaults affectsGameplay to false", () => {
    expect(CapabilitySet.fromManifest(manifest("content")).isAffectsGameplay()).toBe(false);
  });
});
