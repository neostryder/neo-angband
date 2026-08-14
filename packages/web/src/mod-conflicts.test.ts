/**
 * The conflict report over every composition layer.
 *
 * Each of the four non-content layers here resolved SILENTLY before this
 * existed, and three of the four discard somebody's work rather than merging
 * it. These tests are written against the observable outcome a player is told
 * about, not against the wording, except where the wording is the point (a line
 * that does not say who loses is a line nobody can act on).
 */

import { describe, expect, it } from "vitest";
import type { ModHooks } from "@rpgm-tools/neo-angband-core";
import type { PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import {
  conflictLines,
  declaredConflicts,
  layerSlots,
  nameFromManifests,
  type ConflictInputs,
} from "./mod-conflicts";

function manifest(id: string, extra: Partial<PackManifest> = {}): PackManifest {
  return { id, name: id, version: "1.0.0", shape: "content", ...extra };
}

function inputs(over: Partial<ConflictInputs> = {}): ConflictInputs {
  return {
    manifests: [],
    recordLines: [],
    tileClaims: [],
    hookContributions: [],
    ruleDecls: [],
    controllers: [],
    frontends: [],
    hudRegions: [],
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
    const { contested } = conflictLines(inputs({ recordLines: ["frost and runes both set x"] }));
    expect(contested).toEqual(["frost and runes both set x"]);
  });

  it("is empty for a mod set with nothing in common", () => {
    expect(conflictLines(inputs({ manifests: [manifest("a"), manifest("b")] }))).toEqual({
      declared: [],
      contested: [],
      combined: [],
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
      recordLines: ["a record line"],
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
