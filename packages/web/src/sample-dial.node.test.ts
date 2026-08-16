/**
 * The `samples/command-dial` mod, exercised as a mod.
 *
 * WHY THIS EXISTS AT ALL. Same reason its two siblings do: a sample in a docs
 * folder is code nobody runs, and this repository has shipped seams whose tests
 * were green while the shipped path did nothing (#245, #246, #247). So the
 * sample is loaded from DISK by its real path, validated by the real manifest
 * validator, selected through the real menu install, and driven through the real
 * `selectFromMenu` - and the number that comes back out is the assertion.
 *
 * WHAT IT PROVES THAT `menu-runtime.test.ts` CANNOT. Those tests hand a
 * fabricated presenter a fabricated question, which will pass for as long as the
 * two agree with each other. This one is a real mod written against the
 * documented shape, answering a real question, and it fails if that shape is
 * wrong. It is also the only place the ROUND TRIP is checked end to end: a
 * question arrives, the mod draws it, a key is pressed at the mod's own
 * listener, and `selectFromMenu` resolves with the caller's own row index.
 *
 * What it canNOT prove is pixels in the installed build; that needs the desktop
 * build over CDP and is recorded separately in MOD_REACH gap 21.
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { installMenu, setMenuPresenter } from "./menu-runtime";
import type { MenuPlugin } from "./menu-runtime";
import { selectFromMenu, setUiFaultReporter } from "./overlay";
import type { MenuItem } from "./overlay";
import type { ModPlugin, ModPluginContext } from "./mod-plugin";
import type { GlyphTerm } from "./term";

const SAMPLE = fileURLToPath(new URL("../../../samples/command-dial/", import.meta.url));
const manifest = JSON.parse(readFileSync(`${SAMPLE}manifest.json`, "utf8")) as Record<string, unknown>;

interface Draw {
  readonly op: string;
  readonly args: readonly unknown[];
}

/** The listeners the mod attached, so a test can be the player. */
interface FakeDoc {
  readonly keys: ((ev: unknown) => void)[];
  readonly element: { style: Record<string, string>; width: number; height: number };
  readonly created: string[];
}

function recordingDocument(draws: Draw[]): { doc: unknown; fake: FakeDoc } {
  const keys: ((ev: unknown) => void)[] = [];
  const created: string[] = [];
  const ctx2d = new Proxy(
    {},
    {
      get: (_t, prop: string) => (...args: unknown[]) => void draws.push({ op: String(prop), args }),
      set(_t, prop: string, value: unknown) {
        draws.push({ op: `set:${prop}`, args: [value] });
        return true;
      },
    },
  );
  const element = {
    id: "",
    style: {} as Record<string, string>,
    width: 0,
    height: 0,
    getContext: (kind: string) => (kind === "2d" ? ctx2d : null),
  };
  return {
    doc: {
      createElement: (tag: string) => {
        created.push(tag);
        return element;
      },
      body: { appendChild: () => undefined },
      addEventListener: (type: string, fn: (ev: unknown) => void) => {
        if (type === "keydown") keys.push(fn);
      },
      removeEventListener: (type: string, fn: (ev: unknown) => void) => {
        const at = keys.indexOf(fn);
        if (type === "keydown" && at >= 0) keys.splice(at, 1);
      },
    },
    fake: { keys, element, created },
  };
}

function press(fake: FakeDoc, key: string): void {
  const ev = { key, preventDefault: () => undefined, stopImmediatePropagation: () => undefined };
  for (const fn of [...fake.keys]) fn(ev);
}

/** A terminal that swallows everything: this test is about the answer. */
function makeTerm(): GlyphTerm {
  return {
    size: () => ({ cols: 60, rows: 24 }),
    clear: () => undefined,
    print: () => undefined,
    put: () => undefined,
    eraseToEol: () => undefined,
    setCursor: () => undefined,
  } as unknown as GlyphTerm;
}

/** The game menu, as `gameMenuEntries()` shapes it: id, label, semantic ref. */
const GAME_MENU: readonly MenuItem[] = [
  { id: "core:game-menu:options", label: "Set options", semantic: { kind: "command", ref: "options" } },
  { id: "core:game-menu:mods", label: "Mods", semantic: { kind: "command", ref: "mods" } },
  { id: "core:game-menu:save", label: "Save and continue", semantic: { kind: "command", ref: "save" } },
  { id: "core:game-menu:quit", label: "Quit to desktop", semantic: { kind: "command", ref: "quit" } },
];

async function install(doc: unknown, faults: string[] = []) {
  const mod = (await import(`${SAMPLE}plugin.js`)) as { default: ModPlugin };
  const candidate: MenuPlugin = {
    id: "command-dial",
    manifest: manifest as never,
    plugin: mod.default,
  };
  (globalThis as { document?: unknown }).document = doc;
  const context = (): ModPluginContext =>
    ({ id: "command-dial", api: 1, log: () => undefined }) as unknown as ModPluginContext;
  const installed = installMenu([candidate], context, (id, message) => faults.push(`${id}: ${message}`));
  setMenuPresenter(installed);
  setUiFaultReporter((id, message) => faults.push(`${id}: ${message}`));
  return installed;
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

afterEach(() => {
  setMenuPresenter(null);
  setUiFaultReporter(() => undefined);
});

describe("samples/command-dial, as the game would load it", () => {
  it("lives in a folder named for its own id", () => {
    /* readPack refuses a mismatch outright, because every other surface (the
     * enabled set, the load order, a save's provenance) keys off the manifest
     * id. A sample is the folder people copy, so the rule holds here first. */
    expect(basename(SAMPLE.replace(/[\\/]$/u, ""))).toBe(manifest.id);
  });

  it("declares the ONE capability its own menu() needs, and no more", () => {
    /* Not the wildcard: a sample that asked for the whole interface to present
     * one menu would teach exactly the habit the separate grants exist to break. */
    expect(manifest.capabilities).toEqual(["ui:menu.replace"]);
    expect(manifest.shape).toBe("plugin");
    expect(typeof manifest.repository).toBe("string");
    expect(typeof manifest.author).toBe("string");
    expect(typeof manifest.engine).toBe("string");
  });

  it("asks the game menu its own way, and resolves with the caller's own index", async () => {
    const draws: Draw[] = [];
    const { doc, fake } = recordingDocument(draws);
    const faults: string[] = [];
    expect((await install(doc, faults))?.id).toBe("command-dial");

    const done = selectFromMenu(makeTerm(), "core:game-menu", "Game menu", GAME_MENU);
    await tick();

    /* It drew, from the question rather than from the terminal: one label per
     * choice, in the game's own order and wording. */
    expect(fake.created).toEqual(["canvas"]);
    const texts = draws.filter((d) => d.op === "fillText").map((d) => String(d.args[0]));
    expect(texts.slice(0, 4)).toEqual(["Set options", "Mods", "Save and continue", "Quit to desktop"]);

    /* And it is taking keys at its OWN listener - which it may, because a
     * presenter that took the question also took its input, so the host never
     * attached the menu's own keydown handler to fight with. */
    expect(fake.keys).toHaveLength(1);
    press(fake, "ArrowRight");
    press(fake, "ArrowRight");
    press(fake, "Enter");

    /* THE ROUND TRIP: the mod answered with a stable choice id, and the caller
     * got back the row index into ITS list. Not the dial's cursor - the dial's
     * order is its own business. */
    expect(await done).toBe(2);
    expect(faults).toEqual([]);
    expect(fake.keys, "the dial left its listener attached").toHaveLength(0);
    expect(fake.element.style.display).toBe("none");
  });

  it("cancels on ESC, exactly as the lettered menu does", async () => {
    const draws: Draw[] = [];
    const { doc, fake } = recordingDocument(draws);
    await install(doc);
    const done = selectFromMenu(makeTerm(), "core:game-menu", "Game menu", GAME_MENU);
    await tick();
    press(fake, "Escape");
    expect(await done).toBeNull();
  });

  it("DECLINES every other menu, and the game asks those itself", async () => {
    /* The point of the seam, made falsifiable. A presenter is offered every menu
     * precisely so it can be choosy: a dial is a good shape for six verbs and a
     * terrible one for a thirty-mod list. */
    const draws: Draw[] = [];
    const { doc, fake } = recordingDocument(draws);
    await install(doc);

    const win = fakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const done = selectFromMenu(makeTerm(), "core:spell-book", "Which book?", [
      { id: "book:a", label: "Magic for Beginners" },
    ]);
    await tick();
    /* Nothing of the mod's ran: no listener, no canvas call after construction. */
    expect(fake.keys).toEqual([]);
    expect(draws.filter((d) => d.op === "fillText")).toEqual([]);
    /* And the game's own menu is up and taking keys. */
    win.press("a");
    expect(await done).toBe(0);
  });

  it("refuses to answer with a disabled choice rather than being refused for it", async () => {
    /* The host would catch this and report it as the mod's fault, costing it
     * the menu. A sample is what authors copy, so it declines to make the
     * mistake instead of relying on being caught. */
    const draws: Draw[] = [];
    const { doc, fake } = recordingDocument(draws);
    const faults: string[] = [];
    await install(doc, faults);
    const done = selectFromMenu(makeTerm(), "core:game-menu", "Game menu", [
      { id: "core:game-menu:save", label: "Save", disabled: true },
      { id: "core:game-menu:quit", label: "Quit" },
    ]);
    await tick();
    press(fake, "Enter"); // on the disabled row the cursor would start on
    expect(faults).toEqual([]);
    press(fake, "ArrowRight");
    press(fake, "Enter");
    expect(await done).toBe(1);
  });

  it("answers by choice id and reads meaning from `semantic`, never from the label", () => {
    /* Asserted against the SOURCE, because a sample that matched on the English
     * word "Quit" or on a row position would draw a correct-looking dial and
     * prove the opposite of the point. */
    const raw = readFileSync(`${SAMPLE}plugin.js`, "utf8");
    /* Comments stripped first, or the docblock explaining what it does not read
     * is itself the match that fails this. */
    const source = raw.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");
    expect(source).toMatch(/choice: choice\.id/u);
    expect(source).toMatch(/semantic\.ref/u);
    expect(source).not.toMatch(/kind: "choose", index/u);
    expect(source).not.toMatch(/=== "Quit/u);
    /* And no imports: a folder plugin gets the engine through ctx. */
    expect(source).not.toMatch(/^\s*import\s/mu);
  });

  it("declines rather than throwing where there is no DOM", async () => {
    /* A throwing menu() costs this mod the menus for the whole session. "Not
     * here" is not a fault. */
    const faults: string[] = [];
    expect(await install(undefined, faults)).toBeNull();
    expect(faults).toEqual([]);
  });
});

/** The host's own keydown target, for the menus the sample declines. */
function fakeWindow(): { press(key: string): void } & Record<string, unknown> {
  const listeners: ((ev: Event) => void)[] = [];
  return {
    addEventListener(type: string, fn: (ev: Event) => void) {
      if (type === "keydown") listeners.push(fn);
    },
    removeEventListener(type: string, fn: (ev: Event) => void) {
      const at = listeners.indexOf(fn);
      if (at >= 0) listeners.splice(at, 1);
    },
    dispatchEvent() {
      return true;
    },
    press(key: string) {
      const ev = new Event("keydown", { cancelable: true }) as Event & { key: string };
      ev.key = key;
      for (const fn of [...listeners]) fn(ev);
    },
  };
}
