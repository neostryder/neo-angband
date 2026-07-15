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
  extra?: Partial<Pick<PackManifest, "capabilities" | "nondeterministic">>,
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
    for (const domain of ["effect", "room", "command", "monster"] as const) {
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
    expect(set.has("registry:command")).toBe(true);
    expect(set.has("registry:monster")).toBe(true);
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
