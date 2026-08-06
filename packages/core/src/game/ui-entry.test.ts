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
import { OF } from "../generated/object-flags.js";
import { PF } from "../generated/player-flags.js";
import { ELEM } from "../generated/elements.js";
import { STAT } from "../generated/stats.js";
import { OBJ_MOD } from "../generated/object-modifiers.js";
import { newElemInfo, newOfFlags, OBJ_MOD_MAX } from "../obj/types.js";
import { PF_SIZE } from "../player/types.js";
import { FlagSet } from "../bitflag.js";
import type { ElementInfo } from "../obj/types.js";
import type { GameObject } from "../obj/object.js";
import { makeState } from "./harness.js";
import {
  applyRenderer,
  buildUiEntryConfig,
  characterGrid,
  combineValues,
  liveTimedUiDeps,
  liveUiEntryDeps,
  resolveUiDeps,
  computeObjectValues,
  computePlayerValues,
  isUiEntryForKnownRune,
  UI_ENTRY_RESIST0_RES_VUL,
  UI_ENTRY_UNKNOWN_VALUE,
  UI_ENTRY_VALUE_NOT_PRESENT,
} from "./ui-entry.js";
import type { UiEntryConfig } from "./ui-entry.js";
import type { TimedEffect } from "../player/types.js";
import { TMD } from "../generated/player-timed.js";
import { TV } from "../generated/index.js";
import { KF } from "../generated/kind-flags.js";
import { OF_SIZE } from "../obj/types.js";
import { ObjRegistry } from "../obj/bind.js";
import type { ObjPackJson } from "../obj/types.js";
import { objectPrep } from "../obj/make.js";
import { bindConstants } from "../constants.js";
import { Rng } from "../rng.js";

/* A real object registry, for the equipped-launcher fixtures at the bottom of
   this file (PORT_TODO 3.9). Built the same way curse-tick.test.ts builds one. */
const objReg = new ObjRegistry({
  objectBase: loadRaw("object_base"),
  object: loadRaw("object"),
  egoItem: loadRaw("ego_item"),
  artifact: loadRaw("artifact"),
  curse: loadRaw("curse"),
  brand: loadRaw("brand"),
  slay: loadRaw("slay"),
  activation: loadRaw("activation"),
  objectProperty: loadRaw("object_property"),
  flavor: loadRaw("flavor"),
} as ObjPackJson);
const objConstants = bindConstants(loadRaw("constants"));

/* ------------------------------------------------------------------ */
/* Fixtures                                                            */
/* ------------------------------------------------------------------ */

function loadRaw<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../../content/pack/${name}.json`, import.meta.url), "utf8"),
  ) as T;
}

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

/* ------------------------------------------------------------------ */
/* liveTimedUiDeps: PORT_TODO 3.7 and 3.8                              */
/* ------------------------------------------------------------------ */

/**
 * The timed contributions to the character screen. Both `UiEntryDeps` seams
 * existed and defaulted to "no timed effect", and NOTHING supplied them - the
 * web shell's `equipCmpDeps()` returned no `entryDeps` at all - so the
 * timed-flag column read empty and the resist grid never showed a temporary
 * resist, for every character in every game.
 *
 * BOTH ITEMS BLAMED THE WRONG THING. 3.8 said `player_flags_timed()` is "not
 * ported": it is, at `player/calcs.ts:1097`, over the same `oflagDup` field.
 * 3.7 said `temp_resist` is not on the ported timed registry: it is,
 * `TimedEffect.tempResist`. The seams' own comments said the same and had
 * outlived both. Only the wiring was missing.
 *
 * Driven through `characterGrid`, so what is asserted is the GRID CELL a player
 * would read, not the builder's return value.
 */
describe("liveTimedUiDeps feeds the character grid's timed columns", () => {
  /** A timed table where effect index 1 dups an OF flag and 2 grants a resist. */
  function table(): TimedEffect[] {
    const blank = (): TimedEffect =>
      ({ oflagDup: 0, oflagSyn: false, tempResist: -1 }) as TimedEffect;
    const t: TimedEffect[] = [];
    for (let i = 0; i <= 3; i++) t.push(blank());
    t[1] = { ...blank(), oflagDup: OF.PROT_FEAR } as TimedEffect;
    t[2] = { ...blank(), tempResist: ELEM.FIRE } as TimedEffect;
    return t;
  }

  it("shows a timed OF flag that no equipment provides", () => {
    const st = makeState();
    const p = st.actor.player;
    /* Fixture must start EMPTY, or "the flag is set" proves nothing. */
    expect(
      liveTimedUiDeps(p, table()).timedObjectFlags!.has(OF.PROT_FEAR),
      "fixture: no effect active yet",
    ).toBe(false);

    p.timed[1] = 20;
    expect(liveTimedUiDeps(p, table()).timedObjectFlags!.has(OF.PROT_FEAR)).toBe(true);
  });

  it("reports a temporary resist for the element that grants it, and no other", () => {
    const st = makeState();
    const p = st.actor.player;
    p.timed[2] = 20;
    const deps = liveTimedUiDeps(p, table());

    expect(deps.timedElementEffect!(ELEM.FIRE)).toBe(1);
    expect(deps.timedElementEffect!(ELEM.COLD), "not a blanket yes").toBe(0);
  });

  it("EXCLUDES TMD_TRAPSAFE, which resolveUiDeps adds back itself", () => {
    /* player.c:310-320 skips TRAPSAFE so the OF_TRAP_IMMUNE learning hack can
     * tell a timed immunity from an innate one; resolveUiDeps then re-adds it from
     * p.timed directly (ui-entry.ts). Both halves asserted, because either one
     * alone looks correct: the builder omitting it, and the resolver supplying it. */
    const st = makeState();
    const p = st.actor.player;
    const t = table();
    while (t.length <= TMD.TRAPSAFE) {
      t.push({ oflagDup: 0, oflagSyn: false, tempResist: -1 } as TimedEffect);
    }
    t[TMD.TRAPSAFE] = {
      oflagDup: OF.TRAP_IMMUNE,
      oflagSyn: false,
      tempResist: -1,
    } as TimedEffect;
    p.timed[TMD.TRAPSAFE] = 20;

    const built = liveTimedUiDeps(p, t);
    expect(
      built.timedObjectFlags!.has(OF.TRAP_IMMUNE),
      "the builder skips TRAPSAFE",
    ).toBe(false);

    /* resolveUiDeps mutates the FlagSet it is handed, so the flag arrives there. */
    const resolved = resolveUiDeps(p, built);
    expect(
      resolved.timedObjectFlags.has(OF.TRAP_IMMUNE),
      "and the resolver puts it back",
    ).toBe(true);
  });

  it("reaches the grid cell a player reads, not just the deps object", () => {
    /* The wiring half. Same state, same config, deps supplied vs omitted: the
     * pFear ability row must differ. Omitting them is exactly what the shell did. */
    const st = makeState();
    st.actor.player.timed[1] = 20;

    const without = characterGrid(st, config).resistPanels
      .find((pan) => pan.key === "abilities")!
      .rows.find((r) => r.name === "pfear_ui_compact_0")!;
    const withDeps = characterGrid(st, config, liveTimedUiDeps(st.actor.player, table()))
      .resistPanels.find((pan) => pan.key === "abilities")!
      .rows.find((r) => r.name === "pfear_ui_compact_0")!;

    expect(
      JSON.stringify(withDeps.cells),
      "supplying the timed deps changes the row a player sees",
    ).not.toBe(JSON.stringify(without.cells));
  });
});

/**
 * liveUiEntryDeps: all three seams, and PORT_TODO 3.6's half specifically.
 *
 * `playerHas` defaulted to reading `p.pflags` - a field `Player` DOES NOT HAVE -
 * so it answered false for every PF_* and no intrinsic ability ever appeared on
 * the sheet. The data was live all along in `PlayerState.pflags`.
 *
 * This exists as a separate builder from `liveTimedUiDeps` because wiring a subset
 * is the actual bug: the first pass at 3.7/3.8 supplied the timed pair to the
 * equip-compare screen and left the character sheet - the screen those items
 * describe - untouched.
 */
describe("liveUiEntryDeps supplies all FOUR seams, not a subset", () => {
  it("answers playerHas from the COMPUTED pflags, not the absent Player field", () => {
    const st = makeState();
    /* No playerState yet: the honest answer is false, and this pins that the
     * fallback is a real answer rather than a crash. */
    expect(liveUiEntryDeps(st).playerHas!(PF.UNLIGHT)).toBe(false);

    const flags = new FlagSet(PF_SIZE);
    flags.on(PF.UNLIGHT);
    (st as unknown as { playerState?: { pflags: FlagSet } }).playerState = {
      pflags: flags,
    };

    expect(liveUiEntryDeps(st).playerHas!(PF.UNLIGHT)).toBe(true);
    expect(liveUiEntryDeps(st).playerHas!(PF.FAST_SHOT), "not a blanket yes").toBe(
      false,
    );
  });

  it("carries every seam, so no caller can wire a subset", () => {
    /* The reason this builder exists. If it returned only playerHas, every screen
     * would be back to an empty timed column - which is the bug, one level up.
     * This list is a RATCHET: a new UiEntryDeps seam must be added here, or the
     * next "the reach exists, it just has no route" item repeats. `launcher`
     * (PORT_TODO 3.9) is the fourth. */
    const st = makeState();
    const deps = liveUiEntryDeps(st);
    expect(deps.timedObjectFlags, "timedObjectFlags present").toBeDefined();
    expect(deps.timedElementEffect, "timedElementEffect present").toBeDefined();
    expect(deps.playerHas, "playerHas present").toBeDefined();
    expect("launcher" in deps, "launcher present (3.9)").toBe(true);
    /* Every optional key of UiEntryDeps must appear above. */
    expect(Object.keys(deps).sort()).toEqual([
      "launcher",
      "playerHas",
      "timedElementEffect",
      "timedObjectFlags",
    ]);
  });
});

/**
 * PORT_TODO 3.9: the PF_FAST_SHOT contribution was a hardcoded 0.
 *
 * The item's own wording was the tell - "the reach it calls deferred EXISTS".
 * `player/calcs.ts` had been reading the equipped launcher's kind flags for the
 * ammo tval all along; the ui-entry push just had no route to the object. The
 * route is three lines of body-slot walk, now shared as
 * `obj/knowledge.ts equippedLauncher`.
 */
describe("PF_FAST_SHOT reads the equipped launcher (ui-entry.c L974-984)", () => {
  const objPack = JSON.parse(
    readFileSync(new URL("../../../content/pack/object.json", import.meta.url), "utf8"),
  ) as { records: { name: string; tval: string }[] };

  /** Equip `kindName` in the BOW slot and return the FAST_SHOT entry's value. */
  function fastShotValue(kindName: string | null, lev: number): number {
    const st = makeState();
    const p = st.actor.player;
    p.lev = lev;

    /* PF_FAST_SHOT has to be present, or the `playerHas` guard skips the branch
     * entirely and every arm of this test reads the same 0. */
    const flags = new FlagSet(PF_SIZE);
    flags.on(PF.FAST_SHOT);
    (st as unknown as { playerState?: { pflags: FlagSet } }).playerState = {
      pflags: flags,
    };

    const bowSlot = p.body.slots.findIndex((s) => s?.type === "BOW");
    expect(bowSlot, "fixture: the body has a shooting slot").toBeGreaterThanOrEqual(0);

    if (kindName !== null) {
      const kind = objReg.kinds.find((k) => k.name === kindName);
      expect(kind, `fixture: kind ${kindName} exists`).toBeDefined();
      const obj = objectPrep(new Rng(7), objReg, objConstants, kind!, 0, "average");
      const handle = st.gear.next++;
      st.gear.store.set(handle, obj);
      p.equipment[bowSlot] = handle;
    }

    const entry = config.entries.find((e) => e.name === "shots_ui_compact_0");
    expect(entry, "fixture: the shots entry is in the pack").toBeDefined();
    const deps = resolveUiDeps(p, liveUiEntryDeps(st));
    return computePlayerValues(entry!, p, deps, { untimed: new FlagSet(OF_SIZE) }).val;
  }

  /* Ground truth from the pack, not from memory: the point of the KF check is
   * that some launchers fire arrows and some do not, and the test is worthless if
   * both fixtures happen to be the same kind of bow. */
  it("the pack really does have both an arrow-firer and a non-arrow-firer", () => {
    const arrow = objReg.kinds.filter((k) => k.kindFlags.has(KF.SHOOTS_ARROWS));
    const other = objReg.kinds.filter(
      (k) => k.tval === TV.BOW && !k.kindFlags.has(KF.SHOOTS_ARROWS),
    );
    expect(arrow.length, "at least one KF_SHOOTS_ARROWS launcher").toBeGreaterThan(0);
    expect(other.length, "at least one bow that fires something else").toBeGreaterThan(0);
    void objPack;
  });

  it("an arrow-firing launcher contributes p->lev / 3", () => {
    const bow = objReg.kinds.find((k) => k.kindFlags.has(KF.SHOOTS_ARROWS));
    expect(fastShotValue(bow!.name, 30), "30 / 3").toBe(10);
    /* Integer division, not rounding: 29 / 3 is 9, not 10 (L979 is C `/`). */
    expect(fastShotValue(bow!.name, 29), "truncated, not rounded").toBe(9);
  });

  it("a launcher that does not fire arrows contributes 0", () => {
    const sling = objReg.kinds.find(
      (k) => k.tval === TV.BOW && !k.kindFlags.has(KF.SHOOTS_ARROWS),
    );
    expect(fastShotValue(sling!.name, 30)).toBe(0);
  });

  it("an empty shooting slot contributes 0", () => {
    expect(fastShotValue(null, 30)).toBe(0);
  });
});

/**
 * PORT_TODO 3.25: a category can carry a priority of its own.
 *
 * parse_entry_priority (ui-entry.c:2173) branches on `last_category_index`: a
 * priority before any category is the record's default, one after a category
 * overrides that category's, and finish_parse (:2389) fills only the categories
 * with no `priority_set`. The compiler used to flatten `priority` to a record
 * scalar, so the second form could not survive compilation and the fill here
 * could overwrite unconditionally without anyone noticing.
 *
 * CONSTRUCTED records, not the shipped pack: measured, ui_entry.txt and
 * ui_entry_base.txt contain ZERO priority-after-category lines, so nothing in
 * the shipped data can tell the two behaviours apart.
 */
describe("per-category priority overrides (ui-entry.c:2211-2221, :2389)", () => {
  const build = (uiEntry: unknown[]) =>
    buildUiEntryConfig({
      uiEntry: uiEntry as never,
      uiEntryBase: [] as never,
      uiEntryRenderer: load("ui_entry_renderer") as never,
      objectProperty: load("object_property") as never,
      playerProperty: load("player_property") as never,
    });

  const catsOf = (cfg: UiEntryConfig, name: string) =>
    new Map((cfg.entries.find((e) => e.name === name)?.categories ?? []).map((c) => [c.name, c.priority]));

  it("a category with its own priority keeps it; the others take the default", () => {
    const cfg = build([
      {
        name: "row",
        renderer: "char_screen1_flag_renderer",
        priority: "3",
        category: [{ category: "alpha", priority: "9" }, { category: "beta" }],
      },
    ]);
    const cats = catsOf(cfg, "row");
    expect(cats.get("alpha")).toBe(9);
    expect(cats.get("beta")).toBe(3);
  });

  it("finish_parse does not overwrite an explicit one with a LATER default", () => {
    /* The default is set by the record's own leading priority line, which the
     * fill loop applies afterwards - so "9 survives 3" is only true because of
     * the priority_set test. Without it the fill flattens both to 3. */
    const cfg = build([
      {
        name: "row",
        renderer: "char_screen1_flag_renderer",
        category: [{ category: "alpha", priority: "9" }],
        priority: "3",
      },
    ]);
    expect(catsOf(cfg, "row").get("alpha")).toBe(9);
  });

  it("still reads the older compiled shape, a bare category name", () => {
    /* A mod's pack built before this compiler change must not be a crash. */
    const cfg = build([
      {
        name: "row",
        renderer: "char_screen1_flag_renderer",
        priority: "4",
        category: ["alpha", "beta"],
      },
    ]);
    const cats = catsOf(cfg, "row");
    expect(cats.get("alpha")).toBe(4);
    expect(cats.get("beta")).toBe(4);
  });

  it("a per-category priority scheme name resolves like a default one", () => {
    /* priority_schemes[] is consulted for both forms (:2186-2209).
     *
     * The record needs a NON-ZERO default for this to be a real claim: with the
     * scheme ignored, parseInt("negative_index") is NaN and the code falls back
     * to the default, so a record whose default is 0 gives 0 either way. That
     * version of this test let "the scheme is never resolved" survive. */
    const cfg = build([
      {
        name: "row",
        renderer: "char_screen1_flag_renderer",
        priority: "5",
        category: [{ category: "alpha", priority: "negative_index" }],
      },
    ]);
    expect(catsOf(cfg, "row").get("alpha")).toBe(0); // index 0, negated - not 5
  });
});
