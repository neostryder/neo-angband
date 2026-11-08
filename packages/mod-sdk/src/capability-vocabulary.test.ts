import { describe, expect, it } from "vitest";
import { CapabilityError, CapabilitySet, parseCapability } from "./capabilities.js";
import { API2_POLICY_KINDS } from "./api2/policies.js";
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

const MANAGEMENT = ["mod:install", "session:control", "profiles:manage", "screens:manage", "mod:session", "mod:authoring", "options:manage"];
const TRUTH = "state:map-actual.read";

/** A spelling of each entry that parses: the argument filled with a valid value. */
const example = (capability: string): string =>
  capability.replace("<name>", "turn-start").replace("<domain>", "player").replace("<host>", "example.test");

const granting = (...capabilities: string[]): CapabilitySet =>
  CapabilitySet.fromManifest({ id: "m", name: "M", version: "1.0.0", shape: "plugin", capabilities });

describe("the capability vocabulary", () => {
  it("opens the eight data registry grants and discloses their permanent consequences", () => {
    for (const domain of ["effect", "room", "profile", "blow", "glyph", "randart", "vocab", "menu"]) {
      const capability = `registry:${domain}`;
      expect(capabilityTiers(capability)).toContain("worker");
      expect(consentText(matchCapability(capability)!)).toContain("permanently unscorable");
    }
    expect(capabilityTiers("registry:*")).not.toContain("worker");
    expect(capabilityTiers("engine:access")).not.toContain("worker");
  });
  it("opens only the implemented simple option, keybinding, and filter grants", () => {
    for (const capability of ["options:write", "keymap:edit", "display:filter", "ui:messages.replace", "ui:sidebar.replace", "ui:status.replace", "ui:region.create", "display:replace", "ui:menu.replace", "ui:screen.replace", "screens:manage", "mod:install", "mod:session", "mod:read", "debug:wizard", "session:control"]) expect(capabilityTiers(capability)).toContain("worker");
    for (const capability of ["engine:access"]) expect(capabilityTiers(capability)).not.toContain("worker");
    expect(consentText(matchCapability("options:write")!)).toContain("birth, cheat, or score");
    expect(consentText(matchCapability("keymap:edit")!)).toContain("input to permission dialogs");
  });
  it("discloses unseen monsters, race truth, and permanent scoring consequences for Workers", () => {
    const map = consentText(matchCapability("state:map-actual.read")!);
    const monsters = consentText(matchCapability("state:monsters-actual.read")!);
    expect(map).toContain("every monster");
    expect(map).toContain("race abilities");
    expect(monsters).toContain("every creature's location and exact state");
    expect(monsters).toContain("creatures you have not seen");
    for (const capability of ["state:map-actual.read", "state:monsters-actual.read"]) {
      expect(consentText(matchCapability(capability)!)).toContain("permanently unscorable");
      expect(capabilityTiers(capability)).toContain("worker");
    }
  });
  it("allows the Worker tier to request every policy table's registry permission", () => {
    for (const kind of API2_POLICY_KINDS) {
      expect(capabilityTiers(kind.capability), kind.name).toContain("worker");
      expect(granting(kind.capability).has(kind.capability)).toBe(true);
    }
    expect(capabilityTiers("registry:*")).not.toContain("worker");
  });

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
      expect(capabilityTiers(cap)).toEqual(["profiles:manage", "session:control", "options:manage", "saves:manage"].includes(cap) ? CAPABILITY_TIERS : ["mod:authoring", "mod:install", "mod:session", "screens:manage"].includes(cap) ? ["first-party", "worker"] : ["first-party"]);
      expect(matchCapability(cap)?.entry.namespace).toBe("manage");
    }
    expect(CAPABILITY_VOCABULARY.filter((entry) => entry.namespace === "manage").map((entry) => entry.capability).sort())
      .toEqual([...MANAGEMENT].sort());
    expect(capabilityTiers("saves:manage")).toContain("worker");
  });

  it("puts true map state in its own namespace, including Workers", () => {
    expect(isTruthCapability(TRUTH)).toBe(true);
    expect(isTruthCapability(parseCapability(TRUTH))).toBe(true);
    expect(isPublicCapability(TRUTH)).toBe(false);
    expect(capabilityTiers(TRUTH)).toEqual(["first-party", "worker"]);
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
    for (const cap of ["command:add", "ui:title", "ui:menu.row", "input:controller", "input:observe"]) expect(capabilityTiers(cap), cap).toContain("worker");
    expect(granting("input:intent").has("input:controller")).toBe(false);
    expect(granting("keymap:write").has("input:observe")).toBe(false);
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

it("opens only bounded spawning and explicit shared JSON in this stage", () => {
  for (const capability of ["debug:spawn", "shared:read", "shared:publish"]) expect(capabilityTiers(capability)).toContain("worker");
  for (const capability of ["engine:access"]) expect(capabilityTiers(capability)).not.toContain("worker");
  expect(consentText(matchCapability("shared:read")!)).toContain("Private mod storage stays hidden");
  expect(consentText(matchCapability("shared:publish")!)).toContain("every other mod that holds shared:read");
  expect(consentText(matchCapability("debug:spawn")!)).toContain("can no longer be scored");
});

it("opens serialized birth, all six replacement families, and desktop backup requests", () => {
  for (const capability of ["ui:birth.replace", "ui:*.replace", "backup:folder"]) expect(capabilityTiers(capability)).toContain("worker");
  const wildcard = consentText(matchCapability("ui:*.replace")!);
  expect(CAPABILITY_VOCABULARY.filter((entry) => entry.capability.startsWith("ui:") && entry.capability.endsWith(".replace") && !entry.wildcard)
    .map((entry) => entry.capability)).toEqual(["messages", "sidebar", "status", "menu", "screen", "birth"].map((family) => `ui:${family}.replace`));
  for (const family of ["messages", "vitals", "status", "gameplay menus", "gameplay screens", "character creation"]) expect(wildcard).toContain(family);
  expect(consentText(matchCapability("ui:birth.replace")!)).toContain("asks before starting");
  expect(consentText(matchCapability("backup:folder")!)).toContain("desktop asks before each write");
});
