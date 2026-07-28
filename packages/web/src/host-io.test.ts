/**
 * THE RATCHET on the user directory and the dumps written into it.
 *
 * Census block E, host-io. Aaron's disposition: "Must not deviate from upstream
 * - port the equivalents, do not excuse." What was excused here:
 *
 *   - get_file's prompt (File name: / Replace existing file? / Saving as ...),
 *     which every dump goes through - the port asked nothing and invented a name;
 *   - text_lines_to_file's staged write, and the one message its callers print
 *     when it fails ("Failed to create file %s.new");
 *   - html_screenshot, replaced by a PNG of the canvas plus the invented
 *     "Screen dump saved." - neither of upstream's two TEXT formats.
 *
 * Prompt text is asserted from row 0 of a fake terminal, so a paraphrase fails
 * here even though no census can see one.
 */

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { playerSafeName } from "@neo-angband/core";
import { getFile, getChar } from "./overlay";
import {
  setUserStorage,
  userFileExists,
  readUserFile,
  writeUserFile,
  deleteUserFile,
  listUserFiles,
  textLinesToFile,
  userPath,
  USER_DIR,
} from "./userdir";
import type { UserStorage } from "./userdir";
import { htmlScreenshot, cssToHex, DUMP_HTML, DUMP_FORUM } from "./screenshot";
import type { GlyphTerm, ColoredCell } from "./term";

/* --- fixtures (no jsdom in this repo; see overlay.test.ts) ---------------- */

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

function makeTerm(cols = 80, rows = 24): GlyphTerm & { row(y: number): string } {
  const grid: string[][] = Array.from({ length: rows }, () => new Array<string>(cols).fill(" "));
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
    setCursor: () => undefined,
    row: (y: number) => (grid[y] ?? []).join("").replace(/\s+$/u, ""),
  } as unknown as GlyphTerm & { row(y: number): string };
}

function press(win: FakeWindow, key: string): void {
  const ev = new Event("keydown", { cancelable: true }) as Event & { key: string };
  ev.key = key;
  win.dispatchEvent(ev);
}

function type(win: FakeWindow, text: string): void {
  for (const ch of text) press(win, ch);
}

async function tick(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/** A storage with injectable failures, like the score store's fake. */
interface FakeStore extends UserStorage {
  data: Map<string, string>;
  failWrite: Set<string>;
}

function fakeStorage(): FakeStore {
  const data = new Map<string, string>();
  const failWrite = new Set<string>();
  return {
    data,
    failWrite,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => {
      /* The key carries the USER_PREFIX; match on the file name suffix. */
      for (const bad of failWrite) if (k.endsWith(bad)) throw new Error("QuotaExceededError");
      data.set(k, v);
    },
    removeItem: (k) => {
      data.delete(k);
    },
    get length() {
      return data.size;
    },
    key: (i) => [...data.keys()][i] ?? null,
  };
}

let fs: FakeStore;

beforeEach(() => {
  fs = fakeStorage();
  setUserStorage(fs);
});

afterEach(() => {
  setUserStorage(null);
  delete (globalThis as { window?: unknown }).window;
});

/* --- the user directory -------------------------------------------------- */

describe("ANGBAND_DIR_USER, ported (userdir.ts)", () => {
  it("is a real directory: write, read, exists, list, delete", () => {
    expect(listUserFiles()).toEqual([]);
    expect(userFileExists("dump.txt")).toBe(false);

    expect(writeUserFile("dump.txt", "hello")).toBe(true);
    expect(writeUserFile("Bob.prf", "# prefs")).toBe(true);

    expect(readUserFile("dump.txt")).toBe("hello");
    expect(userFileExists("dump.txt")).toBe(true);
    expect(listUserFiles()).toEqual(["Bob.prf", "dump.txt"]);

    expect(deleteUserFile("dump.txt")).toBe(true);
    expect(readUserFile("dump.txt")).toBeNull();
    expect(listUserFiles()).toEqual(["Bob.prf"]);
  });

  it("path_build prints one fixed directory", () => {
    expect(userPath("lore.txt")).toBe(`${USER_DIR}/lore.txt`);
  });

  it("reports a quota-exceeded write instead of swallowing it", () => {
    fs.failWrite.add("dump.txt");
    expect(writeUserFile("dump.txt", "hello")).toBe(false);
    expect(userFileExists("dump.txt")).toBe(false);
  });

  it("degrades to an empty directory with no storage at all", () => {
    setUserStorage(null);
    expect(listUserFiles()).toEqual([]);
    expect(readUserFile("x")).toBeNull();
    expect(writeUserFile("x", "y")).toBe(false);
    expect(textLinesToFile("x", "y")).toBe(-1);
  });

  describe("text_lines_to_file (z-textblock.c L703-737)", () => {
    it("stages <name>.new and rotates it into place, leaving nothing behind", () => {
      expect(textLinesToFile("dump.txt", "first")).toBe(0);
      expect(readUserFile("dump.txt")).toBe("first");
      expect(listUserFiles()).toEqual(["dump.txt"]);

      /* Second write: the existing file goes to .old, is replaced, .old dropped. */
      expect(textLinesToFile("dump.txt", "second")).toBe(0);
      expect(readUserFile("dump.txt")).toBe("second");
      expect(listUserFiles()).toEqual(["dump.txt"]);
    });

    it("returns -1 when the staged file cannot be created - the ONE failure", () => {
      fs.failWrite.add("dump.txt.new");
      expect(textLinesToFile("dump.txt", "body")).toBe(-1);
      /* Nothing was clobbered and nothing was staged. */
      expect(listUserFiles()).toEqual([]);
    });

    it("keeps the existing file when the rotation cannot write .old", () => {
      expect(textLinesToFile("dump.txt", "first")).toBe(0);
      fs.failWrite.add("dump.txt.old");
      expect(textLinesToFile("dump.txt", "second")).toBe(0);
      /* file_move(path, old) failed -> delete the staged file, keep the old one
       * (L732-733). Upstream loses the new dump here too. */
      expect(readUserFile("dump.txt")).toBe("first");
      expect(listUserFiles()).toEqual(["dump.txt"]);
    });
  });
});

/* --- get_file ------------------------------------------------------------ */

describe("get_file (get_file_text, ui-input.c:1335-1383)", () => {
  it("asks 'File name: ' with the suggested name, then 'Saving as user/x.'", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();

    const done = getFile(term, "Bob.txt");
    await tick();
    expect(term.row(0)).toBe("File name: Bob.txt");

    press(win, "Enter");
    await tick();
    /* "Tell the user where it's saved to." (L1377-1378). */
    expect(term.row(0)).toBe("Saving as user/Bob.txt.");
    press(win, " ");
    expect(await done).toBe("Bob.txt");
  });

  it("types OVER the default - askfor_aux's firsttime rule", async () => {
    const win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    const term = makeTerm();

    const done = getFile(term, "Bob.txt");
    await tick();
    type(win, "map.txt");
    press(win, "Enter");
    await tick();
    press(win, " ");
    expect(await done).toBe("map.txt");
  });

  it("cancels on ESCAPE, on an empty name, and on a leading space (L1347)", async () => {
    for (const drive of [
      (win: FakeWindow) => press(win, "Escape"),
      (win: FakeWindow) => {
        /* Clear the default, then accept nothing. */
        for (let i = 0; i < 8; i++) press(win, "Backspace");
        press(win, "Enter");
      },
      (win: FakeWindow) => {
        for (let i = 0; i < 8; i++) press(win, "Backspace");
        type(win, " x");
        press(win, "Enter");
      },
    ]) {
      const win = makeFakeWindow();
      (globalThis as { window?: unknown }).window = win;
      const term = makeTerm();
      const done = getFile(term, "Bob.txt");
      await tick();
      drive(win);
      expect(await done).toBeNull();
      /* Nothing was written and the prompt row was cleared. */
      expect(listUserFiles()).toEqual([]);
    }
  });

  it("asks 'Replace existing file? ' only when the name is taken, and obeys it", async () => {
    writeUserFile("Bob.txt", "old dump");

    /* Declined. */
    {
      const win = makeFakeWindow();
      (globalThis as { window?: unknown }).window = win;
      const term = makeTerm();
      const done = getFile(term, "Bob.txt");
      await tick();
      press(win, "Enter");
      await tick();
      expect(term.row(0)).toBe("Replace existing file? [y/n]");
      press(win, "n");
      expect(await done).toBeNull();
      expect(readUserFile("Bob.txt")).toBe("old dump");
    }
    /* Accepted. */
    {
      const win = makeFakeWindow();
      (globalThis as { window?: unknown }).window = win;
      const term = makeTerm();
      const done = getFile(term, "Bob.txt");
      await tick();
      press(win, "Enter");
      await tick();
      press(win, "y");
      await tick();
      expect(term.row(0)).toBe("Saving as user/Bob.txt.");
      press(win, " ");
      expect(await done).toBe("Bob.txt");
    }
  });

  it("suggests player_safe_name + .txt, suffix stripped only when asked", () => {
    /* ui-player.c:1268 / ui-death.c:168 pass strip_suffix = false. */
    expect(`${playerSafeName("Bob the Bold III", 80, false)}.txt`).toBe("Bob_the_Bold_III.txt");
    /* ui-options.c:61 (pref files) passes true. */
    expect(`${playerSafeName("Bob III", 80, true)}.prf`).toBe("Bob.prf");
  });
});

/* --- get_char ----------------------------------------------------------- */

describe("get_char (ui-input.c:1300-1329)", () => {
  it("builds '<prompt>[hf] ', lower-cases the answer, falls back otherwise", async () => {
    const cases: Array<[string, string]> = [
      ["h", "h"],
      ["H", "h"], // "Lowercase answer if necessary" (L1318)
      ["f", "f"],
      ["z", " "], // not in options -> fallback
      ["Escape", " "],
    ];
    for (const [key, want] of cases) {
      const win = makeFakeWindow();
      (globalThis as { window?: unknown }).window = win;
      const term = makeTerm();
      const done = getChar(term, "Dump as (H)TML or (F)orum text? ", "hf", " ");
      await tick();
      expect(term.row(0)).toBe("Dump as (H)TML or (F)orum text? [hf]");
      press(win, key);
      expect(await done).toBe(want);
    }
  });
});

/* --- html_screenshot ---------------------------------------------------- */

function cells(rows: ColoredCell[][]): ColoredCell[][] {
  return rows;
}

describe("html_screenshot (ui-command.c L295-481)", () => {
  const W = "#ffffff"; // COLOUR_WHITE
  const R = "#c81818"; // COLOUR_RED

  it("writes an html document with the buildid, title and default colours", () => {
    const out = htmlScreenshot(
      cells([[{ ch: "@", fg: W }]]),
      DUMP_HTML,
      "user/dump.html",
      "Neo Angband 4.2.6",
    );
    expect(out).toContain("<!DOCTYPE html><html><head>\n");
    expect(out).toContain("<meta name='generator' content='Neo Angband 4.2.6'>");
    expect(out).toContain("<title>user/dump.html</title>");
    expect(out).toContain("<pre>\n");
    expect(out).toContain("@\n");
    expect(out.endsWith("</pre>\n</body>\n</html>\n")).toBe(true);
    /* All-default colours: not one font tag (oa starts at COLOUR_WHITE). */
    expect(out).not.toContain("<font");
  });

  it("opens a font run for a non-default colour and closes it on return", () => {
    const out = htmlScreenshot(
      cells([[{ ch: "a", fg: W }, { ch: "b", fg: R }, { ch: "c", fg: W }]]),
      DUMP_HTML,
      "d",
      "b",
    );
    const body = out.slice(out.indexOf("<pre>"));
    expect(body).toContain(
      `a<font color="${cssToHex(R)}" style="background-color: #000000">b</font>c`,
    );
  });

  it("closes a trailing font run at the end of the dump (L466-467)", () => {
    const out = htmlScreenshot(cells([[{ ch: "a", fg: R }]]), DUMP_HTML, "d", "b");
    expect(out).toContain("</font></pre>");
  });

  it("escapes <, > and & (write_html_escape_char)", () => {
    const out = htmlScreenshot(
      cells([[{ ch: "<", fg: W }, { ch: ">", fg: W }, { ch: "&", fg: W }]]),
      DUMP_HTML,
      "d",
      "b",
    );
    expect(out).toContain("&lt;&gt;&amp;\n");
  });

  it("writes forum text with [CODE][TT] and [COLOR] runs, not html", () => {
    const out = htmlScreenshot(
      cells([[{ ch: "a", fg: W }, { ch: "b", fg: R }]]),
      DUMP_FORUM,
      "d",
      "b",
    );
    expect(out.startsWith('[CODE][TT][BC="#000000"][COLOR="#FFFFFF"]\n')).toBe(true);
    expect(out).toContain(`a[/COLOR][COLOR="${cssToHex(R)}"]b`);
    expect(out.endsWith("[/COLOR][/BC][/TT][/CODE]\n")).toBe(true);
    expect(out).not.toContain("<font");
  });

  it("skips a colour change on a SPACE in forum mode only (L413-417)", () => {
    const rows = cells([[{ ch: " ", fg: R }, { ch: "x", fg: R }]]);
    /* Forum: the space stays in the default run; the colour opens at 'x'. */
    const forum = htmlScreenshot(rows, DUMP_FORUM, "d", "b");
    expect(forum).toContain(` [/COLOR][COLOR="${cssToHex(R)}"]x`);
    /* HTML: the run opens at the space, because mode 0 does not skip. */
    const html = htmlScreenshot(rows, DUMP_HTML, "d", "b");
    expect(html).toContain(`<font color="${cssToHex(R)}" style="background-color: #000000"> x`);
  });

  it("treats a cell with no background as COLOUR_DARK (BG_BLACK, L398-400)", () => {
    const out = htmlScreenshot(
      cells([[{ ch: "x", fg: R, bg: "#000000" }, { ch: "y", fg: R }]]),
      DUMP_HTML,
      "d",
      "b",
    );
    /* One run for both cells: the explicit black bg and the absent one match. */
    expect(out.match(/<font/gu)?.length).toBe(1);
  });

  it("cssToHex normalizes the three colour forms the terminal stores", () => {
    expect(cssToHex("#fff")).toBe("#FFFFFF");
    expect(cssToHex("#c81818")).toBe("#C81818");
    expect(cssToHex("rgb(200, 24, 24)")).toBe("#C81818");
  });
});
