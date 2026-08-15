/**
 * `processPrefFile`'s BOOLEAN, which is the half of the pref reader a player
 * meets as "Failed to load 'Bilbo.prf'!".
 *
 * #275. Upstream's `process_pref_file_named` ends `return e == PARSE_ERROR_NONE`
 * (ui-prefs.c L1240) where `e` is the last value of its OWN `while (file_getl(...))`
 * loop, and its `%:` handler discards the nested read entirely:
 *
 *     file = parser_getstr(p, "file");
 *     (void)process_pref_file(file, true, d->user);
 *     return PARSE_ERROR_NONE;                     -- ui-prefs.c L437-440
 *
 * So a bad line inside an included file neither stops nor fails the including
 * one. The port failed it, because it counted the includer's array - which the
 * nested read had pushed its errors into - and for the same reason it named the
 * OUTER file in the message, where upstream's `print_error(path, p)` runs inside
 * the nested invocation and names the INCLUDED one.
 *
 * Both are fixed by `PrefError.fromInclude` and neither is fixed by throwing the
 * nested errors away: upstream still calls print_error for them, so the player
 * still sees the message. Only the failure propagates differently.
 *
 * The deps here are deliberately stubs. `window:` is the one directive that
 * resolves nothing against the registries, so these tests are about the loop and
 * the boolean rather than about gamedata - which prefs.test.ts already covers
 * against the real pack.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { HostDir, MemoryHost, NULL_HOST, setHost } from "@rpgm-tools/neo-angband-core";
import type { GlyphTable, PrefDeps } from "@rpgm-tools/neo-angband-core";

import { applyPrefText, processPrefFile } from "./prefs-ui";
import type { PrefsUiCtx } from "./prefs-ui";

let io: MemoryHost;

beforeEach(() => {
  io = new MemoryHost();
  setHost(io);
});

afterEach(() => {
  setHost(NULL_HOST);
});

/** Registries no `window:` line ever consults. */
const DEPS = {
  features: {},
  objects: { kinds: [], flavors: [] },
  monsters: { raceByName: () => null },
  traps: null,
} as unknown as PrefDeps;

/** The ctx `processPrefFile` reads, plus the two things a test wants to see. */
function ctx(): PrefsUiCtx & { said: string[]; windows: string[] } {
  const said: string[] = [];
  const windows: string[] = [];
  return {
    said,
    windows,
    term: {} as PrefsUiCtx["term"],
    say: (t: string) => said.push(t),
    playerName: () => "Bilbo",
    /* glyphTableSink only closes over the table; no `window:` line reaches it. */
    glyphs: {} as GlyphTable,
    prefDeps: DEPS,
    dumpDeps: () => ({}) as never,
    extraSink: {
      windowFlag: (w, f, v) => windows.push(`${w}:${f}:${v}`),
    },
  };
}

/** `window:99:...` is out of bounds (ui-prefs.c L1066: `window >= ANGBAND_TERM_MAX`). */
const BAD = "window:99:0:1";
const GOOD = "window:1:0:1";

describe("processPrefFile: an include's error does not fail the including file", () => {
  it("returns SUCCESS when only the include had a bad line", () => {
    io.write(HostDir.USER, "outer.prf", `%:inc.prf\n${GOOD}`);
    io.write(HostDir.USER, "inc.prf", BAD);
    const c = ctx();

    expect(processPrefFile(c, "outer.prf")).toBe(true);
    /* And the outer file carried on past the `%`, which is the same statement
     * from the other side: parse_prefs_load returns PARSE_ERROR_NONE. */
    expect(c.windows).toEqual(["1:0:1"]);
  });

  it("still REPORTS the include's error - the fix is not to swallow it", () => {
    io.write(HostDir.USER, "outer.prf", `%:inc.prf\n${GOOD}`);
    io.write(HostDir.USER, "inc.prf", BAD);
    const c = ctx();

    processPrefFile(c, "outer.prf");
    expect(c.said).toHaveLength(1);
    expect(c.said[0]).toContain("Parse error in");
    expect(c.said[0]).toContain("line 1");
  });

  it("names the INCLUDED file in the message, not the includer", () => {
    io.write(HostDir.USER, "outer.prf", `%:inc.prf\n${GOOD}`);
    io.write(HostDir.USER, "inc.prf", BAD);
    const c = ctx();

    processPrefFile(c, "outer.prf");
    /* print_error(path, p) runs inside the NESTED process_pref_file_named, so
     * `path` is the include's. MemoryHost.displayPath is `${dir}/${name}`. */
    expect(c.said[0]).toBe(
      `Parse error in ${io.displayPath(HostDir.USER, "inc.prf")} line 1 column 1: ` +
        "window: out of bounds",
    );
    expect(c.said[0]).not.toContain("outer.prf");
  });

  it("an include nested two deep behaves exactly as one deep", () => {
    io.write(HostDir.USER, "outer.prf", `%:mid.prf\n${GOOD}`);
    io.write(HostDir.USER, "mid.prf", "%:inner.prf");
    io.write(HostDir.USER, "inner.prf", BAD);
    const c = ctx();

    expect(processPrefFile(c, "outer.prf")).toBe(true);
    expect(c.windows).toEqual(["1:0:1"]);
    expect(c.said[0]).toContain(io.displayPath(HostDir.USER, "inner.prf"));
  });

  it("the file's OWN bad line still fails, and still stops the file there", () => {
    io.write(HostDir.USER, "outer.prf", `${GOOD}\n${BAD}\nwindow:2:0:1`);
    const c = ctx();

    expect(processPrefFile(c, "outer.prf")).toBe(false);
    /* ui-prefs.c L1229's `break`: line 3 was never read, so only line 1 applied. */
    expect(c.windows).toEqual(["1:0:1"]);
    expect(c.said[0]).toContain(io.displayPath(HostDir.USER, "outer.prf"));
  });

  it("an own bad line fails even when an include already reported one", () => {
    /* The marker must not be read as "some error was excused, so pass". */
    io.write(HostDir.USER, "outer.prf", `%:inc.prf\n${BAD}`);
    io.write(HostDir.USER, "inc.prf", BAD);
    const c = ctx();

    expect(processPrefFile(c, "outer.prf")).toBe(false);
    expect(c.said).toHaveLength(2);
  });

  it("a missing file is still a failure, as PARSE_ERROR_INTERNAL is", () => {
    const c = ctx();
    expect(processPrefFile(c, "nope.prf")).toBe(false);
    expect(c.said[0]).toContain("Cannot open");
  });

  it("a missing INCLUDE is not a failure - the nested bool is discarded", () => {
    io.write(HostDir.USER, "outer.prf", `%:nope.prf\n${GOOD}`);
    const c = ctx();

    expect(processPrefFile(c, "outer.prf")).toBe(true);
    expect(c.said).toEqual([]);
    expect(c.windows).toEqual(["1:0:1"]);
  });
});

/**
 * `applyPrefText`'s `%:` include, which was a silent no-op until #278.
 *
 * The old `loadFile: () => null` made every include line a skip that reported
 * nothing: the directive was neither honoured nor named, so a mod author whose
 * pref file worked in the '=' menu watched it do half as much when the same
 * bytes shipped as a `prefs` resource. The stated reason - the grammar's
 * `loadFile` is synchronous, a mod's files resolve asynchronously - was true and
 * was not a reason, because the reading can happen BEFORE the parse. That is
 * what `loadTilePrefs` has always done for a graphics pack's `%:flvr-*.prf`.
 *
 * These drive the real function and assert what the LINE DID, not that a loader
 * was consulted: `window:` reaches `extraSink.windowFlag`, and an include that
 * never loads leaves that array empty.
 */
describe("applyPrefText: a mod's %: include is followed", () => {
  /** A loader over a fixed set of files, recording what it was asked for. */
  function files(map: Record<string, string>): {
    load: (name: string) => Promise<string | null>;
    asked: string[];
  } {
    const asked: string[] = [];
    return {
      asked,
      load: (name: string) => {
        asked.push(name);
        return Promise.resolve(map[name] ?? null);
      },
    };
  }

  it("applies the INCLUDED file's lines, not just the includer's", async () => {
    const c = ctx();
    const f = files({ "inc.prf": "window:2:0:1" });

    const applied = await applyPrefText(c, `%:inc.prf\n${GOOD}`, "mod.prf", f.load);

    /* The include's line landed, and before the includer's own - which is where
     * `%` sits in the file, so it is also the ordering upstream gives. */
    expect(c.windows).toEqual(["2:0:1", "1:0:1"]);
    expect(applied.faults).toEqual([]);
    expect(f.asked).toEqual(["inc.prf"]);
  });

  it("follows an include's own include, to the parser's depth", async () => {
    const c = ctx();
    const f = files({ "mid.prf": "%:inner.prf", "inner.prf": "window:3:0:1" });

    await applyPrefText(c, "%:mid.prf", "mod.prf", f.load);

    expect(c.windows).toEqual(["3:0:1"]);
  });

  it("hands the includes back, so a tile replay does not read them again", async () => {
    /* #153 latches the mod's pref text and replays it into every fresh TileMap.
     * The bytes of an include have to travel with it or that replay is the same
     * silent skip one function over. */
    const c = ctx();
    const f = files({ "inc.prf": "window:2:0:1" });

    const applied = await applyPrefText(c, "%:inc.prf", "mod.prf", f.load);

    expect([...applied.includes]).toEqual([["inc.prf", "window:2:0:1"]]);
  });

  it("reports an include's bad line against the INCLUDE, not the mod's file", async () => {
    const c = ctx();
    const f = files({ "inc.prf": BAD });

    const applied = await applyPrefText(c, `%:inc.prf\n${GOOD}`, "mod.prf", f.load);

    /* prefErrorMessage reads `fromInclude` (#275), so the name in the message is
     * the one the author has to go and fix. */
    expect(applied.faults).toEqual([
      "Parse error in inc.prf line 1 column 1: window: out of bounds",
    ]);
    /* And it did not stop the mod's own file: parse_prefs_load discards the
     * nested result (ui-prefs.c L438). */
    expect(c.windows).toEqual(["1:0:1"]);
  });

  it("is quiet about an include that does not resolve, exactly as upstream is", async () => {
    const c = ctx();
    const f = files({});

    const applied = await applyPrefText(c, `%:nope.prf\n${GOOD}`, "mod.prf", f.load);

    expect(applied.faults).toEqual([]);
    expect(c.windows).toEqual(["1:0:1"]);
  });

  it("survives a loader that throws - one dead include is not the whole file", async () => {
    const c = ctx();
    let asked = 0;
    const load = (name: string): Promise<string | null> => {
      asked++;
      if (name === "boom.prf") throw new Error("resolver gone");
      return Promise.resolve("window:6:0:1");
    };

    const applied = await applyPrefText(
      c,
      `%:boom.prf\n%:ok.prf\n${GOOD}`,
      "mod.prf",
      load,
    );

    expect(asked).toBe(2);
    expect(applied.faults).toEqual([]);
    expect(c.windows).toEqual(["6:0:1", "1:0:1"]);
  });

  it("reads each name once, so a cycle of includes terminates", async () => {
    const c = ctx();
    const asked: string[] = [];
    const load = (name: string): Promise<string | null> => {
      asked.push(name);
      return Promise.resolve(name === "a.prf" ? "%:b.prf" : "%:a.prf");
    };

    const applied = await applyPrefText(c, `%:a.prf\n${GOOD}`, "mod.prf", load);

    /* a -> b -> a: the second sighting of `a.prf` is already in the map, so the
     * frontier empties rather than growing. (The PARSE still re-enters the cycle
     * to its own depth cap, which is prefs.ts's business and unchanged.) */
    expect(asked).toEqual(["a.prf", "b.prf"]);
    expect(applied.faults).toEqual([]);
    expect(c.windows).toEqual(["1:0:1"]);
  });

  it("does not mistake a commented-out or `\\r`-terminated line for the parser's", async () => {
    /* The scan has to tokenise exactly as processPrefText does or it fetches
     * files the parse will not ask for and misses ones it will. */
    const c = ctx();
    const f = files({ "crlf.prf": "window:5:0:1", "commented.prf": BAD });

    await applyPrefText(c, "#%:commented.prf\r\n%:crlf.prf\r\n", "mod.prf", f.load);

    expect(f.asked).toEqual(["crlf.prf"]);
    expect(c.windows).toEqual(["5:0:1"]);
  });
});
