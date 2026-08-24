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

import {
  installFailureScreen,
  modUpdateReportScreen,
  sessionLoadScreen,
  zipImportFailureScreen,
} from "./mod-browse";
import { autoSortScreen, capabilityConsentScreen, modConflictsScreen } from "./mods";
import { conflictLines, type ConflictInputs } from "./mod-conflicts";
import { refreshRow, type ModRefresh } from "./mod-refresh";
import {
  MODELLED_SCREENS,
  screenBlockLines,
  screenBodyLines,
  type ScreenTableBlock,
  type ScreenView,
} from "./screen-view";
import type { CatalogMod } from "./mod-store";
import type { SessionPreview } from "./mod-session";
import type { ModHooks } from "@rpgm-tools/neo-angband-core";
import {
  describeContested,
  describeDeclaredConflict,
  type Finding,
  type PackManifest,
  type RecordConflict,
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
  engineHeld: null,
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
        text: "  unord-mod v0.13.0 (neostryder/neo-angband-mod-qol offers no version this",
        color: UI_DIM,
      },
      { text: "    can be compared with)", color: UI_DIM },
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

  it("wraps a long update problem without losing the ending", () => {
    const view = modUpdateReportScreen([
      R({
        standing: "unavailable",
        problem: "the repository returned a detailed diagnostic that continues past the terminal width and ends with this punctuation.",
      }),
    ]);
    const block = tableOf(view, "installed");
    const lines = screenBlockLines(block, 80).map((line) => line.text);
    expect(lines.every((line) => line.length <= 79)).toBe(true);
    expect(lines.join(" ").replace(/\s+/gu, " ")).toContain(block.rows[0]!.cells.status!.text);
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

  it("wraps long names, rejected reasons, and impossible cycles", () => {
    const long = "A deliberately long mod name that continues beyond the terminal width so its final words and punctuation remain visible.";
    const view = autoSortScreen(
      sorted({
        order: ["long"],
        dropped: [
          { from: "long", to: "other", tier: "author", reason: long, cycle: ["long", "other"] },
        ],
        unresolvable: [["long", "other"]],
      }),
      ["other"],
      (id) => (id === "long" ? long : `${long} other`),
    );
    const lines = screenBodyLines(view, 80).map((line) => line.text);
    expect(lines.every((line) => line.length <= 79)).toBe(true);
    expect(lines.join(" ").replace(/\s+<- moved/gu, "").replace(/\s+/gu, " ")).toContain(long);
    const cycleLines = screenBlockLines(tableOf(view, "unresolvable"), 80).map((line) => line.text);
    expect(cycleLines.at(-1)).toContain("other");
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
      /* WRAPPED, where the hand-laid `lines` version ran 100 characters off an
       * 80-column terminal unbroken: `detail`'s indent (4) leaves a 76-column
       * wrap, and this cycle sentence is the one real fixture in this file long
       * enough to hit it. A cycle rarely names two mods this verbose, so this is
       * the one line in this pass that did not survive byte-identical - see the
       * task report for the measurement. */
      "    dropped - it would need Quality of Life -> Bug Fixes (unofficial patch set)",
      "    -> Quality of Life",
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

  it("names a dropped suggestion's mods apart from the reason and the cycle", () => {
    /* The ids behind "A -> B -> A" are on `semantic.data`, exactly as the
     * unresolvable table's already are - what task #265 asked this table for.
     * Ids outside NAMES on purpose (nameOf falls back to the id itself), so the
     * cycle sentence stays short enough not to wrap and this test is only about
     * shape, not the wrap this file's OTHER test already pins. */
    const table = tableOf(
      autoSortScreen(
        sorted({
          order: ["a", "b"],
          dropped: [
            {
              from: "a",
              to: "b",
              tier: "author",
              reason: "a asks to load before b",
              cycle: ["a", "b"],
            },
          ],
        }),
        ["a", "b"],
        nameOf,
      ),
      "dropped",
    );
    expect(table.rows[0]!.cells.reason!.text).toBe("a asks to load before b");
    expect(table.rows[0]!.semantic).toEqual({ kind: "mod-cycle-dropped", data: { ids: "a,b" } });
    expect(table.rows[0]!.detail).toEqual({
      indent: 4,
      paragraphs: [[{ text: "dropped - it would need a -> b -> a" }]],
      color: UI_DIM,
    });
  });

  it("renders the reason and its detail as full ScreenLine objects, not just text", () => {
    /* THE FULL ScreenLine, not the string - a detail's line carries `runs` where
     * the hand-laid version emitted a plain coloured line, and only asserting
     * `.text` here would miss that shape entirely (see the task report). */
    const view = autoSortScreen(
      sorted({
        order: ["a"],
        dropped: [
          { from: "a", to: "b", tier: "author", reason: "short reason", cycle: ["a", "b"] },
        ],
      }),
      ["a"],
      nameOf,
    );
    const lines = screenBodyLines(view, 80);
    const reasonLine = lines.find((l) => l.text === "  short reason");
    expect(reasonLine).toEqual({ text: "  short reason", color: UI_TEXT });
    const detailLine = lines.find((l) => l.text.startsWith("    dropped"));
    expect(detailLine).toEqual({
      text: "    dropped - it would need a -> b -> a",
      color: UI_DIM,
      runs: [{ text: "    dropped - it would need a -> b -> a", color: UI_DIM }],
    });
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
    const lines = screenBodyLines(view, 80);
    expect(lines.slice(0, 5)).toEqual([
      { text: '"Quality of Life" requests these capabilities:', color: UI_TEXT },
      { text: "", color: UI_TEXT },
      { text: "  - Add new player commands", color: UI_TEXT },
      {
        text: "  - Override effect, combat, and magic logic".padEnd(69) + "[elevated]",
        color: UI_GOLD,
      },
      { text: "", color: UI_TEXT },
    ]);
    expect(
      lines.filter((line) => line.color === UI_BAD).map((line) => line.text).join(" "),
    ).toBe(
      "This mod runs its own code inside the game and can change how the game behaves. Only enable mods you trust.",
    );
  });

  it("wraps a 200-character blurb in full and keeps its elevated flag aligned", () => {
    const view = capabilityConsentScreen(CM({ capabilities: ["registry:*", "command:add"] }));
    const source = tableOf(view, "capabilities").rows[0]!.cells.text!.text;
    const rendered = screenBodyLines(view, 80);
    const capabilityLines = rendered.filter((line) => line.color === UI_GOLD).map((line) => line.text);
    expect(capabilityLines).toHaveLength(4);
    expect(capabilityLines[0]).toContain("[elevated]");
    expect(capabilityLines[0]!.indexOf("[elevated]")).toBe(69);
    expect(capabilityLines.slice(1).every((line) => !line.includes("[elevated]"))).toBe(true);
    expect(capabilityLines.every((line) => line.length <= 79)).toBe(true);
    expect(
      capabilityLines
        .map((line) => line.replace(/^\s*-\s*/u, "").replace(/\s+\[elevated\]$/u, "").trim())
        .join(" "),
    ).toBe(source);
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

  it("warns about the code for a plugin whose whole list is modest", () => {
    /* The line is about the CODE, not about the list. `registry:tiles` is
     * deliberately not elevated - a tile filler can only write where nothing is
     * assigned - so this mod's declared list is as harmless as a list gets, and
     * the mod still runs in-process with `ctx.core`, `ctx.state` and
     * `ctx.registries`, none of which is capability-checked. A screen that stayed
     * quiet here would be telling the player the list bounds the access. */
    const rows = text(
      capabilityConsentScreen(CM({ kind: "trusted", capabilities: ["registry:tiles"] })),
    );
    expect(rows.join(" ")).toContain(
      "This mod runs its own code inside the game and can change how the game behaves. Only enable mods you trust.",
    );
  });

  it("stays quiet for a content pack, which executes nothing", () => {
    /* A content pack is validated data. It cannot carry the line's subject, so
     * giving it one would be a warning with no mechanism behind it. */
    const rows = text(capabilityConsentScreen(CM({ kind: "content", capabilities: ["event:turn-start"] })));
    expect(rows.some((r) => r.includes("runs its own code"))).toBe(false);
  });
});

describe("the temporary-load capability read", () => {
  it("uses the same wrapped capability column before running a mod", () => {
    const preview: Extract<SessionPreview, { ok: true }> = {
      ok: true,
      id: "draft",
      version: "1.0.0",
      code: ["plugin.js"],
      capabilities: ["registry:*"],
      digest: "0123456789abcdef",
      bytes: 1,
    };
    const view = sessionLoadScreen(preview, "draft.zip", true);
    const block = tableOf(view, "capabilities");
    const rendered = screenBlockLines(block, 80);
    const capabilityLines = rendered.filter((line) => line.color === UI_GOLD).map((line) => line.text);
    expect(capabilityLines[0]).toContain("[elevated]");
    expect(capabilityLines.every((line) => line.length <= 79)).toBe(true);
    expect(capabilityLines.map((line) => line.replace(/\s+\[elevated\]$/u, "").trim()).join(" "))
      .toContain("Override ANY game system - effects, level and dungeon generation");
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
  recordRows: [],
  tileClaims: [],
  playerTileProviders: [],
  hookContributions: [],
  ruleDecls: [],
  controllers: [],
  frontends: [],
  hudRegions: [],
  menus: [],
  screens: [],
};

/**
 * The content layer's own record for the one contested row this fixture carries,
 * matching the sentence text below exactly - the text is unchanged from before this
 * pass; only the record now travels beside it (modConflictLines, pack.ts).
 */
const FROST_KOBOLD_RECORD: RecordConflict = {
  ref: "core:kobold",
  file: "monster",
  contributingPacks: ["frost", "runes"],
  fields: [{ path: "speed", owners: ["frost", "runes"], winner: "runes" }],
  collisions: [{ path: "speed", owners: ["frost", "runes"] }],
  humanLines: ["frost and runes both set kobold.speed"],
};

/**
 * Every group at once: an author's declaration, a content-record row carrying
 * FROST_KOBOLD_RECORD, one discarding slot per layer, and one combining slot.
 *
 * Deliberately maximal - the screen's three groups are only distinguishable when all
 * three are present.
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
  recordRows: [{ text: "frost and runes both set kobold.speed", record: FROST_KOBOLD_RECORD }],
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
      // A content-layer row (RecordConflict) or a truly recordless one (null):
      // describeContested only knows ContestedSlot, so skip both; see below.
      if (record === null || !("layer" in record)) return;
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

  it("carries the content layer's real record now, retiring the content-record stopgap", () => {
    /* Before this pass, pack.ts's modConflictLines flattened computeConflictReport's
     * field-granular records into plain sentences, so this row arrived here as
     * `{ kind: "content-record" }` with no `ref` - a stopgap marking "the record
     * was not published" apart from "nothing to say". modConflictLines now carries
     * the RecordConflict beside the sentence like any other layer, so this row is
     * `record-conflict`, with the fields FROST_KOBOLD_RECORD actually contains. */
    const row = tableOf(view, "contested").rows[0]!;
    expect(row.id).toBe("core:kobold");
    expect(row.semantic).toEqual({
      kind: "record-conflict",
      ref: "core:kobold",
      data: {
        file: "monster",
        contributingPacks: "frost,runes",
        collidingFields: "speed",
        overriddenBy: null,
        overrideKind: null,
      },
    });
    /* The retired stopgap kind no longer appears anywhere on this screen. */
    expect(
      tableOf(view, "contested").rows.filter((r) => r.semantic?.kind === "content-record"),
    ).toHaveLength(0);
  });

  it("still marks a row distinctly when modConflictLines truly has no record to give it", () => {
    /* The one case left: resolveLoadOrder threw before a RecordConflict existed
     * (pack.ts's modConflictLines). Built directly rather than through EVERY_CONFLICT,
     * since that fixture's one content row now carries a real record. */
    const nullRecordView = modConflictsScreen(
      conflictLines({
        ...NO_CONFLICT_INPUTS,
        recordRows: [{ text: "pack needs-ghost requires missing pack ghost", record: null }],
      }),
    );
    const row = tableOf(nullRecordView, "contested").rows[0]!;
    expect(row.semantic).toEqual({ kind: "unresolved-load-order" });
    expect(row.semantic?.ref).toBeUndefined();
    expect(row.id).toBeUndefined();
  });

  it("keeps the sentences and the records in step", () => {
    /* The three `string[]` are read off the rows rather than composed beside them;
     * this is the assertion that the derivation still holds. */
    expect(report.contested).toEqual(report.contestedRows.map((r) => r.text));
    expect(report.declared).toEqual(report.declaredRows.map((r) => r.text));
    expect(report.combined).toEqual(report.combinedRows.map((r) => r.text));
  });

  it("wraps a long conflict sentence instead of dropping its ending", () => {
    const long = "A conflict explanation that continues beyond the terminal width so a player can read every last word before deciding what to enable.";
    const view = modConflictsScreen(
      conflictLines({ ...NO_CONFLICT_INPUTS, recordRows: [{ text: long, record: null }] }),
    );
    const block = view.blocks.find((candidate) => candidate.kind === "table");
    if (!block || block.kind !== "table") throw new Error("no conflict table");
    const lines = screenBlockLines(block, 80).map((line) => line.text);
    expect(lines.every((line) => line.length <= 79)).toBe(true);
    expect(lines.join(" ")).toBe(long);
  });
});

/* ------------------------------------------------------------------ */
/* The install/zip-import refusal screens (task #265)                  */
/* ------------------------------------------------------------------ */

const REFUSAL_UNMET: readonly Finding[] = [
  {
    id: "declare-a-repository",
    level: "required",
    title: "Say where the mod lives, in `repository`",
    problem: "no repository declared",
  },
  {
    id: "engine-range",
    level: "required",
    title: "Declare the engine range the mod was written against",
    problem:
      "engine range cannot be read: not a valid semver range at all, which is longer than the wrap width on purpose",
  },
];

describe("the install-refusal screens put one row per requirement, title as the row", () => {
  it("carries the finding's identity and puts the problem in detail, not the cell", () => {
    const view = installFailureScreen("Demo", "demo: refused.", REFUSAL_UNMET);
    const table = tableOf(view, "unmet");
    expect(table.rows).toHaveLength(2);
    expect(table.rows[0]!.id).toBe("declare-a-repository");
    expect(table.rows[0]!.semantic).toEqual({
      kind: "mod-requirement",
      ref: "declare-a-repository",
      data: { level: "required" },
    });
    expect(table.rows[0]!.cells.title!.text).toBe("Say where the mod lives, in `repository`");
    /* wrap is DERIVED - MESSAGE_WIDTH (74) minus the detail's own indent (2) - not
     * a second 72 typed in beside it; see mod-browse.ts's findingRow. */
    expect(table.rows[0]!.detail).toEqual({
      indent: 2,
      wrap: 72,
      paragraphs: [[{ text: "no repository declared" }]],
      color: UI_GOLD,
    });
  });

  it("renders the title as a plain coloured row and the problem as a wrapped detail", () => {
    /* FULL ScreenLine objects: the detail line carries `runs` where the hand-laid
     * bullet used to be a plain string, and only checking `.text` would miss it. */
    const lines = screenBodyLines(installFailureScreen("Demo", "demo: refused.", REFUSAL_UNMET), 80);
    expect(lines).toContainEqual({
      text: "  - Say where the mod lives, in `repository`",
      color: UI_GOLD,
    });
    expect(lines).toContainEqual({
      text: "  no repository declared",
      color: UI_GOLD,
      runs: [{ text: "  no repository declared", color: UI_GOLD }],
    });
    /* The long problem DOES wrap - at 72, not at the terminal's own 80 - because
     * MESSAGE_WIDTH stays the refusal's own authority regardless of the block model. */
    expect(lines).toContainEqual({
      text: "  engine range cannot be read: not a valid semver range at all, which is",
      color: UI_GOLD,
      runs: [
        { text: "  engine range cannot be read: not a valid semver range at all, which is", color: UI_GOLD },
      ],
    });
    expect(lines).toContainEqual({
      text: "  longer than the wrap width on purpose",
      color: UI_GOLD,
      runs: [{ text: "  longer than the wrap width on purpose", color: UI_GOLD }],
    });
  });

  it("uses the door's own colour for a zip import refusal, and its own closing line", () => {
    const lines = screenBodyLines(zipImportFailureScreen("bad zip", REFUSAL_UNMET.slice(0, 1)), 80);
    expect(lines).toContainEqual({
      text: "  - Say where the mod lives, in `repository`",
      color: UI_BAD,
    });
    expect(lines.at(-1)).toEqual({
      text: "Nothing has been installed or changed.",
      color: UI_DIM,
    });
  });

  it("shows nothing but the sentence when no requirements were asked about", () => {
    /* No `unmet` table block at all - `refusalBlocks` skips it, exactly as the
     * flattened version used to skip the bullets and the advice paragraph. */
    const view = installFailureScreen("Demo", "a/b: escapes the mod folder");
    expect(view.blocks.some((b) => b.kind === "table")).toBe(false);
    expect(screenBodyLines(view, 80).map((l) => l.text)).toEqual([
      "Demo was not installed.",
      "",
      "a/b: escapes the mod folder",
      "",
      "Nothing was stored, so your other mods are untouched.",
    ]);
  });
});

describe("the six screens are declared as modelled", () => {
  it("names each id in MODELLED_SCREENS", () => {
    /* screen-view.test.ts derives the same list from the `freezeView` calls that
     * exist; this states which six this file is responsible for, so a screen
     * quietly reverting to `showTextScreen(term, title, lines)` fails here too. */
    expect(modUpdateReportScreen([]).id).toBe("core:mod-updates");
    expect(autoSortScreen(sorted({ order: ["qol"] }), ["qol"], nameOf).id).toBe(
      "core:mod-auto-sort",
    );
    expect(capabilityConsentScreen(CM({})).id).toBe("core:mod-capabilities");
    expect(modConflictsScreen(conflictLines(NO_CONFLICT_INPUTS)).id).toBe(
      "core:mod-conflicts",
    );
    expect(installFailureScreen("x", "y").id).toBe("core:mod-install-failure");
    expect(zipImportFailureScreen("y").id).toBe("core:mod-zip-import-failure");
    for (const id of [
      "core:mod-updates",
      "core:mod-auto-sort",
      "core:mod-capabilities",
      "core:mod-conflicts",
      "core:mod-install-failure",
      "core:mod-zip-import-failure",
    ]) {
      expect(MODELLED_SCREENS).toContain(id);
    }
  });
});
