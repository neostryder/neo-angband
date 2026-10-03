/**
 * Community mods on the Recommended mods screen, driven through the real menus.
 *
 * The curated list's "community" entries sit on the same screen as the
 * first-party ones but are not vouched for, so the properties held here are
 * about consent rather than layout: the screen asks the community list's
 * repositories at all, a community row installs as third-party (offering the
 * disclaimer first, and installing nothing when it is declined), the bulk
 * recommended actions never touch a community mod, and an update to one is not
 * exempt from the consent gate the way an update to a first-party mod is.
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  gameUpdateModInstaller,
  showRecommendedMods,
  sourceRows,
  type BrowseEntry,
  type ModUpgradeDeps,
} from "./mod-browse";
import { installBlocked, type ModOrigin } from "./mod-consent";
import type { ModRegistry } from "./mod-curated";
import type { DiscoveredMod } from "./mod-discover";
import type { InstallResult } from "./mod-install";
import { selectFromMenu } from "./overlay";
import type { GridPointerInput, GridSurface } from "./term";

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
      const i = listeners.findIndex((l) => l.type === type && l.fn === fn && l.capture === capture);
      if (i >= 0) listeners.splice(i, 1);
    },
    dispatchEvent(ev) {
      for (const l of [...listeners].filter((x) => x.type === ev.type)) l.fn(ev);
    },
  };
}

type Term = GridSurface & GridPointerInput & { text(): string };

function makeTerm(cols = 100, rows = 30): Term {
  const grid: string[][] = Array.from({ length: rows }, () => new Array<string>(cols).fill(" "));
  const write = (x: number, y: number, text: string): void => {
    const row = grid[y];
    if (!row) return;
    for (let i = 0; i < text.length && x + i < cols; i++) row[x + i] = text[i] ?? " ";
  };
  const erase = (x: number, y: number): void => {
    const row = grid[y];
    if (!row) return;
    for (let cx = Math.max(0, x); cx < cols; cx++) row[cx] = " ";
  };
  return {
    size: () => ({ cols, rows }),
    invalidate: () => undefined,
    flush: () => undefined,
    clear: () => {
      for (const row of grid) row.fill(" ");
    },
    setCursor: () => undefined,
    hideCursor: () => undefined,
    put: () => undefined,
    print: (x, y, text) => write(x, y, text),
    eraseToEol: (x, y) => erase(x, y),
    prt: (x, y, text) => {
      erase(x, y);
      write(x, y, text);
    },
    onCellTap: () => () => undefined,
    text: () => grid.map((row) => row.join("").trimEnd()).join("\n"),
  };
}

let win: FakeWindow;

function press(key: string): void {
  const ev = new Event("keydown", { cancelable: true }) as Event & { key: string };
  ev.key = key;
  win.dispatchEvent(ev);
}

/** Wait until the terminal shows `text`, which means its screen is listening. */
async function showing(term: Term, text: string): Promise<void> {
  await vi.waitFor(() => {
    expect(term.text()).toContain(text);
  });
}

const mod = (repo: string, id: string, name: string, author: string): DiscoveredMod => ({
  repo,
  tag: "v1.0.0",
  tags: ["v1.0.0"],
  id,
  name,
  author,
  version: "1.0.0",
  description: `${name} does one thing.`,
  engine: ">=0.18.0",
  screenshots: [],
  compatible: true,
  engineNote: null,
  channelHeld: null,
  engineHeld: null,
  payload: [{ kind: "file", path: "manifest.json" }],
  bytes: 100,
  guessedPayload: false,
});

const QOL = mod("neostryder/neo-angband-mod-qol", "qol", "Quality of Life", "neostryder");
const EXTRA = mod("someone/neo-angband-mod-extra", "extra", "Extra Things", "someone");

const registry: ModRegistry = {
  name: "Neo Angband recommended mods",
  url: "mods/registry.json",
  mods: [{ repo: QOL.repo }],
  community: [{ repo: EXTRA.repo }],
  problems: [],
};

interface Harness {
  readonly deps: ModUpgradeDeps;
  readonly discovered: string[];
  readonly installs: Array<{ id: string; origin: ModOrigin }>;
  allowed: boolean;
}

/**
 * Everything the screens need, in memory. The install refuses exactly as the
 * real installer does (mod-install.ts calls the same `installBlocked`), so a
 * refusal here is the refusal a player would get.
 */
function harness(allowed: boolean): Harness {
  const h: Harness = {
    discovered: [],
    installs: [],
    allowed,
    deps: undefined as unknown as ModUpgradeDeps,
  };
  const byRepo = new Map([QOL, EXTRA].map((m) => [m.repo, m]));
  (h as { deps: ModUpgradeDeps }).deps = {
    installed: () => Promise.resolve(new Map<string, string>()),
    discover: (ref): Promise<BrowseEntry> => {
      h.discovered.push(ref.repo);
      const m = byRepo.get(ref.repo);
      return Promise.resolve(
        m ? { ok: true, ref, mod: m } : { ok: false, ref, problem: "no such repository" },
      );
    },
    install: (m, origin): Promise<InstallResult> => {
      h.installs.push({ id: m.id, origin });
      const blocked = installBlocked(origin, h.allowed);
      return Promise.resolve(
        (blocked === null
          ? { ok: true, meta: { id: m.id, repo: m.repo, tag: m.tag, files: [] } }
          : { ok: false, problem: blocked }) as InstallResult,
      );
    },
    uninstall: () => Promise.resolve(false),
    curated: () => Promise.resolve({ registry, problem: null }),
    registryAt: () => Promise.resolve({ registry: null, problem: "not in this test" }),
    authors: () => Promise.resolve(null),
    consent: {
      read: () => h.allowed,
      write: (allow) => {
        h.allowed = allow;
        return true;
      },
    },
    enabledManifests: () => [],
    readRepoFile: () => Promise.reject(new Error("not in this test")),
    refresh: () => Promise.resolve([]),
  };
  return h;
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

function useWindow(): void {
  win = makeFakeWindow();
  (globalThis as { window?: unknown }).window = win;
}

describe("the Community mods heading", () => {
  const entry = (m: DiscoveredMod): BrowseEntry => ({ ok: true, ref: { repo: m.repo }, mod: m });
  const { items } = sourceRows([entry(QOL)], [entry(EXTRA)], () => null);

  it("is not picked by its own positional letter", async () => {
    useWindow();
    const done = selectFromMenu(makeTerm(), "test:community-rows", "Pick", items);
    press("b"); // the heading's position; a picked heading would resolve 1 here
    press("Escape");
    expect(await done).toBeNull();
  });

  it("is stepped over by the cursor, both ways", async () => {
    useWindow();
    const down = selectFromMenu(makeTerm(), "test:community-rows", "Pick", items);
    press("ArrowDown");
    press("Enter");
    expect(await down).toBe(2);

    const up = selectFromMenu(makeTerm(), "test:community-rows", "Pick", items, undefined, {
      initialCursor: 2,
    });
    press("ArrowUp");
    press("Enter");
    expect(await up).toBe(0);
  });
});

describe("Recommended mods, with a community list", () => {
  it("asks the community list's repositories too, and shows them under their heading", async () => {
    useWindow();
    const h = harness(false);
    const term = makeTerm();
    const done = showRecommendedMods(term, h.deps);
    await showing(term, "Community mods");
    expect(h.discovered).toEqual([QOL.repo, EXTRA.repo]);
    expect(term.text()).toContain("Extra Things");
    press("Escape");
    expect(await done).toBe(false);
  });

  it("offers the disclaimer before a community install, and installs nothing when declined", async () => {
    useWindow();
    const h = harness(false);
    const term = makeTerm();
    const done = showRecommendedMods(term, h.deps);
    await showing(term, "Community mods");
    press("c"); // Extra Things, the row after the heading
    await showing(term, "Install only");
    press("b"); // Install only
    await showing(term, "Before you allow third-party mods");
    press("Escape"); // past the disclaimer, to the question
    await showing(term, "Allow third-party mods?");
    press("a"); // No, not for now
    await showing(term, "Community mods");
    expect(h.installs).toEqual([]);
    expect(h.allowed).toBe(false);
    press("Escape");
    expect(await done).toBe(false);
  });

  it("installs a community mod as third-party once the player allows it", async () => {
    useWindow();
    const h = harness(false);
    const term = makeTerm();
    const done = showRecommendedMods(term, h.deps);
    await showing(term, "Community mods");
    press("c");
    await showing(term, "Install only");
    press("b");
    await showing(term, "Before you allow third-party mods");
    press("Escape");
    await showing(term, "Allow third-party mods?");
    press("b"); // Yes, I understand
    await vi.waitFor(() => {
      expect(h.installs).toEqual([{ id: "extra", origin: "third-party" }]);
    });
    expect(h.allowed).toBe(true);
    await showing(term, "Extra Things 1.0.0 installed");
    press("Escape"); // the outcome screen
    await showing(term, "Community mods");
    press("Escape");
    expect(await done).toBe(true);
  });

  it("still installs a first-party mod as curated, with no consent asked", async () => {
    useWindow();
    const h = harness(false);
    const term = makeTerm();
    const done = showRecommendedMods(term, h.deps);
    await showing(term, "Community mods");
    press("a"); // Quality of Life
    await showing(term, "Install only");
    press("b");
    await vi.waitFor(() => {
      expect(h.installs).toEqual([{ id: "qol", origin: "curated" }]);
    });
    expect(h.allowed).toBe(false);
    await showing(term, "Quality of Life 1.0.0 installed");
    press("Escape");
    await showing(term, "Community mods");
    press("Escape");
    expect(await done).toBe(true);
  });

  it("leaves community mods out of Install all recommended mods", async () => {
    useWindow();
    const h = harness(false);
    const term = makeTerm();
    const done = showRecommendedMods(term, h.deps);
    await showing(term, "Community mods");
    press("d"); // Recommended mod actions...
    await showing(term, "Install all recommended mods");
    press("a");
    await vi.waitFor(() => {
      expect(h.installs).toEqual([{ id: "qol", origin: "curated" }]);
    });
    await showing(term, "Quality of Life 1.0.0 installed");
    press("Escape"); // the outcome screen
    await showing(term, "Recommended mod actions");
    press("Escape");
    await showing(term, "Community mods");
    press("Escape");
    await done;
    expect(h.installs.map((i) => i.id)).not.toContain("extra");
  });
});

describe("an update to a community mod", () => {
  const upgrade = (m: DiscoveredMod): { id: string; repo: string; from: string; to: string } => ({
    id: m.id,
    repo: m.repo,
    from: "v0.9.0",
    to: "v1.0.0",
  });

  it("is third-party, so it is refused while third-party mods are not allowed", async () => {
    useWindow();
    const h = harness(false);
    const installMod = await gameUpdateModInstaller(makeTerm(), h.deps);
    const problem = await installMod(upgrade(EXTRA));
    expect(h.installs).toEqual([{ id: "extra", origin: "third-party" }]);
    expect(problem).toContain("Third-party mods are not enabled");
  });

  it("goes ahead once they are, still as third-party", async () => {
    useWindow();
    const h = harness(true);
    const installMod = await gameUpdateModInstaller(makeTerm(), h.deps);
    expect(await installMod(upgrade(EXTRA))).toBeNull();
    expect(h.installs).toEqual([{ id: "extra", origin: "third-party" }]);
  });

  it("is not exempt the way an update to a first-party mod is", async () => {
    useWindow();
    const h = harness(false);
    const installMod = await gameUpdateModInstaller(makeTerm(), h.deps);
    expect(await installMod(upgrade(QOL))).toBeNull();
    expect(h.installs).toEqual([{ id: "qol", origin: "curated" }]);
  });
});
