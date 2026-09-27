import { describe, expect, it } from "vitest";
import { addOrphanedSaves, listOrphanedSaves, type OrphanStorage } from "./orphan-saves";
import type { CharMeta } from "./roster";

function storage(): OrphanStorage & { get(key: string): string | null } {
  const map = new Map<string, string>();
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => { map.set(key, value); },
    removeItem: (key) => { map.delete(key); },
    get: (key) => map.get(key) ?? null,
  };
}

const bilbo: CharMeta = {
  id: "char-1",
  name: "Bilbo",
  race: "Hobbit",
  cls: "Rogue",
  sex: "male",
  level: 5,
  depth: 3,
  maxDepth: 3,
  turn: 100,
  alive: true,
  updatedAt: 50,
};

describe("orphaned saves", () => {
  it("converts a previous array and does not write that key again", () => {
    const saved = storage();
    saved.setItem("neo-angband-orphaned-saves", JSON.stringify([{
      id: "orphan-1",
      fromProfileName: "Testing",
      removedAt: 80,
      lineage: "char-1",
      meta: bilbo,
      save: "c2F2ZQ==",
    }]));
    expect(listOrphanedSaves(saved)[0]?.meta.name).toBe("Bilbo");
    expect(listOrphanedSaves(saved)[0]?.removedAt).toBe(80);
    expect(saved.get("neo-angband-orphaned-saves")).toBeNull();
    const document = saved.get("neo-angband-orphan-records");
    expect(document).toContain("neo-angband/web/orphan-saves");
    addOrphanedSaves(saved, []);
    expect(saved.get("neo-angband-orphaned-saves")).toBeNull();
  });

  it("leaves a future or corrupt document in place", () => {
    const saved = storage();
    const future = JSON.stringify({
      format: "neo-angband/web/orphan-saves",
      schemaVersion: 9,
      data: { orphans: [] },
    });
    saved.setItem("neo-angband-orphan-records", future);
    expect(listOrphanedSaves(saved)).toEqual([]);
    expect(saved.get("neo-angband-orphan-records")).toBe(future);
    expect(addOrphanedSaves(saved, [{ id: "orphan-2", fromProfileName: "Test", removedAt: 80, lineage: "char-1", meta: bilbo, save: "c2F2ZQ==" }])).toBe(false);
    expect(saved.get("neo-angband-orphan-records")).toBe(future);
  });
});
