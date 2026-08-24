/**
 * Issue #89's end-to-end seam: composing a record is not enough. These patches
 * travel through the browser pack loader, bindCore, and a started game's live
 * chest and stair paths.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  FEAT,
  SKILL,
  TV,
  floorCarry,
  objectPrep,
  startGame,
} from "@rpgm-tools/neo-angband-core";
import { resetDiskPacks, setDiskPacks } from "./disk-packs";
import type { DiskPack, DiskPackReport } from "./disk-packs";
import { loadGamePack, resetComposition } from "./pack";

const PATCHED_TRAP_MESSAGE = "A test-only purple cloud surrounds you!";

afterEach(() => {
  resetDiskPacks();
  resetComposition();
});

/** A player-installed content mod that patches one record in each formerly inert file. */
function issue89Fixture(): DiskPackReport {
  const pack: DiskPack = {
    manifest: {
      id: "issue-89-fixture",
      name: "Issue 89 runtime fixture",
      version: "1.0.0",
      shape: "content",
      dependencies: { core: "*" },
    },
    files: {
      chest_trap: {
        patches: {
          "core:poison": { msg: [PATCHED_TRAP_MESSAGE] },
        },
      },
      world: {
        patches: {
          "core:town": { level: { down: "Angband 2" } },
        },
      },
    },
    code: [],
    assets: [],
  };
  return {
    packs: [pack],
    order: [pack.manifest.id],
    problems: [],
    dir: "issue-89-fixture",
    available: true,
    kind: "picked",
    codeUrl: null,
    assetUrl: null,
    origins: [{ kind: "picked", dir: "issue-89-fixture", count: 1 }],
  };
}

describe("composed chest_trap and world records reach running game paths", () => {
  it("fires the patched chest text and follows the patched Town down-link", () => {
    setDiskPacks(issue89Fixture());
    const game = startGame(loadGamePack(), { seed: 89, depth: 0, placeContent: false });

    const messages: string[] = [];
    const objects = game.booted.registries.objects;
    const chestKind = objects.lookupKind(
      TV.CHEST,
      objects.lookupSval(TV.CHEST, "Small wooden chest"),
    );
    expect(chestKind).toBeTruthy();
    const chest = objectPrep(
      game.state.rng,
      objects,
      game.booted.registries.constants,
      chestKind!,
      0,
      "average",
    );
    chest.pval = 2;
    game.state.chunk.setFeat(game.state.actor.grid, FEAT.FLOOR);
    expect(floorCarry(game.state, game.state.actor.grid, chest)).toBe(true);
    game.state.actor.combat = {
      ...game.state.actor.combat,
      skills: game.state.actor.combat.skills.map((value, index) =>
        index === SKILL.DISARM_PHYS ? 200 : value,
      ),
    };
    game.state.msg = (text) => messages.push(text);
    game.registry.get("open")!(game.state, { code: "open", dir: 5 });
    expect(messages).toContain(PATCHED_TRAP_MESSAGE);

    expect(game.state.levelTopology?.nextDepth(0, 1)).toBe(2);
    game.state.chunk.setFeat(game.state.actor.grid, FEAT.MORE);
    const descend = game.registry.get("descend");
    expect(descend).toBeDefined();
    descend!(game.state, { code: "descend" });
    expect(game.state.targetDepth).toBe(2);

    game.changeLevel(game.state.targetDepth!);
    expect(game.state.chunk.depth).toBe(2);
    expect(game.state.chunk.name).toBe("Angband 2");
  }, 30_000);
});
