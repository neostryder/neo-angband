/**
 * MOD_REACH gap 10, driven from a real folder: which pack a record came from
 * survives composition, survives binding, and comes out in the id a savefile
 * stores.
 *
 * WHY FROM DISK. The SDK's own tests prove the composer stamps and core's prove
 * the binder reads, and both of those could be true while the host in between
 * dropped it - which is exactly the shape of the defect being closed here, where
 * `owner` and `modifiedBy` existed in the composer and died one line into the
 * handoff. So this reads `packages/web/mods/demo-modtest/` off the filesystem,
 * installs it the way a player's mods folder installs one, and asks the running
 * game's own loader for the answer.
 *
 * demo-modtest is the right mod for it because it does BOTH things: it adds a
 * monster of its own and patches one of core's. Those are the two provenance
 * shapes, and a mod that only did one would leave the other untested.
 */

import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";

import { bindCore, ContentIdResolver, PROVENANCE_KEY } from "@rpgm-tools/neo-angband-core";
import { PROVENANCE_KEY as SDK_PROVENANCE_KEY } from "@rpgm-tools/neo-angband-mod-sdk";

import { loadGamePack, resetComposition } from "./pack";
import { resetDiskPacks, setDiskPacks } from "./disk-packs";
import type { DiskPack } from "./disk-packs";

afterEach(() => {
  resetDiskPacks();
  resetComposition();
});

const MOD_ID = "demo-modtest";

function modFile<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../mods/${MOD_ID}/${name}.json`, import.meta.url), "utf8"),
  ) as T;
}

/** The bundled demo mod, read from its folder as a picked directory would. */
function demoModtest(): DiskPack {
  return {
    manifest: modFile("manifest") as DiskPack["manifest"],
    files: { monster: modFile("monster") } as unknown as DiskPack["files"],
    code: [],
    assets: [],
  };
}

function install(pack: DiskPack): void {
  setDiskPacks({
    packs: [pack],
    order: [(pack.manifest as { id: string }).id],
    problems: [],
    dir: "my-mods",
    available: true,
    kind: "picked",
    codeUrl: null,
    assetUrl: null,
    origins: [{ kind: "picked", dir: "my-mods", count: 1 }],
  });
}

type Rec = Record<string, unknown>;

function monsterNamed(name: string): Rec | undefined {
  return (loadGamePack().mon.monsters as unknown as Rec[]).find((m) => m["name"] === name);
}

describe("the writer and the reader spell the key the same way", () => {
  it("mod-sdk and core agree", () => {
    /* Core has no package dependencies, so the constant is declared in both and
     * this is the only thing holding them together. If it ever fails, every
     * record in every modded game silently loses its provenance and every
     * mod-added entity goes back into the `core:` namespace - with no error
     * anywhere, because "no stamp" is a legal state. */
    expect(SDK_PROVENANCE_KEY).toBe(PROVENANCE_KEY);
  });
});

describe("a mod's records reach the game carrying its name", () => {
  it("stamps a record the mod ADDED with the mod as owner", () => {
    install(demoModtest());
    expect(monsterNamed("Modberry Slime")?.[PROVENANCE_KEY]).toEqual({ owner: MOD_ID });
  });

  it("stamps a record the mod PATCHED as core's, modified by the mod", () => {
    install(demoModtest());
    /* The mod renames Grip, so the patched record is found under the new name -
     * which is also the proof that the patch landed at all. */
    expect(monsterNamed("Grip, the Cyber-Hound")?.[PROVENANCE_KEY]).toEqual({
      owner: "core",
      modifiedBy: [MOD_ID],
    });
  });

  it("THE CONTROL: an unmodded game stamps nothing at all", () => {
    /* Without this, every assertion above would still pass against a composer
     * that stamped unconditionally - and `from` being present would stop
     * meaning "a mod was involved", which is the whole convention core's
     * readers rely on. */
    const pack = loadGamePack() as unknown as Record<string, unknown>;
    const stamped: string[] = [];
    const walk = (value: unknown, where: string): void => {
      if (Array.isArray(value)) {
        value.forEach((v, i) => { walk(v, `${where}[${i}]`); });
      } else if (value !== null && typeof value === "object") {
        if (PROVENANCE_KEY in value) stamped.push(where);
        for (const [k, v] of Object.entries(value)) walk(v, `${where}.${k}`);
      }
    };
    walk(pack, "pack");
    expect(stamped).toEqual([]);
  });
});

describe("the id a savefile stores names the pack that supplied the content", () => {
  it("gives a mod's monster the mod's own namespace", () => {
    install(demoModtest());
    const reg = bindCore(loadGamePack());
    const ids = new ContentIdResolver(reg);
    const slime = reg.monsters.races.find((r) => r.name === "Modberry Slime");
    expect(slime, "the mod's monster bound").toBeDefined();
    expect(slime?.from).toEqual({ owner: MOD_ID });
    expect(ids.raceId(slime?.ridx ?? -1)).toBe(`${MOD_ID}:modberry-slime`);
  });

  it("leaves a patched core record in core's namespace", () => {
    /* A patch does not transfer ownership. The renamed Grip is still core's
     * monster - turn the mod off and it is still there - so its id must not
     * move into the mod's namespace, or disabling the mod would strand it in
     * every save that mentions it. */
    install(demoModtest());
    const reg = bindCore(loadGamePack());
    const ids = new ContentIdResolver(reg);
    const grip = reg.monsters.races.find((r) => r.name === "Grip, the Cyber-Hound");
    expect(grip?.from).toEqual({ owner: "core", modifiedBy: [MOD_ID] });
    expect(ids.raceId(grip?.ridx ?? -1).startsWith("core:")).toBe(true);
  });

  it("does not move any core id a mod did not rename", () => {
    /* The parity half, over the whole registry rather than one record: adding a
     * mod must not renumber or reorder anything core supplies, because every id
     * in every existing save is one of these strings. The one exception is the
     * record demo-modtest RENAMES, which the next test is about. */
    const before = new ContentIdResolver(bindCore(loadGamePack()));
    const beforeIds = bindCore(loadGamePack()).monsters.races.map((r) => before.raceId(r.ridx));

    resetComposition();
    install(demoModtest());
    const reg = bindCore(loadGamePack());
    const after = new ContentIdResolver(reg);
    const afterIds = reg.monsters.races.map((r) => after.raceId(r.ridx));

    expect(afterIds).toHaveLength(beforeIds.length + 1);
    const moved = beforeIds.filter((id, i) => afterIds[i] !== id);
    expect(moved).toEqual(["core:grip-farmer-maggot-s-dog"]);
  });

  it("A KNOWN DEFECT, pinned: renaming a core record moves core's id", () => {
    /* NOT a consequence of provenance - this is how the id scheme has always
     * behaved, and provenance is what made it visible. A localid is derived from
     * the record's NAME, so a mod that patches the name of a record it does not
     * own moves that record's id out from under every save ever written without
     * the mod. Install demo-modtest and a character who has met Grip reloads to
     * find `core:grip-farmer-maggot-s-dog` resolves to nothing.
     *
     * The rule it needs is "a record's id is fixed by the pack that DEFINED it,
     * and a patch cannot move it", which needs the composer to keep the
     * pre-patch identity - a design decision of its own, tracked separately.
     * This test asserts the CURRENT behaviour on purpose, so the fix has
     * something that flips and this note is what the next reader finds. */
    install(demoModtest());
    const reg = bindCore(loadGamePack());
    const ids = new ContentIdResolver(reg);
    const grip = reg.monsters.races.find((r) => r.name === "Grip, the Cyber-Hound");
    expect(ids.raceId(grip?.ridx ?? -1)).toBe("core:grip-the-cyber-hound");
    expect(ids.raceIndex("core:grip-farmer-maggot-s-dog")).toBeUndefined();
  });
});
