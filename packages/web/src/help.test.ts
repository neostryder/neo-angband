import { readFileSync } from "node:fs";
import { describe, expect, it, afterEach } from "vitest";
import {
  helpCommandLines,
  helpCommunityLines,
  helpGuideLines,
  helpIndexLabels,
  helpSymbolLines,
  runHelp,
} from "./help";
import { ENGINE_VERSION } from "@rpgm-tools/neo-angband-core";
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
