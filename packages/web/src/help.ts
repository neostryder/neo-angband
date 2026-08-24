/**
 * The in-game help browser ('?', do_cmd_help / show_file in ui-help.c).
 *
 * Upstream do_cmd_help (ui-help.c:470) opens show_file("index.txt"), a
 * recursive pager whose ".. menu:: [x] file.txt" lines build a lettered
 * sub-menu (ui-help.c:172-185) that recurses into commands.txt / symbols.txt;
 * pressing '?' or ESC on a sub-file returns to the index (ui-help.c:352,444-
 * 453), and ESC at the index exits help (ui-help.c:337-339).
 *
 * This port already has the two primitives that recursion decomposes into:
 * selectFromMenu (the lettered index) and showTextScreen (the scrolling
 * pager, which already renders the "(a-b/n)" line-count footer natively -
 * ui-help.c:263-333). runHelp just loops index -> page -> index, exactly the
 * upstream recursion, with no parallel viewer.
 *
 * CONTENT: the raw lib/help/*.txt files are not fetched or bundled at runtime -
 * they are TRANSCRIBED into the tables below, which is what keeps the build
 * self-contained and offline. The transcription is the whole content, not a
 * selection from it: commands.txt and r_comm.txt document the full original and
 * roguelike keysets, and main.ts's command table mirrors cmd_lookup exactly, so
 * every row upstream prints is a key this port answers to. `help.test.ts`
 * renders both pages and the symbol legend and compares them line by line
 * against `reference/lib/help/*.txt` itself, so the check is against upstream's
 * bytes rather than against a snapshot of what the port used to print.
 *
 * The page used to be a CURATED subset instead, grouped under headings this
 * port invented, on the premise that most of upstream's keyset was unbound
 * here. That premise expired: the subset had drifted into stating that 'S'
 * saves the game and 'V' shows the hall of fame, when 'S' is See abilities and
 * 'V' is Display version info in this build as in upstream, and it omitted the
 * staircase keys the playing-guide page two rows below it explains. Where a row
 * genuinely has nothing behind it here, the platform note above the table says
 * so once, rather than the table quietly not mentioning the command.
 *
 * KEYSET-AWARE, like upstream. do_cmd_help opens r_index.txt when
 * rogue_like_commands is on and index.txt when it is off (ui-help.c:476), and
 * those two index files differ only in which command summary their [a] row
 * links to. So `runHelp` takes the option's value and hands the commands page
 * the matching keyset. The port implements both keysets (keymap.ts, and the
 * `r` column of main.ts's command table), so showing the original-keyset
 * summary to a roguelike player was describing keys they had turned off.
 *
 * EACH PAGE IS A `ScreenView`, not a hand-laid `ScreenLine[]`. Both reference
 * pages are LISTS - a key and what it does, a glyph and what it is - and a list
 * on `lines` is work not yet done (see screen-view.ts's header). So each
 * section is a `table` with a caption, the key or the glyph is its own cell,
 * and a tileset mod can draw the sprite for `k` where the terminal draws the
 * letter.
 *
 * The two PORT-ADDITION pages went the other way. The playing guide and the
 * community page have no upstream text to be faithful to, so their prose is
 * published UNWRAPPED - which is the only form a presenter can lay out at its
 * own width - and the faithful terminal now wraps it itself rather than
 * printing breaks that were typed in by hand. The commands page's preamble is
 * in the same form for the same reason: it is upstream's paragraph with one
 * sentence removed, so its breaks are no longer the file's.
 *
 * All content is inlined as TS data (no runtime fetch of the .txt files),
 * satisfying the offline-PWA / self-contained build. Pure display: no RNG,
 * no game-state mutation, no turn spent, no autosave.
 */

import type { GridPointerInput, GridSurface } from "./term";
import { showTextScreen, selectFromMenu } from "./overlay";
import type { ScreenLine } from "./overlay";
import {
  freezeView,
  linesScreen,
  screenBodyLines,
  SCREEN_FOOTER,
  type ScreenBlock,
  type ScreenColumn,
  type ScreenTableBlock,
  type ScreenView,
} from "./screen-view";
import { UI_TEXT, UI_DIM, UI_GOLD } from "./ui-colors";
import { ENGINE_VERSION, t } from "@rpgm-tools/neo-angband-core";

const FG = UI_TEXT;
const DIM = UI_DIM;
const LABEL = UI_TEXT;
const GOLD = UI_GOLD;

/**
 * One blank row between two blocks.
 *
 * `gapAfter` is a TABLE's field, so a `text` block that upstream follows with a
 * blank line has nowhere else to say so; `objectListScreen` separates its two
 * sections with exactly this block for the same reason. A blank row is prose the
 * page already laid out, which is what `lines` is for - it is a list or a table
 * on `lines` that would be work not yet done.
 */
function blankRow(): ScreenBlock {
  return { kind: "lines", lines: [{ text: "", color: FG }] };
}

/* ------------------------------------------------------------------ */
/* The command reference                                               */
/* ------------------------------------------------------------------ */

/**
 * commands.txt's row: two columns of indent, then TWO key/description pairs
 * side by side - the file's own layout, which is the whole table in one screen
 * width rather than a column of 56 rows.
 *
 * THE WIDTHS ARE UPSTREAM'S, measured off the file: the key field is five wide
 * (so `^a` and the bare letters share it and `TAB` fits), the left description
 * is 32, which puts the second key at column 39 and its description at 44,
 * exactly where every row of both files puts them.
 *
 * THE INDENT IS A COLUMN because a table's first column starts at column 0 -
 * `gapBefore` ignores `gap` on it - and both alternatives lost something real.
 * Two spaces baked into the key cell would hand a presenter `"  g"` where the
 * key is `"g"`, which is the padded-field problem the whole model exists to
 * end. `tagged: true` writes a three-column `"x) "` prefix, which is one column
 * too many and offers a letter this page does not answer to.
 *
 * ONE KNOWING DEVIATION, two rows wide. commands.txt indents the `~` and `?` of
 * its last two paired rows by one extra column so they line up under the letter
 * of `^z` above them; r_comm.txt, the same table in the other keyset, does not.
 * Reproducing it would mean writing `" ~"` into a cell whose value is the key a
 * presenter looks a sprite up by, so those two rows render at the regular
 * column and `help.test.ts` names them as the only lines it does not expect to
 * match commands.txt byte for byte.
 */
const KEY_COLUMNS: readonly ScreenColumn[] = [
  { key: "indent", width: 2 },
  { key: "key", width: 5, gap: 0 },
  { key: "desc", width: 32, gap: 0 },
  { key: "key2", width: 5, gap: 0 },
  { key: "desc2", gap: 0 },
];

/**
 * One line of a keyset summary: the left key and what it does, then the right
 * key and what it does. The last two or three lines of each file have no right
 * half, so those rows carry two entries.
 */
type KeyRow = readonly [string, string] | readonly [string, string, string, string];

/**
 * commands.txt:18-73, transcribed. The original keyset, which is the default
 * (`rogue_like_commands` off).
 *
 * A `-` is upstream's own mark for a key that runs no command, and it is kept:
 * a table that silently omitted them would leave a reader unable to tell an
 * unbound key from one this transcription forgot.
 */
const ORIGINAL_KEYSET: readonly KeyRow[] = [
  ["a", "Aim a wand", "A", "Activate an object"],
  ["b", "Browse a book", "B", "-"],
  ["c", "Close a door", "C", "Character description"],
  ["d", "Drop an item", "D", "Disarm a trap or lock a door"],
  ["e", "List equipped items", "E", "Eat some food"],
  ["f", "Fire an item", "F", "Fuel your lantern/torch"],
  ["g", "Get objects on floor", "G", "Gain new spells/prayers"],
  ["h", "Fire default ammo at target", "H", "-"],
  ["i", "List contents of pack", "I", "Inspect an item"],
  ["j", "-", "J", "-"],
  ["k", "Ignore an item", "K", "Toggle ignore"],
  ["l", "Look around", "L", "Locate player on map"],
  ["m", "Cast a spell", "M", "Display map of entire level"],
  ["n", "Repeat previous command", "N", "-"],
  ["o", "Open a door or chest", "O", "-"],
  ["p", "- (see above)", "P", "-"],
  ["q", "Quaff a potion", "Q", "Retire character & quit"],
  ["r", "Read a scroll", "R", "Rest for a period"],
  ["s", "Steal from a monster (rogues)", "S", "See abilities"],
  ["t", "Take off equipment", "T", "Dig a tunnel"],
  ["u", "Use a staff", "U", "Use an item"],
  ["v", "Throw an item", "V", "Display version info"],
  ["w", "Wear/wield equipment", "W", "Walk into a trap"],
  ["x", "-", "X", "-"],
  ["y", "-", "Y", "-"],
  ["z", "Zap a rod", "Z", "-"],
  ["!", "-", "^a", "(special - debug command)"],
  ["@", "-", "^b", "-"],
  ["#", "-", "^c", "(special - break)"],
  ["$", "-", "^d", "-"],
  ["%", "-", "^e", "Toggle inven/equip window"],
  ["^", "(special - control key)", "^f", "Repeat level feeling"],
  ["&", "-", "^g", "Do autopickup"],
  ["*", "Target monster or location", "^h", "-"],
  ["(", "-", "^i", "(special - tab)"],
  [")", "Dump screen to a file", "^j", "(special - linefeed)"],
  ["{", "Inscribe an object", "^k", "-"],
  ["}", "Uninscribe an object", "^l", "Center map"],
  ["[", "Display visible monster list", "^m", "(special - return)"],
  ["]", "Display visible object list", "^n", "-"],
  ["-", "-", "^o", "Show previous message"],
  ["_", "-", "^p", "Show previous messages"],
  ["+", "Alter grid", "^q", "-"],
  ["=", "Set options", "^r", "Redraw the screen"],
  [";", "Walk (with pickup)", "^s", "Save and don't quit"],
  [":", "Take notes", "^t", "-"],
  ["'", "Target closest monster", "^u", "-"],
  ['"', "Enter a user pref command", "^v", "-"],
  [",", "Stay still (with pickup)", "^w", "(special - wizard mode)"],
  ["<", "Go up staircase (see above)", "^x", "Save and quit"],
  [".", "Run", "^y", "-"],
  [">", "Go down staircase (see above)", "^z", "(special - borg command)"],
  ["\\", "(special - bypass keymap)", "~", "Check knowledge"],
  ["`", "(special - escape)", "?", "Display help"],
  ["/", "Identify symbol"],
  ["|", "List contents of quiver"],
];

/** r_comm.txt:18-74, transcribed. The roguelike keyset (`rogue_like_commands` on). */
const ROGUELIKE_KEYSET: readonly KeyRow[] = [
  ["a", "Zap a rod (Activate)", "A", "Activate an object"],
  ["b", "(walk - south west)", "B", "(run - south west)"],
  ["c", "Close a door", "C", "Character description"],
  ["d", "Drop an item", "D", "Disarm a trap or lock a door"],
  ["e", "List equipped items", "E", "Eat some food"],
  ["f", "-", "F", "Fuel your lantern/torch"],
  ["g", "Get objects on floor", "G", "Gain new spells/prayers"],
  ["h", "(walk - west)", "H", "(run - west)"],
  ["i", "List contents of pack", "I", "Inspect an item"],
  ["j", "(walk - south)", "J", "(run - south)"],
  ["k", "(walk - north)", "K", "(run - north)"],
  ["l", "(walk - east)", "L", "(run - east)"],
  ["m", "Cast a spell", "M", "Display map of entire level"],
  ["n", "(walk - south east)", "N", "(run - south east)"],
  ["o", "Open a door or chest", "O", "Toggle ignore"],
  ["p", "- (see above)", "P", "Browse a book"],
  ["q", "Quaff a potion", "Q", "Retire character & quit"],
  ["r", "Read a scroll", "R", "Rest for a period"],
  ["s", "Steal from a monster (rogues)", "S", "See abilities"],
  ["t", "Fire an item", "T", "Take off equipment"],
  ["u", "(walk - north east)", "U", "(run - north east)"],
  ["v", "Throw an item", "V", "Display version info"],
  ["w", "Wear/wield equipment", "W", "Locate player on map (Where)"],
  ["x", "Look around", "X", "Use an item"],
  ["y", "(walk - north west)", "Y", "(run - north west)"],
  ["z", "Aim a wand (Zap)", "Z", "Use a staff (Zap)"],
  ["!", "-", "^a", "(special - debug command)"],
  ["@", "Center map", "^b", "(alter - south west)"],
  ["#", "-", "^c", "(special - break)"],
  ["$", "-", "^d", "Ignore an item"],
  ["%", "-", "^e", "Toggle inven/equip window"],
  ["^", "(special - control key)", "^f", "Repeat level feeling"],
  ["&", "-", "^g", "Do autopickup"],
  ["*", "Target monster or location", "^h", "(alter - west)"],
  ["(", "-", "^i", "(special - tab)"],
  [")", "Dump screen to a file", "^j", "(alter - south)"],
  ["{", "Inscribe an object", "^k", "(alter - north)"],
  ["}", "Uninscribe an object", "^l", "(alter - east)"],
  ["[", "Display visible monster list", "^m", "(special - return)"],
  ["]", "Display visible object list", "^n", "(alter - south east)"],
  ["-", "Walk into a trap", "^o", "Show previous message"],
  ["_", "-", "^p", "Show previous messages"],
  ["+", "Alter grid (steal for rogues)", "^q", "-"],
  ["=", "Set options", "^r", "Redraw the screen"],
  [";", "Walk (with pickup)", "^s", "Save and don't quit"],
  [":", "Take notes", "^t", "Dig a tunnel"],
  ["'", "Target closest monster", "^u", "(alter - north east)"],
  ['"', "Enter a user pref command", "^v", "Repeat previous command"],
  [",", "Run", "^w", "(special - wizard mode)"],
  ["<", "Go up staircase (see above)", "^x", "Save and quit"],
  [".", "Stay still (with pickup)", "^y", "(alter - north west)"],
  [">", "Go down staircase (see above)", "^z", "(special - borg command)"],
  ["\\", "(special - bypass keymap)", "~", "Check knowledge"],
  ["`", "(special - escape)", "?", "Display help"],
  ["/", "Identify symbol"],
  ["TAB", "Fire default ammo at target"],
  ["|", "List contents of quiver"],
];

/**
 * commands.txt:5-16 / r_comm.txt:5-16, verbatim.
 *
 * The second sentence - press and release `^`, then the letter, for a system
 * that swallows control-plus-key - used to be dropped here, because the
 * control branch of main.ts's keydown handler required `ev.ctrlKey` and had
 * no such route. That gap is closed (#3: caretPending in main.ts), so the
 * sentence is upstream's again.
 *
 * Published UNWRAPPED, upstream's words in upstream's order: it is ONE
 * paragraph, as it is in the file - there is no blank line inside those twelve
 * lines to split it on - and this port's faithful terminal wraps prose itself
 * (see this file's header on which prose keeps its `lines` and which gives
 * them up).
 */
const KEYSET_INTRO =
  "^ followed by a letter is an abbreviation for pressing and releasing the " +
  "letter key with the control key also depressed.  You may also press and " +
  "release ^ and then press and release the letter key to activate the same " +
  "command in case your system intercepts the control plus key combination " +
  "and does not pass it on.  The autoexplore_commands option modifies the " +
  "'<', '>', and 'p' commands.  When that option is off (that is the " +
  "default), the commands act as described below.  When that option is on, " +
  "'<' or '>' will use the staircase at the player's location if it is the " +
  "appropriate kind of staircase or will move to the nearest known " +
  "staircase of the appropriate kind if the player is not already at that " +
  "kind of staircase.  'p' will move to the nearest unexplored location " +
  "when the autoexplore_commands option is on.";

/**
 * The rows above that this build has nothing behind, said once and up front.
 *
 * WHY IT IS A NOTE AND NOT A CHANGE TO THE TABLE. Writing "- (not here)" into
 * five cells would make the summary disagree with the file it transcribes on
 * five rows, and a reader comparing the two would have no way to tell an
 * adaptation from a transcription error. A player reads a preamble; the
 * alternative was hoping they connect row `^e` to a footnote 40 lines down.
 *
 * The '^' prefix and the roguelike keyset's '^'-plus-direction alter keys used
 * to be listed here too (#3, #4); both are wired up in the keydown handler's
 * control branch now, so neither belongs on this "not bound" list any more.
 */
function unavailableNote(): string {
  return (
    "Not bound in this port: '\\' (bypass keymap) and '`' (escape), since a " +
    "browser delivers the control key and Escape directly; '^e', because " +
    "this is one terminal and has no second window to toggle; and '^z', " +
    "because the borg ships as a mod rather than in the game."
  );
}

/** One keyset summary as a table; the key and its description are cells. */
function keysetTable(rows: readonly KeyRow[]): ScreenTableBlock {
  return {
    kind: "table",
    key: "keys",
    tagged: false,
    columns: KEY_COLUMNS,
    rows: rows.map((row) => ({
      cells: {
        key: { text: row[0] },
        desc: { text: row[1] },
        ...(row.length === 4 ? { key2: { text: row[2] }, desc2: { text: row[3] } } : {}),
      },
    })),
  };
}

/**
 * The command summary for the active keyset (`core:help-commands`).
 *
 * `roguelike` is `rogue_like_commands`, passed in rather than read: help.ts
 * reaches into the engine for the build version and the translator and nothing
 * else, which is the guarantee help.test.ts pins, and a boolean keeps it.
 */
export function helpCommandsScreen(
  roguelike = false,
  title = roguelike
    ? t("help.commands.title.roguelike", "Angband Help - Roguelike Keyset Commands")
    : t("help.commands.title", "Angband Help - Original Keyset Commands"),
): ScreenView {
  return freezeView({
    id: "core:help-commands",
    title,
    footer: SCREEN_FOOTER,
    blocks: [
      { kind: "text", color: FG, paragraphs: [[{ text: KEYSET_INTRO }]] },
      blankRow(),
      { kind: "text", color: DIM, paragraphs: [[{ text: unavailableNote() }]] },
      blankRow(),
      keysetTable(roguelike ? ROGUELIKE_KEYSET : ORIGINAL_KEYSET),
    ],
  });
}

/** The faithful terminal's rows for `helpCommandsScreen`. */
export function helpCommandLines(cols = 80, roguelike = false): ScreenLine[] {
  return screenBodyLines(helpCommandsScreen(roguelike), cols);
}

/* ------------------------------------------------------------------ */
/* The symbol legend                                                   */
/* ------------------------------------------------------------------ */

/**
 * One row of a symbols.txt table: the left glyph and what it is, then the right
 * glyph and what it is. Three rows in the file have no right half.
 */
type GlyphRow = readonly [string, string] | readonly [string, string, string, string];

const FEATURES_NO_LOS: readonly GlyphRow[] = [
  [".", "A floor space", "1", "Entrance to General Store"],
  [".", "A trap (hidden)", "2", "Entrance to Armoury"],
  ["^", "A trap (known)", "3", "Entrance to Weapon Smith"],
  [";", "A glyph of warding", "4", "Entrance to Bookseller"],
  ["'", "An open door", "5", "Entrance to Alchemy Shop"],
  ["'", "A broken door", "6", "Entrance to Magic Shop"],
  ["<", "A staircase up", "7", "Entrance to the Black Market"],
  [">", "A staircase down", "8", "Entrance to your Home"],
  ["#", "A pool of lava"],
];

const FEATURES_BLOCK_LOS: readonly GlyphRow[] = [
  ["#", "A secret door", "#", "A wall"],
  ["+", "A closed door", "%", "A mineral vein"],
  ["+", "A locked door", "*", "A mineral vein with treasure"],
  [":", "A pile of rubble", ":", "A pile of passable rubble"],
];

const OBJECTS: readonly GlyphRow[] = [
  ["!", "A potion (or flask)", "/", "A pole-arm"],
  ["?", "A scroll (or book)", "|", "An edged weapon"],
  [",", "A mushroom (or food)", "\\", "A hafted weapon"],
  ["-", "A wand or rod", "}", "A sling, bow, or x-bow"],
  ["_", "A staff", "{", "A shot, arrow, or bolt"],
  ["=", "A ring", "(", "Soft armour"],
  ['"', "An amulet", "[", "Hard armour"],
  ["$", "Gold or gems", "]", "Misc. armour"],
  ["~", "Lights, Tools, Chests, etc", ")", "A shield"],
  ["&", "Multiple items"],
];

/**
 * symbols.txt:64-90.
 *
 * `x` IS UNBOUND AND `X` IS THE XORN, which is the fix this transcription
 * carries: the flattened list this replaced had dropped upstream's two `-` rows
 * (`N` and `x`) and, in doing so, moved "Xorn/Xaren" onto the lowercase `x` it
 * had left behind. monster_base.txt gives the xorn `glyph:X`, so the page was
 * naming a letter the game never draws for it.
 */
const MONSTERS: readonly GlyphRow[] = [
  ["$", "Creeping Coins", ",", "Mushroom Patch"],
  ["a", "Giant Ant", "A", "Ainu"],
  ["b", "Giant Bat", "B", "Bird"],
  ["c", "Giant Centipede", "C", "Canine (Dog)"],
  ["d", "Dragon", "D", "Ancient Dragon"],
  ["e", "Floating Eye", "E", "Elemental"],
  ["f", "Feline (Cat)", "F", "Dragon Fly"],
  ["g", "Golem", "G", "Ghost"],
  ["h", "Humanoid", "H", "Hybrid"],
  ["i", "Icky-Thing", "I", "Insect"],
  ["j", "Jelly", "J", "Snake"],
  ["k", "Kobold", "K", "Killer Beetle"],
  ["l", "Tree/Ent", "L", "Lich"],
  ["m", "Mold", "M", "Multi-Headed Hydra"],
  ["n", "Naga", "N", "-"],
  ["o", "Orc", "O", "Ogre"],
  ["p", 'Human "person"', "P", 'Giant "person"'],
  ["q", "Quadruped", "Q", "Quylthulg (Pulsing Flesh Mound)"],
  ["r", "Rodent", "R", "Reptile/Amphibian"],
  ["s", "Skeleton", "S", "Spider/Scorpion/Tick"],
  ["t", "Townsperson", "T", "Troll"],
  ["u", "Minor Demon", "U", "Major Demon"],
  ["v", "Vortex", "V", "Vampire"],
  ["w", "Worm or Worm Mass", "W", "Wight/Wraith"],
  ["x", "-", "X", "Xorn/Xaren"],
  ["y", "Yeek", "Y", "Yeti"],
  ["z", "Zombie/Mummy", "Z", "Zephyr Hound"],
];

/**
 * symbols.txt's row: the glyph in a field three wide, then what it is, then the
 * same pair again. NO INDENT: unlike commands.txt, this file starts its rows at
 * column 0.
 *
 * TWO WIDTHS, because the file has two. The feature and object tables put the
 * second glyph at column 33; the monster table, whose descriptions are shorter,
 * puts it at 30. Declaring one width for both would move every right-hand
 * column on one of the two.
 *
 * THE GLYPH IS ITS OWN CELL, which is the whole reason this page was worth
 * modelling. `cells.glyph.text` is one character, so a tileset mod draws the
 * sprite it already draws on the map for that symbol and the legend stops being
 * a page of letters. No colour is published on it: the terminal paints this page
 * in one colour, and a cell colour would make the row emit per-run colours and
 * change what the player sees on a page parity pins.
 *
 * WHAT THE SECTION HEADINGS GAVE UP, said here rather than left to be found: a
 * `caption` is one run above the rows, so the row of dashes upstream rules each
 * heading with, and the blank line after it, are not printed. A caption is what
 * a presenter reads to label a group; a row of hyphens underneath it is the
 * terminal drawing a box, and there is nowhere in the model between the two for
 * it to live. The commands page gave up its own "Original Keyset Command
 * Summary" heading the same way, to the screen title, which is the one place a
 * player can see which keyset they are reading before they scroll.
 *
 * This is accepted rather than a gap to close: front-end presentation has
 * latitude for a minor difference like a decorative rule without counting as a
 * parity deviation, and the caption model would have to stop being a caption to
 * regain a line that draws nothing else.
 */
function symbolColumns(descWidth: number): readonly ScreenColumn[] {
  return [
    { key: "glyph", width: 3 },
    { key: "desc", width: descWidth, gap: 0 },
    { key: "glyph2", width: 3, gap: 0 },
    { key: "desc2", gap: 0 },
  ];
}

const SYMBOL_SECTIONS: readonly {
  key: string;
  caption: string;
  descWidth: number;
  glyphs: readonly GlyphRow[];
}[] = [
  {
    key: "features-open",
    caption: "Features that do not block line of sight",
    descWidth: 30,
    glyphs: FEATURES_NO_LOS,
  },
  {
    key: "features-wall",
    caption: "Features that block line of sight",
    descWidth: 30,
    glyphs: FEATURES_BLOCK_LOS,
  },
  { key: "objects", caption: "Objects", descWidth: 30, glyphs: OBJECTS },
  { key: "monsters", caption: "Monsters", descWidth: 27, glyphs: MONSTERS },
];

/**
 * symbols.txt:4-19, on `lines` and staying there.
 *
 * UPSTREAM ALREADY LAID THIS OUT. lib/help/symbols.txt is a fixed-width file
 * that show_file prints row by row, so its breaks are not a rendering of a
 * paragraph - they ARE the document, and this port transcribes them. Publishing
 * it as an unwrapped `text` block would hand a presenter something to re-flow at
 * the price of moving every break on the faithful terminal, on the one page
 * where parity owns the layout. That is the trade the guide and community pages
 * are allowed to make (nothing upstream wrote them) and this one is not.
 *
 * ONE WORD CHANGED. Upstream ends the `/` sentence with "(see 'commands.txt')",
 * a filename this port has nothing to open - the help files are transcribed, not
 * shipped - so it names the page instead. Everything else, including the two
 * paragraphs a curated version of this page used to drop, is the file's own
 * text: '/' identifies a symbol here (main.ts binds `querySymbolCmd`) and user
 * pref files load here (prefs-ui.ts over the virtual ANGBAND_DIR_USER), so both
 * sentences are as true of this build as of upstream's.
 *
 * The trailing blank belongs to the block for the same reason a table's
 * `gapAfter` does: it is the separation before the first section, and a `lines`
 * block passes its rows through untouched.
 */
const SYMBOL_INTRO: readonly ScreenLine[] = [
  { text: "Symbols on your map can be broken down into three categories: Features of", color: FG },
  { text: "the dungeon such as walls, floor, doors, and traps; Objects which can be", color: FG },
  { text: "picked up such as treasure, weapons, magical devices, etc; and creatures", color: FG },
  { text: "which may or may not move about the dungeon, but are mostly harmful to your", color: FG },
  { text: "character's well being.", color: FG },
  { text: "", color: FG },
  { text: "Some symbols are used to represent more than one type of entity, and some", color: FG },
  { text: 'symbols are used to represent entities in more than one category. The "@"', color: FG },
  { text: "symbol (by default) is used to represent the character.", color: FG },
  { text: "", color: FG },
  { text: "It will not be necessary to remember all of the symbols and their meanings.", color: FG },
  { text: "The \"slash\" command ('/') will identify any character appearing on your", color: FG },
  { text: "map (see the commands page).", color: FG },
  { text: "", color: FG },
  { text: 'Note that you can use a "user pref file" to change any of these symbols to', color: FG },
  { text: "something you are more comfortable with.", color: FG },
  { text: "", color: FG },
];

/** symbols.txt (intro + the four glyph tables) as `core:help-symbols`. */
export function helpSymbolsScreen(
  title = t("help.symbols.title", "Angband Help - Symbols"),
): ScreenView {
  const blocks: ScreenBlock[] = [{ kind: "lines", lines: SYMBOL_INTRO }];
  SYMBOL_SECTIONS.forEach((section, i) => {
    blocks.push({
      kind: "table",
      key: section.key,
      tagged: false,
      caption: { text: section.caption, color: LABEL },
      columns: symbolColumns(section.descWidth),
      rows: section.glyphs.map((row) => ({
        cells: {
          glyph: { text: row[0] },
          desc: { text: row[1] },
          ...(row.length === 4 ? { glyph2: { text: row[2] }, desc2: { text: row[3] } } : {}),
        },
      })),
      /* The page ends on the last monster: no blank row after the last table. */
      ...(i === SYMBOL_SECTIONS.length - 1 ? {} : { gapAfter: 1 }),
    });
  });
  return freezeView({ id: "core:help-symbols", title, footer: SCREEN_FOOTER, blocks });
}

/** The faithful terminal's rows for `helpSymbolsScreen`. */
export function helpSymbolLines(cols = 80): ScreenLine[] {
  return screenBodyLines(helpSymbolsScreen(), cols);
}

/* ------------------------------------------------------------------ */
/* The two port-addition pages                                         */
/* ------------------------------------------------------------------ */

/**
 * A short orientation page (`core:help-guide`). New prose (index.txt's own intro
 * is a pointer to the online docs, not a playing guide), but every claim here is
 * something this port actually does - no invented mechanics.
 *
 * UNWRAPPED, unlike the symbols page above it, and the difference is whose text
 * it is. There is no upstream file whose breaks this has to reproduce, so the
 * paragraphs are published whole and the wrap belongs to whoever is drawing:
 * `screenBodyLines` for the faithful terminal, a mod's own measurement for a
 * panel of its own width. The visible cost is that the terminal's line breaks
 * are no longer the ones typed in here - the words and their order are the same.
 */
export function helpGuideScreen(
  title = t("help.guide.title", "Angband Help - Playing Guide"),
): ScreenView {
  return freezeView({
    id: "core:help-guide",
    title,
    footer: SCREEN_FOOTER,
    blocks: [
      {
        kind: "text",
        color: FG,
        paragraphs: [
          [
            {
              text:
                "You are the @ on the map. Move with the numpad or arrow keys; " +
                "walking into a monster attacks it.",
            },
          ],
          [],
          [
            {
              text:
                "The town has eight numbered shops (1-8, see the Symbols page). " +
                "Walk onto a shop's entrance tile to go inside and trade.",
            },
          ],
          [],
          [
            {
              text:
                "'>' descends a staircase, '<' climbs back up. The dungeon gets " +
                "more dangerous with depth - explore carefully, and retreat when hurt.",
            },
          ],
          [],
          [
            {
              text:
                "Death is permanent - there is no save-scumming. When your character " +
                "falls, 'N' rolls a new one into the same save slot.",
            },
          ],
          [],
          [{ text: "Press '?' any time to come back to this help." }],
        ],
      },
    ],
  });
}

/** The faithful terminal's rows for `helpGuideScreen`. */
export function helpGuideLines(cols = 80): ScreenLine[] {
  return screenBodyLines(helpGuideScreen(), cols);
}

/**
 * A way out of the game, as data: the address, and what is at the end of it.
 *
 * A TABLE rather than three more lines of prose, because three routes with an
 * address each is a list, and a list on `lines` is work not yet done. A presenter
 * reads `cells.address.text` and can draw a button; the terminal reads the same
 * cell and indents it four columns, which is what this page has always printed.
 * `what` is empty on two of the three, so its column collapses and the trailing
 * gap is cut - the same rule an empty weight cell already relies on.
 */
const ROUTE_COLUMNS: readonly ScreenColumn[] = [
  { key: "indent", width: 4 },
  { key: "address", gap: 0 },
  { key: "what", gap: 8 },
];

function routeTable(
  key: string,
  caption: string,
  address: string,
  what?: string,
): ScreenTableBlock {
  return {
    kind: "table",
    key,
    tagged: false,
    caption: { text: caption, color: GOLD },
    columns: ROUTE_COLUMNS,
    rows: [
      {
        id: key,
        cells: {
          address: { text: address },
          ...(what === undefined ? {} : { what: { text: what } }),
        },
      },
    ],
    gapAfter: 1,
  };
}

/**
 * Where to get help from a person, and where to say something is wrong
 * (`core:help-community`).
 *
 * A PORT ADDITION, like the playing guide above it, and for a plainer reason
 * than that one: this is an alpha whose whole point is that people report what
 * they find, and every route to doing so lived in a README that a player who
 * downloaded a build has never opened. `?` is where someone goes when they are
 * stuck, so `?` is where the answer belongs.
 *
 * The prose is unwrapped for the same reason the guide's is - nothing upstream
 * wrote it, so the wrap is the renderer's. The three routes are a table; see
 * `ROUTE_COLUMNS`.
 *
 * The address is written the long way round on purpose - a person reads it, a
 * scraper walking the page does not.
 */
export function helpCommunityScreen(
  title = t("help.community.title", "Neo Angband - Help and reporting"),
): ScreenView {
  return freezeView({
    id: "core:help-community",
    title,
    footer: SCREEN_FOOTER,
    blocks: [
      {
        kind: "text",
        color: FG,
        paragraphs: [
          [{ text: `You are playing Neo Angband ${ENGINE_VERSION}, a port of Angband 4.2.6.` }],
          [],
          [
            {
              text:
                "It is ALPHA. It plays start to finish and it is not finished, and " +
                "the things still wrong with it are mostly things only playing finds: " +
                "a message the original prints that this one does not, a screen laid " +
                "out a column off, a prompt that never appears.",
            },
          ],
        ],
      },
      blankRow(),
      routeTable(
        "discord",
        "Ask anyone, about anything:",
        "discord.gg/YegtwbHTBQ",
        "the RPGM Tools Discord",
      ),
      routeTable(
        "issues",
        "Report something wrong:",
        "github.com/neostryder/neo-angband/issues",
      ),
      {
        kind: "text",
        color: FG,
        paragraphs: [
          [
            {
              text:
                "The most useful report says what the original does and what this " +
                "does. You do not need a copy of Angband to hand - describing what " +
                "you expected is plenty. Say which version (above), and whether any " +
                "mods were on; '=' shows them, and turning the game into something " +
                "else is what a mod is for, so that line saves a wasted round trip.",
            },
          ],
        ],
      },
      blankRow(),
      routeTable(
        "private",
        "Anything that should not be public, security included:",
        "strider-angband (at) rpgm.tools",
      ),
      {
        kind: "text",
        color: FG,
        paragraphs: [
          [
            {
              text:
                "Your characters are safe across updates. Every change to the save " +
                "format ships the conversion that reads the one before it, and a save " +
                "the game cannot open is left alone rather than replaced.",
            },
          ],
        ],
      },
    ],
  });
}

/** The faithful terminal's rows for `helpCommunityScreen`. */
export function helpCommunityLines(cols = 80): ScreenLine[] {
  return screenBodyLines(helpCommunityScreen(), cols);
}

/* ------------------------------------------------------------------ */
/* The index                                                           */
/* ------------------------------------------------------------------ */

/** One page shown by the help index. */
interface HelpPage {
  /**
   * The whole screen, built PER OPEN rather than captured: a locale can be
   * changed while the game runs, and the title lives inside the view.
   */
  view: () => ScreenView;
}

/**
 * The index.txt menu model (ui-help.c's ".. menu::" tree, expressed directly
 * instead of parsed from RST directives). Order matches index.txt:9-11 plus
 * the added playing guide.
 */
/**
 * Help pages a mod supplied (MOD_REACH gap 7's `help` resource), keyed by the
 * resource's `slot`.
 *
 * A slot matching one of core's REPLACES that page; any other ADDS one at the
 * end. Both are wanted and neither can be the only rule: a total conversion
 * whose commands are not Angband's needs the commands page to be wrong-headed
 * about its own game, and a mod adding one system needs a page for it without
 * touching the four that are right.
 *
 * The core ids are spelled here rather than derived from the labels because a
 * LABEL is display text - it is the thing a localization changes - and keying a
 * replacement on it would make "which page is this" depend on what language the
 * player is reading. The ids are the stable name; see MOD_REACH gap 14.
 */
const modPages = new Map<string, { label: string; lines: readonly ScreenLine[] }>();

/** Install (or, with an empty list, clear) the mod-supplied help pages. */
export function setModHelpPages(
  pages: readonly { slot: string; label: string; lines: readonly ScreenLine[] }[],
): void {
  modPages.clear();
  for (const p of pages) modPages.set(p.slot, { label: p.label, lines: p.lines });
}

/**
 * Turn a mod's plain `.txt` into help lines.
 *
 * PLAIN, deliberately: core's own pages carry per-run colouring built by code,
 * and inventing a markup for a mod to reproduce it would be a second text format
 * for this project to own. A help page is prose; prose in one colour is what
 * upstream's own lib/help/*.txt amounts to once the RST directives are gone.
 */
export function helpLinesFromText(text: string): ScreenLine[] {
  return text.split("\n").map((line) => ({ text: line.replace(/\r$/u, ""), color: FG }));
}

/**
 * A mod's page as a screen: `core:text`, the UNMODELLED id, even when it is
 * sitting in the slot of a page core has modelled.
 *
 * WHY IT DOES NOT INHERIT CORE'S ID. What arrives is `helpLinesFromText`'s
 * output - a `.txt` split on newlines, already wrapped by whoever wrote it, with
 * no columns to address, no paragraph breaks to re-flow and no key or glyph to
 * publish. Giving it `core:help-symbols` would promise a presenter the model
 * that id stands for and then hand it a `lines` block: a tileset mod matching on
 * `core:help-symbols` to draw sprites would find no glyph cells and draw an
 * empty legend, and it would have no way to tell that from a legend with nothing
 * in it. `core:text` states exactly what is true - pre-wrapped prose, a frame to
 * reskin and nothing to reimagine - which is what `UNMODELLED_SCREEN` is for.
 *
 * The alternative that lost was core's id with a `lines` block inside it. It
 * reads tidier from the index, and it makes the id stop predicting the blocks,
 * which is the one thing a screen id is worth anything for.
 *
 * A mod that wants its page REIMAGINED already has the better route: its own
 * `screen` presenter, which sees every view including this one.
 */
function modPageView(label: string, lines: readonly ScreenLine[]): ScreenView {
  return linesScreen(label, lines, SCREEN_FOOTER);
}

/** Core's own pages, then a mod's, with a mod's replacement swapped in place. */
function helpIndex(roguelike: boolean): readonly { label: string; page: HelpPage }[] {
  const core = coreHelpIndex(roguelike);
  if (modPages.size === 0) return core;
  const seen = new Set<string>();
  const out = core.map((entry) => {
    const supplied = modPages.get(entry.id);
    if (supplied === undefined) return entry;
    seen.add(entry.id);
    return {
      ...entry,
      label: supplied.label,
      page: { view: () => modPageView(supplied.label, supplied.lines) },
    };
  });
  for (const [slot, supplied] of modPages) {
    if (seen.has(slot)) continue;
    out.push({
      id: slot,
      label: supplied.label,
      page: { view: () => modPageView(supplied.label, supplied.lines) },
    });
  }
  return out;
}

/** The ids core's own pages answer to, so a mod knows what it can replace. */
export function coreHelpPageIds(): string[] {
  return coreHelpIndex(false).map((e) => e.id);
}

/** The index's row labels, so a test can assert a page is reachable at all. */
export function helpIndexLabels(roguelike = false): string[] {
  return helpIndex(roguelike).map((e) => e.label);
}

/**
 * index.txt:1-4 / r_index.txt:1-4, condensed to the one line the menu has room
 * for.
 *
 * WHY IT IS HERE AT ALL. Upstream's index files are four fifths pointer: this is
 * a short reference, and the manual is at readthedocs. The port had moved the
 * address onto the foot of the commands page, where upstream's commands.txt has
 * no such line and where a player who wanted the manual would have to scroll 56
 * rows to find it. `selectFromMenu` publishes one subtitle row, so the sentence
 * is upstream's two joined into one rather than its four lines transcribed.
 */
function indexSubtitle(): string {
  return t(
    "help.index.subtitle",
    "A short in-game reference. Full manual: angband.readthedocs.io/en/latest/",
  );
}

/**
 * `id` is the name a mod's `help` resource names in its `slot` to REPLACE a
 * page. Stable and separate from `label`, which is display text and therefore
 * the thing a translation changes.
 */
/**
 * THE LABELS AND TITLES GO THROUGH `t` (MOD_REACH gap 14), and the English
 * beside each id is the string that used to be written here - so with no locale
 * installed this file prints exactly what it printed before.
 *
 * A FUNCTION rather than a constant, because a locale is chosen at boot and can
 * be changed while the game runs: a `const` array would freeze whichever
 * language happened to be active when this module was first imported. The ids
 * are `help.<page>.label` and `.title`, which is also why HELP_INDEX carries an
 * `id` - a mod REPLACING a page keys on that id, and keying on the label would
 * make "which page is this" depend on what language the player is reading.
 *
 * The title is not spelled here any more: it belongs to the VIEW, which carries
 * its own, and a title written twice is two transcriptions.
 *
 * THE TWO UPSTREAM LABELS ARE index.txt's OWN ("Available commands", line 9,
 * and "Available symbols", line 10). The second used to read "Symbols on your
 * map", which is symbols.txt's internal heading rather than the word the index
 * offers, and the index is the screen a player is choosing from.
 */
function coreHelpIndex(
  roguelike: boolean,
): readonly { id: string; label: string; page: HelpPage }[] {
  return [
    {
      id: "commands",
      label: t("help.commands.label", "Available commands"),
      page: { view: () => helpCommandsScreen(roguelike) },
    },
    {
      id: "symbols",
      label: t("help.symbols.label", "Available symbols"),
      page: { view: helpSymbolsScreen },
    },
    {
      id: "guide",
      label: t("help.guide.label", "Playing guide"),
      page: { view: helpGuideScreen },
    },
    {
      id: "community",
      label: t("help.community.label", "Help, and reporting something wrong"),
      page: { view: helpCommunityScreen },
    },
  ];
}

/**
 * The help modal (do_cmd_help, ui-help.c:470). Loops the index
 * (selectFromMenu) -> the chosen page (showTextScreen) -> back to the index,
 * exactly the show_file recursion (ui-help.c:337-453), resolving when ESC is
 * pressed at the index. Pure display: no RNG, no state mutation, no turn.
 *
 * `roguelike` is `rogue_like_commands`, and it is what upstream's do_cmd_help
 * uses too: it opens r_index.txt rather than index.txt when the option is on,
 * and the only difference between those two files is that one links r_comm.txt
 * and the other commands.txt. A caller with no game state (the title screen's
 * help, a test) leaves it at the option's own default.
 */
export async function runHelp(
  term: GridSurface & GridPointerInput,
  roguelike = false,
): Promise<void> {
  for (;;) {
    /* Read PER OPEN, not captured: the list is core's plus whatever the enabled
     * mods supplied, and the mod pages are latched during boot. */
    const index = helpIndex(roguelike);
    const pick = await selectFromMenu(
      term,
      "core:help-index",
      t("help.index.title", "Angband Help"),
      index.map((entry) => ({ label: entry.label })),
      t("help.index.footer", "[ a-z to choose, ESC to exit ]"),
      { subtitle: indexSubtitle() },
    );
    if (pick === null) return;
    const entry = index[pick];
    if (!entry) continue;
    await showTextScreen(term, entry.page.view());
  }
}
