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
  modTrackerUrl,
  NEO_ANGBAND_TRACKER,
  REPORT_LOG_LINES,
  REPORT_MAX_MOD_TRACKERS,
  REPORT_TRACKER_ACTION_IDS,
  reportDestinations,
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
    expect(text(view({ logsDir: "C:\\Games\\Neo Angband\\data\\logs" }))).toContain(
      "C:\\Games\\Neo Angband\\data\\logs",
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
  it("offers every action while composing, and the way out once saved", () => {
    expect(reportFooter(view())).toContain("D to describe");
    expect(reportFooter(view())).toContain("L logging level");
    expect(reportFooter(view({ phase: "saved" }))).toContain("ESC to go back");
    expect(reportFooter(view({ phase: "failed" }))).toContain("try again");
  });

  it("names only keys that a row on the screen actually has", () => {
    /* The failure this guards is a footer offering `2` on a screen with one mod:
     * both are built from `reportDestinations`, so they cannot disagree. */
    const one = view({
      phase: "saved",
      modOrigins: [{ id: "qol", repo: "neostryder/neo-angband-mod-qol" }],
    });
    expect(reportFooter(one)).toContain("G/1/C");
    const none = view({ phase: "saved" });
    expect(reportFooter(none)).toContain("G/C");
    expect(reportFooter(none)).not.toContain("/1");
  });

  it("gives no key to a mod it cannot address", () => {
    const f = reportFooter(
      view({ phase: "saved", modOrigins: [{ id: "mystery", repo: "file:import" }] }),
    );
    expect(f).toContain("G/C");
    expect(f).not.toContain("/1");
  });
});

describe("a mod's tracker url", () => {
  it("is the tracker root, not the template chooser", () => {
    /* `/issues/new/choose` presumes templates exist and that the tracker is open.
     * Neither is knowable for somebody else's repository from in here. */
    expect(modTrackerUrl("neostryder/neo-angband-mod-qol")).toBe(
      "https://github.com/neostryder/neo-angband-mod-qol/issues",
    );
  });

  it("reads the spellings a manifest is allowed to declare", () => {
    for (const spelling of [
      "https://github.com/a/b",
      "git@github.com:a/b",
      "github:a/b",
      "https://github.com/a/b.git",
      "a/b",
    ]) {
      expect(modTrackerUrl(spelling), spelling).toBe("https://github.com/a/b/issues");
    }
  });

  it("is null for anything it cannot address, the import sentinel included", () => {
    /* `file:import` is what an install record carries when the mod declared no
     * repository this game could resolve. It is not special-cased: it simply is
     * not a repository, which is the question being asked. */
    for (const repo of [
      "file:import",
      "",
      "https://gitlab.com/a/b",
      "https://github.com/a/b/tree/v1.0.0",
      "a/b/c",
      "a",
    ]) {
      expect(modTrackerUrl(repo), repo).toBeNull();
    }
  });
});

describe("where to report it", () => {
  it("always offers the game first, and the chat last", () => {
    const d = reportDestinations([]);
    expect(d.map((x) => x.id)).toEqual(["tracker-game", "tracker-chat"]);
    expect(d[0]?.url).toBe(NEO_ANGBAND_TRACKER);
  });

  it("offers the game's template chooser, because its templates are known", () => {
    /* The one URL here that is a build constant, and the only one that may name a
     * specific submission flow. Picking bug versus parity difference is most of
     * what makes a first report readable, so the chooser is worth the assumption
     * exactly where the assumption is checkable. */
    expect(NEO_ANGBAND_TRACKER).toContain("/issues/new/choose");
    expect(reportDestinations([])[0]?.url).toContain("neostryder/neo-angband");
  });

  it("gives each addressable mod a digit, in the order they are enabled", () => {
    const d = reportDestinations([
      { id: "qol", repo: "neostryder/neo-angband-mod-qol" },
      { id: "bug-fixes", repo: "neostryder/neo-angband-mod-bug-fixes" },
    ]);
    expect(d.map((x) => `${x.key} ${x.label}`)).toEqual([
      "G Neo Angband itself",
      "1 qol",
      "2 bug-fixes",
      "C Ask in the RPGM Tools Discord",
    ]);
  });

  it("still LISTS a mod it cannot address, with no key and no url", () => {
    /* Dropping it would tell a player with a broken imported mod that no mod
     * could be involved, which is the one thing this list exists to prevent. */
    const d = reportDestinations([{ id: "mystery", repo: "file:import" }]);
    const row = d.find((x) => x.label === "mystery");
    expect(row).toBeDefined();
    expect(row?.url).toBeNull();
    expect(row?.key).toBe("");
  });

  it("does not spend a digit on the mod it could not address", () => {
    /* The numbering counts openable rows, so the digits stay contiguous and the
     * footer's `G/1/C` matches what is on the screen. */
    const d = reportDestinations([
      { id: "mystery", repo: "file:import" },
      { id: "qol", repo: "neostryder/neo-angband-mod-qol" },
    ]);
    expect(d.find((x) => x.label === "qol")?.key).toBe("1");
  });

  it("stops at the cap rather than drawing a screen nobody can read", () => {
    const many = Array.from({ length: REPORT_MAX_MOD_TRACKERS + 4 }, (_, i) => ({
      id: `m${String(i)}`,
      repo: `someone/m${String(i)}`,
    }));
    /* The game and the chat, plus the capped mods. */
    expect(reportDestinations(many)).toHaveLength(REPORT_MAX_MOD_TRACKERS + 2);
  });

  it("only ever emits an id the action census knows about", () => {
    /* `SCREEN_NO_PROMPT` names these ids, and its totality test fails on an action
     * that is in neither of its tables. An id built from a mod's own id could
     * never be listed there, so the set has to stay finite and this is the check
     * that it did. */
    const many = Array.from({ length: REPORT_MAX_MOD_TRACKERS + 4 }, (_, i) => ({
      id: `m${String(i)}`,
      repo: `someone/m${String(i)}`,
    }));
    for (const d of reportDestinations(many)) {
      expect(REPORT_TRACKER_ACTION_IDS, d.id).toContain(d.id);
    }
  });

  it("keeps every id distinct even when some mods cannot be addressed", () => {
    const d = reportDestinations([
      { id: "a", repo: "file:import" },
      { id: "b", repo: "someone/b" },
      { id: "c", repo: "" },
      { id: "d", repo: "someone/d" },
    ]);
    expect(new Set(d.map((x) => x.id)).size).toBe(d.length);
  });
});

describe("the saved page", () => {
  const saved = (over: Partial<ReportView> = {}): string =>
    reportLines(view({ phase: "saved", savedAs: "X", ...over }))
      .map((l) => l.text)
      .join("\n");

  it("prints the address of every row, so nothing opens blind", () => {
    /* The player reads where a key will send them BEFORE pressing it. That is the
     * whole guard against a mod's claimed repository turning out to be a
     * stranger's project. */
    const t = saved({ modOrigins: [{ id: "qol", repo: "neostryder/neo-angband-mod-qol" }] });
    expect(t).toContain(NEO_ANGBAND_TRACKER);
    expect(t).toContain("https://github.com/neostryder/neo-angband-mod-qol/issues");
  });

  it("warns that a mod's address is the mod's own claim, and only when one is listed", () => {
    const withMod = saved({ modOrigins: [{ id: "qol", repo: "neostryder/neo-angband-mod-qol" }] });
    expect(withMod).toContain("has not been");
    expect(withMod).toContain("Read it before you open it");
    /* Nothing to caution about on an unmodded game, and a caution about nothing
     * is how a player learns to skip the one that matters. */
    expect(saved()).not.toContain("Read it before you open it");
  });

  it("puts the warning ABOVE the rows it is about", () => {
    /* The painter stops at the last terminal row, so whatever is lowest is what a
     * small window loses. A caution below the rows it qualifies is a caution the
     * player never reads on exactly the screen where it matters. */
    const lines = reportLines(
      view({
        phase: "saved",
        savedAs: "X",
        modOrigins: [{ id: "qol", repo: "neostryder/neo-angband-mod-qol" }],
      }),
    ).map((l) => l.text);
    const caution = lines.findIndex((l) => l.includes("Read it before you open it"));
    const row = lines.findIndex((l) => l.includes("neo-angband-mod-qol/issues"));
    expect(caution).toBeGreaterThan(-1);
    expect(caution).toBeLessThan(row);
  });

  it("puts the advice above the list, for the same reason", () => {
    const lines = reportLines(view({ phase: "saved", savedAs: "X" })).map((l) => l.text);
    const advice = lines.findIndex((l) => l.includes("One problem per report"));
    const list = lines.findIndex((l) => l.includes("Where to report it"));
    expect(advice).toBeGreaterThan(-1);
    expect(advice).toBeLessThan(list);
  });

  it("marks a destination's address line as a link, issue #59", () => {
    /* The G/1/C keys already open these; `href` is what lets the SAME row be
     * opened with a tap or click too - see showReportPage's cell-tap handling
     * in main.ts, which reads this field to decide what a row's tap does. */
    const lines = reportLines(view({ phase: "saved", savedAs: "X" }));
    const gameRow = lines.find((l) => l.text.includes(NEO_ANGBAND_TRACKER));
    expect(gameRow?.href).toBe(NEO_ANGBAND_TRACKER);
    /* A row with nothing to open (no mod repository recorded) is not a link. */
    const noRepo = reportLines(
      view({
        phase: "saved",
        savedAs: "X",
        modOrigins: [{ id: "unresolvable", repo: "file:import" }],
      }),
    ).find((l) => l.text.includes("no repository recorded"));
    expect(noRepo?.href).toBeUndefined();
  });

  it("tells a first-time reporter the three things that make a report readable", () => {
    const t = saved();
    expect(t).toContain("One problem per report");
    expect(t).toContain("search the tracker first");
    expect(t).toContain("what you did, what you expected, and what happened");
    /* Which of the two forms to pick is itself the guidance: the trackers ask. */
    expect(t).toContain("parity difference");
  });

  it("fits a report with one mod into the rows a small window paints", () => {
    /* MEASURED, not chosen. The painter draws from row 3 and stops at `rows - 2`,
     * keeping the last row for the footer, so a 27-row window paints 23 lines. At
     * five lines of advice the final destination's address fell off the bottom in
     * the desktop build. This is the test that notices the next line added here. */
    const lines = reportLines(
      view({
        phase: "saved",
        savedAs: "C:\\logs\\report.txt",
        modOrigins: [{ id: "demo-hooks", repo: "" }],
      }),
    );
    expect(lines.length).toBeLessThanOrEqual(23);
  });

  it("says a mod has no recorded address rather than guessing at one", () => {
    expect(saved({ modOrigins: [{ id: "mystery", repo: "file:import" }] })).toContain(
      "no repository recorded",
    );
  });

  it("says how many mods it left off the list", () => {
    const many = Array.from({ length: REPORT_MAX_MOD_TRACKERS + 3 }, (_, i) => ({
      id: `m${String(i)}`,
      repo: `someone/m${String(i)}`,
    }));
    expect(saved({ modOrigins: many })).toContain("3 more enabled mods not listed");
  });

  it("shows a notice when one is set, and it is not there otherwise", () => {
    expect(saved({ notice: "qol did not open." })).toContain("qol did not open.");
    expect(saved()).not.toContain("did not open");
  });
});

describe("the compose page", () => {
  it("says what to write, where the key that asks for it is", () => {
    const t = reportLines(view())
      .map((l) => l.text)
      .join("\n");
    expect(t).toContain("what you did, what you expected, and what happened");
  });
});
