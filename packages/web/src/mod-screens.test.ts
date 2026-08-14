/**
 * The mod manager's three list screens, as documents that still render byte for byte.
 *
 * WHY THE SNAPSHOT IS THE PRIMARY ASSERTION. These are port UI, not transcribed
 * Angband, so there is no upstream C to check a column stop against: the rendering
 * that shipped IS the specification, and the whole claim of this pass is that a
 * screen gave up its model and did not move on the player's screen. So every case
 * below pins `screenBodyLines(view, 80)` against the rows the hand-laid version
 * emitted, captured before the model existed. A table that cannot reproduce a row is
 * a table that is wrong, not a row that needs adjusting.
 *
 * WHAT THE MODEL IS FOR is checked separately and on the same views: a mod's id is
 * reachable without finding an arrow in English, a standing is a string a presenter
 * can sort by, and a capability's elevated flag is a boolean rather than a word
 * inside a sentence. A snapshot alone would pass just as well if every screen were
 * still one opaque line per row, which is exactly the state this replaced.
 *
 * Pure: no terminal, no game state, no network.
 */

import { describe, expect, it } from "vitest";

import { modUpdateReportScreen } from "./mod-browse";
import { autoSortScreen, capabilityConsentScreen, modConflictsScreen } from "./mods";
import { conflictLines, type ConflictInputs } from "./mod-conflicts";
import { refreshRow, type ModRefresh } from "./mod-refresh";
import {
  MODELLED_SCREENS,
  screenBodyLines,
  type ScreenTableBlock,
  type ScreenView,
} from "./screen-view";
import type { CatalogMod } from "./mod-store";
import type { ModHooks } from "@rpgm-tools/neo-angband-core";
import {
  describeContested,
  describeDeclaredConflict,
  type PackManifest,
  type SortResult,
} from "@rpgm-tools/neo-angband-mod-sdk";
import { UI_BAD, UI_DIM, UI_GOLD, UI_GOOD, UI_TEXT } from "./ui-colors";

const text = (view: ScreenView): string[] => screenBodyLines(view, 80).map((l) => l.text);

/** The one table on a screen with one, by key. */
function tableOf(view: ScreenView, key: string): ScreenTableBlock {
  const block = view.blocks.find((b) => b.kind === "table" && b.key === key);
  if (!block || block.kind !== "table") throw new Error(`no table ${key}`);
  return block;
}

/* ------------------------------------------------------------------ */
/* "Update installed mods", with nothing waiting                       */
/* ------------------------------------------------------------------ */

const R = (over: Partial<ModRefresh>): ModRefresh => ({
  id: "qol",
  repo: "neostryder/neo-angband-mod-qol",
  installed: "v0.13.0",
  newest: null,
  standing: "same",
  problem: null,
  channelHeld: null,
  ...over,
});

/** One mod per standing `refreshOne` can answer with, in `ModStanding`'s own order. */
const EVERY_STANDING: readonly ModRefresh[] = [
  R({ id: "behind-mod", standing: "behind", newest: "v0.14.0" }),
  R({ id: "ahead-mod", standing: "ahead", newest: "v0.12.0" }),
  R({ id: "blind-mod", standing: "unavailable", problem: "HTTP 404" }),
  R({ id: "zip-mod", repo: "file:import", standing: "no-repository" }),
  R({ id: "unord-mod", standing: "unorderable" }),
  R({ id: "held-mod", standing: "unorderable", channelHeld: "v0.15.0-beta.1" }),
  R({ id: "same-mod", standing: "same" }),
  R({ id: "held-newest", standing: "same", channelHeld: "v0.15.0-beta.1" }),
  R({ id: "absent-mod", standing: "absent" }),
];

const ABOUT_ROWS = [
  "Each mod lives in its own repository and releases on its own schedule,",
  "so this asks every installed mod where it came from and compares the",
  "version you have with the newest one your update channel allows.",
  "Updating the game is not what brings a newer mod.",
];

const BLIND_ROWS = [
  "A mod that could not be checked has NOT been removed and has not",
  "changed. Its repository may be renamed, private, or simply not",
  "reachable from here right now.",
];

describe("the update report renders exactly what its hand-laid version did", () => {
  it("draws every standing on its own row, colours and all", () => {
    /* The full ScreenLine rather than its text: the row colour is the one thing a
     * table could quietly change (a coloured CELL emits a `runs` array where a
     * plain coloured line used to go - same pixels, different object), and this is
     * where that would show. */
    expect(screenBodyLines(modUpdateReportScreen(EVERY_STANDING), 80)).toEqual([
      { text: "7 of 9 are at their repository's newest version.", color: UI_TEXT },
      { text: "", color: UI_TEXT },
      { text: "  behind-mod v0.13.0 -> v0.14.0", color: UI_DIM },
      {
        text: "  ahead-mod v0.13.0 (newer than neostryder/neo-angband-mod-qol's v0.12.0)",
        color: UI_DIM,
      },
      { text: "  blind-mod v0.13.0 (could not check: HTTP 404)", color: UI_GOLD },
      {
        text: "  zip-mod v0.13.0 (imported from a file - import a newer zip to update it)",
        color: UI_DIM,
      },
      {
        text:
          "  unord-mod v0.13.0 (neostryder/neo-angband-mod-qol offers no version this can be compared with)",
        color: UI_DIM,
      },
      {
        text: "  held-mod v0.13.0 (v0.15.0-beta.1 is held back by your update channel)",
        color: UI_DIM,
      },
      { text: "  same-mod v0.13.0 (newest)", color: UI_DIM },
      {
        text: "  held-newest v0.13.0 (newest on your channel; v0.15.0-beta.1 is beyond it)",
        color: UI_DIM,
      },
      { text: "  absent-mod v0.13.0 (newest)", color: UI_DIM },
      { text: "", color: UI_TEXT },
      ...BLIND_ROWS.map((t) => ({ text: t, color: UI_DIM })),
      { text: "", color: UI_TEXT },
      ...ABOUT_ROWS.map((t) => ({ text: t, color: UI_DIM })),
    ]);
  });

  it("prints nothing between the headline and the closing prose when nothing is installed", () => {
    /* The empty table has no `empty` state on purpose: "No mods are installed yet."
     * has already said it, and a second sentence saying it again is the port
     * adding something. */
    expect(text(modUpdateReportScreen([]))).toEqual([
      "No mods are installed yet.",
      "",
      "",
      ...ABOUT_ROWS,
    ]);
  });

  it("keeps the headline's own wrap, at the width the screen wraps it to", () => {
    /* The one headline `upToDateHeadline` can produce that is longer than
     * MESSAGE_WIDTH. It stays `lines` precisely so this break does not move. */
    expect(text(modUpdateReportScreen([
      R({ id: "a-mod", standing: "unavailable", problem: "HTTP 404" }),
      R({ id: "zip-mod", repo: "file:import", standing: "no-repository" }),
    ])).slice(0, 2)).toEqual([
      "No installed mod could be checked: 1 came from a file and 1 could not be",
      "reached.",
    ]);
  });

  it("warns in the headline's own colour when nothing at all could be reached", () => {
    const lines = screenBodyLines(
      modUpdateReportScreen([
        R({ id: "a-mod", standing: "unavailable", problem: "network error" }),
        R({ id: "b-mod", standing: "unavailable", problem: "HTTP 403" }),
      ]),
      80,
    );
    expect(lines[0]).toEqual({
      text: "None of the installed mods could be checked.",
      color: UI_GOLD,
    });
  });
});

describe("the update report's rows are addressable without reading them", () => {
  it("rejoins into refreshRow's own sentence, for every standing", () => {
    /* THE DERIVATION CHECK. `refreshStatus` takes the head off `refreshRow`'s
     * output rather than re-wording six standings in a second file; this is the
     * test that fails the day `refreshRow` stops opening `${id} ${installed}`,
     * which is the only thing that split is allowed to assume. */
    const rows = tableOf(modUpdateReportScreen(EVERY_STANDING), "installed").rows;
    expect(rows).toHaveLength(EVERY_STANDING.length);
    rows.forEach((row, i) => {
      const r = EVERY_STANDING[i]!;
      const cells = row.cells;
      expect(`${cells.mod!.text} ${cells.installed!.text} ${cells.status!.text}`).toBe(
        refreshRow(r),
      );
    });
  });

  it("names the mod by id and carries the whole record, not the sentence", () => {
    const row = tableOf(modUpdateReportScreen(EVERY_STANDING), "installed").rows[0]!;
    expect(row.id).toBe("behind-mod");
    expect(row.semantic).toEqual({
      kind: "mod",
      ref: "behind-mod",
      data: {
        repo: "neostryder/neo-angband-mod-qol",
        installed: "v0.13.0",
        newest: "v0.14.0",
        standing: "behind",
        problem: null,
        channelHeld: null,
      },
    });
    /* The newest tag as the repository stated it - no arrow, nothing to strip.
     * This is the fact a `latest` column would have carried, and it is here
     * instead because only a `behind` row renders one at all. */
    expect(row.semantic?.data?.newest).toBe("v0.14.0");
  });

  it("keeps the terminal's margin out of the mod cell", () => {
    /* The two columns of indent are a column, not a prefix on the id: a presenter
     * that read `cells.mod.text` to find the mod would otherwise get the margin
     * back with it. */
    const table = tableOf(modUpdateReportScreen(EVERY_STANDING), "installed");
    expect(table.columns[0]).toEqual({ key: "indent", width: 2 });
    expect(table.rows.map((r) => r.cells.mod!.text)).toEqual(
      EVERY_STANDING.map((r) => r.id),
    );
  });
});

/* ------------------------------------------------------------------ */
/* Auto-sort: the proposed order                                       */
/* ------------------------------------------------------------------ */

const NAMES: Record<string, string> = {
  qol: "Quality of Life",
  bugs: "Bug Fixes (unofficial patch set)",
  tiles: "Shockbolt Tiles",
  borg: "The Borg",
};
const nameOf = (id: string): string => NAMES[id] ?? id;

const sorted = (over: Partial<SortResult>): SortResult => ({
  order: [],
  dropped: [],
  unresolvable: [],
  ...over,
});

describe("the auto-sort proposal renders exactly what its hand-laid version did", () => {
  it("numbers the order in the terminal's own field, moved rows flagged", () => {
    const view = autoSortScreen(
      sorted({ order: ["bugs", "qol", "tiles"] }),
      ["qol", "bugs", "tiles"],
      nameOf,
    );
    expect(screenBodyLines(view, 80)).toEqual([
      { text: "Proposed order:", color: UI_TEXT },
      { text: "   1. Bug Fixes (unofficial patch set)   <- moved", color: UI_GOLD },
      { text: "   2. Quality of Life   <- moved", color: UI_GOLD },
      { text: "   3. Shockbolt Tiles", color: UI_TEXT },
      { text: "", color: UI_DIM },
      { text: "Later mods win conflicts.", color: UI_DIM },
    ]);
  });

  it("says so instead when the sort changes nothing", () => {
    expect(
      text(autoSortScreen(sorted({ order: ["qol", "bugs"] }), ["qol", "bugs"], nameOf)),
    ).toEqual([
      "Already in order:",
      "   1. Quality of Life",
      "   2. Bug Fixes (unofficial patch set)",
      "",
      "Later mods win conflicts.",
    ]);
  });

  it("right-aligns a two-digit rank under a one-digit one", () => {
    /* `rank`'s width is 5 - two columns of margin, two of number, and the point -
     * which is the field the `padStart(2)` it replaced wrote into. Ten enabled
     * mods is where a width that only counted digits would show. */
    const order = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    const rows = text(autoSortScreen(sorted({ order }), order, nameOf));
    expect(rows[1]).toBe("   1. a");
    expect(rows[9]).toBe("   9. i");
    expect(rows[10]).toBe("  10. j");
  });

  it("keeps the dropped suggestions and the impossible cycles where they were", () => {
    const view = autoSortScreen(
      sorted({
        order: ["qol", "bugs", "tiles"],
        dropped: [
          {
            from: "qol",
            to: "bugs",
            tier: "author",
            reason: "Quality of Life asks to load before Bug Fixes",
            cycle: ["qol", "bugs"],
          },
        ],
        unresolvable: [["tiles", "borg"]],
      }),
      ["tiles", "bugs", "qol"],
      nameOf,
    );
    expect(text(view)).toEqual([
      "Proposed order:",
      "   1. Quality of Life   <- moved",
      "   2. Bug Fixes (unofficial patch set)",
      "   3. Shockbolt Tiles   <- moved",
      "",
      "Later mods win conflicts.",
      "",
      "Suggestions it could not honour",
      "  Quality of Life asks to load before Bug Fixes",
      "    dropped - it would need Quality of Life -> Bug Fixes (unofficial patch set) -> Quality of Life",
      "",
      "These mods cannot all load",
      "  Shockbolt Tiles and The Borg each require the other.",
      "  Turn one of them off; no order can satisfy both.",
    ]);
  });
});

describe("the auto-sort proposal is a list a manager could reorder", () => {
  it("puts the rank in values, the mod on the row, and moved on the semantic", () => {
    const table = tableOf(
      autoSortScreen(sorted({ order: ["bugs", "qol"] }), ["qol", "bugs"], nameOf),
      "order",
    );
    expect(table.rows[0]).toMatchObject({
      id: "bugs",
      semantic: { kind: "mod", ref: "bugs", data: { moved: true } },
      values: { rank: 1 },
    });
    /* A boolean rather than 0/1 in `values`: `ScreenValues` is a map of NUMBERS,
     * and the HUD convention reads them as quantities. A flag is not a quantity. */
    expect(table.rows[0]!.semantic?.data?.moved).toBe(true);
    expect(table.rows[0]!.cells.name!.text).toBe("Bug Fixes (unofficial patch set)");
  });

  it("names an impossible cycle's mods apart from the sentence about them", () => {
    const table = tableOf(
      autoSortScreen(
        sorted({ order: ["qol"], unresolvable: [["tiles", "borg"]] }),
        ["qol"],
        nameOf,
      ),
      "unresolvable",
    );
    expect(table.rows[0]!.cells.mods!.text).toBe("Shockbolt Tiles and The Borg");
    expect(table.rows[0]!.semantic).toEqual({ kind: "mod-cycle", data: { ids: "tiles,borg" } });
  });
});

/* ------------------------------------------------------------------ */
/* The capability consent read                                         */
/* ------------------------------------------------------------------ */

const CM = (over: Partial<CatalogMod>): CatalogMod => ({
  id: "qol",
  name: "Quality of Life",
  version: "1.0.0",
  shape: "content",
  kind: "content",
  enabled: false,
  capabilities: [],
  nondeterministic: false,
  affectsGameplay: false,
  consented: false,
  manifest: {
    id: "qol",
    name: "Quality of Life",
    version: "1.0.0",
    shape: "content",
  } as CatalogMod["manifest"],
  ...over,
});

describe("the consent read renders exactly what its hand-laid version did", () => {
  it("bullets each grant and flags the powerful ones", () => {
    const view = capabilityConsentScreen(
      CM({ capabilities: ["command:add", "registry:effect"], nondeterministic: true }),
    );
    expect(screenBodyLines(view, 80)).toEqual([
      { text: '"Quality of Life" requests these capabilities:', color: UI_TEXT },
      { text: "", color: UI_TEXT },
      { text: "  - Add new player commands", color: UI_TEXT },
      { text: "  - Override effect, combat, and magic logic   [elevated]", color: UI_GOLD },
      { text: "", color: UI_TEXT },
      {
        text: "This mod can change core game behavior in-process. Only enable mods you trust.",
        color: UI_BAD,
      },
      { text: "It also marks your save permanently non-reproducible.", color: UI_GOLD },
      { text: "", color: UI_TEXT },
    ]);
  });

  it("leaves a long blurb unwrapped and unpadded, as the row always was", () => {
    /* `registry:*` is 200-odd characters. Padding the column to it would push the
     * flag off an 80-column terminal for every other row; wrapping it would be a
     * different screen from the one that shipped. */
    const rows = text(capabilityConsentScreen(CM({ capabilities: ["registry:*", "command:add"] })));
    expect(rows[2]).toBe(
      "  - Override ANY game system - effects, level and dungeon generation, monster attacks, shops, commands, monster AI, what spells and breaths do, what a vault symbol means, and vocabulary (full trusted, in-process access)   [elevated]",
    );
    expect(rows[3]).toBe("  - Add new player commands");
  });

  it("carries the raw capability string and the flag as data", () => {
    const table = tableOf(
      capabilityConsentScreen(CM({ capabilities: ["command:add", "registry:effect"] })),
      "capabilities",
    );
    expect(table.rows.map((r) => r.semantic)).toEqual([
      { kind: "capability", ref: "command:add", data: { elevated: false } },
      { kind: "capability", ref: "registry:effect", data: { elevated: true } },
    ]);
    /* The flag is a boolean, not the word "[elevated]" inside a sentence - which
     * is the whole reason this screen was worth modelling. */
    expect(table.rows[1]!.semantic?.data?.elevated).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* The conflicts viewer                                                */
/* ------------------------------------------------------------------ */

function pack(id: string, extra: Partial<PackManifest> = {}): PackManifest {
  return { id, name: id, version: "1.0.0", shape: "content", ...extra };
}

function hooksOf(...keys: (keyof ModHooks)[]): ModHooks {
  const h: Record<string, unknown> = {};
  for (const k of keys) h[k] = () => null;
  return h as ModHooks;
}

const NO_CONFLICT_INPUTS: ConflictInputs = {
  manifests: [],
  recordLines: [],
  tileClaims: [],
  hookContributions: [],
  ruleDecls: [],
  controllers: [],
  frontends: [],
  hudRegions: [],
  menus: [],
  screens: [],
};

/**
 * Every group at once: an author's declaration, a content-record line with no record
 * behind it, one discarding slot per layer, and one combining slot.
 *
 * Deliberately maximal - the screen's three groups are only distinguishable when all
 * three are present, and the record line is the one row whose fields this pass could
 * not recover.
 */
const EVERY_CONFLICT: ConflictInputs = {
  ...NO_CONFLICT_INPUTS,
  manifests: [
    pack("frost", {
      name: "Frost Realms",
      compat: [
        { with: "runes", claim: "conflicts", because: "We both rewrite kobold speed." },
      ],
    }),
    pack("runes", { name: "Rune Magic" }),
  ],
  recordLines: ["frost and runes both set kobold.speed"],
  tileClaims: [
    { modId: "frost", grafID: 2, menuname: "Adam Bolt" },
    { modId: "runes", grafID: 2, menuname: "Adam Bolt" },
  ],
  hookContributions: [
    { id: "frost", hooks: hooksOf("messageText", "walkBlockedByDiggable") },
    { id: "runes", hooks: hooksOf("messageText", "walkBlockedByDiggable") },
  ],
  ruleDecls: [
    { modId: "frost", flag: "shared.flag" },
    { modId: "runes", flag: "shared.flag" },
  ],
  controllers: ["frost", "runes"],
  frontends: ["frost", "runes"],
  hudRegions: [{ region: "sidebar", ids: ["frost", "runes"] }],
  menus: ["frost", "runes"],
  screens: ["frost", "runes"],
};

/** The nine contested sentences, in the order the pane has always printed them. */
const CONTESTED_ROWS = [
  "frost and runes both set kobold.speed",
  'Frost Realms and Rune Magic all change the "Adam Bolt" graphics mode; Rune Magic wins because it loads last.',
  "Frost Realms and Rune Magic all handle what happens when you walk into diggable rock; only Rune Magic runs because it loads last - the rest never get asked.",
  'Frost Realms and Rune Magic all change the "shared.flag" setting; Rune Magic wins because it loads last.',
  "Frost Realms and Rune Magic each provide an autoplayer that takes over your keyboard, and there is room for one; Rune Magic takes it and the others do nothing.",
  "Frost Realms and Rune Magic each provide a replacement map front end, and there is room for one; Rune Magic takes it and the others do nothing.",
  "Frost Realms and Rune Magic each provide a replacement vitals panel, and there is room for one; Rune Magic takes it and the others do nothing.",
  "Frost Realms and Rune Magic each provide a replacement way of asking the game's menus, and there is room for one; Rune Magic takes it and the others do nothing.",
  "Frost Realms and Rune Magic each provide a replacement way of showing the game's full screens, and there is room for one; Rune Magic takes it and the others do nothing.",
];

describe("the conflicts viewer renders exactly what its hand-laid version did", () => {
  it("draws all three groups, colours and blank rows included", () => {
    /* THE FULL ScreenLine, not its text. The blank rows between the groups are
     * C_DIM rather than uncoloured, which is the one thing a `gapAfter` would have
     * quietly changed - it emits `{ text: "" }` with no colour - and it is why the
     * prose between the tables stayed `lines`. */
    expect(screenBodyLines(modConflictsScreen(conflictLines(EVERY_CONFLICT)), 80)).toEqual([
      { text: "The authors said so themselves", color: UI_GOLD },
      {
        text: "Frost Realms says it conflicts with Rune Magic: We both rewrite kobold speed.",
        color: UI_TEXT,
      },
      { text: "", color: UI_DIM },
      {
        text: "Nothing here is blocked - you can play any combination you like.",
        color: UI_DIM,
      },
      { text: "", color: UI_DIM },
      { text: "One of these wins, the rest are ignored", color: UI_GOLD },
      ...CONTESTED_ROWS.map((text) => ({ text, color: UI_TEXT })),
      { text: "", color: UI_DIM },
      { text: "These stack, and need nothing from you", color: UI_GOOD },
      {
        text: "Frost Realms and Rune Magic all change the wording of game messages, in load order, each one seeing the last one's result.",
        color: UI_DIM,
      },
      { text: "", color: UI_DIM },
    ]);
  });

  it("says nothing is contested, in the one line it always said it in", () => {
    expect(screenBodyLines(modConflictsScreen(conflictLines(NO_CONFLICT_INPUTS)), 80)).toEqual([
      {
        text: "Nothing among your enabled mods contests anything else.",
        color: UI_GOOD,
      },
    ]);
  });

  it("prints only the groups that have something in them", () => {
    /* A set with one combining slot and nothing else: no declarations, no contest,
     * and therefore neither of those two captions. */
    const view = modConflictsScreen(
      conflictLines({
        ...NO_CONFLICT_INPUTS,
        manifests: [pack("a"), pack("b")],
        hookContributions: [
          { id: "a", hooks: hooksOf("artifactCommit") },
          { id: "b", hooks: hooksOf("artifactCommit") },
        ],
      }),
    );
    expect(text(view)).toEqual([
      "These stack, and need nothing from you",
      "a and b all have a say in whether an artifact is allowed to be created; every one of them has to agree, so any single refusal decides.",
      "",
    ]);
  });
});

describe("the conflicts viewer is a table a presenter could act on", () => {
  const report = conflictLines(EVERY_CONFLICT);
  const view = modConflictsScreen(report);

  it("derives every cell from the SDK's own sentence rather than re-wording it", () => {
    /* THE DERIVATION CHECK. Six folds' wording lives in the SDK; a second copy in
     * this screen would be two transcriptions, and the one nobody looks at rots.
     * This fails the day a cell stops being exactly what describeContested says. */
    const nameOf = (id: string): string =>
      EVERY_CONFLICT.manifests.find((m) => m.id === id)?.name ?? id;
    const contested = tableOf(view, "contested").rows;
    contested.forEach((row, i) => {
      const record = report.contestedRows[i]!.record;
      if (record === null) return; // a content-record line; see below
      expect(row.cells.what!.text).toBe(describeContested(record, nameOf));
    });
    const declared = tableOf(view, "declared").rows;
    declared.forEach((row, i) => {
      expect(row.cells.what!.text).toBe(
        describeDeclaredConflict(report.declaredRows[i]!.record, nameOf),
      );
    });
  });

  it("publishes the slot, the fold, the winner and the losers as data", () => {
    const row = tableOf(view, "contested").rows[1]!; // the graphics slot
    expect(row.id).toBe("graphics:2");
    expect(row.semantic).toEqual({
      kind: "contested-slot",
      ref: "graphics:2",
      data: {
        layer: "graphics",
        fold: "last-wins",
        what: 'the "Adam Bolt" graphics mode',
        winner: "runes",
        claims: "frost,runes",
        /* The question the screen exists to answer: whose work is thrown away. */
        losers: "frost",
      },
    });
  });

  it("names no loser where the fold discards nobody", () => {
    const row = tableOf(view, "combined").rows[0]!;
    expect(row.semantic?.data?.fold).toBe("chained");
    expect(row.semantic?.data?.winner).toBe(null);
    expect(row.semantic?.data?.losers).toBe("");
  });

  it("carries the author's declaration as fields, not as a sentence to parse", () => {
    const row = tableOf(view, "declared").rows[0]!;
    expect(row.semantic).toEqual({
      kind: "mod-conflict",
      ref: "frost",
      data: { with: "runes", because: "We both rewrite kobold speed.", scope: null },
    });
  });

  it("marks the ONE row whose record was destroyed before this module ran", () => {
    /* pack.ts's modConflictLines flattens computeConflictReport's field-granular
     * records into humanLines, so the content layer arrives here as prose. The row
     * says so - a kind with no `ref` - rather than arriving with no semantic at all,
     * which a presenter would read as "nothing to say about this row". */
    const row = tableOf(view, "contested").rows[0]!;
    expect(row.semantic).toEqual({ kind: "content-record" });
    expect(row.semantic?.ref).toBeUndefined();
    expect(row.id).toBeUndefined();
    /* And it is the only one. If this ever counts more than one, a producer has
     * regressed rather than a fixture having grown. */
    expect(
      tableOf(view, "contested").rows.filter((r) => r.semantic?.kind === "content-record"),
    ).toHaveLength(1);
  });

  it("keeps the sentences and the records in step", () => {
    /* The three `string[]` are read off the rows rather than composed beside them;
     * this is the assertion that the derivation still holds. */
    expect(report.contested).toEqual(report.contestedRows.map((r) => r.text));
    expect(report.declared).toEqual(report.declaredRows.map((r) => r.text));
    expect(report.combined).toEqual(report.combinedRows.map((r) => r.text));
  });
});

describe("the four screens are declared as modelled", () => {
  it("names each id in MODELLED_SCREENS", () => {
    /* screen-view.test.ts derives the same list from the `freezeView` calls that
     * exist; this states which four this file is responsible for, so a screen
     * quietly reverting to `showTextScreen(term, title, lines)` fails here too. */
    expect(modUpdateReportScreen([]).id).toBe("core:mod-updates");
    expect(autoSortScreen(sorted({ order: ["qol"] }), ["qol"], nameOf).id).toBe(
      "core:mod-auto-sort",
    );
    expect(capabilityConsentScreen(CM({})).id).toBe("core:mod-capabilities");
    expect(modConflictsScreen(conflictLines(NO_CONFLICT_INPUTS)).id).toBe(
      "core:mod-conflicts",
    );
    for (const id of [
      "core:mod-updates",
      "core:mod-auto-sort",
      "core:mod-capabilities",
      "core:mod-conflicts",
    ]) {
      expect(MODELLED_SCREENS).toContain(id);
    }
  });
});
