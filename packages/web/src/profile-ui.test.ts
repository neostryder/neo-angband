/**
 * The (P)rofile screen (neo-angband#163): list / switch / rename / delete /
 * create, driven the same way mods.test.ts drives runModManager - a fake
 * window feeding input-door.ts's dispatcher, a fake glyph terminal, and
 * `press`+`flush` to step through each prompt.
 */

import { describe, expect, it, vi, afterEach } from "vitest";
import { runProfileScreen, type ProfileScreenDeps } from "./profile-ui";
import { ProfileStore } from "./profiles";
import type { ScopedStorage } from "./profile-scope";
import type { GlyphTerm } from "./term";

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

/** Let every pending microtask settle before the next keypress; see mods.test.ts. */
async function flush(times = 12): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

function fakeStorage(): ScopedStorage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
    get length() {
      return map.size;
    },
    key: (i) => Array.from(map.keys())[i] ?? null,
  };
}

function raceTimeout<T>(p: Promise<T>, ms = 300): Promise<{ timedOut: boolean; value?: T }> {
  return Promise.race([
    p.then((value) => ({ timedOut: false as const, value })),
    new Promise<{ timedOut: true }>((resolve) => {
      setTimeout(() => resolve({ timedOut: true }), ms);
    }),
  ]);
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

function open(
  store: ProfileStore,
  realStorage: ScopedStorage | null,
): { win: FakeWindow; term: FakeTerm; reload: ReturnType<typeof vi.fn>; done: Promise<void> } {
  const win = makeFakeWindow();
  (globalThis as { window?: unknown }).window = win;
  const term = makeTerm(80, 24);
  const reload = vi.fn();
  const deps: ProfileScreenDeps = { realStorage, reload };
  const done = runProfileScreen(term, store, deps);
  return { win, term, reload, done };
}

describe("the profile list", () => {
  it("ESC exits at once, touching nothing", async () => {
    const store = new ProfileStore(fakeStorage());
    const { win, reload, done } = open(store, fakeStorage());
    await flush();
    press(win, "Escape");
    const result = await raceTimeout(done);
    expect(result.timedOut, "runProfileScreen did not return").toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it("marks the active profile in its row", async () => {
    const store = new ProfileStore(fakeStorage());
    const { win, term, done } = open(store, fakeStorage());
    await flush();
    expect(term.snapshot().some((line) => line.includes("* Default"))).toBe(true);
    press(win, "Escape");
    await done;
  });
});

describe("switching profiles", () => {
  it("updates activeId and reloads once, only after the confirm is accepted", async () => {
    const store = new ProfileStore(fakeStorage());
    const id = store.create("Testing");
    const { win, reload, done } = open(store, fakeStorage());
    await flush();
    press(win, "ArrowDown"); // Default -> Testing
    press(win, "Enter"); // open Testing's row actions
    await flush();
    press(win, "Enter"); // "Switch to this profile" (row 0: not active, so it's first)
    await flush();
    press(win, "y"); // confirm
    await flush();
    expect(store.activeId()).toBe(id);
    expect(reload).toHaveBeenCalledTimes(1);
    press(win, "Escape"); // back at the (now re-painted) list
    await done;
  });

  it("declining the confirm changes nothing", async () => {
    const store = new ProfileStore(fakeStorage());
    store.create("Testing");
    const { win, reload, done } = open(store, fakeStorage());
    await flush();
    press(win, "ArrowDown");
    press(win, "Enter");
    await flush();
    press(win, "Enter"); // Switch
    await flush();
    press(win, "n"); // decline
    await flush();
    expect(store.activeId()).toBeNull();
    expect(reload).not.toHaveBeenCalled();
    press(win, "Escape");
    await done;
  });

  it("has no Switch row for the profile that is already active", async () => {
    const store = new ProfileStore(fakeStorage());
    const { win, done } = open(store, fakeStorage());
    await flush();
    press(win, "Enter"); // open Default's own row actions (it is active)
    await flush();
    /* Only Rename is offered (Default: active, and the default is never
     * deletable) - Enter here must be Rename, not Switch, so answering "y" as
     * if it were a switch-confirm must NOT be read as a rename attempt. */
    press(win, "Enter"); // Rename
    await flush();
    press(win, "Escape"); // cancel the rename prompt
    await flush();
    expect(store.activeId()).toBeNull(); // untouched
    press(win, "Escape"); // out of row actions
    await flush();
    press(win, "Escape"); // out of the list
    await done;
  });
});

describe("renaming a profile", () => {
  it("replaces the default's placeholder name (typing over the suggestion)", async () => {
    const store = new ProfileStore(fakeStorage());
    const { win, done } = open(store, fakeStorage());
    await flush();
    press(win, "Enter"); // Default's row actions
    await flush();
    press(win, "Enter"); // Rename
    await flush();
    for (const ch of "MyProfile") press(win, ch);
    press(win, "Enter"); // accept
    await flush();
    expect(store.isDefaultNamed()).toBe(true);
    expect(store.list()[0]).toMatchObject({ id: null, name: "MyProfile" });
    press(win, "Escape");
    await done;
  });

  it("an empty name is refused, leaving the old name in place", async () => {
    const store = new ProfileStore(fakeStorage());
    const id = store.create("Testing");
    const { win, done } = open(store, fakeStorage());
    await flush();
    press(win, "ArrowDown");
    press(win, "Enter"); // Testing's row actions: Switch, Rename, Delete
    await flush();
    press(win, "ArrowDown"); // off Switch, onto Rename
    press(win, "Enter");
    await flush();
    press(win, "Escape"); // cancel out of the name prompt (resolves null)
    await flush();
    expect(store.list().find((p) => p.id === id)?.name).toBe("Testing");
    press(win, "Escape");
    await flush();
    press(win, "Escape");
    await done;
  });
});

describe("deleting a profile", () => {
  it("removes a non-active named profile without reloading", async () => {
    const store = new ProfileStore(fakeStorage());
    const real = fakeStorage();
    const id = store.create("Testing", { realStorage: real });
    const { win, reload, done } = open(store, real);
    await flush();
    press(win, "ArrowDown");
    press(win, "Enter"); // Testing's row actions
    await flush();
    press(win, "ArrowDown"); // Switch
    press(win, "ArrowDown"); // Rename
    // Delete is next
    press(win, "Enter");
    await flush();
    press(win, "y"); // confirm the erase warning
    await flush();
    expect(store.list().some((p) => p.id === id)).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    press(win, "Escape");
    await done;
  });

  it("removing the ACTIVE profile switches back to the default and reloads", async () => {
    const store = new ProfileStore(fakeStorage());
    const real = fakeStorage();
    const id = store.create("Testing", { realStorage: real });
    store.switchTo(id);
    const { win, reload, done } = open(store, real);
    await flush();
    press(win, "ArrowDown"); // onto the now-active Testing row
    press(win, "Enter");
    await flush();
    /* Active: no Switch row, so the order is Rename, Delete. */
    press(win, "ArrowDown"); // off Rename, onto Delete
    press(win, "Enter");
    await flush();
    press(win, "y");
    await flush();
    expect(store.activeId()).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
    press(win, "Escape");
    await done;
  });

  it("the default profile is never offered a Delete row", async () => {
    const store = new ProfileStore(fakeStorage());
    const { win, term, done } = open(store, fakeStorage());
    await flush();
    press(win, "Enter"); // Default's row actions
    await flush();
    const rows = term.snapshot().join("\n");
    expect(rows).not.toContain("Delete");
    press(win, "Escape");
    await flush();
    press(win, "Escape");
    await done;
  });
});

describe("creating a profile", () => {
  it("names the still-unnamed default first, then creates the new one, then can switch", async () => {
    const store = new ProfileStore(fakeStorage());
    const real = fakeStorage();
    const { win, reload, done } = open(store, real);
    await flush();
    press(win, "ArrowDown"); // Default -> "New profile..."
    press(win, "Enter");
    await flush();
    press(win, "y"); // yes, name the default first
    await flush();
    for (const ch of "Main") press(win, ch);
    press(win, "Enter");
    await flush();
    expect(store.isDefaultNamed()).toBe(true);
    for (const ch of "Alt") press(win, ch); // the new profile's own name
    press(win, "Enter");
    await flush();
    press(win, "n"); // do not copy - full reset
    await flush();
    expect(store.hasNamedProfiles()).toBe(true);
    const created = store.list().find((p) => p.name === "Alt");
    expect(created).toBeDefined();
    press(win, "y"); // switch to it now
    await flush();
    expect(store.activeId()).toBe(created!.id);
    expect(reload).toHaveBeenCalledTimes(1);
    press(win, "Escape");
    await done;
  });

  it("skips the name-the-default prompt once the default already has a name", async () => {
    const store = new ProfileStore(fakeStorage());
    store.rename(null, "Already Named");
    const real = fakeStorage();
    const { win, done } = open(store, real);
    await flush();
    press(win, "ArrowDown"); // "Already Named" -> "New profile..."
    press(win, "Enter");
    await flush();
    /* No name-the-default confirm this time: straight to the new name prompt. */
    for (const ch of "Second") press(win, ch);
    press(win, "Enter");
    await flush();
    press(win, "n"); // reset
    await flush();
    press(win, "n"); // do not switch now
    await flush();
    expect(store.list().map((p) => p.name)).toEqual(["Already Named", "Second"]);
    press(win, "Escape");
    await done;
  });

  it("copies the active profile's data when the player says yes", async () => {
    const store = new ProfileStore(fakeStorage());
    store.rename(null, "Main");
    const real = fakeStorage();
    real.setItem("neo:enabledMods", '["qol"]');
    const { win, done } = open(store, real);
    await flush();
    press(win, "ArrowDown");
    press(win, "Enter");
    await flush();
    for (const ch of "Copy") press(win, ch);
    press(win, "Enter");
    await flush();
    press(win, "y"); // copy from the active (default) profile
    await flush();
    const created = store.list().find((p) => p.name === "Copy");
    expect(created).toBeDefined();
    expect(real.map.get(`profile:${created!.id}:neo:enabledMods`)).toBe('["qol"]');
    press(win, "n"); // do not switch now
    await flush();
    press(win, "Escape");
    await done;
  });

  it("is disabled with no realStorage, and cannot be reached at all", async () => {
    const store = new ProfileStore(fakeStorage());
    const { win, term, done } = open(store, null);
    await flush();
    expect(term.snapshot().join("\n")).toContain("New profile...");
    /* Disabled rows are skipped by cursor navigation entirely (overlay.ts), so
     * ArrowDown off the one enabled row (Default) goes nowhere, and Enter still
     * opens Default's own row actions rather than the disabled row. */
    press(win, "ArrowDown");
    press(win, "Enter");
    await flush();
    expect(store.hasNamedProfiles()).toBe(false);
    press(win, "Escape");
    await flush();
    press(win, "Escape");
    await done;
  });
});
