/**
 * The stash view and the one-time keep/purge question, over the REAL quarantine
 * output.
 *
 * Every fixture here is built by running core's own `quarantineSave` on a save
 * with mod content in it, rather than by hand-writing an orphan store. A test
 * that constructs the object production code will receive is an assertion about
 * the producer and an unchecked one; this screen's whole job is to be right
 * about what quarantine actually produced.
 *
 * Pure: no terminal, no game, no storage.
 */

import { describe, expect, it } from "vitest";
import { quarantineSave, type OrphanStore, type SaveManifest } from "@rpgm-tools/neo-angband-core";
import {
  categoryText,
  groupCaption,
  howToRestore,
  orphanKeptMessage,
  orphanPurgeLines,
  orphanPurgeMenu,
  orphanPurgedMessage,
  orphanRowLabel,
  orphanStashScreen,
  stashOf,
  whyInert,
} from "./mod-orphans";
import { describeQuarantine } from "./save-recovery";
import { MODELLED_SCREENS, screenBodyLines, type ScreenTableBlock } from "./screen-view";

const manifest: SaveManifest = {
  packs: [
    { id: "core", version: "0.1.0" },
    { id: "frost", version: "1.2.0" },
  ],
  loadOrder: ["core", "frost"],
  determinism: "deterministic",
  modNoscore: false,
};

/** A save played with a "frost" content mod, in every collection it touches. */
function moddedSave(): Parameters<typeof quarantineSave>[0] {
  return {
    version: 2,
    player: { equipment: [0, 0, 41] },
    gear: {
      next: 100,
      pack: [40, 42],
      store: [
        [40, { kindId: "core:sword:dagger" }],
        [41, { kindId: "frost:ice-brand" }],
        [42, { kindId: "frost:snow-boots" }],
      ],
    },
    monsters: [
      null,
      { raceId: "core:kobold", originalRaceId: null, midx: 1, heldObj: [] },
      { raceId: "frost:frost-wyrm", originalRaceId: null, midx: 2, heldObj: [] },
    ],
    groups: [null, { index: 1, leader: 1, members: [1, 2] }],
    floor: [{ x: 6, y: 6, objs: [{ kindId: "frost:ice-shard" }] }],
    traps: [],
    lore: [],
    artifactsCreated: [],
  } as unknown as Parameters<typeof quarantineSave>[0];
}

/** The store a real uninstall of "frost" produces. */
function frostStore(): OrphanStore {
  return quarantineSave(moddedSave(), manifest, (ns) => ns === "core").orphans;
}

const gone = { store: frostStore, present: () => new Set(["core"]), installed: () => new Set(["core"]) };
const offNotGone = {
  store: frostStore,
  present: () => new Set(["core"]),
  installed: () => new Set(["core", "frost"]),
};
const nothing = { store: (): OrphanStore => ({}) };

const text = (deps: Parameters<typeof stashOf>[0]): string[] =>
  screenBodyLines(orphanStashScreen(stashOf(deps)), 80).map((l) => l.text);

describe("the stash view lists what a missing mod took with it", () => {
  it("is a modelled screen with its own id", () => {
    expect(orphanStashScreen(stashOf(nothing)).id).toBe("core:mod-orphans");
    expect(MODELLED_SCREENS).toContain("core:mod-orphans");
  });

  it("names every quarantined thing under the pack that owned it", () => {
    const lines = text(gone);
    expect(lines.some((l) => l.includes("frost 1.2.0"))).toBe(true);
    for (const name of ["ice-brand", "snow-boots", "frost-wyrm", "ice-shard"]) {
      expect(lines.some((l) => l.includes(name)), `no row for ${name}`).toBe(true);
    }
  });

  /* The three questions decision 7 says this screen exists to answer. */
  it("says what each thing was, why it is inert, and what would restore it", () => {
    const lines = text(gone).join("\n");
    expect(lines).toContain("you were wearing it");
    expect(lines).toContain("you were carrying it");
    expect(lines).toContain("frost is not installed.");
    expect(lines).toContain("Install frost again");
    expect(lines).toContain("frost 1.2.0");
  });

  it("tells a player to flip a switch when the mod is only turned off, not gone", () => {
    const lines = text(offNotGone).join("\n");
    expect(lines).toContain("frost is installed but switched off.");
    expect(lines).toContain("Turn frost back on");
    expect(lines).not.toContain("frost is not installed.");
  });

  it("counts the monster-pack links instead of filling the screen with them", () => {
    const stash = stashOf(gone);
    const group = stash.groups[0]!;
    expect(group.links).toBeGreaterThan(0);
    const table = orphanStashScreen(stash).blocks.find(
      (b): b is ScreenTableBlock => b.kind === "table",
    )!;
    /* Every ROW is a thing the player owned; the links are one summary line. */
    expect(table.rows.length).toBe(group.items.length);
    expect(text(gone).join("\n")).toContain("keeps frost's monster packs together");
  });

  it("publishes the mod, the storage kind and the availability beside each row", () => {
    const table = orphanStashScreen(stashOf(gone)).blocks.find(
      (b): b is ScreenTableBlock => b.kind === "table",
    )!;
    const brand = table.rows.find((r) => r.semantic?.ref === "frost:ice-brand")!;
    expect(brand.semantic).toEqual({
      kind: "mod-orphan",
      ref: "frost:ice-brand",
      data: {
        mod: "frost",
        version: "1.2.0",
        availability: "absent",
        storage: "gearObject",
        category: "worn",
      },
    });
  });

  it("says plainly that a held item costs the player nothing while it waits", () => {
    expect(text(gone).join("\n")).toContain("takes no pack slot");
  });

  it("answers the question rather than showing an empty list when nothing is held", () => {
    const lines = text(nothing).join("\n");
    expect(lines).toContain("Nothing is set aside.");
    expect(lines).not.toContain("frost");
  });
});

describe("the wording each availability gets", () => {
  const group = (availability: string) =>
    ({ namespace: "frost", version: "1.2.0", availability, key: "frost@1.2.0", items: [], links: 0, total: 0 }) as unknown as Parameters<typeof whyInert>[0];

  it("separates a pack that is gone from one that merely did not compose", () => {
    expect(whyInert(group("absent"))).toContain("not installed");
    expect(whyInert(group("disabled"))).toContain("switched off");
    expect(whyInert(group("present"))).toContain("could not put these back");
    expect(whyInert(group("unknown"))).toContain("did not load");
  });

  /* A pack that IS loaded has no reinstall to offer, so the sentence must not
   * tell the player to do something that would change nothing. */
  it("never tells a player to reinstall a pack that is already loaded", () => {
    expect(howToRestore(group("present"))).not.toContain("Install");
    expect(howToRestore(group("present"))).toContain("until frost can place them again");
  });

  it("drops the version from the caption and the fix when the key carries none", () => {
    const bare = { ...group("absent"), version: "", key: "frost" } as Parameters<typeof whyInert>[0];
    expect(groupCaption(bare)).toContain("frost -");
    expect(howToRestore(bare)).toBe(
      "Install frost again, and every one of these returns to where it was.",
    );
  });

  it("has a phrase for every category, including the bookkeeping one", () => {
    for (const c of [
      "worn",
      "carried",
      "held",
      "floor",
      "monster",
      "trap",
      "lore",
      "artifact",
      "cached",
      "link",
    ] as const) {
      expect(categoryText(c).length).toBeGreaterThan(0);
    }
  });
});

describe("the mods-menu row", () => {
  it("carries the count, so a player sees something is held before opening it", () => {
    expect(orphanRowLabel(stashOf(gone).total)).toMatch(/\d+ things/u);
    expect(orphanRowLabel(1)).toContain("1 thing");
  });
  it("says nothing about a count when there is nothing held", () => {
    expect(orphanRowLabel(0)).toBe("Set aside by a missing mod...");
  });
});

describe("the load-time note", () => {
  it("names the count, the mod, and where to look", () => {
    const note = describeQuarantine(stashOf(gone));
    expect(note).toContain("set aside");
    expect(note).toContain("frost did not load");
    expect(note).toContain("ice-brand");
    expect(note).toContain("Mods, then Set aside");
  });

  /* The message line is 80 columns wide and a content mod can strand dozens of
   * things at once, so the names are capped and the count carries the rest. */
  it("caps the names rather than listing every one of them", () => {
    const note = describeQuarantine(stashOf(gone), 2);
    expect(note).toContain("ice-brand");
    expect(note).not.toContain("ice-shard");
  });

  it("is empty when nothing was quarantined, so it never joins a load message", () => {
    expect(describeQuarantine(stashOf(nothing))).toBe("");
  });
});

describe("the one-time keep/purge question (decision 8)", () => {
  it("counts what is at stake and names the content that is missing", () => {
    const body = orphanPurgeLines(stashOf(gone))
      .map((l) => l.text)
      .join("\n");
    expect(body).toContain("frost");
    expect(body).toMatch(/\d+ things from this character have been set aside/u);
    expect(body).toContain("Nothing has been destroyed.");
    expect(body).toContain("asked this once");
  });

  it("offers keeping first, so the default answer destroys nothing", () => {
    const menu = orphanPurgeMenu(stashOf(gone));
    expect(menu[0]!.label).toBe("Keep them frozen");
    expect(menu[1]!.label).toContain("permanently");
    /* The count is ON the destructive row: decision 8 requires the confirmation
     * to be counted, not a bare yes/no over an unnamed quantity. */
    expect(menu[1]!.label).toMatch(/all \d+ things/u);
  });

  it("says what happened after either answer", () => {
    expect(orphanKeptMessage(4)).toContain("4 things stay");
    expect(orphanKeptMessage(4)).toContain("Mods, then Set aside");
    expect(orphanPurgedMessage(4)).toContain("4 things were thrown away permanently");
    expect(orphanPurgedMessage(1)).toContain("1 thing was thrown away permanently");
  });
});
