/**
 * Two windows on one character, which is a thing a player does by accident.
 *
 * THE BUG THESE EXIST FOR was not subtle and was not rare. `neo-angband-active`
 * named the character every save was written to and lived in `localStorage`, which
 * every tab on the origin shares. Two tabs open on one character both read it,
 * both believed themselves that character's writer, and both autosaved into the
 * same slot every three seconds with different games in memory. Last writer won.
 * The other player's session was gone with nothing anywhere saying so, which is
 * the part that made it expensive: a tab that has silently stopped counting looks
 * exactly like a tab that is counting, right up until it is closed.
 *
 * SO A TEST HAS TO BE TWO PAGES, and one process only has one module registry. The
 * `page()` helper below buys a second one with `vi.resetModules()` plus a dynamic
 * import, so each page gets its own copy of `slot-attach`'s module state - which is
 * exactly what a real second tab has, and is the whole substance of the fix. What
 * they SHARE is what two real tabs share: `localStorage`, and one origin-wide Web
 * Locks manager. A fake that gave each page its own lock manager would pass every
 * test here and prove nothing, so the fake is built once and installed on
 * `globalThis` for both.
 */

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type SlotAttach = typeof import("./slot-attach");

/* ------------------------------------------------------------------ *
 * The origin: one lock manager and one localStorage, shared by both pages.
 * ------------------------------------------------------------------ */

/**
 * Enough of `navigator.locks` for exclusive holds and `query()`.
 *
 * Only the two behaviours the code depends on are modelled: `ifAvailable` hands
 * the callback `null` instead of queueing when the name is taken, and the lock is
 * held for exactly as long as the callback's promise is unresolved. Queueing
 * without `ifAvailable` is deliberately NOT modelled, because the production code
 * never asks for it and a fake that supported it would invite somebody to start.
 */
class FakeLocks {
  private readonly heldNames = new Set<string>();

  async request(
    name: string,
    options: { mode?: string; ifAvailable?: boolean },
    callback: (lock: { name: string } | null) => unknown,
  ): Promise<void> {
    /* NEVER SYNCHRONOUSLY, which is not a detail. The real manager resolves the
     * request off the calling task, so production code gets a whole tick in which
     * to change its mind - attach a character, then attach a different one before
     * the first answer lands. A fake that called back inline would run the answer
     * before the change of mind and silently test a world that cannot happen. */
    await Promise.resolve();
    if (this.heldNames.has(name)) {
      if (options.ifAvailable !== true) {
        throw new Error("this fake only models ifAvailable requests");
      }
      await callback(null);
      return;
    }
    this.heldNames.add(name);
    let section: unknown;
    try {
      section = callback({ name });
    } catch (err) {
      this.heldNames.delete(name);
      throw err;
    }
    /* The callback returning nothing means it did not want the lock: give it
     * straight back, which is what a real manager does with a void return. */
    if (section === undefined) {
      this.heldNames.delete(name);
      return;
    }
    await section;
    this.heldNames.delete(name);
  }

  async query(): Promise<{ held: { name: string }[]; pending: never[] }> {
    return { held: [...this.heldNames].map((name) => ({ name })), pending: [] };
  }

  /** For an assertion about the hold itself rather than about who thinks what. */
  isHeld(name: string): boolean {
    return this.heldNames.has(name);
  }
}

/** localStorage's shape. Shared, because that is the whole premise. */
class FakeStorage {
  readonly map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

let locks: FakeLocks | null;
let storage: FakeStorage;
/** Every `pagehide` / `pageshow` listener a page installed, by page. */
let listeners: { type: string; fn: (ev: unknown) => void }[];

const realNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
const realStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
const realAdd = globalThis.addEventListener;

function define(key: string, value: unknown): void {
  Object.defineProperty(globalThis, key, { value, configurable: true, writable: true });
}

/**
 * A fresh page: its own copy of `slot-attach`'s module state, over the shared
 * origin. This is the only way to have two attachments alive at once, and having
 * two alive at once is the thing under test.
 */
async function page(): Promise<SlotAttach> {
  vi.resetModules();
  return (await import("./slot-attach")) as SlotAttach;
}

/** Let the background lock request settle. It is a promise, not a timer. */
async function settle(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

beforeEach(() => {
  locks = new FakeLocks();
  storage = new FakeStorage();
  listeners = [];
  define("navigator", { locks });
  define("localStorage", storage);
  define("addEventListener", (type: string, fn: (ev: unknown) => void) => {
    listeners.push({ type, fn });
  });
});

afterEach(() => {
  if (realNavigator) Object.defineProperty(globalThis, "navigator", realNavigator);
  if (realStorage) Object.defineProperty(globalThis, "localStorage", realStorage);
  define("addEventListener", realAdd);
  vi.resetModules();
});

/* ------------------------------------------------------------------ *
 * The contention itself.
 * ------------------------------------------------------------------ */

describe("two windows on one character", () => {
  it("gives the character to the first window and refuses the second", async () => {
    const tabA = await page();
    const tabB = await page();

    tabA.attachSlot("slot-1");
    await settle();
    tabB.attachSlot("slot-1");
    await settle();

    /* THE PROPERTY. One writer, and it is the one that got there first - not the
     * one that wrote the shared key most recently, which is what decided it
     * before and is why the loser was arbitrary. */
    expect(tabA.attachedSlot()).toBe("slot-1");
    expect(tabB.attachedSlot()).toBeNull();
  });

  it("tells the refused window, rather than letting it play on unsaved", async () => {
    /* The silence WAS the bug. A window that has stopped saving and does not say
     * so is indistinguishable from one that is saving, so the player finds out by
     * losing an evening. */
    const tabA = await page();
    const tabB = await page();
    const told: string[] = [];

    tabA.attachSlot("slot-1");
    await settle();
    tabB.onSlotLost((id) => told.push(id));
    tabB.attachSlot("slot-1");
    await settle();

    expect(told).toEqual(["slot-1"]);
  });

  it("leaves the first window writing normally throughout", async () => {
    /* The other half, and the one a fix can get wrong: a defence that stopped BOTH
     * windows saving would pass "they no longer overwrite each other" and lose the
     * character anyway. */
    const tabA = await page();
    const tabB = await page();

    tabA.attachSlot("slot-1");
    await settle();
    tabB.attachSlot("slot-1");
    await settle();

    expect(tabA.attachedSlot()).toBe("slot-1");
    expect(locks?.isHeld("neo-angband-slot:slot-1")).toBe(true);
  });

  it("cannot be redirected by the other window writing the shared key", async () => {
    /* THE ORIGINAL MECHANISM, exercised directly. `resumeSelected` in another tab
     * calls `setActiveId`, which writes storage this page reads too. Under the old
     * design that redirected this page's saves. The attachment is memory, so the
     * write is visible and inert. */
    const tabA = await page();
    tabA.attachSlot("slot-1");
    await settle();

    storage.map.set("neo-angband-active", "slot-2"); // the other tab resumed somebody else

    expect(tabA.attachedSlot()).toBe("slot-1");
  });

  it("lets two windows play two DIFFERENT characters at once", async () => {
    /* Not a collision, and must not be treated as one. The per-slot lock is what
     * keeps this legal; a single "somebody is playing" flag would have made a
     * second character a second-class one. */
    const tabA = await page();
    const tabB = await page();

    tabA.attachSlot("slot-1");
    tabB.attachSlot("slot-2");
    await settle();

    expect(tabA.attachedSlot()).toBe("slot-1");
    expect(tabB.attachedSlot()).toBe("slot-2");
  });

  it("hands the character back when the first window lets go", async () => {
    /* "Switch character", death, and closing the window all end in a detach. A
     * hold that outlived them would lock a player out of their own character with
     * no way back, which is a worse bug than the one being fixed. */
    const tabA = await page();
    const tabB = await page();

    tabA.attachSlot("slot-1");
    await settle();
    tabA.detachSlot();
    await settle();

    tabB.attachSlot("slot-1");
    await settle();

    expect(tabB.attachedSlot()).toBe("slot-1");
    expect(tabA.attachedSlot()).toBeNull();
  });
});

describe("the character select asks before it opens", () => {
  it("reports a character another window is playing", async () => {
    /* The deliberate door: refusing here costs the player a sentence, and finding
     * out afterwards costs them a window they thought they were playing in. */
    const tabA = await page();
    const tabB = await page();

    tabA.attachSlot("slot-1");
    await settle();

    expect(await tabB.slotHeldElsewhere("slot-1")).toBe(true);
    expect(await tabB.slotHeldElsewhere("slot-2")).toBe(false);
  });

  it("does not report the window's OWN character as taken", async () => {
    /* Held here is not held elsewhere. Answering true would make a window refuse
     * to reopen the character it is already playing. */
    const tabA = await page();
    tabA.attachSlot("slot-1");
    await settle();
    expect(await tabA.slotHeldElsewhere("slot-1")).toBe(false);
  });

  it("answers false, not true, when the browser has no Web Locks", async () => {
    /* REFUSING ON IGNORANCE WOULD BE THE WORSE FAILURE. Without the API this
     * cannot tell a taken character from a free one, and a game that will not open
     * any character on a browser that lacks a lock manager has traded a collision
     * for a brick. */
    define("navigator", {});
    const tab = await page();
    expect(await tab.slotHeldElsewhere("slot-1")).toBe(false);
  });
});

describe("a browser with no Web Locks still saves", () => {
  it("attaches both windows rather than neither", async () => {
    /* The documented degradation, asserted so it stays deliberate. Without the API
     * there is no cross-page hold and the old collision is still possible; what is
     * NOT acceptable is a page that refuses to attach and therefore never saves,
     * because that loses the character of somebody who only ever opened one tab. */
    define("navigator", {});
    const tabA = await page();
    const tabB = await page();

    tabA.attachSlot("slot-1");
    tabB.attachSlot("slot-1");
    await settle();

    expect(tabA.attachedSlot()).toBe("slot-1");
    expect(tabB.attachedSlot()).toBe("slot-1");
  });

  it("survives a lock manager that throws", async () => {
    define("navigator", {
      locks: {
        request: () => Promise.reject(new Error("no")),
        query: () => Promise.reject(new Error("no")),
      },
    });
    const tab = await page();
    tab.attachSlot("slot-1");
    await settle();
    expect(tab.attachedSlot()).toBe("slot-1");
  });
});

describe("the races inside one page", () => {
  it("keeps no hold for a slot the page let go of while the request was in flight", async () => {
    /* Boot is synchronous and the lock request is not, so a page can attach and
     * detach before its own grant arrives. Sitting on the hold afterwards would
     * lock a character nobody in this window is playing. */
    const tab = await page();
    tab.attachSlot("slot-1");
    tab.detachSlot(); // same tick, before the grant
    await settle();

    expect(tab.attachedSlot()).toBeNull();
    expect(locks?.isHeld("neo-angband-slot:slot-1")).toBe(false);
  });

  it("ignores a refusal for a character the page has already moved off", async () => {
    /* Stale news. The player switched away while the probe was in flight, and
     * acting on it would detach them from the character they switched TO. */
    const tabA = await page();
    const tabB = await page();
    const told: string[] = [];

    tabA.attachSlot("slot-1");
    await settle();

    tabB.onSlotLost((id) => told.push(id));
    tabB.attachSlot("slot-1"); // will be refused
    tabB.attachSlot("slot-2"); // but the player has already moved on
    await settle();

    expect(told).toEqual([]);
    expect(tabB.attachedSlot()).toBe("slot-2");
  });

  it("treats attaching the same character twice as one claim", async () => {
    const tab = await page();
    tab.attachSlot("slot-1");
    await settle();
    tab.attachSlot("slot-1");
    await settle();
    expect(tab.attachedSlot()).toBe("slot-1");
    expect(locks?.isHeld("neo-angband-slot:slot-1")).toBe(true);
  });
});

describe("the back/forward cache", () => {
  const fire = (type: string, ev: unknown): void => {
    for (const l of listeners.filter((x) => x.type === type)) l.fn(ev);
  };

  it("gives the hold back on pagehide, so a frozen page does not lock a character", async () => {
    /* A bfcached page is not destroyed, so its locks are not released by the
     * browser. A player who navigated away would keep their own character locked
     * against the next window they open. */
    const tab = await page();
    tab.attachSlot("slot-1");
    await settle();
    expect(locks?.isHeld("neo-angband-slot:slot-1")).toBe(true);

    fire("pagehide", { persisted: true });
    await settle();

    expect(locks?.isHeld("neo-angband-slot:slot-1")).toBe(false);
    /* And the attachment is deliberately kept: `pagehide` is also where the game
     * force-flushes its save, and detaching would throw that last save away. */
    expect(tab.attachedSlot()).toBe("slot-1");
  });

  it("asks for the hold again when the page comes back", async () => {
    const tab = await page();
    tab.attachSlot("slot-1");
    await settle();
    fire("pagehide", { persisted: true });
    await settle();

    fire("pageshow", { persisted: true });
    await settle();

    expect(tab.attachedSlot()).toBe("slot-1");
    expect(locks?.isHeld("neo-angband-slot:slot-1")).toBe(true);
  });

  it("detaches a restored page whose character was taken while it was frozen", async () => {
    const tabA = await page();
    const told: string[] = [];
    tabA.onSlotLost((id) => told.push(id));
    tabA.attachSlot("slot-1");
    await settle();
    /* AFTER the attach, because that is when the page registers them. Snapshotted
     * because tab B is about to add its own to the same shared array, and firing
     * both tabs' handlers would be firing an event at a page that is not there. */
    const tabAListeners = [...listeners];

    for (const l of tabAListeners.filter((x) => x.type === "pagehide")) l.fn({ persisted: true });
    await settle();

    /* Another window takes the character while this one is in the cache. */
    const tabB = await page();
    tabB.attachSlot("slot-1");
    await settle();
    expect(tabB.attachedSlot()).toBe("slot-1");

    for (const l of tabAListeners.filter((x) => x.type === "pageshow")) l.fn({ persisted: true });
    await settle();

    expect(tabA.attachedSlot()).toBeNull();
    expect(told).toEqual(["slot-1"]);
    expect(tabB.attachedSlot()).toBe("slot-1"); // the one actually playing is untouched
  });

  it("does not make an ordinary reload look like a second window", async () => {
    /* THE ONE THAT WOULD BREAK EVERYTHING. Half this game's navigation is a
     * reload of itself - resuming a character, switching character, applying a
     * mod - and during one the outgoing document and the incoming one briefly
     * coexist. If the outgoing page's hold outlived its `pagehide`, every such
     * reload would find its own character taken and refuse the player entry to
     * it. That is a worse bug than the collision this module exists for, and a
     * much more frequent one, so it gets its own test rather than being left to
     * the bfcache cases above. */
    const outgoing = await page();
    outgoing.attachSlot("slot-1");
    await settle();
    const outgoingListeners = [...listeners];

    /* The navigation: `pagehide` on the way out, then the new document boots and
     * resumes the same character, exactly as `resumeSelected` arranges. */
    for (const l of outgoingListeners.filter((x) => x.type === "pagehide")) {
      l.fn({ persisted: false });
    }
    const incoming = await page();
    incoming.attachSlot("slot-1");
    await settle();

    expect(incoming.attachedSlot()).toBe("slot-1");
    expect(locks?.isHeld("neo-angband-slot:slot-1")).toBe(true);
  });

  it("does nothing on a pageshow that was not a restore", async () => {
    const tab = await page();
    tab.attachSlot("slot-1");
    await settle();
    fire("pageshow", { persisted: false });
    await settle();
    expect(tab.attachedSlot()).toBe("slot-1");
  });
});

/* ------------------------------------------------------------------ *
 * And that main.ts actually reads it.
 * ------------------------------------------------------------------ */

const MAIN = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

/** The body of a top-level `function`/`async function` declaration, by name. */
function functionBody(src: string, name: string): string {
  const start = src.search(new RegExp(`function ${name}\\s*[(<]`));
  expect(start, `main.ts no longer declares ${name}()`).toBeGreaterThan(-1);
  const open = src.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "{") depth++;
    else if (src[i] === "}") {
      depth--;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  throw new Error(`unbalanced braces reading ${name}()`);
}

/** Source with comments stripped, so prose about a call cannot pass for one. */
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/\/\/[^\n]*/gu, "");
}

/**
 * WHY THIS IS READ AS TEXT rather than exercised. `main.ts` is the game: importing
 * it starts a boot, a canvas and a turn loop, so nothing here can call
 * `persistSave` directly. The module above is testable and tested; what this
 * checks is the join, which is the half that historically breaks - a correct
 * destination that nothing consults is the same bug in a better hiding place.
 */
describe("main.ts writes to the attachment and not to the shared key", () => {
  it("persistSave reads attachedSlot()", () => {
    const body = stripComments(functionBody(MAIN, "persistSave"));
    expect(body).toMatch(/const id = attachedSlot\(\);/u);
  });

  it("persistSave never reads getActiveId()", () => {
    /* THE REGRESSION THIS FILE EXISTS FOR. One `getActiveId()` back in here and
     * every save in the tab is addressed by a key another tab can rewrite. */
    expect(stripComments(functionBody(MAIN, "persistSave"))).not.toMatch(/getActiveId\(/u);
  });

  it("the death path tombstones the attachment and not the shared key", () => {
    /* THE ONE THAT DESTROYS BYTES. `markDead` drops a slot's save and writes a
     * death into a ledger that outlives the tombstone, so addressing it from a key
     * another tab can rewrite means a death here can bury a hero over there. */
    const src = stripComments(MAIN);
    const at = src.indexOf("markDead(activeId)");
    expect(at, "the death path still tombstones activeId").toBeGreaterThan(-1);
    const decl = src.lastIndexOf("const activeId =", at);
    expect(decl).toBeGreaterThan(-1);
    expect(src.slice(decl, at)).toMatch(/const activeId = attachedSlot\(\);/u);
  });

  it("every character the picker opens is checked against the other windows", () => {
    /* Both doors: the picker's own row, and "Resume", which is the same act
     * with the list skipped and is the one that gets forgotten. */
    const src = stripComments(MAIN);
    const checks = src.match(/refusedAsPlayedElsewhere\(/gu) ?? [];
    expect(checks.length, "both resume doors still ask").toBeGreaterThanOrEqual(3);
    expect(src).toMatch(/if \(await refusedAsPlayedElsewhere\(res\.id\)\) continue;/u);
  });

  it("boot attaches on the resume path and on a genuine new character", () => {
    const body = stripComments(functionBody(MAIN, "bootGame"));
    expect(body).toMatch(/attachSlot\(activeId\);/u);
    expect(body).toMatch(/attachSlot\(id\);/u);
  });

  it("boot attaches nothing behind the character select", () => {
    /* A throwaway claims no slot. It used to claim whatever the shared key still
     * named - a legacy migration, or the character this tab last played - and
     * `birthPending` was the only thing standing between that and a real save
     * being overwritten by a level-one nobody. */
    const body = stripComments(functionBody(MAIN, "bootGame"));
    const at = body.indexOf("if (!needsSelect) {");
    expect(at, "boot still gates the attach on needsSelect").toBeGreaterThan(-1);
  });
});
