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
 * All content is inlined as TS data (no runtime fetch of the .txt files),
 * satisfying the offline-PWA / self-contained build. Pure display: no RNG,
 * no game-state mutation, no turn spent, no autosave.
 */

import type { GridPointerInput, GridSurface } from "./term";
import { showTextScreen, selectFromMenu } from "./overlay";
import type { ScreenLine } from "./overlay";
import { UI_TEXT, UI_DIM, UI_GOLD } from "./ui-colors";
import { ENGINE_VERSION, t } from "@rpgm-tools/neo-angband-core";

const FG = UI_TEXT;
const DIM = UI_DIM;
const LABEL = UI_TEXT;
const GOLD = UI_GOLD;

/** One row: `key` padded to a fixed column, then its description. */
function keyLine(key: string, desc: string): ScreenLine {
  return { text: `  ${key.padEnd(11)}${desc}`, color: FG };
}

/** A blank spacer line followed by a section header, matching commands.txt's grouping. */
function header(text: string): ScreenLine[] {
  return [
    { text: "", color: FG },
    { text, color: LABEL },
  ];
}

/**
 * Curated command reference (commands.txt's layout, this shell's real keys).
 * Every key here corresponds to a live branch in main.ts's keydown handler
 * or keymap.ts's resolveKey - see help.test.ts's drift guard, which checks
 * this list against main.ts's source so the reference cannot silently rot.
 */
export function helpCommandLines(): ScreenLine[] {
  const lines: ScreenLine[] = [
    { text: "Original keyset - only the commands this port implements.", color: DIM },
  ];

  lines.push(...header("Movement"));
  lines.push(keyLine("1-9", "Walk (numpad; diagonals need the numpad)"));
  lines.push(keyLine("Arrows", "Walk orthogonally (up/down/left/right)"));
  lines.push(keyLine("(walk in)", "Walking onto a shop entrance enters the store"));

  lines.push(...header("Items"));
  lines.push(keyLine("g", "Get objects on the floor"));
  lines.push(keyLine("i", "List contents of pack"));
  lines.push(keyLine("e", "List equipped items"));
  lines.push(keyLine("]", "List objects you can see"));
  lines.push(keyLine("w", "Wear/wield equipment"));
  lines.push(keyLine("t", "Take off equipment"));
  lines.push(keyLine("d", "Drop an item"));
  lines.push(keyLine("{", "Inscribe an object"));
  lines.push(keyLine("}", "Uninscribe an object"));
  lines.push(keyLine("F", "Fuel your lantern/torch"));
  lines.push(keyLine("I", "Inspect an item"));
  lines.push(keyLine("K", "Toggle ignoring off"));

  lines.push(...header("Magic"));
  lines.push(keyLine("m / p", "Cast a spell / recite a prayer"));
  lines.push(keyLine("G", "Gain (study) new spells/prayers"));

  lines.push(...header("Devices"));
  lines.push(keyLine("q", "Quaff a potion"));
  lines.push(keyLine("r", "Read a scroll"));
  lines.push(keyLine("E", "Eat some food"));
  lines.push(keyLine("u", "Use a staff"));
  lines.push(keyLine("a", "Aim a wand"));
  lines.push(keyLine("z", "Zap a rod"));
  lines.push(keyLine("A", "Activate an item"));

  lines.push(...header("Combat & targeting"));
  lines.push(keyLine("f", "Fire ammo at a target"));
  lines.push(keyLine("v", "Throw an item"));
  lines.push(keyLine("o", "Open a door or chest"));
  lines.push(keyLine("D", "Disarm a trap or lock a door"));
  lines.push(keyLine("*", "Target a monster or location"));
  lines.push(keyLine("'", "Target the closest monster"));
  lines.push(keyLine("l / x", "Look around"));

  lines.push(...header("Meta"));
  lines.push(keyLine("=", "Options menu (interface/birth toggles, ignore setup)"));
  lines.push(keyLine("M", "Display map of entire level"));
  lines.push(keyLine("L", "Locate player on map"));
  lines.push(keyLine("C", "Character description"));
  lines.push(keyLine("S", "Save the game"));
  lines.push(keyLine("N", "New character (also available after death)"));
  lines.push(keyLine("V", "Display the hall of fame"));
  lines.push(keyLine("Ctrl-P", "Show previous messages"));
  lines.push(keyLine("Enter", "Browse every command by category"));
  lines.push(keyLine("?", "Display this help"));
  lines.push(keyLine("Escape", "Game menu (save / switch / new character)"));

  lines.push({ text: "", color: FG });
  lines.push({ text: "More commands online: angband.readthedocs.io", color: DIM });
  return lines;
}

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

function glyphLines(table: Glyphs): ScreenLine[] {
  return table.map(([glyph, desc]) => ({ text: `  ${glyph.padEnd(4)}${desc}`, color: FG }));
}

/** Near-verbatim symbols.txt (intro + the four glyph tables). */
export function helpSymbolLines(): ScreenLine[] {
  const lines: ScreenLine[] = [
    { text: "Symbols on your map fall into three categories: features of the", color: FG },
    { text: "dungeon such as walls, floors, doors, and traps; objects that can", color: FG },
    { text: "be picked up such as treasure, weapons, and magical devices; and", color: FG },
    { text: "monsters, which may or may not move about, and are mostly harmful.", color: FG },
    { text: "", color: FG },
    { text: 'The "@" symbol (by default) represents your character.', color: FG },
  ];
  lines.push(...header("Features that do not block line of sight"));
  lines.push(...glyphLines(FEATURES_NO_LOS));
  lines.push(...header("Features that block line of sight"));
  lines.push(...glyphLines(FEATURES_BLOCK_LOS));
  lines.push(...header("Objects"));
  lines.push(...glyphLines(OBJECTS));
  lines.push(...header("Monsters"));
  lines.push(...glyphLines(MONSTERS));
  return lines;
}

/**
 * A short orientation page. New prose (index.txt's own intro is a pointer to
 * the online docs, not a playing guide), but every claim here is something
 * this port actually does - no invented mechanics.
 */
export function helpGuideLines(): ScreenLine[] {
  return [
    { text: "You are the @ on the map. Move with the numpad or arrow keys;", color: FG },
    { text: "walking into a monster attacks it.", color: FG },
    { text: "", color: FG },
    { text: "The town has eight numbered shops (1-8, see the Symbols page).", color: FG },
    { text: "Walk onto a shop's entrance tile to go inside and trade.", color: FG },
    { text: "", color: FG },
    { text: "'>' descends a staircase, '<' climbs back up. The dungeon gets", color: FG },
    { text: "more dangerous with depth - explore carefully, and retreat when hurt.", color: FG },
    { text: "", color: FG },
    { text: "Death is permanent - there is no save-scumming. When your character", color: FG },
    { text: "falls, 'N' rolls a new one into the same save slot.", color: FG },
    { text: "", color: FG },
    { text: "Press '?' any time to come back to this help.", color: FG },
  ];
}

/**
 * Where to get help from a person, and where to say something is wrong.
 *
 * A PORT ADDITION, like the playing guide above it, and for a plainer reason
 * than that one: this is an alpha whose whole point is that people report what
 * they find, and every route to doing so lived in a README that a player who
 * downloaded a build has never opened. `?` is where someone goes when they are
 * stuck, so `?` is where the answer belongs.
 *
 * The address is written the long way round on purpose - a person reads it, a
 * scraper walking the page does not.
 */
export function helpCommunityLines(): ScreenLine[] {
  return [
    { text: `You are playing Neo Angband ${ENGINE_VERSION}, a port of Angband 4.2.6.`, color: FG },
    { text: "", color: FG },
    { text: "It is ALPHA. It plays start to finish and it is not finished, and", color: FG },
    { text: "the things still wrong with it are mostly things only playing finds:", color: FG },
    { text: "a message the original prints that this one does not, a screen laid", color: FG },
    { text: "out a column off, a prompt that never appears.", color: FG },
    { text: "", color: FG },
    { text: "Ask anyone, about anything:", color: GOLD },
    { text: "    discord.gg/YegtwbHTBQ        the RPGM Tools Discord", color: FG },
    { text: "", color: FG },
    { text: "Tell us something is wrong:", color: GOLD },
    { text: "    github.com/neostryder/neo-angband/issues", color: FG },
    { text: "", color: FG },
    { text: "The most useful report says what the original does and what this", color: FG },
    { text: "does. You do not need a copy of Angband to hand - describing what", color: FG },
    { text: "you expected is plenty. Say which version (above), and whether any", color: FG },
    { text: "mods were on; '=' shows them, and turning the game into something", color: FG },
    { text: "else is what a mod is for, so that line saves a wasted round trip.", color: FG },
    { text: "", color: FG },
    { text: "Anything that should not be public, security included:", color: GOLD },
    { text: "    strider-angband (at) rpgm.tools", color: FG },
    { text: "", color: FG },
    { text: "Your characters are safe across updates. Every change to the save", color: FG },
    { text: "format ships the conversion that reads the one before it, and a save", color: FG },
    { text: "the game cannot open is left alone rather than replaced.", color: FG },
  ];
}

/** One page shown by the help index. */
interface HelpPage {
  title: string;
  lines: () => ScreenLine[];
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
      page: { title: supplied.label, lines: () => [...supplied.lines] },
    };
  });
  for (const [slot, supplied] of modPages) {
    if (seen.has(slot)) continue;
    out.push({
      id: slot,
      label: supplied.label,
      page: { title: supplied.label, lines: () => [...supplied.lines] },
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
 */
function coreHelpIndex(): readonly { id: string; label: string; page: HelpPage }[] {
  return [
    {
      id: "commands",
      label: t("help.commands.label", "Available commands"),
      page: {
        title: t("help.commands.title", "Angband Help - Commands"),
        lines: helpCommandLines,
      },
    },
    {
      id: "symbols",
      label: t("help.symbols.label", "Symbols on your map"),
      page: {
        title: t("help.symbols.title", "Angband Help - Symbols"),
        lines: helpSymbolLines,
      },
    },
    {
      id: "guide",
      label: t("help.guide.label", "Playing guide"),
      page: {
        title: t("help.guide.title", "Angband Help - Playing Guide"),
        lines: helpGuideLines,
      },
    },
    {
      id: "community",
      label: t("help.community.label", "Help, and telling us something is wrong"),
      page: {
        title: t("help.community.title", "Neo Angband - Help and reporting"),
        lines: helpCommunityLines,
      },
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
      "Angband Help",
      index.map((entry) => ({ label: entry.label })),
      "[ a-z to choose, ESC to exit ]",
    );
    if (pick === null) return;
    const entry = index[pick];
    if (!entry) continue;
    await showTextScreen(term, entry.page.title, entry.page.lines());
  }
}
