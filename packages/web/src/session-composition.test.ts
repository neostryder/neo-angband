/**
 * Does a session-only mod actually reach the game?
 *
 * WHY THIS FILE EXISTS SEPARATELY from mod-session.test.ts. Everything there
 * proves the tier works: an archive is staged, read back, and turned into a
 * `DiskPackReport` with a pack in it. None of it proves the pack reaches the
 * CONTENT the game is built from, and that is a different question with its own
 * failure mode - a report nothing composes from is the "green and dead seam" this
 * project keeps finding, and it would pass every assertion in that file.
 *
 * So this drives the real composer. `composition()` (pack.ts) is what
 * `loadGamePack()` calls, over the real base game's 3279 records, and the claim
 * under test is that a staged pack's record is in the composed output and that
 * its namespace is in the set `loadGame` reconciles a save against. Two things
 * have to be true at once for that, and each of them is a line somebody could
 * have forgotten: the fused report has to carry the pack, and `enabledModIds`
 * has to force the staged id on.
 *
 * Slow on purpose. The first import of ./pack composes the ENTIRE content pack,
 * measured at 3.8s on an idle machine, which is why mid-game-mods.test.ts raises
 * its budget for the same reason. The work IS the subject: a session pack has to
 * compose against the real game, not against a fixture.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { zipSync } from "fflate";
import { loadSessionMods, stageSessionMod, type SessionStorageLike } from "./mod-session";
import { resetDiskPacks } from "./disk-packs";

const enc = (s: string): Uint8Array => new TextEncoder().encode(s);

/** A content pack that adds one monster, in the shape a pack file takes. */
function draftArchive(id: string, monster: string): Uint8Array {
  return zipSync({
    "manifest.json": enc(
      JSON.stringify({
        id,
        name: "A draft",
        version: "0.1.0",
        shape: "content",
        author: "a player",
        engine: ">=0.1.0",
        repository: `https://github.com/a-player/${id}`,
      }),
    ),
    "monster.json": enc(
      JSON.stringify({
        records: [
          {
            name: monster,
            base: "dog",
            depth: 3,
            rarity: 1,
            "average-hp": 12,
            speed: 110,
            experience: 8,
            "armor-class": 12,
            sleepiness: 30,
            hearing: 20,
            color: "u",
            desc: ["A test creature."],
          },
        ],
      }),
    ),
  });
}

function store(): SessionStorageLike {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

afterEach(() => {
  resetDiskPacks();
  vi.resetModules();
});

describe("a session-only pack composes into the running game", () => {
  it("puts its record in the composed content, and its namespace in the present set", async () => {
    const scope = { sessionStorage: store(), crypto: globalThis.crypto };
    const staged = await stageSessionMod(
      { bytes: draftArchive("session-draft", "test hound"), source: "draft.zip", allowed: true },
      scope,
    );
    expect(staged.ok).toBe(true);
    if (!staged.ok) return;

    const report = await loadSessionMods(scope);
    expect(report.packs.map((p) => p.manifest.id)).toEqual(["session-draft"]);

    /* Imported AFTER the latch, so the composition memo has never been filled
     * against an empty session tier. Importing it first and expecting the memo to
     * notice is the other half of the same question and is covered in
     * mod-session.test.ts, which asserts the report's identity changes. */
    const pack = await import("./pack");

    /* THE FORCED-ENABLE HALF. Staging is the gesture; there is no row to switch
     * on, so a staged id that is not in this list composes nothing at all. */
    expect(pack.enabledModIds()).toContain("session-draft");

    /* THE COMPOSITION HALF, read off the same function the mod-authoring seam
     * publishes and the game is built from. */
    const monsters = (pack.composedRecords()["monster"] ?? []) as { name?: string }[];
    expect(monsters.some((m) => m.name === "test hound")).toBe(true);
    /* And the base game is still there: a staged pack ADDS, and a composition that
     * had replaced core's content would pass the line above and be a disaster. */
    expect(monsters.length).toBeGreaterThan(100);

    /* THE SAVE-RECONCILIATION HALF. `loadGame` quarantines live entities whose
     * namespace is absent from this set, so a staged pack missing from it would
     * mean the monster above exists in the game and is thrown out of the save on
     * the next load - the add-a-mod-mid-game hazard, arriving by a new route. */
    expect([...pack.presentNamespaces()]).toContain("session-draft");
  }, 30_000);

  it("composes nothing when the staged archive has been dropped", async () => {
    const scope = { sessionStorage: store(), crypto: globalThis.crypto };
    await loadSessionMods(scope);
    const pack = await import("./pack");
    expect(pack.enabledModIds()).not.toContain("session-draft");
    const monsters = (pack.composedRecords()["monster"] ?? []) as { name?: string }[];
    expect(monsters.some((m) => m.name === "test hound")).toBe(false);
    expect([...pack.presentNamespaces()]).toEqual(["core"]);
  }, 30_000);
});
