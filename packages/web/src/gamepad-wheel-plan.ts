/**
 * What the command wheel puts on its first ring, and what it pushes to the
 * second.
 *
 * The wheel used to open on the command table's own eight groups - Items,
 * Action commands, Port, Manage items, Information, Utility, Hidden, System.
 * Those are `ui-game.c`'s source-code lists, and they are the right shape for a
 * keyboard help screen and the wrong shape for a controller. They spent an
 * eighth of the ring on Port, which is two rows; another eighth on Hidden,
 * which is upstream's drawer for Version info and a pref-file line; and they
 * buried Cast a spell inside Information, twelve rows deep, behind Browse.
 *
 * The split below is by how often a hand reaches for the command during play,
 * not by where upstream files it. Seven groups hold the fifty commands a
 * character uses to fight, cast, drink, wear, carry, travel and read the map.
 * The eighth is More, and it is the COMPLEMENT rather than a list: every
 * command the seven do not claim appears there, in the order the command
 * surface reports it, paged eight at a time. So a command added by a mod, a
 * player keymap, or a future version of the table is reachable the moment it
 * exists, and nothing can be dropped by editing this file.
 *
 * Two levels, never three: a group's ring is commands, and a long one pages
 * rather than subdividing. That ceiling is measured rather than chosen - see
 * `docs/design/COMMAND_WHEEL.md`.
 *
 * A command is matched by `commandName`, which is the one definition of what a
 * command is CALLED: its original-keyset key where it has one, its label where
 * it does not. The mapping screen and a saved binding use the same function, so
 * a row the wheel can reach is a row a button can be bound to.
 */
import { commandName, type ControlAction, type ControlCommand } from "./control-surface";
import { isIconName, type IconName } from "./gamepad-wheel-icons";

/** Wedges per ring. Eight is the size a radial menu was measured at. */
export const WEDGES = 8;

export interface WheelEntry {
  /** The one word printed under the icon. */
  readonly word: string;
  readonly icon: IconName;
}

export interface WheelGroup extends WheelEntry {
  readonly id: string;
  /**
   * Selectors, in ring order. Empty means the group is the complement of every
   * other group, which is what makes the wheel complete by construction.
   */
  readonly members: readonly string[];
}

/**
 * Word and icon per command, keyed by the selector.
 *
 * The word is the wedge's label and is deliberately one word. Where the
 * command's full name is longer the hub carries it in full, so a wedge reading
 * `Nearest` sits under a hub reading `Fire at nearest target` and nothing is
 * lost. A name that will not reduce to one word is a signal the command does
 * not belong on the first ring, and every one of those is in More.
 */
const ENTRIES: Record<string, WheelEntry> = {
  /* Fight */
  "f": { word: "Fire", icon: "bow" },
  "h": { word: "Nearest", icon: "snapshot" },
  "v": { word: "Throw", icon: "throw" },
  "*": { word: "Target", icon: "crosshair" },
  "'": { word: "Closest", icon: "crosshair-lock" },
  "l": { word: "Look", icon: "eye" },
  "s": { word: "Steal", icon: "hand" },
  /* Magic */
  "m": { word: "Cast", icon: "cast" },
  "b": { word: "Browse", icon: "book-open" },
  "G": { word: "Study", icon: "study" },
  "S": { word: "Abilities", icon: "abilities" },
  /* Use */
  "q": { word: "Quaff", icon: "potion" },
  "r": { word: "Read", icon: "scroll" },
  "E": { word: "Eat", icon: "food" },
  "a": { word: "Aim", icon: "wand" },
  "z": { word: "Zap", icon: "rod" },
  "u": { word: "Staff", icon: "staff" },
  "A": { word: "Activate", icon: "activate" },
  "U": { word: "Use", icon: "use" },
  /* Gear */
  "w": { word: "Wear", icon: "wear" },
  "t": { word: "Remove", icon: "remove" },
  "x": { word: "Swap", icon: "swap" },
  "I": { word: "Examine", icon: "examine" },
  "F": { word: "Fuel", icon: "lantern" },
  "i": { word: "Inventory", icon: "inventory" },
  "e": { word: "Equipment", icon: "equipment" },
  "|": { word: "Quiver", icon: "quiver" },
  /* Carry */
  "g": { word: "Pickup", icon: "pickup" },
  "d": { word: "Drop", icon: "drop" },
  "k": { word: "Ignore", icon: "ignore" },
  "K": { word: "Ignoring", icon: "ignoring" },
  "{": { word: "Inscribe", icon: "inscribe" },
  "}": { word: "Uninscribe", icon: "uninscribe" },
  "Autopickup": { word: "Autopickup", icon: "autopickup" },
  /* Travel */
  "<": { word: "Up", icon: "stairs-up" },
  ">": { word: "Down", icon: "stairs-down" },
  "R": { word: "Rest", icon: "rest" },
  ".": { word: "Run", icon: "run" },
  "p": { word: "Explore", icon: "explore" },
  ";": { word: "Walk", icon: "walk" },
  ",": { word: "Stand", icon: "stand" },
  "n": { word: "Repeat", icon: "repeat" },
  /* Map */
  "M": { word: "Map", icon: "map" },
  "[": { word: "Monsters", icon: "monsters" },
  "]": { word: "Objects", icon: "objects" },
  "L": { word: "Locate", icon: "locate" },
  "Center map": { word: "Center", icon: "center" },
  "/": { word: "Symbol", icon: "symbol" },
  "C": { word: "Character", icon: "character" },
  "~": { word: "Knowledge", icon: "knowledge" },

  /* More. Named here for their word and their icon; membership is automatic. */
  "D": { word: "Disarm", icon: "disarm" },
  "T": { word: "Tunnel", icon: "pick" },
  "o": { word: "Open", icon: "door-open" },
  "c": { word: "Close", icon: "door-close" },
  "W": { word: "Trap", icon: "trap" },
  "5": { word: "Stand", icon: "stand" },
  "=": { word: "Options", icon: "options" },
  "Q": { word: "Retire", icon: "retire" },
  ")": { word: "Dump", icon: "dump" },
  ":": { word: "Notes", icon: "notes" },
  "V": { word: "Version", icon: "info" },
  "\"": { word: "Pref", icon: "pref" },
  "+": { word: "Alter", icon: "alter" },
  "^A": { word: "Debug", icon: "debug" },
  "^Z": { word: "Borg", icon: "borg" },
  "Help": { word: "Help", icon: "help" },
  "Save": { word: "Save", icon: "save" },
  "Save and quit": { word: "Quit", icon: "quit" },
  "Messages": { word: "Messages", icon: "messages" },
  "Previous message": { word: "Previous", icon: "prev-message" },
  "Level feeling": { word: "Feeling", icon: "feeling" },
  "Redraw": { word: "Redraw", icon: "redraw" },
  "Toggle wizard": { word: "Wizard", icon: "wizard" },
  "Game menu": { word: "Menu", icon: "menu" },
  "Command browser": { word: "Browser", icon: "list" },
};

/**
 * The first ring, clockwise from north.
 *
 * The four cardinals carry the four groups a character touches every few turns,
 * because a cardinal is the direction a stick reaches without a diagonal. More
 * sits on a diagonal: it is the completeness guarantee rather than a
 * destination.
 */
export const WHEEL_GROUPS: readonly WheelGroup[] = [
  { id: "use", word: "Use", icon: "potion",
    members: ["q", "r", "E", "a", "z", "u", "A", "U"] },
  { id: "magic", word: "Magic", icon: "book",
    members: ["m", "b", "G", "S"] },
  { id: "fight", word: "Fight", icon: "sword",
    members: ["f", "h", "v", "*", "'", "l", "s"] },
  { id: "gear", word: "Gear", icon: "armour",
    members: ["w", "t", "x", "I", "F", "i", "e", "|"] },
  { id: "travel", word: "Travel", icon: "stairs",
    members: ["<", ">", "R", ".", "p", ";", ",", "n"] },
  { id: "carry", word: "Carry", icon: "pack",
    members: ["g", "d", "k", "K", "{", "}", "Autopickup"] },
  { id: "map", word: "Map", icon: "map",
    members: ["M", "[", "]", "L", "Center map", "/", "C", "~"] },
  { id: "more", word: "More", icon: "more", members: [] },
];

/** Every selector the curated groups claim. */
const CLAIMED: ReadonlySet<string> = new Set(
  WHEEL_GROUPS.flatMap((group) => group.members),
);

/**
 * The one word for a name that has no entry of its own.
 *
 * A mod's command, a player keymap and a prompt reply all arrive as free text,
 * and a wedge still has to print one word under its icon. The first word of the
 * name is that word; the hub shows the name in full beside it.
 */
export function shortWord(label: string): string {
  const first = label.trim().split(/[\s/]+/)[0] ?? label;
  const trimmed = first.replace(/[.,:;!?"']+$/u, "");
  return trimmed.length > 0 ? trimmed : label;
}

/** Word and icon for a command, falling back for anything not named above. */
export function entryFor(command: ControlCommand): WheelEntry {
  const named = ENTRIES[commandName(command)];
  if (named) return named;
  return {
    word: shortWord(command.label),
    icon: command.id.startsWith("macro:") ? "macro" : "command",
  };
}

/** The commands on one group's ring, in the order that group declares. */
export function groupCommands(
  group: WheelGroup,
  commands: readonly ControlCommand[],
): readonly ControlCommand[] {
  if (group.members.length === 0) {
    return commands.filter((command) => !CLAIMED.has(commandName(command)));
  }
  const bySelector = new Map(commands.map((command) => [commandName(command), command]));
  return group.members
    .map((selector) => bySelector.get(selector))
    .filter((command): command is ControlCommand => command !== undefined);
}

/**
 * Commands the wheel cannot reach. Always empty, and the test that says so is
 * the point: More is the complement, so the only way to lose a command would be
 * for two groups to claim the same selector and for the second to win.
 */
export function unreachableCommands(
  commands: readonly ControlCommand[],
): readonly ControlCommand[] {
  const reached = new Set<string>();
  for (const group of WHEEL_GROUPS) {
    for (const command of groupCommands(group, commands)) reached.add(command.id);
  }
  return commands.filter((command) => !reached.has(command.id));
}

/**
 * Word and icon for a prompt reply.
 *
 * A reply is the prompt's own action rather than a command, so it has no key
 * and no entry. Its ROLE settles four of them outright, which is the same fact
 * `ControlAction.role` exists to carry; the rest are the item sources and the
 * target loop's own actions, named here because their labels are stable and
 * short.
 */
const REPLY_ICONS: Record<string, IconName> = {
  inven: "inventory",
  inventory: "inventory",
  equip: "equipment",
  equipment: "equipment",
  quiver: "quiver",
  floor: "objects",
  "free cursor": "crosshair",
  player: "character",
  interesting: "crosshair-lock",
  closest: "crosshair-lock",
  recall: "knowledge",
  help: "help",
  yes: "accept",
  no: "cancel",
};

export function replyEntry(action: ControlAction): WheelEntry {
  const word = shortWord(action.label);
  const named = REPLY_ICONS[action.label.trim().toLowerCase()];
  if (named) return { word, icon: named };
  const byRole: Record<string, IconName> = {
    cancel: "cancel", accept: "accept", next: "next", previous: "prev",
  };
  const role = action.role ? byRole[action.role] : undefined;
  return { word, icon: role ?? "reply" };
}

/** Every selector this plan names, for the test that checks the icons exist. */
export function namedSelectors(): readonly string[] {
  return Object.keys(ENTRIES);
}

/** The entry a selector names, or undefined. Used by the coverage test. */
export function entryForSelector(selector: string): WheelEntry | undefined {
  return ENTRIES[selector];
}

/** True when every icon this plan references is a drawn icon. */
export function missingIcons(): readonly string[] {
  const referenced = [
    ...WHEEL_GROUPS.map((group) => group.icon),
    ...Object.values(ENTRIES).map((entry) => entry.icon),
    ...Object.values(REPLY_ICONS),
    "command", "macro", "reply", "accept", "cancel", "next", "prev",
  ];
  return referenced.filter((name) => !isIconName(name));
}
