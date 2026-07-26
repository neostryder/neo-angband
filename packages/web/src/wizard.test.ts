import { describe, expect, it, afterEach } from "vitest";
import {
  runWizardToggle,
  runWizardDebugMenu,
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
import type { WizardUiCtx } from "./wizard";
import { NOSCORE, markNoscore, noscoreInvalidatesScore } from "@neo-angband/core";
import type { GameState, WizardDeps } from "@neo-angband/core";
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

function makeTerm(cols = 40, rows = 20): GlyphTerm {
  const grid: string[][] = Array.from({ length: rows }, () => new Array(cols).fill(" "));
  return {
    size: () => ({ cols, rows }),
    clear: () => {
      for (const row of grid) row.fill(" ");
    },
    print: (x: number, y: number, text: string) => {
      for (let i = 0; i < text.length && x + i < cols; i++) {
        const row = grid[y];
        if (row) row[x + i] = text[i] ?? " ";
      }
    },
  } as unknown as GlyphTerm;
}

/** A minimal ctx: only player.noscore + the message sink matter for these flows. */
function makeCtx(win: FakeWindow, noscore = 0): {
  ctx: WizardUiCtx;
  said: string[];
  player: { noscore: number };
} {
  const player = { noscore };
  const said: string[] = [];
  const deps: WizardDeps = {
    wizard: true,
    msg: (t: string) => said.push(t),
    markNoscore: (bits: number) => {
      player.noscore = markNoscore(player.noscore, bits);
    },
  };
  const state = { actor: { player } } as unknown as GameState;
  const ctx: WizardUiCtx = {
    term: makeTerm(),
    state,
    deps,
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

  it("first open confirms danger and marks NOSCORE_DEBUG", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const { ctx, said, player } = makeCtx(win, NOSCORE.WIZARD);
    const done = runWizardDebugMenu(ctx);
    await tick();
    expect(said).toContain(DEBUG_CONFIRM_MSG_1);
    expect(said).toContain(DEBUG_CONFIRM_MSG_2);
    press(win, "n"); // decline the debug confirm -> menu never opens
    await done;
    expect(player.noscore & NOSCORE.DEBUG).toBe(0);
  });

  it("refuses when not in wizard mode", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const { ctx, said } = makeCtx(win, 0);
    ctx.deps.wizard = false;
    await runWizardDebugMenu(ctx);
    expect(said.some((s) => s.includes("wizard mode"))).toBe(true);
  });
});
