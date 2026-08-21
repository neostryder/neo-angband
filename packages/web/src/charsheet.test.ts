/**
 * Gap #58: the faithful wide character sheet (display_player mode 0/1,
 * ui-player.c) and the narrow characterSheetLines list. Verifies against the
 * upstream column contract: stat table at col 42 with "  Self" (WIDTH 6, the
 * classic 5-wide header misalignment fixed) / RB / CB / EB / "  Best"
 * headers, "STR!" (colon REPLACED by the natural-max flag, L480-481),
 * per-column colours (Self/Best L_GREEN, RB/CB/EB L_BLUE, drained YELLOW,
 * L469-507), misc panel at x=21 (panels[] L852), history from row 19
 * (display_player_xtra_info), do_cmd_change_name key cycling (L1280-1289),
 * and RNG invariance (a pure display: zero draws).
 */

import { readFileSync } from "node:fs";
import { describe, expect, it, afterEach } from "vitest";
import { initLaunchArgs, resetLaunchArgs } from "./launch";
import {
  loc,
  Rng,
  Chunk,
  FeatureRegistry,
  bindPlayer,
  blankPlayer,
  newGear,
  newKnownMap,
  newTargetState,
  IgnoreSettings,
  makeRuneEnv,
  DEFAULT_GAME_CONSTANTS,
  placePlayer,
  colorToCss,
  COLOUR_L_GREEN,
  COLOUR_L_BLUE,
  COLOUR_YELLOW,
} from "@rpgm-tools/neo-angband-core";
import type {
  GameState,
  Loc,
  PlayerPackRecords,
  TerrainRecordJson,
} from "@rpgm-tools/neo-angband-core";
import {
  showCharacterSheet,
  characterFlagsScreen,
  CHARSHEET_PROMPT_LABELS,
  MODE_VIEW_IDS,
  buildCharacterDump,
} from "./charsheet";
import {
  characterScreen,
  characterSheetLines,
  historyBlockLines,
  screenPromptFor,
  statHeaderLine,
  statRowLine,
  CHARACTER_ACTIONS,
  SCREEN_PROMPTS,
} from "./screens";
import { setScreenPresenter } from "./screen-runtime";
import { promptRequest, type PromptRequest } from "./prompt-view";
import { setUiFaultReporter, SCREEN_REGION_ID } from "./overlay";
import { liveRegionStack, resetRegionStack } from "./ui-stack";
import {
  MODELLED_SCREENS,
  type ScreenHost,
  type ScreenShown,
  type ScreenTableBlock,
  type ScreenTextBlock,
  type ScreenView,
} from "./screen-view";
import { buildUiEntryConfig } from "@rpgm-tools/neo-angband-core";
import type { GlyphTerm } from "./term";

/* ------------------------------------------------------------------ */
/* Fixtures: a real GameState from the shipped pack (screens.test.ts   */
/* pattern), plus a colour-recording fake term and a fake window.      */
/* ------------------------------------------------------------------ */

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../content/pack/${name}.json`, import.meta.url), "utf8"),
  ) as T;
}
function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

const featureReg = new FeatureRegistry(loadRecords<TerrainRecordJson>("terrain"));
const FLOOR = featureReg.byCodeName("FLOOR").fidx;
const GRANITE = featureReg.byCodeName("GRANITE").fidx;

/** The ui_entry pack records that drive the mode-1 grid (loadUiEntryPacks). */
const uiEntryPacks = {
  uiEntry: loadRecords("ui_entry"),
  uiEntryBase: loadRecords("ui_entry_base"),
  uiEntryRenderer: loadRecords("ui_entry_renderer"),
  objectProperty: loadRecords("object_property"),
  playerProperty: loadRecords("player_property"),
} as unknown as import("@rpgm-tools/neo-angband-core").UiEntryPackRecords;

const players = bindPlayer({
  races: loadRecords("p_race"),
  classes: loadRecords("class"),
  properties: loadRecords("player_property"),
  timed: loadRecords("player_timed"),
  shapes: loadRecords("shape"),
  bodies: loadRecords("body"),
  history: loadRecords("history"),
  realms: loadRecords("realm"),
} as PlayerPackRecords);

function makeTestState(playerGrid: Loc): GameState {
  const w = 10;
  const h = 10;
  const chunk = new Chunk(featureReg, h, w);
  chunk.fill(GRANITE);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) chunk.setFeat(loc(x, y), FLOOR);
  }
  const player = blankPlayer(players.races[0]!, players.classes[0]!, players.bodies[0]!);
  const gear = newGear();
  const rng = new Rng(1);
  const actor = {
    player,
    grid: playerGrid,
    energy: 0,
    speed: 110,
    totalEnergy: 0,
    combat: {
      toH: 0, toD: 0, ac: 0, toA: 0, skills: [],
      numBlows: 100, ammoMult: 1, numShots: 0, ammoTval: 0, blessWield: false,
    },
    /* p->known_state. A separate object, not a second reference to `combat`:
     * the sheet reads THIS one for ac / to_a / to_h / to_d, and sharing would
     * make a test that means to move only the real state move both. */
    knownCombat: {
      toH: 0, toD: 0, ac: 0, toA: 0, skills: [],
      numBlows: 100, ammoMult: 1, numShots: 0, ammoTval: 0, blessWield: false,
    },
    defense: { ac: 0, toA: 0 },
    weapon: null,
    stealth: 0,
    light: 0,
    unlight: false,
  };
  const state = {
    rng,
    chunk,
    actor,
    gear,
    monsters: [null],
    groups: [null],
    floor: new Map(),
    traps: new Map(),
    known: newKnownMap(w, h),
    target: newTargetState(),
    ignore: new IgnoreSettings(),
    lore: new Map(),
    turn: 0,
    z: { ...DEFAULT_GAME_CONSTANTS },
    brands: [null],
    slays: [null],
    runeEnv: makeRuneEnv(
      (slot: number) => gear.store.get(player.equipment[slot] ?? 0) ?? null,
      (v) => rng.randcalcVaries(v),
    ),
    playing: true,
    isDead: false,
    generateLevel: false,
    nextCommand: () => null,
  } as unknown as GameState;
  placePlayer(state, playerGrid);
  return state;
}

interface FakeWindow {
  addEventListener(type: string, fn: (ev: Event) => void, capture?: boolean): void;
  removeEventListener(type: string, fn: (ev: Event) => void, capture?: boolean): void;
  dispatchEvent(ev: Event): void;
}

function makeFakeWindow(): FakeWindow {
  const listeners: Array<{ type: string; fn: (ev: Event) => void; capture: boolean }> = [];
  return {
    addEventListener(type, fn, capture = false) {
      listeners.push({ type, fn, capture });
    },
    removeEventListener(type, fn, capture = false) {
      const i = listeners.findIndex(
        (l) => l.type === type && l.fn === fn && l.capture === capture,
      );
      if (i >= 0) listeners.splice(i, 1);
    },
    dispatchEvent(ev) {
      for (const l of [...listeners].filter((x) => x.type === ev.type)) l.fn(ev);
    },
  };
}

function press(win: FakeWindow, key: string): void {
  const ev = new Event("keydown", { cancelable: true }) as Event & { key: string };
  ev.key = key;
  win.dispatchEvent(ev);
}

interface SheetTerm extends GlyphTerm {
  snapshot(): string[];
  colorAt(x: number, y: number): string | undefined;
  fireTap(col: number, row: number): void;
  hasTapHandler(): boolean;
}

/**
 * The fake term defaults to the REAL terminal size: 80x24, exactly what
 * term.ts presents (FIXED_COLS x FIXED_ROWS) and what upstream lays out for.
 * It used to default to 100x30, which is why nobody noticed that WIDE_COLS was
 * 90: these tests proved the wide grid at a width the game never has, while the
 * game itself always took the narrow fallback.
 */
function makeSheetTerm(cols = 80, rows = 24): SheetTerm {
  const grid: string[][] = Array.from({ length: rows }, () => new Array<string>(cols).fill(" "));
  const colors: (string | undefined)[][] = Array.from({ length: rows }, () =>
    new Array<string | undefined>(cols).fill(undefined),
  );
  let tapCb: ((cell: { col: number; row: number }) => void) | null = null;
  return {
    size: () => ({ cols, rows }),
    clear: () => {
      for (const row of grid) row.fill(" ");
      for (const row of colors) row.fill(undefined);
    },
    /* Term_erase(x, y, 255) + c_prt = erase-then-draw (ui-output.c:385-391).
     * print() is put_str and does NOT erase (ui-output.c:362-379); the two must
     * stay distinguishable in the fake or a prt site cannot be tested. */
    eraseToEol: (x: number, y: number) => {
      if (y < 0 || y >= rows) return;
      for (let cx = Math.max(0, x); cx < cols; cx++) {
        grid[y]![cx] = " ";
        colors[y]![cx] = "";
      }
    },
    prt: (x: number, y: number, text: string, fg: string) => {
      if (y < 0 || y >= rows) return;
      for (let cx = Math.max(0, x); cx < cols; cx++) {
        grid[y]![cx] = " ";
        colors[y]![cx] = "";
      }
      for (let i = 0; i < text.length && x + i < cols; i++) {
        if (x + i < 0) continue;
        grid[y]![x + i] = text[i] ?? " ";
        colors[y]![x + i] = fg;
      }
    },
    print: (x: number, y: number, text: string, fg: string) => {
      for (let i = 0; i < text.length && x + i < cols; i++) {
        if (y < 0 || y >= rows || x + i < 0) continue;
        grid[y]![x + i] = text[i] ?? " ";
        colors[y]![x + i] = fg;
      }
    },
    onSizeChanged: () => () => undefined,
    onCellTap: (cb: ((cell: { col: number; row: number }) => void) | null) => {
      tapCb = cb;
    },
    snapshot: () => grid.map((row) => row.join("").replace(/\s+$/u, "")),
    colorAt: (x: number, y: number) => colors[y]?.[x],
    fireTap: (col: number, row: number) => {
      tapCb?.({ col, row });
    },
    hasTapHandler: () => tapCb !== null,
  } as unknown as SheetTerm;
}

/** A row snapshot padded back out so column slices are stable. */
function slice(snap: string[], row: number, from: number, len: number): string {
  return (snap[row] ?? "").padEnd(from + len).slice(0, from + len).slice(from);
}

const STAT_COL = 42;

function setup(history = ""): { state: GameState; win: FakeWindow; term: SheetTerm } {
  const state = makeTestState(loc(2, 2));
  const p = state.actor.player;
  // An 18/100 STR (natural maximum -> the "!" flag and a 6-char cnv_stat).
  p.statMax[0] = 18 + 100;
  p.statCur[0] = 18 + 100;
  // A drained CON (stat_cur < stat_max -> lowercase name + yellow current).
  p.statMax[4] = 17;
  p.statCur[4] = 15;
  p.history = history;
  const win = makeFakeWindow();
  (globalThis as { window?: unknown }).window = win;
  return { state, win, term: makeSheetTerm() };
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
  setScreenPresenter(null);
});

/** The blocks of a view, by kind, so a test names what it is reading. */
function tableOf(view: ScreenView, key: string): ScreenTableBlock {
  const block = view.blocks.find((b) => b.kind === "table" && b.key === key);
  if (!block || block.kind !== "table") throw new Error(`no ${key} table on ${view.id}`);
  return block;
}

/* ------------------------------------------------------------------ */
/* The model (#253 step 5b-iv): both pages as documents                */
/* ------------------------------------------------------------------ */

describe("the character sheet gave up its model in step 5b-iv", () => {
  it("is listed as modelled, both pages, and neither is a page of lines", () => {
    expect(MODELLED_SCREENS).toContain("core:character");
    expect(MODELLED_SCREENS).toContain("core:character-flags");
    const { state } = setup("You are the only child of a Serf.");
    const view = characterScreen(state, "Fred");
    expect(view.id).toBe("core:character");
    expect(view.blocks.some((b) => b.kind === "lines")).toBe(false);
    expect(view.title).toContain("Fred");
  });

  it("publishes the stat table as columns with the bonus NUMBERS beside them", () => {
    const { state } = setup();
    const stats = tableOf(characterScreen(state, "Fred"), "stats");
    expect(stats.columns.map((c) => c.key)).toEqual([
      "stat", "self", "rb", "cb", "eb", "best", "cur",
    ]);
    const str = stats.rows[0]!;
    expect(str.id).toBe("str");
    /* The "!" is upstream's natural-maximum flag REPLACING the colon, and it
     * belongs to the text; the bonus columns carry real integers. */
    expect(str.cells.stat!.text).toBe("STR! ");
    expect(str.cells.self!.text).toBe("18/100");
    expect(typeof str.cells.rb!.values!.bonus).toBe("number");
    /* An undrained stat's Cur cell EXISTS and is empty - the column is a fact
     * about the table, never about the rows it holds today. */
    expect(str.cells.cur).toEqual({ text: "" });
    const con = stats.rows[4]!;
    expect(con.cells.cur!.text.trim()).not.toBe("");
  });

  it("publishes each panel as label/value rows addressed by a slug", () => {
    const { state } = setup();
    const view = characterScreen(state, "Fred");
    const panels = ["topleft", "misc", "midleft", "combat", "skills"].map((k) => tableOf(view, k));
    const rows = panels.flatMap((p) => p.rows);
    /* A presenter that wants the level should not have to find a colon in
     * "Level: 1" - the row answers to `level` and the number is beside it. */
    const level = rows.find((r) => r.id === "level");
    expect(level).toBeDefined();
    expect(level!.cells.label!.text).toBe("Level:");
    expect(level!.cells.value!.values!.value).toBe(state.actor.player.lev);
    /* Every panel ends with the blank row upstream leaves between them, as a
     * gap published beside the table rather than as a row that says nothing. */
    expect(panels.every((p) => p.gapAfter === 1)).toBe(true);
    /* "18/100" is not a quantity, and half-parsing it would be worse than
     * publishing nothing. */
    const fraction = rows.find((r) => (r.cells.value?.text ?? "").includes("/"));
    if (fraction) expect(fraction.cells.value!.values).toBeUndefined();
  });

  it("publishes the history as prose, not as rows the terminal already cut", () => {
    const history = "You are the only child of a Serf. You have blue eyes and a fair complexion.";
    const { state } = setup(history);
    const view = characterScreen(state, "Fred");
    const block = view.blocks.find((b) => b.kind === "text") as ScreenTextBlock | undefined;
    expect(block).toBeDefined();
    expect(block!.paragraphs[0]![0]!.text).toBe(history);
    expect(block!.wrap).toBe(72); // text_out_wrap, ui-player.c L858
    /* A character with no history contributes no block at all - not a blank one. */
    const { state: none } = setup("");
    expect(characterScreen(none, "Fred").blocks.some((b) => b.kind === "text")).toBe(false);
  });

  it("makes the flag grid's COLUMNS the equipment slots, glyphs and all", () => {
    const { state } = setup();
    const view = characterFlagsScreen(state, "Fred", buildUiEntryConfig(uiEntryPacks));
    expect(view.id).toBe("core:character-flags");
    const resist = view.blocks[0]!;
    if (resist.kind !== "table") throw new Error("the flag grid stopped being a table");
    expect(resist.caption!.text).toBe("Resistances");
    /* One column per body slot plus the player's '@', each slot headed by its
     * all_letters_nohjkl letter and carrying what is worn there. */
    expect(resist.columns).toHaveLength(state.actor.player.body.count + 2);
    expect(resist.columns[0]!.key).toBe("label");
    expect(resist.columns.at(-1)!.label).toBe("@");
    expect(resist.columns[1]!.glyph).toBeDefined();
    /* A row is addressed by the ui_entry name, which is the only handle a
     * presenter has on WHICH resistance it is looking at. */
    expect(resist.rows[0]!.id).toMatch(/</u);
    /* The sustains block is the same table minus its label column, exactly as
     * upstream calls the renderer there with label = NULL. */
    const sustains = view.blocks.at(-1)!;
    if (sustains.kind !== "table") throw new Error("the sustains block stopped being a table");
    expect(sustains.columns.map((c) => c.key)).not.toContain("label");
  });

  it("did not move the player's screen: the same rows come out of the model", () => {
    /* The narrow list is now `screenBodyLines(characterScreen(...))`. If the
     * model and the renderer disagree about a column stop, the phone layout is
     * what breaks - so the upstream-cited assertions above this file's fold are
     * the parity check, and this one pins that the wrapper is the same function. */
    const { state } = setup("Some history for the block.");
    expect(characterSheetLines(state, "Fred", 80)[0]).toEqual(statHeaderLine());
  });
});

/* ------------------------------------------------------------------ */
/* The seam: a presenter is OFFERED the sheet, and can run its commands */
/* ------------------------------------------------------------------ */

describe("showCharacterSheet offers the sheet to a presenter", () => {
  /** Install a presenter that records what it is shown and keeps the host. */
  function record(take: boolean): {
    seen: ScreenView[];
    host: () => ScreenHost | undefined;
    dismiss: () => void;
  } {
    const seen: ScreenView[] = [];
    let held: ScreenHost | undefined;
    let done = (): void => {};
    const dismissed = new Promise<void>((resolve) => {
      done = resolve;
    });
    setScreenPresenter({
      id: "test:presenter",
      presenter: {
        show: (view, host) => {
          seen.push(view);
          held = host;
          return take ? { dismissed } : undefined;
        },
      },
    });
    return { seen, host: () => held, dismiss: () => done() };
  }

  it("hands over the view and its actions, and never paints the terminal", async () => {
    const { state, term } = setup();
    const rec = record(true);
    const open = showCharacterSheet(term, state, "Fred", { uiEntryPacks });
    expect(rec.seen[0]!.id).toBe("core:character");
    expect(rec.seen[0]!.actions).toEqual(CHARACTER_ACTIONS);
    /* Nothing of the game's own sheet reached the screen - that is the whole
     * point of taking it, and a presenter drawing over a painted terminal would
     * look identical until the mod's overlay had a transparent pixel. */
    expect(term.snapshot().join("")).toBe("");
    rec.dismiss();
    await open;
  });

  it("cycles pages through invoke, and hands back the OTHER page's view", async () => {
    const { state, term } = setup();
    const rec = record(true);
    const open = showCharacterSheet(term, state, "Fred", { uiEntryPacks });
    const host = rec.host()!;
    expect((await host.invoke("page-next"))!.id).toBe("core:character-flags");
    expect((await host.invoke("page-next"))!.id).toBe("core:character");
    expect((await host.invoke("page-prev"))!.id).toBe("core:character-flags");
    rec.dismiss();
    await open;
  });

  it("treats an unknown action as a no-op rather than as a way out", async () => {
    /* A presenter built against a later engine asking for a command this one has
     * not got must not be able to close the player's character sheet. */
    const { state, term } = setup();
    const rec = record(true);
    const open = showCharacterSheet(term, state, "Fred", { uiEntryPacks });
    const back = await rec.host()!.invoke("teleport-the-player");
    expect(back!.id).toBe("core:character");
    rec.dismiss();
    await open;
  });

  it("takes the sheet back when the page it is asked for has no model", async () => {
    /* No ui_entry packs: page 2 is a notice saying the data is missing, and
     * publishing that under `core:character-flags` would be a lie about what the
     * presenter is holding. `undefined` says so. */
    const { state, term } = setup();
    const rec = record(true);
    const open = showCharacterSheet(term, state, "Fred");
    expect(await rec.host()!.invoke("page-next")).toBeUndefined();
    rec.dismiss();
    await open;
  });

  it("paints its own sheet when the presenter declines", () => {
    const { state, term } = setup();
    const rec = record(false);
    void showCharacterSheet(term, state, "Fred", { uiEntryPacks });
    expect(rec.seen).toHaveLength(1);
    expect(term.snapshot()[0]).toContain("Fred");
  });

  /**
   * #253: THE TERMINAL'S OWN SHEET DECLARES A RECTANGLE.
   *
   * `main-regions.test.ts` lists `paintWide` and `paintNarrow` as regions, and
   * that list is a claim its own source-text guard cannot check per site. This
   * is the stack, read through the shipped path, while the sheet is up.
   *
   * THE PRESENTER ARM IS THE CONTROL, and it is the half that would otherwise
   * go unexamined: a push written at the top of `showCharacterSheet` instead of
   * inside `showSheetOnTerminal` would pass the assertion below and be wrong,
   * because a sheet a mod is DRAWING ITSELF is not a sheet covering anything.
   * The region belongs to the erase, not to the command.
   */
  it("declares core:screen while the terminal paints it, and not when a mod does", async () => {
    resetRegionStack();
    const { state, win, term } = setup();
    const taken = record(true);
    const held = showCharacterSheet(term, state, "Fred", { uiEntryPacks });
    expect(liveRegionStack()).toEqual([]);
    taken.dismiss();
    await held;
    expect(liveRegionStack()).toEqual([]);

    const rec = record(false);
    const open = showCharacterSheet(term, state, "Fred", { uiEntryPacks });
    expect(rec.seen).toHaveLength(1);
    expect(liveRegionStack().map((r) => r.id)).toEqual([SCREEN_REGION_ID]);
    /* The whole terminal, in the modal band: a 4.2.6 screen is screen_save /
     * full repaint / screen_load, and shrinking core's tombstone would move a
     * picture upstream's own tests describe. What it lacked was a rectangle. */
    expect(liveRegionStack()[0]).toMatchObject({
      layer: "modal",
      cells: { col: 0, row: 0, cols: 80, rows: 24 }, // makeSheetTerm's defaults
    });
    press(win, "Escape");
    await open;
    expect(liveRegionStack()).toEqual([]);
  });
});

/* ------------------------------------------------------------------ */
/* #258: the prompt inside invoke, and the overlay it lands under       */
/* ------------------------------------------------------------------ */

/**
 * THE DEFECT, AS AN OBSERVABLE.
 *
 * `host.invoke("rename")` runs the game's own `promptText` on the faithful
 * terminal while the presenter's overlay is on top of it, and the input door
 * goes on feeding it keystrokes. `askforAuxKeypress` clears the prefilled
 * default on the first printable key, so 'c' B o b Enter renames the character
 * and calls `onRename` - which in `main.ts` is `renamePlayer` -> `persistSave()`.
 * A save written for a name the player never saw themselves type.
 *
 * So the assertion is not "yieldTerminal was called". It is WHAT WAS TRUE AT THE
 * MOMENT THE SAVE WAS PERSISTED: the presenter's overlay was not covering the
 * screen the question was asked on. `occluding()` models that as the one boolean
 * a presenter genuinely controls, flipped by the announcement itself.
 *
 * The negative control for every test here is the wiring REMOVED - `invoke`
 * calling `doRename` / `doFileDump` directly, which is what this file measured
 * green before #258. Not a presenter fed input assumed to be inert.
 */
describe("a prompt inside invoke is announced before it lands (#258)", () => {
  const tick = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

  /**
   * A presenter whose overlay COVERS the terminal until the game tells it to
   * stand aside, and covers it again when the game gives it back.
   *
   * Typed as `ScreenShown`, which is where `yieldTerminal` now lives - on both
   * published copies, in the same words (#258). The private `YieldingScreen`
   * this comment used to name is gone.
   *
   * Worth keeping the reason it existed, because it is the defect this seam
   * taught: the member worked for a release while being declared NOWHERE a mod
   * author could see. `tsc` accepts a handle carrying an extra member against a
   * `ScreenShown | undefined` return with no cast and no excess-property error,
   * so an undeclared member is not an unusable one - it is an invisible one, and
   * nothing checked the signature of whatever an author guessed. Two structurally
   * identical interfaces are ONE type to the compiler, so the check that holds
   * the copies together (`screen-abi-agreement.test.ts`) reads them as FILES.
   */
  function occluding(): {
    host: () => ScreenHost;
    covering: () => boolean;
    received: (PromptRequest | null)[];
    dismiss: () => void;
  } {
    let held: ScreenHost | undefined;
    let covering = true;
    const received: (PromptRequest | null)[] = [];
    let done = (): void => {};
    const dismissed = new Promise<void>((resolve) => {
      done = resolve;
    });
    const shown: ScreenShown = {
      dismissed,
      yieldTerminal(request) {
        received.push(request);
        covering = request === null;
      },
    };
    setScreenPresenter({
      id: "test:overlay",
      presenter: {
        show: (_view, host) => {
          held = host;
          covering = true;
          return shown;
        },
      },
    });
    return {
      host: () => held!,
      covering: () => covering,
      received,
      dismiss: () => done(),
    };
  }

  it("does not persist a renamed save under the presenter's own overlay", async () => {
    const { state, win, term } = setup();
    const rec = occluding();
    /* What `renamePlayer` -> `persistSave()` would have written, plus the one
     * fact that makes it a defect: whether the player could see the question. */
    const persisted: { name: string; occluded: boolean }[] = [];
    const open = showCharacterSheet(term, state, "Fred", {
      uiEntryPacks,
      onRename: (n) => persisted.push({ name: n, occluded: rec.covering() }),
    });

    const running = rec.host().invoke("rename");
    await tick();
    /* The prompt is the GAME's, unchanged: the prefill is the current name and
     * the first printable key replaces it (askfor_aux L765-771). */
    for (const ch of "Bob") press(win, ch);
    press(win, "Enter");
    await running;

    /* The rename STILL HAPPENED. The rule is explicit that prompts inside
     * `invoke` are not forbidden - a mod's actions must not be a strict subset
     * of the game's - so "no save was written" would be the wrong green. */
    expect(persisted).toEqual([{ name: "Bob", occluded: false }]);
    expect(term.snapshot().join("\n")).not.toContain("Fred the");
    /* And the presenter has its screen back, or the player is left staring at a
     * finished prompt with their overlay gone for the rest of the session. */
    expect(rec.covering()).toBe(true);
    expect(rec.received).toEqual([rec.received[0], null]);

    rec.dismiss();
    await open;
  });

  it("writes the save on 'c' then ENTER alone - two keys, no typing", async () => {
    /* HOW REACHABLE THIS IS, as a measurement rather than a reading of the code.
     * `promptText` prefills the current name, and Enter on the first keypress
     * accepts the buffer (askfor_aux L675-679), so `onRename` fires - and in
     * `main.ts` that is `renamePlayer` -> `persistSave()`. TWO keystrokes write
     * the save, and the name does not even have to change for that to be true.
     * Escape is the ONLY key that gets out of the prompt without writing it.
     *
     * Kept because the severity answer must not rot into an impression: this is
     * the number, and it fails if the prompt ever stops accepting a bare Enter. */
    const { state, win, term } = setup();
    const rec = occluding();
    const persisted: { name: string; occluded: boolean }[] = [];
    const open = showCharacterSheet(term, state, "Fred", {
      uiEntryPacks,
      onRename: (n) => persisted.push({ name: n, occluded: rec.covering() }),
    });

    const running = rec.host().invoke("rename");
    await tick();
    press(win, "Enter");
    await running;
    expect(persisted).toEqual([{ name: "Fred", occluded: false }]);

    /* And the one key that does NOT write it. */
    const second = rec.host().invoke("rename");
    await tick();
    press(win, "Escape");
    await second;
    expect(persisted).toHaveLength(1);

    rec.dismiss();
    await open;
  });

  it("announces what the CENSUS says and what the real producer builds", async () => {
    const { state, win, term } = setup();
    const rec = occluding();
    const open = showCharacterSheet(term, state, "Fred", { uiEntryPacks });

    const running = rec.host().invoke("rename");
    await tick();

    /* Built here from `screenPromptFor` + `promptRequest` - the same two
     * producers the wiring uses - rather than from a literal, which would only
     * assert that this file and that file were typed by the same person. */
    const fact = screenPromptFor("core:character", "rename")!;
    const expected = promptRequest(
      fact.promptId,
      "rename",
      fact.extent,
      CHARSHEET_PROMPT_LABELS[fact.promptId]!,
      term.size(),
    );
    expect(rec.received[0]).toEqual(expected);
    /* KEY SETS as well: an added optional field is equal-by-deep-compare to an
     * absent one, so a field dropped at the seam sails past `toEqual`. */
    expect(Object.keys(rec.received[0]!).sort()).toEqual(Object.keys(expected).sort());
    /* `screen` extent means the whole grid, and the game took the whole grid:
     * `promptText` clears and draws its own title where the sheet's used to be. */
    expect(rec.received[0]!.extent).toBe("screen");
    expect(term.snapshot()[0]).toContain(CHARSHEET_PROMPT_LABELS["charsheet:rename"]);

    press(win, "Escape");
    await running;
    rec.dismiss();
    await open;
  });

  it("announces the dump as a LINE, and the game draws it on that line", async () => {
    const { state, win, term } = setup();
    const rec = occluding();
    const open = showCharacterSheet(term, state, "Fred", { uiEntryPacks });

    const running = rec.host().invoke("file");
    await tick();

    expect(rec.received[0]!.id).toBe("charsheet:file");
    expect(rec.received[0]!.extent).toBe("line");
    expect(rec.received[0]!.clip).toEqual({ col: 0, row: 0, cols: 80, rows: 1 });
    expect(rec.covering()).toBe(false);
    /* The label is a SECOND SPELLING of `getFile`'s own un-exported prompt, so
     * it is checked against the row `getFile` actually drew on - the rectangle
     * the request promised - and not against another constant. */
    expect(term.snapshot()[0]!.startsWith(CHARSHEET_PROMPT_LABELS["charsheet:file"]!)).toBe(true);

    press(win, "Escape"); // cancel the dump
    await running;
    expect(rec.covering()).toBe(true);
    rec.dismiss();
    await open;
  });

  it("still announces from page 2, where the sheet is a different view", async () => {
    const { state, win, term } = setup();
    const rec = occluding();
    const open = showCharacterSheet(term, state, "Fred", { uiEntryPacks });

    expect((await rec.host().invoke("page-next"))!.id).toBe("core:character-flags");
    const running = rec.host().invoke("rename");
    await tick();
    expect(rec.received.map((r) => r?.id ?? null)).toEqual(["charsheet:rename"]);

    press(win, "Escape");
    await running;
    rec.dismiss();
    await open;
  });

  it("does NOT announce a page flip: the control, an action that never prompts", async () => {
    /* `page-next` is in `SCREEN_NO_PROMPT`. Announcing it anyway would make a
     * presenter fade its overlay out and back for a keystroke that touches no
     * terminal - and is exactly what a wiring that wrapped every action in
     * `withTerminal` would do. */
    const { state, term } = setup();
    const rec = occluding();
    const open = showCharacterSheet(term, state, "Fred", { uiEntryPacks });

    await rec.host().invoke("page-next");
    await rec.host().invoke("page-prev");
    await rec.host().invoke("teleport-the-player");
    expect(rec.received).toEqual([]);
    expect(rec.covering()).toBe(true);

    rec.dismiss();
    await open;
  });

  it("reports BY NAME the presenter that cannot stand aside, and prompts anyway", async () => {
    /* THE NEGATIVE CONTROL AS A SHIPPED CASE: every presenter that exists today
     * - `samples/sprite-inventory` included - returns a handle with no
     * `yieldTerminal` at all. The prompt must still run, the player
     * must still be able to answer it, and the mod must be named once. */
    const faults: string[] = [];
    setUiFaultReporter((id, message) => void faults.push(`${id}: ${message}`));
    try {
      const { state, win, term } = setup();
      let done = (): void => {};
      const dismissed = new Promise<void>((resolve) => {
        done = resolve;
      });
      let held: ScreenHost | undefined;
      setScreenPresenter({
        id: "no-yield-mod",
        presenter: {
          show: (_view, host) => {
            held = host;
            return { dismissed };
          },
        },
      });
      const renames: string[] = [];
      const open = showCharacterSheet(term, state, "Fred", {
        uiEntryPacks,
        onRename: (n) => renames.push(n),
      });

      const running = held!.invoke("rename");
      await tick();
      for (const ch of "Bob") press(win, ch);
      press(win, "Enter");
      await running;

      expect(renames).toEqual(["Bob"]);
      expect(faults).toHaveLength(1);
      expect(faults[0]).toContain("no-yield-mod");
      expect(faults[0]).toContain("yieldTerminal");
      expect(faults[0]).toContain(CHARSHEET_PROMPT_LABELS["charsheet:rename"]);

      done();
      await open;
    } finally {
      setUiFaultReporter(() => {});
    }
  });

  it("keys the census by the ids the view builders actually publish", () => {
    /* `MODE_VIEW_IDS` is a second spelling of what `characterScreen` and
     * `characterFlagsScreen` return. Untied, a renamed view id would leave the
     * census lookup returning `undefined` and every prompt silently
     * un-announced again - the original defect, restored, with every test above
     * still green because they would all stop announcing together. */
    const { state } = setup();
    expect(MODE_VIEW_IDS[0]).toBe(characterScreen(state, "Fred").id);
    expect(MODE_VIEW_IDS[1]).toBe(
      characterFlagsScreen(state, "Fred", buildUiEntryConfig(uiEntryPacks)).id,
    );
  });

  it("has a label for every prompt the census gives this screen", () => {
    /* Totality, so a third prompting action added to the sheet cannot announce
     * itself to mods by its bare id. */
    for (const viewId of MODE_VIEW_IDS) {
      const row = SCREEN_PROMPTS[viewId];
      expect(row).toBeDefined();
      for (const fact of Object.values(row!)) {
        expect(CHARSHEET_PROMPT_LABELS[fact.promptId]).toBeTypeOf("string");
      }
    }
    /* And no label for a prompt this screen does not open, which is what would
     * be left behind if one were removed from the census. */
    const known = new Set(
      MODE_VIEW_IDS.flatMap((v) => Object.values(SCREEN_PROMPTS[v] ?? {}).map((f) => f.promptId)),
    );
    expect(Object.keys(CHARSHEET_PROMPT_LABELS).sort()).toEqual([...known].sort());
  });
});

/* ------------------------------------------------------------------ */
/* The SAMPLE takes it: a real plugin, from disk, through the real seam */
/* ------------------------------------------------------------------ */

describe("samples/sprite-inventory draws the character sheet from the model", () => {
  /** A canvas that records the strings drawn on it and nothing else. */
  function recordingDocument(drawn: string[]): {
    doc: unknown;
    press: (key: string) => void;
  } {
    const keys: ((ev: { key: string }) => void)[] = [];
    const g = {
      fillRect: () => undefined,
      fillText: (text: string) => drawn.push(String(text)),
      measureText: (text: string) => ({ width: text.length * 7 }),
      beginPath: () => undefined,
      arc: () => undefined,
      fill: () => undefined,
      stroke: () => undefined,
      strokeRect: () => undefined,
      moveTo: () => undefined,
      lineTo: () => undefined,
      closePath: () => undefined,
      save: () => undefined,
      restore: () => undefined,
      set fillStyle(_v: string) {},
      set strokeStyle(_v: string) {},
      set font(_v: string) {},
      set lineWidth(_v: number) {},
    };
    return {
      doc: {
        createElement: () => ({ style: {}, getContext: () => g }),
        body: { appendChild: () => undefined },
        addEventListener: (_t: string, fn: (ev: { key: string }) => void) => keys.push(fn),
        removeEventListener: (_t: string, fn: (ev: { key: string }) => void) => {
          const i = keys.indexOf(fn);
          if (i >= 0) keys.splice(i, 1);
        },
      },
      press: (key) => {
        for (const fn of [...keys]) fn({ key });
      },
    };
  }

  it("reads the sheet's cells and captions, never a rendered row", async () => {
    const drawn: string[] = [];
    const { doc, press } = recordingDocument(drawn);
    (globalThis as { document?: unknown }).document = doc;
    const url = new URL("../../../samples/sprite-inventory/plugin.js", import.meta.url);
    const mod = (await import(url.href)) as { default: { screen: (ctx: unknown) => unknown } };
    const presenter = mod.default.screen({ id: "sprite-inventory", api: 1, log: () => undefined });
    setScreenPresenter({ id: "sprite-inventory", presenter: presenter as never });

    const { state, term } = setup("You are the only child of a Serf.");
    const open = showCharacterSheet(term, state, "Fred", { uiEntryPacks });

    /* The game's own terminal drew nothing: the mod has the screen. */
    expect(term.snapshot().join("")).toBe("");
    expect(drawn).toContain("18/100"); // the Self field, from the cell
    expect(drawn.some((t) => t.startsWith("[c] change name"))).toBe(true);
    /* Not one COMPOSITE row the faithful terminal would have produced reached the
     * canvas - a composite being a label joined to its value ("Level: 1") or a
     * padded multi-field line ("STR!  18/100  +1..."), which are exactly the rows
     * a presenter would otherwise have had to take apart again. Taken from the
     * view under test rather than from a guess at its layout, so changing a column
     * stop cannot quietly retire this.
     *
     * A bare section header ("Turns used") is deliberately NOT in the set: the
     * game's row and the mod's label are the same string because there is nothing
     * to split, and asserting on it would fail for being right. */
    const composite = characterSheetLines(state, "Fred", 80)
      .map((l) => l.text.trim())
      .filter((t) => /(: \S)|(\S {2,}\S)/u.test(t));
    expect(composite.length).toBeGreaterThan(5);
    for (const row of composite) expect(drawn).not.toContain(row);

    /* 'h' goes through the HOST, so the game moves the page and hands back the
     * other one - the mod never decides what page 2 is. */
    press("h");
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(drawn).toContain("Resistances");

    press("Escape");
    await expect(open).resolves.toBeUndefined();
    delete (globalThis as { document?: unknown }).document;
  });
});

/* ------------------------------------------------------------------ */
/* Wide layout (display_player mode 0)                                 */
/* ------------------------------------------------------------------ */

describe("showCharacterSheet wide: faithful stat-table columns and colours", () => {
  it("aligns width-6 Self/Best headers with 18/100 data (the header-width fix)", () => {
    const { state, win, term } = setup();
    void showCharacterSheet(term, state, "Fred");
    const snap = term.snapshot();
    // Headers (row 1) at the upstream stops: col+5 / +12 / +16 / +20 / +24.
    expect(slice(snap, 1, STAT_COL + 5, 6)).toBe("  Self");
    expect(slice(snap, 1, STAT_COL + 12, 3)).toBe(" RB");
    expect(slice(snap, 1, STAT_COL + 16, 3)).toBe(" CB");
    expect(slice(snap, 1, STAT_COL + 20, 3)).toBe(" EB");
    expect(slice(snap, 1, STAT_COL + 24, 6)).toBe("  Best");
    // STR data row (row 2): the 6-char cnv_stat sits exactly under "  Self".
    expect(slice(snap, 2, STAT_COL + 5, 6)).toBe("18/100");
    // Best is a 6-char cnv_stat field exactly under "  Best".
    expect(slice(snap, 2, STAT_COL + 24, 6)).toMatch(/^(18\/\d{3}| 18\/\d{2}|\s+\d{1,2})$/);
    press(win, "Escape");
  });

  it("renders 'STR!' for a natural-max stat: the '!' REPLACES the colon", () => {
    const { state, win, term } = setup();
    void showCharacterSheet(term, state, "Fred");
    const snap = term.snapshot();
    expect(slice(snap, 2, STAT_COL, 4)).toBe("STR!");
    expect(snap.join("\n")).not.toContain("STR!:");
    // A non-max stat keeps its colon (INT row).
    expect(slice(snap, 3, STAT_COL, 4)).toBe("INT:");
    press(win, "Escape");
  });

  it("colours Self/Best L_GREEN, RB/CB/EB L_BLUE (ui-player.c L485-501)", () => {
    const { state, win, term } = setup();
    void showCharacterSheet(term, state, "Fred");
    expect(term.colorAt(STAT_COL + 6, 2)).toBe(colorToCss(COLOUR_L_GREEN)); // Self
    expect(term.colorAt(STAT_COL + 25, 2)).toBe(colorToCss(COLOUR_L_GREEN)); // Best
    expect(term.colorAt(STAT_COL + 13, 2)).toBe(colorToCss(COLOUR_L_BLUE)); // RB
    expect(term.colorAt(STAT_COL + 17, 2)).toBe(colorToCss(COLOUR_L_BLUE)); // CB
    expect(term.colorAt(STAT_COL + 21, 2)).toBe(colorToCss(COLOUR_L_BLUE)); // EB
    press(win, "Escape");
  });

  it("shows the drained value in YELLOW at col+31, blank when not drained", () => {
    const { state, win, term } = setup();
    void showCharacterSheet(term, state, "Fred");
    const snap = term.snapshot();
    // CON (row 6) is drained: lowercase name, a value in the trailing column.
    expect(slice(snap, 6, STAT_COL, 4)).toBe("Con:");
    const drainedCell = slice(snap, 6, STAT_COL + 31, 6);
    expect(drainedCell.trim()).not.toBe("");
    const xNonSpace = STAT_COL + 31 + drainedCell.search(/\S/u);
    expect(term.colorAt(xNonSpace, 6)).toBe(colorToCss(COLOUR_YELLOW));
    // STR (row 2) is NOT drained: the column stays blank (no echoed Best).
    expect(slice(snap, 2, STAT_COL + 30, 8).trim()).toBe("");
    press(win, "Escape");
  });

  it("places topleft at x=1 and the misc panel at x=21 (panels[] L851-852)", () => {
    const { state, win, term } = setup();
    void showCharacterSheet(term, state, "Fred");
    const snap = term.snapshot();
    expect(slice(snap, 1, 1, 4)).toBe("Name");
    expect(slice(snap, 1, 21, 3)).toBe("Age");
    // Row-9 blocks: midleft x=1, combat x=29, skills x=52 (L853-855).
    expect(slice(snap, 9, 1, 5)).toBe("Level");
    expect(slice(snap, 9, 29, 5)).toBe("Armor");
    expect(slice(snap, 9, 52, 6)).toBe("Saving");
    press(win, "Escape");
  });

  it("renders player.history wrapped from row 19 and degrades to nothing when empty", () => {
    const history =
      "You are the only child of a Serf. You are a credit to the family. " +
      "You have blue eyes, straight brown hair, and an average complexion.";
    const withHist = setup(history);
    void showCharacterSheet(withHist.term, withHist.state, "Fred");
    const snap = withHist.term.snapshot();
    expect(snap[19]).toContain("You are the only child of a Serf.");
    expect(snap[19]!.startsWith(" ")).toBe(true); // text_out_indent = 1
    press(withHist.win, "Escape");

    const noHist = setup("");
    void showCharacterSheet(noHist.term, noHist.state, "Fred");
    const empty = noHist.term.snapshot();
    // Rows 19 up to (but not including) the footer row, which always carries
    // the key hints.
    for (let r = 19; r < 23; r++) expect(empty[r] ?? "").toBe("");
    press(noHist.win, "Escape");
  });
});

/* ------------------------------------------------------------------ */
/* Mode cycling + keys (do_cmd_change_name)                            */
/* ------------------------------------------------------------------ */

describe("showCharacterSheet: do_cmd_change_name keys", () => {
  it("h/Space/ArrowLeft cycle forward, l/ArrowRight backward (L1280-1289)", () => {
    const { state, win, term } = setup();
    void showCharacterSheet(term, state, "Fred");
    // Marker present in mode 1 (both the no-packs placeholder and the real grid)
    // but never in the mode-0 skills/history page.
    const placeholder = "Resistances & Abilities";
    expect(term.snapshot().join("\n")).not.toContain(placeholder);
    press(win, "h"); // mode 0 -> 1
    expect(term.snapshot().join("\n")).toContain(placeholder);
    press(win, "h"); // 1 -> 0
    expect(term.snapshot().join("\n")).not.toContain(placeholder);
    press(win, " "); // Space: forward again
    expect(term.snapshot().join("\n")).toContain(placeholder);
    press(win, "l"); // backward: 1 -> 0
    expect(term.snapshot().join("\n")).not.toContain(placeholder);
    press(win, "ArrowLeft"); // forward
    expect(term.snapshot().join("\n")).toContain(placeholder);
    press(win, "ArrowRight"); // backward
    expect(term.snapshot().join("\n")).not.toContain(placeholder);
    press(win, "Escape");
  });

  it("mode 1 shows a placeholder without ui_entry packs", () => {
    const { state, win, term } = setup();
    void showCharacterSheet(term, state, "Fred");
    press(win, "h");
    const text = term.snapshot().join("\n");
    expect(text).toContain("unavailable");
    press(win, "Escape");
  });

  it("mode 1 renders the real resist/ability/sustain grid, faithful to display_player(1)", () => {
    const { state, win, term } = setup();
    void showCharacterSheet(term, state, "Fred", { uiEntryPacks });
    press(win, "h");
    const snap = term.snapshot();
    const text = snap.join("\n");
    // display_player mode 1 draws panels[0] (topleft) too (ui-player.c:906-908).
    expect(slice(snap, 1, 1, 4)).toBe("Name");
    // The four flag regions tile across, each with its real row labels + the
    // player "@" column; the sustains block sits left of the stat table with
    // the exact upstream slot-letter header (all_letters_nohjkl, skips h/j/k/l).
    expect(text).toContain("Acid:");
    expect(text).toContain("@");
    expect(text).toContain("abcdefgimnop@");
    // No placeholder, and NO on-screen region titles - those live only in the
    // character dump (write_character_dump), never on the interactive screen.
    expect(text).not.toContain("unavailable");
    expect(text).not.toContain("Resistances");
    expect(text).not.toContain("Sustains");
    press(win, "Escape");
  });

  it("'c' renames through promptText and reports via onRename", async () => {
    const { state, win, term } = setup();
    const renames: string[] = [];
    const done = showCharacterSheet(term, state, "Fred", {
      onRename: (n) => renames.push(n),
    });
    press(win, "c");
    await Promise.resolve(); // promptText is now the key owner
    for (let i = 0; i < "Fred".length; i++) press(win, "Backspace"); // clear the prefill
    for (const ch of "Bob") press(win, ch);
    press(win, "Enter");
    await Promise.resolve();
    await Promise.resolve();
    expect(renames).toEqual(["Bob"]);
    expect(term.snapshot()[0]).toContain("Bob the");
    press(win, "Escape");
    await done;
  });

  it("'c' refuses the rename under arg_force_name (ui-player.c:1249-1250)", async () => {
    /* The message is the only thing that happens: the prompt must NOT open, or
     * the sheet would have detached its key listener and handed control to a
     * line editor nobody asked for. Reachable via main.c's `-f`. */
    initLaunchArgs(["-f"]);
    try {
      const { state, win, term } = setup();
      const renames: string[] = [];
      const said: string[] = [];
      const done = showCharacterSheet(term, state, "Fred", {
        onRename: (n) => renames.push(n),
        msg: (t) => said.push(t),
      });
      press(win, "c");
      await Promise.resolve();
      expect(said).toEqual(["You are not allowed to change your name!"]);
      /* Still the sheet's own listener: 'h' cycles the page, which it could not
       * do if a name prompt had taken the keys. */
      press(win, "h");
      expect(term.snapshot().join("\n")).toContain("Resistances & Abilities");
      press(win, "Escape");
      await done;
      expect(renames).toEqual([]);
    } finally {
      resetLaunchArgs();
    }
  });

  it("ESC and Enter both close; the tap handler is torn down", async () => {
    const a = setup();
    const doneA = showCharacterSheet(a.term, a.state, "Fred");
    expect(a.term.hasTapHandler()).toBe(true);
    press(a.win, "Escape");
    await doneA;
    expect(a.term.hasTapHandler()).toBe(false);

    const b = setup();
    const doneB = showCharacterSheet(b.term, b.state, "Fred");
    press(b.win, "Enter");
    await doneB;
    expect(b.term.hasTapHandler()).toBe(false);
  });

  it("a body tap flips the page (upstream mouse button 1); a footer tap closes", async () => {
    const { state, win, term } = setup();
    const done = showCharacterSheet(term, state, "Fred");
    term.fireTap(10, 5);
    expect(term.snapshot().join("\n")).toContain("Resistances & Abilities");
    term.fireTap(0, term.size().rows - 1);
    await done;
    expect(term.hasTapHandler()).toBe(false);
    void win;
  });
});

/* ------------------------------------------------------------------ */
/* Narrow list (characterSheetLines) + RNG invariance                  */
/* ------------------------------------------------------------------ */

describe("characterSheetLines narrow: same 6-wide fields, blank-unless-drained Cur", () => {
  it("header and data share the exact column stops", () => {
    const { state } = setup();
    const lines = characterSheetLines(state, "Fred");
    const header = lines[0]!.text;
    const str = lines[1]!.text;
    expect(header.slice(5, 11)).toBe("  Self");
    expect(header.slice(24, 30)).toBe("  Best");
    expect(str.slice(0, 5)).toBe("STR! ");
    expect(str.slice(5, 11)).toBe("18/100");
    // No Cur header, and no echoed Best after col 30 on a non-drained row.
    expect(header.slice(30)).toBe("");
    expect(str.slice(30).trim()).toBe("");
    // The drained CON row carries the trailing yellow value at col 31.
    const con = lines[5]!;
    expect(con.text.slice(0, 4)).toBe("Con:");
    expect(con.text.slice(31).trim()).not.toBe("");
    const lastRun = con.runs![con.runs!.length - 1]!;
    expect(lastRun.color).toBe(colorToCss(COLOUR_YELLOW));
  });

  it("stat rows carry per-column runs (L_GREEN / L_BLUE)", () => {
    const { state } = setup();
    const str = characterSheetLines(state, "Fred")[1]!;
    expect(str.runs).toBeDefined();
    const colors = str.runs!.map((r) => r.color);
    expect(colors).toContain(colorToCss(COLOUR_L_GREEN));
    expect(colors).toContain(colorToCss(COLOUR_L_BLUE));
  });

  it("appends the wrapped history block and degrades cleanly when empty", () => {
    const history = "You are the only child of a Serf. You have blue eyes.";
    const { state } = setup(history);
    const lines = characterSheetLines(state, "Fred", 40);
    const text = lines.map((l) => l.text).join("\n");
    expect(text).toContain("only child of a Serf");
    for (const l of historyBlockLines(state, 40)) {
      expect(l.text.length).toBeLessThanOrEqual(40);
    }
    const { state: emptyState } = setup("");
    expect(historyBlockLines(emptyState, 40)).toEqual([]);
  });

  it("statHeaderLine/statRowLine agree on width for every cnv_stat shape", () => {
    const shapes = ["    16", " 18/72", "18/100", "18/***"];
    for (const natural of shapes) {
      const line = statRowLine({
        label: "STR: ",
        natural,
        raceBonus: " +1",
        classBonus: " -1",
        equipBonus: " +0",
        best: natural,
        reduced: null,
        naturalMax: false,
        drained: false,
      });
      expect(line.text.length).toBe(statHeaderLine().text.length);
    }
  });
});

describe("showCharacterSheet: RNG invariance (pure display)", () => {
  it("draws zero RNG across open, mode flips, scroll, and close", async () => {
    const { state, win, term } = setup("Some history text for the block.");
    const before = JSON.stringify(state.rng.getState());
    const done = showCharacterSheet(term, state, "Fred");
    press(win, "h");
    press(win, "l");
    press(win, "ArrowDown");
    press(win, "PageDown");
    press(win, "PageUp");
    term.fireTap(10, 5);
    press(win, "Escape");
    await done;
    expect(JSON.stringify(state.rng.getState())).toBe(before);
    // The narrow list builder is equally pure.
    characterSheetLines(state, "Fred", 40);
    expect(JSON.stringify(state.rng.getState())).toBe(before);
  });
});

/* ------------------------------------------------------------------ *
 * The character dump's [Mods enabled] block.
 *
 * A dump is the artefact players hand each other, and a mod's change looks
 * exactly like a core bug in one. This block is the answer - and it is also the
 * one thing in write_character_dump with no upstream line behind it, so both
 * halves of the claim need pinning: that it appears when a mod is on, and that
 * a vanilla dump is byte-for-byte what it was before this existed.
 * ------------------------------------------------------------------ */
describe("character dump - enabled mods", () => {
  const dumpOf = (mods?: readonly { id: string; version: string }[]): string =>
    buildCharacterDump(makeTestState(loc(2, 2)), "Fred", mods ? { mods } : {});

  it("writes the block, one line per mod, in the order given", () => {
    const text = dumpOf([
      { id: "qol", version: "0.4.1" },
      { id: "feature-restoration", version: "0.2.0" },
    ]);
    expect(text).toContain("  [Mods enabled]");
    const lines = text.slice(text.indexOf("  [Mods enabled]")).split("\n");
    expect(lines.slice(2, 4)).toEqual(["qol 0.4.1", "feature-restoration 0.2.0"]);
  });

  it("writes NOTHING when no mods are enabled, and nothing for an empty list", () => {
    /* The parity-relevant half. An empty heading would be a line upstream never
     * writes, in the case the parity claim actually covers - so "no mods" has to
     * be the ABSENCE of the block, not an empty one. */
    const vanilla = dumpOf();
    expect(vanilla).not.toContain("[Mods enabled]");
    expect(dumpOf([])).toBe(vanilla);
  });

  it("changes a dump in no other way than by appending that block", () => {
    /* Guards against the block being threaded through something that also
     * reorders or re-renders an earlier section: everything before it must be
     * the unmodded dump, unchanged. */
    const withMods = dumpOf([{ id: "qol", version: "0.4.1" }]);
    expect(withMods.startsWith(dumpOf())).toBe(true);
  });
});