import { readFileSync } from "node:fs";
import { describe, expect, it, afterEach } from "vitest";
import {
  runWizardToggle,
  runWizardDebugMenu,
  dispatchDebug,
  DEBUG_MENU,
  WIZARD_ENTRY_MSG_1,
  WIZARD_ENTRY_MSG_2,
  WIZARD_ENTRY_CONFIRM,
  WIZARD_ON_MSG,
  WIZARD_OFF_MSG,
  DEBUG_CONFIRM_MSG_1,
  DEBUG_CONFIRM_MSG_2,
  DEBUG_CONFIRM,
  wizKeylogScreen,
  wizItemScreen,
} from "./wizard";
import type { DebugCategory, DebugCommand, WizardUiCtx, WizKeypress } from "./wizard";
import {
  NOSCORE,
  markNoscore,
  noscoreInvalidatesScore,
  ObjRegistry,
  objectNew,
  newGear,
  calcInventory,
  bindConstants,
  ObjAllocState,
  ArtifactState,
  Rng,
  TV,
  makeRuneEnv,
  wizDisplayItem,
} from "@rpgm-tools/neo-angband-core";
import type {
  GameState,
  WizardDeps,
  ObjPackJson,
  ConstantsJson,
  WizItemDisplay,
} from "@rpgm-tools/neo-angband-core";
import type { GlyphTerm } from "./term";
import { setScreenPresenter } from "./screen-runtime";
import { screenBodyLines, MODELLED_SCREENS } from "./screen-view";
import type { ScreenView, ScreenTableBlock } from "./screen-view";

// The wizard UI drives the repo's keydown-listener modal pattern (selectFromMenu
// / promptNumber from overlay.ts). No jsdom is installed (see overlay.test.ts),
// so a fake `window` + a plain-grid `term` stand in, exactly as that file does.

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

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

function makeTerm(cols = 40, rows = 20): GlyphTerm & { snapshot(): string[] } {
  const grid: string[][] = Array.from({ length: rows }, () => new Array(cols).fill(" "));
  return {
    onCellTap: () => () => undefined,
    size: () => ({ cols, rows }),
    clear: () => {
      for (const row of grid) row.fill(" ");
    },
    /* Term_erase(x, y, 255) + c_prt = erase-then-draw (ui-output.c:385-391).
     * print() is put_str and does NOT erase (ui-output.c:362-379); the two must
     * stay distinguishable in the fake or a prt site cannot be tested. */
    eraseToEol: (x: number, y: number) => {
      const row = grid[y];
      if (row) for (let cx = Math.max(0, x); cx < cols; cx++) row[cx] = " ";
    },
    prt: (x: number, y: number, text: string, _fg?: string) => {
      const row = grid[y];
      if (!row) return;
      for (let cx = Math.max(0, x); cx < cols; cx++) row[cx] = " ";
      for (let i = 0; i < text.length && x + i < cols; i++) row[x + i] = text[i] ?? " ";
    },
    print: (x: number, y: number, text: string) => {
      for (let i = 0; i < text.length && x + i < cols; i++) {
        const row = grid[y];
        if (row) row[x + i] = text[i] ?? " ";
      }
    },
    snapshot: () => grid.map((row) => row.join("").replace(/\s+$/u, "")),
  } as unknown as GlyphTerm & { snapshot(): string[] };
}

/** A minimal ctx: only player.noscore + the message sink matter for these flows. */
function makeCtx(win: FakeWindow, noscore = 0): {
  ctx: WizardUiCtx;
  said: string[];
  player: { noscore: number };
} {
  const player = { noscore };
  const said: string[] = [];
  const deps = (): WizardDeps => ({
    wizard: true,
    /* player_can_debug_prereq reads the live NOSCORE_DEBUG bit, so the shell
     * hands deps in as a getter; mirror that or confirmDebugGate's mid-command
     * consent would not be visible to the command it just unlocked. */
    debug: (player.noscore & NOSCORE.DEBUG) !== 0,
    msg: (t: string) => said.push(t),
    markNoscore: (bits: number) => {
      player.noscore = markNoscore(player.noscore, bits);
    },
  });
  const state = { actor: { player } } as unknown as GameState;
  const ctx: WizardUiCtx = {
    term: makeTerm(),
    state,
    get deps(): WizardDeps {
      return deps();
    },
    say: (t: string) => said.push(t),
    refresh: () => {},
  };
  return { ctx, said, player };
}

describe("wizard entry / debug confirm strings (C oracle)", () => {
  it("matches do_cmd_wizard verbatim (cmd-misc.c L42-60)", () => {
    expect(WIZARD_ENTRY_MSG_1).toBe(
      "You are about to enter 'wizard' mode for the very first time!",
    );
    expect(WIZARD_ENTRY_MSG_2).toBe(
      "This is a form of cheating, and your game will not be scored!",
    );
    expect(WIZARD_ENTRY_CONFIRM).toBe("Are you sure you want to enter wizard mode? ");
    expect(WIZARD_ON_MSG).toBe("Wizard mode on.");
    expect(WIZARD_OFF_MSG).toBe("Wizard mode off.");
  });

  it("matches confirm_debug verbatim (game-input.c L289-294)", () => {
    expect(DEBUG_CONFIRM_MSG_1).toBe(
      "You are about to use the dangerous, unsupported, debug commands!",
    );
    expect(DEBUG_CONFIRM_MSG_2).toBe(
      "Your machine may crash, and your savefile may become corrupted!",
    );
    expect(DEBUG_CONFIRM).toBe("Are you sure you want to use the debug commands? ");
  });
});

describe("DEBUG_MENU structure (ui-game.c L234-322)", () => {
  it("has the nine categories in upstream order", () => {
    expect(DEBUG_MENU.map((c) => c.title)).toEqual([
      "Items",
      "Player",
      "Teleport",
      "Effects",
      "Summon",
      "Files",
      "Statistics",
      "Query",
      "Miscellaneous",
    ]);
  });

  it("is frozen DEEPLY, so a mod cannot add a row to upstream's table", () => {
    /* These are the C's own tables and the parity tests count their letters.
     * Exported-and-mutable made them an accidental extension point outside the
     * mod system: a pushed row would have no ordering, appear in no manifest, and
     * survive disabling the mod that added it. A SHALLOW freeze would not close
     * it - the rows anyone would want to add live in `commands`, one level down. */
    const items = DEBUG_MENU.find((c) => c.title === "Items")!;
    const before = items.commands.length;
    const firstLetter = items.commands[0]?.letter;
    try {
      expect(() => (DEBUG_MENU as DebugCategory[]).push(items)).toThrow(TypeError);
      expect(() =>
        (items.commands as DebugCommand[]).push({ letter: "!", label: "x", action: "x" }),
      ).toThrow(TypeError);
      expect(() => {
        (items.commands[0] as { letter: string }).letter = "!";
      }).toThrow(TypeError);
      expect(DEBUG_MENU).toHaveLength(9);
      expect(items.commands).toHaveLength(before);
      expect(items.commands[0]?.letter).toBe("c");
    } finally {
      /* If a freeze is ever lost these writes SUCCEED, and this test would leave
       * a bogus row and a mangled letter in the shared table for every test after
       * it. Undo, so the failure reads as this assertion rather than a cascade
       * through the parity tests below.
       *
       * Each undo needs its OWN catch. The freeze can be lost at one level and
       * held at another - a shallow freeze is exactly that case - and one shared
       * try would let the first still-frozen write abort the undos after it. */
      const undo = (f: () => void): void => {
        try {
          f();
        } catch {
          /* that level is still frozen, which is the passing case */
        }
      };
      undo(() => ((DEBUG_MENU as DebugCategory[]).length = 9));
      undo(() => ((items.commands as DebugCommand[]).length = before));
      undo(() => ((items.commands[0] as { letter: string }).letter = firstLetter ?? "c"));
    }
  });

  it("locks the faithful command letters per category", () => {
    const byTitle = (t: string) =>
      DEBUG_MENU.find((c) => c.title === t)!.commands.map((cmd) => cmd.letter).join("");
    expect(byTitle("Items")).toBe("cCVgvo"); // cmd_debug_obj
    expect(byTitle("Player")).toBe("aAxhelrW"); // cmd_debug_player
    expect(byTitle("Teleport")).toBe("bptj"); // cmd_debug_tele
    expect(byTitle("Effects")).toBe("dumHEG"); // cmd_debug_effects
    expect(byTitle("Summon")).toBe("ns"); // cmd_debug_summon
    expect(byTitle("Files")).toBe('"M'); // cmd_debug_files
    expect(byTitle("Statistics")).toBe("SPDf"); // cmd_debug_stats
    expect(byTitle("Query")).toBe("Fq_L"); // cmd_debug_query
    expect(byTitle("Miscellaneous")).toBe("wTz>X"); // cmd_debug_misc
  });
});

describe("runWizardToggle (15.1 / cmd-misc.c L37-68)", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("first entry: mentions effects, confirms Yes, marks NOSCORE_WIZARD, turns on", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const { ctx, said, player } = makeCtx(win, 0);
    const done = runWizardToggle(ctx, false);
    await tick();
    // The two "first time" messages were pushed before the confirm.
    expect(said).toContain(WIZARD_ENTRY_MSG_1);
    expect(said).toContain(WIZARD_ENTRY_MSG_2);
    press(win, "y"); // get_check: confirm Yes
    const next = await done;
    expect(next).toBe(true);
    expect(player.noscore & NOSCORE.WIZARD).toBe(NOSCORE.WIZARD);
    expect(said).toContain(WIZARD_ON_MSG);
    // The noscore chain: a wizard character no longer scores (score.c L263).
    expect(noscoreInvalidatesScore(player.noscore)).toBe(true);
  });

  it("first entry declined leaves wizard off and noscore clean", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const { ctx, said, player } = makeCtx(win, 0);
    const done = runWizardToggle(ctx, false);
    await tick();
    press(win, "n"); // get_check: anything but y/Y is "No"
    const next = await done;
    expect(next).toBe(false);
    expect(player.noscore).toBe(0);
    expect(said).not.toContain(WIZARD_ON_MSG);
    expect(noscoreInvalidatesScore(player.noscore)).toBe(false);
  });

  it("subsequent toggle skips the confirm once NOSCORE_WIZARD is set", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const { ctx, said, player } = makeCtx(win, NOSCORE.WIZARD);
    // No key needed: with the bit already set there is no get_check.
    const next = await runWizardToggle(ctx, true);
    expect(next).toBe(false); // was on, toggles off
    expect(said).toContain(WIZARD_OFF_MSG);
    expect(said).not.toContain(WIZARD_ENTRY_MSG_1);
    expect(player.noscore).toBe(NOSCORE.WIZARD); // unchanged
  });
});

describe("runWizardDebugMenu debug gate (15.2 / player-util.c L1296)", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("first use confirms danger and marks NOSCORE_DEBUG", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const { ctx, said, player } = makeCtx(win, NOSCORE.WIZARD);
    const done = runWizardDebugMenu(ctx);
    await tick();
    /* get_com asks for the command key FIRST (ui-game.c L578); the prereq runs
     * only once that key resolves to a real command (L595). */
    press(win, "a"); // Player -> "Cure everything"
    await tick();
    expect(said).toContain(DEBUG_CONFIRM_MSG_1);
    expect(said).toContain(DEBUG_CONFIRM_MSG_2);
    press(win, "n"); // decline the debug confirm -> the command never runs
    await done;
    expect(player.noscore & NOSCORE.DEBUG).toBe(0);
  });

  /**
   * The predecessor of this case asserted that ^A refuses outside wizard mode.
   * That refusal was invented: player_can_debug_prereq (player-util.c L1296-1307)
   * reads only NOSCORE_DEBUG and never player->wizard, so a non-wizard character
   * that accepts the warning gets the whole debug surface. Keep asserting the
   * absence, so the invented gate cannot come back.
   */
  it("never mentions wizard mode: ^A does not consult it", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const { ctx, said, player } = makeCtx(win, 0);
    const done = runWizardDebugMenu(ctx);
    await tick();
    press(win, "a"); // Player -> "Cure everything"
    await tick();
    press(win, "y"); // accept confirm_debug
    await done;
    expect(said.some((s) => s.includes("wizard mode"))).toBe(false);
    expect(player.noscore & NOSCORE.DEBUG).toBe(NOSCORE.DEBUG);
    expect(player.noscore & NOSCORE.WIZARD).toBe(0); // debug consent is not wizard mode
  });
});

describe("edit-player (do_cmd_wiz_edit_player_start, cmd-wizard.c:1252)", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  /** Give the fake player the fields the edit sequence reads for its defaults. */
  function withEditableFields(ctx: WizardUiCtx): void {
    const p = ctx.state.actor.player as unknown as {
      statCur: number[];
      statMax: number[];
      au: number;
      exp: number;
    };
    p.statCur = [10, 11, 12, 13, 14];
    p.statMax = [10, 11, 12, 13, 14];
    p.au = 0;
    p.exp = 0;
  }

  const row0 = (ctx: WizardUiCtx): string =>
    ((ctx.term as GlyphTerm & { snapshot(): string[] }).snapshot()[0] ?? "").trim();

  it("asks each stat by its short code and its stat_max default, no picker", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const { ctx } = makeCtx(win, 0);
    withEditableFields(ctx);
    const done = dispatchDebug(ctx, "edit-player");
    await tick();
    /* Upstream walks straight into the first stat - there is no field menu.
     * The prompt is "%s (3-118): " over stat_idx_to_name, defaulted to
     * player->stat_max[stat] (cmd-wizard.c:1326-1329). */
    expect(row0(ctx)).toContain("STR (3-118): 10");
    expect(row0(ctx)).not.toContain("Strength");
    press(win, "Escape"); // EDIT_PLAYER_BREAK: nothing else is asked
    await done;
  });

  it("walks STR INT WIS DEX CON then Gold then Experience in that order", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const { ctx } = makeCtx(win, 0);
    withEditableFields(ctx);
    const seen: string[] = [];
    const done = dispatchDebug(ctx, "edit-player");
    for (let i = 0; i < 7; i++) {
      await tick();
      seen.push(row0(ctx));
      press(win, "Enter"); // accept the default at each stage
    }
    await tick();
    await done;
    expect(seen.map((s) => s.split(":")[0])).toEqual([
      "STR (3-118)",
      "INT (3-118)",
      "WIS (3-118)",
      "DEX (3-118)",
      "CON (3-118)",
      "Gold",
      "Experience",
    ]);
  });

  it("ESC at INT skips every later stage (edit_player_state EDIT_PLAYER_BREAK)", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const { ctx } = makeCtx(win, 0);
    withEditableFields(ctx);
    const done = dispatchDebug(ctx, "edit-player");
    await tick();
    press(win, "Enter"); // STR accepted
    await tick();
    expect(row0(ctx)).toContain("INT (3-118)");
    press(win, "Escape"); // BREAK
    await tick();
    /* Row 0 is cleared and nothing further is asked - WIS never appears. */
    expect(row0(ctx)).toBe("");
    await done;
  });
});

/* ------------------------------------------------------------------ *
 * The two screens that were tables in a text costume: "Previous
 * keypresses" (wiz_display_keylog) and the item-properties dump
 * (wiz_display_item). Both regression suites below assert against bytes
 * CAPTURED off the unmodified code before it was modelled - see the task
 * notes for how (a throwaway harness driving dispatchDebug and reading
 * term.snapshot(), deleted once the capture was in hand) - so a table that
 * cannot reproduce a row exactly would show up here as a literal mismatch
 * rather than a hand-adjusted expectation.
 * ------------------------------------------------------------------ */

describe("wizKeylogScreen (wiz_display_keylog, ui-wizard.c:96)", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    setScreenPresenter(null);
  });

  /* Most-recent-first: what `wizKeylogScreen` itself consumes, and what
   * `runDisplayKeylog` produces by reversing the ring. */
  const FULL_RING: readonly WizKeypress[] = [
    { text: "5", code: 53, mods: 0 },
    { text: "{^SAM}[ArrowDown]", code: 0, mods: 15 }, // 17 chars: overruns the 12-col pad
    { text: "^A", code: 0, mods: 1 },
    { text: "a", code: 97, mods: 0 },
  ];
  /* Oldest-first: what `ctx.keylog()` itself hands back (WizardUiCtx's own
   * doc comment - "most recent LAST"), which `runDisplayKeylog` reverses. */
  const RING_OLDEST_FIRST: readonly WizKeypress[] = [...FULL_RING].reverse();

  const CAPTURED_FULL = [
    "Previous keypresses (top most recent):",
    "",
    "    5            (code=53 mods=0)",
    "    {^SAM}[ArrowDown] (code=0 mods=15)",
    "    ^A           (code=0 mods=1)",
    "    a            (code=97 mods=0)",
    "",
    "",
    "",
    "",
    "Press any key to continue.",
  ];

  const CAPTURED_EMPTY = [
    "Previous keypresses (top most recent):",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    "Press any key to continue.",
  ];

  it("screenBodyLines(view, 80) reproduces the captured byte grid, full ring", () => {
    const view = wizKeylogScreen(FULL_RING);
    expect(view.id).toBe("core:wizard-keylog");
    const lines = screenBodyLines(view, 80).map((l) => l.text);
    /* screenBodyLines is the BODY only (no title/footer, see screen-view.ts);
     * showTextScreen's own renderer draws the title at row 0 and the body
     * from row 2, which is why the captured title leads this array here even
     * though it never passes through screenBodyLines itself. */
    expect([CAPTURED_FULL[0], "", ...lines]).toEqual(CAPTURED_FULL);
  });

  it("screenBodyLines(view, 80) reproduces the captured byte grid, empty ring", () => {
    const view = wizKeylogScreen([]);
    const lines = screenBodyLines(view, 80).map((l) => l.text);
    expect([CAPTURED_EMPTY[0], "", ...lines]).toEqual(CAPTURED_EMPTY);
  });

  it("exposes code/mods as numeric values, not just the formatted string", () => {
    const view = wizKeylogScreen(FULL_RING);
    const table = view.blocks[0] as ScreenTableBlock;
    expect(table.kind).toBe("table");
    expect(table.rows[0]!.cells["code"]!.values).toEqual({ code: 53 });
    expect(table.rows[0]!.cells["mods"]!.values).toEqual({ mods: 0 });
    /* The long modified key: unpadded, not truncated to 12 - see the "why"
     * comment on wizKeylogScreen for the ScreenColumn.width clamp trap this
     * dodges by baking the text instead of declaring a width. */
    expect(table.rows[1]!.cells["key"]!.text).toBe("    {^SAM}[ArrowDown]");
  });

  it("drives the same bytes end to end through dispatchDebug(\"keylog\")", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(80, 30); // same dimensions as the pre-model capture
    const ctx: WizardUiCtx = {
      term,
      state: {} as unknown as GameState,
      deps: { wizard: true, debug: true } as WizardDeps,
      say: () => {},
      refresh: () => {},
      keylog: () => RING_OLDEST_FIRST,
    };
    const done = dispatchDebug(ctx, "keylog");
    await tick();
    /* Rows past the footer stay blank in the capture too - the footer itself
     * sits far below row 10 on an 80x30 terminal, so this slice never sees it. */
    expect(term.snapshot().slice(0, 11)).toEqual(CAPTURED_FULL);
    press(win, "Escape");
    await done;
  });

  it("offers core:wizard-keylog to a presenter and paints nothing when it is taken", async () => {
    const seen: ScreenView[] = [];
    setScreenPresenter({
      id: "test-presenter",
      presenter: { show: (view) => (seen.push(view), { dismissed: Promise.resolve() }) },
    });
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(80, 30);
    const ctx: WizardUiCtx = {
      term,
      state: {} as unknown as GameState,
      deps: { wizard: true, debug: true } as WizardDeps,
      say: () => {},
      refresh: () => {},
      keylog: () => RING_OLDEST_FIRST,
    };
    await dispatchDebug(ctx, "keylog");
    expect(seen).toHaveLength(1);
    expect(seen[0]!.id).toBe("core:wizard-keylog");
    expect(term.snapshot().every((r) => r === "")).toBe(true);
  });

  it("falls back to the faithful terminal when the presenter declines", async () => {
    setScreenPresenter({ id: "test-presenter", presenter: { show: () => undefined } });
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(80, 30);
    const ctx: WizardUiCtx = {
      term,
      state: {} as unknown as GameState,
      deps: { wizard: true, debug: true } as WizardDeps,
      say: () => {},
      refresh: () => {},
      keylog: () => RING_OLDEST_FIRST,
    };
    const done = dispatchDebug(ctx, "keylog");
    await tick();
    expect(term.snapshot().slice(0, 11)).toEqual(CAPTURED_FULL);
    press(win, "Escape");
    await done;
  });
});

describe("wizItemScreen / drawWizItem (wiz_display_item, cmd-wizard.c:189)", () => {
  function load(name: string): unknown {
    return JSON.parse(
      readFileSync(new URL(`../../content/pack/${name}.json`, import.meta.url), "utf8"),
    );
  }
  const objReg = new ObjRegistry({
    objectBase: load("object_base"),
    object: load("object"),
    egoItem: load("ego_item"),
    artifact: load("artifact"),
    curse: load("curse"),
    brand: load("brand"),
    slay: load("slay"),
    activation: load("activation"),
    objectProperty: load("object_property"),
    flavor: load("flavor"),
  } as ObjPackJson);
  const constants = bindConstants(load("constants") as ConstantsJson);

  /** A real potion via play-item, the same fixture W2-007 (wizard-wiring.test.ts)
   * uses for the same command surface. */
  function potionCtx(): { ctx: WizardUiCtx; term: GlyphTerm & { snapshot(): string[] } } {
    const term = makeTerm(80, 30);
    const kind = objReg.kinds.find((k) => k.tval === TV.POTION)!;
    const obj = objectNew(kind);
    obj.tval = kind.tval;
    obj.sval = kind.sval;
    obj.number = 1;
    obj.weight = kind.weight;
    const gear = newGear();
    gear.store.set(1, obj);
    gear.pack.push(1);
    calcInventory(gear, constants);
    const player = {
      equipment: [],
      objKnown: { dd: 1, ds: 1, ac: 1, toA: 1, toH: 1, toD: 1 },
      upkeep: { playing: true, newSpells: 0, totalWeight: 0, notice: 0, dropping: false },
    };
    const state = {
      actor: { player },
      gear,
      chunk: { depth: 1 },
      rng: new Rng(4242),
      runeEnv: makeRuneEnv(() => null, () => false, {
        brands: objReg.brands,
        slays: objReg.slays,
        curses: objReg.curses,
        properties: objReg.properties,
      }),
    } as unknown as GameState;
    const deps: WizardDeps = {
      wizard: true,
      debug: true,
      makeDeps: {
        reg: objReg,
        alloc: new ObjAllocState(objReg, constants),
        constants,
        artifacts: new ArtifactState(objReg.artifacts.length),
        noArtifacts: false,
      },
      egos: objReg.egos,
      artifacts: objReg.artifacts,
      curses: objReg.curses,
    } as WizardDeps;
    const ctx: WizardUiCtx = { term, state, deps, say: () => {}, refresh: () => {} };
    return { ctx, term };
  }

  /* Trimmed (trailing whitespace stripped), matching makeTerm's own
   * snapshot() - used against term.snapshot() below. */
  const CAPTURED = [
    "[a]ccept [s]tatistics [r]eroll [t]weak [c]urse [q]uantity [k]nown?",
    "",
    "a Potion of Strength",
    "",
    "combat = (0d0) (+0,+0) [0,+0]",
    "kind = 224    tval = 26     sval = 1      wgt = 4       timeout = 0",
    "number = 1    pval = 0      name1 = 0     egoidx = -1    cost = 8000",
    "", "", "", "", "", "", "", "", "",
    "+---------------FLAGS-----------------+",
    "     ppppSFR SFHI BTNII NADSFLL   ETTM",
    "sssssFBCS.ee .rLmBuFFmmFogrtrggDDDxrhu",
    "SIWDCelotDagEIAiplOuuppeTgEiahhiiipprl",
    "tnieoannuiteSncfceueeHSaerxcgttggglIoW",
    "rtsxnrdfnghnPvtetstllPPrlvpkl23123dmwg",
    ".......................................",
    ".......................................",
    "", "", "", "", "", "",
  ];

  /* UNTRIMMED: `screenBodyLines` returns each block's lines exactly as built,
   * with no snapshot-style trailing-whitespace trim - and the five
   * vertically-written label rows above legitimately END in a space (the last
   * of 39 flags, OBJECT_FLAG_ENTRIES' "MAX" sentinel, has an empty
   * `debugLabel`, so every row blanks that column on its first pass). Trimming
   * that space, the way `CAPTURED` above and `makeTerm().snapshot()` both do,
   * throws away real content rather than padding - exactly the trap
   * memory/evidence-rules-index.md files under "a sliced row loses its
   * warning". `CAPTURED.slice(2)` with those five rows patched back to 39
   * characters is what `wizItemScreen` must reproduce byte for byte. */
  /* Rows 2-23 only (22 lines): `wizItemScreen`'s own content, matching what
   * `screenBodyLines` returns. Rows 24-29 in the captured 30-row grid are not
   * this screen's content either, before or after modelling it - they were
   * always just term.clear()'s blank tail below the last painted row, so they
   * belong in a full-grid snapshot comparison, not in a check of the view's
   * own lines. */
  const CAPTURED_RAW_BODY = CAPTURED.slice(2, 24).map((row, i) =>
    i >= 15 && i <= 19 ? `${row} ` : row,
  );

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    setScreenPresenter(null);
  });

  it("MODELLED_SCREENS lists core:wizard-item and core:wizard-keylog", () => {
    expect(MODELLED_SCREENS).toContain("core:wizard-item");
    expect(MODELLED_SCREENS).toContain("core:wizard-keylog");
  });

  it("paints exactly the captured pre-model bytes, via the real play-item path", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const { ctx, term } = potionCtx();
    const done = dispatchDebug(ctx, "play-item");
    await tick();
    press(win, "a"); // get_item: the pack potion
    await tick();
    expect(term.snapshot()).toEqual(CAPTURED);
    press(win, "Escape"); // reject and close the play session
    await tick();
    await done;
  });

  it("wizItemScreen + screenBodyLines(view, 80) reproduces the same rows 2-23", () => {
    const kind = objReg.kinds.find((k) => k.tval === TV.POTION)!;
    const obj = objectNew(kind);
    obj.tval = kind.tval;
    obj.sval = kind.sval;
    obj.number = 1;
    obj.weight = kind.weight;
    const deps: WizardDeps = {
      wizard: true,
      debug: true,
      makeDeps: {
        reg: objReg,
        alloc: new ObjAllocState(objReg, constants),
        constants,
        artifacts: new ArtifactState(objReg.artifacts.length),
        noArtifacts: false,
      },
      curses: objReg.curses,
    } as WizardDeps;
    const disp = wizDisplayItem(obj, deps, { all: true }) as WizItemDisplay;
    const view = wizItemScreen(disp, "a Potion of Strength");
    expect(view.id).toBe("core:wizard-item");
    const lines = screenBodyLines(view, 80).map((l) => l.text);
    /* CAPTURED_RAW_BODY's body starts at row 2; rows 0-1 are the OUTER
     * play-item loop's own getCom prompt, never drawn by this screen. */
    expect(lines).toEqual(CAPTURED_RAW_BODY);
  });

  it("bakes the flags-bits table by flag NAME, not the 5-char debugLabel", () => {
    const kind = objReg.kinds.find((k) => k.tval === TV.POTION)!;
    const obj = objectNew(kind);
    obj.tval = kind.tval;
    obj.sval = kind.sval;
    obj.number = 1;
    obj.weight = kind.weight;
    const deps: WizardDeps = {
      wizard: true,
      debug: true,
      makeDeps: {
        reg: objReg,
        alloc: new ObjAllocState(objReg, constants),
        constants,
        artifacts: new ArtifactState(objReg.artifacts.length),
        noArtifacts: false,
      },
      curses: objReg.curses,
    } as WizardDeps;
    const disp = wizDisplayItem(obj, deps, { all: true }) as WizItemDisplay;
    const view = wizItemScreen(disp, "a Potion of Strength");
    const bits = view.blocks[view.blocks.length - 1] as ScreenTableBlock;
    expect(bits.key).toBe("flags-bits");
    expect(bits.columns.map((c) => c.key)).toContain("SUST_STR");
    expect(bits.columns.some((c) => c.label !== undefined)).toBe(false); // no auto-header
    expect(bits.rows).toHaveLength(2);
    expect(bits.rows[0]!.id).toBe("actual");
    expect(bits.rows[1]!.id).toBe("known");
  });

  it("offers core:wizard-item to a presenter and paints nothing on the terminal", async () => {
    const seen: ScreenView[] = [];
    setScreenPresenter({
      id: "test-presenter",
      /* Never resolves - drawWizItem does not await this, unlike every other
       * showThroughPresenter call site (see its own comment for why: it paints
       * one frame of a loop that reads its next command through getCom, not
       * through this screen's dismissal). */
      presenter: { show: (view) => (seen.push(view), { dismissed: new Promise(() => {}) }) },
    });
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const { ctx, term } = potionCtx();
    const done = dispatchDebug(ctx, "play-item");
    await tick();
    press(win, "a");
    await tick();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.id).toBe("core:wizard-item");
    /* Rows 2+ (this screen's own content) stay blank; row 0 still carries the
     * OUTER loop's getCom prompt, which is not this screen's to withhold. */
    expect(term.snapshot().slice(2).every((r) => r === "")).toBe(true);
    /* And the loop is NOT blocked waiting on the presenter's never-resolving
     * dismissal: the outer getCom still answers the next keypress. */
    press(win, "Escape");
    await done;
  });

  it("falls back to its own paint when the presenter declines", async () => {
    setScreenPresenter({ id: "test-presenter", presenter: { show: () => undefined } });
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const { ctx, term } = potionCtx();
    const done = dispatchDebug(ctx, "play-item");
    await tick();
    press(win, "a");
    await tick();
    expect(term.snapshot()).toEqual(CAPTURED);
    press(win, "Escape");
    await tick();
    await done;
  });
});
