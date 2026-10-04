import { afterEach, describe, expect, it, vi } from "vitest";
import {
  BOOT_RECORD_KEY,
  SAFE_KEY_HOLD_MS,
  addressWithoutSafeLaunch,
  beginBoot,
  bootCompleted,
  decideSafeLaunch,
  enterSafeLaunch,
  resetSafeLaunch,
  safeLaunch,
  watchSafeKey,
  type SafeKeyWatch,
} from "./safe-launch";
import { readEnabledModIds } from "./mod-store";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
  };
}

function fakeTarget() {
  const listeners = new Map<string, Set<(event: Event) => void>>();
  return {
    addEventListener(type: string, listener: (event: Event) => void) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)!.add(listener);
    },
    removeEventListener(type: string, listener: (event: Event) => void) {
      listeners.get(type)?.delete(listener);
    },
    fire(type: string, key?: string) {
      for (const listener of listeners.get(type) ?? []) listener({ key } as unknown as Event);
    },
    count: () => [...listeners.values()].reduce((n, set) => n + set.size, 0),
  };
}

const noKey: SafeKeyWatch = { decide: () => Promise.resolve(false), stop: () => {} };

afterEach(() => {
  resetSafeLaunch();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the safe-launch latch", () => {
  it("is off for an ordinary launch and on once entered", () => {
    expect(safeLaunch()).toBe(false);
    enterSafeLaunch();
    expect(safeLaunch()).toBe(true);
  });

  it("reads safe=1 from the address", () => {
    vi.stubGlobal("location", { search: "?agent=x&safe=1" });
    expect(safeLaunch()).toBe(true);
  });

  it("writes the flag into the address so an in-game reload stays safe", () => {
    const replaced: string[] = [];
    vi.stubGlobal("location", { search: "", href: "https://game.test/?mods=a" });
    vi.stubGlobal("history", { state: null, replaceState: (_s: unknown, _t: string, url: URL) => void replaced.push(String(url)) });
    enterSafeLaunch();
    expect(replaced).toEqual(["https://game.test/?mods=a&safe=1"]);
  });

  it("drops only the flag on the way back out", () => {
    expect(addressWithoutSafeLaunch("https://game.test/?mods=a&safe=1")).toBe("https://game.test/?mods=a");
  });

  it("empties the enabled set unless the caller asks for the normal one", () => {
    vi.stubGlobal("location", { search: "?mods=alpha,beta" });
    expect(readEnabledModIds({ discovered: ["alpha", "beta"] })).toEqual(["alpha", "beta"]);
    enterSafeLaunch();
    expect(readEnabledModIds({ discovered: ["alpha", "beta"], forced: ["draft"] })).toEqual([]);
    expect(readEnabledModIds({ discovered: ["alpha", "beta"], ignoreSafeLaunch: true })).toEqual(["alpha", "beta"]);
  });
});

describe("counting starts that never reached the menus", () => {
  it("counts each start until the menus clear it", () => {
    const storage = memoryStorage();
    expect(beginBoot(storage)).toBe(0);
    expect(beginBoot(storage)).toBe(1);
    expect(beginBoot(storage)).toBe(2);
    bootCompleted(storage);
    expect(beginBoot(storage)).toBe(0);
  });

  it("starts again from zero over a record that does not parse", () => {
    const storage = memoryStorage({ [BOOT_RECORD_KEY]: '{"format":"neo-angband/web/boot-record","schemaVersion":1,"data":{"incompleteStarts":"x"}}' });
    expect(beginBoot(storage)).toBe(0);
    expect(beginBoot(storage)).toBe(1);
  });
});

describe("holding Shift through the start", () => {
  it("answers at once when Shift is not down", async () => {
    const target = fakeTarget();
    expect(await watchSafeKey(target).decide()).toBe(false);
  });

  it("asks for safe mode when Shift stays down for the hold time", async () => {
    vi.useFakeTimers();
    let clock = 1000;
    const target = fakeTarget();
    const watch = watchSafeKey(target, () => clock);
    target.fire("keydown", "Shift");
    clock += 400;
    const decision = watch.decide();
    clock += SAFE_KEY_HOLD_MS;
    await vi.advanceTimersByTimeAsync(SAFE_KEY_HOLD_MS);
    expect(await decision).toBe(true);
  });

  it("starts normally when Shift is let go, or the window loses focus, before then", async () => {
    vi.useFakeTimers();
    for (const release of [["keyup", "Shift"], ["blur", undefined]] as const) {
      const target = fakeTarget();
      const watch = watchSafeKey(target, () => 0);
      target.fire("keydown", "Shift");
      const decision = watch.decide();
      target.fire(release[0], release[1]);
      expect(await decision).toBe(false);
    }
  });

  it("ignores other keys and stops listening when told", () => {
    const target = fakeTarget();
    const watch = watchSafeKey(target);
    target.fire("keydown", "a");
    expect(target.count()).toBe(3);
    watch.stop();
    expect(target.count()).toBe(0);
  });
});

describe("deciding the launch", () => {
  it("counts a normal start and does not offer before two failures", async () => {
    const storage = memoryStorage();
    const offer = vi.fn(() => Promise.resolve(true));
    beginBoot(storage);
    const reason = await decideSafeLaunch({ storage, keyWatch: noKey, anyModsEnabled: () => true, offer });
    expect(reason).toBeNull();
    expect(offer).not.toHaveBeenCalled();
    expect(beginBoot(storage)).toBe(2);
  });

  it("offers after two failures and runs safe on a yes, without counting the start", async () => {
    const storage = memoryStorage();
    beginBoot(storage);
    beginBoot(storage);
    const offer = vi.fn(() => Promise.resolve(true));
    expect(await decideSafeLaunch({ storage, keyWatch: noKey, anyModsEnabled: () => true, offer })).toBe("offer");
    expect(offer).toHaveBeenCalledWith(2);
    expect(safeLaunch()).toBe(true);
    /* The safe start left the count alone, so the next normal start offers again. */
    expect(beginBoot(storage)).toBe(2);
  });

  it("counts the start when the player declines the offer", async () => {
    const storage = memoryStorage();
    beginBoot(storage);
    beginBoot(storage);
    expect(await decideSafeLaunch({ storage, keyWatch: noKey, anyModsEnabled: () => true, offer: () => Promise.resolve(false) })).toBeNull();
    expect(safeLaunch()).toBe(false);
    expect(beginBoot(storage)).toBe(3);
  });

  it("does not offer when no mod would load", async () => {
    const storage = memoryStorage();
    beginBoot(storage);
    beginBoot(storage);
    const offer = vi.fn(() => Promise.resolve(true));
    expect(await decideSafeLaunch({ storage, keyWatch: noKey, anyModsEnabled: () => false, offer })).toBeNull();
    expect(offer).not.toHaveBeenCalled();
  });

  it("takes the flag or the held key before anything else, and stops the key watch", async () => {
    const storage = memoryStorage();
    const stop = vi.fn();
    const held: SafeKeyWatch = { decide: () => Promise.resolve(true), stop };
    expect(await decideSafeLaunch({ storage, keyWatch: held, anyModsEnabled: () => true, offer: () => Promise.resolve(false) })).toBe("key");
    expect(stop).toHaveBeenCalled();
    expect(storage.data.size).toBe(0);
    expect(await decideSafeLaunch({ storage, keyWatch: noKey, anyModsEnabled: () => true, offer: () => Promise.resolve(false) })).toBe("flag");
  });
});
