/**
 * Every requirement, proved able to FAIL.
 *
 * A checker whose rules all pass on everything is worse than no checker: it answers
 * "your mod is fine" without having looked, and an author believes it. So the shape
 * of this file is one deliberately broken mod per rule, and a test that no rule is
 * left unexercised - if a rule is ever added without a failing case, the last test
 * here says which one.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  MOD_REQUIREMENTS,
  checkMod,
  githubRepo,
  requirementsMarkdown,
  type ModUnderTest,
} from "./standards.js";

const GOOD_MANIFEST = {
  id: "demo",
  name: "Demo",
  version: "1.2.0",
  shape: "content",
  engine: ">=0.18.0",
  license: "MIT",
  author: "neostryder",
  repository: "https://github.com/neostryder/neo-angband-mod-demo",
  description: "A mod that exists to be checked, with a description long enough to count.",
};

/** A mod that passes everything, as the baseline every case below deviates from. */
function goodMod(over: Partial<ModUnderTest> = {}, manifest: unknown = GOOD_MANIFEST): ModUnderTest {
  return {
    files: ["manifest.json", "content/object.json"],
    manifestText: JSON.stringify(manifest),
    ...over,
  };
}

/** The ids of the rules that failed, at either level. */
function failed(mod: ModUnderTest): string[] {
  const r = checkMod(mod);
  return [...r.errors, ...r.advice].map((f) => f.id);
}

describe("the baseline", () => {
  it("passes every rule, so a failure below means the deviation and not the fixture", () => {
    const r = checkMod(goodMod());
    expect(r.errors).toEqual([]);
    expect(r.advice).toEqual([]);
    expect(r.ok).toBe(true);
  });
});

describe("required rules, each shown failing", () => {
  it("manifest-present: a folder with no manifest is not a mod", () => {
    const r = checkMod(goodMod({ files: ["content/object.json"], manifestText: null }));
    expect(r.errors.map((f) => f.id)).toEqual(["manifest-present"]);
    /* ONE failure, not five. A report that lists every downstream consequence of a
     * missing file teaches an author to skim it. */
    expect(r.errors).toHaveLength(1);
  });

  it("manifest-json: a trailing comma stops the whole mod", () => {
    expect(failed(goodMod({ manifestText: '{"id":"demo",}' }))).toContain("manifest-json");
  });

  it("manifest-json: a JSON array is not a manifest", () => {
    expect(failed(goodMod({ manifestText: "[]" }))).toContain("manifest-json");
  });

  it("manifest-fields: delegates to the game's OWN validator", () => {
    /* Not a re-implementation. The point is that a field rule this file never
     * mentions - kebab-case ids - still fails here, because validateManifest owns it
     * and is called rather than copied. */
    const r = checkMod(goodMod({}, { ...GOOD_MANIFEST, id: "Demo_Mod" }));
    expect(r.errors.map((f) => f.id)).toContain("manifest-fields");
    expect(r.errors.find((f) => f.id === "manifest-fields")?.problem).toMatch(/kebab-case/u);
  });

  it("manifest-fields: also catches a bad shape, a bad version, a missing name", () => {
    for (const bad of [
      { shape: "plugins" },
      { version: "1.2" },
      { name: "" },
      { facets: ["tiles"] } /* must contain shape */,
    ]) {
      expect(failed(goodMod({}, { ...GOOD_MANIFEST, ...bad })), JSON.stringify(bad)).toContain(
        "manifest-fields",
      );
    }
  });

  it("plugin-declares-modapi: the documented requirement nothing used to enforce", () => {
    /* validateManifest cannot see files, so "modApi is REQUIRED of any pack that
     * ships plugin.js" was a promise in a docstring with nothing behind it. This is
     * the rule that closes it. */
    const shipsCode = { ...GOOD_MANIFEST, shape: "plugin" };
    const r = checkMod(
      goodMod({ files: ["manifest.json", "plugin.js"] }, shipsCode),
    );
    expect(r.errors.map((f) => f.id)).toContain("plugin-declares-modapi");
  });

  it("plugin-declares-modapi: satisfied by a positive integer, and only that", () => {
    const files = ["manifest.json", "plugin.js"];
    const base = { ...GOOD_MANIFEST, shape: "plugin" };
    expect(failed(goodMod({ files }, { ...base, modApi: 1 }))).toEqual([]);
    for (const bad of [0, -1, 1.5, "1", null]) {
      expect(
        failed(goodMod({ files }, { ...base, modApi: bad })),
        JSON.stringify(bad),
      ).toContain("plugin-declares-modapi");
    }
  });

  it("plugin-declares-modapi: says nothing about a mod that ships no code", () => {
    /* The rule must not become "every mod needs modApi". A data pack has no ABI. */
    expect(failed(goodMod())).toEqual([]);
  });

  it("plugin-declares-facet: a mod shipping code must say so", () => {
    const r = checkMod(
      goodMod({ files: ["manifest.json", "plugin.js"] }, { ...GOOD_MANIFEST, modApi: 1 }),
    );
    expect(r.errors.map((f) => f.id)).toContain("plugin-declares-facet");
  });

  it("plugin-declares-facet: content + plugin facets is the correct way to say it", () => {
    /* And it agrees with hasFacet, which is what the loader gates on - the two must
     * not be able to disagree about the same manifest. */
    expect(
      failed(
        goodMod({ files: ["manifest.json", "plugin.js"] }, {
          ...GOOD_MANIFEST,
          modApi: 1,
          facets: ["content", "plugin"],
        }),
      ),
    ).toEqual([]);
  });

  it("archives-declared: the defect that shipped on a real mod", () => {
    /* neo-linoleum committed seven .zip packs and declared none of them, so an
     * install stored the zips unopened: the mod was present, listed, enabled, and
     * did nothing. Found by a live canary AFTER it shipped that way. */
    const r = checkMod(
      goodMod({
        repoFiles: ["manifest.json", "dist/pack-a.zip", "dist/pack-b.zip"],
      }),
    );
    expect(r.errors.map((f) => f.id)).toContain("archives-declared");
    expect(r.errors.find((f) => f.id === "archives-declared")?.problem).toContain("pack-a.zip");
  });

  it("archives-declared: satisfied by declaring them, and case-insensitive about .ZIP", () => {
    expect(
      failed(
        goodMod({
          repoFiles: ["manifest.json", "dist/pack-a.ZIP"],
          declaredPayload: { archives: ["dist/pack-a.ZIP"] },
        }),
      ),
    ).toEqual([]);
  });

  it("archives-declared: catches a PARTIAL declaration, not just an absent one", () => {
    /* Declaring six of seven is the realistic mistake, and the one a "did they
     * declare a payload at all" test would pass. */
    const r = checkMod(
      goodMod({
        repoFiles: ["manifest.json", "a.zip", "b.zip"],
        declaredPayload: { archives: ["a.zip"] },
      }),
    );
    expect(r.errors.map((f) => f.id)).toContain("archives-declared");
    expect(r.errors.find((f) => f.id === "archives-declared")?.problem).toContain("b.zip");
  });

  it("archives-declared: silent when the repository's files are not known", () => {
    /* The installed folder cannot answer this - after unpacking the zips are gone.
     * Guessing would fail every already-installed mod. */
    expect(failed(goodMod())).toEqual([]);
  });

  it("declare-a-repository: a mod that names nowhere cannot be pinned to anywhere", () => {
    const r = checkMod(goodMod({}, { ...GOOD_MANIFEST, repository: undefined }));
    expect(r.errors.map((f) => f.id)).toContain("declare-a-repository");
  });

  it("declare-a-repository: accepts every spelling an author would actually write", () => {
    for (const url of [
      "https://github.com/neostryder/neo-angband-mod-qol",
      "http://github.com/neostryder/neo-angband-mod-qol/",
      "git+https://github.com/neostryder/neo-angband-mod-qol.git",
      "git@github.com:neostryder/neo-angband-mod-qol.git",
      "github:neostryder/neo-angband-mod-qol",
      "neostryder/neo-angband-mod-qol",
      /* Not GitHub, so no update check - but hosting is the author's business, and
       * a REQUIRED rule that refused this would be this project's convenience
       * imposed as somebody else's rule. `updates-can-be-offered` says so as advice. */
      "https://gitlab.com/someone/their-mod",
    ]) {
      expect(
        failed(goodMod({}, { ...GOOD_MANIFEST, repository: url })),
        url,
      ).not.toContain("declare-a-repository");
    }
  });

  it("declare-a-repository: refuses text that names no repository at all", () => {
    for (const bad of ["", "   ", "see the readme", 42, null]) {
      expect(
        failed(goodMod({}, { ...GOOD_MANIFEST, repository: bad })),
        JSON.stringify(bad),
      ).toContain("declare-a-repository");
    }
  });

  it("credit-an-author: the name shown beside the mod cannot be absent", () => {
    for (const bad of [undefined, "", "   ", 42, null]) {
      expect(
        failed(goodMod({}, { ...GOOD_MANIFEST, author: bad })),
        JSON.stringify(bad),
      ).toContain("credit-an-author");
    }
  });

  it("engine-range: absent is now a REFUSAL, not advice", () => {
    /* Promoted deliberately. A mod with no range is offered to every future version
     * of the game forever, and the version that breaks it is the one nobody warned
     * anybody about. Asserted at the level, not just by id, because the whole point
     * of the change is which list it lands in. */
    const r = checkMod(goodMod({}, { ...GOOD_MANIFEST, engine: undefined }));
    expect(r.errors.map((f) => f.id)).toContain("engine-range");
    expect(r.advice.map((f) => f.id)).not.toContain("engine-range");
    expect(r.ok).toBe(false);
  });

  it("engine-range: an unreadable range is caught, through the loader's own satisfies", () => {
    expect(failed(goodMod({}, { ...GOOD_MANIFEST, engine: ">=not.a.version" }))).toContain(
      "engine-range",
    );
  });
});

describe("githubRepo: one answer, shared by the rule, the installer and the update check", () => {
  it("reduces every accepted spelling to the same owner/name", () => {
    for (const url of [
      "https://github.com/neostryder/neo-angband-mod-qol",
      "https://www.github.com/neostryder/neo-angband-mod-qol",
      "http://github.com/neostryder/neo-angband-mod-qol/",
      "git+https://github.com/neostryder/neo-angband-mod-qol.git",
      "git@github.com:neostryder/neo-angband-mod-qol.git",
      "github:neostryder/neo-angband-mod-qol",
      "neostryder/neo-angband-mod-qol",
      "  neostryder/neo-angband-mod-qol  ",
    ]) {
      expect(githubRepo(url), url).toBe("neostryder/neo-angband-mod-qol");
    }
  });

  it("refuses a URL that points INSIDE a repository rather than at one", () => {
    /* Truncating to the first two segments would accept a link to one file as if it
     * named the project, and the update check would then query a repository the
     * author never meant. */
    for (const url of [
      "https://github.com/neostryder/neo-angband-mod-qol/tree/v1.0.0",
      "https://github.com/neostryder/neo-angband-mod-qol/blob/master/manifest.json",
      "https://github.com/neostryder",
      "https://github.com/",
    ]) {
      expect(githubRepo(url), url).toBeNull();
    }
  });

  it("refuses another host, rather than pretending it is GitHub", () => {
    for (const url of [
      "https://gitlab.com/someone/their-mod",
      "https://codeberg.org/someone/their-mod",
      "git@gitlab.com:someone/their-mod.git",
      "https://example.com/a/b",
      "",
      "   ",
      "not a url",
    ]) {
      expect(githubRepo(url), url).toBeNull();
    }
  });

  it("refuses an owner or name a filesystem or a URL would mangle", () => {
    for (const url of [
      "neostryder/../escape",
      "neostryder/.",
      "../neostryder/mod",
      "neostryder//mod",
      "neo stryder/mod",
      "-leading/mod",
    ]) {
      expect(githubRepo(url), url).toBeNull();
    }
  });
});

describe("recommended rules never block an install", () => {
  it("a mod failing only advice is still ok", () => {
    /* The bare minimum that CAN be installed: everything required and nothing else.
     * It is deliberately a GitLab URL, so `updates-can-be-offered` fires here too and
     * this test proves the same thing it always did - that three failed pieces of
     * advice still add up to an installable mod. */
    const r = checkMod(
      goodMod({}, {
        id: "demo",
        name: "Demo",
        version: "1.0.0",
        shape: "content",
        engine: ">=0.18.0",
        author: "someone",
        repository: "https://gitlab.com/someone/demo",
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
    expect(r.advice.map((f) => f.id).sort()).toEqual([
      "describe-itself",
      "state-a-licence",
      "updates-can-be-offered",
    ]);
  });

  it("updates-can-be-offered: a host the game cannot ask is advice, never a refusal", () => {
    const r = checkMod(goodMod({}, {
      ...GOOD_MANIFEST,
      repository: "https://gitlab.com/someone/their-mod",
    }));
    expect(r.errors).toEqual([]);
    expect(r.advice.map((f) => f.id)).toEqual(["updates-can-be-offered"]);
    expect(r.ok).toBe(true);
  });

  it("updates-can-be-offered: silent when there is no repository to judge", () => {
    /* Otherwise a mod with no repository fails twice for one mistake, and the
     * required rule is the one that says what to do about it. */
    const r = checkMod(goodMod({}, { ...GOOD_MANIFEST, repository: undefined }));
    expect(r.advice.map((f) => f.id)).not.toContain("updates-can-be-offered");
  });

  it("version-orderable: a version no update check can compare", () => {
    /* Caught by manifest-fields too, which is correct - but the ADVICE names the
     * consequence the author actually cares about: updates silently stop. */
    const ids = failed(goodMod({}, { ...GOOD_MANIFEST, version: "2026.07" }));
    expect(ids).toContain("version-orderable");
  });

  it("describe-itself: a description too short to tell anybody anything", () => {
    expect(failed(goodMod({}, { ...GOOD_MANIFEST, description: "A mod." }))).toContain(
      "describe-itself",
    );
  });

  it("state-a-licence: satisfied by the field OR a shipped file", () => {
    const noField = { ...GOOD_MANIFEST, license: undefined };
    expect(failed(goodMod({}, noField))).toContain("state-a-licence");
    for (const name of ["LICENSE", "LICENCE.md", "license.txt"]) {
      expect(
        failed(goodMod({ files: ["manifest.json", name] }, noField)),
        name,
      ).not.toContain("state-a-licence");
    }
  });
});

describe("the checker itself", () => {
  it("survives a rule that throws, and blames the rule", () => {
    /* One broken check must not stop the other nine being useful, and must not be
     * reported as the MOD's fault. */
    const exploding = {
      ...MOD_REQUIREMENTS[0],
      id: "boom",
      check: () => {
        throw new Error("bad rule");
      },
    };
    const report = checkMod({ files: [], manifestText: null });
    expect(report.errors.length).toBeGreaterThan(0);
    /* Exercised directly, since MOD_REQUIREMENTS is readonly by design. */
    let problem: string | null;
    try {
      problem = exploding.check();
    } catch (e) {
      problem = `the check itself failed: ${(e as Error).message}`;
    }
    expect(problem).toMatch(/the check itself failed/u);
  });

  /**
   * One mod per rule that MUST make that rule fire.
   *
   * A table rather than a text scan of this file. A scan proves an id was mentioned;
   * this proves the rule can actually fail, and fails loudly if a rule is added
   * without a case - which is the only way a checker quietly stops checking.
   */
  const BREAKS: Record<string, ModUnderTest> = {
    "manifest-present": goodMod({ files: ["content/x.json"], manifestText: null }),
    "manifest-json": goodMod({ manifestText: "{oops" }),
    "manifest-fields": goodMod({}, { ...GOOD_MANIFEST, id: "Not Kebab" }),
    "plugin-declares-modapi": goodMod({ files: ["manifest.json", "plugin.js"] }, {
      ...GOOD_MANIFEST,
      shape: "plugin",
    }),
    "plugin-declares-facet": goodMod({ files: ["manifest.json", "plugin.js"] }, {
      ...GOOD_MANIFEST,
      modApi: 1,
    }),
    "archives-declared": goodMod({ repoFiles: ["manifest.json", "pack.zip"] }),
    "declare-a-repository": goodMod({}, { ...GOOD_MANIFEST, repository: undefined }),
    "credit-an-author": goodMod({}, { ...GOOD_MANIFEST, author: undefined }),
    "engine-range": goodMod({}, { ...GOOD_MANIFEST, engine: ">=nonsense" }),
    "updates-can-be-offered": goodMod({}, {
      ...GOOD_MANIFEST,
      repository: "https://gitlab.com/someone/their-mod",
    }),
    "version-orderable": goodMod({}, { ...GOOD_MANIFEST, version: "2026.07" }),
    "describe-itself": goodMod({}, { ...GOOD_MANIFEST, description: "Short." }),
    "state-a-licence": goodMod({}, { ...GOOD_MANIFEST, license: undefined }),
  };

  it("has a case that actually MAKES each rule fire", () => {
    for (const rule of MOD_REQUIREMENTS) {
      const mod = BREAKS[rule.id];
      expect(mod, `no failing case for "${rule.id}"`).toBeDefined();
      if (!mod) continue;
      expect(failed(mod), `"${rule.id}" did not fire`).toContain(rule.id);
    }
  });

  it("has no case for a rule that no longer exists", () => {
    /* The other direction: a deleted rule leaves a fixture that proves nothing, and
     * a stale entry here would read as coverage. */
    const ids = new Set(MOD_REQUIREMENTS.map((r) => r.id));
    expect(Object.keys(BREAKS).filter((id) => !ids.has(id))).toEqual([]);
  });
});

describe("the generated document", () => {
  const FILE = join(import.meta.dirname, "..", "..", "..", "docs", "modding", "REQUIREMENTS.md");

  it("matches what the rules say, so prose cannot fall behind behaviour", () => {
    /* This is what makes "the docs cannot drift" a fact rather than an intention. If
     * a rule's wording changes, this fails until the file is regenerated with
     *   node packages/mod-sdk/bin/neo-angband-mod-check.mjs --write-docs */
    expect(readFileSync(FILE, "utf8").trimEnd()).toBe(requirementsMarkdown().trimEnd());
  });

  it("mentions every rule by its id, so an error message can be looked up", () => {
    const text = readFileSync(FILE, "utf8");
    for (const r of MOD_REQUIREMENTS) expect(text, r.id).toContain(r.id);
  });
});
