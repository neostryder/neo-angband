/**
 * The arg_* globals and the force-name behaviour they gate.
 *
 * The point of this file is that `-f` is a FEATURE, not the single message the
 * text census could see. Each test below is one of the eight places the C reads
 * arg_force_name; two of them (ui-birth.c:124 and the name stage) live in
 * birth.test.ts because they need the whole birth flow.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  angbandSys,
  argForceName,
  argGraphics,
  argName,
  argWizard,
  initLaunchArgs,
  launchArgs,
  resetLaunchArgs,
  setArgName,
} from "./launch";
import { localTimestampSuffix } from "./timestamp";

afterEach(() => {
  resetLaunchArgs();
});

describe("the arg_* globals", () => {
  it("are all at their upstream defaults before any argv is seen", () => {
    /* Which is also the web build's permanent state: no argv, so nothing set. */
    expect(argForceName()).toBe(false);
    expect(argWizard()).toBe(false);
    expect(argGraphics()).toBe(0);
    expect(argName()).toBe("");
    /* init.c:84's ANGBAND_SYS. */
    expect(angbandSys()).toBe("xxx");
  });

  it("come from main()'s option loop", () => {
    initLaunchArgs(["-f", "-w", "-g", "-uBilbo"]);
    expect(argForceName()).toBe(true);
    expect(argWizard()).toBe(true);
    expect(argGraphics()).toBe(2);
    expect(argName()).toBe("Bilbo");
  });

  it("sets ANGBAND_SYS to the module that initialises the display", () => {
    /* main.c:534-540 assigns modules[i].name before calling its init. With one
     * module and no -m, that module is chosen. */
    initLaunchArgs([]);
    expect(angbandSys()).toBe("web");
    resetLaunchArgs();
    initLaunchArgs(["-mweb"]);
    expect(angbandSys()).toBe("web");
  });

  it("leaves ANGBAND_SYS at its default when -m names no known module", () => {
    /* Upstream never reaches a module in that case - it quits with "Unable to
     * prepare any 'display module'!" - so the name must not be adopted. It is
     * what a pref file's $SYS expands to, and a bogus value would silently
     * change which font sub-file a pref file pulls in. */
    initLaunchArgs(["-mnosuch"]);
    expect(angbandSys()).toBe("xxx");
    expect(launchArgs().module).toBe("nosuch");
  });

  it("does not latch anything on a usage error", () => {
    /* Upstream quits, so the game never runs with half the switches applied. */
    expect(initLaunchArgs(["-f", "-q"]).kind).toBe("usage");
    expect(argForceName()).toBe(false);
  });

  it("lets arg_name be cleared during play (ui-game.c:848)", () => {
    initLaunchArgs(["-uBilbo"]);
    expect(argName()).toBe("Bilbo");
    setArgName("");
    expect(argName()).toBe("");
    /* The parsed record is untouched: only the global moves. */
    expect(launchArgs().name).toBe("Bilbo");
  });
});

describe("localTimestampSuffix (strftime, ui-input.c:1364)", () => {
  it("formats -%Y-%m-%d-%H-%M.txt in local time", () => {
    /* Month is 0-based in JS and 1-based in strftime, which is the easy mistake
     * this asserts against: February must print as 02. */
    expect(localTimestampSuffix(new Date(2026, 1, 3, 4, 5))).toBe(
      "-2026-02-03-04-05.txt",
    );
  });

  it("zero-pads every field", () => {
    expect(localTimestampSuffix(new Date(2026, 11, 25, 23, 59))).toBe(
      "-2026-12-25-23-59.txt",
    );
    expect(localTimestampSuffix(new Date(2026, 0, 1, 0, 0))).toBe(
      "-2026-01-01-00-00.txt",
    );
  });

  it("uses local fields, not UTC ones", () => {
    /* localtime(), not gmtime(): a dump made at 00:30 must be named for the
     * player's own date, not for whatever it is in UTC. Constructed from local
     * components, so the two only agree at offset 0. */
    const d = new Date(2026, 5, 15, 0, 30);
    expect(localTimestampSuffix(d)).toBe("-2026-06-15-00-30.txt");
    expect(localTimestampSuffix(d)).toContain(`-${String(d.getHours()).padStart(2, "0")}-`);
  });
});

/* ---------------------------------------------------------------------------
 * The call sites. Each drives the real screen function against a fake terminal.
 * ------------------------------------------------------------------------- */

interface FakeWindow {
  addEventListener(type: string, fn: (ev: Event) => void, capture?: boolean): void;
  removeEventListener(type: string, fn: (ev: Event) => void, capture?: boolean): void;
  dispatchEvent(ev: Event): void;
}

function makeFakeWindow(): FakeWindow {
  const listeners: Array<{ type: string; fn: (ev: Event) => void }> = [];
  return {
    addEventListener(type, fn) {
      listeners.push({ type, fn });
    },
    removeEventListener(type, fn) {
      const i = listeners.findIndex((l) => l.type === type && l.fn === fn);
      if (i >= 0) listeners.splice(i, 1);
    },
    dispatchEvent(ev) {
      for (const l of [...listeners].filter((x) => x.type === ev.type)) l.fn(ev);
    },
  };
}

interface FakeTerm {
  size(): { cols: number; rows: number };
  clear(): void;
  print(x: number, y: number, text: string, fg?: string): void;
  /* Term_erase / c_prt (ui-output.c:385-391) - erase-then-draw, as against
   * print()'s put_str, which does not erase (ui-output.c:362-379). */
  eraseToEol(x: number, y: number): void;
  prt(x: number, y: number, text: string, fg?: string): void;
  snapshot(): string[];
}

function makeTerm(cols = 80, rows = 24): FakeTerm {
  const grid: string[][] = Array.from({ length: rows }, () =>
    new Array<string>(cols).fill(" "),
  );
  return {
    size: () => ({ cols, rows }),
    clear: () => {
      for (const row of grid) row.fill(" ");
    },
    /* Term_erase(x, y, 255) + c_prt = erase-then-draw (ui-output.c:385-391).
     * print() is put_str and does NOT erase (ui-output.c:362-379); the two must
     * stay distinguishable in the fake or a prt site cannot be tested. */
    eraseToEol: (x, y) => {
      const row = grid[y];
      if (row) for (let cx = Math.max(0, x); cx < cols; cx++) row[cx] = " ";
    },
    prt: (x, y, text) => {
      const row = grid[y];
      if (!row) return;
      for (let cx = Math.max(0, x); cx < cols; cx++) row[cx] = " ";
      for (let i = 0; i < text.length && x + i < cols; i++) row[x + i] = text[i] ?? " ";
    },
    print: (x, y, text) => {
      for (let i = 0; i < text.length && x + i < cols; i++) {
        const row = grid[y];
        if (row) row[x + i] = text[i] ?? " ";
      }
    },
    snapshot: () => grid.map((r) => r.join("").replace(/\s+$/u, "")),
  };
}

function press(win: FakeWindow, key: string): void {
  const ev = new Event("keydown", { cancelable: true }) as Event & { key: string };
  ev.key = key;
  win.dispatchEvent(ev);
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe("get_file under arg_force_name (ui-input.c:1348-1368)", () => {
  let win: FakeWindow;

  beforeEach(() => {
    win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
    vi.useRealTimers();
  });

  it("asks for the name when the flag is off", async () => {
    const { getFile } = await import("./overlay");
    const term = makeTerm();
    const done = getFile(term as never, "Bilbo.txt");
    await tick();
    expect(term.snapshot()[0]).toContain("File name:");
    press(win, "Escape");
    expect(await done).toBeNull();
  });

  it("replaces the prompt with a confirmation, and timestamps the name", async () => {
    /* The ".txt" the caller appended is OVERWRITTEN by the timestamp, so the
     * result must not contain two extensions. */
    /* Only Date: faking setTimeout too would stall the `tick` helper this test
     * uses to let the prompt's own promise settle. */
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 6, 28, 13, 45));
    initLaunchArgs(["-f"]);
    const { getFile } = await import("./overlay");
    const term = makeTerm();
    const done = getFile(term as never, "Bilbo.txt");
    await tick();
    const screen = term.snapshot().join("\n");
    expect(screen).toContain("Confirm writing to Bilbo-2026-07-28-13-45.txt? ");
    expect(screen).not.toContain("Bilbo.txt-");
    press(win, "y");
    await tick();
    /* "Saving as <path>." then anykey (L1377-1380). */
    press(win, "Enter");
    expect(await done).toBe("Bilbo-2026-07-28-13-45.txt");
  });

  it("cancels when the confirmation is declined", async () => {
    initLaunchArgs(["-f"]);
    const { getFile } = await import("./overlay");
    const term = makeTerm();
    const done = getFile(term as never, "Bilbo.txt");
    await tick();
    press(win, "n");
    expect(await done).toBeNull();
  });
});

describe("the pref-file paths under arg_force_name", () => {
  let win: FakeWindow;

  beforeEach(async () => {
    win = makeFakeWindow();
    (globalThis as { window?: unknown }).window = win;
    /* A real host, so a confirmed dump actually lands somewhere and the outcome
     * message is the success one. Without it the installed default reports
     * create-failed and the test would pass on "Failed to save ...", which is
     * not the branch under test. */
    const { MemoryHost, setHost } = await import("@neo-angband/core");
    setHost(new MemoryHost());
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  /**
   * A PrefsUiCtx with only what these two screens read before their prompt: the
   * terminal, the message sink and the player name. The dump/load work behind the
   * prompt is not what is under test here - which prompt appears is.
   */
  function ctx(term: FakeTerm): { said: string[]; ctx: never } {
    const said: string[] = [];
    return {
      said,
      ctx: {
        term,
        say: (t: string) => said.push(t),
        playerName: () => "Bilbo",
        glyphs: {},
        prefDeps: {},
        dumpDeps: () => ({}),
      } as unknown as never,
    };
  }

  it("dump: asks for a filename when the flag is off (ui-options.c:67)", async () => {
    const { dumpPrefFile } = await import("./prefs-ui");
    const term = makeTerm();
    const c = ctx(term);
    const done = dumpPrefFile(c.ctx, () => "# x\n", "Save monster attr/chars", 8);
    await tick();
    expect(term.snapshot().join("\n")).toContain("File: ");
    press(win, "Escape");
    await done;
    /* ESC cancelled: no outcome message either way. */
    expect(c.said).toEqual([]);
  });

  it("dump: confirms the pinned filename instead (ui-options.c:69)", async () => {
    initLaunchArgs(["-f"]);
    const { dumpPrefFile } = await import("./prefs-ui");
    const term = makeTerm();
    const c = ctx(term);
    const done = dumpPrefFile(c.ctx, () => "# x\n", "Save monster attr/chars", 8);
    await tick();
    /* player_safe_name(...) + ".prf", offered rather than typed. */
    expect(term.snapshot().join("\n")).toContain("Confirm writing to Bilbo.prf? ");
    press(win, "y");
    await done;
    /* strstr(title, " ") + 1 - the message names the title after its first space. */
    expect(c.said).toEqual(["Saved monster attr/chars."]);
  });

  it("dump: a declined confirmation writes nothing", async () => {
    initLaunchArgs(["-f"]);
    const { dumpPrefFile } = await import("./prefs-ui");
    const term = makeTerm();
    const c = ctx(term);
    const done = dumpPrefFile(c.ctx, () => "# x\n", "Save monster attr/chars", 8);
    await tick();
    press(win, "n");
    await done;
    expect(c.said).toEqual([]);
  });

  it("load: confirms the pinned filename instead (ui-options.c:1222)", async () => {
    initLaunchArgs(["-f"]);
    const { loadPrefFileHack } = await import("./prefs-ui");
    const term = makeTerm();
    const c = ctx(term);
    const done = loadPrefFileHack(c.ctx, 8);
    await tick();
    expect(term.snapshot().join("\n")).toContain("Confirm loading Bilbo.prf? ");
    press(win, "n");
    await done;
    expect(c.said).toEqual([]);
  });

  it("load: asks for a filename when the flag is off", async () => {
    const { loadPrefFileHack } = await import("./prefs-ui");
    const term = makeTerm();
    const c = ctx(term);
    const done = loadPrefFileHack(c.ctx, 8);
    await tick();
    expect(term.snapshot().join("\n")).toContain("Command: Load a user pref file");
    expect(term.snapshot().join("\n")).toContain("File: ");
    press(win, "Escape");
    await done;
    expect(c.said).toEqual([]);
  });
});
