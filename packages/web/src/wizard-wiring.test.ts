/**
 * Live-path tests for W2 wizard wiring: create-all / teleport-to / tweak via
 * the DEBUG_MENU dispatch surface (runWizardDebugMenu -> dispatchDebug), not
 * by calling the core helpers directly.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, afterEach } from "vitest";
import {
  DEBUG_MENU,
  DEBUG_NESTED_ERROR,
  DEBUG_PROMPT,
  dispatchDebug,
  runWizardDebugMenu,
} from "./wizard";
import type { WizardUiCtx } from "./wizard";
import {
  markNoscore,
  NOSCORE,
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
} from "@neo-angband/core";
import type { GameState, WizardDeps, ObjPackJson, ConstantsJson } from "@neo-angband/core";
import type { GlyphTerm } from "./term";

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
    /* Read the cell grid back, so a test can assert what is actually on a row
     * (the ^A prompt lives on row 0) rather than that a draw call happened. */
    snapshot: () => grid.map((row) => row.join("").replace(/\s+$/u, "")),
  } as unknown as GlyphTerm;
}

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

describe("W2 wizard menu surface (DEBUG_MENU labels)", () => {
  it("keeps faithful Items letters and play-item / create entry points", () => {
    const items = DEBUG_MENU.find((c) => c.title === "Items")!;
    const letters = items.commands.map((c) => c.letter).join("");
    expect(letters).toBe("cCVgvo");
    const actions = items.commands.map((c) => c.action);
    expect(actions).toContain("create-obj");
    expect(actions).toContain("create-artifact");
    expect(actions).toContain("create-all-tval");
    expect(actions).toContain("play-item");
  });

  it("tele-to is the To location action", () => {
    const tele = DEBUG_MENU.find((c) => c.title === "Teleport")!;
    expect(tele.commands.some((c) => c.action === "tele-to")).toBe(true);
  });
});

describe("W2-007 live tweak dispatch", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("drives Play with item -> Tweak attributes through every C field", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: FakeWindow }).window = win;
    const kind = objReg.kinds.find((k) => k.tval === TV.POTION)!;
    const obj = objectNew(kind);
    obj.tval = kind.tval;
    obj.sval = kind.sval;
    obj.number = 1;
    obj.weight = kind.weight;
    const gear = newGear();
    gear.store.set(1, obj);
    gear.pack.push(1);
    /* upkeep->inven[] is derived (calc_inventory) and it is what the item
     * pickers list; a fixture that only fills the master gear list has none. */
    calcInventory(gear, constants);
    const player = {
      equipment: [],
      objKnown: { dd: 1, ds: 1, ac: 1, toA: 1, toH: 1, toD: 1 },
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
    };
    const ctx: WizardUiCtx = {
      term: makeTerm(),
      state,
      deps,
      say: () => {},
      refresh: () => {},
    };

    const done = dispatchDebug(ctx, "play-item");
    await tick();
    press(win, "a"); // get_item: the pack item
    await tick();
    /* The play session's own menu is one get_com line:
     * "[a]ccept [s]tatistics [r]eroll [t]weak [c]urse [q]uantity [k]nown? " */
    press(win, "t"); // [t]weak
    await tick();
    press(win, "Enter"); // ego: keep/remove (-1)
    await tick();
    press(win, "Enter"); // artifact: remove (0)
    for (let i = 0; i < obj.modifiers.length; i++) {
      await tick();
      press(win, "Backspace");
      press(win, String((i % 9) + 1));
      press(win, "Enter");
    }
    for (const value of [11, 12, 13]) {
      await tick();
      press(win, "Backspace");
      for (const digit of String(value)) press(win, digit);
      press(win, "Enter");
    }
    await tick();
    press(win, "a"); // [a]ccept
    await done;

    expect(obj.modifiers).toEqual(obj.modifiers.map((_, i) => (i % 9) + 1));
    expect(obj.toA).toBe(11);
    expect(obj.toH).toBe(12);
    expect(obj.toD).toBe(13);
  });
});

describe("runWizardDebugMenu: the ^A gate is debug consent", () => {
  const g = globalThis as unknown as { window?: FakeWindow };
  let prev: FakeWindow | undefined;

  afterEach(() => {
    if (prev) g.window = prev;
    else delete g.window;
  });

  /**
   * ^A's real gate is player_can_debug_prereq (player-util.c L1296-1307), which
   * reads ONLY the persisted NOSCORE_DEBUG bit. The port used to refuse the whole
   * surface unless wizard mode was also on - an invented prerequisite that made
   * all 41 debug commands unreachable for a non-wizard character - and the test
   * that stood here asserted that refusal was correct, which is why the defect
   * survived. These cases pin the upstream behaviour in both directions, so
   * re-introducing a wizard check fails and so does dropping the consent gate.
   */
  describe("debug consent, not wizard mode, is the ^A gate", () => {
    function debugCtx(wizard: boolean, noscore = 0): {
      ctx: WizardUiCtx;
      said: string[];
      player: { noscore: number };
      term: GlyphTerm & { snapshot(): string[] };
    } {
      const said: string[] = [];
      const player = { noscore };
      const term = makeTerm() as GlyphTerm & { snapshot(): string[] };
      const ctx: WizardUiCtx = {
        term,
        state: { actor: { player } } as unknown as GameState,
        get deps(): WizardDeps {
          return {
            wizard,
            debug: (player.noscore & NOSCORE.DEBUG) !== 0,
            msg: (t) => said.push(t),
            markNoscore: (bits) => {
              player.noscore = markNoscore(player.noscore, bits);
            },
          };
        },
        say: (t) => said.push(t),
        refresh: () => {},
      };
      return { ctx, said, player, term };
    }

    it("asks nested_prompt for one keypress, with no category menu", async () => {
      const win = makeFakeWindow();
      prev = g.window;
      g.window = win;
      const { ctx, term } = debugCtx(false);
      const done = runWizardDebugMenu(ctx);
      await tick();
      /* get_com_ex does prt(prompt, 0, 0) (ui-input.c L1427) - the prompt is on
       * row 0 and nothing has been drawn over the screen. */
      expect((term.snapshot()[0] ?? "").trimEnd()).toBe(DEBUG_PROMPT.trimEnd());
      press(win, "Escape");
      await done;
    });

    it("reports nested_error for an unbound key and never asks for consent", async () => {
      const win = makeFakeWindow();
      prev = g.window;
      g.window = win;
      const { ctx, said, player } = debugCtx(false);
      const done = runWizardDebugMenu(ctx);
      await tick();
      press(win, "~"); // bound to nothing in any cmd_debug_* table
      await done;
      expect(said).toContain(DEBUG_NESTED_ERROR);
      /* The prereq runs AFTER the key resolves (ui-game.c L595), so an unbound
       * key must not have marked the savefile. */
      expect(player.noscore & NOSCORE.DEBUG).toBe(0);
    });

    it("runs a debug command for a NON-wizard character once consent is given", async () => {
      const win = makeFakeWindow();
      prev = g.window;
      g.window = win;
      const { ctx, said, player } = debugCtx(false);
      const done = runWizardDebugMenu(ctx);
      await tick();
      press(win, "a"); // Player -> "Cure everything"
      await tick();
      press(win, "y"); // confirm_debug
      await done;
      /* Consent marked the savefile, and the command was not refused for want of
       * wizard mode. */
      expect(player.noscore & NOSCORE.DEBUG).toBe(NOSCORE.DEBUG);
      expect(said.some((s) => s.includes("wizard mode"))).toBe(false);
    });

    it("declining consent leaves the bit clear and runs nothing", async () => {
      const win = makeFakeWindow();
      prev = g.window;
      g.window = win;
      const { ctx, player } = debugCtx(true);
      const done = runWizardDebugMenu(ctx);
      await tick();
      press(win, "a");
      await tick();
      press(win, "n"); // refuse confirm_debug
      await done;
      expect(player.noscore & NOSCORE.DEBUG).toBe(0);
    });
  });
});
