import { readFileSync } from "node:fs";
import { describe, expect, it, afterEach } from "vitest";
import { helpCommandLines, helpSymbolLines, helpGuideLines, runHelp } from "./help";
import type { GlyphTerm } from "./term";

// main.ts's own keydown handler is the ground truth for which keys this port
// implements; help.ts's command reference must never claim a key main.ts does
// not actually wire up (the drift risk the spec flags). Read it as text once.
const MAIN_TS_SOURCE = readFileSync(new URL("./main.ts", import.meta.url), "utf8");
const HELP_TS_SOURCE = readFileSync(new URL("./help.ts", import.meta.url), "utf8");

/** True if `key` is wired to a real branch in main.ts's keydown handler. */
function keyIsWired(key: string): boolean {
  const esc = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`^\\s*${esc}: `, "m"), // unquoted ITEM_VERBS entry, e.g. "q: () =>"
    new RegExp(`^\\s*"${esc}": `, "m"), // quoted ITEM_VERBS entry, e.g. "\"{\": () =>"
    new RegExp(`ev\\.key === "${esc}"`), // an explicit `if (ev.key === "X")` branch
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
  it("help.ts never imports the core RNG (pure display, no game-random draw)", () => {
    expect(HELP_TS_SOURCE).not.toContain("@neo-angband/core");
    expect(HELP_TS_SOURCE).not.toMatch(/\bRng\b/);
  });

  it("content builders are deterministic across repeated calls", () => {
    expect(helpCommandLines()).toEqual(helpCommandLines());
    expect(helpSymbolLines()).toEqual(helpSymbolLines());
    expect(helpGuideLines()).toEqual(helpGuideLines());
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
    size: () => ({ cols, rows }),
    clear: () => { for (const row of grid) row.fill(" "); },
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
