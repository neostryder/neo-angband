/**
 * What counts as a mod update, and the one rule two screens must not disagree
 * about.
 */

import { describe, expect, it } from "vitest";
import {
  classifyModTag,
  modUpdateNotice,
  modUpdateRowLabel,
  pendingModUpdates,
  type ModTagStanding,
} from "./mod-updates";
import { catalogueRow, installSummary } from "./mod-catalogue";
import type { RecommendedMod } from "./mod-registry";

function mod(id: string, tag: string): RecommendedMod {
  return {
    id,
    name: id.toUpperCase(),
    repo: `someone/${id}`,
    tag,
    summary: "a mod",
    preChecked: false,
    approxBytes: 1024,
    payload: { kind: "files", files: [] },
  };
}

describe("where an installed tag stands against the catalogue", () => {
  const cases: [string | null, string, ModTagStanding][] = [
    [null, "v0.13.0", "absent"],
    ["v0.13.0", "v0.13.0", "same"],
    ["v0.12.0", "v0.13.0", "behind"],
    ["v0.13.0", "v0.14.0", "behind"],
    /* The one that used to roll a player backwards: a mod author on their own
     * newer tag, offered the catalogue's older one with the word "update". */
    ["v0.14.0", "v0.13.0", "ahead"],
    ["v1.0.0", "v0.13.0", "ahead"],
    /* Prerelease ordering is the comparator's job, not this module's, but the
     * answer has to be right for an edge build of a mod. */
    ["v0.13.0-beta.1", "v0.13.0", "behind"],
    ["v0.13.0", "v0.13.0-beta.1", "ahead"],
    /* A tag need not be a version. */
    ["nightly", "v0.13.0", "unorderable"],
    ["v0.13.0", "shiny", "unorderable"],
  ];
  for (const [installed, catalogue, expected] of cases) {
    it(`${installed ?? "(not installed)"} vs ${catalogue} is ${expected}`, () => {
      expect(classifyModTag(installed, catalogue)).toBe(expected);
    });
  }
});

describe("which mods 'update installed mods' will touch", () => {
  const catalogue = [
    mod("behind", "v2.0.0"),
    mod("same", "v1.0.0"),
    mod("ahead", "v1.0.0"),
    mod("weird", "v1.0.0"),
    mod("absent", "v1.0.0"),
  ];
  const installed = new Map([
    ["behind", "v1.0.0"],
    ["same", "v1.0.0"],
    ["ahead", "v3.0.0"],
    ["weird", "nightly"],
  ]);

  it("offers the ones that are strictly behind, and only those", () => {
    expect(pendingModUpdates(catalogue, installed)).toEqual([
      { mod: catalogue[0], from: "v1.0.0", to: "v2.0.0" },
    ]);
  });

  it("never offers to roll a newer mod backwards", () => {
    const ids = pendingModUpdates(catalogue, installed).map((u) => u.mod.id);
    expect(ids).not.toContain("ahead");
  });

  it("never guesses at a tag it cannot order", () => {
    const ids = pendingModUpdates(catalogue, installed).map((u) => u.mod.id);
    expect(ids).not.toContain("weird");
  });

  it("keeps catalogue order, so the two lists read the same way round", () => {
    const many = [mod("a", "v2.0.0"), mod("b", "v2.0.0"), mod("c", "v2.0.0")];
    const at1 = new Map([
      ["c", "v1.0.0"],
      ["a", "v1.0.0"],
      ["b", "v1.0.0"],
    ]);
    expect(pendingModUpdates(many, at1).map((u) => u.mod.id)).toEqual(["a", "b", "c"]);
  });

  /**
   * THE ANTI-DRIFT ASSERTION, and the reason classifyModTag exists at all.
   *
   * The catalogue row has said "Enter to update" for exactly one of the five
   * standings since long before there was a bulk action. If the bulk action ever
   * decides differently, one of two things is true and both are bad: a row
   * offers an update the bulk action skips, or the bulk action silently
   * downgrades a mod whose own row calls it newer.
   *
   * Both sides are pinned to a STATED value rather than to each other. "These
   * two agree" is satisfied by editing both wrongly.
   */
  it("says 'Enter to update' on exactly the rows the bulk action would move", () => {
    const catalogueTag = "v2.0.0";
    const table: [string | null, boolean][] = [
      [null, false],
      ["v2.0.0", false],
      ["v1.0.0", true],
      ["v3.0.0", false],
      ["nightly", false],
    ];
    for (const [installedTag, isAnUpdate] of table) {
      const m = mod("x", catalogueTag);
      const row = catalogueRow(m, installedTag);
      const inBulk =
        pendingModUpdates(
          [m],
          installedTag === null ? new Map() : new Map([["x", installedTag]]),
        ).length === 1;
      expect(inBulk, `bulk action for ${installedTag ?? "(absent)"}`).toBe(isAnUpdate);
      expect(
        row.hint?.includes("Enter to update") ?? false,
        `row wording for ${installedTag ?? "(absent)"}`,
      ).toBe(isAnUpdate);
    }
  });
});

describe("what the player is told", () => {
  const one = [{ mod: mod("qol", "v0.13.0"), from: "v0.12.0", to: "v0.13.0" }];

  it("says nothing at all when there is nothing to do", () => {
    /* A screen that reports "0 updates" every single time is a screen people
     * stop reading, and this one has a sentence on it that matters. */
    expect(modUpdateNotice([])).toBeNull();
  });

  it("names the mod when there is exactly one", () => {
    expect(modUpdateNotice(one)).toBe(
      "1 installed mod has a newer version in this build: QOL v0.12.0 -> v0.13.0.",
    );
  });

  it("counts them when there are several", () => {
    const two = [...one, { mod: mod("bug-fixes", "v0.13.0"), from: "v0.12.0", to: "v0.13.0" }];
    expect(modUpdateNotice(two)).toBe("2 installed mods have newer versions in this build.");
  });

  it("distinguishes 'nothing installed' from 'nothing to do'", () => {
    /* Two very different sentences that a count alone renders identically, and
     * the difference is the whole question a player is asking. */
    expect(modUpdateRowLabel([], false)).toContain("none installed");
    expect(modUpdateRowLabel([], true)).toContain("none from this build");
    expect(modUpdateRowLabel(one, true)).toContain("1 available");
  });

  it("does NOT claim a mod is up to date, because this check cannot know", () => {
    /* Measured on a real install: it read "all up to date" while, on the same
     * screen, "Install a mod" correctly offered neo-linoleum 0.12.1 over the
     * installed 0.12.0 - because the mod had released and the build had not. This
     * comparison is against the catalogue compiled into the game, so its silence
     * only ever meant "nothing newer shipped HERE". A row that overclaims is worse
     * than one that admits its scope: a player who reads "up to date" stops
     * looking. */
    const quiet = modUpdateRowLabel([], true);
    expect(quiet).not.toMatch(/up to date/u);
    /* And it points at the screen that does know. */
    expect(quiet).toContain("Install a mod");
  });
});

/**
 * What an UPDATE says about itself, which is not what a fresh install says.
 *
 * Caught by running it: a mod the player had enabled, updated in place, told
 * them "It is OFF, as every mod is until you say otherwise" and then offered to
 * turn it on. The enabled set is keyed by mod id and a reinstall never touched
 * it, so the screen was describing a state the game was not in - about the one
 * thing the player would go and check.
 */
describe("the summary after replacing a mod you already had", () => {
  const m = mod("qol", "v0.13.0");
  const ok = {
    ok: true as const,
    meta: { id: "qol", tag: "v0.13.0", files: [{ path: "manifest.json" }, { path: "plugin.js" }] },
  };

  const text = (wasInstalled: boolean, willOfferEnable = false): string =>
    installSummary(m, ok as never, willOfferEnable, wasInstalled)
      .map((l) => l.text)
      .join(" ");

  it("does not claim an already-installed mod is now switched off", () => {
    expect(text(true)).not.toContain("It is OFF");
  });

  it("says the player's own on/off choice and settings survived", () => {
    expect(text(true)).toContain("exactly as you had it");
    expect(text(true)).toContain("settings for it are untouched");
  });

  it("still tells a reload is what makes it take effect", () => {
    expect(text(true)).toContain("reload");
  });

  it("leaves a FIRST install saying exactly what it always said", () => {
    /* The regression this would otherwise cause is silent: a new mod that no
     * longer tells the player it arrives switched off. */
    expect(text(false)).toContain("It is OFF");
    expect(text(false, true)).toContain("You are asked next whether to turn it on.");
  });
});
