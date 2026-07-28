/**
 * dump_level and friends (gen-util.c L943-1141), ported.
 *
 * The post-mortem level dump: one HTML page holding an ASCII map of a chunk, one
 * character per grid, in upstream's own precedence order. Two commands use it -
 * the wizard's "dump level map" (cmd-wizard.c:1112) and wiz-stats' disconnect
 * report (disconnect.html) - and the `dist` argument is what the latter needs:
 * where the distance array is negative, the grid is written as '*' instead of
 * its own glyph, which is how an unreachable region shows up on the page.
 *
 * HTML rather than plain text is upstream's choice, and its reason is in the C:
 * "a typical browser will happily display the content in a scrollable area
 * without wrapping lines" (L982-983).
 *
 * The port writes to a string instead of an ang_file; the platform hands that to
 * the user directory / a download (see packages/web/src/userdir.ts).
 */

import { floorPile } from "./floor";
import { squareIsEmpty, squareIsPlayer } from "./context";
import { squareIsTrap, squareIsPlayerTrap, squareIsWebbed } from "./trap";
import { squareIsVault, squareIsNoStairs } from "../gen/util";
import type { GameState } from "./context";

/** dump_level_escaped_string (gen-util.c L1000-1026). */
export function dumpLevelEscapedString(s: string): string {
  let out = "";
  for (const ch of s) {
    if (ch === "&") out += "&amp;";
    else if (ch === "<") out += "&lt;";
    else if (ch === ">") out += "&gt;";
    else if (ch === '"') out += "&quot;";
    else out += ch;
  }
  return out;
}

/** dump_level_header (gen-util.c L1038-1048). */
export function dumpLevelHeader(title: string): string {
  return (
    "<!DOCTYPE html>\n" +
    '<html lang="en" xml:lang="en" xmlns="http://www.w3.org/1999/xhtml">\n' +
    "  <head>\n" +
    '    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8">\n' +
    "    <title>" +
    dumpLevelEscapedString(title) +
    "</title>\n  </head>\n  <body>\n"
  );
}

/** dump_level_footer (gen-util.c L1138-1141). */
export function dumpLevelFooter(): string {
  return "  </body>\n</html>\n";
}

/**
 * dump_level_body (gen-util.c L1069-1130). The glyph precedence is upstream's,
 * in order: player, monster, door, rubble, down stairs, up stairs, trap or
 * player trap, web, object, empty-in-a-vault-or-no-stairs, passable. Anything
 * else - and everything outside the fully-in-bounds region - is '#'.
 *
 * `dist[y][x] < 0` replaces the glyph with '*' for every case except the player
 * (L1088-1122), which is why the player is tested first and unconditionally.
 */
export function dumpLevelBody(
  state: GameState,
  title: string,
  dist?: readonly (readonly number[])[] | undefined,
): string {
  const c = state.chunk;
  const marked = (y: number, x: number): boolean =>
    dist !== undefined && (dist[y]?.[x] ?? 0) < 0;

  let out = `    <p>${dumpLevelEscapedString(title)}`;
  if (dist !== undefined) {
    out += "\n    <p>A location where the distance array was negative is marked with *.";
  }
  out += "\n    <pre>\n";

  for (let y = 0; y < c.height; y++) {
    for (let x = 0; x < c.width; x++) {
      const grid = { x, y };
      let s = "#";
      if (c.inBoundsFully(grid)) {
        const alt = marked(y, x) ? "*" : null;
        if (squareIsPlayer(state, grid)) s = "@";
        else if (c.mon(grid) !== 0) s = alt ?? "M";
        else if (c.isDoor(grid)) s = alt ?? "+";
        else if (c.isRubble(grid)) s = alt ?? ":";
        else if (c.isDownstairs(grid)) s = alt ?? "&gt;";
        else if (c.isUpstairs(grid)) s = alt ?? "&lt;";
        else if (squareIsTrap(state, grid) || squareIsPlayerTrap(state, grid)) s = alt ?? "^";
        else if (squareIsWebbed(state, grid)) s = alt ?? "w";
        else if (floorPile(state, grid).length > 0) s = alt ?? "$";
        else if (squareIsEmpty(state, grid) && (squareIsVault(c, grid) || squareIsNoStairs(c, grid))) {
          s = alt ?? " ";
        } else if (c.isPassable(grid)) s = alt ?? ".";
      }
      out += s;
    }
    out += "\n";
  }

  return `${out}    </pre>\n`;
}

/** dump_level (gen-util.c L987-992): header + body + footer, as one page. */
export function dumpLevel(
  state: GameState,
  title: string,
  dist?: readonly (readonly number[])[] | undefined,
): string {
  return dumpLevelHeader(title) + dumpLevelBody(state, title, dist) + dumpLevelFooter();
}
