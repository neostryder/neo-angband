/**
 * The resource seam against REAL FILES on disk - the bundled demo mod's, and a
 * font and a sound pack written into a temp folder.
 *
 * mod-resources.test.ts injects everything, which is right for asserting the
 * decisions: an injected runtime is the only way to make a browser claim it
 * cannot play Vorbis. But an injected runtime cannot show that the mechanism is
 * connected to anything. Every path here starts from bytes somebody could have
 * put in a mods folder: the manifest is parsed by the real validator, the pref
 * file is parsed by the real ui-prefs.c grammar against the real registries, and
 * the art and the help page are read as text and handed to the real consumers.
 *
 * WHY A TEMP FOLDER FOR TWO OF THE SIX. The demo mod ships art, a help page, a
 * pref file and a translation, which are a few kilobytes between them. A
 * complete bitmap font is tens of
 * kilobytes and a sound pack is audio, and the demo manifests are inlined into
 * every build by a static glob - so keeping either in the tree would put real
 * weight into the shipped bundle for a mod that dev builds alone can see. They
 * are written here instead, from bytes this test owns, and read back through
 * exactly the same path.
 *
 * WHAT THIS DOES NOT PROVE: that a player's mods folder reaches this code at
 * boot. That is main.ts's applyModResources, and it is a separate claim.
 */

import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  localeFileComplaint,
  localeFileTag,
  validateManifest,
} from "@rpgm-tools/neo-angband-mod-sdk";
import type { PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import {
  bindCore,
  FEAT,
  GlyphTable,
  glyphTableSink,
  LIGHTING,
  processPrefText,
  registerLocale,
  resetLocales,
  setLocale,
  t,
} from "@rpgm-tools/neo-angband-core";
import type { LocaleBundle } from "@rpgm-tools/neo-angband-core";
import { loadGamePack } from "./pack";
import {
  bitmapFontComplaint,
  inventoryOf,
  locateResources,
  verifyResources,
  type ResourceRuntime,
} from "./mod-resources";
import type { ModAssetSource } from "./tile-mods";
import { setSplashArt, titleLines } from "./news";
import { helpIndexLabels, helpLinesFromText, setModHelpPages } from "./help";
import { FONT_16X24 } from "./font-16x24";

const MODS_DIR = fileURLToPath(new URL("../mods", import.meta.url));
const DEMO = "demo-resources";

/**
 * The transport, and the only thing mocked: a URL here is an absolute path on
 * this machine, and reading one is reading the file. The browser's version
 * fetches; the desktop shell's goes over its loopback server. All three answer
 * the same question, which is why ResourceRuntime is one interface.
 */
function diskRuntime(): ResourceRuntime {
  return {
    readText: (path) => {
      try {
        return Promise.resolve(readFileSync(path, "utf8"));
      } catch {
        return Promise.resolve(null);
      }
    },
    canPlayAudio: (mime) => mime === "audio/mpeg" || mime === "audio/ogg",
  };
}

/** A source whose "URL" is a filesystem path under `root`. */
function dirSource(root: string): ModAssetSource {
  return {
    kind: "dir",
    assetUrl: (modId: string, rel: string) => Promise.resolve(join(root, modId, rel)),
  };
}

function inputFor(root: string, ids: readonly string[], manifests: Map<string, unknown>) {
  return {
    manifests,
    sources: new Map(ids.map((id) => [id, dirSource(root)])),
    enabledIds: ids,
  };
}

const temps: string[] = [];
function tempMod(id: string, manifest: object, files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "neo-res-"));
  temps.push(root);
  mkdirSync(join(root, id), { recursive: true });
  writeFileSync(join(root, id, "manifest.json"), JSON.stringify(manifest, null, 2));
  for (const [rel, body] of Object.entries(files)) {
    const full = join(root, id, rel);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, body);
  }
  return root;
}

afterAll(() => {
  for (const root of temps) rmSync(root, { recursive: true, force: true });
});

beforeEach(() => {
  setSplashArt(null);
  setModHelpPages([]);
  /* Back to English before every case: a locale is latched at module scope, so
   * one test switching language would otherwise decide what the next one reads. */
  resetLocales();
});

describe("the bundled demo mod, read from the tree", () => {
  const raw: unknown = JSON.parse(
    readFileSync(join(MODS_DIR, DEMO, "manifest.json"), "utf8"),
  );

  it("has a manifest the REAL validator accepts", () => {
    const m: PackManifest = validateManifest(raw);
    expect(m.id).toBe(DEMO);
    expect(m.resources?.map((r) => r.kind).sort()).toEqual([
      "art",
      "help",
      "locale",
      "prefs",
    ]);
  });

  it("locates all four, and every file it declares is really there", async () => {
    const manifests = new Map<string, unknown>([[DEMO, raw]]);
    const { located, problems } = locateResources(inputFor(MODS_DIR, [DEMO], manifests));
    expect(problems).toEqual([]);
    expect(located).toHaveLength(4);

    /* The INVENTORY check, against the folder's real contents - this is the one
     * that catches a typo in a manifest, and it is worth running against the
     * files rather than a fixture, because a fixture of a filename cannot
     * disagree with the filename. */
    const declared = (validateManifest(raw).resources ?? []).map((r) => r.path);
    const inventory = inventoryOf({
      packs: [{ manifest: { id: DEMO }, files: {}, code: [], assets: declared }],
      order: [],
      problems: [],
      dir: MODS_DIR,
      available: true,
      kind: "app",
      codeUrl: null,
      assetUrl: null,
    } as never);
    const { usable, refused } = await verifyResources(located, diskRuntime(), inventory);
    expect(refused).toEqual([]);
    expect(usable).toHaveLength(4);
    /* And the files are on disk, which is what makes the line above a
     * measurement rather than a restatement of the manifest. */
    for (const path of declared) {
      expect(readFileSync(join(MODS_DIR, DEMO, path), "utf8").length).toBeGreaterThan(0);
    }
  });

  it("paints its splash, and the credits survive it", async () => {
    const text = readFileSync(join(MODS_DIR, DEMO, "art/splash.txt"), "utf8");
    setSplashArt(text.split("\n").map((l) => l.replace(/\r$/u, "")));
    const markup = titleLines().map((l) => l.markup);
    expect(markup.some((m) => m.includes("R E S O U R C E"))).toBe(true);
    expect(markup.some((m) => m.includes("Angband"))).toBe(true);
    expect(markup.some((m) => m.includes("neostryder"))).toBe(true);
    /* $VERSION is substituted for a mod's art exactly as it is for news.txt,
     * so a conversion can put the build number on its own screen. */
    expect(markup.some((m) => m.includes("$VERSION"))).toBe(false);
  });

  it("has a pref file the REAL ui-prefs.c grammar parses with no errors", () => {
    /* THE CHECK THAT EARNS ITS KEEP HERE. The first draft of this file used
     * `feat:open floor:torch:w:.` - a feature NAME where the grammar wants its
     * CODE, and colour letters where it wants numbers - and every line of it
     * would have failed silently on a player's machine. A .prf is the one
     * resource whose contents this project owns a parser for, so there is no
     * excuse for shipping one nothing has parsed.
     *
     * The real registries, from the real content pack, because `FLOOR` has to
     * resolve to a feature index and a stub would resolve anything. */
    const text = readFileSync(join(MODS_DIR, DEMO, "prefs/demo.prf"), "utf8");
    const reg = bindCore(loadGamePack());
    const table = new GlyphTable({
      features: reg.features.allFeatures(),
      kinds: reg.objects.kinds,
      races: reg.monsters.races,
      traps: reg.traps,
      flavors: reg.objects.flavors,
    });
    const errors = processPrefText(
      text,
      {
        features: reg.features,
        objects: reg.objects,
        monsters: reg.monsters,
        traps: reg.traps,
      },
      glyphTableSink(table),
    );
    expect(errors).toEqual([]);
    /* And it DID something: open floor is white (COLOUR_WHITE is 1, '.' is 46)
     * in every lighting variant the `*` covers. An empty error list is not a
     * measurement on its own - a file of nothing but comments would pass it. */
    const fidx = FEAT["FLOOR"] as number;
    for (let lighting = 0; lighting < LIGHTING.MAX; lighting++) {
      expect(table.featGlyph(lighting, fidx)).toEqual({ attr: 1, char: "." });
    }
  });

  it("has a TRANSLATION the game reads, and reading it changes the screen", () => {
    /* The end of the gap-14 chain, from bytes on disk: the file validates,
     * declares the tag its slot claims, registers, and the help index - real UI
     * text, routed through `t` - comes back in the other language.
     *
     * A PSEUDO-LOCALE rather than a real translation, on purpose. Every string
     * is readable English with the letters accented and the whole thing
     * bracketed, so the assertions below stay legible AND the file does the job
     * a pseudo-locale exists for: anything still in plain ASCII on a screen is a
     * string the code forgot to route through the translator. */
    const raw: unknown = JSON.parse(
      readFileSync(join(MODS_DIR, DEMO, "locales/en-XA.json"), "utf8"),
    );
    expect(localeFileComplaint(raw, "locales/en-XA.json")).toBeNull();
    expect(localeFileTag(raw)).toBe("en-XA");

    const before = helpIndexLabels();
    expect(before).toContain("Available commands");
    registerLocale(raw as LocaleBundle);
    setLocale("en-XA");
    const after = helpIndexLabels();
    expect(after).not.toContain("Available commands");
    expect(after.some((l) => l.includes("Ãvãilãblę"))).toBe(true);

    /* An id the catalogue does NOT translate still shows English, which is what
     * makes a half-finished translation usable rather than a screen of holes.
     * `demo-resources`' own help page label is supplied by the mod, not by the
     * catalogue, so it is the natural untranslated case. */
    expect(t("help.absent", "Nothing translated this")).toBe("Nothing translated this");

    /* And the plural entry resolves through Intl rather than through a
     * hard-coded `n === 1`. */
    expect(t("demo.plural", "{n, plural, other {# scrolls}}", { n: 0 })).toContain("ñø");
    expect(t("demo.plural", "{n, plural, other {# scrolls}}", { n: 1 })).toContain("1");
  });

  it("adds its help page to the index", () => {
    const text = readFileSync(join(MODS_DIR, DEMO, "help/resources.txt"), "utf8");
    const before = helpIndexLabels().length;
    setModHelpPages([
      {
        slot: "demo-resources",
        label: "About the resource demo",
        lines: helpLinesFromText(text),
      },
    ]);
    expect(helpIndexLabels()).toHaveLength(before + 1);
    expect(helpIndexLabels()).toContain("About the resource demo");
  });
});

describe("a font and a sound pack, written to disk and read back", () => {
  it("accepts a real bitmap font from a real file", async () => {
    const root = tempMod(
      "font-mod",
      {
        id: "font-mod",
        name: "Font Mod",
        version: "1.0.0",
        shape: "content",
        resources: [{ kind: "font", path: "fonts/terminal.json" }],
      },
      { "fonts/terminal.json": JSON.stringify(FONT_16X24) },
    );
    const manifests = new Map<string, unknown>([
      ["font-mod", JSON.parse(readFileSync(join(root, "font-mod", "manifest.json"), "utf8"))],
    ]);
    const { located } = locateResources(inputFor(root, ["font-mod"], manifests));
    const { usable, refused } = await verifyResources(
      located,
      diskRuntime(),
      new Map(),
    );
    expect(refused).toEqual([]);
    expect(usable).toHaveLength(1);
  });

  it("refuses a font file whose JSON is not a font, from disk, with a reason", async () => {
    const root = tempMod(
      "bad-font-mod",
      {
        id: "bad-font-mod",
        name: "Bad Font Mod",
        version: "1.0.0",
        shape: "content",
        resources: [{ kind: "font", path: "fonts/terminal.json" }],
      },
      { "fonts/terminal.json": '{"w": 16, "h": 24, "glyphs": [[1, 2, 3]]}' },
    );
    const manifests = new Map<string, unknown>([
      [
        "bad-font-mod",
        JSON.parse(readFileSync(join(root, "bad-font-mod", "manifest.json"), "utf8")),
      ],
    ]);
    const { located } = locateResources(inputFor(root, ["bad-font-mod"], manifests));
    const { usable, refused } = await verifyResources(located, diskRuntime(), new Map());
    expect(usable).toEqual([]);
    expect(refused[0]?.id).toBe("bad-font-mod");
    expect(refused[0]?.why).toContain("scanlines");
    /* Core's own font passes the identical check, so the refusal above is the
     * check working rather than the check refusing everything. */
    expect(bitmapFontComplaint(FONT_16X24)).toBeNull();
  });

  it("accepts a sound directory that really holds playable samples", async () => {
    const root = tempMod(
      "sound-mod",
      {
        id: "sound-mod",
        name: "Sound Mod",
        version: "1.0.0",
        shape: "content",
        resources: [{ kind: "sound", path: "sounds" }],
      },
      { "sounds/hit.mp3": "not really audio, but really a file with that name" },
    );
    const manifests = new Map<string, unknown>([
      ["sound-mod", JSON.parse(readFileSync(join(root, "sound-mod", "manifest.json"), "utf8"))],
    ]);
    const { located } = locateResources(inputFor(root, ["sound-mod"], manifests));
    const inventory = inventoryOf({
      packs: [
        { manifest: { id: "sound-mod" }, files: {}, code: [], assets: ["sounds/hit.mp3"] },
      ],
      order: [],
      problems: [],
      dir: root,
      available: true,
      kind: "app",
      codeUrl: null,
      assetUrl: null,
    } as never);
    expect((await verifyResources(located, diskRuntime(), inventory)).refused).toEqual([]);

    /* The control, on the same mod: a directory with no playable file in it has
     * to be refused, or the pass above is measuring the manifest and not the
     * folder. */
    const empty = inventoryOf({
      packs: [{ manifest: { id: "sound-mod" }, files: {}, code: [], assets: ["sounds/readme.md"] }],
      order: [],
      problems: [],
      dir: root,
      available: true,
      kind: "app",
      codeUrl: null,
      assetUrl: null,
    } as never);
    const { refused } = await verifyResources(located, diskRuntime(), empty);
    expect(refused[0]?.why).toContain("no .mp3");
  });
});
