/**
 * #271: an unknown combiner name must not take the session down.
 *
 * `combine:` used to be resolved by name against a 9-entry table (`COMBINERS`)
 * at PARSE time, and an unknown name resolved to 0, silently. Nothing threw
 * while the pack loaded. The throw came later, from `combinerFuncs`, on the
 * first VALUE or RENDER use: the character sheet ('C') and the equip-comparison
 * screen. So a typo in one `combine:` line of a mod's ui_entry record loaded
 * clean and then killed a live player path, far from its cause.
 *
 * Upstream is not a defence here: ui_entry_combiner_get_funcs
 * (ui-entry-combiner.c L111-120) also returns 0, and its callers `assert(0)`
 * (ui-entry.c L694-696, L892-894) - which under NDEBUG is undefined behaviour,
 * not a diagnostic. The port had converted that into an unconditional throw,
 * which is strictly worse for a player. It now resolves to an absent combiner
 * whose every route reports UI_ENTRY_VALUE_NOT_PRESENT, the same answer the
 * projection bind settled on for an unknown code (world/projection.ts).
 *
 * These tests are about SURVIVAL, and they still are after #283 opened the
 * table: a name is now resolved against a LIVE registry rather than a frozen
 * array, and a name nothing answers for - because no mod registered it, or
 * because it is a typo - must still yield ABSENT_COMBINER and a drawable row
 * rather than a crash. Opening a table is not licence to make a typo fatal
 * again. What a mod CAN now do is the subject of ui-entry-registry.test.ts.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { makeState } from "./harness.js";
import {
  applyRenderer,
  buildUiEntryConfig,
  characterGrid,
  combineEntryValues,
  combineValues,
  combinerLookup,
  UI_ENTRY_VALUE_NOT_PRESENT,
} from "./ui-entry.js";
import type { UiEntryConfig } from "./ui-entry.js";

function load(name: string): unknown[] {
  const url = new URL(`../../../content/pack/${name}.json`, import.meta.url);
  return (JSON.parse(readFileSync(url, "utf8")) as { records: unknown[] }).records;
}

/** The shipped records with every `combine:` replaced by a name nothing knows. */
function withBrokenCombiner(records: unknown[]): unknown[] {
  return records.map((r) => ({ ...(r as Record<string, unknown>), combine: "NOPE" }));
}

const brokenConfig: UiEntryConfig = buildUiEntryConfig({
  uiEntry: withBrokenCombiner(load("ui_entry")) as never,
  uiEntryBase: withBrokenCombiner(load("ui_entry_base")) as never,
  uiEntryRenderer: load("ui_entry_renderer") as never,
  objectProperty: load("object_property") as never,
  playerProperty: load("player_property") as never,
});

describe("an unknown combiner name is survivable (#271)", () => {
  it("combinerLookup still reports a name outside core's nine as 0", () => {
    /* The lookup's contract is unchanged - it is the CONSEQUENCE that changed.
       Without this, a lookup that silently started returning 1 would make every
       other test here pass for the wrong reason. It reports CORE's slot and
       nothing else, which is why a registered combiner still reads 0 here (see
       ui-entry-registry.test.ts) - the slot is not the key any more. */
    expect(combinerLookup("NOPE")).toBe(0);
    expect(combinerLookup("ADD")).toBeGreaterThan(0);
  });

  it("combineValues returns NOT_PRESENT for an unknown combiner instead of throwing", () => {
    expect(() => combineValues("NOPE", [1, 2, 3], [0, 0, 0])).not.toThrow();
    expect(combineValues("NOPE", [1, 2, 3], [0, 0, 0])).toEqual({
      accum: UI_ENTRY_VALUE_NOT_PRESENT,
      accumAux: UI_ENTRY_VALUE_NOT_PRESENT,
    });
    /* A known name is untouched by the fallback. */
    expect(combineValues("ADD", [1, 2, 3], [0, 0, 0]).accum).toBe(6);
  });

  it("a pack whose entries name an unknown combiner still builds, storing the NAME", () => {
    /* The name is kept verbatim rather than resolved away at parse - that is
       what lets a combiner registered after the config was built still win.
       Before #283 this asserted `combinerIndex === 0`, which was the same fact
       recorded as a slot that could never come back. */
    expect(brokenConfig.entries.length).toBeGreaterThan(0);
    expect(brokenConfig.entries.every((e) => e.combinerName === "NOPE")).toBe(true);
  });

  it("characterGrid renders every panel with no combiner resolved", () => {
    const st = makeState();
    const grid = characterGrid(st, brokenConfig);
    const resist = grid.resistPanels.find((p) => p.key === "resistances");
    expect(resist?.rows.length).toBeGreaterThan(0);
    /* Rows are real rows: labelled, one cell per body slot plus the player. */
    for (const panel of grid.resistPanels) {
      for (const row of panel.rows) {
        expect(row.cells.length).toBe(st.actor.player.body.count + 1);
        expect(typeof row.labelColor).toBe("number");
      }
    }
    expect(grid.statModPanel.rows.length).toBeGreaterThan(0);
  });

  it("combineEntryValues returns NOT_PRESENT for such an entry instead of throwing", () => {
    const entry = brokenConfig.entries.find((e) => e.name === "resist_ui_compact_0<ACID>");
    expect(entry).toBeDefined();
    expect(combineEntryValues(entry!, [1, 0, 1], [0, 0, 0])).toEqual({
      accum: UI_ENTRY_VALUE_NOT_PRESENT,
      accumAux: UI_ENTRY_VALUE_NOT_PRESENT,
    });
  });

  it("a RENDERER whose combiner never resolved renders instead of throwing", () => {
    /* The renderer path has its own escape: an unresolvable `combine:` falls
       back to the backend's default combiner - but only if the BACKEND
       resolved. A renderer naming an unknown `code` as well resolves neither,
       all the way into applyRenderer, which is the second way this used to
       throw. */
    const cfg = buildUiEntryConfig({
      uiEntry: [{ name: "row", renderer: "broken" }] as never,
      uiEntryBase: [] as never,
      uiEntryRenderer: [{ name: "broken", code: "NO_SUCH_RENDERER", combine: "NOPE" }] as never,
      objectProperty: load("object_property") as never,
      playerProperty: load("player_property") as never,
    });
    const renderer = cfg.renderers.find((r) => r.name === "broken");
    expect(renderer).toBeDefined();
    expect(renderer!.combinerName).toBe("NOPE");
    expect(renderer!.backendName).toBe("NO_SUCH_RENDERER");
    const row = applyRenderer(renderer!, [1, 0], [0, 0], {
      knownRune: true,
      alternateColorFirst: false,
    });
    /* No backend answers for that name either, so this is the silent
       fallthrough: no cells, default label colour. A blank row, not a crash. */
    expect(row.cells).toEqual([]);
    expect(row.labelColorIndex).toBe(0);
  });
});
