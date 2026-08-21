/**
 * MOD_REACH gap 12, at the host: a mod's records are checked when the GAME
 * loads them, and what comes out reaches the mod manager.
 *
 * WHY A SECOND FILE. `validate.test.ts` in the SDK proves the checker runs
 * inside `composeContentPacks` and attributes correctly. That is a statement
 * about a function. This is the statement that was actually missing for eight
 * months: that the answer arrives somewhere a player can read it. The check
 * itself was built, tested and exported the whole time - and its only caller was
 * the mod BUILDER, a tool nobody but the author runs. A control enforced by the
 * author's tool and absent from the load path is not a control.
 *
 * So every case here drives `diskPackStatus()` - the reader the mod manager
 * calls - over a mod installed the way a player installs one, and asserts the
 * line lands on that mod's own row.
 */

import { afterEach, describe, expect, it } from "vitest";

import { diskPackStatus, resetComposition } from "./pack";
import { NO_DISK_PACKS, resetDiskPacks, setDiskPacks } from "./disk-packs";
import type { DiskPack, DiskPackReport } from "./disk-packs";
import { problemLines } from "./mod-problems";

afterEach(() => {
  resetDiskPacks();
  resetComposition();
});

/** A content mod contributing one monster record, whatever it is handed. */
function monsterMod(id: string, record: Record<string, unknown>): DiskPack {
  return {
    manifest: { id, name: id, version: "1.0.0", shape: "content" } as DiskPack["manifest"],
    files: { monster: { records: [record] } } as unknown as DiskPack["files"],
    code: [],
    assets: [],
  };
}

function report(packs: readonly DiskPack[]): DiskPackReport {
  return {
    ...NO_DISK_PACKS,
    packs,
    order: packs.map((p) => (p.manifest as { id: string }).id),
    available: true,
    kind: "picked",
    dir: "/mods",
  };
}

/**
 * A monster with everything core's own monsters have.
 *
 * Copied in full rather than trimmed to the fields under test: the check reports
 * on what a record is MISSING as well as what it gets wrong, and a three-field
 * stub would arrive buried in advice about the other twenty.
 */
function goodMonster(): Record<string, unknown> {
  return {
    name: "sludge fiend",
    base: "feline",
    color: "U",
    speed: 110,
    "hit-points": 2,
    hearing: 30,
    smell: 30,
    "armor-class": 1,
    sleepiness: 10,
    depth: 0,
    rarity: 3,
    experience: 0,
    blow: [{ method: "CLAW", effect: "HURT", damage: "1d1" }],
    flags: ["RAND_25"],
    desc: ["A skinny little furball with sharp claws and a menacing look."],
  };
}

describe("the game checks the records a mod loads", () => {
  it("says nothing about the base game (the anti-wolf-cry control)", () => {
    /* THE ONE THAT DECIDES WHETHER THIS FEATURE IS WORTH HAVING. A player with
     * no mods installed must open the mod manager on an empty list. Core's own
     * gamedata is not clean against core's own blueprint - it carries upstream
     * warts the port keeps on purpose - so if the base-game exclusion broke,
     * every boot would open on a wall of complaints about the game itself, and
     * the real lines would be unfindable among them. */
    setDiskPacks(NO_DISK_PACKS);
    expect(problemLines(diskPackStatus().problems)).toEqual([]);
  });

  it("a well-formed mod is quiet too (the other control)", () => {
    /* Without this, the row above and every row below would pass against a
     * checker that never says anything at all. */
    setDiskPacks(report([monsterMod("fine", goodMonster())]));
    expect(problemLines(diskPackStatus().problems)).toEqual([]);
  });

  it("a field written as the wrong type lands on that mod's row", () => {
    setDiskPacks(
      report([monsterMod("sludge", { ...goodMonster(), "hit-points": "lots" })]),
    );

    const problems = diskPackStatus().problems;
    const mine = problems.filter((p) => p.id === "sludge");
    expect(mine).toHaveLength(1);
    /* ATTRIBUTED, not prefixed. The manager asks "what is wrong with THIS mod"
     * and gets an answer without parsing punctuation - the same contract the
     * refusal channel keeps. */
    expect(mine[0]?.why).toContain("`hit-points` is string");
    expect(mine[0]?.why).toContain("sludge fiend");
  });

  it("the mod still loads: a finding costs nothing", () => {
    /* REPORT, NEVER REFUSE, and this is where that promise is kept or broken. A
     * blueprint is a measurement of core's data, not a specification, and a mod
     * coining a new value is doing something legal. Taking the mod away over a
     * statistic would punish exactly the experimentation the mod system exists
     * to allow - so the record is in the game, as written. */
    setDiskPacks(
      report([monsterMod("sludge", { ...goodMonster(), "hit-points": "lots" })]),
    );
    const status = diskPackStatus();
    expect(status.problems.some((p) => p.id === "sludge")).toBe(true);
    expect(status.problems.some((p) => p.why.includes("none of this mod"))).toBe(false);
  });

  it("two mods with the same mistake get one row each", () => {
    setDiskPacks(
      report([
        monsterMod("one", { ...goodMonster(), "hit-points": "lots" }),
        monsterMod("two", { ...goodMonster(), name: "bog wraith", speed: "quick" }),
      ]),
    );
    const byId = diskPackStatus()
      .problems.filter((p) => p.id === "one" || p.id === "two")
      .map((p) => `${p.id ?? ""}/${p.why.includes("hit-points") ? "hit-points" : "speed"}`)
      .sort();
    expect(byId).toEqual(["one/hit-points", "two/speed"]);
  });
});
