import { describe, expect, it } from "vitest";
import { parseDocument, serializeDocument, settingsFormat } from "@rpgm-tools/neo-angband-mod-sdk";

import { convertLegacySettings, readSetting, SETTINGS_STORAGE_KEY, writeSetting } from "./settings-store";

function memory(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (k: string): string | null => map.get(k) ?? null,
    setItem: (k: string, v: string): void => void map.set(k, v),
    removeItem: (k: string): void => void map.delete(k),
  };
}

function stored(store: ReturnType<typeof memory>) {
  const raw = store.map.get(SETTINGS_STORAGE_KEY);
  if (raw === undefined) return undefined;
  const doc = parseDocument(raw, settingsFormat);
  return doc.ok ? doc.data : "unreadable";
}

describe("the settings document", () => {
  it("keeps every setting in one house JSON document", () => {
    const s = memory();
    expect(writeSetting(s, "updateChannel", "early")).toBe(true);
    expect(writeSetting(s, "tileMode", 3)).toBe(true);
    expect(stored(s)).toEqual({ updateChannel: "early", tileMode: 3 });
    expect(readSetting(s, "updateChannel")).toBe("early");
    expect(readSetting(s, "tileMode")).toBe(3);
    expect(readSetting(s, "locale")).toBeUndefined();
  });

  it("drops a field written back to its default", () => {
    const s = memory();
    writeSetting(s, "sidebarMode", 2);
    writeSetting(s, "sidebarMode", undefined);
    expect(stored(s)).toEqual({});
    expect(readSetting(s, "sidebarMode")).toBeUndefined();
  });

  it("reads an older build's key until the setting is next written, then removes it", () => {
    const s = memory({ "neo-angband:graf": "2", "neo:locale": "de" });
    expect(readSetting(s, "tileMode")).toBe(2);
    expect(readSetting(s, "locale")).toBe("de");
    writeSetting(s, "tileMode", 4);
    expect(s.map.has("neo-angband:graf")).toBe(false);
    expect(s.map.get("neo:locale")).toBe("de");
    expect(readSetting(s, "tileMode")).toBe(4);
  });

  it("converts every old key at once, each in its old spelling", () => {
    const s = memory({
      "neo:locale": "fr",
      "neo:autoplayerSpeed": "\"fast\"",
      "neo:storageAsked": "1",
      "neo:desktop-shell-refreshed": "1",
      "neo-angband:update-channel": "beta",
      "neo-angband:sidebar-mode": "1",
      "neo-angband:log-level": "debug",
      "neo-angband:graf": "2",
      "neo-angband:control-profile": "touch",
      "neo-angband:allow-third-party-mods": "no",
    });
    convertLegacySettings(s);
    expect(stored(s)).toEqual({
      locale: "fr",
      autoplayerSpeed: "fast",
      storagePersistenceAsked: true,
      desktopShellRefreshed: true,
      updateChannel: "beta",
      sidebarMode: 1,
      logLevel: "debug",
      tileMode: 2,
      controlProfile: "touch",
      allowThirdPartyMods: false,
    });
    expect([...s.map.keys()]).toEqual([SETTINGS_STORAGE_KEY]);
  });

  it("lets a value already in the document win over a leftover old key", () => {
    const s = memory({ "neo-angband:update-channel": "beta" });
    writeSetting(s, "logLevel", "warn");
    s.map.set("neo-angband:update-channel", "beta");
    s.map.set(SETTINGS_STORAGE_KEY, serializeDocument(settingsFormat, { updateChannel: "early", logLevel: "warn" }));
    convertLegacySettings(s);
    expect(stored(s)).toEqual({ updateChannel: "early", logLevel: "warn" });
    expect(s.map.has("neo-angband:update-channel")).toBe(false);
  });

  it("drops an old value that never meant anything, and its key", () => {
    const s = memory({ "neo-angband:graf": "banana", "neo-angband:allow-third-party-mods": "maybe" });
    convertLegacySettings(s);
    expect(stored(s)).toEqual({});
    expect(s.map.size).toBe(1);
  });

  it("never overwrites a document from a newer build", () => {
    const future = JSON.stringify({ format: "neo-angband/web/settings", schemaVersion: 99, data: { tileMode: 5 } });
    const s = memory({ [SETTINGS_STORAGE_KEY]: future, "neo-angband:graf": "2" });
    expect(writeSetting(s, "tileMode", 3)).toBe(false);
    convertLegacySettings(s);
    expect(s.map.get(SETTINGS_STORAGE_KEY)).toBe(future);
    expect(s.map.get("neo-angband:graf")).toBe("2");
    expect(readSetting(s, "tileMode")).toBe(2);
  });

  it("reports rather than throws when storage refuses", () => {
    const hostile = {
      getItem: (): string => {
        throw new Error("denied");
      },
      setItem: (): void => {
        throw new Error("denied");
      },
      removeItem: (): void => {
        throw new Error("denied");
      },
    };
    expect(readSetting(hostile, "locale")).toBeUndefined();
    expect(writeSetting(hostile, "locale", "de")).toBe(false);
    expect(() => convertLegacySettings(hostile)).not.toThrow();
    expect(readSetting(null, "locale")).toBeUndefined();
    expect(writeSetting(null, "locale", "de")).toBe(false);
  });
});
