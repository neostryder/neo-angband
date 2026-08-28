import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  DEFAULT_AUTHORS_URL,
  authorFor,
  displayName,
  ownerOf,
  shortAuthor,
  parseAuthors,
  standingNote,
  type AuthorRegister,
} from "./mod-authors";

const URL_ = "https://example.test/authors.json";

const doc = (over: Record<string, unknown> = {}): string =>
  JSON.stringify({
    schema: 1,
    authors: [{ owner: "neostryder", name: "neostryder (RPGM Tools)", check: "maintainer" }],
    ...over,
  });

const parsed = (body: string): AuthorRegister => {
  const r = parseAuthors(body, URL_);
  if (!r.ok) throw new Error(r.problem);
  return r.register;
};

describe("displayName: the author beside the name", () => {
  it("reads the way a player would write it", () => {
    expect(displayName("Linoleum", "neostryder")).toBe("Linoleum (neostryder)");
  });

  it("drops an organisation in parentheses instead of nesting brackets", () => {
    /* Measured against the real first-party manifests, which declare
     * "neostryder (RPGM Tools)" - so the naive version produced
     * "Linoleum (neostryder (RPGM Tools))" on a row with warnings to fit after
     * it, and dropped the author entirely from the longest-named mod. The full
     * string is still printed in the detail pane. */
    expect(displayName("linoleum", "neostryder (RPGM Tools)")).toBe(
      "linoleum (neostryder)",
    );
    expect(shortAuthor("neostryder (RPGM Tools)")).toBe("neostryder");
    /* Only a SPACED bracket, and only after something: a handle that IS a bracketed
     * string keeps it rather than becoming empty. */
    expect(shortAuthor("(anonymous)")).toBe("(anonymous)");
    expect(shortAuthor("some-org(inc)")).toBe("some-org(inc)");
  });

  it("says just the name when the manifest has no author", () => {
    /* Every manifest is required to declare one, but a mod installed before that
     * rule still has to be listed - as itself, not as "Linoleum ()". */
    for (const missing of [null, undefined, ""]) {
      expect(displayName("Linoleum", missing)).toBe("Linoleum");
    }
  });

  it("drops the author WHOLE rather than truncating it", () => {
    /* The rule that matters: "Bug Fixes (neost..." attributes a mod to an account
     * that does not exist. Not saying is better than misattributing. */
    expect(displayName("Bug Fixes", "neostryder", 20)).toBe("Bug Fixes");
    /* Exactly enough room keeps it, so the cutoff is not off by one. */
    expect(displayName("Bug Fixes", "neo", 15)).toBe("Bug Fixes (neo)");
    expect(displayName("Bug Fixes", "neo", 14)).toBe("Bug Fixes");
  });

  it("elides the NAME only after the author is already gone", () => {
    expect(displayName("An Extremely Long Mod Name", "neostryder", 12)).toBe("An Extrem...");
    expect(displayName("An Extremely Long Mod Name", null, 12)).toBe("An Extrem...");
  });

  it("says the whole thing when nobody asked for a width", () => {
    const long = "x".repeat(200);
    expect(displayName(long, long)).toBe(`${long} (${long})`);
  });
});

describe("parseAuthors", () => {
  it("reads an owner, a display name and how the claim was checked", () => {
    const reg = parsed(doc());
    expect(reg.authors).toEqual([
      { owner: "neostryder", name: "neostryder (RPGM Tools)", check: "maintainer", about: null },
    ]);
    expect(reg.problems).toEqual([]);
  });

  it("falls back to the owner when no display name is given", () => {
    expect(parsed(doc({ authors: [{ owner: "someone", check: "declared" }] })).authors[0]?.name).toBe(
      "someone",
    );
  });

  it("refuses an entry whose owner is a path rather than an account", () => {
    /* `neostryder/thing` would never match an owner, so it would be quietly inert -
     * a listing that looks granted and does nothing. Refused where it can be seen. */
    const reg = parsed(doc({ authors: [{ owner: "neostryder/qol", check: "declared" }] }));
    expect(reg.authors).toEqual([]);
    expect(reg.problems[0]).toMatch(/not a GitHub account name/u);
  });

  it("refuses an entry with no check rather than inventing a standing", () => {
    /* Defaulting would grant a standing nobody granted. The value of a closed set is
     * that every value in it was chosen deliberately. */
    for (const check of [undefined, "", "verified", "trusted", 1]) {
      const reg = parsed(doc({ authors: [{ owner: "someone", check }] }));
      expect(reg.authors, JSON.stringify(check)).toEqual([]);
      expect(reg.problems[0]).toMatch(/must be "maintainer" or "declared"/u);
    }
  });

  it("loses one bad entry, not the register", () => {
    const reg = parsed(
      doc({
        authors: [
          { owner: "a", check: "declared" },
          "nonsense",
          { owner: "b", check: "declared" },
        ],
      }),
    );
    expect(reg.authors.map((a) => a.owner)).toEqual(["a", "b"]);
    expect(reg.problems).toHaveLength(1);
  });

  it("reports a duplicate owner instead of quietly dropping it", () => {
    const reg = parsed(
      doc({ authors: [{ owner: "Neo", check: "declared" }, { owner: "neo", check: "declared" }] }),
    );
    expect(reg.authors).toHaveLength(1);
    expect(reg.problems[0]).toMatch(/listed more than once/u);
  });

  it("refuses a document that is not a register, and never throws", () => {
    for (const bad of ["", "[]", "null", "not json", JSON.stringify({ authors: [] })]) {
      expect(parseAuthors(bad, URL_).ok, bad).toBe(false);
    }
  });

  it("blames the GAME for a schema from the future", () => {
    const r = parseAuthors(doc({ schema: 99 }), URL_);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problem).toMatch(/newer kind of author register/u);
  });
});

describe("matching a repository to an author", () => {
  const reg = parsed(doc());

  it("matches on the owner half, case-insensitively", () => {
    /* GitHub account names are not case-sensitive, so a register that was would
     * report the author of NeoStryder/x as unknown. */
    expect(authorFor(reg, "neostryder/neo-angband-mod-qol")?.owner).toBe("neostryder");
    expect(authorFor(reg, "NeoStryder/Neo-Angband-Mod-QoL")?.owner).toBe("neostryder");
  });

  it("does not match an unlisted owner, or a malformed reference", () => {
    expect(authorFor(reg, "someoneelse/mod")).toBeNull();
    expect(authorFor(reg, "nonsense")).toBeNull();
    expect(authorFor(null, "neostryder/x")).toBeNull();
  });

  it("takes the owner from before the first slash only", () => {
    expect(ownerOf("a/b/c")).toBe("a");
    expect(ownerOf("/leading")).toBe("");
    expect(ownerOf("noslash")).toBe("");
  });
});

describe("standingNote: what a listing must not be read as", () => {
  const reg = parsed(doc());

  it("never says the code was reviewed, for a listed author", () => {
    /* The defect this prevents is a badge that buys trust nobody earned: an
     * author's FUTURE commits are not reviewed by anybody, so a note implying
     * review would be false the moment they push. */
    const note = standingNote(authorFor(reg, "neostryder/x"), "neostryder/x");
    expect(note).toMatch(/nothing here reviews it/u);
    expect(note).not.toMatch(/\b(safe|audited|verified|secure)\b/iu);
  });

  it("says a declared listing records the ACCOUNT, not the code", () => {
    const other = parsed(doc({ authors: [{ owner: "someone", check: "declared" }] }));
    const note = standingNote(authorFor(other, "someone/x"), "someone/x");
    expect(note).toMatch(/records the account, not a review/u);
  });

  it("does not accuse an unlisted author of anything", () => {
    /* Most good mods will be by people who never asked to be listed. Teaching
     * players that unlisted means dangerous would make this file a gate on who may
     * write mods, which it must never be. */
    const note = standingNote(null, "somebody/mod");
    expect(note).toContain("somebody");
    expect(note).toMatch(/not in the author register/u);
    expect(note).not.toMatch(/\b(danger|unsafe|risk|warning|untrusted|suspicious)\b/iu);
  });

  it("still says something when the reference is unparseable", () => {
    expect(standingNote(null, "nonsense")).toMatch(/unknown author/u);
  });
});

describe("the register this repository ships", () => {
  const FILE = join(import.meta.dirname, "..", "..", "..", "mods", "authors.json");
  const body = (): string => readFileSync(FILE, "utf8");

  it("is a register this build can read, with neostryder in it", () => {
    const reg = parsed(body());
    expect(reg.problems).toEqual([]);
    expect(reg.authors.map((a) => a.owner)).toContain("neostryder");
    expect(authorFor(reg, "neostryder/neo-angband-mod-qol")?.check).toBe("maintainer");
  });

  it("is where DEFAULT_AUTHORS_URL points", () => {
    expect(DEFAULT_AUTHORS_URL).toContain("/neostryder/neo-angband/");
    expect(DEFAULT_AUTHORS_URL).toMatch(/\/mods\/authors\.json$/u);
  });

  it("says nothing about any MOD - only about people", () => {
    /* The same ratchet mods/registry.json has, for the same reason. An author is a
     * fact about a person and may live in this repository; the moment a mod's name,
     * version or repository appears in an entry here, the build has started knowing
     * about mods again - which is what the whole redesign exists to stop. */
    const doc_ = JSON.parse(body()) as { authors: Array<Record<string, unknown>> };
    const allowed = new Set(["owner", "name", "check", "about"]);
    for (const entry of doc_.authors) {
      for (const key of Object.keys(entry)) {
        expect(allowed.has(key), `unexpected field "${key}"`).toBe(true);
      }
      /* And nothing that smells like a mod reference smuggled into a text field. */
      for (const value of Object.values(entry)) {
        if (typeof value === "string") expect(value).not.toMatch(/neo-angband-mod-/u);
      }
    }
  });

  it("tells an author how to be listed, in the file itself", () => {
    /* A register with no stated route in is a closed club by accident. */
    expect(JSON.parse(body())["about"]).toMatch(/open an issue/iu);
  });
});
