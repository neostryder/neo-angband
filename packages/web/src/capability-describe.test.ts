/**
 * W2.4 consent copy: every capability the manager can show a user maps to a
 * plain-language line, powerful grants are flagged elevated, and unknown
 * strings fail safe (reported, elevated) rather than silently hiding a grant.
 */

import { describe, expect, it } from "vitest";
import { REGISTRY_CAPABILITIES } from "@rpgm-tools/neo-angband-core";
import { parseCapability } from "@rpgm-tools/neo-angband-mod-sdk";
import {
  describeCapability,
  describeCapabilities,
  hasElevatedCapability,
} from "./capability-describe";

describe("describeCapability", () => {
  it("describes each registry override domain, flagging system override as elevated", () => {
    expect(describeCapability("registry:effect")).toMatchObject({ elevated: true });
    expect(describeCapability("registry:room")).toMatchObject({ elevated: true });
    expect(describeCapability("registry:profile")).toMatchObject({ elevated: true });
    expect(describeCapability("registry:command")).toMatchObject({ elevated: true });
    expect(describeCapability("registry:monster")).toMatchObject({ elevated: true });
    // vocabulary is additive, not an override of core logic -> not elevated.
    expect(describeCapability("registry:vocab").elevated).toBe(false);
    expect(describeCapability("registry:*").elevated).toBe(true);
    expect(describeCapability("registry:*").text).toMatch(/ANY game system/i);
  });

  it("covers EVERY domain the registry host gates, derived rather than listed", () => {
    /* THE HALF-ADDED DOMAIN. A new registry:<domain> has to land in three
     * places that do not import each other: core's REGISTRY_CAPABILITIES (the
     * gate), mod-sdk's REGISTRY_RE (the grammar, an ALLOWLIST - a domain it has
     * never heard of is refused at install, so the capability looks declared
     * and is never granted), and this module (the consent copy, whose default
     * arm produces "Override the "x" game system" and reads like a bug).
     *
     * registry:glyph got all three and this TEST's hand-written list still did
     * not grow - the check drifting rather than the code. That is why the list
     * is gone: both assertions below are DERIVED from core's own table, so
     * neither a half-added domain nor a half-updated test is possible. */
    for (const cap of Object.values(REGISTRY_CAPABILITIES)) {
      expect({ cap, parsed: parseCapability(cap).kind }).toEqual({
        cap,
        parsed: "registry",
      });
      const d = describeCapability(cap);
      expect({ cap, generic: /^Override the "/.test(d.text) }).toEqual({
        cap,
        generic: false,
      });
    }
  });

  it("describes non-registry capabilities with the right power flags", () => {
    expect(describeCapability("command:add")).toEqual({
      cap: "command:add",
      text: "Add new player commands",
      elevated: false,
    });
    expect(describeCapability("event:turn")).toMatchObject({ elevated: false });
    expect(describeCapability("state:player.read")).toMatchObject({ elevated: false });
    expect(describeCapability("state:*.read")).toMatchObject({ elevated: true });
    expect(describeCapability("network:example.com")).toMatchObject({ elevated: true });
    expect(describeCapability("network:*").text).toMatch(/ANY host/i);
  });

  it("fails safe on an unrecognized capability string", () => {
    const d = describeCapability("bogus:thing");
    expect(d.elevated).toBe(true);
    expect(d.text).toMatch(/Unrecognized/);
  });
});

describe("describeCapabilities / hasElevatedCapability", () => {
  it("maps a list in order and detects any elevated grant", () => {
    const caps = ["command:add", "registry:vocab", "registry:effect"];
    expect(describeCapabilities(caps).map((d) => d.cap)).toEqual(caps);
    expect(hasElevatedCapability(caps)).toBe(true);
    expect(hasElevatedCapability(["command:add", "registry:vocab"])).toBe(false);
  });
});
