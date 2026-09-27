import { afterEach, describe, expect, it, vi } from "vitest";
import { CapabilitySet } from "@rpgm-tools/neo-angband-mod-sdk";
import { createModSaves, type SavesDoorDeps } from "./saves-facade";
import { modPluginContext } from "./mod-context";
import { deleteSlot, listRoster, renameSlot, setRosterStorage, type CharMeta } from "./roster";

const alice: CharMeta = {
  id: "alice", name: "Alice", race: "Human", cls: "Mage", sex: "",
  level: 12, depth: 7, maxDepth: 9, turn: 400, alive: true, updatedAt: 200,
};
const bob: CharMeta = { ...alice, id: "bob", name: "Bob", alive: false, updatedAt: 100 };

function storage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => { data.set(key, value); },
    removeItem: (key: string) => { data.delete(key); },
  };
}

function deps(over: Partial<SavesDoorDeps> = {}): SavesDoorDeps {
  return {
    listRoster: vi.fn(listRoster),
    load: vi.fn(async () => ({ ok: true as const })),
    rename: vi.fn((id, name) => renameSlot(id, name)
      ? { ok: true as const }
      : { ok: false as const, reason: "Storage failed." }),
    confirmDelete: vi.fn(async () => true),
    deleteSlot: vi.fn(deleteSlot),
    activeSlot: vi.fn(() => null),
    namePinned: vi.fn(() => false),
    ...over,
  };
}

afterEach(() => setRosterStorage(null));

describe("mod saves facade", () => {
  it("lists frozen entries from the roster's own ordered metadata", async () => {
    const backing = storage();
    setRosterStorage(backing);
    backing.setItem("neo-angband-roster", JSON.stringify([bob, alice]));
    const door = deps();
    const result = await createModSaves(door).list();
    expect(door.listRoster).toHaveBeenCalledOnce();
    expect(result).toEqual({ ok: true, entries: [
      { id: "alice", name: "Alice", race: "Human", cls: "Mage", level: 12, depth: 7, dead: false, lastPlayed: 200 },
      { id: "bob", name: "Bob", race: "Human", cls: "Mage", level: 12, depth: 7, dead: true, lastPlayed: 100 },
    ] });
    if (result.ok) {
      expect(Object.isFrozen(result.entries)).toBe(true);
      expect(result.entries.every(Object.isFrozen)).toBe(true);
    }
  });

  it("routes load through the host callback and refuses tombstones", async () => {
    const door = deps({ listRoster: vi.fn(() => [alice, bob]) });
    const saves = createModSaves(door);
    expect(await saves.load("alice")).toEqual({ ok: true });
    expect(door.load).toHaveBeenCalledExactlyOnceWith("alice");
    expect(await saves.load("bob")).toEqual({ ok: false, reason: "This character has died." });
    expect(door.load).toHaveBeenCalledTimes(1);
  });

  it("uses the roster rename path without writing save bytes", async () => {
    const backing = storage();
    setRosterStorage(backing);
    backing.setItem("neo-angband-roster", JSON.stringify([alice]));
    backing.setItem("neo-angband-save:alice", "unchanged");
    const door = deps();
    const saves = createModSaves(door);
    expect(await saves.rename("alice", "  New  ")).toEqual({ ok: true });
    expect(door.rename).toHaveBeenCalledExactlyOnceWith("alice", "New");
    expect(listRoster()[0]?.name).toBe("New");
    expect(backing.getItem("neo-angband-save:alice")).toBe("unchanged");
    expect(await saves.rename("alice", " ")).toMatchObject({ ok: false });
    expect(door.rename).toHaveBeenCalledTimes(1);
  });

  it("refuses the active slot and requires host confirmation", async () => {
    const backing = storage();
    setRosterStorage(backing);
    backing.setItem("neo-angband-roster", JSON.stringify([alice]));
    const active = deps({ activeSlot: () => "alice" });
    expect(await createModSaves(active).delete("alice")).toMatchObject({ ok: false });
    expect(active.confirmDelete).not.toHaveBeenCalled();
    expect(active.deleteSlot).not.toHaveBeenCalled();

    const cancelled = deps({ confirmDelete: vi.fn(async () => false) });
    expect(await createModSaves(cancelled).delete("alice")).toMatchObject({ ok: false });
    expect(cancelled.deleteSlot).not.toHaveBeenCalled();
    const confirmed = deps();
    expect(await createModSaves(confirmed).delete("alice")).toEqual({ ok: true });
    expect(confirmed.confirmDelete).toHaveBeenCalledExactlyOnceWith(alice);
    expect(confirmed.deleteSlot).toHaveBeenCalledExactlyOnceWith("alice");
  });

  it("is absent without saves:manage, including before a game exists", () => {
    const make = (capabilities: string[]) => CapabilitySet.fromManifest({
      id: "saves-test", name: "Saves test", version: "1.0.0", shape: "plugin",
      capabilities,
    });
    const saves = createModSaves(deps());
    expect(modPluginContext("plain", {}, undefined, {}, { capabilities: make([]), saves }).saves).toBeUndefined();
    expect(modPluginContext("roster", {}, undefined, {}, { capabilities: make(["saves:manage"]), saves }).saves).toBe(saves);
  });
});
