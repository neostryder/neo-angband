/**
 * Nothing on the mod screens is cut off at 80 columns.
 *
 * The terminal is a fixed 80x24 and `selectFromMenu` renders a row as
 * `` `${tag}) ${label}`.slice(0, cols - 1) `` - it SLICES, silently, mid-word,
 * and the hint line above the footer does the same. So a label or a hint that
 * is four characters too long does not wrap, does not warn, and does not fail
 * any test: it just loses its ending, which is where the verb usually is
 * ("Download a mod from its own repository, digest-check" reads as a completed
 * sentence and is not one).
 *
 * MEASURED BY DIFFERENCE, not by counting characters against a constant. The
 * test paints the real manager twice - once at 80 columns and once at 400 - and
 * requires the row text to be IDENTICAL. A row that differs was truncated by
 * the narrow paint, and the assertion prints both, so the failure names the
 * exact string and how much of it was lost. Counting `label.length <= 76` in a
 * test would need every caller to remember the three columns the tag takes; a
 * diff cannot forget.
 */

import { describe, expect, it, afterEach } from "vitest";
import { runModManager, rowLabel, rowDetail } from "./mods";
import { ModStore, buildCatalog } from "./mod-store";
import type { CatalogMod } from "./mod-store";
import type { GlyphTerm } from "./term";

/* --- the fakes, same shape as mod-list-long.test.ts ---------------------- */

interface FakeWindow {
  addEventListener(t: string, fn: (ev: Event) => void, capture?: boolean): void;
  removeEventListener(t: string, fn: (ev: Event) => void, capture?: boolean): void;
  dispatchEvent(ev: Event): void;
}

function makeFakeWindow(): FakeWindow {
  const ls: Array<{ t: string; fn: (ev: Event) => void }> = [];
  return {
    addEventListener: (t, fn) => void ls.push({ t, fn }),
    removeEventListener: (t, fn) => {
      const i = ls.findIndex((l) => l.t === t && l.fn === fn);
      if (i >= 0) ls.splice(i, 1);
    },
    dispatchEvent: (ev) => {
      for (const l of [...ls].filter((x) => x.t === ev.type)) l.fn(ev);
    },
  };
}

interface FakeTerm extends GlyphTerm {
  snapshot(): string[];
}

function makeTerm(cols: number, rows = 24): FakeTerm {
  const grid: string[][] = Array.from({ length: rows }, () => new Array(cols).fill(" "));
  return {
    size: () => ({ cols, rows }),
    clear: () => {
      for (const row of grid) row.fill(" ");
    },
    print: (x: number, y: number, text: string) => {
      const row = grid[y];
      if (!row) return;
      for (let i = 0; i < text.length && x + i < cols; i++) row[x + i] = text[i] ?? " ";
    },
    eraseToEol: () => {},
    prt: () => {},
    setCursor: () => {},
    snapshot: () => grid.map((r) => r.join("").replace(/\s+$/u, "")),
  } as unknown as FakeTerm;
}

function press(win: FakeWindow, key: string): void {
  const ev = new Event("keydown", { cancelable: true }) as Event & { key: string };
  ev.key = key;
  win.dispatchEvent(ev);
}

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

function fakeStorage(): Storage {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: () => null,
    length: 0,
  } as unknown as Storage;
}

/** The rows selectFromMenu painted, by their `x) ` tag prefix. */
function menuRows(term: FakeTerm): string[] {
  return term.snapshot().filter((l) => /^\S\)\s/u.test(l));
}

/** The hint line: the row above the footer. */
function hintRow(term: FakeTerm, rows = 24): string {
  return term.snapshot()[rows - 2] ?? "";
}

function catalogue(): CatalogMod[] {
  const mk = (over: Partial<CatalogMod>): CatalogMod => ({
    id: "x",
    name: "X",
    version: "1.0.0",
    shape: "content",
    kind: "content",
    enabled: false,
    capabilities: [],
    nondeterministic: false,
    affectsGameplay: false,
    consented: true,
    manifest: { id: "x", name: "X", version: "1.0.0", shape: "content" } as CatalogMod["manifest"],
    ...over,
  });
  /* The widest realistic rows, not the average ones: a long name with every
   * flag set at once is what actually reaches the edge. */
  return [
    mk({ id: "qol", name: "Quality of Life", version: "0.11.0", enabled: true }),
    mk({
      id: "bug-fixes",
      name: "Bug Fixes (unofficial patch set)",
      version: "0.12.0",
      enabled: true,
      affectsGameplay: true,
      nondeterministic: true,
    }),
    mk({ id: "neo-linoleum", name: "Neo Linoleum", version: "0.11.0", shape: "tiles" }),
    mk({
      id: "borg",
      name: "The Borg",
      version: "0.1.0",
      shape: "plugin",
      kind: "trusted",
      capabilities: ["registry:*", "state:*"],
      consented: false,
      enabled: true,
    }),
  ];
}

function openManager(term: FakeTerm, mods: CatalogMod[]): Promise<void> {
  return runModManager(term, {
    store: new ModStore(fakeStorage()),
    listCatalog: () => mods,
    conflictLines: () => ({ declared: [], contested: [], combined: [] }),
    requestReload: () => {},
    modCatalogue: {
      installed: () => Promise.resolve(new Map()),
      install: () => Promise.resolve({ ok: true } as never),
      uninstall: () => Promise.resolve(true),
    },
  });
}

/** Paint the manager at `cols` and walk the cursor over every row. */
async function walk(
  cols: number,
  mods: CatalogMod[],
): Promise<{ rows: string[]; hints: string[] }> {
  const win = makeFakeWindow();
  (globalThis as { window?: unknown }).window = win;
  const term = makeTerm(cols, 24);
  const done = openManager(term, mods);
  await Promise.resolve();
  await Promise.resolve();

  const hints: string[] = [];
  const rows = new Set<string>();
  /* More steps than there are rows: the cursor stops at the end, so the extra
   * presses cost nothing and the count does not have to track the row list. */
  for (let i = 0; i < mods.length + 12; i++) {
    for (const r of menuRows(term)) rows.add(r);
    hints.push(hintRow(term));
    press(win, "ArrowDown");
    await Promise.resolve();
  }
  press(win, "Escape");
  await done;
  delete (globalThis as { window?: unknown }).window;
  return { rows: [...rows], hints: [...new Set(hints)].filter(Boolean) };
}

describe("the mod manager fits an 80-column terminal", () => {
  it("cuts off no row and no hint", async () => {
    const mods = catalogue();
    const narrow = await walk(80, mods);
    const wide = await walk(400, mods);

    /* Every row the wide paint produced must appear verbatim in the narrow one.
     * A row that was sliced shows up as a prefix that is not in `narrow`, and
     * the message names it. */
    for (const row of wide.rows) {
      const cut = narrow.rows.find((n) => row.startsWith(n) && n !== row);
      expect(
        cut ?? null,
        `this row is cut off at 80 columns:\n  wanted: ${row}\n  shown:  ${cut ?? ""}\n` +
          `  ${row.length - (cut?.length ?? 0)} characters lost. Shorten the label.`,
      ).toBeNull();
      expect(narrow.rows).toContain(row);
    }
  });

  it("cuts off no hint", async () => {
    const mods = catalogue();
    const narrow = await walk(80, mods);
    const wide = await walk(400, mods);

    for (const hint of wide.hints) {
      const cut = narrow.hints.find((n) => hint.startsWith(n) && n !== hint);
      expect(
        cut ?? null,
        `this hint is cut off at 80 columns:\n  wanted: ${hint}\n  shown:  ${cut ?? ""}\n` +
          `  ${hint.length - (cut?.length ?? 0)} characters lost. Shorten the hint.`,
      ).toBeNull();
    }
  });

  it("keeps the footer on screen and inside the width", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm(80, 24);
    const done = openManager(term, catalogue());
    await Promise.resolve();
    await Promise.resolve();
    const footer = term.snapshot()[23] ?? "";
    expect(footer.length).toBeLessThanOrEqual(79);
    expect(footer).toContain("ESC");
    press(win, "Escape");
    await done;
  });
});

describe("every row label and hint fits, measured directly", () => {
  /* The same property as above, on the pure function, so a new flag combination
   * can be checked without driving a terminal. 80 columns minus the trailing
   * column the slice reserves, minus the three the "x) " tag takes. */
  const ROOM = 80 - 1 - 3;

  /* Every row now carries "(author)" as part of the name, so the property has to
   * hold with one - and with a long one, which is the case that used to be
   * impossible and is now the widest thing on the row. */
  const AUTHORS = ["", "neostryder", "somebody-with-a-very-long-account-name-indeed"];

  it("holds for every combination of the row's badges, author and all", () => {
    for (const author of AUTHORS) {
      for (const enabled of [true, false]) {
        for (const consented of [true, false]) {
          for (const nondeterministic of [true, false]) {
            for (const affectsGameplay of [true, false]) {
              for (const problems of [[], ["something went wrong"]]) {
                const m: CatalogMod = {
                  id: "a-mod-with-a-fairly-long-identifier",
                  /* 24 characters: longer than any first-party mod's name, short
                   * enough that a mod author has room. If this has to grow, the
                   * badges are what should shrink. */
                  name: "Quality of Life Extras!!",
                  version: "10.20.30",
                  shape: "plugin",
                  kind: "trusted",
                  enabled,
                  capabilities: ["registry:*"],
                  nondeterministic,
                  affectsGameplay,
                  consented,
                  manifest: { author } as CatalogMod["manifest"],
                };
                const item = rowLabel(m, problems);
                expect(
                  item.label.length,
                  `label too long with ${JSON.stringify({ author, enabled, consented, nondeterministic, affectsGameplay, problems })}: ${item.label}`,
                ).toBeLessThanOrEqual(ROOM);
                expect(
                  (item.hint ?? "").length,
                  `hint too long: ${item.hint ?? ""}`,
                ).toBeLessThanOrEqual(79);
              }
            }
          }
        }
      }
    }
  });

  it("shows the author when there is room, and drops it WHOLE when there is not", () => {
    const m = (name: string, author: string, problems: string[] = []): string =>
      rowLabel(
        {
          id: "x",
          name,
          version: "1.0.0",
          shape: "content",
          kind: "content",
          enabled: false,
          capabilities: [],
          nondeterministic: false,
          affectsGameplay: false,
          consented: false,
          manifest: { author } as CatalogMod["manifest"],
        },
        problems,
      ).label;

    expect(m("Neo Linoleum", "neostryder")).toBe("[ ] Neo Linoleum (neostryder)  v1.0.0  (content)");

    /* No room for both, with every badge lit: the author goes entirely rather than
     * becoming "(neost...", which would name somebody who does not exist. */
    const tight = m("Bug Fixes (unofficial patch set)", "neostryder", ["broken"]);
    expect(tight).toContain("Bug Fixes (unofficial patch set)");
    expect(tight).not.toContain("neost");
    expect(tight).toContain("! NOT WORKING");
    expect(tight.length).toBeLessThanOrEqual(ROOM);
  });
});

describe("a mod that is switched on and not installed", () => {
  it("gets a row of its own instead of a console warning", () => {
    const catalog = buildCatalog({
      content: [],
      sandbox: [],
      trusted: [],
      enabled: ["a-mod-that-is-gone"],
      consents: {},
    });
    expect(catalog).toHaveLength(1);
    expect(catalog[0]?.missing).toBe(true);

    const row = rowLabel(catalog[0]!);
    expect(row.label).toContain("NOT INSTALLED");
    /* No version and no kind: there is no manifest, and printing "v-  (content)"
     * beside a mod that does not exist describes one that does. */
    expect(row.label).not.toContain("v-");
    expect(row.label).not.toContain("(content)");
    expect(row.hint).toContain("Enter");
    expect(row.label.length).toBeLessThanOrEqual(80 - 1 - 3);

    const detail = rowDetail(catalog[0]!, 80).map((l) => l.text).join(" ");
    expect(detail).toContain("not installed");
    expect(detail).toContain("Install a mod...");
  });

  it("does not invent a row for a mod that IS installed", () => {
    const manifest = {
      id: "real",
      name: "Real Mod",
      version: "1.0.0",
      shape: "content",
    } as never;
    const catalog = buildCatalog({
      content: [manifest],
      sandbox: [],
      trusted: [],
      enabled: ["real"],
      consents: {},
    });
    expect(catalog).toHaveLength(1);
    expect(catalog[0]?.missing).toBeUndefined();
  });
});

describe("the action rows never move", () => {
  it("keeps the same tag whatever the mod list does", async () => {
    /* The measured defect: action rows were lettered positionally, so installing
     * a mod shifted every one of them down. A player - or a script - pressing
     * the letter that meant "Install a mod..." yesterday lands on "Auto-sort"
     * today. Digits, fixed, because the mods take the letters. */
    const tagOf = (rows: string[], label: string): string | undefined =>
      rows.find((r) => r.includes(label))?.[0];

    const few = await walk(80, catalogue().slice(0, 1));
    const many = await walk(80, catalogue());

    for (const label of ["Install a mod...", "View conflicts", "Profiles...", "Done"]) {
      const a = tagOf(few.rows, label);
      const b = tagOf(many.rows, label);
      expect(a, `${label} was not painted`).toBeDefined();
      expect(b, `${label} was not painted`).toBeDefined();
      expect(b, `${label} moved from "${a}" to "${b}" when the list grew`).toBe(a);
      expect(/[0-9]/u.test(a ?? ""), `${label} has a positional tag "${a}"`).toBe(true);
    }
  });
});
