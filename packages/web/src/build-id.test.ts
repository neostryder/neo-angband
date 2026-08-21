/**
 * "Is this page running the current build?" - the comparison, and the fetch.
 *
 * Nearly every test here is about answering NO SAFELY. A false positive is not a
 * cosmetic bug: it puts an (U)pdate row in front of a player, reloads them onto
 * the same build, and puts the row straight back. There is no way out of that
 * loop from inside the game, so every uncertainty - an unstamped build, a failed
 * fetch, a body that is not the expected shape - has to answer "up to date".
 */

import { describe, expect, it, vi } from "vitest";
import { isStale, isStampedBuild, WEB_BUILD_ID, WEB_BUILD_ID_FILE } from "./build-id";
import {
  FRESHNESS_POLL_MS,
  FRESHNESS_TIMEOUT_MS,
  isBuildStale,
  refreshStaleDesktopShell,
  startFreshnessWatch,
} from "./pwa";

describe("the build id itself", () => {
  it("falls back to a real value, not an empty string", () => {
    /* Nothing stamps one in a test or a dev server. "" would compare equal to a
     * failed fetch, so "the check is off" would look exactly like "up to date"
     * - the two states this whole feature exists to tell apart. */
    expect(WEB_BUILD_ID).toBe("dev");
    expect(isStampedBuild()).toBe(false);
    expect(isStampedBuild("a1b2c3d")).toBe(true);
    expect(isStampedBuild("")).toBe(false);
  });
});

describe("comparing two build ids", () => {
  it("is stale when the server has a different one", () => {
    expect(isStale("aaa", { buildId: "bbb" })).toBe(true);
  });

  it("is not stale when they match", () => {
    expect(isStale("aaa", { buildId: "aaa" })).toBe(false);
  });

  it("never answers stale for an unstamped build", () => {
    /* A dev server rebuilds constantly and stamps nothing. Comparing "dev"
     * against a deployed id would offer an update on every keystroke. */
    expect(isStale("dev", { buildId: "bbb" })).toBe(false);
    expect(isStale("", { buildId: "bbb" })).toBe(false);
  });

  it("never answers stale for an answer it does not understand", () => {
    for (const body of [null, undefined, "bbb", 42, [], {}, { buildId: 7 }, { buildId: "" }]) {
      expect(isStale("aaa", body), JSON.stringify(body)).toBe(false);
    }
  });

  it("never answers stale against an unstamped SERVER", () => {
    /* Serving a locally-built bundle from a static server: its build-id.json
     * says "dev" too, and telling somebody to update to a dev build is worse
     * than saying nothing. */
    expect(isStale("aaa", { buildId: "dev" })).toBe(false);
  });
});

describe("asking the server", () => {
  const ok = (body: unknown): Response =>
    ({ ok: true, json: () => Promise.resolve(body) }) as unknown as Response;

  it("fetches the file with no-store, so a cache cannot answer for the server", async () => {
    /*
     * The whole mechanism turns on this. If the service worker answers the
     * freshness check out of its own cache, it replies with the STALE build's
     * own id, the page concludes it is current, and the check is silently off
     * forever. vite.config.ts keeps the file out of the precache manifest and
     * this is the second lock on the same door.
     */
    const fetchFn = vi.fn(() => Promise.resolve(ok({ buildId: "aaa" })));
    await isBuildStale(fetchFn as unknown as typeof fetch);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain(WEB_BUILD_ID_FILE);
    expect(init.cache).toBe("no-store");
    /* And a changing query string, because a proxy in between honours neither. */
    expect(url).toMatch(/\?t=\d+/u);
  });

  it("answers false when the fetch fails, times out, or 404s", async () => {
    const threw = vi.fn(() => Promise.reject(new Error("offline")));
    await expect(isBuildStale(threw as unknown as typeof fetch)).resolves.toBe(false);

    const notFound = vi.fn(() => Promise.resolve({ ok: false } as Response));
    await expect(isBuildStale(notFound as unknown as typeof fetch)).resolves.toBe(false);

    const badJson = vi.fn(() =>
      Promise.resolve({ ok: true, json: () => Promise.reject(new Error("html")) } as unknown as Response),
    );
    await expect(isBuildStale(badJson as unknown as typeof fetch)).resolves.toBe(false);
  });

  it("passes an abort signal, so a hung request does not hold the check open", async () => {
    const fetchFn = vi.fn(() => Promise.resolve(ok({ buildId: "aaa" })));
    await isBuildStale(fetchFn as unknown as typeof fetch);
    const [, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(FRESHNESS_TIMEOUT_MS).toBeGreaterThan(0);
  });

  it("is false in a test run whatever the server says, because nothing stamped a build", () => {
    /* Reaffirming the guard at the layer that uses it: no combination of server
     * answers can make an unstamped bundle report itself out of date. */
    expect(isStale(WEB_BUILD_ID, { buildId: "anything-at-all" })).toBe(false);
  });
});

describe("something actually calls the check", () => {
  /*
   * "The check exists" and "something calls the check" are different claims, and
   * this project has shipped the first without the second - a feature wired to
   * an object that never had the method on it, with sixty tests passing over the
   * top. These assert the calling.
   */
  function harness(answers: boolean[]) {
    let i = 0;
    const check = vi.fn(() => Promise.resolve(answers[Math.min(i++, answers.length - 1)] ?? false));
    const onStale = vi.fn();
    const hooks: Record<string, () => void> = {};
    const poll = startFreshnessWatch({
      check,
      onStale,
      every: (fn, ms) => {
        hooks["every"] = fn;
        hooks["ms"] = (() => ms) as unknown as () => void;
      },
      onVisible: (fn) => (hooks["visible"] = fn),
      onOnline: (fn) => (hooks["online"] = fn),
    });
    return { check, onStale, hooks, poll };
  }

  it("asks once immediately, before any event has happened", async () => {
    const { check } = harness([false]);
    await vi.waitFor(() => expect(check).toHaveBeenCalledTimes(1));
  });

  it("registers all three re-ask hooks", () => {
    /* A page open for hours in an installed PWA asks nobody anything without
     * these, which is the case the old service-worker-only version missed. */
    const { hooks } = harness([false]);
    expect(hooks["every"]).toBeTypeOf("function");
    expect(hooks["visible"]).toBeTypeOf("function");
    expect(hooks["online"]).toBeTypeOf("function");
    expect((hooks["ms"] as unknown as () => number)()).toBe(FRESHNESS_POLL_MS);
  });

  it("re-asks on each hook, and reports the first yes", async () => {
    const { check, onStale, hooks } = harness([false, false, true]);
    await vi.waitFor(() => expect(check).toHaveBeenCalledTimes(1));
    hooks["visible"]?.();
    await vi.waitFor(() => expect(check).toHaveBeenCalledTimes(2));
    expect(onStale).not.toHaveBeenCalled();
    hooks["online"]?.();
    await vi.waitFor(() => expect(onStale).toHaveBeenCalledTimes(1));
  });

  it("reports staleness once, however many times it is asked", async () => {
    /* The row is a latch. Re-announcing it every half hour would be a second
     * notification for a fact the player has already been told. */
    const { onStale, hooks } = harness([true]);
    await vi.waitFor(() => expect(onStale).toHaveBeenCalledTimes(1));
    hooks["visible"]?.();
    hooks["online"]?.();
    hooks["every"]?.();
    await new Promise((r) => setTimeout(r, 10));
    expect(onStale).toHaveBeenCalledTimes(1);
  });
});

/**
 * The desktop does not get asked, it gets refreshed.
 *
 * The bug: after an in-place update the files on disk are new and the service
 * worker still serves the old shell for one whole launch, so the player quits,
 * updates, reopens, and reads the previous version number off the title screen.
 * On the web that state is an offer; on the desktop the bytes are already local
 * and there is nothing to offer.
 */
describe("a stale desktop shell", () => {
  function harness(over: Record<string, unknown> = {}) {
    const store = new Map<string, string>();
    const reload = vi.fn();
    const evict = vi.fn(async () => undefined);
    return {
      apply: reload,
      evict,
      store,
      deps: {
        isDesktop: () => true,
        check: async () => true,
        evict,
        reload,
        once: {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => void store.set(k, v),
        },
        ...over,
      },
    };
  }

  it("takes the new build without asking", async () => {
    const h = harness();
    expect(await refreshStaleDesktopShell(h.deps)).toBe(true);
    expect(h.apply).toHaveBeenCalledTimes(1);
  });

  it("leaves the web alone - there the player is mid-game and mid-network", async () => {
    const h = harness({ isDesktop: () => false });
    expect(await refreshStaleDesktopShell(h.deps)).toBe(false);
    expect(h.apply).not.toHaveBeenCalled();
    expect(h.evict).not.toHaveBeenCalled();
  });

  it("evicts the worker even when this shell is already current, so the next launch cannot be stale", async () => {
    const h = harness({ check: async () => false });
    expect(await refreshStaleDesktopShell(h.deps)).toBe(false);
    expect(h.evict).toHaveBeenCalledTimes(1);
    expect(h.apply).not.toHaveBeenCalled();
  });

  it("does nothing when the shell is already current", async () => {
    const h = harness({ check: async () => false });
    expect(await refreshStaleDesktopShell(h.deps)).toBe(false);
    expect(h.apply).not.toHaveBeenCalled();
  });

  it("reloads at most once, so a shell that stays stale cannot loop", async () => {
    const h = harness();
    expect(await refreshStaleDesktopShell(h.deps)).toBe(true);
    /* The reload preserves sessionStorage, so the second boot sees the mark. */
    expect(await refreshStaleDesktopShell(h.deps)).toBe(false);
    expect(h.apply).toHaveBeenCalledTimes(1);
  });

  it("refuses to reload at all when it has nowhere to record having done so", async () => {
    const h = harness({ once: null });
    expect(await refreshStaleDesktopShell(h.deps)).toBe(false);
    expect(h.apply).not.toHaveBeenCalled();
  });
});
