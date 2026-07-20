/**
 * The title / news screen (reference/lib/screens/news.txt), shown at boot before
 * any game interaction. This is the faithful equivalent of the GUI ports
 * displaying news.txt and then waiting on "[Choose 'New' or 'Open' from the
 * 'File' menu]" (main-win.c:5475, main-cocoa.m:5886): the game does not
 * auto-start into the dungeon - the player sees the title first and presses a
 * key to begin.
 *
 * The art below is reproduced verbatim from reference/lib/screens/news.txt (the
 * upstream 4.2.6 file); do not edit it here - regenerate from that file. Each
 * line uses the loader's {colour}...{/} markup, drawn run by run; bare text
 * outside any tag is COLOUR_WHITE, matching the file loader's default.
 */

import type { GlyphTerm } from "./term";
import { colorTextToAttr, colorToCss, COLOUR_WHITE } from "@neo-angband/core";

/**
 * The Angband baseline this port reproduces, substituted for the file's
 * $VERSION token exactly as the upstream title screen shows it. (The port's own
 * version is reported by the 'V' command, do_cmd_version.)
 */
const BASELINE_VERSION = "4.2.6";

/** news.txt verbatim (reference/lib/screens/news.txt); $VERSION is filled in. */
const NEWS: readonly string[] = [
  "",
  "{mud}                                       ^                        {/}",
  "{mud}                                      ^^^                       {/}",
  "{mud}                ^                    ^^^^^                   ^  {/}",
  "{mud}               ^^^                  ^^^^^^^                 ^^^ {/}",
  "{mud}              ^^^^^                ^^^^^^^^^               ^^^^^{/}",
  "{mud}             ^^^^  {/}{red}_{/}{mud}              ^ {/}{red}_{/}{mud}  ^^^^^^             {/}{red}_{/}{mud}  ^^^^{/}",
  "{mud}            ^^^^ {/}{red} / \\   _ __   __ _| |__   __ _ _ __   __| | {/}{mud}^^^^^   {/}",
  "{mud}           ^^^^ {/}{red} / _ \\ | '_ \\ / _` | '_ \\ / _` | '_ \\ / _` | {/}{mud}^^^^^^  {/}",
  "{mud}          ^^^^  {/}{red}/ ___ \\| | | | (_| | |_) | (_| | | | | (_| | {/}{mud}^^^^^^^ {/}",
  "{mud}         ^^^^  {/}{red}/_/   \\_\\_| |_|\\__, |_.__/ \\__,_|_| |_|\\__,_| {/}{mud}^^^^^^^^{/}",
  "{mud}        ^^^^^                {/}{red} |___/{/}  $VERSION",
  "{mud}       ^^^^^^^^^^^^^^^^^^                     ^^^^  ^^^^^^^^^^^^^^^^^^^ {/}",
  "{light slate}         \"When the world is old and the Powers grow weary, then Morgoth,{/}",
  "{light slate}          seeing that the guard sleepeth, shall come back through the   {/}",
  "{light slate}          Door of Night out of the Timeless Void.  Then shall the Last  {/}",
  "{light slate}          Battle be gathered...\"                                        {/}",
  "",
  "{light slate}                         Website: http://rephial.org/           {/}",
  "{light slate}                     Forums: https://angband.live/forums/       {/}",
  "              ",
  "                           For help press '?' in-game",
];

/** A coloured span within a title line. */
interface Run {
  text: string;
  css: string;
}

/**
 * Parse one {colour}...{/} markup line into coloured runs. `{/}` resets to the
 * default (COLOUR_WHITE); a `{name}` opens that colour (colorTextToAttr resolves
 * the name, e.g. "mud", "red", "light slate"). Text outside any tag is white.
 * Spaces are preserved so the file's baked-in centring survives.
 */
export function parseNewsLine(line: string): Run[] {
  const white = colorToCss(COLOUR_WHITE);
  const runs: Run[] = [];
  const re = /\{([^}]*)\}/g;
  let last = 0;
  let cur = white;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) {
    const before = line.slice(last, m.index);
    if (before) runs.push({ text: before, css: cur });
    const tag = m[1] ?? "";
    cur = tag === "/" ? white : colorToCss(colorTextToAttr(tag));
    last = re.lastIndex;
  }
  const tail = line.slice(last);
  if (tail) runs.push({ text: tail, css: cur });
  return runs;
}

/**
 * Paint the title screen and resolve on the first key or tap. Mirrors the GUI
 * ports: the news art, then a centred start prompt below it. Registers its own
 * one-shot listeners and tears them down on dismiss, like the other modal
 * screens (showLevelMap).
 */
export function showTitleScreen(term: GlyphTerm): Promise<void> {
  return new Promise<void>((resolve) => {
    const paint = (): void => {
      const { cols, rows } = term.size();
      term.clear();
      for (let y = 0; y < NEWS.length && y < rows; y++) {
        const raw = (NEWS[y] ?? "").replace("$VERSION", BASELINE_VERSION);
        let x = 0;
        for (const run of parseNewsLine(raw)) {
          if (x >= cols) break;
          const chunk = run.text.slice(0, cols - x);
          term.print(x, y, chunk, run.css);
          x += chunk.length;
        }
      }
      const prompt = "[ Press any key to begin ]";
      const py = Math.min(rows - 1, NEWS.length + 1);
      const px = Math.max(0, Math.floor((cols - prompt.length) / 2));
      term.print(px, py, prompt.slice(0, cols - 1), colorToCss(COLOUR_WHITE));
    };
    const finish = (): void => {
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("pointerdown", onTap, true);
      resolve();
    };
    const onKey = (ev: KeyboardEvent): void => {
      ev.preventDefault();
      ev.stopImmediatePropagation();
      finish();
    };
    const onTap = (ev: Event): void => {
      ev.preventDefault();
      finish();
    };
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("pointerdown", onTap, true);
    paint();
  });
}
