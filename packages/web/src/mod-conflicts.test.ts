/**
 * The conflict report over every composition layer.
 *
 * Each of the four non-content layers here resolved SILENTLY before this
 * existed, and three of the four discard somebody's work rather than merging
 * it. These tests are written against the observable outcome a player is told
 * about, not against the wording, except where the wording is the point (a line
 * that does not say who loses is a line nobody can act on).
 */

import { afterEach, describe, expect, it } from "vitest";
import type { ModHooks } from "@rpgm-tools/neo-angband-core";
import type { PackManifest, RecordConflict } from "@rpgm-tools/neo-angband-mod-sdk";
import {
  conflictLines,
  declaredConflicts,
  layerSlots,
  nameFromManifests,
  type ConflictInputs,
} from "./mod-conflicts";
import { modConflictLines } from "./pack";
import { resetDiskPacks, setDiskPacks } from "./disk-packs";
import type { DiskPack } from "./disk-packs";

function manifest(id: string, extra: Partial<PackManifest> = {}): PackManifest {
  return { id, name: id, version: "1.0.0", shape: "content", ...extra };
}

function inputs(over: Partial<ConflictInputs> = {}): ConflictInputs {
  return {
    manifests: [],
    recordRows: [],
    tileClaims: [],
    hookContributions: [],
    ruleDecls: [],
    controllers: [],
    frontends: [],
    hudRegions: [],
    menus: [],
  screens: [],
    ...over,
  };
}

/** A hooks object contributing exactly the named members. */
function hooks(...keys: (keyof ModHooks)[]): ModHooks {
  const h: Record<string, unknown> = {};
  for (const k of keys) h[k] = () => null;
  return h as ModHooks;
}

describe("graphics: two mods claiming one grafID", () => {
  const two = inputs({
    manifests: [manifest("a"), manifest("b")],
    tileClaims: [
      { modId: "a", grafID: 2, menuname: "Adam Bolt" },
      { modId: "b", grafID: 2, menuname: "Adam Bolt" },
    ],
  });

  it("is reported at all - it used to be invisible", () => {
    expect(layerSlots(two)).toHaveLength(1);
    expect(layerSlots(two)[0]?.layer).toBe("graphics");
  });

  it("names the last claimant as the winner, matching lastClaimWins", () => {
    expect(layerSlots(two)[0]?.winner).toBe("b");
  });

  it("lands in the group the player has to decide about", () => {
    const { contested, combined } = conflictLines(two);
    expect(contested).toHaveLength(1);
    expect(combined).toEqual([]);
    expect(contested[0]).toContain("Adam Bolt");
  });

  it("says nothing when only one mod claims the mode", () => {
    expect(
      layerSlots(inputs({ tileClaims: [{ modId: "a", grafID: 2, menuname: "x" }] })),
    ).toEqual([]);
  });

  it("keeps different grafIDs apart", () => {
    expect(
      layerSlots(
        inputs({
          tileClaims: [
            { modId: "a", grafID: 2, menuname: "x" },
            { modId: "b", grafID: 3, menuname: "y" },
          ],
        }),
      ),
    ).toEqual([]);
  });
});

describe("behaviour: two mods contributing one hook", () => {
  const both = (hook: keyof ModHooks): ConflictInputs =>
    inputs({
      manifests: [manifest("a"), manifest("b")],
      hookContributions: [
        { id: "a", hooks: hooks(hook) },
        { id: "b", hooks: hooks(hook) },
      ],
    });

  /* THE WORST CASE, and the one that was silent: for a last-answer hook the
   * earlier mod's rule never runs, so its author and its player both believe it
   * is working. */
  it("puts a last-answer hook in the contested group and says the loser never runs", () => {
    const { contested, combined } = conflictLines(both("walkBlockedByDiggable"));
    expect(combined).toEqual([]);
    expect(contested).toHaveLength(1);
    expect(contested[0]).toContain("never get asked");
    expect(contested[0]).toContain("diggable rock");
  });

  /* The report and the fold have to name the SAME mod, and until 2026-08-02
   * they both named "a" - the earlier one - against the manager's own row. */
  it("names the LAST mod as the one that runs, matching composeModHooks", () => {
    expect(layerSlots(both("walkBlockedByDiggable"))[0]?.winner).toBe("b");
  });

  /* Five of the seven hooks combine. They still resolve later-wins; there is
   * simply nothing for a winner to win, which is why the line says so. */
  it("puts a veto hook in the combining group, with no winner", () => {
    const { contested, combined } = conflictLines(both("artifactCommit"));
    expect(contested).toEqual([]);
    expect(combined).toHaveLength(1);
    expect(combined[0]).toContain("has to agree");
    expect(layerSlots(both("artifactCommit"))[0]?.winner).toBeUndefined();
  });

  it("puts a transform hook in the combining group and says it chains", () => {
    expect(conflictLines(both("messageText")).combined[0]).toContain(
      "each one seeing the last one's result",
    );
  });

  it("puts an any-yes hook in the combining group and says it does not conflict", () => {
    expect(conflictLines(both("saveNoiseScent")).combined[0]).toContain("do not conflict");
  });

  it("reports each contested hook separately", () => {
    const slots = layerSlots(
      inputs({
        hookContributions: [
          { id: "a", hooks: hooks("messageText", "historyAdd") },
          { id: "b", hooks: hooks("messageText", "historyAdd") },
        ],
      }),
    );
    expect(slots.map((s) => s.key).sort()).toEqual(["hook:historyAdd", "hook:messageText"]);
  });

  it("says nothing when two mods contribute DIFFERENT hooks", () => {
    expect(
      layerSlots(
        inputs({
          hookContributions: [
            { id: "a", hooks: hooks("messageText") },
            { id: "b", hooks: hooks("historyAdd") },
          ],
        }),
      ),
    ).toEqual([]);
  });
});

describe("rules: two mods declaring one flag", () => {
  /* resolveModRules is a flat namespace keyed by the flag STRING, so the player
   * gets two rows that move together and each mod reads the other's answer. */
  it("is reported, and the last declaration wins", () => {
    const slots = layerSlots(
      inputs({
        ruleDecls: [
          { modId: "qol", flag: "shared.flag" },
          { modId: "other", flag: "shared.flag" },
        ],
      }),
    );
    expect(slots).toHaveLength(1);
    expect(slots[0]?.layer).toBe("rule");
    expect(slots[0]?.winner).toBe("other");
  });

  it("says nothing for a mod declaring several flags of its own", () => {
    expect(
      layerSlots(
        inputs({
          ruleDecls: [
            { modId: "qol", flag: "qol.a" },
            { modId: "qol", flag: "qol.b" },
          ],
        }),
      ),
    ).toEqual([]);
  });
});

describe("controller: two mods each shipping an autoplayer", () => {
  /* One slot, and installController's uninstall restores whatever preceded it -
   * so the second install silently wins. */
  it("is reported as a single slot the last installer takes", () => {
    const slots = layerSlots(inputs({ controllers: ["borg", "other"] }));
    expect(slots).toHaveLength(1);
    expect(slots[0]?.layer).toBe("controller");
    expect(slots[0]?.winner).toBe("other");
  });

  it("tells the player the other one does nothing", () => {
    const { contested } = conflictLines(inputs({ controllers: ["borg", "other"] }));
    expect(contested[0]).toContain("do nothing");
  });

  it("says nothing about one autoplayer", () => {
    expect(layerSlots(inputs({ controllers: ["borg"] }))).toEqual([]);
  });
});

describe("frontend: two mods each replacing the map", () => {
  it("is reported as one last-load-wins display slot", () => {
    const slots = layerSlots(inputs({ frontends: ["first", "last"] }));
    expect(slots).toHaveLength(1);
    expect(slots[0]).toMatchObject({ layer: "frontend", winner: "last" });
  });

  it("does not report an uncontested replacement", () => {
    expect(layerSlots(inputs({ frontends: ["only"] }))).toEqual([]);
  });
});

describe("declared conflicts", () => {
  const frost = manifest("frost", {
    compat: [
      { with: "runes", claim: "conflicts", because: "We both rewrite kobold speed." },
    ],
  });

  it("is reported when the named mod is enabled", () => {
    expect(declaredConflicts([frost, manifest("runes")])).toHaveLength(1);
  });

  it("is silent when the named mod is not enabled", () => {
    expect(declaredConflicts([frost])).toEqual([]);
  });

  it("carries the author's own reason into the line", () => {
    const { declared } = conflictLines(inputs({ manifests: [frost, manifest("runes")] }));
    expect(declared[0]).toContain("We both rewrite kobold speed.");
  });

  it("ignores the other claim kinds, which are not warnings", () => {
    for (const claim of ["prefer-mine", "prefer-theirs"] as const) {
      const m = manifest("frost", { compat: [{ with: "runes", claim, because: "x" }] });
      expect(declaredConflicts([m, manifest("runes")])).toEqual([]);
    }
  });

  it("keeps the scope when the claim named one", () => {
    const scoped = manifest("frost", {
      sections: [{ id: "kobolds", title: "K" }],
      compat: [
        { with: "runes", claim: "conflicts", scope: ["kobolds"], because: "speed." },
      ],
    });
    expect(declaredConflicts([scoped, manifest("runes")])[0]?.scope).toEqual(["kobolds"]);
  });
});

describe("the whole report", () => {
  it("keeps the content report's own lines in the contested group", () => {
    const { contested } = conflictLines(
      inputs({ recordRows: [{ text: "frost and runes both set x", record: null }] }),
    );
    expect(contested).toEqual(["frost and runes both set x"]);
  });

  it("carries the content row's own record through untouched, not just its text", () => {
    /* THE DERIVATION CHECK for the widened producer: conflictLines must not rebuild
     * or discard the row modConflictLines handed it - a record travelling through
     * here is the whole point of ConflictRow. Before pack.ts's modConflictLines
     * carried a record, every one of these rows was forced through
     * `.map((text) => ({ text, record: null }))`, so a supplied non-null record
     * would have been silently replaced with null; this fails against that shape. */
    const record: RecordConflict = {
      ref: "core:kobold",
      file: "monster",
      contributingPacks: ["frost", "runes"],
      fields: [{ path: "speed", owners: ["frost", "runes"], winner: "runes" }],
      collisions: [{ path: "speed", owners: ["frost", "runes"] }],
      humanLines: ["frost and runes both set kobold.speed; runes wins - drag to reorder."],
    };
    const row = { text: record.humanLines[0]!, record };
    const { contestedRows } = conflictLines(inputs({ recordRows: [row] }));
    expect(contestedRows[0]).toEqual(row);
  });

  it("is empty for a mod set with nothing in common", () => {
    expect(conflictLines(inputs({ manifests: [manifest("a"), manifest("b")] }))).toEqual({
      declared: [],
      contested: [],
      combined: [],
      declaredRows: [],
      contestedRows: [],
      combinedRows: [],
    });
  });

  it("uses each mod's display name, not its id", () => {
    const { contested } = conflictLines(
      inputs({
        manifests: [manifest("a", { name: "Frost Realms" }), manifest("b", { name: "Rune Magic" })],
        controllers: ["a", "b"],
      }),
    );
    expect(contested[0]).toContain("Frost Realms");
    expect(contested[0]).toContain("Rune Magic");
  });

  it("reports every layer at once without them interfering", () => {
    const all = inputs({
      manifests: [manifest("a"), manifest("b")],
      recordRows: [{ text: "a record line", record: null }],
      tileClaims: [
        { modId: "a", grafID: 2, menuname: "m" },
        { modId: "b", grafID: 2, menuname: "m" },
      ],
      hookContributions: [
        { id: "a", hooks: hooks("messageText") },
        { id: "b", hooks: hooks("messageText") },
      ],
      ruleDecls: [
        { modId: "a", flag: "f" },
        { modId: "b", flag: "f" },
      ],
      controllers: ["a", "b"],
    });
    const { contested, combined } = conflictLines(all);
    /* record + graphics + rule + controller discard; messageText chains. */
    expect(contested).toHaveLength(4);
    expect(combined).toHaveLength(1);
  });
});

describe("nameFromManifests", () => {
  it("falls back to the id for a pack it does not know", () => {
    const nameOf = nameFromManifests([manifest("a", { name: "Alpha" })]);
    expect(nameOf("a")).toBe("Alpha");
    expect(nameOf("ghost")).toBe("ghost");
  });
});

/**
 * modConflictLines (pack.ts): the content layer's OWN producer.
 *
 * These drive the real function end to end - through discoverMods, resolveLoadOrder
 * and computeConflictReport - rather than constructing a ConflictInputs by hand, because
 * the thing under test is exactly what that producer attaches to a row, not what
 * conflictLines does with what it is handed (covered above). Two disk packs writing the
 * same field of the same ref is enough to force a real RecordConflict without needing
 * the bundled game content to cooperate; computeConflictReport never checks that the ref
 * they are fighting over is a record anything actually owns.
 */
describe("modConflictLines (pack.ts): the content layer's own producer", () => {
  afterEach(() => {
    resetDiskPacks();
  });

  function diskPack(over: Partial<DiskPack> & { manifest: DiskPack["manifest"] }): DiskPack {
    return { files: {}, code: [], assets: [], ...over };
  }

  it("attaches the real RecordConflict beside the sentence, not just the text", () => {
    /* NEGATIVE CONTROL (see the report): before this pass modConflictLines returned
     * `string[]`, so every row here would be a bare string with no `.record` at all -
     * this assertion throws on that shape rather than merely failing it. */
    setDiskPacks({
      packs: [
        diskPack({
          manifest: { id: "mod-a", name: "Mod A", version: "1.0.0", shape: "content" } as PackManifest,
          files: { monster: { fieldPatches: { "core:kobold": [{ op: "set", path: "speed", value: 10 }] } } },
        }),
        diskPack({
          manifest: { id: "mod-b", name: "Mod B", version: "1.0.0", shape: "content" } as PackManifest,
          files: { monster: { fieldPatches: { "core:kobold": [{ op: "set", path: "speed", value: 20 }] } } },
        }),
      ],
      problems: [],
      available: true,
      dir: "mods",
      order: [],
      kind: "app",
      codeUrl: null,
      assetUrl: null,
      origins: [{ kind: "app", dir: "mods", count: 2 }],
    });

    const rows = modConflictLines(["mod-a", "mod-b"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.text).toBe(
      "mod-a and mod-b both set kobold.speed; mod-b wins - drag to reorder.",
    );
    const record: RecordConflict = {
      ref: "core:kobold",
      file: "monster",
      contributingPacks: ["mod-a", "mod-b"],
      fields: [{ path: "speed", owners: ["mod-a", "mod-b"], winner: "mod-b" }],
      collisions: [{ path: "speed", owners: ["mod-a", "mod-b"] }],
      humanLines: ["mod-a and mod-b both set kobold.speed; mod-b wins - drag to reorder."],
    };
    expect(rows[0]).toEqual({ text: record.humanLines[0], record });
  });

  it("still returns a null record when resolveLoadOrder cannot resolve the set", () => {
    /* THIS IS THE ONE PRODUCER LEFT that the ConflictRow.record nullability exists
     * for: a pack whose dependency is missing never reaches computeConflictReport at
     * all, so there is no RecordConflict to attach - only the thrown message.
     * NEGATIVE CONTROL: before this pass the row was a bare string; `.record` would
     * be `undefined`, not `null`, so `toBeNull()` fails against that shape too. */
    setDiskPacks({
      packs: [
        diskPack({
          manifest: {
            id: "needs-ghost",
            name: "Needs Ghost",
            version: "1.0.0",
            shape: "content",
            dependencies: { ghost: "^1.0.0" },
          } as PackManifest,
        }),
      ],
      problems: [],
      available: true,
      dir: "mods",
      order: [],
      kind: "app",
      codeUrl: null,
      assetUrl: null,
      origins: [{ kind: "app", dir: "mods", count: 1 }],
    });

    const rows = modConflictLines(["needs-ghost"]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.record).toBeNull();
    expect(rows[0]!.text).toContain("requires missing pack ghost");
  });
});
