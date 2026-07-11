/**
 * Tests for the second-character-screen resist / ability / sustain / modifier
 * grid ported in ui-entry.ts. Exercises: the nine combiners (RESIST_0 and
 * LOGICAL_OR_WITH_CANCEL semantics from the ui_entry.txt header comment),
 * generic element/stat expansion and the shortened-label logic, the
 * priority-sorted iterator ordering, the renderer value -> symbol/palette
 * mapping for the four backends the char screen uses, compute_ui_entry_values_*
 * for objects and the player, is_ui_entry_for_known_rune, and characterGrid
 * assembly for a constructed state.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { FlagSet } from "../bitflag";
import { OF } from "../generated/object-flags";
import { ELEM } from "../generated/elements";
import { STAT } from "../generated/stats";
import { OBJ_MOD } from "../generated/object-modifiers";
import { newElemInfo, newOfFlags, OBJ_MOD_MAX, OF_SIZE } from "../obj/types";
import type { ElementInfo } from "../obj/types";
import type { GameObject } from "../obj/object";
import { makeState } from "./harness";
import {
  applyRenderer,
  buildUiEntryConfig,
  characterGrid,
  combineValues,
  computeObjectValues,
  isUiEntryForKnownRune,
  UI_ENTRY_RESIST0_RES_VUL,
  UI_ENTRY_UNKNOWN_VALUE,
  UI_ENTRY_VALUE_NOT_PRESENT,
} from "./ui-entry";
import type { UiEntryConfig } from "./ui-entry";

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function load(name: string): unknown[] {
  const url = new URL(`../../../content/pack/${name}.json`, import.meta.url);
  return (JSON.parse(readFileSync(url, "utf8")) as { records: unknown[] }).records;
}

const config: UiEntryConfig = buildUiEntryConfig({
  uiEntry: load("ui_entry") as never,
  uiEntryBase: load("ui_entry_base") as never,
  uiEntryRenderer: load("ui_entry_renderer") as never,
  objectProperty: load("object_property") as never,
  playerProperty: load("player_property") as never,
});

interface RawEntry {
  name: string;
  label: string;
  nlabel: number;
  shortened: string[];
  categories: { name: string; priority: number }[];
  objProps: { type: number; index: number; isaux: boolean }[];
  pAbilities: { abilityType: string; index: number }[];
  rendererIndex: number;
  combinerIndex: number;
  flags: number;
  templateOnly: boolean;
}

function entry(name: string): RawEntry {
  const e = config.entries.find((x) => x.name === name);
  if (!e) throw new Error(`no entry ${name}`);
  return e as unknown as RawEntry;
}

/** A minimal object carrying only the fields compute reads. */
function makeObj(over: {
  modifiers?: Record<number, number>;
  elInfo?: Record<number, { resLevel?: number; flags?: number }>;
  flags?: number[];
}): GameObject {
  const modifiers = new Array<number>(OBJ_MOD_MAX).fill(0);
  for (const [k, v] of Object.entries(over.modifiers ?? {})) modifiers[Number(k)] = v;
  const elInfo = newElemInfo();
  for (const [k, v] of Object.entries(over.elInfo ?? {})) {
    const e = elInfo[Number(k)] as ElementInfo;
    if (v.resLevel !== undefined) e.resLevel = v.resLevel;
    if (v.flags !== undefined) e.flags = v.flags;
  }
  const flags = newOfFlags();
  for (const f of over.flags ?? []) flags.on(f);
  return { modifiers, elInfo, flags } as unknown as GameObject;
}

/* ------------------------------------------------------------------ */
/* Combiners (ui-entry-combiner.c)                                    */
/* ------------------------------------------------------------------ */

describe("combiners (ui-entry-combiner.c)", () => {
  it("ADD sums known values and ignores NOT_PRESENT / UNKNOWN", () => {
    expect(combineValues("ADD", [2, 3, 5], [0, 0, 0]).accum).toBe(10);
    expect(combineValues("ADD", [2, UI_ENTRY_VALUE_NOT_PRESENT, 5], [0, 0, 0]).accum).toBe(7);
    /* An UNKNOWN with no known value stays UNKNOWN. */
    expect(combineValues("ADD", [UI_ENTRY_VALUE_NOT_PRESENT, UI_ENTRY_UNKNOWN_VALUE], [0, 0]).accum).toBe(
      UI_ENTRY_UNKNOWN_VALUE,
    );
  });

  it("LARGEST / SMALLEST pick the extreme known value", () => {
    expect(combineValues("LARGEST", [1, 4, 2], [0, 0, 0]).accum).toBe(4);
    expect(combineValues("SMALLEST", [1, 4, 2], [0, 0, 0]).accum).toBe(1);
  });

  it("FIRST / LAST take the end values", () => {
    expect(combineValues("FIRST", [7, 8, 9], [0, 0, 0]).accum).toBe(7);
    expect(combineValues("LAST", [7, 8, 9], [0, 0, 0]).accum).toBe(9);
  });

  it("BITWISE_OR ors the known values", () => {
    expect(combineValues("BITWISE_OR", [1, 2, 4], [0, 0, 0]).accum).toBe(7);
  });

  it("LOGICAL_OR is 1 when any known value is nonzero, else 0", () => {
    expect(combineValues("LOGICAL_OR", [0, 0, 3], [0, 0, 0]).accum).toBe(1);
    expect(combineValues("LOGICAL_OR", [0, 0, 0], [0, 0, 0]).accum).toBe(0);
    expect(combineValues("LOGICAL_OR", [UI_ENTRY_VALUE_NOT_PRESENT], [0]).accum).toBe(
      UI_ENTRY_VALUE_NOT_PRESENT,
    );
  });

  it("LOGICAL_OR_WITH_CANCEL: negative overrides positive (ui_entry.txt L39)", () => {
    /* zero if all zero, one if a positive and no negative, -1 if any negative. */
    expect(combineValues("LOGICAL_OR_WITH_CANCEL", [0, 0], [0, 0]).accum).toBe(0);
    expect(combineValues("LOGICAL_OR_WITH_CANCEL", [1, 1], [0, 0]).accum).toBe(1);
    expect(combineValues("LOGICAL_OR_WITH_CANCEL", [1, -1], [0, 0]).accum).toBe(-1);
    expect(combineValues("LOGICAL_OR_WITH_CANCEL", [-1], [0]).accum).toBe(-1);
  });

  it("RESIST_0: immunity trumps all; resist+vuln cancels to the RES_VUL marker", () => {
    /* immunity (3) trumps a vulnerability. */
    expect(combineValues("RESIST_0", [3, -1], [0, 0]).accum).toBe(3);
    /* a positive resist plus a vulnerability -> the resist+vuln marker. */
    expect(combineValues("RESIST_0", [1, -1], [0, 0]).accum).toBe(UI_ENTRY_RESIST0_RES_VUL);
    /* resist only. */
    expect(combineValues("RESIST_0", [1, 1], [0, 0]).accum).toBe(1);
    /* vulnerability only. */
    expect(combineValues("RESIST_0", [-1], [0]).accum).toBe(-1);
    /* nothing. */
    expect(combineValues("RESIST_0", [0, 0], [0, 0]).accum).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Generic expansion + labels (ui-entry.c)                             */
/* ------------------------------------------------------------------ */

describe("generic expansion and labels (ui-entry.c)", () => {
  it("expands resist_ui_compact_0 into one entry per element with the right labels", () => {
    expect(entry("resist_ui_compact_0<ACID>").label).toBe("Acid");
    expect(entry("resist_ui_compact_0<ELEC>").label).toBe("Elec");
    expect(entry("resist_ui_compact_0<COLD>").label).toBe("Cold");
    expect(entry("resist_ui_compact_0<DISEN>").label).toBe("Disenchant");
  });

  it("expands stat_mod_ui_compact_0 per stat with the stat name as the default label", () => {
    expect(entry("stat_mod_ui_compact_0<STR>").label).toBe("STR");
    expect(entry("stat_mod_ui_compact_0<CON>").label).toBe("CON");
  });

  it("honours explicit shortened labels (Pois label5, Nx label2)", () => {
    /* index 4 is the 5-char version, index 1 the 2-char version. */
    expect(entry("resist_ui_compact_0<POIS>").shortened[4]).toBe("Pois");
    expect(entry("resist_ui_compact_0<NEXUS>").shortened[1]).toBe("Nx");
  });

  it("fills shortened labels from the full label when none is given", () => {
    /* Nexus has no label5; the 5-char version is the full 5-char label. */
    expect(entry("resist_ui_compact_0<NEXUS>").shortened[4]).toBe("Nexus");
    /* Acid (4 chars) truncates to 2 chars for the 2-char version. */
    expect(entry("resist_ui_compact_0<ACID>").shortened[1]).toBe("Ac");
  });

  it("does not enter the undecorated parameterized name (ui_entry.txt L20-23)", () => {
    /* A parameterized entry's bare name is never inserted into the table. */
    expect(config.entries.some((e) => e.name === "resist_ui_compact_0")).toBe(false);
    expect(config.entries.some((e) => e.name === "stat_mod_ui_compact_0")).toBe(false);
  });

  it("marks templates as template-only and concrete entries as displayable", () => {
    expect(entry("good_flag_ui_compact_0").templateOnly).toBe(true);
    expect(entry("resist_ui_compact_0<ACID>").templateOnly).toBe(false);
  });

  it("binds object properties and player abilities through the bindui directive", () => {
    /* Acid resist gets resistance/vulnerability/immunity object props + 3 element abilities. */
    const acid = entry("resist_ui_compact_0<ACID>");
    expect(acid.objProps.map((o) => o.type).sort()).toEqual([5, 6, 7]);
    expect(acid.pAbilities.filter((a) => a.abilityType === "element")).toHaveLength(3);
    /* STR modifier: the stat itself plus the sustain flag bound as an aux value. */
    const str = entry("stat_mod_ui_compact_0<STR>");
    expect(str.objProps.some((o) => o.type === 1 && o.index === STAT.STR && !o.isaux)).toBe(true);
    expect(str.objProps.some((o) => o.type === 3 && o.index === OF.SUST_STR && o.isaux)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Priority ordering (cmp_desc_prio)                                   */
/* ------------------------------------------------------------------ */

describe("iterator ordering (cmp_desc_prio, ui-player.c assembly)", () => {
  it("orders the resistance panel ACID..DISEN by descending priority", () => {
    const st = makeState();
    const { resistPanels } = characterGrid(st, config);
    const resist = resistPanels.find((p) => p.key === "resistances");
    expect(resist?.rows.map((r) => r.name)).toEqual([
      "resist_ui_compact_0<ACID>",
      "resist_ui_compact_0<ELEC>",
      "resist_ui_compact_0<FIRE>",
      "resist_ui_compact_0<COLD>",
      "resist_ui_compact_0<POIS>",
      "resist_ui_compact_0<LIGHT>",
      "resist_ui_compact_0<DARK>",
      "resist_ui_compact_0<SOUND>",
      "resist_ui_compact_0<SHARD>",
      "resist_ui_compact_0<NEXUS>",
      "resist_ui_compact_0<NETHER>",
      "resist_ui_compact_0<CHAOS>",
      "resist_ui_compact_0<DISEN>",
    ]);
  });

  it("orders the abilities panel by its priority chain (pFear first)", () => {
    const st = makeState();
    const { resistPanels } = characterGrid(st, config);
    const abilities = resistPanels.find((p) => p.key === "abilities");
    expect(abilities?.rows.slice(0, 4).map((r) => r.name)).toEqual([
      "pfear_ui_compact_0",
      "pblind_ui_compact_0",
      "pconf_ui_compact_0",
      "pstun_ui_compact_0",
    ]);
  });
});

/* ------------------------------------------------------------------ */
/* Renderer value -> symbol / colour (ui-entry-renderers.c)            */
/* ------------------------------------------------------------------ */

describe("renderer value -> symbol mapping (ui-entry-renderers.c)", () => {
  const resistRenderer = () => {
    const e = entry("resist_ui_compact_0<ACID>");
    return config.renderers[e.rendererIndex - 1]!;
  };

  it("COMPACT_RESIST maps unknown/not-present/none/resist/vuln/immune to its symbols", () => {
    const r = resistRenderer();
    /* symbols "?..+-*..." : ? unknown, . not-present, . none, + resist, - vuln, * immune. */
    const row = applyRenderer(
      r,
      [UI_ENTRY_UNKNOWN_VALUE, UI_ENTRY_VALUE_NOT_PRESENT, 0, 1, -1, 3],
      [0, 0, 0, 0, 0, 0],
      { knownRune: true, alternateColorFirst: false },
    );
    expect(row.cells.map((c) => c.symbol)).toEqual(["?", ".", ".", "+", "-", "*"]);
  });

  it("COMPACT_RESIST colours the label grey (palette 0) when the rune is unknown", () => {
    const r = resistRenderer();
    const unknown = applyRenderer(r, [1], [0], { knownRune: false, alternateColorFirst: false });
    expect(unknown.labelColorIndex).toBe(0);
    const known = applyRenderer(r, [1], [0], { knownRune: true, alternateColorFirst: false });
    expect(known.labelColorIndex).not.toBe(0);
  });

  it("NUMERIC_AS_SIGN renders +/-/0 sign symbols for a modifier row", () => {
    const e = entry("stealth_ui_compact_0");
    const r = config.renderers[e.rendererIndex - 1]!;
    /* symbols "?....+!+--=" : idx2 '.' zero, idx5 '+' positive, idx8 '-' negative. */
    const row = applyRenderer(r, [0, 3, -3], [0, 0, 0], {
      knownRune: true,
      alternateColorFirst: false,
    });
    expect(row.cells.map((c) => c.symbol)).toEqual([".", "+", "-"]);
  });

  it("NUMERIC_WITH_BOOL_AUX renders a single digit / sign for the stat panel", () => {
    const e = entry("stat_mod_ui_compact_0<STR>");
    const r = config.renderers[e.rendererIndex - 1]!;
    /* ndigit 1, NO_SIGN: positive shows the digit, negative shows the negative
       overflow symbol (can't fit a sign in one column), zero shows '.'. */
    const row = applyRenderer(
      r,
      [0, 2, -1, UI_ENTRY_VALUE_NOT_PRESENT],
      [0, 0, 0, 0],
      { knownRune: true, alternateColorFirst: false },
    );
    expect(row.cells[0]!.symbol).toBe(".");
    expect(row.cells[1]!.symbol).toBe("2");
    expect(row.cells[3]!.symbol).toBe(" ");
  });
});

/* ------------------------------------------------------------------ */
/* compute_ui_entry_values_for_object (ui-entry.c L708)                */
/* ------------------------------------------------------------------ */

describe("computeObjectValues (ui-entry.c L708)", () => {
  const acid = () => entry("resist_ui_compact_0<ACID>") as unknown as Parameters<typeof computeObjectValues>[0];
  const str = () => entry("stat_mod_ui_compact_0<STR>") as unknown as Parameters<typeof computeObjectValues>[0];

  it("returns NOT_PRESENT for a null object", () => {
    const st = makeState();
    const r = computeObjectValues(acid(), null, st.actor.player);
    expect(r.val).toBe(UI_ENTRY_VALUE_NOT_PRESENT);
  });

  it("reads a known resistance and reports UNKNOWN when the rune is not learned", () => {
    const st = makeState();
    const p = st.actor.player;
    const obj = makeObj({ elInfo: { [ELEM.ACID]: { resLevel: 1 } } });
    p.objKnown.elInfo[ELEM.ACID]!.resLevel = 1;
    expect(computeObjectValues(acid(), obj, p).val).toBe(1);
    /* Unlearned rune on an object that has the property -> UNKNOWN. */
    p.objKnown.elInfo[ELEM.ACID]!.resLevel = 0;
    expect(computeObjectValues(acid(), obj, p).val).toBe(UI_ENTRY_UNKNOWN_VALUE);
  });

  it("combines a stat modifier (val) with its sustain flag (auxval)", () => {
    const st = makeState();
    const p = st.actor.player;
    p.objKnown.modifiers[STAT.STR] = 1;
    p.objKnown.flags.on(OF.SUST_STR);
    const obj = makeObj({ modifiers: { [OBJ_MOD.STR]: 2 }, flags: [OF.SUST_STR] });
    const r = computeObjectValues(str(), obj, p);
    expect(r.val).toBe(2);
    /* The sustain is bound as an aux value (uival 1). */
    expect(r.auxval).toBe(1);
  });
});

/* ------------------------------------------------------------------ */
/* is_ui_entry_for_known_rune (ui-entry.c L591)                        */
/* ------------------------------------------------------------------ */

describe("isUiEntryForKnownRune (ui-entry.c L591)", () => {
  it("is false until every bound rune is known, then true", () => {
    const st = makeState();
    const p = st.actor.player;
    const acid = entry("resist_ui_compact_0<ACID>") as unknown as Parameters<typeof isUiEntryForKnownRune>[0];
    expect(isUiEntryForKnownRune(acid, p)).toBe(false);
    p.objKnown.elInfo[ELEM.ACID]!.resLevel = 1;
    expect(isUiEntryForKnownRune(acid, p)).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Grid assembly (ui-player.c display_resistance_panel / sust_info)    */
/* ------------------------------------------------------------------ */

describe("characterGrid (ui-player.c assembly)", () => {
  it("produces the four resist panels plus the stat-mod panel", () => {
    const st = makeState();
    const grid = characterGrid(st, config);
    expect(grid.resistPanels.map((p) => p.key)).toEqual([
      "resistances",
      "abilities",
      "hindrances",
      "modifiers",
    ]);
    expect(grid.statModPanel.key).toBe("stat_modifiers");
    expect(grid.statModPanel.rows).toHaveLength(5);
  });

  it("gives each row one cell per equipment slot then the player column", () => {
    const st = makeState();
    const bodyCount = st.actor.player.body.count;
    const grid = characterGrid(st, config);
    const acidRow = grid.resistPanels[0]!.rows[0]!;
    expect(acidRow.cells).toHaveLength(bodyCount + 1);
    /* All equipment empty -> every equipment cell is the not-present symbol. */
    expect(acidRow.cells.slice(0, bodyCount).every((c) => c.symbol === ".")).toBe(true);
  });

  it("labels resist rows with the 5-char label plus a trailing colon", () => {
    const st = makeState();
    const grid = characterGrid(st, config);
    const rows = grid.resistPanels[0]!.rows;
    expect(rows.find((r) => r.name === "resist_ui_compact_0<ACID>")!.label).toBe(" Acid:");
    expect(rows.find((r) => r.name === "resist_ui_compact_0<POIS>")!.label).toBe(" Pois:");
    expect(rows.find((r) => r.name === "resist_ui_compact_0<NEXUS>")!.label).toBe("Nexus:");
  });

  it("draws no label on the stat-mod (sustain) panel rows", () => {
    const st = makeState();
    const grid = characterGrid(st, config);
    expect(grid.statModPanel.rows.every((r) => r.label === "")).toBe(true);
  });
});
