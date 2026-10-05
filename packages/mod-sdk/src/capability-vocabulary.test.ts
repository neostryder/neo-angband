import { describe, expect, it } from "vitest";
import { CapabilityError, CapabilitySet, parseCapability } from "./capabilities.js";
import {
  CAPABILITY_TIERS,
  CAPABILITY_VOCABULARY,
  CapabilityArgumentError,
  PUBLIC_CAPABILITIES,
  capabilityTiers,
  consentText,
  isPublicCapability,
  isTruthCapability,
  matchCapability,
} from "./capability-vocabulary.js";

const MANAGEMENT = ["mod:install", "session:control", "profiles:manage", "screens:manage", "mod:session"];
const TRUTH = "state:map-actual.read";

/** A spelling of each entry that parses: the argument filled with a valid value. */
const example = (capability: string): string =>
  capability.replace("<name>", "turn-start").replace("<domain>", "player").replace("<host>", "example.test");

const granting = (...capabilities: string[]): CapabilitySet =>
  CapabilitySet.fromManifest({ id: "m", name: "M", version: "1.0.0", shape: "plugin", capabilities });

describe("the capability vocabulary", () => {
  it("has a complete entry for every capability, each spelled once", () => {
    const spellings = CAPABILITY_VOCABULARY.map((entry) => entry.capability);
    expect(new Set(spellings).size).toBe(spellings.length);
    for (const entry of CAPABILITY_VOCABULARY) {
      expect(entry.consent.trim(), entry.capability).not.toBe("");
      expect(entry.withoutIt.trim(), entry.capability).toMatch(/\.$/u);
      expect(typeof entry.canRunWithout, entry.capability).toBe("boolean");
      expect(typeof entry.powerful, entry.capability).toBe("boolean");
      expect(["public", "manage", "truth"], entry.capability).toContain(entry.namespace);
      expect(entry.tiers.length, entry.capability).toBeGreaterThan(0);
      for (const tier of entry.tiers) expect(CAPABILITY_TIERS).toContain(tier);
      const placeholders = [...entry.capability.matchAll(/<([a-z]+)>/gu)].map((m) => m[1]);
      expect(entry.args.map((arg) => arg.name), entry.capability).toEqual(placeholders);
      for (const arg of entry.args) {
        expect(arg.description, entry.capability).not.toBe("");
        expect(() => new RegExp(arg.pattern), entry.capability).not.toThrow();
        expect(entry.consent, entry.capability).toContain(`{${arg.name}}`);
      }
      const match = matchCapability(example(entry.capability));
      expect(match?.entry, entry.capability).toBe(entry);
      expect(consentText(match!), entry.capability).not.toMatch(/[{}<>]/u);
      expect(() => parseCapability(example(entry.capability)), entry.capability).not.toThrow();
      expect(entry.args.length > 0 || entry.capability.includes("*") || entry.wildcard === undefined, entry.capability).toBe(true);
    }
  });

  it("keeps the management capabilities out of the public vocabulary", () => {
    const publicSpellings = PUBLIC_CAPABILITIES.map((entry) => entry.capability);
    for (const cap of MANAGEMENT) {
      expect(publicSpellings).not.toContain(cap);
      expect(isPublicCapability(cap)).toBe(false);
      expect(capabilityTiers(cap)).toEqual(["first-party"]);
      expect(matchCapability(cap)?.entry.namespace).toBe("manage");
    }
    expect(CAPABILITY_VOCABULARY.filter((entry) => entry.namespace === "manage").map((entry) => entry.capability).sort())
      .toEqual([...MANAGEMENT].sort());
  });

  it("puts true map state in its own namespace, held by first-party mods only", () => {
    expect(isTruthCapability(TRUTH)).toBe(true);
    expect(isTruthCapability(parseCapability(TRUTH))).toBe(true);
    expect(isPublicCapability(TRUTH)).toBe(false);
    expect(capabilityTiers(TRUTH)).toEqual(["first-party"]);
    expect(isTruthCapability("state:map.read")).toBe(false);
  });

  it("lets no wildcard reach a truth capability", () => {
    const wildcards = CAPABILITY_VOCABULARY.filter((entry) => entry.wildcard === true).map((entry) => entry.capability);
    expect(wildcards).toEqual(expect.arrayContaining(["state:*.read", "registry:*", "network:*", "ui:*.replace"]));
    expect(granting(...wildcards).has(TRUTH)).toBe(false);
    expect(granting(...PUBLIC_CAPABILITIES.map((entry) => example(entry.capability))).has(TRUTH)).toBe(false);
    expect(granting("state:*.read").has("state:map.read")).toBe(true);
    expect(granting(TRUTH).has(TRUTH)).toBe(true);
  });

  it("grants nothing that is not declared", () => {
    const none = granting();
    for (const entry of CAPABILITY_VOCABULARY) expect(none.has(example(entry.capability)), entry.capability).toBe(false);
    expect(granting("prefs:write").has("prefs:read")).toBe(false);
    expect(granting("command:add").has("command:submit")).toBe(false);
    expect(granting("ui:panel").has("ui:panel.mount")).toBe(false);
  });

  it("parses the strings the Worker host checks", () => {
    for (const cap of ["prefs:read", "prefs:write", "asset:read", "state:model.read", "query:snapshot", "policy:install",
      "registry:declare", "ui:region", "command:submit", "ui:panel", "hook:respond"]) {
      expect(capabilityTiers(cap), cap).toContain("worker");
      expect(granting(cap).has(cap), cap).toBe(true);
    }
    expect(capabilityTiers("command:add")).not.toContain("worker");
  });

  it("refuses what it does not know, and a malformed argument", () => {
    expect(matchCapability("teleport:anywhere")).toBeNull();
    expect(() => parseCapability("teleport:anywhere")).toThrow(CapabilityError);
    expect(() => matchCapability("network:example.test:70000")).toThrow(CapabilityArgumentError);
    expect(() => parseCapability("network:example.test:70000")).toThrow(/between 1 and 65535/u);
    expect(capabilityTiers("teleport:anywhere")).toEqual([]);
  });

  it("fills the argument into the consent sentence", () => {
    expect(consentText(matchCapability("event:turn-start")!)).toBe("Observe the \"turn-start\" game event");
    expect(consentText(matchCapability("network:Example.TEST:8080")!)).toBe("Send network requests to example.test:8080");
  });
});
