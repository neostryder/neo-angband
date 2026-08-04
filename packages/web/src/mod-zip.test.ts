/**
 * What an archive has to be before it can become a mod.
 *
 * Every refusal below has a fixture that MAKES IT FIRE. A validator is the easiest
 * thing in a codebase to write and never exercise - it is a list of `return` statements
 * that all look reasonable - so the only evidence that a rule is a rule is an archive
 * that trips it.
 */

import { describe, expect, it } from "vitest";
import { zipSync } from "fflate";

import { ZIP_LIMITS, readModZip } from "./mod-zip";

const enc = new TextEncoder();

/** A manifest the SDK would accept, so a refusal is never about the manifest. */
function manifest(id = "demo"): Uint8Array {
  return enc.encode(
    JSON.stringify({
      id,
      name: "Demo",
      version: "1.0.0",
      description: "A mod that exists to be imported.",
      licence: "MIT",
      engine: ">=0.17.0",
    }),
  );
}

function zip(entries: Record<string, Uint8Array>): Uint8Array {
  return zipSync(entries, { level: 0 });
}

/** The one thing zipSync cannot build: an archive that lists a name twice. */
function duplicateNameZip(): Uint8Array {
  /* Two entries whose names are the same LENGTH, then the distinguishing byte is
   * patched to make them identical. The name is stored in the local header and again
   * in the central directory, so a blind replace over the whole buffer hits both and
   * produces the archive a real reader and a real verifier would disagree about. */
  const bytes = zip({ "manifest.json": manifest(), "manifestXjson": enc.encode("{}") });
  const from = enc.encode("manifestXjson");
  const to = enc.encode("manifest.json");
  for (let i = 0; i + from.length <= bytes.length; i++) {
    let hit = true;
    for (let j = 0; j < from.length; j++) {
      if (bytes[i + j] !== from[j]) {
        hit = false;
        break;
      }
    }
    if (hit) bytes.set(to, i);
  }
  return bytes;
}

function ok(read: ReturnType<typeof readModZip>): Extract<typeof read, { ok: true }> {
  if (!read.ok) throw new Error(`expected an importable mod, got: ${read.problem}`);
  return read;
}

function problem(read: ReturnType<typeof readModZip>): string {
  if (read.ok) throw new Error("expected a refusal, got an importable mod");
  return read.problem;
}

describe("the two shapes a mod is distributed as", () => {
  it("takes an archive that IS the mod folder (depth 0)", () => {
    const read = ok(readModZip(zip({ "manifest.json": manifest(), "plugin.js": enc.encode("x") })));
    expect(read.id).toBe("demo");
    expect(read.root).toBe("");
    expect(read.files.map(([p]) => p).sort()).toEqual(["manifest.json", "plugin.js"]);
  });

  it("takes an archive OF the mod folder (depth 1), which is what Download ZIP makes", () => {
    const read = ok(
      readModZip(
        zip({ "neo-angband-mod-qol-1.0.0/manifest.json": manifest("qol"), "neo-angband-mod-qol-1.0.0/plugin.js": enc.encode("x") }),
      ),
    );
    expect(read.id).toBe("qol");
    expect(read.root).toBe("neo-angband-mod-qol-1.0.0/");
    /* The wrapper is STRIPPED. If it were not, every path would be one level deeper
     * than the mod says it is and readModDir would see a folder with no manifest. */
    expect(read.files.map(([p]) => p).sort()).toEqual(["manifest.json", "plugin.js"]);
  });

  it("refuses a manifest at depth 2, rather than going looking", () => {
    expect(problem(readModZip(zip({ "a/b/manifest.json": manifest() })))).toMatch(/nowhere deeper/u);
  });

  it("refuses an archive with no manifest anywhere", () => {
    expect(problem(readModZip(zip({ "readme.txt": enc.encode("hi") })))).toMatch(
      /no manifest\.json in this archive/u,
    );
  });

  it("refuses two mods in one file, and names both", () => {
    const p = problem(
      readModZip(zip({ "one/manifest.json": manifest("one"), "two/manifest.json": manifest("two") })),
    );
    expect(p).toMatch(/more than one mod/u);
    expect(p).toContain("one");
    expect(p).toContain("two");
  });

  it("prefers a manifest at the root over one nested inside it", () => {
    const read = ok(
      readModZip(
        zip({ "manifest.json": manifest("outer"), "examples/manifest.json": manifest("inner") }),
      ),
    );
    expect(read.id).toBe("outer");
    expect(read.root).toBe("");
    /* The nested one is still a FILE of the mod - it is kept, not dropped. Only the
     * question "which folder is the mod" was answered. */
    expect(read.files.map(([p]) => p)).toContain("examples/manifest.json");
  });

  it("refuses a stray file beside the mod folder instead of quietly dropping it", () => {
    const p = problem(
      readModZip(zip({ "mod/manifest.json": manifest(), "README.md": enc.encode("hi") })),
    );
    expect(p).toContain("README.md");
    expect(p).toMatch(/on its own/u);
  });

  it("insists on the lower-case spelling rather than installing a folder readModDir will reject", () => {
    expect(problem(readModZip(zip({ "Manifest.JSON": manifest() })))).toMatch(/must be spelled/u);
  });
});

describe("packaging noise is dropped, because the player did not put it there", () => {
  it("ignores __MACOSX and does not mistake it for the mod folder", () => {
    const read = ok(
      readModZip(
        zip({
          "mod/manifest.json": manifest(),
          "__MACOSX/mod/._manifest.json": enc.encode("junk"),
          "__MACOSX/._mod": enc.encode("junk"),
        }),
      ),
    );
    expect(read.root).toBe("mod/");
    expect(read.files.map(([p]) => p)).toEqual(["manifest.json"]);
    expect(read.ignored.length).toBe(2);
  });

  it("ignores .DS_Store, Thumbs.db and desktop.ini wherever they turn up", () => {
    const read = ok(
      readModZip(
        zip({
          "manifest.json": manifest(),
          ".DS_Store": enc.encode("junk"),
          "tiles/Thumbs.db": enc.encode("junk"),
          "tiles/desktop.ini": enc.encode("junk"),
          "tiles/orc.png": enc.encode("png"),
        }),
      ),
    );
    expect(read.files.map(([p]) => p).sort()).toEqual(["manifest.json", "tiles/orc.png"]);
    expect(read.ignored).toEqual([".DS_Store", "tiles/Thumbs.db", "tiles/desktop.ini"].sort());
  });

  it("says what it ignored, so nothing disappears without a word", () => {
    const read = ok(readModZip(zip({ "manifest.json": manifest(), ".DS_Store": enc.encode("j") })));
    expect(read.ignored).toEqual([".DS_Store"]);
  });
});

describe("entry names that are legal to write and behave as a different name", () => {
  const cases: ReadonlyArray<readonly [string, string, RegExp]> = [
    ["escapes the folder", "../../evil.json", /escapes the mod folder/u],
    ["is absolute", "/etc/passwd", /absolute path/u],
    ["names a drive", "C:/windows/evil", /absolute path/u],
    ["uses a backslash", "sub\\evil.json", /backslash/u],
    ["is a Windows device", "aux.json", /reserves for a device/u],
    ["is a Windows device, bare", "COM1", /reserves for a device/u],
    ["ends with a dot", "plugin.js.", /dot or a space/u],
    ["ends with a space", "plugin.js ", /dot or a space/u],
    ["hides a control character", "plug\u0007in.js", /control character/u],
    ["hides a zero-width space", "plug\u200bin.js", /invisible character/u],
    ["hides a right-to-left override", "gpj.s\u202ej.js", /invisible character/u],
  ];
  for (const [what, path, expected] of cases) {
    it(`refuses a path that ${what}`, () => {
      const p = problem(readModZip(zip({ "manifest.json": manifest(), [path]: enc.encode("x") })));
      expect(p, `path ${JSON.stringify(path)}`).toMatch(expected);
    });
  }

  it("refuses two names that differ only in case", () => {
    const p = problem(
      readModZip(
        zip({ "manifest.json": manifest(), "Data/x.json": enc.encode("1"), "data/X.json": enc.encode("2") }),
      ),
    );
    expect(p).toMatch(/same file on Windows/u);
  });

  it("refuses a path too long to survive becoming a key", () => {
    const long = `${"a".repeat(250)}.json`;
    expect(problem(readModZip(zip({ "manifest.json": manifest(), [long]: enc.encode("x") })))).toMatch(
      /too long/u,
    );
  });
});

describe("an archive that lists one name twice", () => {
  it("is refused, because a reader and a verifier would disagree about what is in it", () => {
    /* THE FIXTURE MUST BE A REAL DUPLICATE. If the patch below ever stops producing
     * one, this test would pass for the wrong reason - so it asserts on the message
     * rather than merely on failure. */
    expect(problem(readModZip(duplicateNameZip()))).toMatch(/appears twice/u);
  });
});

describe("an archive that promises more than it should", () => {
  it("refuses more entries than the limit, before unpacking them", () => {
    const entries: Record<string, Uint8Array> = { "manifest.json": manifest() };
    for (let i = 0; i < ZIP_LIMITS.maxEntries + 1; i++) entries[`f${i}.json`] = enc.encode("{}");
    expect(problem(readModZip(zip(entries)))).toMatch(/more than 4096 entries/u);
  });

  it("refuses one oversized file on the size its own header declares", () => {
    /* Stored uncompressed, so the header is honest and the refusal happens on the
     * header - which is the only point at which refusing costs nothing. */
    const big = new Uint8Array(2048);
    const read = readModZip(zip({ "manifest.json": manifest(), "big.bin": big }), {
      ...ZIP_LIMITS,
      maxFileBytes: 1024,
    });
    expect(problem(read)).toMatch(/over the 1 KB limit for one file/u);
  });

  it("refuses an archive whose files add up to more than the total", () => {
    const read = readModZip(
      zip({ "manifest.json": manifest(), a: new Uint8Array(600), b: new Uint8Array(600) }),
      { ...ZIP_LIMITS, maxTotalBytes: 1000 },
    );
    expect(problem(read)).toMatch(/unpacks to more than/u);
  });
});

describe("the shape of a bomb, not only its size", () => {
  it("refuses an entry that claims to unpack far larger than it is", () => {
    /* One repeated byte compresses about 1000:1, which is nothing a mod file does and
     * everything a bomb does. Level 9 so the fixture actually achieves the ratio - a
     * stored fixture would prove nothing about a rule expressed as a ratio. */
    const bomb = zipSync({ "manifest.json": manifest(), "b.bin": new Uint8Array(200_000) }, { level: 9 });
    expect(problem(readModZip(bomb))).toMatch(/which no mod file does/u);
  });

  it("refuses a file bigger than the ceiling on the whole archive, before opening it", () => {
    const read = readModZip(zip({ "manifest.json": manifest() }), {
      ...ZIP_LIMITS,
      maxArchiveBytes: 8,
    });
    expect(problem(read)).toMatch(/over the .* limit for a mod/u);
  });

  it("refuses a name that is a file here and a folder there", () => {
    const p = problem(
      readModZip(zip({ "manifest.json": manifest(), docs: enc.encode("x"), "docs/read.md": enc.encode("y") })),
    );
    expect(p).toMatch(/one is a folder and the other is a file/u);
  });
});

describe("the things that are not archives at all", () => {
  it("refuses bytes that are not a zip", () => {
    expect(problem(readModZip(enc.encode("this is a text file")))).toMatch(/not a readable zip/u);
  });

  it("refuses an archive with nothing in it", () => {
    expect(problem(readModZip(zip({})))).toMatch(/no files in it/u);
  });

  it("refuses an archive of nothing but noise", () => {
    expect(problem(readModZip(zip({ ".DS_Store": enc.encode("j") })))).toMatch(/no files in it/u);
  });
});

describe("the manifest has to name the mod", () => {
  it("refuses a manifest that is not JSON", () => {
    expect(problem(readModZip(zip({ "manifest.json": enc.encode("not json") })))).toMatch(
      /does not name a mod id/u,
    );
  });

  it("refuses a manifest with no id", () => {
    expect(
      problem(readModZip(zip({ "manifest.json": enc.encode(JSON.stringify({ name: "x" })) }))),
    ).toMatch(/does not name a mod id/u);
  });

  it("takes the id from the manifest, not from the folder it was zipped in", () => {
    /* The folder name in a Download ZIP is `<repo>-<tag>`, which is never the mod id.
     * Reading the id from the folder would install every GitHub archive under a name
     * that changes with the version. */
    const read = ok(readModZip(zip({ "some-repo-v1.2.3/manifest.json": manifest("bug-fixes") })));
    expect(read.id).toBe("bug-fixes");
  });
});
