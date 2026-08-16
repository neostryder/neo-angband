/**
 * html_screenshot (ui-command.c L295-481), ported.
 *
 * Census block E, host-io. The port's screen dump used to be
 * `canvas.toDataURL("image/png")` with the invented messages "Screen dump
 * saved." / "Screen dump failed." - a PNG of pixels where upstream writes the
 * TERMINAL, cell by cell, in one of two text formats:
 *
 *   mode 0 (HTML)        a <pre> block wrapped in <font color=...> runs
 *   mode 1 (Forum text)  [CODE][TT] with [COLOR="#RRGGBB"] runs
 *
 * The difference matters: upstream's dump is text you can paste into the
 * ladder or a forum post, which is the entire reason do_cmd_save_screen exists
 * ("Dump as (H)TML or (F)orum text? "). A PNG serves neither.
 *
 * The colour-run logic is upstream's, including the two quirks: forum mode skips
 * a colour change on a SPACE (the forum software strips [COLOR] elements that
 * contain only whitespace, L413-417), and HTML mode closes the run rather than
 * opening a new one when it returns to plain white-on-black (L427-431).
 *
 * The port has no subwindows, so the other_term half (a monster-list panel dumped
 * beside the main terminal, L330-346) takes the other_term == NULL path; the
 * "Include monster list? " prompt that chooses it is recorded as a divergence in
 * the text census rather than paraphrased into something else.
 */

import { colorToCss, COLOUR_WHITE, COLOUR_DARK } from "@rpgm-tools/neo-angband-core";
import type { ColoredCell } from "./term";

/** The two modes of do_cmd_save_screen_html. */
export const DUMP_HTML = 0;
export const DUMP_FORUM = 1;

/** "#%02X%02X%02X" for a CSS colour the terminal stored. */
export function cssToHex(css: string): string {
  const rgb = parseRgb(css);
  if (!rgb) return "#FFFFFF";
  return `#${rgb.map((n) => n.toString(16).padStart(2, "0").toUpperCase()).join("")}`;
}

function parseRgb(css: string): [number, number, number] | null {
  const s = css.trim();
  if (s.startsWith("#")) {
    const hex = s.slice(1);
    if (hex.length === 3) {
      const [r, g, b] = [0, 1, 2].map((i) => {
        const d = hex[i] ?? "0";
        return Number.parseInt(d + d, 16);
      });
      return [r ?? 0, g ?? 0, b ?? 0];
    }
    if (hex.length >= 6) {
      return [
        Number.parseInt(hex.slice(0, 2), 16),
        Number.parseInt(hex.slice(2, 4), 16),
        Number.parseInt(hex.slice(4, 6), 16),
      ];
    }
    return null;
  }
  const m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/u.exec(s);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** write_html_escape_char (ui-command.c L238-266). */
function escapeHtmlChar(ch: string): string {
  if (ch === "<") return "&lt;";
  if (ch === ">") return "&gt;";
  if (ch === "&") return "&amp;";
  return ch === "" ? " " : ch;
}

/**
 * Dump a terminal snapshot as HTML (mode 0) or forum text (mode 1).
 *
 * `title` is the path upstream puts in <title> (L352); `buildId` is the
 * `<meta name='generator'>` value (L351).
 */
export function htmlScreenshot(
  cells: readonly (readonly ColoredCell[])[],
  mode: number,
  title: string,
  buildId: string,
): string {
  const white = cssToHex(colorToCss(COLOUR_WHITE));
  const dark = cssToHex(colorToCss(COLOUR_DARK));
  const out: string[] = [];

  if (mode === DUMP_HTML) {
    out.push("<!DOCTYPE html><html><head>\n");
    out.push("  <meta http-equiv='Content-Type' content='text/html; charset=utf-8'>\n");
    out.push(`  <meta name='generator' content='${buildId}'>\n`);
    out.push(`  <title>${title}</title>\n`);
    out.push("</head>\n\n");
    out.push(`<body style='color: ${white}; background: ${dark};'>\n`);
    out.push("<pre>\n");
  } else {
    out.push(`[CODE][TT][BC="${dark}"][COLOR="${white}"]\n`);
  }

  /* oa: the last colour written. Upstream starts at COLOUR_WHITE (L303). */
  let oFg = white;
  let oBg = dark;

  for (const row of cells) {
    for (const cell of row) {
      const fg = cssToHex(cell.fg);
      /* No bg on a cell is BG_BLACK, i.e. COLOUR_DARK (L398-400). */
      const bg = cell.bg === undefined ? dark : cssToHex(cell.bg);
      const ch = cell.ch === "" ? " " : cell.ch;

      /* Colour change (L412-445). */
      if ((oFg !== fg || oBg !== bg) && (mode === DUMP_HTML || ch !== " ")) {
        if (oFg === white && oBg === dark && mode === DUMP_HTML) {
          /* From the default white to another colour (L418-426). */
          out.push(`<font color="${fg}" style="background-color: ${bg}">`);
        } else if (fg === white && bg === dark && mode === DUMP_HTML) {
          /* From another colour back to the default white (L427-431). */
          out.push("</font>");
        } else if (mode === DUMP_HTML) {
          out.push(`</font><font color="${fg}" style="background-color: ${bg}">`);
        } else {
          out.push(`[/COLOR][COLOR="${fg}"]`);
        }
        oFg = fg;
        oBg = bg;
      }

      out.push(mode === DUMP_HTML ? escapeHtmlChar(ch) : ch);
    }
    out.push("\n");
  }

  /* Close the last font-color tag if necessary (L466-467). */
  if ((oFg !== white || oBg !== dark) && mode === DUMP_HTML) out.push("</font>");

  if (mode === DUMP_HTML) {
    out.push("</pre>\n");
    out.push("</body>\n");
    out.push("</html>\n");
  } else {
    out.push('[/COLOR][/BC][/TT][/CODE]\n');
  }

  return out.join("");
}
