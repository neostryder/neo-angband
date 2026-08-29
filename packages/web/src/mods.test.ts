/**
 * Exiting the mod manager, and the one prompt that has to fire exactly when it
 * should.
 *
 * THE RULE (MOD_LIFECYCLE.md / disabling-a-mod-takes-effect-on-reload): a
 * module-level registry is composed once, at boot, so flipping a mod on or off
 * is legitimate only because the change does not touch the RUNNING game until
 * it reloads. `runModManager` therefore tracks a `dirty` bit across the whole
 * visit and, on the way out, offers to reload ONLY when that bit is set - the
 * `if (dirty)` block right before it returns (mods.ts).
 *
 * Two directions have to both hold, and a test that only checks one of them
 * would not notice the manager becoming a nag screen (fires on every visit,
 * changed or not) or a silent one (never fires, and a toggle is quietly lost
 * until the player happens to reload some other way):
 *
 *  - open it and touch NOTHING (including opening a mod and backing out
 *    without acting) -> no prompt, `requestReload` never called.
 *  - actually toggle a mod -> the prompt appears, and:
 *      - "Reload now" calls `requestReload`.
 *      - "Later" does NOT call it, and must not lie about which state the
 *        player is in: the store already has the new choice (that part
 *        happened the moment Space was pressed, not at the prompt), and the
 *        prompt's own wording says so plainly rather than claiming the change
 *        is live.
 *
 * A hang is treated as a failure in its own right: if a prompt this test does
 * not expect pops up, the fake keyboard has nothing left to answer it, and
 * `runModManager` never returns. `raceTimeout` turns that into a normal
 * assertion failure instead of a suite that never finishes.
 */

import { describe, expect, it, vi, afterEach } from "vitest";

import { runModManager, runModOptionsBrowser, type ModManagerDeps } from "./mods";
import { ModStore, buildCatalog } from "./mod-store";
import type { GlyphTerm } from "./term";

/* --- the fakes, same shape as mod-viewport.test.ts / mod-list-long.test.ts */

interface FakeWindow {
  addEventListener(t: string, fn: (ev: Event) => void, capture?: boolean): void;
  removeEventListener(t: string, fn: (ev: Event) => void, capture?: boolean): void;
  dispatchEvent(ev: Event): void;
}

function makeFakeWindow(): FakeWindow {
  const ls: Array<{ t: string; fn: (ev: Event) => void }> = [];
  return {
    addEventListener: (t, fn) => void ls.push({ t, fn }),
    removeEventListener: (t, fn) => {
      const i = ls.findIndex((l) => l.t === t && l.fn === fn);
      if (i >= 0) ls.splice(i, 1);
    },
    dispatchEvent: (ev) => {
      for (const l of [...ls].filter((x) => x.t === ev.type)) l.fn(ev);
    },
  };
}

interface FakeTerm extends GlyphTerm {
  snapshot(): string[];
}

function makeTerm(cols: number, rows = 24): FakeTerm {
  const grid: string[][] = Array.from({ length: rows }, () => new Array(cols).fill(" "));
  return {
    onCellTap: () => () => undefined,
    size: () => ({ cols, rows }),
    clear: () => {
      for (const row of grid) row.fill(" ");
    },
    print: (x: number, y: number, text: string) => {
      const row = grid[y];
      if (!row) return;
      for (let i = 0; i < text.length && x + i < cols; i++) row[x + i] = text[i] ?? " ";
    },
    eraseToEol: () => {},
    prt: () => {},
    setCursor: () => {},
    snapshot: () => grid.map((r) => r.join("").replace(/\s+$/u, "")),
  } as unknown as FakeTerm;
}

function press(win: FakeWindow, key: string): void {
  const ev = new Event("keydown", { cancelable: true }) as Event & { key: string };
  ev.key = key;
  win.dispatchEvent(ev);
}

/** Let every pending microtask (consent checks, the store write, the loop's
 * own restart) settle before the next keypress is dispatched. Everything in
 * `enableMod`'s no-capability, no-conflict path is plain promise chaining -
 * there is no timer anywhere in it - so a fixed, generous number of ticks is
 * exact rather than a guess. */
async function flush(times = 12): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

/** A minimal manifest: content-only, no capabilities/rules/sections/tilePacks/
 * compat claims, so toggling it never raises a consent prompt, a non-scoring
 * warning or a declared-conflict screen - none of those are what this file is
 * testing, and any of them appearing would stall on a keypress this test does
 * not send. */
type CatalogManifest = Parameters<typeof buildCatalog>[0]["content"][number];

function manifest(id: string, name = id): CatalogManifest {
  return { id, name, version: "1.0.0", shape: "content" } as CatalogManifest;
}

/** Race a promise against a short real-time timeout, so an unexpected extra
 * prompt this test never answers fails as an assertion instead of hanging the
 * whole suite. */
function raceTimeout<T>(p: Promise<T>, ms = 300): Promise<{ timedOut: boolean; value?: T }> {
  return Promise.race([
    p.then((value) => ({ timedOut: false as const, value })),
    new Promise<{ timedOut: true }>((resolve) => {
      setTimeout(() => resolve({ timedOut: true }), ms);
    }),
  ]);
}

function makeDeps(
  store: ModStore,
  requestReload: (opts?: { showGraphics?: boolean }) => void,
  manifests: CatalogManifest[],
): ModManagerDeps {
  return {
    store,
    listCatalog: () =>
      buildCatalog({
        content: manifests,
        sandbox: [],
        trusted: [],
        enabled: store.getEnabled(),
        consents: store.getConsents(),
      }),
    conflictLines: () => ({
      declared: [],
      contested: [],
      combined: [],
      declaredRows: [],
      contestedRows: [],
      combinedRows: [],
    }),
    requestReload,
  };
}

/** Open the manager over a fresh fake window + terminal. Caller drives it with
 * `press` and must eventually close it (Escape from the top list, or an
 * answered apply-prompt) or the returned promise never settles. */
function open(mods: CatalogManifest[]): {
  win: FakeWindow;
  term: FakeTerm;
  store: ModStore;
  requestReload: ReturnType<typeof vi.fn>;
  done: Promise<void>;
} {
  const win = makeFakeWindow();
  (globalThis as { window?: unknown }).window = win;
  const term = makeTerm(80, 24);
  const store = new ModStore(fakeStorage());
  const requestReload = vi.fn();
  const done = runModManager(term, makeDeps(store, requestReload, mods));
  return { win, term, store, requestReload, done };
}

describe("leaving the mod manager untouched never offers to reload", () => {
  it("does not call requestReload, and returns promptly, when nothing was touched", async () => {
    const { win, done, requestReload } = open([manifest("qol", "Quality of Life")]);
    await flush();
    press(win, "Escape"); // Done, straight away
    const result = await raceTimeout(done);
    expect(
      result.timedOut,
      "runModManager did not return - something put up a prompt this test never answered",
    ).toBe(false);
    expect(requestReload).not.toHaveBeenCalled();
  });

  it("does not appear after opening a mod and backing out without acting", async () => {
    const { win, done, requestReload } = open([manifest("qol", "Quality of Life")]);
    await flush();
    press(win, "Enter"); // open the (only) mod row -> manageMod's own menu
    await flush();
    press(win, "Escape"); // "Back", having done nothing
    await flush();
    press(win, "Escape"); // Done from the top list
    const result = await raceTimeout(done);
    expect(
      result.timedOut,
      "runModManager did not return after viewing a mod and backing out untouched",
    ).toBe(false);
    expect(requestReload).not.toHaveBeenCalled();
  });

  it("manageMod returns the cursor to the row you left from, not row 0 (neo-angband#159)", async () => {
    /* A description-only round trip is the easiest submenu manageMod offers
     * that has an observable side effect if the cursor resets: "Read the full
     * description" sits below "Enable" when the mod is off. If the cursor had
     * reset to row 0 instead of staying on "Read the full description",
     * pressing Enter a second time would ENABLE the mod instead of reopening
     * the description screen - a state change this test can see directly. */
    const withDescription = {
      id: "qol",
      name: "Quality of Life",
      version: "1.0.0",
      shape: "content",
      description: "Conveniences that faithful Angband does not have.",
    } as CatalogManifest;
    const { win, store, done } = open([withDescription]);
    await flush();
    press(win, "Enter"); // open the (only) mod row -> manageMod's own menu
    await flush();
    press(win, "ArrowDown"); // off "Enable", onto "Read the full description"
    press(win, "Enter"); // open it
    await flush();
    press(win, "Escape"); // back out of the description screen
    await flush();
    press(win, "Enter"); // if the cursor stayed put, this reopens the description
    await flush();
    expect(store.isEnabled("qol"), "the cursor reset to row 0 and enabled the mod instead").toBe(
      false,
    );
    press(win, "Escape"); // out of the description screen (if that's where we are)
    await flush();
    press(win, "Escape"); // "Back" from manageMod
    await flush();
    press(win, "Escape"); // Done
    await done;
  });
});

describe("the top-level Mod options browser", () => {
  it("starts with All mods and keeps disabled mods reachable by name", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(80, 24);
    const store = new ModStore(fakeStorage());
    const done = runModOptionsBrowser(
      term,
      makeDeps(store, vi.fn(), [manifest("qol", "Quality of Life")]),
    );
    await flush();
    const screen = term.snapshot().join("\n");
    expect(screen).toContain("All mods");
    expect(screen).toContain("Quality of Life");
    press(win, "Escape");
    await done;
  });

  it("returns the cursor to the mod you opened, not row 0 (neo-angband#159)", async () => {
    /* Both mods are content-only with no rules/sections, so opening either one's
     * options lands on manageModOptions's own "0 configurable options" dismiss
     * menu - whose title is still "Mod options - {name}", which is what this
     * checks. If the parent's cursor had reset to row 0 ("All mods") instead of
     * staying on "Borg", pressing Enter a second time would reopen "All mods"'s
     * options instead, and the title would say so.
     *
     * qol is enabled so "All mods" is itself a selectable row (not skipped as
     * disabled) - otherwise a reset-to-0 cursor would land somewhere else by
     * accident and this test would not actually distinguish the two. */
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(80, 24);
    const store = new ModStore(fakeStorage());
    store.setModEnabled("qol", true);
    const done = runModOptionsBrowser(
      term,
      makeDeps(store, vi.fn(), [manifest("qol", "Quality of Life"), manifest("borg", "Borg")]),
    );
    await flush();
    press(win, "ArrowDown"); // off "All mods"
    press(win, "ArrowDown"); // onto the second mod row (Borg)
    await flush();
    press(win, "Enter"); // open Borg's options
    await flush();
    expect(term.snapshot().join("\n")).toContain("Mod options - Borg");
    press(win, "Escape"); // back out to the mod list
    await flush();
    press(win, "Enter"); // if the cursor stayed on Borg, this reopens Borg again
    await flush();
    expect(term.snapshot().join("\n")).toContain("Mod options - Borg");
    press(win, "Escape"); // dismiss
    await flush();
    press(win, "Escape"); // Done
    await done;
  });
});

describe("leaving after a real change offers to reload, and honours the answer", () => {
  it("shows the prompt, and 'Reload now' calls requestReload", async () => {
    const { win, done, requestReload, store } = open([manifest("qol", "Quality of Life")]);
    await flush();
    press(win, " "); // Space toggles the highlighted (only) mod on
    await flush();
    press(win, "Escape"); // Done -> dirty, so the apply prompt appears
    await flush();
    press(win, "a"); // "Reload now to apply"
    const result = await raceTimeout(done);
    expect(result.timedOut, "the apply prompt never resolved").toBe(false);
    expect(requestReload).toHaveBeenCalledTimes(1);
    expect(store.isEnabled("qol")).toBe(true);
  });

  it("'Later' does not call requestReload, and does not lie about the state", async () => {
    const { win, term, done, requestReload, store } = open([manifest("qol", "Quality of Life")]);
    await flush();
    press(win, " "); // toggle on
    await flush();
    press(win, "Escape"); // Done -> dirty -> prompt

    // Read the prompt BEFORE answering it: it must say the change is saved and
    // waiting, never that it is already in effect.
    await flush();
    const painted = term.snapshot().join("\n");
    expect(painted).toContain("Later");
    expect(painted).toContain("changes are saved");
    expect(painted).toContain("apply on next reload");

    press(win, "b"); // "Later"
    const result = await raceTimeout(done);
    expect(result.timedOut, "the apply prompt never resolved").toBe(false);
    expect(requestReload).not.toHaveBeenCalled();

    // The choice is recorded (this is what "declining leaves the change
    // recorded but not applied" means): the store already has it, from the
    // moment Space was pressed, independent of what the exit prompt is asked.
    expect(store.isEnabled("qol")).toBe(true);
    // And a manager re-opened right now would show it the same way - no
    // separate "pending" state the UI forgets to draw.
    const catalog = buildCatalog({
      content: [manifest("qol", "Quality of Life")],
      sandbox: [],
      trusted: [],
      enabled: store.getEnabled(),
      consents: store.getConsents(),
    });
    expect(catalog.find((m) => m.id === "qol")?.enabled).toBe(true);
  });
});
