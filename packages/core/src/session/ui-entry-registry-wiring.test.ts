/**
 * The ui-entry combiner and renderer-backend registries have a PRODUCER, and it
 * is the live game.
 *
 * WHAT THIS EXISTS TO CATCH. `COMBINERS` was a nine-entry module const and
 * `applyRenderer` six hard-coded `if (backend === UI_ENTRY_RENDERER.X)` arms.
 * #271 changed only the FAILURE MODE - an unknown `combine:` yields
 * ABSENT_COMBINER instead of throwing - and MOD_REACH row 18 was careful to say
 * so: survival is not reach. The failure this file is aimed at is the NEXT one,
 * the one the projection family already made once: a table converted to a
 * registry, documented as reachable, and written by nobody, because the engine
 * kept dispatching through the compiled-in copy.
 *
 * So this file does not read the wiring. It starts a REAL game, installs a
 * combiner and a backend the way a mod does - through the capability-gated
 * facade, over `state.uiEntry`, AFTER the game is wired, because that is when a
 * plugin's register() runs - then renders a REAL character grid and a REAL
 * equip comparison and looks at the CELL that came out.
 *
 * EVERY SUBJECT HAS TWO CONTROLS, because "the mod's combiner ran" is only worth
 * something if it had two ways to be false. Control A is core's own combiner on
 * the shipped pack; control B is the same modified pack with NOTHING registered,
 * which is the ABSENT_COMBINER row. A cell that matched either would not be
 * evidence, and the assertions say so directly rather than trusting that the
 * three differ.
 *
 * And a test that asserted the name appears in `names()` would be the exact
 * false green the projection producer gap already taught: the field was there,
 * typed, documented and consumed, and the table nothing wrote won every time.
 * Nothing below asserts membership as a substitute for dispatch.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { startGame } from "./game.js";
import type { GamePack, StartedGame } from "./game.js";
import type { GameState } from "../game/context.js";
import {
  buildUiEntryConfig,
  characterGrid,
  combinerLookup,
  coreUiEntryBackends,
  coreUiEntryCombiners,
  liveUiEntryDeps,
} from "../game/ui-entry.js";
import type {
  CombinerFuncs,
  UiEntryCell,
  UiEntryPackRecords,
} from "../game/ui-entry.js";
import { UiEntryRegistry } from "../game/ui-entry-registry.js";
import type { UiEntryBackend } from "../game/ui-entry-registry.js";
import { equipCmpSummary } from "../game/equip-cmp.js";
import { createModRegistryHost } from "../mod/registry-host.js";
import type { ModRegistryHost } from "../mod/registry-host.js";
import { AgentCapabilityError } from "../agent/types.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../../content/pack/${name}.json`, import.meta.url), "utf8"),
  ) as T;
}
function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

const pack: GamePack = {
  constants: loadJson("constants"),
  terrain: loadRecords("terrain"),
  roomTemplates: loadRecords("room_template"),
  vaults: loadRecords("vault"),
  dungeonProfiles: loadRecords("dungeon_profile"),
  projection: loadRecords("projection"),
  trap: loadRecords("trap"),
  names: loadRecords("names"),
  quest: loadRecords("quest"),
  store: loadRecords("store"),
  obj: {
    objectBase: loadJson("object_base"),
    object: loadJson("object"),
    egoItem: loadJson("ego_item"),
    artifact: loadJson("artifact"),
    curse: loadJson("curse"),
    brand: loadJson("brand"),
    slay: loadJson("slay"),
    activation: loadJson("activation"),
    objectProperty: loadJson("object_property"),
    flavor: loadJson("flavor"),
  } as GamePack["obj"],
  mon: {
    pain: loadRecords("pain"),
    blowMethods: loadRecords("blow_methods"),
    blowEffects: loadRecords("blow_effects"),
    monsterSpells: loadRecords("monster_spell"),
    monsterBases: loadRecords("monster_base"),
    monsters: loadRecords("monster"),
    summons: loadRecords("summon"),
    pits: loadRecords("pit"),
  },
  player: {
    races: loadRecords("p_race"),
    classes: loadRecords("class"),
    properties: loadRecords("player_property"),
    timed: loadRecords("player_timed"),
    shapes: loadRecords("shape"),
    bodies: loadRecords("body"),
    history: loadRecords("history"),
    realms: loadRecords("realm"),
  },
};

interface Started {
  game: StartedGame;
  state: GameState;
  /** The capability-gated facade, built exactly as the web host builds it. */
  host: ModRegistryHost;
}

function started(seed: number): Started {
  const game = startGame(pack, { seed, depth: 2, className: "Warrior" });
  return {
    game,
    state: game.state,
    host: createModRegistryHost({ uiEntry: game.state.uiEntry ?? null }),
  };
}

/* ------------------------------------------------------------------ */
/* Pack fixtures                                                       */
/* ------------------------------------------------------------------ */

/** The name of the ACID resist row, which every case below reads. */
const ACID_ROW = "resist_ui_compact_0<ACID>";

/** The generic resist template each `resist_ui_compact_0<X>` specialises. */
const RESIST_TEMPLATE = "resist_ui_compact_0";

/**
 * A FRESH pack-records object each time. `buildUiEntryConfig` memoises on
 * (records, registry) and both halves are object identities, so a shared
 * fixture would hand one case another case's config.
 */
function packRecords(over: {
  combine?: string;
  rendererCode?: string;
} = {}): UiEntryPackRecords {
  const uiEntry = loadRecords<Record<string, unknown>>("ui_entry").map((r) =>
    r["name"] === RESIST_TEMPLATE && over.combine !== undefined
      ? { ...r, combine: over.combine }
      : { ...r },
  );
  const uiEntryRenderer = loadRecords<Record<string, unknown>>("ui_entry_renderer").map((r) =>
    r["name"] === "char_screen1_resist_renderer" && over.rendererCode !== undefined
      ? { ...r, code: over.rendererCode }
      : { ...r },
  );
  return {
    uiEntry: uiEntry as never,
    uiEntryBase: loadRecords("ui_entry_base") as never,
    uiEntryRenderer: uiEntryRenderer as never,
    objectProperty: loadRecords("object_property") as never,
    playerProperty: loadRecords("player_property") as never,
  };
}

/** The ACID row of a rendered character grid: the row a mod's combiner moves. */
function acidRow(state: GameState, packs: UiEntryPackRecords): {
  cells: UiEntryCell[];
  labelColor: number;
} {
  const grid = characterGrid(
    state,
    buildUiEntryConfig(packs, state.uiEntry),
    liveUiEntryDeps(state),
  );
  const panel = grid.resistPanels.find((p) => p.key === "resistances");
  expect(panel, "the grid should have a resistances panel").toBeTruthy();
  const row = panel!.rows.find((r) => r.name === ACID_ROW);
  expect(row, `the resistances panel should carry ${ACID_ROW}`).toBeTruthy();
  return { cells: row!.cells, labelColor: row!.labelColor };
}

/** The PLAYER column - the last cell, after one per body slot. */
function playerCell(state: GameState, packs: UiEntryPackRecords): UiEntryCell {
  const { cells } = acidRow(state, packs);
  expect(cells.length).toBe(state.actor.player.body.count + 1);
  return cells[cells.length - 1]!;
}

/**
 * A combiner that reports total immunity whatever it is fed. Distinctive on
 * purpose: `convertVanillaResLevel` maps >= 3 to the immunity row, which is the
 * '*' symbol in the shipped resist palette and nothing core produces for a
 * Warrior with no acid resistance.
 */
const IMMUNE_TO_EVERYTHING: CombinerFuncs = {
  init(_v, _a, st) {
    st.work = null;
    st.accum = 3;
    st.accumAux = 0;
  },
  accum(_v, _a, st) {
    st.accum = 3;
    st.accumAux = 0;
  },
  finish(st) {
    st.accum = 3;
    st.accumAux = 0;
  },
  vec() {
    return { accum: 3, accumAux: 0 };
  },
};

/** A backend that paints every cell the same, unmistakable way. */
const HASH_BACKEND: UiEntryBackend = {
  render: (_renderer, vals) => ({
    cells: vals.map(() => ({ symbol: "#", color: 9 })),
    labelColor: 9,
    labelColorIndex: 0,
  }),
  defaults: {
    defaultCombinerName: "LOGICAL_OR",
    defaultColors: "wwww",
    defaultLabelColors: "wwww",
    defaultSymbols: "####",
    defaultNDigit: 1,
    defaultSign: "NO_SIGN",
  },
};

/* ------------------------------------------------------------------ */

describe("wireGame publishes the ui-entry registry", () => {
  it("seeds it with core's nine combiners and six backends, and copies both", () => {
    const s = started(7001);
    const reg = s.state.uiEntry;
    expect(reg).toBeInstanceOf(UiEntryRegistry);
    expect(reg!.combiners.names()).toEqual([...coreUiEntryCombiners().keys()]);
    expect(reg!.backends.names()).toEqual([...coreUiEntryBackends().keys()]);

    /* A COPY, not the module tables. Mutating core's own maps would carry one
     * character's mod into every game in the process. */
    const combinersBefore = coreUiEntryCombiners().size;
    const backendsBefore = coreUiEntryBackends().size;
    reg!.combiners.set("leak-check", IMMUNE_TO_EVERYTHING);
    reg!.backends.set("leak-check", HASH_BACKEND);
    expect(coreUiEntryCombiners().size).toBe(combinersBefore);
    expect(coreUiEntryBackends().size).toBe(backendsBefore);

    /* And two games do not share one. */
    const other = started(7002);
    expect(other.state.uiEntry).not.toBe(reg);
    expect(other.state.uiEntry!.combiners.has("leak-check")).toBe(false);
    expect(other.state.uiEntry!.backends.has("leak-check")).toBe(false);
  });

  it("does not make a registered combiner reachable through the SLOT", () => {
    /* `combinerLookup` is upstream's ui_entry_combiner_lookup and answers about
     * core's compiled table only. It reporting 0 for a registered name is the
     * point, not a gap: the slot stopped being the key, and a registry that
     * kept handing out slots would have frozen core's table at nine. */
    const s = started(7003);
    s.host.uiEntry.combiners.set("t283:immune", IMMUNE_TO_EVERYTHING);
    expect(combinerLookup("t283:immune")).toBe(0);
    expect(s.state.uiEntry!.combiners.has("t283:immune")).toBe(true);
  });
});

describe("a combiner installed after the game is wired reaches the character sheet", () => {
  it("CONTROL A: core's RESIST_0 draws the shipped ACID cell", () => {
    const s = started(7101);
    const cell = playerCell(s.state, packRecords());
    /* A starting Warrior has no acid resistance, so RESIST_0 combines to 0 and
     * the cell is the "nothing here" dot rather than a resist mark. Stated as a
     * fact about the CELL, so that a change to the row's meaning fails here
     * first rather than silently making the subject test tautological. */
    expect(cell.symbol).toBe(".");
  });

  it("CONTROL B: the same pack with NOTHING registered is the ABSENT row", () => {
    const s = started(7102);
    const cell = playerCell(s.state, packRecords({ combine: "t283:immune" }));
    /* ABSENT_COMBINER: every route NOT_PRESENT. The screen still draws - #271's
     * guarantee, which opening the table must not take away. */
    expect(cell.symbol).toBe(".");
  });

  it("SUBJECT: the mod's combiner changes the cell the player sees", () => {
    const s = started(7103);
    const packs = packRecords({ combine: "t283:immune" });

    /* Registered the way a mod does: through the capability-gated facade, over
     * the live registry, after wireGame. */
    s.host.uiEntry.combiners.set("t283:immune", IMMUNE_TO_EVERYTHING);

    const { cells } = acidRow(s.state, packs);
    const cell = cells[cells.length - 1]!;
    expect(cell.symbol).toBe("*");

    /* Discriminating in both directions, against the two controls RE-RUN here
     * rather than against a remembered constant. Note that the two controls
     * agree with each other: for a Warrior with no acid resistance, "combined
     * to nothing" and "no combiner at all" both draw the dot, which is exactly
     * why a test that compared the subject against only one of them would have
     * proved nothing about the other. */
    const core = started(7104);
    const absent = started(7105);
    const coreCell = playerCell(core.state, packRecords());
    const absentCell = playerCell(absent.state, packRecords({ combine: "t283:immune" }));
    expect(coreCell.symbol).toBe(absentCell.symbol);
    expect(cell.symbol).not.toBe(coreCell.symbol);
    expect(cell.symbol).not.toBe(absentCell.symbol);

    /* Every OTHER row is untouched: the registration reached one name, not the
     * screen. A combiner that replaced the dispatch wholesale would pass every
     * assertion above and fail this one. */
    const flags = characterGrid(
      s.state,
      buildUiEntryConfig(packs, s.state.uiEntry),
      liveUiEntryDeps(s.state),
    ).resistPanels.find((p) => p.key === "abilities");
    expect(flags!.rows.length).toBeGreaterThan(0);
    expect(flags!.rows.some((r) => r.cells.some((c) => c.symbol === "*"))).toBe(false);
  });

  it("ORDERING: registering AFTER the config was built still takes effect", () => {
    /* The failure row 21 made: correct-looking code that runs after the read
     * point and works for nobody. The combiner is resolved by NAME at the
     * moment the row is computed, so a config built first is not a snapshot. */
    const s = started(7106);
    const packs = packRecords({ combine: "t283:immune" });

    const before = playerCell(s.state, packs);
    expect(before.symbol).toBe(".");

    s.host.uiEntry.combiners.set("t283:immune", IMMUNE_TO_EVERYTHING);

    const after = playerCell(s.state, packs);
    expect(after.symbol).toBe("*");
  });

  it("reaches the OTHER consumer too: the equip-comparison screen", () => {
    /* Two production consumers read these tables. A seam wired into one of them
     * is the split-seam failure - the wired half looks like proof and the other
     * half is silent. */
    const s = started(7107);
    const packs = packRecords({ combine: "t283:immune" });
    const columnOf = (model: { columns: { key: string }[] }): number => {
      const i = model.columns.findIndex((c) => c.key === ACID_ROW);
      expect(i, `equip-cmp should carry an ${ACID_ROW} column`).toBeGreaterThan(-1);
      return i;
    };

    const absent = equipCmpSummary(s.state, packs);
    const absentCell = absent.combinedCells[columnOf(absent)]!;

    s.host.uiEntry.combiners.set("t283:immune", IMMUNE_TO_EVERYTHING);
    const withMod = equipCmpSummary(s.state, packs);
    const modCell = withMod.combinedCells[columnOf(withMod)]!;

    expect(modCell.symbol).toBe("*");
    expect(modCell.symbol).not.toBe(absentCell.symbol);
  });

  it("one mod extends another mod's combiner", () => {
    const s = started(7108);
    const packs = packRecords({ combine: "t283:immune" });
    const order: string[] = [];

    /* Mod A. */
    s.host.uiEntry.combiners.set("t283:immune", {
      init(v, a, st) {
        order.push("A");
        IMMUNE_TO_EVERYTHING.init(v, a, st);
      },
      accum: IMMUNE_TO_EVERYTHING.accum,
      finish: IMMUNE_TO_EVERYTHING.finish,
      vec: IMMUNE_TO_EVERYTHING.vec,
    });

    /* Mod B, loaded later, knowing nothing about A: it takes whatever is there
     * and calls through. This is why the facade is keyed per NAME - a mod
     * handing over a whole table would discard A's work with no error. */
    const previous = s.host.uiEntry.combiners.handlerFor("t283:immune");
    expect(previous).toBeTruthy();
    s.host.uiEntry.combiners.set("t283:immune", {
      init(v, a, st) {
        order.push("B-before");
        previous!.init(v, a, st);
        order.push("B-after");
      },
      accum: previous!.accum,
      finish: previous!.finish,
      vec: previous!.vec,
    });

    const cell = playerCell(s.state, packs);
    expect(cell.symbol).toBe("*");
    expect(order.slice(0, 3)).toEqual(["B-before", "A", "B-after"]);
  });
});

describe("a renderer backend installed after the game is wired draws the row", () => {
  it("CONTROL: an unregistered backend name is the empty-cell row (#271)", () => {
    const s = started(7201);
    const { cells } = acidRow(s.state, packRecords({ rendererCode: "t283:hash" }));
    expect(cells).toEqual([]);
  });

  it("SUBJECT: the mod's backend supplies every cell of the row", () => {
    const s = started(7202);
    s.host.uiEntry.backends.set("t283:hash", HASH_BACKEND);
    const { cells } = acidRow(s.state, packRecords({ rendererCode: "t283:hash" }));
    expect(cells.length).toBe(s.state.actor.player.body.count + 1);
    expect(cells.every((c) => c.symbol === "#")).toBe(true);
    /* Not what core's resist backend draws, for the same row. */
    const core = started(7203);
    expect(acidRow(core.state, packRecords()).cells.some((c) => c.symbol === "#")).toBe(false);
  });

  it("ORDERING: the render lookup is live even when the config predates it", () => {
    /* `buildUiEntryConfig` reads the backend table once, for the palette
     * DEFAULTS a renderer record inherits. The algorithm is not baked in, so a
     * backend registered after a config was built still draws. */
    const s = started(7204);
    const packs = packRecords({ rendererCode: "t283:hash" });
    expect(acidRow(s.state, packs).cells).toEqual([]);
    s.host.uiEntry.backends.set("t283:hash", HASH_BACKEND);
    expect(acidRow(s.state, packs).cells.every((c) => c.symbol === "#")).toBe(true);
  });

  it("a mod can wrap CORE's backend rather than replace it", () => {
    const s = started(7205);
    const core = s.host.uiEntry.backends.handlerFor(
      "COMPACT_RESIST_RENDERER_WITH_COMBINED_AUX",
    );
    expect(core).toBeTruthy();
    s.host.uiEntry.backends.set("COMPACT_RESIST_RENDERER_WITH_COMBINED_AUX", {
      defaults: core!.defaults,
      render: (renderer, vals, auxvals, details, combiner) => {
        const row = core!.render(renderer, vals, auxvals, details, combiner);
        return { ...row, cells: row.cells.map((c) => ({ ...c, symbol: `<${c.symbol}>` })) };
      },
    });
    const { cells } = acidRow(s.state, packRecords());
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.every((c) => c.symbol.startsWith("<") && c.symbol.endsWith(">"))).toBe(true);
  });
});

describe("the ui-entry facade is gated and target-checked", () => {
  it("refuses without registry:ui-entry, on every method", () => {
    const s = started(7301);
    const gated = createModRegistryHost(
      { uiEntry: s.state.uiEntry ?? null },
      { has: (c: string) => c === "registry:effect" },
    );
    for (const call of [
      (): void => {
        gated.uiEntry.combiners.set("t283:immune", IMMUNE_TO_EVERYTHING);
      },
      (): void => void gated.uiEntry.combiners.handlerFor("ADD"),
      (): void => void gated.uiEntry.combiners.has("ADD"),
      (): void => void gated.uiEntry.combiners.names(),
      (): void => {
        gated.uiEntry.backends.set("t283:hash", HASH_BACKEND);
      },
      (): void => void gated.uiEntry.backends.names(),
    ]) {
      expect(call).toThrow(AgentCapabilityError);
      expect(call).toThrow(/registry:ui-entry/);
    }
    /* And nothing was installed on the way to the throw. */
    expect(s.state.uiEntry!.combiners.has("t283:immune")).toBe(false);
    expect(s.state.uiEntry!.backends.has("t283:hash")).toBe(false);
  });

  it("says so when the host wired no ui-entry registry at all", () => {
    const host = createModRegistryHost({ uiEntry: null });
    expect(() => {
      host.uiEntry.combiners.set("ADD", IMMUNE_TO_EVERYTHING);
    }).toThrow(/host did not wire it/);
  });
});
