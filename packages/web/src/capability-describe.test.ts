/**
 * W2.4 consent copy: every capability the manager can show a user maps to a
 * plain-language line, powerful grants are flagged elevated, and unknown
 * strings fail safe (reported, elevated) rather than silently hiding a grant.
 */

import { describe, expect, it } from "vitest";
import {
  describeCapability,
  describeCapabilities,
  hasElevatedCapability,
} from "./capability-describe";

describe("describeCapability", () => {
  it("describes each registry override domain, flagging system override as elevated", () => {
    expect(describeCapability("registry:effect")).toMatchObject({ elevated: true });
    expect(describeCapability("registry:room")).toMatchObject({ elevated: true });
    expect(describeCapability("registry:command")).toMatchObject({ elevated: true });
    expect(describeCapability("registry:monster")).toMatchObject({ elevated: true });
    // vocabulary is additive, not an override of core logic -> not elevated.
    expect(describeCapability("registry:vocab").elevated).toBe(false);
    expect(describeCapability("registry:*").elevated).toBe(true);
    expect(describeCapability("registry:*").text).toMatch(/ANY game system/i);
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
