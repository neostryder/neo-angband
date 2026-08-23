/**
 * What a browse row and its detail pane SAY.
 *
 * The assertions here are about honesty rather than layout. Every fact on a row comes
 * from somewhere - the mod's repository, the loader's compatibility rule, the author
 * register - and a row that attributes one of them wrongly, or compresses a careful
 * sentence into a word that means something else, is the failure this screen can
 * actually cause. A misaligned column is not.
 */

import { describe, expect, it } from "vitest";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  browseDetail,
  browseRow,
  importedLines,
  installFailureLines,
  installOutcomeLines,
  sourceLabel,
  waitingZipRow,
  type BrowseEntry,
} from "./mod-browse";
import { parseAuthors, type AuthorRegister } from "./mod-authors";
import type { DiscoveredMod } from "./mod-discover";
import { requirementLine } from "./mod-install";
import type { Finding } from "@rpgm-tools/neo-angband-mod-sdk";
import { UI_BAD, UI_DIM, UI_GOLD, UI_TEXT } from "./ui-colors";

const mod = (over: Partial<DiscoveredMod> = {}): DiscoveredMod => ({
  repo: "neostryder/neo-angband-mod-qol",
  tag: "v0.13.0",
  tags: ["v0.13.0"],
  id: "qol",
  name: "Quality of Life",
  author: "neostryder",
  version: "0.13.0",
  description: "Conveniences Angband does not have.\nA second line.",
  engine: ">=0.18.0",
  compatible: true,
  engineNote: null,
  channelHeld: null,
  engineHeld: null,
  payload: [{ kind: "file", path: "manifest.json" }],
  bytes: 14543,
  guessedPayload: false,
  ...over,
});

const found = (over: Partial<DiscoveredMod> = {}): BrowseEntry => {
  const m = mod(over);
  return { ok: true, ref: { repo: m.repo }, mod: m };
};

const register: AuthorRegister = (() => {
  const r = parseAuthors(
    JSON.stringify({
      schema: 1,
      authors: [{ owner: "neostryder", name: "neostryder (RPGM Tools)", check: "maintainer" }],
    }),
    "test",
  );
  if (!r.ok) throw new Error(r.problem);
  return r.register;
})();

describe("browseRow", () => {
  it("shows the mod's own name, version and size", () => {
    const row = browseRow(found(), null);
    expect(row.label).toContain("Quality of Life");
    expect(row.label).toContain("0.13.0");
    expect(row.label).toContain("14 KiB");
  });

  it("uses only the FIRST line of the description as the hint", () => {
    /* A multi-line description in a one-line hint would run the two together into a
     * sentence the author never wrote. */
    expect(browseRow(found(), null).hint).toBe("Conveniences Angband does not have.");
  });

  it("distinguishes not installed, installed, and installed at another version", () => {
    expect(browseRow(found(), null).label.startsWith("[ ]")).toBe(true);
    expect(browseRow(found(), "v0.13.0").label.startsWith("[*]")).toBe(true);
    expect(browseRow(found(), "v0.13.0").label).toContain("installed");

    const older = browseRow(found(), "v0.12.0");
    expect(older.label.startsWith("[~]")).toBe(true);
    /* Names the version the player HAS, not an arrow. The old catalogue row drew
     * `v0.12.0 -> v0.11.0  Enter to update` whichever way round the two stood; this
     * one states both facts and lets the action menu name the direction. */
    expect(older.label).toContain("installed v0.12.0");
  });

  it("says an incompatible mod will not run, instead of offering it", () => {
    const row = browseRow(
      found({ compatible: false, engineNote: "needs engine >=99.0.0", engine: ">=99.0.0" }),
      null,
    );
    expect(row.label).toMatch(/will not run/u);
    expect(row.hint).toContain(">=99.0.0");
  });

  it("does not claim to know an engine range that was not stated", () => {
    const row = browseRow(found({ compatible: false, engine: null, engineNote: null }), null);
    expect(row.hint).toContain("unstated");
  });

  it("mentions a version the player's CHANNEL is holding back", () => {
    /* Otherwise the row shows 0.13.0 while the repository's front page shows
     * 0.14.0-beta.1, and the game looks out of date rather than deliberate. */
    expect(browseRow(found({ channelHeld: "v0.14.0-beta.1" }), null).hint).toContain(
      "faster channel",
    );
  });

  it("carries NO author badge - the register must not be compressed into a word", () => {
    /* The defect this prevents: a marker beside a name reads as "checked", and no
     * listing means that. The full sentence lives in the detail pane, which is shown
     * by default, so nothing is hidden - it is just not abbreviated into a claim. */
    const row = browseRow(found(), null);
    expect(`${row.label} ${row.hint ?? ""}`).not.toMatch(
      /\b(verified|trusted|official|audited|safe)\b/iu,
    );
  });

  it("makes an unreachable repository a ROW, not a missing row", () => {
    /* A curated list that quietly shrinks gives the player no way to tell a mod that
     * was removed from one that could not be reached. */
    const row = browseRow({ ok: false, ref: { repo: "a/gone" }, problem: "not there (HTTP 404)" }, null);
    expect(row.label).toContain("a/gone");
    expect(row.label).toMatch(/unavailable/u);
    expect(row.hint).toContain("404");
  });
});

describe("browseDetail", () => {
  const text = (e: BrowseEntry, at: string | null = null, reg = register): string =>
    browseDetail(e, at, reg)
      .map((l) => l.text)
      .join("\n");

  it("attributes every fact: version, engine, size, and where it came from", () => {
    const t = text(found());
    expect(t).toContain("0.13.0");
    expect(t).toContain(">=0.18.0");
    expect(t).toContain("14 KiB");
    expect(t).toContain("https://github.com/neostryder/neo-angband-mod-qol");
  });

  it("keeps a multi-line description on multiple lines", () => {
    expect(text(found())).toContain("A second line.");
  });

  it("states the author's standing in the register's own careful words", () => {
    const t = text(found());
    expect(t).toContain("neostryder (RPGM Tools)");
    expect(t).toMatch(/nothing here reviews it/u);
  });

  it("says an unlisted author is unlisted, without accusing them", () => {
    const t = text(found({ repo: "somebody/neo-angband-mod-thing" }));
    expect(t).toMatch(/not in the author register/u);
    expect(t).not.toMatch(/\b(danger|unsafe|risk|untrusted|suspicious)\b/iu);
  });

  it("admits when the payload was GUESSED rather than declared", () => {
    /* The difference between "the author decided what ships" and "the game worked it
     * out", which is exactly what somebody reporting a broken install needs to know. */
    expect(text(found({ guessedPayload: true }))).toMatch(/does not declare which of its files/u);
    expect(text(found({ guessedPayload: false }))).not.toMatch(/does not declare/u);
  });

  it("shows the installed version alongside the offered one", () => {
    const t = text(found(), "v0.12.0");
    expect(t).toContain("Installed  v0.12.0");
    expect(t).toContain("(tag v0.13.0)");
  });

  it("survives a null author register, which decides nothing", () => {
    /* A register outage must never look like a mod problem. */
    const t = browseDetail(found(), null, null)
      .map((l) => l.text)
      .join("\n");
    expect(t).toContain("Quality of Life");
    expect(t).toMatch(/not in the author register/u);
  });

  it("explains an unreachable repository rather than showing a blank pane", () => {
    const t = text({ ok: false, ref: { repo: "a/gone" }, problem: "not there (HTTP 404)" });
    expect(t).toContain("could not be read");
    expect(t).toContain("404");
  });
});

/**
 * The unmet requirements of the mod the capture was taken from: a manifest with no
 * repository, author or engine range, shipping a plugin.js it does not admit to.
 *
 * Copied from what `checkMod` actually answers rather than invented, because the
 * assertion below is that the RENDERING did not move when the flattening stopped -
 * and a fixture that is not what the producer emits would pin the wrong thing.
 */
const UNMET: readonly Finding[] = [
  {
    id: "declare-a-repository",
    level: "required",
    title: "Say where the mod lives, in `repository`",
    problem: "no repository declared",
  },
  { id: "name-the-author", level: "required", title: "Name the author", problem: "no author declared" },
  {
    id: "engine-range",
    level: "required",
    title: "Declare the engine range the mod was written against",
    problem: "no engine range declared",
  },
  {
    id: "plugin-declares-modapi",
    level: "required",
    title: "Declare modApi if the mod ships plugin.js",
    problem: "ships plugin.js but declares no modApi",
  },
  {
    id: "plugin-declares-facet",
    level: "required",
    title: "Say the mod contains code, if it ships plugin.js",
    problem: 'ships plugin.js but neither shape nor facets says "plugin"',
  },
];

/**
 * The LINES a refusal renders. The SCREEN that carries them - `installFailureScreen`
 * ("core:mod-install-failure") and `zipImportFailureScreen`
 * ("core:mod-zip-import-failure"), both from this module - is asserted in
 * `mod-screens.test.ts`, which checks the half this file cannot see: that each unmet
 * requirement is a table row addressable by the finding's own id, with the problem in
 * `ScreenRow.detail` rather than in a cell. Two files because there are two failures:
 * a wording that stops being the producer's own, and a row a mod cannot reach.
 */
describe("installFailureLines", () => {
  it("gives each unmet requirement its own row, with the reason beneath it", () => {
    /* THIS TEST DELIBERATELY NO LONGER ASSERTS BYTE-IDENTITY, and the reason is
     * the point of the change rather than an exception to it.
     *
     * It used to be "renders a requirements refusal byte for byte as the
     * flattened string did", pinning the rows the hand-glued `problem` string
     * emitted. The screen is now a table: one row per `Finding`, addressable by
     * the finding's own id, with the reason as that row's `detail`.
     *
     * The bytes MOVED, once, at exactly one boundary. The old rendering flowed
     * "title: problem" as a single sentence and wrapped it wherever it landed,
     * so three of these five findings had part of their REASON sitting on the
     * title's line. A detail is prose belonging to the row and cannot be cut
     * into row fragments - that is the block model's own rule - so the reason
     * starts on its own line. Five findings therefore render as ten rows rather
     * than eight.
     *
     * That movement was allowed rather than worked around because this is the
     * mod manager's own screen and nothing upstream pins it: there is no C to
     * disagree with. A shim that reproduced the old wrap would have had to
     * split a detail into fragments, which is the shape `ScreenRow.detail`
     * exists to stop.
     *
     * Full ScreenLine objects, so a colour that moved would show here too - and
     * note the detail rows carry a `runs` array where a plain coloured line
     * does not. */
    const lines = installFailureLines(
      "Demo",
      "demo: this mod does not meet the requirements, so installing it would not give you a working mod.",
      UNMET,
    );
    expect(lines).toEqual([
      { text: "Demo was not installed.", color: UI_BAD },
      { text: "", color: UI_TEXT },
      {
        text: "demo: this mod does not meet the requirements, so installing it would not",
        color: UI_GOLD,
      },
      { text: "give you a working mod.", color: UI_GOLD },
      { text: "  - Say where the mod lives, in `repository`", color: UI_GOLD },
      {
        text: "  no repository declared",
        color: UI_GOLD,
        runs: [{ text: "  no repository declared", color: UI_GOLD }],
      },
      { text: "  - Name the author", color: UI_GOLD },
      {
        text: "  no author declared",
        color: UI_GOLD,
        runs: [{ text: "  no author declared", color: UI_GOLD }],
      },
      { text: "  - Declare the engine range the mod was written against", color: UI_GOLD },
      {
        text: "  no engine range declared",
        color: UI_GOLD,
        runs: [{ text: "  no engine range declared", color: UI_GOLD }],
      },
      { text: "  - Declare modApi if the mod ships plugin.js", color: UI_GOLD },
      {
        text: "  ships plugin.js but declares no modApi",
        color: UI_GOLD,
        runs: [{ text: "  ships plugin.js but declares no modApi", color: UI_GOLD }],
      },
      { text: "  - Say the mod contains code, if it ships plugin.js", color: UI_GOLD },
      {
        text: '  ships plugin.js but neither shape nor facets says "plugin"',
        color: UI_GOLD,
        runs: [
          { text: '  ships plugin.js but neither shape nor facets says "plugin"', color: UI_GOLD },
        ],
      },
      { text: "The mod's author can check this themselves with `npx", color: UI_GOLD },
      { text: "neo-angband-mod-check`.", color: UI_GOLD },
      { text: "", color: UI_TEXT },
      { text: "Nothing was stored, so your other mods are untouched.", color: UI_DIM },
    ]);
  });

  it("words each row from the finding itself, not from a second copy of it", () => {
    /* Derived, for the reason the update report's status column is: the wording
     * belongs to the module that refuses, and a copy here would rot.
     *
     * Both HALVES are checked, because the row and its detail come from
     * different fields now and a producer that dropped one would still satisfy
     * the other. Taken from the Finding rather than from a literal, so a
     * reworded requirement cannot make this pass while the screen goes wrong. */
    const found = UNMET[1]!;
    const texts = installFailureLines("Demo", "summary", UNMET).map((l) => l.text);
    expect(texts).toContain(`  - ${found.title}`);
    expect(texts).toContain(`  ${found.problem}`);
    /* And the composed spelling is GONE - it is what the table replaced. */
    expect(texts).not.toContain(requirementLine(found));
  });

  it("shows nothing but the sentence when no requirements were asked about", () => {
    /* A zip-slip or quota refusal carries no findings, and must not grow the advice
     * paragraph that only makes sense beside a list of them. */
    const texts = installFailureLines("Demo", "a/b: escapes the mod folder").map((l) => l.text);
    expect(texts).toEqual([
      "Demo was not installed.",
      "",
      "a/b: escapes the mod folder",
      "",
      "Nothing was stored, so your other mods are untouched.",
    ]);
  });

  it("says nothing was stored, because nothing was", () => {
    /* A failed install that leaves a player wondering whether it half-happened is a
     * worse outcome than the failure. */
    const t = installFailureLines("Demo", "nope").map((l) => l.text).join(" ");
    expect(t).toMatch(/Nothing was stored/u);
  });
});

describe("sourceLabel", () => {
  it("names the curated list, and calls anybody else's list by its own name", () => {
    expect(sourceLabel("curated", "ignored")).toBe("Recommended mods");
    expect(sourceLabel("third-party", "Somebody's picks")).toBe("Somebody's picks");
  });
});

describe("the screen is REACHABLE", () => {
  /* The lesson this repository keeps paying for: a feature finished everywhere except
   * where it is used. Four commits of discovery, consent, curation and an author
   * register were all complete and called by nothing but their own tests. */
  const read = (f: string): string =>
    readFileSync(join(import.meta.dirname, f), "utf8");

  it("is wired into the mod screen's Get mods row", () => {
    expect(read("mods.ts")).toContain("showModBrowse(term, {");
  });

  it("is given real dependencies by main.ts, not left optional forever", () => {
    const main = read("main.ts");
    expect(main).toContain("modBrowse: modBrowseDeps()");
    /* And the pieces it was supposed to make reachable are actually wired: */
    expect(main).toContain("discoverMod(ref, discoverEnv)");
    expect(main).toContain("installModFromRepo(");
    expect(main).toContain("fetchRegistry(DEFAULT_REGISTRY_URL");
    expect(main).toContain("fetchAuthors(DEFAULT_AUTHORS_URL");
  });

  it("takes the player's channel from the SAME store the updater reads", () => {
    /* One channel setting governing both. A second store here would be two settings
     * that fall out of step silently, which is the failure the shared rule exists to
     * prevent. */
    expect(read("main.ts")).toContain("channel: readChannel(channelStore(), ENGINE_VERSION)");
  });

  it("passes the consent answer to the installer, which is where the gate is", () => {
    expect(read("main.ts")).toMatch(/allowed: readConsent\(channelStore\(\)\)/u);
  });
});

describe("the detail pane wraps", () => {
  const LONG =
    "Conveniences that faithful Angband does not have. Angband's own options are " +
    "correct as they stand, so nothing here changes them; each tweak is a named " +
    "toggle you can switch on by itself.";

  it("never emits a line wider than the pane", () => {
    /* MEASURED in the real build before this existed: descriptions ran off the right
     * edge and were cut mid-word - "Angband's own options are cor" - and the author
     * standing lost the half of the sentence that says nobody reviewed the code.
     * Truncation eats the END of a line, which is where a qualification lives. */
    for (const width of [40, 60, 78, 120]) {
      const lines = browseDetail(found({ description: LONG }), null, register, width);
      const over = lines.filter((l) => l.text.length > width).map((l) => l.text);
      /* A URL is exempt and documented as such: it has no spaces to break at. */
      expect(over.filter((t) => !t.includes("http")), `width ${String(width)}`).toEqual([]);
    }
  });

  it("keeps the author's own paragraph breaks", () => {
    const lines = browseDetail(
      found({ description: "First para.\n\nSecond para." }),
      null,
      register,
      70,
    );
    const texts = lines.map((l) => l.text);
    expect(texts).toContain("First para.");
    expect(texts).toContain("Second para.");
    /* And the blank line between them survives rather than being collapsed. */
    const a = texts.indexOf("First para.");
    const b = texts.indexOf("Second para.");
    expect(texts.slice(a + 1, b)).toContain("");
  });

  it("wraps the author standing, the sentence whose END is the caveat", () => {
    const lines = browseDetail(found(), null, register, 40);
    const joined = lines.map((l) => l.text).join(" ");
    /* The caveat has to SURVIVE, not just be emitted at a width nobody uses. */
    expect(joined).toMatch(/nothing here reviews it/u);
  });

  it("does not fold a long word it cannot break", () => {
    /* A greedy wrap must not lose characters trying to fit an unbreakable token. */
    const word = "x".repeat(120);
    const lines = browseDetail(found({ description: word }), null, register, 40);
    expect(lines.map((l) => l.text)).toContain(word);
  });
});

describe("what the screen says after importing a zip", () => {
  const text = (lines: readonly { text: string }[]): string => lines.map((l) => l.text).join("\n");

  it("says where the archive was moved to, and never that it was deleted", () => {
    const out = text(
      importedLines("qol", 2, "qol.zip", { ok: true, to: "imported/qol.zip" }, false),
    );
    expect(out).toContain("qol.zip has been moved to imported/qol.zip in the mods folder.");
    /* The whole point of the change: the player's download survives the import, and
     * the screen has to be the thing that says so. */
    expect(out).toContain("Kept, not deleted");
    expect(out).not.toMatch(/deleted from|has been removed/u);
  });

  it("still names a home when the shell did not say which file it became", () => {
    /* An older shell answers {ok:true} with no `to`. "moved to imported/" is less
     * useful than the exact name and still tells a player where to look. */
    const out = text(importedLines("qol", 2, "qol.zip", { ok: true }, false));
    expect(out).toContain("moved to imported/ in the mods folder");
  });

  it("says the file is untouched when this platform never could move it", () => {
    /* null, not {ok:false}. A browser tab has no authority over a file the player
     * chose, and reporting that as a failed move invents a fault. */
    const out = text(importedLines("qol", 2, "qol.zip", null, false));
    expect(out).toContain("qol.zip is still where you left it.");
    expect(out).not.toMatch(/could not be moved/u);
  });

  it("says the MOVE failed, with the reason, and that the mod is fine", () => {
    const out = text(importedLines("qol", 2, "qol.zip", { ok: false, error: "EBUSY" }, false));
    expect(out).toContain("still loose in the mods folder");
    expect(out).toContain("EBUSY");
    /* The install succeeded. A player who reads only the warning must still be told
     * the mod is installed and that tidying the file up by hand is safe. */
    expect(out).toContain("qol installed.");
    expect(out).toContain("Moving the file yourself is safe.");
  });

  it("never claims a mod is on just because it is installed", () => {
    for (const d of [null, { ok: true }, { ok: false, error: "x" }]) {
      const off = text(importedLines("qol", 1, "qol.zip", d, false));
      expect(off, JSON.stringify(d)).toContain("It is OFF until you turn it on");
      const on = text(importedLines("qol", 1, "qol.zip", d, true));
      expect(on, JSON.stringify(d)).toContain("It is enabled.");
    }
  });

  it("names the archive on its row with a size a player can read", () => {
    expect(waitingZipRow({ name: "qol.zip", bytes: 5550 })).toBe("qol.zip  (5.4 KiB)");
  });
});

describe("a refusal must not lose its last words", () => {
  it("wraps a long problem instead of letting the screen cut it", () => {
    /* MEASURED AGAINST A REAL MESSAGE. The import refusal for a two-mod archive ends
     * with the instruction - "each in its own zip" - and truncation eats the END of a
     * line, so an unwrapped refusal shows the complaint and drops the fix. */
    const problem =
      "this archive holds more than one mod (alpha, beta). " +
      "Import them one at a time, each in its own zip.";
    const lines = installFailureLines("two-mods.zip", problem);
    expect(lines.every((l) => l.text.length <= 74)).toBe(true);
    expect(lines.map((l) => l.text).join(" ")).toContain("each in its own zip.");
    /* More than one line, or the wrap did nothing and the assertion above is vacuous. */
    expect(lines.filter((l) => l.text !== "").length).toBeGreaterThan(3);
  });

  it("keeps the author's own line breaks", () => {
    const lines = installFailureLines("x", "first\nsecond");
    const texts = lines.map((l) => l.text);
    expect(texts).toContain("first");
    expect(texts).toContain("second");
  });
});

/**
 * What the player is told after a successful install.
 *
 * THE WORDING IS THE FEATURE. There used to be one message for a first install and
 * for an update, and on an update of a mod the player had already switched on it
 * said "It is OFF until you turn it on in the mod list." - which is a message that
 * sends someone to fix something that is not broken. Every assertion here is about a
 * sentence, because a sentence is what was wrong.
 */
describe("what an install says it did", () => {
  const text = (before: string | null, after: string, enabled = false): string =>
    installOutcomeLines("Quality of Life", "0.14.0", before, after, enabled)
      .map((l) => l.text)
      .join(String.fromCharCode(10));

  it("a FIRST install says installed, and whether it is on", () => {
    expect(text(null, "v0.14.0", true)).toContain("installed.");
    expect(text(null, "v0.14.0", true)).toContain("It is enabled.");
    expect(text(null, "v0.14.0", false)).toContain("It is OFF until you turn it on");
  });

  it("an UPDATE never says the mod is off", () => {
    /* The defect, stated as the assertion that would have caught it. */
    const said = text("v0.13.0", "v0.14.0");
    expect(said).not.toContain("OFF");
    expect(said).not.toContain("Nothing is enabled");
    expect(said).not.toContain(" installed.");
  });

  it("an UPDATE names both versions, in the right direction", () => {
    expect(text("v0.13.0", "v0.14.0")).toContain("updated: v0.13.0 -> v0.14.0");
  });

  it("going BACKWARDS is not called an update", () => {
    /* A player who deliberately reinstalled an older version is owed the truth about
     * which way they moved; "updated" there is the same lie the row used to tell. */
    expect(text("v0.14.0", "v0.13.0")).toContain("rolled back");
    expect(text("v0.14.0", "v0.13.0")).not.toContain("updated");
  });

  it("two tags that cannot be ordered are 'replaced', and claim no direction", () => {
    const said = text("nightly", "v0.14.0");
    expect(said).toContain("replaced");
    expect(said).not.toContain("updated");
    expect(said).not.toContain("rolled back");
  });

  it("an UPDATE says what became of the two things a player worries about", () => {
    const said = text("v0.13.0", "v0.14.0");
    expect(said).toContain("on/off choice");
    expect(said).toContain("settings");
    expect(said).toContain("Reload");
  });

  it("the enabled flag cannot leak into an update's wording", () => {
    /* installOne only asks on a first install, so `enabled` is meaningless here -
     * and a message that changed with it would mean the caller had to keep passing
     * something true. */
    expect(text("v0.13.0", "v0.14.0", true)).toBe(text("v0.13.0", "v0.14.0", false));
  });
});

/* ------------------------------------------------------------------ */
/* A newer version this build cannot run                              */
/* ------------------------------------------------------------------ */

describe("what the screen says about a version it stepped back from", () => {
  const HELD = {
    tag: "v0.15.0",
    version: "0.15.0",
    engine: ">=0.23.0",
    why: "was written for engine >=0.23.0, and this game is 0.22.0",
    newerGameHelps: true,
  } as const;

  it("names the held version on the row, without spending the description's space", () => {
    const row = browseRow(found({ engineHeld: HELD }), null);
    expect(row.hint).toContain("v0.15.0 needs a newer game");
    /* The description still leads, because that is what a player is reading the
     * row for. The clause is an aside. */
    expect(row.hint?.startsWith("v0.15.0")).toBe(false);
  });

  it("tells the player in the pane what is being installed and what would get the rest", () => {
    const lines = browseDetail(found({ engineHeld: HELD }), null, null).map((l) => l.text);
    const text = lines.join(" ");
    expect(text).toContain("v0.15.0 is newer and needs a newer game");
    /* Both halves, because either one alone is misleading: the version that IS
     * being installed, and the action that gets the other one. */
    expect(text).toContain("Update the game to get v0.15.0");
  });

  it("does NOT say update the game when a newer game would not help", () => {
    const lines = browseDetail(
      found({ engineHeld: { ...HELD, engine: "<0.5.0", newerGameHelps: false } }),
      null,
      null,
    ).map((l) => l.text);
    const text = lines.join(" ");
    expect(text).toContain("will not run here");
    expect(text).not.toContain("Update the game");
  });

  it("says how many versions were checked when it could not find one that runs", () => {
    const row = browseRow(found({ compatible: false, versionsChecked: 4 }), null);
    expect(row.hint).toContain("previous version(s)");
  });
});
