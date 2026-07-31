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
} from "./wizard";
import type { DebugCategory, DebugCommand, WizardUiCtx } from "./wizard";
import { NOSCORE, markNoscore, noscoreInvalidatesScore } from "@rpgm-tools/neo-angband-core";
import type { GameState, WizardDeps } from "@rpgm-tools/neo-angband-core";
import type { GlyphTerm } from "./term";

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
    // The noscore chain: a wizard character no longer scores (score.c L289).
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

describe("edit-player (do_cmd_wiz_edit_player_start, cmd-wizard.c:1202)", () => {
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
     * player->stat_max[stat] (cmd-wizard.c:1276-1279). */
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
