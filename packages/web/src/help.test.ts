import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, afterEach } from "vitest";
import {
  coreHelpPageIds,
  helpCommandLines,
  helpCommandsScreen,
  helpCommunityLines,
  helpCommunityScreen,
  helpGuideLines,
  helpGuideScreen,
  helpIndexLabels,
  helpLinesFromText,
  helpSymbolLines,
  helpSymbolsScreen,
  runHelp,
  setModHelpPages,
} from "./help";
import { MODELLED_SCREENS, screenBodyLines, UNMODELLED_SCREEN } from "./screen-view";
import type { ScreenTableBlock, ScreenTextBlock } from "./screen-view";
import { setUiFaultReporter, showTextScreen } from "./overlay";
import { installScreen, setScreenPresenter } from "./screen-runtime";
import type { ScreenPlugin } from "./screen-runtime";
import type { ModPlugin, ModPluginContext } from "./mod-plugin";
import { ENGINE_VERSION } from "@rpgm-tools/neo-angband-core";
import type { GlyphTerm, GridPointerInput, GridSurface } from "./term";

// main.ts's own keydown handler is the ground truth for which keys this port
// implements; help.ts's command reference must never claim a key main.ts does
// not actually wire up (the drift risk the spec flags). Read it as text once.
const MAIN_TS_SOURCE = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
const HELP_TS_SOURCE = readFileSync(new URL("./help.ts", import.meta.url), "utf8");

/** True if `key` is wired to a real branch in main.ts's keydown handler. */
function keyIsWired(key: string): boolean {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`o: "${esc}"`), // original-keyset command-table entry, e.g. `{ o: "q", ...`
    new RegExp(`r: "${esc}"`), // roguelike-keyset command-table entry
    new RegExp(`ev\\.key === "${esc}"`), // an explicit `if (ev.key === "X")` branch (N/?/Escape/ctrl)
  ];
  return patterns.some((re) => re.test(MAIN_TS_SOURCE));
}

describe("helpCommandLines (curated command reference)", () => {
  it("lists only keys that are actually wired in main.ts (drift guard)", () => {
    const singleKeys = [
      "g", "i", "e", "]", "w", "t", "d", "{", "}", "F", "I", "K", "=",
      "m", "p", "G",
      "q", "r", "E", "u", "a", "z", "A",
      "f", "v", "o", "D", "*", "'", "l", "x",
      "C", "S", "N", "V", "Escape", "?", "M", "L",
    ];
    for (const key of singleKeys) {
      expect(keyIsWired(key), `expected main.ts to wire up "${key}"`).toBe(true);
    }
  });

  it("does not advertise upstream commands this port has not implemented", () => {
    const text = helpCommandLines().map((l) => l.text).join("\n");
    for (const forbidden of [
      "Rest for", "Set options", "Check knowledge", "Take notes",
      "Dump screen", "Retire character", "wizard", "Deep Descent",
    ]) {
      expect(text).not.toContain(forbidden);
    }
  });

  it("groups the reference under headers and mentions the real bindings", () => {
    const text = helpCommandLines().map((l) => l.text).join("\n");
    for (const heading of ["Movement", "Items", "Magic", "Devices", "Combat & targeting", "Meta"]) {
      expect(text).toContain(heading);
    }
    expect(text).toContain("Quaff a potion");
    expect(text).toContain("Ctrl-P");
    expect(text).toContain("Escape");
    expect(text).toContain("Display map of entire level");
    expect(text).toContain("Locate player on map");
  });
});

describe("helpSymbolLines (near-verbatim symbols.txt)", () => {
  it("matches the port's store and monster data", () => {
    const text = helpSymbolLines().map((l) => l.text).join("\n");
    expect(text).toContain("Entrance to General Store");
    expect(text).toContain("Entrance to your Home");
    expect(text).toContain("Kobold");
    expect(text).toContain("A staircase down");
    expect(text).toContain("Multiple items");
  });
});

describe("helpGuideLines (curated orientation page)", () => {
  it("states only real port mechanics; no invented rest/Deep Descent claims", () => {
    const text = helpGuideLines().map((l) => l.text).join("\n");
    expect(text.toLowerCase()).not.toContain("rest");
    expect(text).not.toContain("Deep Descent");
    expect(text).not.toContain("Morgoth");
    expect(text.toLowerCase()).toContain("permanent");
    expect(text).toContain("1-8");
  });
});

describe("RNG invariance", () => {
  /*
   * This used to be "help.ts contains no mention of the core package at all",
   * which is a proxy for the real guarantee - pure display, no draw, no game
   * state - and the proxy broke the day the reporting page needed to print the
   * build version. Widening it to "any core import is fine" would give up the
   * guarantee; so the check names the ONE symbol allowed through and is derived
   * from the import line itself, which cannot silently grow a second entry.
   *
   * `t` joined it for MOD_REACH gap 14, and the allowance is deliberate rather
   * than a widening: `t` is a pure lookup in a message catalogue plus string
   * formatting, with no RNG, no game state and no side effect of any kind, which
   * is the property this guard exists to protect. Anything else still fails.
   */
  it("reaches into the engine for the version string and the translator, and nothing else", () => {
    const imports = [
      ...HELP_TS_SOURCE.matchAll(
        /import\s*\{([^}]*)\}\s*from\s*"@rpgm-tools\/neo-angband-core"/gu,
      ),
    ].flatMap((m) => (m[1] ?? "").split(",").map((s) => s.trim()).filter(Boolean));
    expect(imports).toEqual(["ENGINE_VERSION", "t"]);
  });

  it("never touches the RNG or live game state", () => {
    expect(HELP_TS_SOURCE).not.toMatch(/\bRng\b/u);
    expect(HELP_TS_SOURCE).not.toMatch(/\bMath\.random\b/u);
    expect(HELP_TS_SOURCE).not.toMatch(/\bGameState\b/u);
  });

  it("content builders are deterministic across repeated calls", () => {
    expect(helpCommandLines()).toEqual(helpCommandLines());
    expect(helpSymbolLines()).toEqual(helpSymbolLines());
    expect(helpGuideLines()).toEqual(helpGuideLines());
    expect(helpCommunityLines()).toEqual(helpCommunityLines());
  });
});

describe("the help page that tells a player where to go", () => {
  const text = (): string => helpCommunityLines().map((l) => l.text).join("\n");

  it("carries all three routes and the version they will be asked for", () => {
    const t = text();
    expect(t).toContain("discord.gg/YegtwbHTBQ");
    expect(t).toContain("github.com/neostryder/neo-angband/issues");
    expect(t).toContain("strider-angband (at) rpgm.tools");
    expect(t).toContain(ENGINE_VERSION);
  });

  it("keeps the address unscrapeable", () => {
    /* The whole point of writing it the long way: a person reads it, a scraper
     * walking the built page for `mailto:` or `user@host` does not. */
    expect(text()).not.toMatch(/@/u);
  });

  it("fits the 80-column terminal", () => {
    /* showTextScreen slices at cols - 1 and these lines are hand-laid, not
     * wrapped - a URL that runs over loses its end and stops being a URL. */
    for (const line of helpCommunityLines()) {
      expect(line.text.length, `too long: ${line.text}`).toBeLessThanOrEqual(79);
    }
  });

  it("is reachable from the help index", () => {
    expect(helpIndexLabels().some((l) => /wrong/iu.test(l))).toBe(true);
  });
});

// --- runHelp: drive the actual index -> page -> index loop -----------------
// overlay.ts's selectFromMenu/showTextScreen read the keyboard via a plain
// `window.addEventListener("keydown", handler, true)` / removeEventListener
// pair. No jsdom dependency is installed in this repo, so rather than pull
// one in, this is a minimal, spec-correct stand-in: Node's own built-in
// EventTarget does not reliably match a boolean `true` capture flag on
// removeEventListener (verified empirically - it left stale listeners
// registered), which is a Node/browser divergence, not a bug in overlay.ts
// (real browsers match `true` and `{capture: true}` per the DOM spec). This
// fake window normalizes the capture flag itself so add/remove pairs match
// exactly the way a browser would.
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

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

// --- the four pages as ScreenViews -----------------------------------------
/*
 * THE GOLDEN VECTORS, recorded from the hand-laid `ScreenLine[]` builders before
 * the pages had a model and pasted here unchanged.
 *
 * They are the acceptance criterion for the commands and symbols pages, not a
 * regression net bolted on afterwards. Both are near-verbatim from upstream's
 * lib/help/commands.txt and symbols.txt, so parity owns their layout: a model
 * that publishes the key, the glyph and the section headings as data is only
 * allowed if the terminal goes on printing the same bytes. Anything the model
 * gets wrong - a column width, a gap, a blank row between sections - shows up
 * here as a diff rather than as a page nobody looked at.
 */
const COMMANDS_BEFORE = `
Original keyset - only the commands this port implements.

Movement
  1-9        Walk (numpad; diagonals need the numpad)
  Arrows     Walk orthogonally (up/down/left/right)
  (walk in)  Walking onto a shop entrance enters the store

Items
  g          Get objects on the floor
  i          List contents of pack
  e          List equipped items
  ]          List objects you can see
  w          Wear/wield equipment
  t          Take off equipment
  d          Drop an item
  {          Inscribe an object
  }          Uninscribe an object
  F          Fuel your lantern/torch
  I          Inspect an item
  K          Toggle ignoring off

Magic
  m / p      Cast a spell / recite a prayer
  G          Gain (study) new spells/prayers

Devices
  q          Quaff a potion
  r          Read a scroll
  E          Eat some food
  u          Use a staff
  a          Aim a wand
  z          Zap a rod
  A          Activate an item

Combat & targeting
  f          Fire ammo at a target
  v          Throw an item
  o          Open a door or chest
  D          Disarm a trap or lock a door
  *          Target a monster or location
  '          Target the closest monster
  l / x      Look around

Meta
  =          Options menu (interface/birth toggles, ignore setup)
  M          Display map of entire level
  L          Locate player on map
  C          Character description
  S          Save the game
  N          New character (also available after death)
  V          Display the hall of fame
  Ctrl-P     Show previous messages
  Enter      Browse every command by category
  ?          Display this help
  Escape     Game menu (save / switch / new character)

More commands online: angband.readthedocs.io`;

const SYMBOLS_BEFORE = `
Symbols on your map fall into three categories: features of the
dungeon such as walls, floors, doors, and traps; objects that can
be picked up such as treasure, weapons, and magical devices; and
monsters, which may or may not move about, and are mostly harmful.

The "@" symbol (by default) represents your character.

Features that do not block line of sight
  .   A floor space
  .   A trap (hidden)
  1   Entrance to General Store
  ^   A trap (known)
  2   Entrance to Armoury
  ;   A glyph of warding
  3   Entrance to Weapon Smith
  '   An open door
  4   Entrance to Bookseller
  '   A broken door
  5   Entrance to Alchemy Shop
  <   A staircase up
  6   Entrance to Magic Shop
  >   A staircase down
  7   Entrance to the Black Market
  #   A pool of lava
  8   Entrance to your Home

Features that block line of sight
  #   A secret door
  #   A wall
  +   A closed door
  %   A mineral vein
  +   A locked door
  *   A mineral vein with treasure
  :   A pile of rubble
  :   A pile of passable rubble

Objects
  !   A potion (or flask)
  /   A pole-arm
  ?   A scroll (or book)
  |   An edged weapon
  ,   A mushroom (or food)
  \\   A hafted weapon
  -   A wand or rod
  }   A sling, bow, or x-bow
  _   A staff
  {   A shot, arrow, or bolt
  =   A ring
  (   Soft armour
  "   An amulet
  [   Hard armour
  $   Gold or gems
  ]   Misc. armour
  ~   Lights, Tools, Chests, etc
  )   A shield
  &   Multiple items

Monsters
  $   Creeping Coins
  ,   Mushroom Patch
  a   Giant Ant
  A   Ainu
  b   Giant Bat
  B   Bird
  c   Giant Centipede
  C   Canine (Dog)
  d   Dragon
  D   Ancient Dragon
  e   Floating Eye
  E   Elemental
  f   Feline (Cat)
  F   Dragon Fly
  g   Golem
  G   Ghost
  h   Humanoid
  H   Hybrid
  i   Icky-Thing
  I   Insect
  j   Jelly
  J   Snake
  k   Kobold
  K   Killer Beetle
  l   Tree/Ent
  L   Lich
  m   Mold
  M   Multi-Headed Hydra
  n   Naga
  o   Orc
  O   Ogre
  p   Human "person"
  P   Giant "person"
  q   Quadruped
  Q   Quylthulg (Pulsing Flesh Mound)
  r   Rodent
  R   Reptile/Amphibian
  s   Skeleton
  S   Spider/Scorpion/Tick
  t   Townsperson
  T   Troll
  u   Minor Demon
  U   Major Demon
  v   Vortex
  V   Vampire
  w   Worm or Worm Mass
  W   Wight/Wraith
  x   Xorn/Xaren
  y   Yeek
  Y   Yeti
  z   Zombie/Mummy
  Z   Zephyr Hound`;

/** A page's body as one string, the way the golden vectors were recorded. */
function rendered(view: Parameters<typeof screenBodyLines>[0]): string {
  return `\n${screenBodyLines(view, 80).map((l) => l.text).join("\n")}`;
}

describe("the two upstream pages print exactly what they printed before", () => {
  it("renders the commands page byte for byte", () => {
    expect(rendered(helpCommandsScreen())).toBe(COMMANDS_BEFORE);
  });

  it("renders the symbols page byte for byte", () => {
    expect(rendered(helpSymbolsScreen())).toBe(SYMBOLS_BEFORE);
  });

  it("publishes the key and the glyph as cells rather than as a padded field", () => {
    /* The reason the pages were worth modelling at all. `cells.glyph.text` is
     * ONE character, which is the key a tileset mod already looks a sprite up
     * by; a presenter handed "  k   Kobold" would have to count columns. */
    const monsters = helpSymbolsScreen().blocks.find(
      (b): b is ScreenTableBlock => b.kind === "table" && b.key === "monsters",
    );
    expect(monsters?.caption?.text).toBe("Monsters");
    const kobold = monsters?.rows.find((r) => r.cells.glyph?.text === "k");
    expect(kobold?.cells.desc?.text).toBe("Kobold");

    const items = helpCommandsScreen().blocks.find(
      (b): b is ScreenTableBlock => b.kind === "table" && b.key === "items",
    );
    const quaff = helpCommandsScreen().blocks.find(
      (b): b is ScreenTableBlock => b.kind === "table" && b.key === "devices",
    );
    expect(items?.rows.find((r) => r.cells.key?.text === "g")?.cells.desc?.text).toBe(
      "Get objects on the floor",
    );
    expect(quaff?.rows.find((r) => r.cells.key?.text === "q")?.cells.desc?.text).toBe(
      "Quaff a potion",
    );
  });

  it("leaves symbols.txt's own prose on `lines`, where upstream laid it out", () => {
    /* Not an oversight and not a gap: the file's breaks ARE the document, and
     * unwrapping them would move every one of them on the terminal. The four
     * glyph TABLES are what this page gave up, and they are the part a mod can
     * do something with. */
    const first = helpSymbolsScreen().blocks[0];
    expect(first?.kind).toBe("lines");
  });
});

describe("the two port-addition pages give up their wrap instead", () => {
  it("publishes the guide's prose unwrapped, which is the thing a panel re-flows", () => {
    const block = helpGuideScreen().blocks[0];
    if (block?.kind !== "text") throw new Error("the playing guide stopped being prose");
    const longest = Math.max(
      ...block.paragraphs.map((p) => p.map((r) => r.text).join("").length),
    );
    /* Longer than any line the terminal can print: the paragraph is the datum
     * and the wrap is the rendering, which is what a `lines` block never had. */
    expect(longest).toBeGreaterThan(80);
  });

  it("re-flows the guide on the terminal with the same words in the same order", () => {
    /* What changed for the player, stated rather than assumed: the line breaks
     * are the renderer's now instead of the ones typed into the source. These
     * pages are port additions, so there are no upstream bytes to be unfaithful
     * to - only the words, and those are unchanged. */
    const block = helpGuideScreen().blocks[0] as ScreenTextBlock;
    const words = (s: string): string[] => s.split(/\s+/u).filter(Boolean);
    const written = block.paragraphs.flatMap((p) => words(p.map((r) => r.text).join("")));
    const printed = words(helpGuideLines(80).map((l) => l.text).join(" "));
    expect(printed).toEqual(written);
    for (const line of helpGuideLines(80)) {
      expect(line.text.length, `too long: ${line.text}`).toBeLessThanOrEqual(79);
    }
  });

  it("makes the three ways of reaching support a table, not three more lines of prose", () => {
    /* Three routes with an address each is a list, and a list on `lines` is work
     * not yet done. A presenter reads `cells.address.text` and hangs a link on
     * it; the terminal reads the same cell and indents it four columns. */
    const routes = helpCommunityScreen().blocks.filter(
      (b): b is ScreenTableBlock => b.kind === "table",
    );
    expect(routes.map((b) => b.rows[0]?.cells.address?.text)).toEqual([
      "discord.gg/YegtwbHTBQ",
      "github.com/neostryder/neo-angband/issues",
      "strider-angband (at) rpgm.tools",
    ]);
    expect(routes[0]?.rows[0]?.cells.what?.text).toBe("the RPGM Tools Discord");
  });
});

describe("the help pages have given up their models, and say so", () => {
  it("names all four in MODELLED_SCREENS", () => {
    for (const id of [
      "core:help-commands",
      "core:help-symbols",
      "core:help-guide",
      "core:help-community",
    ]) {
      expect(MODELLED_SCREENS).toContain(id);
    }
  });

  it("carries those ids on the views themselves", () => {
    expect([
      helpCommandsScreen().id,
      helpSymbolsScreen().id,
      helpGuideScreen().id,
      helpCommunityScreen().id,
    ]).toEqual([
      "core:help-commands",
      "core:help-symbols",
      "core:help-guide",
      "core:help-community",
    ]);
  });
});

describe("a mod's own page arrives as core:text", () => {
  afterEach(() => {
    setModHelpPages([]);
    setScreenPresenter(null);
    delete (globalThis as { window?: unknown }).window;
  });

  /** Every view offered to the seam, by id; the probe declines all of them. */
  function probe(): string[] {
    const seen: string[] = [];
    setScreenPresenter({
      id: "probe",
      presenter: {
        show: (view) => {
          seen.push(view.id);
          return undefined;
        },
      },
    });
    return seen;
  }

  async function openFirstPage(): Promise<void> {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    void runHelp(makeTerm());
    await tick();
    press(win, "Enter");
    await tick();
    press(win, "Escape");
    await tick();
    press(win, "Escape");
    await tick();
  }

  it("offers core's own page under its own id", async () => {
    const seen = probe();
    await openFirstPage();
    expect(seen).toEqual(["core:help-commands"]);
  });

  it("offers a mod's REPLACEMENT under core:text, not under the id it replaced", async () => {
    /* The whole reason it is written down in help.ts: a `.txt` split on newlines
     * has no columns to address, no paragraph breaks to re-flow and no key or
     * glyph to publish. Handing it `core:help-commands` would promise a presenter
     * a key table and give it pre-wrapped rows, and a mod matching on that id to
     * draw keycaps would draw an empty page with no way to tell why. */
    const seen = probe();
    setModHelpPages([
      { slot: "commands", label: "How to play MY game", lines: helpLinesFromText("press x") },
    ]);
    await openFirstPage();
    expect(seen).toEqual([UNMODELLED_SCREEN]);
    expect(coreHelpPageIds()).toContain("commands");
  });
});

// --- samples/sprite-inventory, taking the help pages -----------------------
/*
 * THE SAMPLE MOD IS THE TEST. A moddability claim with no mod exercising it is
 * not a claim, so the sample is loaded from DISK by its real path, installed
 * through the real screen install and driven through the real `showTextScreen`.
 * The help pages need no game state, which is why the check lives here.
 *
 * WHAT IT ASSERTS IS A STRING THE GAME NEVER WRITES. The symbols legend
 * publishes the glyph as a one-character cell, so the sample prints the sprite
 * key a tileset mod would look it up by - `U+006B` for `k` - and the row COUNT
 * beside each caption. Neither appears anywhere in `screenBodyLines`' output, so
 * neither can have come from re-reading a rendered row; a check that found a
 * string the game also prints would prove nothing at all.
 */
const SAMPLE = fileURLToPath(new URL("../../../samples/sprite-inventory/", import.meta.url));

interface Draw {
  readonly op: string;
  readonly args: readonly unknown[];
}

interface FakeDoc {
  readonly keys: ((ev: unknown) => void)[];
  readonly element: { style: Record<string, string> };
}

function recordingDocument(draws: Draw[]): { doc: unknown; fake: FakeDoc } {
  const keys: ((ev: unknown) => void)[] = [];
  const ctx2d = new Proxy(
    {},
    {
      get: (_t, prop: string) =>
        prop === "measureText"
          ? (...args: unknown[]) => {
              /* A real width, because the prose panel WRAPS on it: seven pixels
               * per character is this fake's monospace. */
              return { width: String(args[0] ?? "").length * 7 };
            }
          : (...args: unknown[]) => void draws.push({ op: String(prop), args }),
      set: () => true,
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
      createElement: () => element,
      body: { appendChild: () => undefined },
      addEventListener: (type: string, fn: (ev: unknown) => void) => {
        if (type === "keydown") keys.push(fn);
      },
      removeEventListener: (type: string, fn: (ev: unknown) => void) => {
        const at = keys.indexOf(fn);
        if (type === "keydown" && at >= 0) keys.splice(at, 1);
      },
    },
    fake: { keys, element },
  };
}

function pressDoc(fake: FakeDoc, key: string): void {
  const ev = { key, preventDefault: () => undefined, stopImmediatePropagation: () => undefined };
  for (const fn of [...fake.keys]) fn(ev);
}

/** A terminal that records what it printed: "who drew it" is the question. */
function makeRecordingTerm(): GridSurface & GridPointerInput & { printed: string[] } {
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

async function installSample(doc: unknown, faults: string[]): Promise<void> {
  const mod = (await import(`${SAMPLE}plugin.js`)) as { default: ModPlugin };
  const candidate: ScreenPlugin = {
    id: "sprite-inventory",
    manifest: JSON.parse(readFileSync(`${SAMPLE}manifest.json`, "utf8")) as never,
    plugin: mod.default,
  };
  (globalThis as { document?: unknown }).document = doc;
  const context = (): ModPluginContext =>
    ({ id: "sprite-inventory", api: 1, log: () => undefined }) as unknown as ModPluginContext;
  setScreenPresenter(
    installScreen([candidate], context, (id, message) => faults.push(`${id}: ${message}`)),
  );
  setUiFaultReporter((id, message) => faults.push(`${id}: ${message}`));
}

/** Every string the sample drew, in order. */
function texts(draws: Draw[]): string[] {
  return draws.filter((d) => d.op === "fillText").map((d) => String(d.args[0]));
}

describe("samples/sprite-inventory draws the help pages from their model", () => {
  afterEach(() => {
    setScreenPresenter(null);
    setUiFaultReporter(() => undefined);
    delete (globalThis as { document?: unknown }).document;
  });

  it("draws the symbol legend by SPRITE KEY, which the game never writes", async () => {
    const draws: Draw[] = [];
    const faults: string[] = [];
    const { doc, fake } = recordingDocument(draws);
    await installSample(doc, faults);
    const term = makeRecordingTerm();

    const view = helpSymbolsScreen();
    const done = showTextScreen(term, view);
    await tick();

    expect(term.printed, "the game drew it as well as the mod").toEqual([]);
    const drawn = texts(draws);
    /* The proof. "U+006B" is the codepoint of the glyph cell for a kobold, which
     * is what a tileset mod indexes its atlas by - and there is no such string
     * anywhere in what the terminal would have printed. */
    const terminal = screenBodyLines(view, 80).map((l) => l.text).join("\n");
    expect(terminal).not.toContain("U+006B");
    expect(drawn).toContain("U+006B");
    /* And a count the terminal has no way to show, because it never computed
     * one: the caption on the page is "Monsters" and nothing else. */
    expect(terminal).not.toContain("Monsters · 52");
    expect(drawn).toContain("Monsters · 52");
    /* The description arrived as its own cell rather than as the tail of a
     * padded row, so it reaches the canvas whole and alone. */
    expect(drawn).toContain("Kobold");

    pressDoc(fake, "Escape");
    await expect(done).resolves.toBeUndefined();
    expect(faults).toEqual([]);
  });

  it("draws the command reference as keycaps, from cells.key", async () => {
    const draws: Draw[] = [];
    const faults: string[] = [];
    const { doc, fake } = recordingDocument(draws);
    await installSample(doc, faults);
    const term = makeRecordingTerm();

    const view = helpCommandsScreen();
    const done = showTextScreen(term, view);
    await tick();

    expect(term.printed).toEqual([]);
    const drawn = texts(draws);
    const terminal = screenBodyLines(view, 80).map((l) => l.text).join("\n");
    expect(terminal).not.toContain("[Ctrl-P]");
    expect(drawn).toContain("[Ctrl-P]");
    expect(drawn).toContain("Show previous messages");

    pressDoc(fake, "Escape");
    await expect(done).resolves.toBeUndefined();
    expect(faults).toEqual([]);
  });

  it("re-flows the playing guide narrower than the terminal could", async () => {
    /* The same comparison the recall pages use, and the payoff for unwrapping a
     * page that has no upstream bytes to be faithful to: the sample measures the
     * paragraphs into a panel the game never chose a width for, so a narrower
     * panel produces MORE rows. A presenter quietly reusing the game's own wrap
     * could not. */
    const draws: Draw[] = [];
    const faults: string[] = [];
    const { doc, fake } = recordingDocument(draws);
    await installSample(doc, faults);
    const term = makeRecordingTerm();

    const view = helpGuideScreen();
    const done = showTextScreen(term, view);
    await tick();

    expect(term.printed).toEqual([]);
    const panelRows = texts(draws).filter((t) => t !== view.title && t !== view.footer).length;
    const terminalRows = screenBodyLines(view, 80).filter((l) => l.text !== "").length;
    expect(terminalRows).toBeGreaterThan(0);
    expect(panelRows).toBeGreaterThan(terminalRows);

    pressDoc(fake, "Escape");
    await expect(done).resolves.toBeUndefined();
    expect(faults).toEqual([]);
  });
});

describe("runHelp (index -> page -> index modal loop)", () => {
  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("opens on the index listing all three topics", () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    void runHelp(term);
    const snap = term.snapshot().join("\n");
    expect(snap).toContain("Angband Help");
    expect(snap).toContain("Available commands");
    expect(snap).toContain("Symbols on your map");
    expect(snap).toContain("Playing guide");
  });

  it("picking a topic renders its page; ESC returns to the index; ESC again exits", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();
    let resolved = false;
    const done = runHelp(term).then(() => { resolved = true; });

    press(win, "Enter"); // pick the first (default-cursor) item: Available commands
    await tick();
    let snap = term.snapshot().join("\n");
    expect(snap).toContain("Angband Help - Commands");
    expect(snap).toContain("Get objects on the floor"); // visible on the first screenful

    press(win, "PageDown"); // scroll to reveal later content (Devices group)
    await tick();
    snap = term.snapshot().join("\n");
    expect(snap).toContain("Quaff a potion");

    press(win, "Escape"); // page ESC: back to the index, not to the game
    await tick();
    expect(term.snapshot().join("\n")).toContain("Angband Help");
    expect(resolved).toBe(false);

    press(win, "Escape"); // index ESC: exits help
    await done;
    expect(resolved).toBe(true);
  });

  it("scrolling the symbols page (a long page) moves the visible window", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(80, 24);
    void runHelp(term);

    press(win, "ArrowDown"); // move cursor to "Symbols on your map"
    await tick();
    press(win, "Enter");
    await tick();
    const before = term.snapshot().join("\n");
    expect(before).toContain("Angband Help - Symbols");
    expect(before).toMatch(/\(1-\d+\/\d+\)/); // showTextScreen's position footer

    press(win, "PageDown");
    await tick();
    const after = term.snapshot().join("\n");
    expect(after).not.toEqual(before); // the visible slice scrolled
    expect(after).toMatch(/\(\d+-\d+\/\d+\)/);

    press(win, "Escape");
    await tick();
    press(win, "Escape");
    await tick();
  });
});
