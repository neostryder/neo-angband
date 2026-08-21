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
 * CONTENT: the raw lib/help/*.txt files are not fetched or bundled verbatim.
 * commands.txt documents the FULL original Angband keyset, including many
 * commands this shell does not implement (screen dump ')', notes ':',
 * options '=' in the upstream sense, rest 'R', knowledge '~', wizard mode)
 * and omits web-native ones (Ctrl-P message history, Escape game menu, the
 * touch action bar) - a verbatim dump would actively mislead the player. The
 * command reference below is curated to list ONLY the shell's real key
 * bindings (kept in sync with main.ts's keydown handler), grouped the way
 * commands.txt groups them. The symbols page stays near-verbatim from
 * symbols.txt - those glyphs are base-Angband canonical and match this
 * port's feature/object/monster registries - minus the "/ identifies a
 * symbol" and "user pref file" lines, since neither exists in this shell yet.
 * The playing-guide page is new, short orientation prose (no invented
 * mechanics: it only states things this port actually does - permadeath,
 * shops 1-8, stairs).
 *
 * EACH PAGE IS A `ScreenView`, not a hand-laid `ScreenLine[]`. The two
 * reference pages are LISTS - a key and what it does, a glyph and what it is -
 * and a list on `lines` is work not yet done (see screen-view.ts's header). So
 * each section is a `table` with a caption, the key or the glyph is its own
 * cell, and a tileset mod can draw the sprite for `k` where the terminal draws
 * the letter. Nothing about what the terminal prints moved: `help.test.ts`
 * pins the commands and symbols pages against the bytes they printed before
 * the model existed, because both are near-verbatim upstream and parity owns
 * their layout.
 *
 * The two PORT-ADDITION pages went the other way. The playing guide and the
 * community page have no upstream text to be faithful to, so their prose is
 * published UNWRAPPED - which is the only form a presenter can lay out at its
 * own width - and the faithful terminal now wraps it itself rather than
 * printing breaks that were typed in by hand.
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
 * commands.txt's row: two columns of indent, the key in a field eleven wide,
 * then what it does.
 *
 * THE INDENT IS A COLUMN because a table's first column starts at column 0 -
 * `gapBefore` ignores `gap` on it - and both alternatives lost something real.
 * Two spaces baked into the key cell would hand a presenter `"  g"` where the
 * key is `"g"`, which is the padded-field problem the whole model exists to
 * end. `tagged: true` writes a three-column `"x) "` prefix, which is one column
 * too many and offers a letter this page does not answer to.
 */
const COMMAND_COLUMNS: readonly ScreenColumn[] = [
  { key: "indent", width: 2 },
  { key: "key", width: 11, gap: 0 },
  { key: "desc", gap: 0 },
];

/** One group of the reference: its heading, and the rows under it. */
interface HelpSection {
  /** Stable identity for the table within its screen; see `ScreenTableBlock.key`. */
  readonly key: string;
  /** The heading commands.txt prints above the group. */
  readonly caption: string;
  /** `[key, description]` pairs, in source reading order. */
  readonly rows: readonly (readonly [string, string])[];
}

/**
 * Curated command reference (commands.txt's layout, this shell's real keys).
 * Every key here corresponds to a live branch in main.ts's keydown handler
 * or keymap.ts's resolveKey - see help.test.ts's drift guard, which checks
 * this list against main.ts's source so the reference cannot silently rot.
 */
const COMMAND_SECTIONS: readonly HelpSection[] = [
  {
    key: "movement",
    caption: "Movement",
    rows: [
      ["1-9", "Walk (numpad; diagonals need the numpad)"],
      ["Arrows", "Walk orthogonally (up/down/left/right)"],
      ["(walk in)", "Walking onto a shop entrance enters the store"],
    ],
  },
  {
    key: "items",
    caption: "Items",
    rows: [
      ["g", "Get objects on the floor"],
      ["i", "List contents of pack"],
      ["e", "List equipped items"],
      ["]", "List objects you can see"],
      ["w", "Wear/wield equipment"],
      ["t", "Take off equipment"],
      ["d", "Drop an item"],
      ["{", "Inscribe an object"],
      ["}", "Uninscribe an object"],
      ["F", "Fuel your lantern/torch"],
      ["I", "Inspect an item"],
      ["K", "Toggle ignoring off"],
    ],
  },
  {
    key: "magic",
    caption: "Magic",
    rows: [
      ["m / p", "Cast a spell / recite a prayer"],
      ["G", "Gain (study) new spells/prayers"],
    ],
  },
  {
    key: "devices",
    caption: "Devices",
    rows: [
      ["q", "Quaff a potion"],
      ["r", "Read a scroll"],
      ["E", "Eat some food"],
      ["u", "Use a staff"],
      ["a", "Aim a wand"],
      ["z", "Zap a rod"],
      ["A", "Activate an item"],
    ],
  },
  {
    key: "combat",
    caption: "Combat & targeting",
    rows: [
      ["f", "Fire ammo at a target"],
      ["v", "Throw an item"],
      ["o", "Open a door or chest"],
      ["D", "Disarm a trap or lock a door"],
      ["*", "Target a monster or location"],
      ["'", "Target the closest monster"],
      ["l / x", "Look around"],
    ],
  },
  {
    key: "meta",
    caption: "Meta",
    rows: [
      ["=", "Options menu (interface/birth toggles, ignore setup)"],
      ["M", "Display map of entire level"],
      ["L", "Locate player on map"],
      ["C", "Character description"],
      ["S", "Save the game"],
      ["N", "New character (also available after death)"],
      ["V", "Display the hall of fame"],
      ["Ctrl-P", "Show previous messages"],
      ["Enter", "Browse every command by category"],
      ["?", "Display this help"],
      ["Escape", "Game menu (save / switch / new character)"],
    ],
  },
];

/** One command group as a captioned table; `gapAfter` is the blank before the next. */
function commandTable(section: HelpSection, gapAfter: number): ScreenTableBlock {
  return {
    kind: "table",
    key: section.key,
    tagged: false,
    caption: { text: section.caption, color: LABEL },
    columns: COMMAND_COLUMNS,
    rows: section.rows.map(([key, desc]) => ({
      cells: { key: { text: key }, desc: { text: desc } },
    })),
    ...(gapAfter === 0 ? {} : { gapAfter }),
  };
}

/**
 * The command reference as a screen (`core:help-commands`).
 *
 * The intro and the closing pointer are prose the port wrote, so they are `text`
 * blocks and the terminal wraps them; both fit an 80-column line whole, which is
 * why routing them through the wrap changed nothing the player sees.
 */
export function helpCommandsScreen(
  title = t("help.commands.title", "Angband Help - Commands"),
): ScreenView {
  const blocks: ScreenBlock[] = [
    {
      kind: "text",
      color: DIM,
      paragraphs: [[{ text: "Original keyset - only the commands this port implements." }]],
    },
    blankRow(),
  ];
  for (const section of COMMAND_SECTIONS) blocks.push(commandTable(section, 1));
  blocks.push({
    kind: "text",
    color: DIM,
    paragraphs: [[{ text: "More commands online: angband.readthedocs.io" }]],
  });
  return freezeView({ id: "core:help-commands", title, footer: SCREEN_FOOTER, blocks });
}

/** The faithful terminal's rows for `helpCommandsScreen`. */
export function helpCommandLines(cols = 80): ScreenLine[] {
  return screenBodyLines(helpCommandsScreen(), cols);
}

/* ------------------------------------------------------------------ */
/* The symbol legend                                                   */
/* ------------------------------------------------------------------ */

/** [glyph, description] pairs for one symbols.txt table, in source reading order. */
type Glyphs = readonly (readonly [string, string])[];

const FEATURES_NO_LOS: Glyphs = [
  [".", "A floor space"],
  [".", "A trap (hidden)"],
  ["1", "Entrance to General Store"],
  ["^", "A trap (known)"],
  ["2", "Entrance to Armoury"],
  [";", "A glyph of warding"],
  ["3", "Entrance to Weapon Smith"],
  ["'", "An open door"],
  ["4", "Entrance to Bookseller"],
  ["'", "A broken door"],
  ["5", "Entrance to Alchemy Shop"],
  ["<", "A staircase up"],
  ["6", "Entrance to Magic Shop"],
  [">", "A staircase down"],
  ["7", "Entrance to the Black Market"],
  ["#", "A pool of lava"],
  ["8", "Entrance to your Home"],
];

const FEATURES_BLOCK_LOS: Glyphs = [
  ["#", "A secret door"],
  ["#", "A wall"],
  ["+", "A closed door"],
  ["%", "A mineral vein"],
  ["+", "A locked door"],
  ["*", "A mineral vein with treasure"],
  [":", "A pile of rubble"],
  [":", "A pile of passable rubble"],
];

const OBJECTS: Glyphs = [
  ["!", "A potion (or flask)"],
  ["/", "A pole-arm"],
  ["?", "A scroll (or book)"],
  ["|", "An edged weapon"],
  [",", "A mushroom (or food)"],
  ["\\", "A hafted weapon"],
  ["-", "A wand or rod"],
  ["}", "A sling, bow, or x-bow"],
  ["_", "A staff"],
  ["{", "A shot, arrow, or bolt"],
  ["=", "A ring"],
  ["(", "Soft armour"],
  ['"', "An amulet"],
  ["[", "Hard armour"],
  ["$", "Gold or gems"],
  ["]", "Misc. armour"],
  ["~", "Lights, Tools, Chests, etc"],
  [")", "A shield"],
  ["&", "Multiple items"],
];

const MONSTERS: Glyphs = [
  ["$", "Creeping Coins"],
  [",", "Mushroom Patch"],
  ["a", "Giant Ant"],
  ["A", "Ainu"],
  ["b", "Giant Bat"],
  ["B", "Bird"],
  ["c", "Giant Centipede"],
  ["C", "Canine (Dog)"],
  ["d", "Dragon"],
  ["D", "Ancient Dragon"],
  ["e", "Floating Eye"],
  ["E", "Elemental"],
  ["f", "Feline (Cat)"],
  ["F", "Dragon Fly"],
  ["g", "Golem"],
  ["G", "Ghost"],
  ["h", "Humanoid"],
  ["H", "Hybrid"],
  ["i", "Icky-Thing"],
  ["I", "Insect"],
  ["j", "Jelly"],
  ["J", "Snake"],
  ["k", "Kobold"],
  ["K", "Killer Beetle"],
  ["l", "Tree/Ent"],
  ["L", "Lich"],
  ["m", "Mold"],
  ["M", "Multi-Headed Hydra"],
  ["n", "Naga"],
  ["o", "Orc"],
  ["O", "Ogre"],
  ["p", 'Human "person"'],
  ["P", 'Giant "person"'],
  ["q", "Quadruped"],
  ["Q", "Quylthulg (Pulsing Flesh Mound)"],
  ["r", "Rodent"],
  ["R", "Reptile/Amphibian"],
  ["s", "Skeleton"],
  ["S", "Spider/Scorpion/Tick"],
  ["t", "Townsperson"],
  ["T", "Troll"],
  ["u", "Minor Demon"],
  ["U", "Major Demon"],
  ["v", "Vortex"],
  ["V", "Vampire"],
  ["w", "Worm or Worm Mass"],
  ["W", "Wight/Wraith"],
  ["x", "Xorn/Xaren"],
  ["y", "Yeek"],
  ["Y", "Yeti"],
  ["z", "Zombie/Mummy"],
  ["Z", "Zephyr Hound"],
];

/**
 * symbols.txt's row: two columns of indent, the glyph in a field four wide,
 * then what it is. See `COMMAND_COLUMNS` on why the indent is a column.
 *
 * THE GLYPH IS ITS OWN CELL, which is the whole reason this page was worth
 * modelling. `cells.glyph.text` is one character, so a tileset mod draws the
 * sprite it already draws on the map for that symbol and the legend stops being
 * a page of letters. No colour is published on it: the terminal paints this page
 * in one colour, and a cell colour would make the row emit per-run colours and
 * change what the player sees on a page parity pins.
 */
const SYMBOL_COLUMNS: readonly ScreenColumn[] = [
  { key: "indent", width: 2 },
  { key: "glyph", width: 4, gap: 0 },
  { key: "desc", gap: 0 },
];

const SYMBOL_SECTIONS: readonly { key: string; caption: string; glyphs: Glyphs }[] = [
  {
    key: "features-open",
    caption: "Features that do not block line of sight",
    glyphs: FEATURES_NO_LOS,
  },
  {
    key: "features-wall",
    caption: "Features that block line of sight",
    glyphs: FEATURES_BLOCK_LOS,
  },
  { key: "objects", caption: "Objects", glyphs: OBJECTS },
  { key: "monsters", caption: "Monsters", glyphs: MONSTERS },
];

/**
 * symbols.txt's opening prose, on `lines` and staying there.
 *
 * UPSTREAM ALREADY LAID THIS OUT. lib/help/symbols.txt is a fixed-width file
 * that show_file prints row by row, so its breaks are not a rendering of a
 * paragraph - they ARE the document, and this port transcribes them. Publishing
 * it as an unwrapped `text` block would hand a presenter something to re-flow at
 * the price of moving every break on the faithful terminal, on the one page
 * where parity owns the layout. That is the trade the guide and community pages
 * are allowed to make (nothing upstream wrote them) and this one is not.
 *
 * The trailing blank belongs to the block for the same reason a table's
 * `gapAfter` does: it is the separation before the first section, and a `lines`
 * block passes its rows through untouched.
 */
const SYMBOL_INTRO: readonly ScreenLine[] = [
  { text: "Symbols on your map fall into three categories: features of the", color: FG },
  { text: "dungeon such as walls, floors, doors, and traps; objects that can", color: FG },
  { text: "be picked up such as treasure, weapons, and magical devices; and", color: FG },
  { text: "monsters, which may or may not move about, and are mostly harmful.", color: FG },
  { text: "", color: FG },
  { text: 'The "@" symbol (by default) represents your character.', color: FG },
  { text: "", color: FG },
];

/** Near-verbatim symbols.txt (intro + the four glyph tables) as `core:help-symbols`. */
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
      columns: SYMBOL_COLUMNS,
      rows: section.glyphs.map(([glyph, desc]) => ({
        cells: { glyph: { text: glyph }, desc: { text: desc } },
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
function helpIndex(): readonly { label: string; page: HelpPage }[] {
  const core = coreHelpIndex();
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
  return coreHelpIndex().map((e) => e.id);
}

/** The index's row labels, so a test can assert a page is reachable at all. */
export function helpIndexLabels(): string[] {
  return helpIndex().map((e) => e.label);
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
 */
function coreHelpIndex(): readonly { id: string; label: string; page: HelpPage }[] {
  return [
    {
      id: "commands",
      label: t("help.commands.label", "Available commands"),
      page: { view: helpCommandsScreen },
    },
    {
      id: "symbols",
      label: t("help.symbols.label", "Symbols on your map"),
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
 */
export async function runHelp(term: GridSurface & GridPointerInput): Promise<void> {
  for (;;) {
    /* Read PER OPEN, not captured: the list is core's plus whatever the enabled
     * mods supplied, and the mod pages are latched during boot. */
    const index = helpIndex();
    const pick = await selectFromMenu(
      term,
      "core:help-index",
      "Angband Help",
      index.map((entry) => ({ label: entry.label })),
      "[ a-z to choose, ESC to exit ]",
    );
    if (pick === null) return;
    const entry = index[pick];
    if (!entry) continue;
    await showTextScreen(term, entry.page.view());
  }
}
