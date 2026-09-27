import { describe, expect, it } from "vitest";
import { parseDocument, modStateFormat, profilesFormat } from "@rpgm-tools/neo-angband-mod-sdk";

import { convertLegacyModState, MOD_STATE_STORAGE_KEY, ModStore } from "./mod-store";
import { convertLegacyProfiles, PROFILES_STORAGE_KEY, ProfileStore } from "./profiles";

function memory(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k: string): string | null => map.get(k) ?? null,
    setItem: (k: string, v: string): void => void map.set(k, v),
    removeItem: (k: string): void => void map.delete(k),
    get length() {
      return map.size;
    },
    key: (i: number): string | null => [...map.keys()][i] ?? null,
  };
}

describe("the mod-state document", () => {
  it("moves every older mod-manager key in, cleaned the way the getters clean it", () => {
    const s = memory({
      "neo:enabledMods": JSON.stringify(["qol", 7, "bug-fixes"]),
      "neo:modChoices": JSON.stringify({ qol: true, junk: "yes" }),
      "neo:modConsents": JSON.stringify({ qol: ["ui:panel.mount", 3] }),
      "neo:modRuleChoices": JSON.stringify({ "qol.autoDig": false }),
      "neo:modPins": JSON.stringify({ qol: { after: ["bug-fixes"], before: "x" } }),
      "neo:modSectionChoices": JSON.stringify({ qol: { tiles: true, bad: 1 } }),
    });
    convertLegacyModState(s);
    const doc = parseDocument(s.map.get(MOD_STATE_STORAGE_KEY)!, modStateFormat);
    expect(doc.ok && doc.data).toEqual({
      enabled: ["qol", "bug-fixes"],
      choices: { qol: true },
      consents: { qol: ["ui:panel.mount"] },
      ruleChoices: { "qol.autoDig": false },
      pins: { qol: { after: ["bug-fixes"] } },
      sectionChoices: { qol: { tiles: true } },
    });
    expect([...s.map.keys()]).toEqual([MOD_STATE_STORAGE_KEY]);

    const store = new ModStore(s);
    expect(store.getEnabled()).toEqual(["qol", "bug-fixes"]);
    expect(store.hasStoredEnabled()).toBe(true);
    expect(store.getPins()).toEqual([{ id: "qol", after: ["bug-fixes"] }]);
  });

  it("tells a player who turned everything off from a first run", () => {
    const fresh = new ModStore(memory());
    expect(fresh.hasStoredEnabled()).toBe(false);
    const s = memory();
    new ModStore(s).setEnabled([]);
    expect(new ModStore(s).hasStoredEnabled()).toBe(true);
    expect(new ModStore(s).getEnabled()).toEqual([]);
  });

  it("keeps one document per profile scope", () => {
    const real = memory();
    const scoped = {
      getItem: (k: string) => real.getItem(`profile:p1:${k}`),
      setItem: (k: string, v: string) => real.setItem(`profile:p1:${k}`, v),
      removeItem: (k: string) => real.removeItem(`profile:p1:${k}`),
    };
    new ModStore(real).setEnabled(["qol"]);
    new ModStore(scoped).setEnabled(["borg"]);
    expect(new ModStore(real).getEnabled()).toEqual(["qol"]);
    expect(new ModStore(scoped).getEnabled()).toEqual(["borg"]);
    expect(real.map.has(`profile:p1:${MOD_STATE_STORAGE_KEY}`)).toBe(true);
  });
});

describe("the profile index document", () => {
  it("moves the three older profile keys in", () => {
    const s = memory({
      "neo:profiles": JSON.stringify({ p1: { name: "Testing", createdAt: 5 }, broken: { name: 3 } }),
      "neo:profiles:defaultName": JSON.stringify("Main"),
      "neo:activeProfile": JSON.stringify("p1"),
    });
    convertLegacyProfiles(s);
    const doc = parseDocument(s.map.get(PROFILES_STORAGE_KEY)!, profilesFormat);
    expect(doc.ok && doc.data).toEqual({ named: { p1: { name: "Testing", createdAt: 5 } }, defaultName: "Main", active: "p1" });
    expect([...s.map.keys()]).toEqual([PROFILES_STORAGE_KEY]);
    const store = new ProfileStore(s);
    expect(store.list().map((p) => p.name)).toEqual(["Main", "Testing"]);
    expect(store.activeId()).toBe("p1");
  });

  it("keeps the older profile list when the first write is to another field", () => {
    const s = memory({ "neo:profiles": JSON.stringify({ p1: { name: "Testing", createdAt: 5 } }) });
    const store = new ProfileStore(s);
    store.switchTo("p1");
    expect(store.list().map((p) => p.name)).toEqual(["Default", "Testing"]);
    convertLegacyProfiles(s);
    expect(new ProfileStore(s).list().map((p) => p.name)).toEqual(["Default", "Testing"]);
    expect(s.map.has("neo:profiles")).toBe(false);
  });

  it("reads a null active profile from an older build as the default", () => {
    const s = memory({ "neo:activeProfile": "null" });
    expect(new ProfileStore(s).activeId()).toBeNull();
    convertLegacyProfiles(s);
    expect(new ProfileStore(s).activeId()).toBeNull();
    expect(s.map.has("neo:activeProfile")).toBe(false);
  });

  it("drops the active field when the default profile is switched back to", () => {
    const s = memory();
    const store = new ProfileStore(s);
    const id = store.create("Testing");
    store.switchTo(id);
    expect(store.activeId()).toBe(id);
    store.switchTo(null);
    expect(store.activeId()).toBeNull();
    const doc = parseDocument(s.map.get(PROFILES_STORAGE_KEY)!, profilesFormat);
    expect(doc.ok && "active" in doc.data).toBe(false);
  });
});
