/**
 * Persistent storage: the half of PLATFORM.md's evictable-bucket cost that
 * compression did not fix.
 *
 * The behaviours worth pinning are all about NOT lying and NOT nagging:
 * an origin that is already protected must never be reported as at risk, a refusal
 * must be reported as a refusal rather than assumed away, and the one prompt some
 * engines raise must happen at most once - a permission dialogue on every launch is
 * how a player learns to dismiss it without reading.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ASKED_KEY,
  durabilityNotice,
  ensureDurableStorage,
  requestDurableStorage,
  resetDurabilityLatch,
  storageDurability,
} from "./storage-persist";

/** A scope with a scriptable navigator.storage and an in-memory localStorage. */
function scope(opts: {
  persisted?: boolean;
  grant?: boolean;
  usage?: number;
  quota?: number;
  noPersist?: boolean;
  noPersisted?: boolean;
  noEstimate?: boolean;
  throws?: boolean;
  store?: Map<string, string>;
} = {}) {
  const state = { persisted: opts.persisted ?? false };
  const store = opts.store ?? new Map<string, string>();
  const persist = vi.fn(async () => {
    if (opts.throws) throw new Error("no");
    state.persisted = opts.grant ?? false;
    return state.persisted;
  });
  const s = {
    navigator: {
      storage: {
        ...(opts.noPersist ? {} : { persist }),
        ...(opts.noPersisted
          ? {}
          : {
              persisted: async () => {
                if (opts.throws) throw new Error("no");
                return state.persisted;
              },
            }),
        ...(opts.noEstimate
          ? {}
          : {
              estimate: async () => {
                if (opts.throws) throw new Error("no");
                return { usage: opts.usage ?? 1234, quota: opts.quota ?? 5_000_000 };
              },
            }),
      },
    },
    localStorage: {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
    },
  };
  return { s, persist, store, state };
}

beforeEach(() => {
  resetDurabilityLatch();
});

describe("storageDurability", () => {
  it("reports what the engine says", async () => {
    const { s } = scope({ persisted: true, usage: 500_000, quota: 6_000_000 });
    expect(await storageDurability(s)).toEqual({
      supported: true,
      persisted: true,
      usage: 500_000,
      quota: 6_000_000,
    });
  });

  it("never asks for persistence", async () => {
    const { s, persist } = scope({ grant: true });
    await storageDurability(s);
    /* This is the query, and a query that could raise a permission prompt could not
     * be called from a screen that merely wants to describe the situation. */
    expect(persist).not.toHaveBeenCalled();
  });

  it("reports unsupported on an engine with no storage manager", async () => {
    expect(await storageDurability({})).toEqual({
      supported: false,
      persisted: false,
      usage: null,
      quota: null,
    });
  });

  it("reads as at-risk when the engine throws rather than answering", async () => {
    /* False only ever makes the game MORE careful, so it is the safe reading. */
    const { s } = scope({ throws: true });
    const d = await storageDurability(s);
    expect(d.persisted).toBe(false);
    expect(d.usage).toBeNull();
  });

  it("survives an engine that can persist but not estimate", async () => {
    const { s } = scope({ persisted: true, noEstimate: true });
    const d = await storageDurability(s);
    expect(d).toEqual({ supported: true, persisted: true, usage: null, quota: null });
  });
});

describe("requestDurableStorage", () => {
  it("asks, and reports a grant", async () => {
    const { s, persist } = scope({ grant: true });
    expect(await requestDurableStorage(s)).toBe(true);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("reports a refusal instead of assuming it worked", async () => {
    const { s } = scope({ grant: false });
    expect(await requestDurableStorage(s)).toBe(false);
  });

  it("does not ask when the origin is already persistent", async () => {
    const { s, persist } = scope({ persisted: true });
    expect(await requestDurableStorage(s)).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it("asks at most once across launches", async () => {
    /* The store outlives the scope, which is what "a later launch" means here. */
    const store = new Map<string, string>();
    const first = scope({ grant: false, store });
    expect(await requestDurableStorage(first.s)).toBe(false);
    expect(first.persist).toHaveBeenCalledTimes(1);
    expect(store.get(ASKED_KEY)).toBe("1");

    const second = scope({ grant: false, store });
    expect(await requestDurableStorage(second.s)).toBe(false);
    expect(second.persist).not.toHaveBeenCalled();
  });

  it("asks again when the player asks for it deliberately", async () => {
    const store = new Map<string, string>([[ASKED_KEY, "1"]]);
    const { s, persist } = scope({ grant: true, store });
    expect(await requestDurableStorage(s, { force: true })).toBe(true);
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("reports false rather than throwing on an engine that cannot", async () => {
    expect(await requestDurableStorage({})).toBe(false);
    const { s } = scope({ noPersist: true });
    expect(await requestDurableStorage(s)).toBe(false);
    const bad = scope({ throws: true });
    expect(await requestDurableStorage(bad.s)).toBe(false);
  });
});

describe("ensureDurableStorage", () => {
  it("asks once however many saves a session writes", async () => {
    const { s, persist } = scope({ grant: true });
    ensureDurableStorage(s);
    ensureDurableStorage(s);
    ensureDurableStorage(s);
    await Promise.resolve();
    await Promise.resolve();
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("never throws into the save path", () => {
    /* persistSave() is synchronous and its verdict is the player's save; a rejected
     * permission promise must not become an unhandled rejection there. */
    expect(() => ensureDurableStorage({ navigator: { storage: null } })).not.toThrow();
    resetDurabilityLatch();
    const bad = scope({ throws: true });
    expect(() => ensureDurableStorage(bad.s)).not.toThrow();
  });
});

describe("durabilityNotice", () => {
  const risky = { supported: true, persisted: false, usage: null, quota: null };

  it("says nothing when there is nothing to lose", () => {
    expect(durabilityNotice(risky, 0)).toBeNull();
  });

  it("says nothing once the origin is protected", () => {
    expect(durabilityNotice({ ...risky, persisted: true }, 3)).toBeNull();
  });

  it("warns when characters exist and storage is not protected", () => {
    const n = durabilityNotice(risky, 1);
    expect(n).not.toBeNull();
    expect(n).toContain("Install");
  });

  it("words it differently for an engine that cannot be asked", () => {
    const a = durabilityNotice(risky, 1);
    const b = durabilityNotice({ ...risky, supported: false }, 1);
    expect(b).not.toBe(a);
    expect(b).toContain("delete");
  });
});
