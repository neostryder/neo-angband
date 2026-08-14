/**
 * The `samples/sprite-inventory` mod, exercised as a mod.
 *
 * WHY THIS EXISTS AT ALL. The same reason its three siblings do: a sample in a
 * docs folder is code nobody runs, and this repository has shipped seams whose
 * tests were green while the shipped path did nothing (#245, #246, #247). So the
 * sample is loaded from DISK by its real path, validated by the real manifest
 * validator, selected through the real screen install, and driven through the
 * real `showTextScreen` - and what it drew is the assertion.
 *
 * HOW IT AVOIDS TESTING A VOCABULARY NOBODY USES. The view here is a fixture, not
 * a live `inventoryScreen` (that needs a whole game state, and `screens.test.ts`
 * already runs the real producer against one). The hazard that creates is precise:
 * a fixture saying `cells.name` would go on passing after the game renamed the
 * key, and the sample would draw blank cards in the shipped build. So the fixture
 * is built from `INVENTORY_COLUMNS` and `EQUIPMENT_COLUMNS` - the game's own
 * exported column contract - and a renamed key fails here too.
 *
 * What it canNOT prove is pixels in the installed build; that needs the desktop
 * build over CDP and is recorded separately in MOD_REACH gap 21.
 */

import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { installScreen, setScreenPresenter } from "./screen-runtime";
import type { ScreenPlugin } from "./screen-runtime";
import { freezeView, SCREEN_FOOTER, type ScreenRow, type ScreenView } from "./screen-view";
import { EQUIPMENT_COLUMNS, INVENTORY_COLUMNS } from "./screens";
import { showTextScreen, setUiFaultReporter } from "./overlay";
import type { ModPlugin, ModPluginContext } from "./mod-plugin";
import type { GridPointerInput, GridSurface } from "./term";

const SAMPLE = fileURLToPath(new URL("../../../samples/sprite-inventory/", import.meta.url));
const manifest = JSON.parse(readFileSync(`${SAMPLE}manifest.json`, "utf8")) as Record<string, unknown>;

interface Draw {
  readonly op: string;
  readonly args: readonly unknown[];
}

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

/** A terminal that records what it printed: "who drew it" is the question. */
function makeTerm(): GridSurface & GridPointerInput & { printed: string[] } {
  const printed: string[] = [];
  return {
    printed,
    size: () => ({ cols: 80, rows: 24 }),
    clear: () => undefined,
    print: (_x: number, _y: number, text: string) => void printed.push(text),
    put: () => undefined,
    eraseToEol: () => undefined,
    setCursor: () => undefined,
  } as unknown as GridSurface & GridPointerInput & { printed: string[] };
}

/* The two views, built from the game's OWN column contract - see the header. */
const PACK_ROW: ScreenRow = {
  id: "core:gear:7",
  semantic: { kind: "item", ref: 7, data: { source: "inventory", slot: 0 } },
  tag: "a",
  color: "#5599ff",
  cells: {
    name: { text: "2 Rations of Food" },
    weight: { text: "   1.0 lb", values: { each: 5, total: 10, number: 2 } },
  },
};

function inventoryView(rows: readonly ScreenRow[] = [PACK_ROW]): ScreenView {
  return freezeView({
    id: "core:inventory",
    title: "Inventory",
    footer: SCREEN_FOOTER,
    blocks: [
      {
        kind: "table",
        key: "pack",
        tagged: true,
        columns: INVENTORY_COLUMNS,
        rows,
        empty: { text: "(nothing carried)", color: "#8a8a8a" },
      },
    ],
  });
}

const EQUIPMENT_VIEW: ScreenView = freezeView({
  id: "core:equipment",
  title: "Equipment",
  footer: SCREEN_FOOTER,
  blocks: [
    {
      kind: "table",
      key: "slots",
      tagged: true,
      columns: EQUIPMENT_COLUMNS,
      rows: [
        {
          id: "core:gear:3",
          semantic: { kind: "item", ref: 3 },
          tag: "a",
          color: "#c0c0c0",
          cells: {
            slot: { text: "Wielding" },
            name: { text: "a Dagger (1d4)" },
            weight: { text: "   1.2 lb", values: { each: 12, total: 12, number: 1 } },
          },
        },
        {
          id: "core:body-slot:1",
          semantic: { kind: "slot", ref: 1, data: { mention: "Shooting" } },
          color: "#8a8a8a",
          disabled: true,
          cells: { slot: { text: "Shooting" }, name: { text: "(nothing)" } },
        },
      ],
    },
  ],
});

async function install(doc: unknown, faults: string[] = []) {
  const mod = (await import(`${SAMPLE}plugin.js`)) as { default: ModPlugin };
  const candidate: ScreenPlugin = {
    id: "sprite-inventory",
    manifest: manifest as never,
    plugin: mod.default,
  };
  (globalThis as { document?: unknown }).document = doc;
  const context = (): ModPluginContext =>
    ({ id: "sprite-inventory", api: 1, log: () => undefined }) as unknown as ModPluginContext;
  const installed = installScreen([candidate], context, (id, message) => faults.push(`${id}: ${message}`));
  setScreenPresenter(installed);
  setUiFaultReporter((id, message) => faults.push(`${id}: ${message}`));
  return installed;
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** Every string the sample drew, in order. */
function texts(draws: Draw[]): string[] {
  return draws.filter((d) => d.op === "fillText").map((d) => String(d.args[0]));
}

afterEach(() => {
  setScreenPresenter(null);
  setUiFaultReporter(() => undefined);
});

describe("samples/sprite-inventory, as the game would load it", () => {
  it("lives in a folder named for its own id", () => {
    expect(basename(SAMPLE.replace(/[\\/]$/u, ""))).toBe(manifest.id);
  });

  it("declares the ONE capability its own screen() needs, and no more", () => {
    /* Not the wildcard: a sample that asked for the whole interface to draw two
     * screens would teach exactly the habit the separate grants exist to break. */
    expect(manifest.capabilities).toEqual(["ui:screen.replace"]);
    expect(manifest.shape).toBe("plugin");
    expect(typeof manifest.repository).toBe("string");
    expect(typeof manifest.author).toBe("string");
    expect(typeof manifest.engine).toBe("string");
  });

  it("draws the inventory from the ROWS, and the game's terminal draws nothing", async () => {
    const draws: Draw[] = [];
    const { doc, fake } = recordingDocument(draws);
    const faults: string[] = [];
    expect((await install(doc, faults))?.id).toBe("sprite-inventory");
    const term = makeTerm();

    const done = showTextScreen(term, inventoryView());
    await tick();

    expect(fake.created).toEqual(["canvas"]);
    expect(term.printed).toEqual([]);
    const drawn = texts(draws);
    expect(drawn).toContain("Inventory");
    expect(drawn).toContain("2 Rations of Food");
    /* The weight came from the NUMBER (10 tenths -> 1.0 lb), not from slicing the
     * formatted "   1.0 lb" cell. That is the whole point of publishing values. */
    expect(drawn).toContain("1.0 lb");
    expect(drawn).toContain("a)");

    press(fake, "Escape");
    await expect(done).resolves.toBeUndefined();
    expect(fake.keys, "the sample left its listener attached").toHaveLength(0);
    expect(fake.element.style.display).toBe("none");
    expect(faults).toEqual([]);
  });

  it("uses the game's own empty wording rather than inventing one", async () => {
    const draws: Draw[] = [];
    const { doc, fake } = recordingDocument(draws);
    await install(doc);
    const done = showTextScreen(makeTerm(), inventoryView([]));
    await tick();
    expect(texts(draws)).toContain("(nothing carried)");
    press(fake, "Escape");
    await done;
  });

  it("draws an empty body slot as a slot, not as gear", async () => {
    /* `semantic.kind === "slot"` is what tells it apart - not the label
     * "(nothing)", which is English and which a translation changes. */
    const draws: Draw[] = [];
    const { doc, fake } = recordingDocument(draws);
    await install(doc);
    const done = showTextScreen(makeTerm(), EQUIPMENT_VIEW);
    await tick();
    const drawn = texts(draws);
    expect(drawn).toContain("Wielding");
    expect(drawn).toContain("a Dagger (1d4)");
    expect(drawn).toContain("Shooting");
    /* The worn row got its weight; the empty slot got none, because it has no
     * weight cell to read a number out of. */
    expect(drawn).toContain("1.2 lb");
    expect(drawn.filter((t) => t.endsWith(" lb"))).toHaveLength(1);
    press(fake, "Escape");
    await done;
  });

  it("DECLINES every other screen, and the game shows those itself", async () => {
    const draws: Draw[] = [];
    const { doc, fake } = recordingDocument(draws);
    const faults: string[] = [];
    await install(doc, faults);
    const term = makeTerm();

    void showTextScreen(term, "Message history", [{ text: "You feel less confused." }]);
    await tick();
    expect(fake.keys).toEqual([]);
    expect(texts(draws)).toEqual([]);
    expect(term.printed.some((t) => t.includes("You feel less confused."))).toBe(true);
    expect(faults).toEqual([]);
  });

  it("reads cells and values, never the rendered row", () => {
    /* Asserted against the SOURCE, because a sample that sliced the formatted
     * text would draw a correct-looking grid and prove the opposite of the point. */
    const raw = readFileSync(`${SAMPLE}plugin.js`, "utf8");
    const source = raw.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");
    expect(source).toMatch(/cells\.name\.text/u);
    expect(source).toMatch(/values\.total/u);
    expect(source).toMatch(/semantic\.kind === "slot"/u);
    /* No parsing of a rendered row, and no matching on the English wording. */
    expect(source).not.toMatch(/\.text\.split\(/u);
    expect(source).not.toMatch(/"\(nothing\)"/u);
    expect(source).not.toMatch(/lb"/u);
    /* And no imports: a folder plugin gets the engine through ctx. */
    expect(source).not.toMatch(/^\s*import\s/mu);
  });

  it("declines rather than throwing where there is no DOM", async () => {
    /* A throwing screen() costs this mod the screens for the whole session.
     * "Not here" is not a fault. */
    const faults: string[] = [];
    expect(await install(undefined, faults)).toBeNull();
    expect(faults).toEqual([]);
  });
});
