/**
 * The wizard/debug prompt ratchet.
 *
 * Every prompt on this surface used to be written in our own words. The text
 * census can measure whether upstream's literal is PRESENT, but it cannot see a
 * paraphrase sitting where the literal should be - which is exactly how "How
 * many good objects?" (no trailing space, on a full-screen numeric editor) and
 * "Cured." (where upstream prints "You feel *much* better!") survived a
 * completeness pass. So this file does two things the census cannot:
 *
 *   1. holds the exact C literal for each prompt, with its cmd-wizard.c line,
 *      and fails if wizard.ts stops containing it;
 *   2. holds the paraphrases that were once there and fails if any comes back.
 *
 * Plus a few live drives, because a string can be present and still be asked in
 * the wrong place: the prompts are read off row 0 of a real GlyphTerm-shaped
 * fake after dispatching the command.
 */

import { describe, expect, it, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { dispatchDebug, STATS_DISABLED_MSG } from "./wizard";
import type { WizardUiCtx } from "./wizard";
import type { GameState, WizardDeps } from "@neo-angband/core";
import type { GlyphTerm } from "./term";

/**
 * wizard.ts with its comments removed. Both halves of this file have to read the
 * CODE, not the prose: the docblocks here deliberately quote the paraphrases
 * they replaced, and a literal that only appears in a comment is not ported.
 * (The text census learned the same lesson - see its comment-stripping pass.)
 */
const SRC = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "wizard.ts"),
  "utf8",
)
  .replace(/\/\*[\s\S]*?\*\//gu, "")
  /* eslint-disable-next-line no-control-regex -- a literal tab, not a control class */
  .replace(/^[ 	]*\/\/.*$/gmu, "");

/* ------------------------------------------------------------------ *
 * 1. The exact literals, each with the C line it came from.
 * ------------------------------------------------------------------ */

/** prompt -> where it lives in the reference tree. */
const EXACT: Record<string, string> = {
  /* Items */
  "How many good objects? ": "cmd-wizard.c:400 get_quantity",
  "How many great objects? ": "cmd-wizard.c:400 get_quantity",
  "Create which object (0-": "cmd-wizard.c:882 (0-%d, k_max - 1)",
  "Create which artifact (1-": "cmd-wizard.c:851 (1-%d, a_max - 1)",
  "Create all items of which tval (1-": "cmd-wizard.c:813 (1-%d, TV_MAX - 1)",
  "Play with which object? ": "cmd-wizard.c:1631 get_item",
  "You have nothing to play with.": "cmd-wizard.c:1632 get_item's refusal",
  "[a]ccept [s]tatistics [r]eroll [t]weak [c]urse [q]uantity [k]nown? ":
    "cmd-wizard.c:1675 get_com",
  "Changes ignored.": "cmd-wizard.c:1809 done_msg",
  "Roll as [n]ormal, [g]ood, or [e]xcellent? ": "cmd-wizard.c:2278 get_com",
  "Roll for [n]ormal, [g]ood, or [e]xcellent treasure? ": "cmd-wizard.c:2417 get_com",
  "Depth for treasure (0-": "cmd-wizard.c:2450 (0-%d, max_depth - 1)",
  "Rolls: ": "cmd-wizard.c:2389 repfmt",
  ", Matches: ": "cmd-wizard.c:2389 repfmt",
  "Enter curse name or index: ": "cmd-wizard.c:1024 get_string",
  "Enter curse power (0 removes): ": "cmd-wizard.c:1038 get_string",
  "Enter ego item: ": "cmd-wizard.c:2742 get_string",
  "Enter new artifact: ": "cmd-wizard.c:2781 get_string",
  "Enter new ": "cmd-wizard.c:2824 WIZ_TWEAK's \"Enter new %s setting: \"",
  " setting: ": "cmd-wizard.c:2824 WIZ_TWEAK",
  "AC bonus": "cmd-wizard.c:2842 WIZ_TWEAK(to_a, ...)",
  "to-hit": "cmd-wizard.c:2843 WIZ_TWEAK(to_h, ...)",
  "to-dam": "cmd-wizard.c:2844 WIZ_TWEAK(to_d, ...)",
  "Quantity (1-": "cmd-wizard.c:525 \"Quantity (1-%d): \"",

  /* Player */
  "Gain how much experience? ": "cmd-wizard.c:1319 get_quantity",
  " (3-118): ": "cmd-wizard.c:1276 \"%s (3-118): \" over stat_idx_to_name",
  "Edit which stat (name or 0-": "cmd-wizard.c:1256 (name or 0-%d, STAT_MAX - 1)",
  "Acquire great objects? ": "cmd-wizard.c:394 get_check",
  "Create instant artifacts? ": "cmd-wizard.c:821 get_check",
  "Learn object kinds up to level (0-100)? ": "cmd-wizard.c:1393 get_string",
  "Teleport range? ": "cmd-wizard.c:2659 get_string",
  "Gold: ": "cmd-wizard.c:1179 get_string",
  "Experience: ": "cmd-wizard.c:1147 get_string",
  "Full recall for [a]ll monsters or [s]pecific monster? ": "cmd-wizard.c:2169 get_com",
  "Wipe recall for [a]ll monsters or [s]pecific monster? ": "cmd-wizard.c:2868 get_com",
  "Which monster? ": "cmd-wizard.c:2173 / :2872 get_string",
  "No monster found.": "cmd-wizard.c:2200 / :2598 / :2899",

  /* Teleport */
  "Jump to level (0-": "cmd-wizard.c:1346 (0-%d, max_depth - 1)",
  "Choose cave profile? ": "cmd-wizard.c:1361 get_check",

  /* Effects */
  "Do which effect: ": "cmd-wizard.c:1537 get_string",
  "No effect found.": "cmd-wizard.c:1546 msg",
  "Enter damage dice (eg 1+2d6M2): ": "cmd-wizard.c:1552 get_string",
  "Enter name or number for effect subtype: ": "cmd-wizard.c:1559 get_string",
  "Enter second parameter (radius): ": "cmd-wizard.c:1567 get_quantity",
  "Enter third parameter (other): ": "cmd-wizard.c:1568 get_quantity",
  "Enter y parameter: ": "cmd-wizard.c:1569 get_quantity",
  "Enter x parameter: ": "cmd-wizard.c:1570 get_quantity",
  "Identified!": "cmd-wizard.c:1578 msg",

  /* Summon */
  "Summon which monster? ": "cmd-wizard.c:2582 get_string",
  "How many monsters? ": "cmd-wizard.c:2634 get_quantity",

  /* Files */
  "Title for map: ": "cmd-wizard.c:1120 get_string",
  "Map of level ": "cmd-wizard.c:1118 the title default",

  /* Statistics (all three gate on stats_are_enabled first) */
  "Statistics generation not turned on in this build.": "wiz-stats.c:3164 msg",
  "Number of simulations: ": "cmd-wizard.c:599 / :636 get_string",
  "Stop if disconnected level found? ": "cmd-wizard.c:607 get_check",
  "Type of Sim: Diving (1) or Clearing (2) ": "cmd-wizard.c:646 get_string",
  "Regen randarts (warning SLOW)? ": "cmd-wizard.c:651 get_check",
  "Number of simulations per depth: ": "cmd-wizard.c:682 get_string",
  "Pit type (1-3): ": "cmd-wizard.c:692 get_string",
  "Minimum depth: ": "cmd-wizard.c:702 get_string",
  "Maximum depth: ": "cmd-wizard.c:712 get_string",

  /* Query */
  "Debug Command Feature Query: ": "cmd-wizard.c:1955 get_com",
  "That was an invalid selection.  Use one of fobuztcdhmqgpra .": "cmd-wizard.c:2053 msg",
  "Debug Command Query [grasvwdftniolx]: ": "cmd-wizard.c:2112 get_com",
  "Press any key.": "cmd-wizard.c:2061 / :2137 msg",
  "Depth ": "cmd-wizard.c:1487 / :1498 get_com(format(\"Depth %d: \", i))",

  /* Miscellaneous */
  "Create which trap? ": "cmd-wizard.c:911 get_string",
  "Zap within what distance? ": "cmd-wizard.c:454 get_quantity",
  "Really quit without saving? ": "ui-wizard.c:443 get_check",

  /* wiz_display_item's four data lines (cmd-wizard.c:217-232). */
  "combat = (": "cmd-wizard.c:219",
  "kind = ": "cmd-wizard.c:224",
  "number = ": "cmd-wizard.c:228",
  "FLAGS": "cmd-wizard.c:246-250 the ruled header",
};

/* ------------------------------------------------------------------ *
 * 2. The paraphrases this file exists to keep out. Every one of these
 *    was in wizard.ts before 2026-07-28 and none of them is upstream text.
 * ------------------------------------------------------------------ */

const PARAPHRASES: readonly string[] = [
  /* Invented messages, where the C prints its own line or nothing at all. */
  '"Cured."',
  '"Allocated."',
  '"Monsters banished."',
  '"You feel more experienced."',
  '"Pushed any pile off your square."',
  '"You have lit up the level."',
  '"Changes rejected."',
  '"Changes accepted."',
  '"No such monster."',
  '"Recalled all monsters."',
  '"Erased all monster memory."',
  '"Statistics collectors run in the headless CLI tooling."',
  '"The keystroke log is not recorded by the web shell."',
  /* Invented prompts. */
  "Create object of which kind (kidx)?",
  "Create which artifact (aidx)?",
  "Create all of which tval?",
  "How many good objects?\"",
  "Jump to which dungeon level?",
  "Which race index?",
  "Summon which race index?",
  "Curse power (0 removes it)?",
  "Which curse index (0 removes)?",
  "Reroll: 0 normal, 1 good, 2 excellent?",
  "Set gold to?",
  "Learn kinds up to which object level?",
  "Highlight which feature index?",
  "Highlight grids at which flow depth?",
  "Banish monsters within how many grids?",
  "Create which trap (t_idx)?",
  "Teleport to which column (x)?",
  "Teleport to which row (y)?",
  "Do which effect (name or number)? ",
  "Play with which item?",
  "Peek which flow?",
  "Which square flag?",
  /* Invented menu rows on the play-item session. */
  "Reroll (normal/good/excellent)",
  "Tweak attributes",
  "Change quantity",
  "Accept changes",
  "Reject changes",
];

describe("wizard prompts are exact transcriptions (cmd-wizard.c / ui-wizard.c)", () => {
  for (const [text, where] of Object.entries(EXACT)) {
    it(`contains ${JSON.stringify(text)} (${where})`, () => {
      expect(SRC).toContain(text);
    });
  }

  for (const bad of PARAPHRASES) {
    it(`no longer paraphrases: ${JSON.stringify(bad)}`, () => {
      expect(SRC).not.toContain(bad);
    });
  }

  it("asks with the inline row-0 prompts, never the titled promptNumber screen", () => {
    /* promptNumber clears the terminal and draws its own titled screen, which is
     * not what get_string / get_quantity do (they keep the screen and print at
     * row 0). Its absence here is the structural half of the same fix. */
    expect(SRC).not.toContain("promptNumber");
    expect(SRC).toContain("getString");
    expect(SRC).toContain("getQuantity");
  });
});

/* ------------------------------------------------------------------ *
 * 3. Live drives: the prompt has to appear on row 0, with the C's default.
 * ------------------------------------------------------------------ */

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

function makeTerm(cols = 80, rows = 24): GlyphTerm & { snapshot(): string[] } {
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
    snapshot: () => grid.map((row) => row.join("").replace(/\s+$/u, "")),
  } as unknown as GlyphTerm & { snapshot(): string[] };
}

function makeCtx(_win: FakeWindow): { ctx: WizardUiCtx; said: string[] } {
  const said: string[] = [];
  const player = { noscore: 0, statCur: [10, 10, 10, 10, 10], statMax: [10, 10, 10, 10, 10], au: 0, exp: 0 };
  const deps: WizardDeps = { wizard: true, msg: (t: string) => said.push(t) };
  const state = {
    actor: { player, grid: { x: 5, y: 5 } },
    chunk: { depth: 7 },
    monsters: [],
    z: { maxSight: 20, maxDepth: 128 },
  } as unknown as GameState;
  const ctx: WizardUiCtx = {
    term: makeTerm(),
    state,
    deps,
    say: (t: string) => said.push(t),
    refresh: () => {},
  };
  return { ctx, said };
}

const row0 = (ctx: WizardUiCtx): string =>
  ((ctx.term as GlyphTerm & { snapshot(): string[] }).snapshot()[0] ?? "").trimEnd();

describe("wizard prompts, driven live", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("Acquire good asks get_quantity's own prompt with its default of 1", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const { ctx } = makeCtx(win);
    const done = dispatchDebug(ctx, "acquire-good");
    await tick();
    expect(row0(ctx)).toBe("How many good objects? 1");
    press(win, "Escape");
    await done;
  });

  it("typing over get_quantity's default REPLACES it (askfor_aux firsttime)", async () => {
    /* The hand-rolled quantity prompt this replaced appended to the default, so
     * typing 5 asked for 15. That defect was live in the store's "Buy how
     * many?" too - both now go through the real askfor_aux editor. */
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const { ctx } = makeCtx(win);
    const done = dispatchDebug(ctx, "acquire-great");
    await tick();
    press(win, "5");
    expect(row0(ctx)).toBe("How many great objects? 5");
    press(win, "Escape");
    await done;
  });

  it("Banish defaults to z_info->max_sight, not to a made-up 100", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const { ctx } = makeCtx(win);
    const done = dispatchDebug(ctx, "banish");
    await tick();
    /* get_quantity's default is always "1"; max_sight is the CLAMP, so '*'
     * answers 20 (ui-input.c:1234-1238). */
    expect(row0(ctx)).toBe("Zap within what distance? 1");
    press(win, "Escape");
    await done;
  });

  it("Jump to a level carries the current depth as its default", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const { ctx } = makeCtx(win);
    const done = dispatchDebug(ctx, "jump-level");
    await tick();
    expect(row0(ctx)).toBe("Jump to level (0-127): 7");
    press(win, "Escape");
    await done;
  });

  it("Learn object kinds asks NOTHING (the menu shim sets level 100)", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const { ctx } = makeCtx(win);
    await dispatchDebug(ctx, "learn-kinds");
    /* wiz_learn_all_object_kinds (ui-wizard.c:505) sets the argument, so the
     * command's own prompt is never reached from the menu. */
    expect(row0(ctx)).toBe("");
  });

  it("the three Statistics commands report the build has no collectors", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    for (const action of ["stat-objmon", "stat-pits", "stat-disconnect"]) {
      const { ctx, said } = makeCtx(win);
      await dispatchDebug(ctx, action);
      expect(said).toContain(STATS_DISABLED_MSG);
      expect(row0(ctx)).toBe(""); // the gate returns before any prompt
    }
  });

  it("an unlisted Feature Query key prints upstream's invalid-selection line", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const { ctx, said } = makeCtx(win);
    const done = dispatchDebug(ctx, "query-feature");
    await tick();
    expect(row0(ctx)).toBe("Debug Command Feature Query:");
    press(win, "Z"); // not one of fobuztcdhmqgpra
    await done;
    expect(said).toContain("That was an invalid selection.  Use one of fobuztcdhmqgpra .");
  });

  it("Really quit without saving? is a get_check, so 'n' declines", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const { ctx, said } = makeCtx(win);
    const done = dispatchDebug(ctx, "quit-no-save");
    await tick();
    expect(row0(ctx)).toBe("Really quit without saving? [y/n]");
    press(win, "n");
    await done;
    expect(said).toEqual([]);
  });
});
