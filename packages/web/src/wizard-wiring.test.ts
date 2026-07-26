/**
 * Live-path tests for W2 wizard wiring: create-all / teleport-to / tweak via
 * the DEBUG_MENU dispatch surface (runWizardDebugMenu -> dispatchDebug), not
 * by calling the core helpers directly.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, afterEach } from "vitest";
import {
  DEBUG_MENU,
  dispatchDebug,
  runWizardDebugMenu,
} from "./wizard";
import type { WizardUiCtx } from "./wizard";
import {
  markNoscore,
  ObjRegistry,
  objectNew,
  newGear,
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
    print: (x: number, y: number, text: string) => {
      for (let i = 0; i < text.length && x + i < cols; i++) {
        const row = grid[y];
        if (row) row[x + i] = text[i] ?? " ";
      }
    },
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
    press(win, "a"); // pack item
    await tick();
    press(win, "c"); // Tweak attributes
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
    // [q]uantity (cmd-wizard.c:1770-1789) now occupies row "d" (inserted before
    // Accept/Reject, W1-cmdwiz); Accept changes shifted from "d" to "e".
    press(win, "e"); // Accept changes
    await done;

    expect(obj.modifiers).toEqual(obj.modifiers.map((_, i) => (i % 9) + 1));
    expect(obj.toA).toBe(11);
    expect(obj.toH).toBe(12);
    expect(obj.toD).toBe(13);
  });
});

describe("runWizardDebugMenu still gates on wizard mode", () => {
  const g = globalThis as unknown as { window?: FakeWindow };
  let prev: FakeWindow | undefined;

  afterEach(() => {
    if (prev) g.window = prev;
    else delete g.window;
  });

  it("refuses when not in wizard mode", async () => {
    const win = makeFakeWindow();
    prev = g.window;
    g.window = win;
    const said: string[] = [];
    const player = { noscore: 0 };
    const deps: WizardDeps = {
      wizard: false,
      msg: (t) => said.push(t),
      markNoscore: (bits) => {
        player.noscore = markNoscore(player.noscore, bits);
      },
    };
    const ctx: WizardUiCtx = {
      term: makeTerm(),
      state: { actor: { player } } as unknown as GameState,
      deps,
      say: (t) => said.push(t),
      refresh: () => {},
    };
    await runWizardDebugMenu(ctx);
    expect(said.some((s) => s.includes("wizard mode"))).toBe(true);
  });
});
