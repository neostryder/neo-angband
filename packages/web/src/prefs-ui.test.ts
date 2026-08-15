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

import { processPrefFile } from "./prefs-ui";
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
