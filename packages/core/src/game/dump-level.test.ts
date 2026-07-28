/**
 * dump_level (gen-util.c L943-1141): the HTML post-mortem level map.
 *
 * Census block E, host-io. The port had a stand-in (wizDumpLevelMap) that
 * returned a grid of feature INDICES - a function upstream does not have, in
 * place of one it does - so the wizard's "dump level map" showed a row/column
 * count on a text screen instead of writing the page. This is the real thing;
 * the glyph precedence is the part a stand-in cannot fake.
 */

import { describe, expect, it } from "vitest";
import { loc } from "../loc";
import { SQUARE } from "../generated";
import { dumpLevel, dumpLevelBody, dumpLevelEscapedString } from "./dump-level";
import { GRANITE, addMon, featureReg, makeRace, makeState, monReg } from "./harness";

/** The <pre> block's rows, without the surrounding markup. */
function mapRows(html: string): string[] {
  const start = html.indexOf("<pre>\n") + "<pre>\n".length;
  const end = html.indexOf("    </pre>");
  return html.slice(start, end).split("\n").slice(0, -1);
}

describe("dump_level", () => {
  it("wraps the map in upstream's html, with the title escaped twice over", () => {
    const state = makeState({ w: 5, h: 4 });
    const html = dumpLevel(state, 'Map of <level> & "1"');

    expect(html.startsWith("<!DOCTYPE html>\n")).toBe(true);
    expect(html).toContain(
      '<html lang="en" xml:lang="en" xmlns="http://www.w3.org/1999/xhtml">',
    );
    /* dump_level_escaped_string, in the <title> AND in the body's <p>. */
    expect(html).toContain("<title>Map of &lt;level&gt; &amp; &quot;1&quot;</title>");
    expect(html).toContain("    <p>Map of &lt;level&gt; &amp; &quot;1&quot;");
    expect(html.endsWith("  </body>\n</html>\n")).toBe(true);
  });

  it("dumps one character per grid, walls outside the fully-in-bounds region", () => {
    const state = makeState({ w: 6, h: 4, playerGrid: loc(2, 1) });
    const rows = mapRows(dumpLevel(state, "t"));
    expect(rows.length).toBe(4);
    for (const row of rows) expect(row.length).toBe(6);
    /* openField is granite-walled floor; row 0 and the edges are '#'. */
    expect(rows[0]).toBe("######");
    /* The player wins over everything (L1088). */
    expect(rows[1]).toBe("#.@..#");
    expect(rows[3]).toBe("######");
  });

  it("follows the C's precedence: player, monster, door, rubble, stairs, ...", () => {
    const state = makeState({ w: 12, h: 3, playerGrid: loc(1, 1) });
    const c = state.chunk;
    const race = makeRace({ name: "test rat" });
    monReg.races.push(race);
    addMon(state, race, loc(2, 1));

    c.setFeat(loc(3, 1), featureReg.byCodeName("CLOSED").fidx);
    c.setFeat(loc(4, 1), featureReg.byCodeName("RUBBLE").fidx);
    c.setFeat(loc(5, 1), featureReg.byCodeName("MORE").fidx);
    c.setFeat(loc(6, 1), featureReg.byCodeName("LESS").fidx);
    /* A vault floor with nothing on it dumps as a SPACE, not a '.' (L1115). */
    c.sqinfoOn(loc(7, 1), SQUARE.VAULT);
    c.setFeat(loc(8, 1), GRANITE);

    const row = mapRows(dumpLevel(state, "t"))[1];
    /* The stairs are written as ENTITIES (L1101/L1104), so the row is wider
     * than the level: upstream puts "&gt;" / "&lt;" straight into the <pre>. */
    expect(row).toBe("#@M+:&gt;&lt; #..#");
  });

  it("marks a negative distance with '*' - everything except the player", () => {
    const state = makeState({ w: 5, h: 3, playerGrid: loc(1, 1) });
    /* dist[y][x] < 0 replaces the glyph (L1091-1122). */
    const dist = [
      [0, 0, 0, 0, 0],
      [0, -1, -1, 0, 0],
      [0, 0, 0, 0, 0],
    ];
    const html = dumpLevel(state, "t", dist);
    expect(html).toContain(
      "<p>A location where the distance array was negative is marked with *.",
    );
    expect(mapRows(html)[1]).toBe("#@*.#");
  });

  it("body-only output can be concatenated for several levels (L1063-1067)", () => {
    const state = makeState({ w: 4, h: 3 });
    const body = dumpLevelBody(state, "one");
    expect(body.startsWith("    <p>one")).toBe(true);
    expect(body.endsWith("    </pre>\n")).toBe(true);
    expect(body).not.toContain("<!DOCTYPE");
  });

  it("escapes only &, <, > and \" (dump_level_escaped_string)", () => {
    expect(dumpLevelEscapedString(`a&b<c>d"e'f`)).toBe("a&amp;b&lt;c&gt;d&quot;e'f");
  });
});
