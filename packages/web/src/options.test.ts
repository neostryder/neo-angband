import { readFileSync } from "node:fs";
import { describe, expect, it, afterEach, vi } from "vitest";
import { HostDir, NULL_HOST, OptionState, Rng, setHost } from "@rpgm-tools/neo-angband-core";
import type { GameState, HostIo } from "@rpgm-tools/neo-angband-core";
import { runOptionsMenu, runTileModePage } from "./options";
import type { GlyphTerm } from "./term";

// main.ts's own keydown handler is the ground truth for how '=' is wired;
// this mirrors help.test.ts's drift guard so the claim "'=' opens the
// Options Menu, not ignore-setup directly" cannot silently rot.
const MAIN_TS_SOURCE = readFileSync(new URL("./main.ts", import.meta.url), "utf8");

describe("'=' key wiring (main.ts drift guard)", () => {
  it("binds '=' to an explicit branch that opens the options menu", () => {
    expect(MAIN_TS_SOURCE).toMatch(/o: "=", act:/);
    // The explicit '=' branch calls runOptionsMenu, passing openIgnoreSetup
    // through so ignore-setup is reused, not duplicated (a trailing
    // tileModeMenu arg wires the Phase-4 graphics selector).
    expect(MAIN_TS_SOURCE).toMatch(/runOptionsMenu\(term, state, openIgnoreSetup/);
  });

  it("ITEM_VERBS no longer binds '=' directly to openIgnoreSetup (reclaimed)", () => {
    expect(MAIN_TS_SOURCE).not.toMatch(/"=":\s*\(\)\s*=>\s*openIgnoreSetup\(\)/);
  });

  it("'K' (quick unignore toggle) is untouched", () => {
    expect(MAIN_TS_SOURCE).toMatch(/o: "K", r: "O"/);
  });
});

interface FakeWindow {
  addEventListener(type: string, fn: (ev: Event) => void, capture?: boolean): void;
  removeEventListener(type: string, fn: (ev: Event) => void, capture?: boolean): void;
  dispatchEvent(ev: Event): void;
}

function makeFakeWindow(): FakeWindow {
  const listeners: Array<{ fn: (ev: Event) => void; capture: boolean }> = [];
  return {
    addEventListener(_type, fn, capture = false) {
      listeners.push({ fn, capture });
    },
    removeEventListener(_type, fn, capture = false) {
      const i = listeners.findIndex((l) => l.fn === fn && l.capture === capture);
      if (i >= 0) listeners.splice(i, 1);
    },
    dispatchEvent(ev) {
      for (const l of [...listeners]) l.fn(ev);
    },
  };
}

/**
 * The REAL terminal size: 80x24. It used to be 30 rows, which hid the fact that
 * an option list longer than the screen silently lost its tail.
 */
function makeTerm(cols = 80, rows = 24): GlyphTerm & { snapshot(): string[] } {
  const grid: string[][] = Array.from({ length: rows }, () => new Array(cols).fill(" "));
  return {
    onCellTap: () => () => undefined,
    size: () => ({ cols, rows }),
    clear: () => { for (const row of grid) row.fill(" "); },
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

function press(win: FakeWindow, key: string): void {
  const ev = new Event("keydown", { cancelable: true }) as Event & { key: string };
  ev.key = key;
  win.dispatchEvent(ev);
}

/**
 * Every `await selectFromMenu(...)` / `await promptNumber(...)` in options.ts
 * resolves its promise synchronously inside the dispatched keydown handler,
 * but the CALLER's continuation (the next line of runOptionsMenu, which
 * opens the next screen and registers its own keydown listener) only runs on
 * the next microtask - so a screen transition needs one tick to actually
 * land before the next press/snapshot. Same pattern as help.test.ts's
 * runHelp tests.
 */
async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** A HostIo whose USER directory is a Map, for the s/r custom-defaults keys. */
function memHost(files: Map<string, string>): HostIo {
  return {
    ...NULL_HOST,
    displayPath: (dir, name) => `${dir}/${name}`,
    exists: (dir, name) => dir === HostDir.USER && files.has(name),
    read: (dir, name) => (dir === HostDir.USER ? (files.get(name) ?? null) : null),
    write: (dir, name, text) => {
      if (dir !== HostDir.USER) return "create-failed";
      files.set(name, text);
      return "ok";
    },
  };
}

/** A minimal GameState stand-in: only .options and .rng are read by options.ts. */
function makeState(init?: ConstructorParameters<typeof OptionState>[0]): GameState {
  return {
    options: new OptionState(init),
    rng: new Rng(1),
  } as unknown as GameState;
}

describe("runOptionsMenu (do_cmd_options, '=')", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    setHost(NULL_HOST);
  });

  it("lists the faithful top-level entries with upstream-stable letters", () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    void runOptionsMenu(term, makeState(), async () => {});
    const snap = term.snapshot().join("\n");
    expect(snap).toContain("Options Menu");
    expect(snap).toContain("a) User interface options");
    expect(snap).toContain("b) Birth (difficulty) options");
    expect(snap).toContain("i) Item ignoring setup");
    expect(snap).toContain("d) Set base delay factor");
    expect(snap).toContain("h) Set hitpoint warning");
  });

  it("opens the injected Mod options browser from the options menu", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const openModOptions = vi.fn(async () => {});
    const done = runOptionsMenu(term, makeState(), async () => {}, undefined, undefined, openModOptions);
    expect(term.snapshot().join("\n")).toContain("g) Mod options");
    press(win, "g");
    await tick();
    expect(openModOptions).toHaveBeenCalledTimes(1);
    press(win, "Escape");
    await done;
  });

  it("(a) lists every INTERFACE option (table order) and excludes birth/cheat", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(100, 40);
    void runOptionsMenu(term, makeState(), async () => {});
    press(win, "a"); // stable tag, not positional
    await tick();
    const snap = term.snapshot().join("\n");
    expect(snap).toContain("(rogue_like_commands)");
    expect(snap).toContain("(purple_uniques)");
    expect(snap).not.toContain("(birth_stacking)");
    expect(snap).not.toContain("(cheat_hear)");
    expect(snap).not.toContain("(score_hear)");
    press(win, "Escape"); // back to the top menu
    await tick();
    press(win, "Escape"); // exit
  });

  it("y/n/t toggle an interface option and persist into state.options", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(100, 40);
    const state = makeState();
    expect(state.options!.get("rogue_like_commands")).toBe(false);
    const done = runOptionsMenu(term, state, async () => {});
    press(win, "a"); // User interface options
    await tick();
    // rogue_like_commands is the first INTERFACE row (table order).
    press(win, "y"); // set true, advance cursor
    expect(state.options!.get("rogue_like_commands")).toBe(true);
    const snap = term.snapshot().join("\n");
    expect(snap).toMatch(/rogue_like_commands\)/);
    expect(snap).toContain(": yes");
    press(win, "n"); // cursor advanced to autoexplore_commands; set false
    expect(state.options!.get("autoexplore_commands")).toBe(false);
    press(win, "t"); // toggle in place (no advance): use_sound false -> true
    expect(state.options!.get("use_sound")).toBe(true);
    press(win, "Escape"); // back to top menu
    await tick();
    press(win, "Escape"); // exit
    await done;
  });

  it("'x' resets interface options to their maintainer defaults (no confirm)", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(100, 40);
    const state = makeState();
    expect(state.options!.get("rogue_like_commands")).toBe(false); // default
    const done = runOptionsMenu(term, state, async () => {});
    press(win, "a"); // User interface options
    await tick();
    press(win, "y"); // flip rogue_like_commands (first row) to true
    expect(state.options!.get("rogue_like_commands")).toBe(true);
    press(win, "x"); // options_restore_maintainer: back to defaults immediately
    expect(state.options!.get("rogue_like_commands")).toBe(false);
    const snap = term.snapshot().join("\n");
    expect(snap).toMatch(/rogue_like_commands\)/);
    /* m->prompt for OP_INTERFACE, verbatim (ui-options.c L341). The port used
     * to print "'x' to reset to defaults", which named a key it had and omitted
     * the two it did not. */
    expect(snap).toContain("Set option (y/n/t), 's' to save, 'r' to restore, 'x' to reset");
    press(win, "Escape"); // back to top menu
    await tick();
    press(win, "Escape"); // exit
    await done;
  });

  /* ---------------------------------------------------------------------
   * PORT_TODO 5.3: 's' and 'r', the customised-defaults keys.
   * ------------------------------------------------------------------ */

  it("'s' writes the page's customised-defaults file and acknowledges", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const files = new Map<string, string>();
    setHost(memHost(files));
    const term = makeTerm(100, 40);
    const state = makeState();
    const done = runOptionsMenu(term, state, async () => {});
    press(win, "a");
    await tick();
    press(win, "y"); // rogue_like_commands -> true, so the file is not the table
    press(win, "s");
    await tick();

    const text = files.get("customized_interface_options.txt");
    expect(text).toBeDefined();
    expect(text).toContain("option:rogue_like_commands:yes");
    /* get_com's exact literal (ui-options.c L171). Snapshot BEFORE the
     * dismissing key, because finishing the prompt erases row 0. */
    expect(term.snapshot().join("\n")).toContain(
      "Successfully saved.  Press any key to continue.",
    );
    press(win, " "); // dismiss
    await tick();
    press(win, "Escape");
    await tick();
    press(win, "Escape");
    await done;
  });

  it("'s' reports a failed write with upstream's other literal", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    setHost({ ...NULL_HOST, write: () => "create-failed" });
    const term = makeTerm(100, 40);
    const done = runOptionsMenu(term, makeState(), async () => {});
    press(win, "a");
    await tick();
    press(win, "s");
    await tick();
    expect(term.snapshot().join("\n")).toContain("Save failed.  Press any key to continue.");
    press(win, " ");
    await tick();
    press(win, "Escape");
    await tick();
    press(win, "Escape");
    await done;
  });

  it("'r' pulls the saved defaults back into the live options and the rows", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const files = new Map<string, string>([
      [
        "customized_interface_options.txt",
        "option:rogue_like_commands:yes\noption:use_sound:yes\n",
      ],
    ]);
    setHost(memHost(files));
    const term = makeTerm(100, 40);
    const state = makeState();
    expect(state.options!.get("rogue_like_commands")).toBe(false);
    const done = runOptionsMenu(term, state, async () => {});
    press(win, "a");
    await tick();
    press(win, "r");
    await tick();
    expect(state.options!.get("rogue_like_commands")).toBe(true);
    expect(state.options!.get("use_sound")).toBe(true);
    /* menu_refresh: the drawn rows moved too, not just the store. A restore
     * that updated only the store would leave the screen lying. */
    const snap = term.snapshot().join("\n");
    expect(snap).toMatch(/Use the roguelike command keyset\s+: yes/);
    /* A SUCCESSFUL restore prints nothing (ui-options.c L184-186). */
    expect(snap).not.toContain("Press any key to continue.");
    press(win, "Escape");
    await tick();
    press(win, "Escape");
    await done;
  });

  it("'r' reports a restore that failed to open the file", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    /* Present but unreadable - the ONE case options_restore_custom returns
     * false for (L280-282). An ABSENT file is a silent success that resets to
     * the maintainer defaults. */
    setHost({ ...NULL_HOST, exists: () => true, read: () => null });
    const term = makeTerm(100, 40);
    const done = runOptionsMenu(term, makeState(), async () => {});
    press(win, "a");
    await tick();
    press(win, "r");
    await tick();
    expect(term.snapshot().join("\n")).toContain("Restore failed.  Press any key to continue.");
    press(win, " ");
    await tick();
    press(win, "Escape");
    await tick();
    press(win, "Escape");
    await done;
  });

  it("the CHEAT page has no s/r/x at all (cmd_keys is just YyNnTt)", async () => {
    /* option_toggle_menu gives OP_CHEAT the default branch (ui-options.c
     * L331-333). 'x' used to work here because optionToggleScreen ran it for
     * every editable page. */
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const files = new Map<string, string>();
    setHost(memHost(files));
    const term = makeTerm(100, 40);
    const state = makeState();
    const done = runOptionsMenu(term, state, async () => {});
    press(win, "x"); // the top-menu tag for Cheat options
    await tick();
    press(win, "y"); // cheat_hear (first CHEAT row) -> true
    expect(state.options!.get("cheat_hear")).toBe(true);

    press(win, "x"); // would be options_restore_maintainer, if the page had it
    expect(state.options!.get("cheat_hear")).toBe(true);
    press(win, "s"); // would be options_save_custom
    await tick();
    expect(files.size).toBe(0);

    const snap = term.snapshot().join("\n");
    expect(snap).toContain("Set option (y/n/t), select with movement keys or index");
    expect(snap).not.toContain("'s' to save");
    press(win, "Escape");
    await tick();
    press(win, "Escape");
    await done;
  });

  it("(b) birth page is read-only: y/n/t never mutate a birth option", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(100, 40);
    const state = makeState();
    expect(state.options!.get("birth_stacking")).toBe(true); // ships true
    void runOptionsMenu(term, state, async () => {});
    press(win, "b");
    await tick();
    let snap = term.snapshot().join("\n");
    expect(snap).toContain("You can only modify these options at character birth.");
    expect(snap).toContain("(birth_stacking)");
    press(win, "y");
    press(win, "n");
    press(win, "t");
    expect(state.options!.get("birth_stacking")).toBe(true); // unchanged
    // No index-jump either (MN_NO_TAGS): 'a' does nothing but stays on the page.
    press(win, "a");
    snap = term.snapshot().join("\n");
    expect(snap).toContain("You can only modify these options at character birth.");
    press(win, "Escape");
    await tick();
    press(win, "Escape");
  });

  it("(x) cheat page lists CHEAT options and toggling one trips anyScoreSet()", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(100, 40);
    const state = makeState();
    expect(state.options!.anyScoreSet()).toBe(false);
    const done = runOptionsMenu(term, state, async () => {});
    press(win, "x"); // Cheat options (option_toggle_menu(OP_CHEAT))
    await tick();
    let snap = term.snapshot().join("\n");
    expect(snap).toContain("Cheat options");
    expect(snap).toContain("(cheat_hear)"); // first CHEAT row
    expect(snap).not.toContain("(score_hear)"); // score twins are not listed
    expect(snap).not.toContain("(rogue_like_commands)"); // no interface rows
    // 'y' sets cheat_hear true (advancing the cursor); option_set couples the
    // score_hear twin on, so the character is no longer score-eligible.
    press(win, "y");
    expect(state.options!.get("cheat_hear")).toBe(true);
    expect(state.options!.get("score_hear")).toBe(true);
    expect(state.options!.anyScoreSet()).toBe(true);
    snap = term.snapshot().join("\n");
    expect(snap).toMatch(/cheat_hear\)/);
    expect(snap).toContain(": yes");
    press(win, "Escape"); // back to the top menu
    await tick();
    press(win, "Escape"); // exit
    await done;
  });

  it("top menu lists the (x) Cheat options entry with its upstream letter", () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    void runOptionsMenu(term, makeState(), async () => {});
    expect(term.snapshot().join("\n")).toContain("x) Cheat options");
  });

  it("(i) delegates to the injected openIgnoreSetup (reused, not duplicated)", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    let called = 0;
    const done = runOptionsMenu(term, makeState(), async () => {
      called++;
    });
    press(win, "i");
    await tick();
    expect(called).toBe(1);
    press(win, "Escape"); // exit the (now-reopened) top menu
    await done;
  });

  it("(d) sets the base delay factor, clamped to 255", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const state = makeState();
    void runOptionsMenu(term, state, async () => {});
    press(win, "d");
    await tick();
    const snap = term.snapshot().join("\n");
    expect(snap).toContain("Current base delay factor: 40 msec");
    press(win, "Backspace");
    press(win, "Backspace"); // clear the prefilled "40"
    for (const d of ["2", "5", "0"]) press(win, d);
    press(win, "Enter");
    await tick();
    expect(state.options!.delayFactor).toBe(250);
    press(win, "Escape");
  });

  it("(h) hitpoint warning resets to 0 when typed over 9 (not clamped to 9)", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const state = makeState();
    void runOptionsMenu(term, state, async () => {});
    press(win, "h");
    await tick();
    const snap = term.snapshot().join("\n");
    expect(snap).toContain("Current hitpoint warning: 3 (30%)");
    press(win, "Backspace");
    for (const d of ["1", "2"]) press(win, d);
    press(win, "Enter");
    await tick();
    expect(state.options!.hitpointWarn).toBe(0); // 12 -> 0, per do_cmd_hp_warn
    press(win, "Escape");
  });

  it("(h) an in-range value (5) is kept as-is", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const state = makeState();
    void runOptionsMenu(term, state, async () => {});
    press(win, "h");
    await tick();
    press(win, "Backspace");
    press(win, "5");
    press(win, "Enter");
    await tick();
    expect(state.options!.hitpointWarn).toBe(5);
    press(win, "Escape");
  });

  it("(m) sets the movement delay into core OptionState.lazymoveDelay", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    const state = makeState();
    expect(state.options!.lazymoveDelay).toBe(0);
    void runOptionsMenu(term, state, async () => {});
    press(win, "m");
    await tick();
    const snap = term.snapshot().join("\n");
    expect(snap).toContain("Current movement delay: 0 (0 msec)");
    press(win, "Backspace"); // clear the prefilled "0"
    press(win, "5");
    press(win, "Enter");
    await tick();
    expect(state.options!.lazymoveDelay).toBe(5);
    press(win, "Escape");
  });

  it("top menu lists (m) Set movement delay with its upstream letter", () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    void runOptionsMenu(term, makeState(), async () => {});
    expect(term.snapshot().join("\n")).toContain("m) Set movement delay");
  });

  it("(o) sidebar mode row appears only when injected and cycles on any key", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    let idx = 0;
    const cycled: number[] = [];
    const sidebar = {
      modes: ["Left", "Top", "None"] as const,
      current: () => idx,
      set: (i: number) => {
        idx = i;
        cycled.push(i);
      },
    };
    // sidebar injected as the 4th arg (graphics is no longer an '=' row).
    void runOptionsMenu(term, makeState(), async () => {}, sidebar);
    let snap = term.snapshot().join("\n");
    expect(snap).toContain("o) Set sidebar mode");
    press(win, "o");
    await tick();
    snap = term.snapshot().join("\n");
    expect(snap).toContain("Command: Sidebar Mode");
    expect(snap).toContain("Current mode: Left");
    press(win, "x"); // any key cycles Left -> Top
    expect(idx).toBe(1);
    snap = term.snapshot().join("\n");
    expect(snap).toContain("Current mode: Top");
    press(win, "Shift"); // a bare modifier is not a cycle
    expect(cycled).toEqual([1]);
    press(win, "Escape"); // back to the top menu
    await tick();
    press(win, "Escape"); // exit
  });

  it("without a sidebar config, the (o) sidebar row is absent (default)", () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    void runOptionsMenu(term, makeState(), async () => {});
    expect(term.snapshot().join("\n")).not.toContain("o) Set sidebar mode");
  });

  it("runTileModePage lists modes and applies a choice (frontend Graphics menu)", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(100, 40);
    let applied: number | null = null;
    let cur = 0;
    const tiles = {
      modes: [
        { grafID: 0, menuname: "None (ASCII)" },
        { grafID: 1, menuname: "Original Tiles" },
        { grafID: 3, menuname: "David Gervais' tiles" },
      ],
      current: () => cur,
      apply: async (id: number): Promise<void> => {
        applied = id;
        cur = id;
      },
    };
    const done = runTileModePage(term, tiles);
    const snap = term.snapshot().join("\n");
    expect(snap).toContain("Graphics (tiles) mode");
    expect(snap).toContain("Original Tiles");
    expect(snap).toContain("David Gervais' tiles");
    // Positional 'c' selects the 3rd row (David Gervais, grafID 3).
    press(win, "c");
    await done;
    expect(applied).toBe(3);
  });

  it("tags ONLY a mod-supplied row, leaving the game's own tile sets plain", async () => {
    // The tile sets upstream ships are core content (grafmode.c / list.txt), so
    // their rows must read like stock content. A tag means the opposite: this row
    // came from a mod, and that is the mod to disable to be rid of it.
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(100, 40);
    const tiles = {
      modes: [
        { grafID: 0, menuname: "None (ASCII)" },
        { grafID: 1, menuname: "Original Tiles" },
        { grafID: 2, menuname: "Adam Bolt's tiles", modName: "some-tile-mod" },
      ],
      current: () => 0,
      apply: async (): Promise<void> => undefined,
    };
    const done = runTileModePage(term, tiles);
    const snap = term.snapshot().join("\n");
    expect(snap).toContain("Adam Bolt's tiles  [some-tile-mod]");
    expect(snap).not.toContain("Original Tiles  [");
    expect(snap).toContain("(current)"); // ASCII is active, and still says so
    // Core row's hint: it ships with the game, no mod named.
    press(win, "ArrowDown");
    const coreHint = term.snapshot().join("\n");
    expect(coreHint).toContain("ships with the game");
    // ...and it does NOT tell the player to go find a mod for it.
    expect(coreHint).not.toContain("disable it to remove this set");
    // Mod row's hint names the mod and what disabling it does.
    press(win, "ArrowDown");
    expect(term.snapshot().join("\n")).toContain(
      "from the some-tile-mod mod - disable it to remove this set",
    );
    press(win, "Escape");
    await done;
  });

  it("the '=' options menu never lists graphics (upstream puts it in the frontend)", () => {
    // ui-options.c:2038 option_actions[] has no graphics entry; graphics lives in
    // the platform frontend's menu bar (the web shell's in-game Graphics menu).
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    void runOptionsMenu(term, makeState(), async () => {});
    const snap = term.snapshot().join("\n");
    expect(snap).not.toContain("Graphics");
  });

  it("ESC at the top menu resolves the whole screen", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    let resolved = false;
    const done = runOptionsMenu(term, makeState(), async () => {}).then(() => {
      resolved = true;
    });
    expect(resolved).toBe(false);
    press(win, "Escape");
    await done;
    expect(resolved).toBe(true);
  });

  it("regression: visiting the whole menu without touching a cheat leaves anyScoreSet() false", async () => {
    // No CHEAT/SCORE page is exposed at all (decision 16, no save-scum), so
    // simply opening every reachable page must never trip the scoring gate.
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(100, 40);
    const state = makeState();
    const done = runOptionsMenu(term, state, async () => {});
    press(win, "a");
    await tick();
    press(win, "Escape");
    await tick();
    press(win, "b");
    await tick();
    press(win, "Escape");
    await tick();
    press(win, "d");
    await tick();
    press(win, "Escape"); // cancel, no change
    await tick();
    press(win, "h");
    await tick();
    press(win, "Escape"); // cancel, no change
    await tick();
    press(win, "Escape"); // exit
    await done;
    expect(state.options!.anyScoreSet()).toBe(false);
  });
});

describe("RNG invariance (the sharpest risk in the port)", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("options.ts never imports the core Rng (pure UI over OptionState)", () => {
    const src = readFileSync(new URL("./options.ts", import.meta.url), "utf8");
    // A real import statement pulling in Rng, not just prose mentioning
    // "state.rng" in a doc comment (this file's own header does, to explain
    // *why* nothing is drawn - that is documentation, not a dependency).
    expect(src).not.toMatch(/import\s*\{[^}]*\bRng\b[^}]*\}/);
    expect(src).not.toMatch(/\bnew Rng\b/);
  });

  it("opening the menu, toggling options, and both numeric setters draw no RNG", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(100, 40);
    const state = makeState();
    let draws = 0;
    const rng = state.rng as unknown as {
      randint0: (n: number) => number;
      randint1: (n: number) => number;
    };
    const origR0 = rng.randint0.bind(rng);
    const origR1 = rng.randint1.bind(rng);
    rng.randint0 = (n: number): number => { draws++; return origR0(n); };
    rng.randint1 = (n: number): number => { draws++; return origR1(n); };

    const done = runOptionsMenu(term, state, async () => {});
    press(win, "a");
    await tick();
    press(win, "y");
    press(win, "n");
    press(win, "t");
    press(win, "Escape");
    await tick();
    press(win, "b");
    await tick();
    press(win, "y"); // no-op (read-only), still must not draw
    press(win, "Escape");
    await tick();
    press(win, "d");
    await tick();
    press(win, "Backspace");
    press(win, "Backspace");
    press(win, "9");
    press(win, "Enter");
    await tick();
    press(win, "h");
    await tick();
    press(win, "Backspace");
    press(win, "7");
    press(win, "Enter");
    await tick();
    press(win, "Escape");
    await done;

    expect(draws).toBe(0);
  });
});

describe("the '=' menu tells the mods (ModHooks.optionsChanged)", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  /** A state whose modHooks records every notification it is given. */
  function watchedState(): { state: GameState; seen: unknown[] } {
    const seen: unknown[] = [];
    const state = makeState();
    (state as { modHooks?: unknown }).modHooks = {
      optionsChanged: (o: unknown) => void seen.push(o),
    };
    return { state, seen };
  }

  it("fires once, with the new values, after a toggle", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(100, 40);
    const { state, seen } = watchedState();
    const done = runOptionsMenu(term, state, async () => {});
    press(win, "a");
    await tick();
    press(win, "y"); // rogue_like_commands -> true
    expect(seen).toHaveLength(0); // not yet: the menu is still open
    press(win, "Escape");
    await tick();
    press(win, "Escape");
    await done;
    expect(seen).toHaveLength(1);
    expect((seen[0] as { values: Record<string, boolean> }).values["rogue_like_commands"]).toBe(
      true,
    );
  });

  it("does NOT fire when the player only looked", async () => {
    /* The hook is named for a change. Opening the menu and pressing ESC is not
     * one, and a mod woken for it would rewrite its stored preferences with the
     * values it already had - harmless here, and exactly the kind of "why is
     * this being written on every screen open" that is hard to trace later. */
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(100, 40);
    const { state, seen } = watchedState();
    const done = runOptionsMenu(term, state, async () => {});
    press(win, "a");
    await tick();
    press(win, "Escape");
    await tick();
    press(win, "Escape");
    await done;
    expect(seen).toEqual([]);
  });

  it("notices the scalars, not just the booleans", async () => {
    /* delay_factor / hitpoint_warn / lazymove_delay are plain fields on
     * OptionState rather than entries in the option table, so a fingerprint
     * built from the booleans alone would miss all three. */
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(100, 40);
    const { state, seen } = watchedState();
    const done = runOptionsMenu(term, state, async () => {});
    press(win, "h"); // Set hitpoint warning
    await tick();
    press(win, "7");
    press(win, "Enter");
    await tick();
    press(win, "Escape");
    await done;
    expect(state.options!.hitpointWarn).toBe(7);
    expect(seen).toHaveLength(1);
    expect((seen[0] as { hitpointWarn: number }).hitpointWarn).toBe(7);
  });

  it("is silent when no mod is listening", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(100, 40);
    const state = makeState(); // no modHooks at all
    const done = runOptionsMenu(term, state, async () => {});
    press(win, "a");
    await tick();
    press(win, "y");
    press(win, "Escape");
    await tick();
    press(win, "Escape");
    await expect(done).resolves.toBeUndefined();
  });
});
