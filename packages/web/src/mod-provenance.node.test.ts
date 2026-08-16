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
import {
  PROVENANCE_KEY as SDK_PROVENANCE_KEY,
  stampProvenance,
} from "@rpgm-tools/neo-angband-mod-sdk";

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
     * which is also the proof that the patch landed at all. `was` carries
     * core's own values for every field the patch overwrote (name, color,
     * hit-points) - see the task #233 guarantee test below for why. */
    expect(monsterNamed("Grip, the Cyber-Hound")?.[PROVENANCE_KEY]).toEqual({
      owner: "core",
      modifiedBy: [MOD_ID],
      was: { name: "Grip, Farmer Maggot's Dog", color: "y", "hit-points": 25 },
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
    expect(grip?.from).toEqual({
      owner: "core",
      modifiedBy: [MOD_ID],
      was: { name: "Grip, Farmer Maggot's Dog", color: "y", "hit-points": 25 },
    });
    expect(ids.raceId(grip?.ridx ?? -1).startsWith("core:")).toBe(true);
  });

  it("does not move any core id a mod did not rename", () => {
    /* The parity half, over the whole registry rather than one record: adding a
     * mod must not renumber or reorder anything core supplies, because every id
     * in every existing save is one of these strings. Task #233 removed the one
     * exception this used to carry - the record demo-modtest RENAMES no longer
     * moves either, because its id is now fixed by the pack that DEFINED it
     * rather than by whatever a patch left the name reading. See the
     * task #233 guarantee test below for that record specifically. */
    const before = new ContentIdResolver(bindCore(loadGamePack()));
    const beforeIds = bindCore(loadGamePack()).monsters.races.map((r) => before.raceId(r.ridx));

    resetComposition();
    install(demoModtest());
    const reg = bindCore(loadGamePack());
    const after = new ContentIdResolver(reg);
    const afterIds = reg.monsters.races.map((r) => after.raceId(r.ridx));

    expect(afterIds).toHaveLength(beforeIds.length + 1);
    const moved = beforeIds.filter((id, i) => afterIds[i] !== id);
    expect(moved).toEqual([]);
  });

  it("THE GUARANTEE: a patch cannot move the id of a record it does not own", () => {
    /* Task #233. A localid is derived from the record's NAME, so a mod that
     * patches the name of a record it does not own moves that record's id out
     * from under every save written without the mod: install demo-modtest and,
     * without this wire, a character who has met Grip reloads to find
     * `core:grip-farmer-maggot-s-dog` resolves to nothing.
     *
     * THIS TEST'S OWN HISTORY, so the record survives the fix. First landed as a
     * KNOWN DEFECT, pinned with both assertions below asserting the BROKEN
     * state (`was` absent, the id moved). Turned into a TRIPWIRE once both ends
     * existed - the SDK's `stampProvenance` accepting the definer's record, and
     * core's `ContentIdResolver` minting from `$from.was` with a `movedToIndex`
     * fallback - but the wire between them was still missing:
     * `composeContentPacks` did not pass each record as its OWNER supplied it
     * as `stampProvenance`'s fifth argument, so the composer's real output
     * still carried the pre-fix stamp. The tripwire asserted that absence
     * directly, with a comment naming the exact edit that would turn it red:
     * a `defined` field on `ComposedRecord` (mod-sdk/src/compose.ts) plus both
     * `stampProvenance` call sites in mod-sdk/src/loader.ts passing it through.
     *
     * That edit landed 2026-08-14, in the same change that rewrote this test.
     * This is now the GUARANTEE the wire provides, asserted through the real
     * composeContentPacks -> bindCore -> ContentIdResolver path a save actually
     * uses - not through stampProvenance called directly, which is what the
     * "a patch cannot move the id..." block below does as the two-halves
     * version of the same rule. */
    install(demoModtest());
    const stamp = monsterNamed("Grip, the Cyber-Hound")?.[PROVENANCE_KEY] as
      | Record<string, unknown>
      | undefined;
    expect(stamp).toEqual({
      owner: "core",
      modifiedBy: [MOD_ID],
      was: { name: "Grip, Farmer Maggot's Dog", color: "y", "hit-points": 25 },
    });

    /* ...and this is the save-integrity guarantee that buys: the id a
     * pre-mod save would have written for Grip still resolves, and it resolves
     * to the very race object the rename produced - identity, not merely a
     * string that happens to still be present. The renamed spelling also keeps
     * resolving (movedToIndex), which is what lets a save written between
     * 0.19.0 and this fix - already holding the moved id - still load. */
    const reg = bindCore(loadGamePack());
    const ids = new ContentIdResolver(reg);
    const grip = reg.monsters.races.find((r) => r.name === "Grip, the Cyber-Hound");
    expect(ids.raceId(grip?.ridx ?? -1)).toBe("core:grip-farmer-maggot-s-dog");
    const at = ids.raceIndex("core:grip-farmer-maggot-s-dog");
    expect(at).toBeDefined();
    expect(reg.monsters.races[at ?? -1]).toBe(grip);
    expect(ids.raceIndex("core:grip-the-cyber-hound")).toBe(at);
  });
});

/**
 * The two halves of the task #233 rule, each against the REAL implementation.
 *
 * Separate from the demo-modtest block above because they deliberately do not go
 * through `composeContentPacks` - that is the wire that is missing, and a test
 * that waited for it would leave both halves unmeasured. What they do instead is
 * the next best thing and not a simulation of either side: the SDK's own
 * `stampProvenance` produces the stamp, and core's own binder and resolver
 * consume it.
 */
describe("a patch cannot move the id of a record it does not own", () => {
  const GRIP = "Grip, Farmer Maggot's Dog";
  const GRIP_ID = "core:grip-farmer-maggot-s-dog";
  const CYBER = "Grip, the Cyber-Hound";

  /** Core's monsters with Grip renamed and stamped by the SDK's real stamper. */
  function stampedRename(carryDefiner: boolean): Rec[] {
    const monsters = loadGamePack().mon as unknown as { monsters: Rec[] };
    const list = [...monsters.monsters];
    const at = list.findIndex((m) => m["name"] === GRIP);
    const before = list[at];
    if (before === undefined) throw new Error(`fixture: core ships no monster named ${GRIP}`);
    const after = { ...before, name: CYBER };
    /* THE NEGATIVE CONTROL REMOVES THE MECHANISM and nothing else: the same
     * stamper, the same record, the same rename - only the definer's record is
     * withheld, which is exactly what loader.ts does today. */
    list[at] = stampProvenance(
      after,
      "core",
      ["cyber"],
      "core",
      carryDefiner ? before : undefined,
    ) as Rec;
    return list;
  }

  function resolverOver(monsters: Rec[]) {
    const pack = loadGamePack() as unknown as { mon: Record<string, unknown> };
    const spliced = { ...pack, mon: { ...pack.mon, monsters } };
    const reg = bindCore(spliced as unknown as Parameters<typeof bindCore>[0]);
    const race = reg.monsters.races.find((r) => r.name === CYBER);
    if (race === undefined) throw new Error("fixture: the renamed race did not bind");
    return { reg, ids: new ContentIdResolver(reg), race };
  }

  it("the composer's stamp carries the definer's spelling", () => {
    const grip = stampedRename(true).find((m) => m["name"] === CYBER);
    expect(grip?.[PROVENANCE_KEY]).toEqual({
      owner: "core",
      modifiedBy: ["cyber"],
      was: { name: GRIP },
    });
  });

  it("records only what the patch actually changed", () => {
    /* `was` is a delta, not a second copy of the record. If it ever stopped
     * being one, every patched record in a modded game would carry its own
     * duplicate and nothing would say so. */
    const grip = stampedRename(true).find((m) => m["name"] === CYBER);
    const was = (grip?.[PROVENANCE_KEY] as { was: Record<string, unknown> }).was;
    expect(Object.keys(was)).toEqual(["name"]);
  });

  it("THE CONTROL: without the definer's record the stamp is what it always was", () => {
    /* Also the no-regression assertion for every existing caller: omit the new
     * argument and `stampProvenance` produces the pre-#233 stamp exactly. */
    const grip = stampedRename(false).find((m) => m["name"] === CYBER);
    expect(grip?.[PROVENANCE_KEY]).toEqual({ owner: "core", modifiedBy: ["cyber"] });
  });

  it("THE SAVE STILL RESOLVES: the pre-patch id finds the same entity", () => {
    /* The failure that matters is a save that will not load, so this resolves
     * the id a pre-mod character carries and checks it lands on the very race
     * object the rename produced - not merely that some string held still. */
    const { reg, ids, race } = resolverOver(stampedRename(true));
    const at = ids.raceIndex(GRIP_ID);
    expect(at).toBeDefined();
    expect(reg.monsters.races[at ?? -1]).toBe(race);
    expect(ids.raceId(race.ridx)).toBe(GRIP_ID);
  });

  it("THE CONTROL: the same rename without it loses the save", () => {
    const { ids, race } = resolverOver(stampedRename(false));
    expect(ids.raceIndex(GRIP_ID)).toBeUndefined();
    expect(ids.raceId(race.ridx)).toBe("core:grip-the-cyber-hound");
  });
});
