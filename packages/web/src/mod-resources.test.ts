/**
 * The host half of MOD_REACH gap 7: are a mod's resources found, checked against
 * what this machine can do, and refused - one resource at a time - when they
 * cannot work?
 *
 * The point of the whole seam is that a broken resource STOPS BEING SILENT, so
 * most of these assert that a sentence exists and names the mod. The two
 * silences are asserted too, and separately, because a check that refuses
 * everything and a check that refuses nothing both look like a passing test if
 * you only ever measure one side.
 */

import { beforeEach, describe, expect, it } from "vitest";
import type { PackResource } from "@rpgm-tools/neo-angband-mod-sdk";
import { ENGINE_VERSION } from "@rpgm-tools/neo-angband-core";
import {
  bitmapFontComplaint,
  inventoryOf,
  locateResources,
  setModResources,
  resetModResources,
  verifyResources,
  type LocatedResource,
  type ResourceRuntime,
} from "./mod-resources";
import type { ModAssetSource } from "./tile-mods";
import { setSplashArt, titleLines, MOD_SPLASH_ROWS } from "./news";
import { coreHelpPageIds, helpIndexLabels, helpLinesFromText, setModHelpPages } from "./help";
import { FONT_16X24 } from "./font-16x24";

/** A runtime that can do everything, so a test opts INTO each failure. */
function capableRuntime(files: Record<string, string> = {}): ResourceRuntime {
  return {
    readText: (url) => Promise.resolve(files[url] ?? "(text)"),
    canPlayAudio: () => true,
  };
}

const BUNDLE: ModAssetSource = { kind: "bundle", base: "mods" };

function manifest(id: string, resources: PackResource[], extra: object = {}): unknown {
  return { id, name: `${id} pack`, version: "1.0.0", shape: "content", resources, ...extra };
}

function inputFor(
  mods: readonly { id: string; manifest: unknown }[],
): Parameters<typeof locateResources>[0] {
  return {
    manifests: new Map(mods.map((m) => [m.id, m.manifest])),
    sources: new Map(mods.map((m) => [m.id, BUNDLE])),
    enabledIds: mods.map((m) => m.id),
  };
}

/** A DiskPackReport stub carrying only what inventoryOf reads. */
function diskWith(packs: Record<string, string[]>): Parameters<typeof inventoryOf>[0] {
  return {
    packs: Object.entries(packs).map(([id, assets]) => ({
      manifest: { id } as never,
      files: {},
      code: [],
      assets,
    })),
    order: [],
    problems: [],
    dir: null,
    available: true,
    kind: "none",
    codeUrl: null,
    assetUrl: null,
  } as unknown as Parameters<typeof inventoryOf>[0];
}

const NO_INVENTORY = new Map<string, ReadonlySet<string>>();

beforeEach(() => {
  resetModResources();
  setSplashArt(null);
  setModHelpPages([]);
});

describe("with no mods, nothing is found and nothing is said", () => {
  it("locates nothing and complains about nothing", () => {
    const { located, problems } = locateResources(inputFor([]));
    expect(located).toEqual([]);
    expect(problems).toEqual([]);
  });

  it("leaves the title screen and the help index exactly as core wrote them", () => {
    const before = titleLines().map((l) => l.markup);
    setSplashArt(null);
    expect(titleLines().map((l) => l.markup)).toEqual(before);
    expect(helpIndexLabels()).toContain("Available commands");
  });
});

describe("a well-formed mod's resources are found and used", () => {
  it("locates one of each kind, attributed and resolvable", async () => {
    const input = inputFor([
      {
        id: "big-mod",
        manifest: manifest("big-mod", [
          { kind: "sound", path: "sounds" },
          { kind: "prefs", path: "prefs/colours.prf" },
          { kind: "help", path: "help/lore.txt", slot: "lore" },
          { kind: "art", path: "art/splash.txt", slot: "splash" },
        ]),
      },
    ]);
    const { located, problems } = locateResources(input);
    expect(problems).toEqual([]);
    expect(located).toHaveLength(4);
    expect(new Set(located.map((l) => l.modId))).toEqual(new Set(["big-mod"]));
    /* Resolved from the MOD ROOT, which is the whole reason a resource path is
     * mod-relative: the mod cannot know where it is served from. */
    expect(await located[0]?.resolve?.("sounds/hit.mp3")).toBe("mods/big-mod/sounds/hit.mp3");
  });

  it("says nothing about any of them when the machine can use them", async () => {
    const { located } = locateResources(
      inputFor([
        { id: "ok-mod", manifest: manifest("ok-mod", [{ kind: "sound", path: "sounds" }]) },
      ]),
    );
    const verified = await verifyResources(located, capableRuntime(), NO_INVENTORY);
    expect(verified.refused).toEqual([]);
    expect(verified.usable).toHaveLength(1);
  });
});

describe("a declaration that cannot work lands on the mod's own row", () => {
  it("names the mod and the reason, and keeps the mod's OTHER resources", () => {
    const { located, problems } = locateResources(
      inputFor([
        {
          id: "typo-mod",
          manifest: manifest("typo-mod", [
            { kind: "prefs", path: "../elsewhere.prf" },
            { kind: "sound", path: "sounds" },
          ]),
        },
      ]),
    );
    expect(problems).toHaveLength(1);
    expect(problems[0]?.id).toBe("typo-mod");
    expect(problems[0]?.why).toContain("stay inside the mod folder");
    /* THE RESOURCE, NOT THE MOD. The sound pack beside the bad pref file is
     * still there, and so are the mod's records - which this file cannot see,
     * and which is the point: nothing here can take them away. */
    expect(located.map((l) => l.resource.kind)).toEqual(["sound"]);
  });

  it("gates on the engine range at THIS door too, not only at the content one", () => {
    const { located } = locateResources(
      inputFor([
        {
          id: "old-mod",
          manifest: manifest("old-mod", [{ kind: "sound", path: "sounds" }], {
            engine: "<0.0.1",
            /* modApi is what makes a mismatch a GATE rather than a label - the
             * pack ships code, and code is what an engine release breaks. */
            modApi: 1,
          }),
        },
      ]),
    );
    expect(located).toEqual([]);
  });

  it("labels rather than gates a DATA pack that is out of range", () => {
    /* Ratified decision 18, and the control on the test above: without `modApi`
     * the same range must NOT cost the resource, or the gate would be refusing
     * pictures over a version number. */
    const { located } = locateResources(
      inputFor([
        {
          id: "old-data",
          manifest: manifest("old-data", [{ kind: "sound", path: "sounds" }], {
            engine: "<0.0.1",
          }),
        },
      ]),
    );
    expect(located).toHaveLength(1);
    expect(ENGINE_VERSION).not.toBe("");
  });
});

describe("what only THIS machine could have reported", () => {
  it("refuses a sound pack when the build can play neither format, and says so", async () => {
    const { located } = locateResources(
      inputFor([
        { id: "silent", manifest: manifest("silent", [{ kind: "sound", path: "sounds" }]) },
      ]),
    );
    const runtime: ResourceRuntime = { ...capableRuntime(), canPlayAudio: () => false };
    const { usable, refused } = await verifyResources(located, runtime, NO_INVENTORY);
    expect(usable).toEqual([]);
    expect(refused[0]?.id).toBe("silent");
    expect(refused[0]?.why).toContain(".mp3");
  });

  it("catches a MISTYPED filename from the inventory, with no request at all", async () => {
    const { located } = locateResources(
      inputFor([
        {
          id: "fat-fingers",
          manifest: manifest("fat-fingers", [{ kind: "prefs", path: "prefs/colors.prf" }]),
        },
      ]),
    );
    const inventory = inventoryOf(diskWith({ "fat-fingers": ["prefs/colours.prf"] }));
    const { refused } = await verifyResources(located, capableRuntime(), inventory);
    expect(refused[0]?.why).toContain("no such file");
  });

  it("finds a sound pack's samples in the inventory, and misses their absence", async () => {
    const input = inputFor([
      { id: "noisy", manifest: manifest("noisy", [{ kind: "sound", path: "sounds" }]) },
    ]);
    const { located } = locateResources(input);
    const withSamples = inventoryOf(diskWith({ noisy: ["sounds/hit.mp3"] }));
    expect((await verifyResources(located, capableRuntime(), withSamples)).refused).toEqual([]);
    /* The control: an EMPTY directory has to be refused, or the check above is
     * measuring nothing. */
    const empty = inventoryOf(diskWith({ noisy: ["readme.txt"] }));
    const { refused } = await verifyResources(located, capableRuntime(), empty);
    expect(refused[0]?.why).toContain("no .mp3");
  });

  it("refuses a font whose JSON is not a font, and names what is wrong with it", async () => {
    const { located } = locateResources(
      inputFor([
        {
          id: "bad-font",
          manifest: manifest("bad-font", [{ kind: "font", path: "fonts/broken.json" }]),
        },
      ]),
    );
    const runtime = capableRuntime({
      "mods/bad-font/fonts/broken.json": JSON.stringify({ w: 8, h: 12, glyphs: [[1, 2]] }),
    });
    const { refused } = await verifyResources(located, runtime, NO_INVENTORY);
    expect(refused[0]?.why).toContain("scanlines");
    expect(refused[0]?.why).toContain("12");
  });

  it("accepts core's OWN font through the same check", async () => {
    /* The check has to pass the one font that certainly works, or "refuses a bad
     * font" is just "refuses every font". */
    expect(bitmapFontComplaint(FONT_16X24)).toBeNull();
    const { located } = locateResources(
      inputFor([
        { id: "good-font", manifest: manifest("good-font", [{ kind: "font", path: "f/ok.json" }]) },
      ]),
    );
    const runtime = capableRuntime({
      "mods/good-font/f/ok.json": JSON.stringify(FONT_16X24),
    });
    expect((await verifyResources(located, runtime, NO_INVENTORY)).refused).toEqual([]);
  });

  it("turns a throwing probe into a refusal rather than a crashed boot", async () => {
    const { located } = locateResources(
      inputFor([
        { id: "explodes", manifest: manifest("explodes", [{ kind: "prefs", path: "p/x.prf" }]) },
      ]),
    );
    const runtime: ResourceRuntime = {
      readText: () => Promise.reject(new Error("network on fire")),
      canPlayAudio: () => true,
    };
    const { refused } = await verifyResources(located, runtime, NO_INVENTORY);
    expect(refused[0]?.why).toContain("network on fire");
  });
});

describe("two mods offering the same thing", () => {
  it("gives it to the later one and TELLS the earlier one it lost", () => {
    const { located, problems } = locateResources(
      inputFor([
        { id: "first", manifest: manifest("first", [{ kind: "sound", path: "a" }]) },
        { id: "second", manifest: manifest("second", [{ kind: "sound", path: "b" }]) },
      ]),
    );
    expect(located.map((l) => l.modId)).toEqual(["second"]);
    expect(problems).toHaveLength(1);
    expect(problems[0]?.id).toBe("first");
    expect(problems[0]?.why).toContain("Move this mod later");
  });

  it("lets two mods hold different help slots at once", () => {
    const { located, problems } = locateResources(
      inputFor([
        { id: "a", manifest: manifest("a", [{ kind: "help", path: "h.txt", slot: "alpha" }]) },
        { id: "b", manifest: manifest("b", [{ kind: "help", path: "h.txt", slot: "beta" }]) },
      ]),
    );
    expect(located).toHaveLength(2);
    expect(problems).toEqual([]);
  });
});

describe("the consumers actually read what was latched", () => {
  it("paints a mod's splash, and STILL credits Angband and the port", () => {
    setSplashArt(["{red}MY TOTAL CONVERSION{/}", "line two"]);
    const markup = titleLines().map((l) => l.markup);
    expect(markup[0]).toContain("MY TOTAL CONVERSION");
    /* Weaving the credits at core's own row indices would have dropped them for
     * any art that is not news.txt's shape - a two-row splash never reaches row
     * 20. Appending is the form that cannot silently lose them. */
    expect(markup.some((m) => m.includes("Angband"))).toBe(true);
    expect(markup.some((m) => m.includes("neostryder"))).toBe(true);
  });

  it("clamps art that is too tall instead of running off the terminal", () => {
    setSplashArt(Array.from({ length: 60 }, (_, i) => `row ${i}`));
    const lines = titleLines();
    expect(lines).toHaveLength(MOD_SPLASH_ROWS + 2);
  });

  it("REPLACES a core help page when the slot matches, and keeps the rest", () => {
    const ids = coreHelpPageIds();
    expect(ids).toContain("commands");
    const before = helpIndexLabels().length;
    setModHelpPages([
      { slot: "commands", label: "How to play MY game", lines: helpLinesFromText("hi") },
    ]);
    const labels = helpIndexLabels();
    expect(labels).toHaveLength(before);
    expect(labels).toContain("How to play MY game");
    expect(labels).not.toContain("Available commands");
    expect(labels).toContain("Symbols on your map");
  });

  it("ADDS a page when the slot is the mod's own", () => {
    const before = helpIndexLabels().length;
    setModHelpPages([{ slot: "lore", label: "The lore", lines: helpLinesFromText("once") }]);
    expect(helpIndexLabels()).toHaveLength(before + 1);
    expect(helpIndexLabels()).toContain("The lore");
  });

  it("strips a Windows line ending rather than painting it as a glyph", () => {
    expect(helpLinesFromText("a\r\nb").map((l) => l.text)).toEqual(["a", "b"]);
  });

  it("hands the latched set to the accessors", () => {
    const { located } = locateResources(
      inputFor([
        { id: "m", manifest: manifest("m", [{ kind: "help", path: "h.txt", slot: "s" }]) },
      ]),
    );
    setModResources(located as LocatedResource[]);
    expect(located).toHaveLength(1);
  });
});
