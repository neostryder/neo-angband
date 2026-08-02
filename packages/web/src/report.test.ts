/**
 * The report is the only artefact of this whole feature that anybody outside the
 * project reads, so the text is the thing under test.
 *
 * Two of these are about what must NOT be in it. A report is written to be sent
 * to a stranger, and the two ways that goes wrong are leaking the player's own
 * name out of a Windows path, and silently truncating the log at the wrong end -
 * which drops the lines describing the failure and keeps the ones about startup.
 */

import { describe, expect, it } from "vitest";
import {
  describeCharacter,
  REPORT_LOG_LINES,
  reportFooter,
  reportLines,
  reportText,
} from "./report";
import type { ReportInput, ReportView } from "./report";

function input(over: Partial<ReportInput> = {}): ReportInput {
  return {
    at: Date.UTC(2026, 7, 2, 13, 30, 0),
    version: "0.17.0",
    parityBaseline: "4.2.6",
    channel: "beta",
    shell: "desktop",
    platform: "win32",
    arch: "x64",
    userAgent: "Mozilla/5.0 Electron",
    cols: 80,
    rows: 24,
    cssWidth: 1280,
    cssHeight: 800,
    dpr: 1.25,
    level: "info",
    ringSize: 2000,
    dropped: 0,
    description: [],
    character: null,
    mods: [],
    lines: [],
    ...over,
  };
}

function view(over: Partial<ReportView> = {}): ReportView {
  return {
    phase: "compose",
    shell: "desktop",
    description: [],
    level: "info",
    lineCount: 120,
    modCount: 0,
    ...over,
  };
}

describe("the file", () => {
  it("names the build, the machine and the window", () => {
    const text = reportText(input());
    expect(text).toContain("0.17.0 (parity baseline 4.2.6)");
    expect(text).toContain("win32 x64");
    expect(text).toContain("80x24 cells, 1280x800 css px, dpr 1.25");
    expect(text).toContain("beta");
  });

  it("carries the display metrics, because a bug hid in them", () => {
    /* The ghost residue was invisible at dpr 1 and 2 and only appeared at
     * fractional ratios, so every screenshot on a clean display looked fine. A
     * report that does not say dpr cannot reproduce that class of bug at all. */
    expect(reportText(input({ dpr: 1 }))).toContain("dpr 1");
    expect(reportText(input({ dpr: 2.5 }))).toContain("dpr 2.5");
  });

  it("says the build id when there is one, and nothing when there is not", () => {
    expect(reportText(input({ buildId: "a1b2c3d" }))).toContain("a1b2c3d");
    expect(reportText(input())).not.toContain("build   ");
    expect(reportText(input({ buildId: "" }))).not.toContain("build   ");
  });

  it("keeps the NEWEST log lines when there are too many", () => {
    /* Truncation eats the end by default, and the end of a log is the part that
     * says what went wrong. */
    const lines = Array.from({ length: REPORT_LOG_LINES + 50 }, (_, i) => `line ${String(i)}`);
    const text = reportText(input({ lines }));
    expect(text).toContain(`line ${String(REPORT_LOG_LINES + 49)}`);
    expect(text).not.toContain("line 0\n");
    expect(text).toContain(`of ${String(REPORT_LOG_LINES + 50)} held`);
  });

  it("does not claim a total when it carried everything", () => {
    expect(reportText(input({ lines: ["a", "b"] }))).toContain("Log (2 lines, oldest first)");
  });

  it("mentions dropped lines only when some were dropped", () => {
    /* "0 dropped" on every report trains the eye to skip the one line that
     * matters on the report where it is not zero. */
    expect(reportText(input({ dropped: 0 }))).not.toContain("fell off the top");
    expect(reportText(input({ dropped: 43 }))).toContain("43 earlier lines fell off the top");
  });

  it("takes the player's own name out of every path, wherever it appears", () => {
    /* On Windows the home directory is routinely somebody's full name, and it is
     * the prefix of every path in a desktop log - inside stack traces and inside
     * JSON detail as well as in the obvious fields. The elision runs over the
     * whole document for exactly that reason. */
    const home = "C:\\Users\\Firstname.Lastname";
    const text = reportText(
      input({
        home,
        lines: [
          `13:00 ERROR [save] failed | {"path":"C:\\\\Users\\\\Firstname.Lastname\\\\game\\\\save"}`,
          `13:01 ERROR [x] at file:///C:/Users/Firstname.Lastname/app.js:1`,
        ],
        description: [`it broke in C:\\Users\\Firstname.Lastname\\Games`],
      }),
    );
    expect(text).not.toContain("Firstname");
    expect(text).toContain("~");
  });

  it("says plainly when there is no description, no character and no mods", () => {
    const text = reportText(input());
    expect(text).toContain("(nothing written)");
    expect(text).toContain("(no character in play)");
    expect(text).toContain("(none - this is the unmodified game)");
    expect(text).toContain("(the log is empty)");
  });

  it("lists what the player typed, and drops the blank lines", () => {
    const text = reportText(input({ description: ["the game froze", "   ", "when I pressed R"] }));
    expect(text).toContain("the game froze");
    expect(text).toContain("when I pressed R");
    expect(text).not.toContain("\n   \n");
  });

  it("lists the enabled mods with their versions", () => {
    /* A mod's patch and a core bug look identical on screen. */
    const text = reportText(input({ mods: [{ id: "neo-angband-qol", version: "0.11.0" }] }));
    expect(text).toContain("neo-angband-qol 0.11.0");
  });

  it("survives an impossible timestamp rather than throwing mid-report", () => {
    expect(reportText(input({ at: Number.NaN }))).toContain("(unknown time)");
  });
});

describe("the character line", () => {
  const c = { name: "Grond", race: "Half-Troll", cls: "Warrior", level: 12, depthFt: 550 };

  it("reads as a sentence", () => {
    expect(describeCharacter(c)).toBe("Grond, level 12 Half-Troll Warrior, 550 feet down");
  });

  it("says in town rather than 0 feet down", () => {
    expect(describeCharacter({ ...c, depthFt: 0 })).toBe(
      "Grond, level 12 Half-Troll Warrior, in town",
    );
  });
});

describe("the screen", () => {
  const text = (v: ReportView): string => reportLines(v).map((l) => l.text).join("\n");

  it("says nothing is sent anywhere, before anything is written", () => {
    /* The promise the whole feature rests on. If this line ever stops being
     * true, this test is the one that has to be deleted deliberately. */
    expect(text(view())).toContain("NOT");
    expect(text(view())).toContain("sent anywhere");
  });

  it("lists what will be in the file before it is written", () => {
    const t = text(view({ lineCount: 120, modCount: 2 }));
    expect(t).toContain("the last 120 lines of the log");
    expect(t).toContain("the 2 mods you have enabled");
    expect(t).toContain("name, race, class, level and depth");
  });

  it("counts the log lines it will actually carry, not the whole ring", () => {
    expect(text(view({ lineCount: 5000 }))).toContain(`the last ${String(REPORT_LOG_LINES)} lines`);
  });

  it("gets the singular right for one mod, and says so for none", () => {
    expect(text(view({ modCount: 1 }))).toContain("the 1 mod you have enabled");
    expect(text(view({ modCount: 0 }))).toContain("no mods enabled");
  });

  it("offers to turn logging up only when it is turned down", () => {
    /* On a released build the level is `warn`, which is right for a machine that
     * is working and useless on one that is not. */
    expect(text(view({ level: "warn" }))).toContain("Press L to change it");
    expect(text(view({ level: "error" }))).toContain("Press L to change it");
    expect(text(view({ level: "info" }))).not.toContain("Press L to change it");
    expect(text(view({ level: "debug" }))).not.toContain("Press L to change it");
  });

  it("prompts for a description when there is none, and shows it when there is", () => {
    expect(text(view())).toContain("press D to describe it");
    expect(text(view({ description: ["it froze"] }))).toContain("it froze");
    expect(text(view({ description: ["it froze"] }))).not.toContain("press D to describe");
  });

  it("names the folder, so a player can find what they just wrote", () => {
    expect(text(view({ logsDir: "C:\\Games\\Neo Angband\\neo-angband-data\\logs" }))).toContain(
      "C:\\Games\\Neo Angband\\neo-angband-data\\logs",
    );
  });

  it("tells a browser it downloaded, and the desktop where the file is", () => {
    const saved = { phase: "saved" as const, savedAs: "X" };
    expect(text(view({ ...saved, shell: "browser" }))).toContain("downloaded");
    expect(text(view({ ...saved, shell: "installed" }))).toContain("downloaded");
    expect(text(view({ ...saved, shell: "desktop" }))).toContain("Nothing has been");
  });

  it("says a failure changed nothing", () => {
    const t = text(view({ phase: "failed", error: "the disk is full" }));
    expect(t).toContain("the disk is full");
    expect(t).toContain("your character is untouched");
  });
});

describe("the footer", () => {
  it("offers every action while composing, and only escape once saved", () => {
    expect(reportFooter(view())).toContain("D to describe");
    expect(reportFooter(view())).toContain("L logging level");
    expect(reportFooter(view({ phase: "saved" }))).toBe("[ ESC to go back ]");
    expect(reportFooter(view({ phase: "failed" }))).toContain("try again");
  });
});
