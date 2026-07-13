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

import type { GlyphTerm } from "./term";
import { showTextScreen, selectFromMenu } from "./overlay";
import type { ScreenLine } from "./overlay";

const FG = "#c8c8d4";
const DIM = "#8a8a94";
const LABEL = "#9aa0b4";

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
  lines.push(keyLine("=", "Ignore setup (quality/ego filters)"));

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
  lines.push(keyLine("M", "Display map of entire level"));
  lines.push(keyLine("L", "Locate player on map"));
  lines.push(keyLine("C", "Character description"));
  lines.push(keyLine("S", "Save the game"));
  lines.push(keyLine("N", "New character (also available after death)"));
  lines.push(keyLine("V", "Display the hall of fame"));
  lines.push(keyLine("Ctrl-P", "Show previous messages"));
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
const HELP_INDEX: readonly { label: string; page: HelpPage }[] = [
  { label: "Available commands", page: { title: "Angband Help - Commands", lines: helpCommandLines } },
  { label: "Symbols on your map", page: { title: "Angband Help - Symbols", lines: helpSymbolLines } },
  { label: "Playing guide", page: { title: "Angband Help - Playing Guide", lines: helpGuideLines } },
];

/**
 * The help modal (do_cmd_help, ui-help.c:470). Loops the index
 * (selectFromMenu) -> the chosen page (showTextScreen) -> back to the index,
 * exactly the show_file recursion (ui-help.c:337-453), resolving when ESC is
 * pressed at the index. Pure display: no RNG, no state mutation, no turn.
 */
export async function runHelp(term: GlyphTerm): Promise<void> {
  for (;;) {
    const pick = await selectFromMenu(
      term,
      "Angband Help",
      HELP_INDEX.map((entry) => ({ label: entry.label })),
      "[ a-z to choose, ESC to exit ]",
    );
    if (pick === null) return;
    const entry = HELP_INDEX[pick];
    if (!entry) continue;
    await showTextScreen(term, entry.page.title, entry.page.lines());
  }
}
