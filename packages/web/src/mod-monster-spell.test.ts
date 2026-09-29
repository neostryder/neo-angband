/**
 * #319: a mod monster that casts the mod's own spell reaches bindCore declared.
 *
 * bindCore declares a pack's own monster spells from the top-level
 * `pack.monsterSpells` field before it binds monsters (core session/boot.ts).
 * loadGamePack passed the composed monster_spell records only under `mon`, so
 * core's own spell-declaration test passed while the real loader never declared
 * anything, and the first mod monster naming its own spell stopped the boot with
 * "mon: invalid spell name". This drives the real loader with a disk pack.
 */

import { afterEach, describe, expect, it } from "vitest";
import { bindCore } from "@rpgm-tools/neo-angband-core";
import { loadGamePack, resetComposition } from "./pack";
import { NO_DISK_PACKS, resetDiskPacks, setDiskPacks } from "./disk-packs";
import type { DiskPack, DiskPackReport } from "./disk-packs";

afterEach(() => {
  resetDiskPacks();
  resetComposition();
});

const SPELL = "BR_TEST_MIST";

function spellPack(): DiskPack {
  return {
    manifest: { id: "spell-mod", name: "spell-mod", version: "1.0.0", shape: "content", dependencies: { core: "*" } } as unknown as DiskPack["manifest"],
    files: {
      message_type: { records: [{ name: SPELL }] },
      monster_spell: {
        records: [
          {
            name: SPELL,
            type: "RST_BREATH | RST_INNATE",
            msgt: SPELL,
            hit: 100,
            effect: [{ eff: "BREATH", type: "POIS", radius: 0, other: 30 }],
            lore: ["test mist"],
            "message-vis": ["{name} breathes test mist."],
          },
        ],
      },
      monster: {
        records: [
          {
            name: "test mist drake",
            base: "dragon",
            color: "g",
            speed: 110,
            "hit-points": 50,
            hearing: 20,
            "armor-class": 30,
            sleepiness: 70,
            depth: 20,
            rarity: 1,
            experience: 100,
            blow: [{ method: "BITE", effect: "HURT", damage: "1d8" }],
            "innate-freq": 10,
            spells: [SPELL],
            desc: ["A test drake."],
          },
        ],
      },
    } as unknown as DiskPack["files"],
    code: [],
    assets: [],
  };
}

function report(packs: readonly DiskPack[]): DiskPackReport {
  return { ...NO_DISK_PACKS, packs, order: ["spell-mod"], available: true, kind: "picked", dir: "/mods" };
}

describe("a mod's own monster spell", () => {
  it("is declared by the loader, so the monster casting it binds", () => {
    setDiskPacks(report([spellPack()]));
    const pack = loadGamePack() as unknown as { monsterSpells?: { name: string }[] };
    expect(pack.monsterSpells?.map((s) => s.name)).toEqual([SPELL]);
    const game = bindCore(pack as never);
    const races = game.monsters.races as unknown as Array<{ name: string } | null>;
    expect(races.some((r) => r?.name === "test mist drake")).toBe(true);
  });

  it("declares nothing when no mod adds a spell", () => {
    setDiskPacks(NO_DISK_PACKS);
    const pack = loadGamePack() as unknown as { monsterSpells?: unknown[] };
    expect(pack.monsterSpells).toEqual([]);
  });
});
