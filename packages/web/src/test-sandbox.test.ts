/**
 * The sandbox, and the one claim it makes.
 *
 * The claim is not "the save is copied somewhere safe". It is stronger and much
 * duller: after this, nothing is written at all. So what these tests read is the
 * thing that decides where a write lands - the active slot id - and they check that
 * it is gone, that the slot's own bytes and roster row were not touched on the way,
 * and that there is no route back.
 *
 * THE LAST ONE IS THE POINT. A re-attach would write a cheated character over the
 * save it was protected from, so the absence of one is the property, not an
 * omission. It is asserted by exercising the module's whole exported surface: if a
 * way back is ever added, this test has to be edited to accommodate it, and editing
 * it is the moment somebody reads why it exists.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { attachedSave, sandboxSession, sessionIsSandboxed } from "./test-sandbox";
import * as sandbox from "./test-sandbox";
import {
  getActiveId,
  listRoster,
  markDead,
  readSlotSave,
  resetSlotWriteSurrender,
  setActiveId,
  slotWritesSurrendered,
  writeSlot,
} from "./roster";
import type { CharMeta } from "./roster";

/** localStorage's shape, with a switch for the failure that matters. */
class FakeStorage {
  private map = new Map<string, string>();
  /** Refuse every write, the way a browser with storage switched off does. */
  frozen = false;

  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.frozen) throw new Error("storage disabled");
    this.map.set(key, value);
  }
  removeItem(key: string): void {
    if (this.frozen) throw new Error("storage disabled");
    this.map.delete(key);
  }
}

function meta(id: string, over: Partial<CharMeta> = {}): CharMeta {
  return {
    id,
    name: "Beren",
    race: "Human",
    cls: "Warrior",
    sex: "Male",
    level: 22,
    depth: 18,
    maxDepth: 18,
    turn: 45000,
    alive: true,
    updatedAt: 1,
    ...over,
  } as CharMeta;
}

let storage: FakeStorage;
const realStorage = globalThis.localStorage;

beforeEach(() => {
  resetSlotWriteSurrender(); // the latch is one way per PAGE, and each test is a page
  storage = new FakeStorage();
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    configurable: true,
    writable: true,
  });
});

afterEach(() => {
  Object.defineProperty(globalThis, "localStorage", {
    value: realStorage,
    configurable: true,
    writable: true,
  });
});

describe("cutting a session loose", () => {
  it("leaves the character's bytes and roster row exactly as they were", () => {
    writeSlot("slot-1", "SAVEBYTES", meta("slot-1"));
    setActiveId("slot-1");
    const before = listRoster();

    const outcome = sandboxSession();

    expect(outcome).toEqual({ ok: true, left: { id: "slot-1", name: "Beren" } });
    /* The two things a player would care about, checked separately because a
     * mechanism that dropped the roster row while keeping the bytes would be just
     * as much a lost character as the other way round. */
    expect(readSlotSave("slot-1")).toBe("SAVEBYTES");
    expect(listRoster()).toEqual(before);
  });

  it("takes away the only thing that decides where a save goes", () => {
    writeSlot("slot-1", "SAVEBYTES", meta("slot-1"));
    setActiveId("slot-1");
    expect(sessionIsSandboxed()).toBe(false);

    sandboxSession();

    /* Not a flag of the sandbox's own: the active id IS the mechanism, so reading
     * it is reading the thing that actually stops the write rather than a claim
     * about it. */
    expect(getActiveId()).toBeNull();
    expect(sessionIsSandboxed()).toBe(true);
  });

  it("names who is about to be left behind, before anything happens", () => {
    writeSlot("slot-1", "SAVEBYTES", meta("slot-1", { name: "Luthien" }));
    setActiveId("slot-1");
    /* This is what a mod puts in the question it asks the player. A question that
     * could not name the character would be one nobody can weigh. */
    expect(attachedSave()).toEqual({ id: "slot-1", name: "Luthien" });
    sandboxSession();
    expect(attachedSave()).toBeNull();
  });

  it("reports a slot with no roster row rather than refusing it", () => {
    /* An active id with no row is a slot mid-birth: allocated so the first autosave
     * lands, with nothing written yet. "Is there something to protect" and "what is
     * it called" are two questions and only the first one gates anything. */
    setActiveId("slot-new");
    expect(attachedSave()).toEqual({ id: "slot-new", name: "" });
    expect(sandboxSession()).toEqual({ ok: true, left: { id: "slot-new", name: "" } });
  });

  it("succeeds on a session that was already loose, and says nothing was left", () => {
    /* A throwaway behind the character select, or a save that failed to load. A
     * caller asking for a session that writes nowhere has got one, so this is an
     * `ok` with nothing in it rather than a refusal about state it cannot see. */
    expect(sandboxSession()).toEqual({ ok: true, left: null });
    expect(sessionIsSandboxed()).toBe(true);
  });
});

describe("a storage failure is reported, not swallowed", () => {
  it("refuses when the browser would not let go of the slot", () => {
    writeSlot("slot-1", "SAVEBYTES", meta("slot-1"));
    setActiveId("slot-1");
    /* The failure that matters, and the reason the write is read back instead of
     * trusted: a caller told the session was safe would go on to cheat a character
     * that is still being autosaved every three seconds. */
    storage.frozen = true;

    const outcome = sandboxSession();

    expect(outcome.ok).toBe(false);
    expect(outcome.ok === false && outcome.problem).toContain("still being written to");
    expect(sessionIsSandboxed()).toBe(false);
  });
});

describe("there is no way back", () => {
  it("exports nothing that re-attaches a sandboxed session", () => {
    /* THE ABSENCE IS THE FEATURE. Re-attaching would mean writing a cheated
     * character over the save it was detached from, which is the single outcome
     * this module exists to make unreachable - so the surface is pinned, and adding
     * a way back means editing this list and reading this comment first. */
    expect(Object.keys(sandbox).sort()).toEqual([
      "attachedSave",
      "sandboxSession",
      "sessionIsSandboxed",
    ]);
  });
});

/**
 * Another tab, which is where dropping the active id stops being sufficient.
 *
 * `localStorage` is shared across every tab on the origin, so the key that decides
 * where a save lands is not this page's to hold. A second tab resuming a character
 * writes a real slot id back into it, and a page that had given up its save - and
 * has since been cheated freely - is re-attached to somebody's real character
 * without either player doing anything wrong.
 *
 * The write is the obvious half. The DEATH path is the half that does permanent
 * damage, because it destroys the slot's bytes and records a death in a ledger that
 * deliberately outlives the tombstone.
 */
describe("another tab cannot re-attach a sandboxed page", () => {
  const twoTabs = (): void => {
    writeSlot("slot-1", "REAL-SAVE", meta("slot-1"));
    setActiveId("slot-1");
    sandboxSession();
    /* The other tab reaches the character select and resumes. `resumeSelected`
     * calls setActiveId, and it is writing to storage this page also reads. */
    setActiveId("slot-1");
  };

  it("still reports itself sandboxed, though the shared key says otherwise", () => {
    twoTabs();
    expect(getActiveId()).toBe("slot-1"); // the other tab really did do this
    expect(sessionIsSandboxed()).toBe(true);
    expect(slotWritesSurrendered()).toBe(true);
  });

  it("cannot write a save over the character the other tab resumed", () => {
    twoTabs();
    /* The save path reads the shared key, finds a real slot id, and asks for the
     * write. Refused here rather than there, because "there" is a decision made
     * from storage anybody can edit. */
    expect(writeSlot("slot-1", "CHEATED-SAVE", meta("slot-1", { level: 50 }))).toBe(true);
    expect(readSlotSave("slot-1")).toBe("REAL-SAVE");
    expect(listRoster()[0]?.level).toBe(22);
  });

  it("cannot tombstone the character the other tab resumed", () => {
    /* THE WORST ONE. A monster killing the cheated character would otherwise run
     * the death path against whichever slot the shared key named by then - and the
     * death path DESTROYS the bytes and writes a memorial for a character that is
     * still alive in another tab. */
    twoTabs();
    expect(markDead("slot-1")).toBe(true);
    expect(readSlotSave("slot-1")).toBe("REAL-SAVE");
    expect(listRoster()[0]?.alive).toBe(true);
    expect(sandbox.attachedSave()).not.toBeNull(); // the key still points at them
  });

  it("reports a refused write as success rather than as a storage failure", () => {
    /* mod-taint.ts's distinction, and made here for its reason: "the storage would
     * not take it" is worth telling a player about because retrying might work, and
     * "it was deliberately not offered" is not - a save-failure warning would send
     * them looking for a broken browser. */
    twoTabs();
    expect(writeSlot("slot-1", "CHEATED-SAVE", meta("slot-1"))).toBe(true);
  });
});

describe("the latch is not thrown by a refused detach", () => {
  it("leaves a still-attached page able to save", () => {
    /* One way means the order matters. Latching before the detach is known to have
     * worked would leave a page that is STILL being pointed at by the active key
     * and can no longer write to it, which is the worst of both and not what a
     * refused call should leave behind. */
    writeSlot("slot-1", "REAL-SAVE", meta("slot-1"));
    setActiveId("slot-1");
    storage.frozen = true;

    expect(sandboxSession().ok).toBe(false);

    storage.frozen = false;
    expect(slotWritesSurrendered()).toBe(false);
    expect(writeSlot("slot-1", "LATER-SAVE", meta("slot-1"))).toBe(true);
    expect(readSlotSave("slot-1")).toBe("LATER-SAVE");
  });
});
