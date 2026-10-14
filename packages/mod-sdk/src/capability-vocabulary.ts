/**
 * The capability vocabulary: every capability a mod can declare, for every
 * runtime tier, in one list.
 *
 * Each entry gives the string an author writes, the schema of its argument when
 * it has one, the consent sentence a player reads, what stops working when the
 * player refuses it, whether the mod can still load without it, whether it is
 * one of the powerful grants the consent screen highlights, and which tiers may
 * hold it. `parseCapability` (capabilities.ts) reads this list, and so does the
 * web host's consent text (capability-describe.ts), so a capability added here
 * is parsed, described and listed in one change.
 *
 * Plain data and types, with no dependency on host code, so both the in-process
 * host and the Worker broker can import it.
 *
 * Namespaces:
 *  - `public`: any tier listed in `tiers` may declare it.
 *  - `manage`: mod management (installing mods, profiles, the session, the
 *    management screens). Not part of the public vocabulary: only first-party
 *    mods hold these, through the `manage` API namespace.
 *  - `truth`: information the character does not have, such as the real map
 *    under the player's memory. First-party only, and never covered by any
 *    wildcard grant: a mod gets it only by naming it.
 *
 * A capability a manifest does not list is not granted.
 */

import { API2_POLICY_KINDS } from "./api2/policies.js";

/** A capability string parsed into its structured form. */
export type ParsedCapability =
  | { kind: "engine"; action: "access" }
  | { kind: "command"; action: "add" | "submit" }
  | { kind: "input"; action: "intent" }
  | { kind: "input-prompt"; action: "reply" }
  | { kind: "event"; name: string }
  | { kind: "state"; domain: string; access: "read" }
  | { kind: "network"; host: string }
  | { kind: "registry"; domain: string }
  | { kind: "display"; action: "replace" | "filter" }
  | { kind: "ui"; region: string; action: "replace" | "create" | "mount" }
  | { kind: "backup"; action: "folder" }
  | { kind: "mod"; action: "install" | "session" | "authoring" }
  | { kind: "store"; action: "kv" | "session" }
  | { kind: "mod-read"; action: "read" }
  | { kind: "debug"; action: "spawn" | "wizard" }
  | { kind: "keymap"; action: "write" | "edit" }
  | { kind: "options"; action: "write" | "manage" }
  | { kind: "query"; action: "snapshot" }
  | { kind: "policy"; action: "install" }
  | { kind: "hook"; action: "respond" }
  | { kind: "registry-declaration"; action: "declare" }
  | { kind: "ui-region"; action: "write" }
  | { kind: "ui-panel"; action: "write" }
  | { kind: "prefs"; action: "read" | "write" }
  | { kind: "asset"; action: "read" }
  | { kind: "saves"; action: "manage" }
  | { kind: "title"; action: "add" }
  | { kind: "profiles"; action: "manage" }
  | { kind: "session"; action: "control" }
  | { kind: "screens"; action: "manage" }
  | { kind: "shared"; action: "read" | "publish" };

/**
 * The runtime tiers that can hold capabilities. The data tier runs no code and
 * holds none.
 *
 *  - `first-party`: the first-party mods, in process.
 *  - `reviewed`: a community mod reviewed for in-process use.
 *  - `sideloaded`: a mod installed from outside the registry.
 *  - `worker`: a community mod in an isolated Worker behind the host broker.
 */
export type CapabilityTier = "first-party" | "reviewed" | "sideloaded" | "worker";

/** Every tier, for iterating. */
export const CAPABILITY_TIERS: readonly CapabilityTier[] = ["first-party", "reviewed", "sideloaded", "worker"];

/** See the module header. */
export type CapabilityNamespace = "public" | "manage" | "truth";

/** The argument of a capability that takes one, such as the event name in `event:<name>`. */
export interface CapabilityArgument {
  /** The placeholder in `capability` and in the consent text: `name` for `event:<name>`. */
  readonly name: string;
  /** The values it accepts, as a regular expression source matched against the whole argument. */
  readonly pattern: string;
  /** What the argument names, for authors. */
  readonly description: string;
}

/** One capability in the vocabulary. */
export interface CapabilityEntry {
  /** As written in a manifest. `<name>` marks the argument, when there is one. */
  readonly capability: string;
  /** The argument schema. Empty for a capability with a fixed spelling. */
  readonly args: readonly CapabilityArgument[];
  /** The consent sentence. `{name}` is replaced with the argument's value. */
  readonly consent: string;
  /** What stops working when the player refuses it. */
  readonly withoutIt: string;
  /**
   * True when the mod still loads with this refused and only the functions that
   * need it stop. False when the grant is set up as the mod loads, so a refusal
   * leaves the mod unable to start.
   */
  readonly canRunWithout: boolean;
  /** One of the grants the consent screen highlights. */
  readonly powerful: boolean;
  readonly namespace: CapabilityNamespace;
  /** The tiers that may hold it. */
  readonly tiers: readonly CapabilityTier[];
  /** True for a wildcard grant (`state:*.read`, `registry:*`, `network:*`, `ui:*.replace`). */
  readonly wildcard?: true;
}

const IN_PROCESS: readonly CapabilityTier[] = ["first-party", "reviewed", "sideloaded"];
const ALL_TIERS: readonly CapabilityTier[] = CAPABILITY_TIERS;
const FIRST_PARTY: readonly CapabilityTier[] = ["first-party"];
const POLICY_CAPABILITIES = new Set(API2_POLICY_KINDS.map((kind) => kind.capability));

/** A fixed-spelling entry plus the structured form it parses to. */
interface FixedEntry extends CapabilityEntry {
  readonly parsed: ParsedCapability;
}

/** An entry with one argument, plus how it is recognised and built. */
interface TemplateEntry extends CapabilityEntry {
  readonly prefix: string;
  readonly suffix: string;
  readonly build: (value: string) => ParsedCapability;
}

function fixed(
  capability: string,
  parsed: ParsedCapability,
  consent: string,
  withoutIt: string,
  options: {
    powerful: boolean;
    tiers?: readonly CapabilityTier[];
    namespace?: CapabilityNamespace;
    canRunWithout?: boolean;
    wildcard?: true;
  },
): FixedEntry {
  return {
    capability,
    parsed,
    args: [],
    consent,
    withoutIt,
    canRunWithout: options.canRunWithout ?? true,
    powerful: options.powerful,
    namespace: options.namespace ?? "public",
    tiers: options.tiers ?? IN_PROCESS,
    ...(options.wildcard ? { wildcard: true as const } : {}),
  };
}

/* ------------------------------------------------------------------ */
/* Registry overrides                                                  */
/* ------------------------------------------------------------------ */

/**
 * Policy tables share registry permissions with plugins so the player can consent to each change in either runtime. A refused grant leaves its policy tables uninstalled.
 *
 * A tile filler only writes where the tile pack leaves a tile empty, so it cannot replace an assigned tile.
 */
const REGISTRY_DOMAINS: readonly (readonly [string, string, boolean])[] = [
  ["effect", "Override effect, combat, and magic logic", true],
  ["room", "Override dungeon / level generation", true],
  ["profile", "Add new kinds of dungeon level, and change which kind you get at a depth", true],
  ["blow", "Change what monster attacks do to you, and add new kinds of attack", true],
  ["store", "Change what shops buy from you and what they keep in stock", true],
  ["command", "Change what player commands do, add commands, and tunnel when a walk meets diggable rock", true],
  ["monster", "Override monster AI (take over monster turns), and keep monster noise and scent in saves", true],
  ["projection", "Change what spells, breaths and other elements do to the dungeon, to items on the floor, and to you", true],
  ["ui-entry", "Change how your resistances, abilities and stat modifiers are worked out and drawn on the character sheet and the equipment comparison, rewrite screen text, and choose how preference errors are handled", true],
  ["glyph", "Change what the symbols in a room or vault layout mean when a level is drawn", true],
  ["effect-info", "Change what the game tells you about objects and effects", true],
  ["randart", "Change how random artifacts are built - what powers they can get, and what each kind of item starts with", true],
  ["rune", "Teach the game about a new kind of RUNE - what it is called, what an item carries, and how the player learns it, including during a shapechange", true],
  ["tval", "Teach the game about a new kind of item - whether it can be worn or wielded, how it is priced, whether it has an unidentified flavour, and how floor items are ordered", true],
  ["vocab", "Add new vocabulary - flags, stats, and other terms", false],
  ["menu", "Rewrite one named game menu's semantic rows and layout", true],
  ["message", "Change message text and character history, add message types, and choose which sounds play for them", false],
  ["tiles", "Supply tiles for creatures and items your tile set does not draw", false],
];

/** What the player would call each HUD region or screen family `ui:<region>.replace` hands over. */
const UI_REGIONS: readonly (readonly [string, string, string])[] = [
  ["messages", "message line at the top of the screen", "The game draws its own message line."],
  ["sidebar", "vitals panel - your hit points, food, armour and depth", "The game draws its own vitals panel."],
  ["status", "status line along the bottom of the screen", "The game draws its own status line."],
  /* Not regions: every menu, every full screen and character creation, each
   * held by one presenter that declines what it has no better way to show.
   * One grant per family, because a grant per menu id would be a consent list
   * nobody could read. */
  ["menu", "menus and choices the game offers you", "The game shows its own menus."],
  ["screen", "full screens - your inventory, character sheet and the rest", "The game shows its own full screens."],
  ["birth", "character creation screens", "The game shows its own character creation screens."],
];

const FIXED_ENTRIES: readonly FixedEntry[] = [
  fixed("engine:access", { kind: "engine", action: "access" }, "Read and change the live engine, including facts your character has not learned",
    "The mod cannot use the live engine.", { powerful: true }),
  fixed("command:add", { kind: "command", action: "add" }, "Add new player commands",
    "The commands this mod adds are not available.", { powerful: false }),
  fixed("command:submit", { kind: "command", action: "submit" }, "Ask the game to run commands by their names, the way your own keys do",
    "The mod cannot ask the game to run commands for you.", { powerful: true, tiers: ALL_TIERS }),
  fixed("input:intent", { kind: "input", action: "intent" }, "Act on your character's behalf with the same commands your own keys use",
    "The mod cannot move or act for your character.", { powerful: true, tiers: ALL_TIERS }),
  fixed("input:prompt.reply", { kind: "input-prompt", action: "reply" }, "Answer the game's current question through its input handler",
    "The mod cannot answer the game's questions for you, so you answer them yourself.", { powerful: true, tiers: ALL_TIERS }),
  fixed("saves:manage", { kind: "saves", action: "manage" }, "List, load, rename and delete your characters; deletion asks you first",
    "The mod's own character list does not appear; the game's list still works.", { powerful: true }),
  fixed("ui:title", { kind: "title", action: "add" }, "Add title screen actions",
    "The mod's entries on the title screen do not appear.", { powerful: false }),
  fixed("shared:read", { kind: "shared", action: "read" }, "Read data other mods share",
    "The mod cannot see what other mods share with it.", { powerful: false }),
  fixed("shared:publish", { kind: "shared", action: "publish" }, "Share data with other mods",
    "Other mods cannot see what this mod shares.", { powerful: false }),
  fixed("display:replace", { kind: "display", action: "replace" }, "Draw the dungeon itself - everything you see of the map comes from this mod instead of the game",
    "The game draws the map itself and this mod's view is not used.", { powerful: true, canRunWithout: false }),
  fixed("display:filter", { kind: "display", action: "filter" }, "Apply a visual post-processing filter to the game's terminal canvas and panels",
    "The game's screen is shown without this mod's filter.", { powerful: false }),
  fixed("ui:*.replace", { kind: "ui", region: "*", action: "replace" }, "Draw the whole interface around the map - your messages, your vitals, the status line, every menu and every full screen all come from this mod",
    "The game draws its own interface around the map.", { powerful: true, wildcard: true }),
  ...UI_REGIONS.map(([region, words, withoutIt]) =>
    fixed(`ui:${region}.replace`, { kind: "ui", region, action: "replace" }, `Draw the ${words} instead of the game`,
      withoutIt, { powerful: true })),
  /* `create` adds a rectangle of the game's own character grid; it hands over
   * nothing the game already draws, so it is its own action, and `ui:*.replace`
   * does not cover it (#261). */
  fixed("ui:region.create", { kind: "ui", region: "region", action: "create" }, "Add furniture of its own to your screen - panels this mod draws itself, over the map and beside the game's own",
    "The panels this mod draws on the game screen do not appear.", { powerful: true }),
  /* `mount` puts real web content above the game. The consent text tells the
   * player the two facts they have no other way to learn: what they see may
   * not be the game, and what they type into it is the mod's to read. */
  fixed("ui:panel.mount", { kind: "ui", region: "panel", action: "mount" }, "Draw its own interface over the game with real web pages - it can look exactly like the game's own screens, cover them completely, and read whatever you type, paste or drop into it",
    "The mod's own windows over the game do not open.", { powerful: true, tiers: ALL_TIERS }),
  fixed("ui:region", { kind: "ui-region", action: "write" }, "Add and update a host-painted text region on the game screen",
    "The text area this mod fills on the game screen stays empty.", { powerful: true, tiers: ALL_TIERS }),
  fixed("ui:panel", { kind: "ui-panel", action: "write" }, "Show panels of buttons and text that the game draws for this mod",
    "The panels this mod asks the game to draw do not appear.", { powerful: false, tiers: ALL_TIERS }),
  fixed("backup:folder", { kind: "backup", action: "folder" }, "Write files into a folder you pick (it never learns the folder's real path, only whether a write succeeded)",
    "The mod cannot write backups to a folder you pick.", { powerful: false }),
  fixed("mod:read", { kind: "mod-read", action: "read" }, "Look up a mod at a repository address, the same way installing one does - its name, description, author, version and file listing - by reaching out to that repository on your behalf. Nothing is installed and nothing is added to your library",
    "The mod cannot look up other mods by their repository address.", { powerful: true }),
  fixed("debug:spawn", { kind: "debug", action: "spawn" }, "Conjure items and creatures into your game, the way the debug commands do - it asks first, and the character it happens to is marked for good and can no longer be scored",
    "The mod cannot create items or creatures in your game.", { powerful: true }),
  /* The wizard grant costs the session rather than the score: it refuses to run
   * until the session is cut loose from its save. */
  fixed("debug:wizard", { kind: "debug", action: "wizard" }, "Use the game's debug commands to test with - depth, experience, gold, items, creatures - after stopping this session from being saved at all. Your character on disk keeps whatever the last save left and nothing after that is written, which cannot be undone without reloading",
    "The mod cannot use the game's debug commands.", { powerful: true }),
  fixed("keymap:write", { kind: "keymap", action: "write" }, "Create new shortcut keymaps in your current keyset without replacing your existing shortcuts",
    "The shortcut keys this mod offers to add are not created.", { powerful: false, tiers: ALL_TIERS }),
  fixed("keymap:edit", { kind: "keymap", action: "edit" }, "Change, replace and remove any of your keymaps in the current keyset, and read the next key you press to bind it",
    "The mod's keymap editor cannot change your keymaps.", { powerful: true }),
  fixed("options:write", { kind: "options", action: "write" }, "Change your user interface options and delay settings, as the options menu does; birth and cheat options stay yours to set",
    "The mod cannot change your options; the options menu still works.", { powerful: false }),
  fixed("query:snapshot", { kind: "query", action: "snapshot" }, "Read the host's named, cloned engine and content snapshots",
    "The mod cannot read the game's snapshots.", { powerful: false, tiers: ALL_TIERS }),
  fixed("policy:install", { kind: "policy", action: "install" }, "Install declared host-side policies that the game evaluates synchronously",
    "The rules this mod declares for the game to apply are not installed.", { powerful: true, tiers: ALL_TIERS }),
  fixed("hook:respond", { kind: "hook", action: "respond" }, "Answer approved asynchronous game decisions with a safe timeout fallback",
    "The game makes those decisions without asking this mod.", { powerful: true, tiers: ALL_TIERS }),
  fixed("registry:declare", { kind: "registry-declaration", action: "declare" }, "Declare host-owned commands or content using approved data schemas",
    "The commands and content this mod declares are not added.", { powerful: true, tiers: ALL_TIERS }),
  fixed("prefs:read", { kind: "prefs", action: "read" }, "Read the settings this mod saved earlier",
    "The mod starts from its defaults each time.", { powerful: false, tiers: ALL_TIERS }),
  fixed("prefs:write", { kind: "prefs", action: "write" }, "Save its own settings between sessions",
    "Changes to the mod's settings are lost when you close the game.", { powerful: false, tiers: ALL_TIERS }),
  fixed("store:kv", { kind: "store", action: "kv" }, "The mod can keep its own records on this installation across profiles and characters",
    "The mod cannot keep records between sessions.", { powerful: false, tiers: ALL_TIERS }),
  fixed("store:session", { kind: "store", action: "session" }, "The mod can keep its own records until this tab closes",
    "The mod cannot keep records across a reload in this tab.", { powerful: false, tiers: ALL_TIERS }),
  fixed("asset:read", { kind: "asset", action: "read" }, "Read files that came with this mod",
    "The mod cannot open the images and data files it ships with.", { powerful: false, tiers: ALL_TIERS }),
  fixed("state:*.read", { kind: "state", domain: "*", access: "read" }, "Read ALL game state, except the parts of the map your character has not found",
    "The mod cannot read the game state it uses.", { powerful: true, tiers: ALL_TIERS, wildcard: true }),
  fixed("state:map-actual.read", { kind: "state", domain: "map-actual", access: "read" }, "See what the map really holds, including traps, items, terrain and creatures your character has not found",
    "The mod sees only what your character has found.", { powerful: true, tiers: FIRST_PARTY, namespace: "truth" }),
  fixed("network:*", { kind: "network", host: "*" }, "Send network requests to ANY host (your data could leave this device)",
    "The mod cannot reach the internet.", { powerful: true, tiers: ALL_TIERS, wildcard: true }),
  fixed("network:local", { kind: "network", host: "local" }, "Send network requests to servers on this computer or your local network",
    "The mod cannot reach servers on this computer or your local network.", { powerful: true, tiers: ALL_TIERS }),
  fixed("registry:*", { kind: "registry", domain: "*" }, "Override ANY game system - effects, level and dungeon generation, monster attacks, shops, commands, monster AI, what spells and breaths do, what a vault symbol means, and vocabulary (full trusted, in-process access)",
    "None of the game systems this mod changes are changed, and the mod does not start.", { powerful: true, canRunWithout: false, wildcard: true, tiers: ALL_TIERS }),
  ...REGISTRY_DOMAINS.map(([domain, consent, powerful]) =>
    fixed(`registry:${domain}`, { kind: "registry", domain }, consent,
      "The mod does not start, because it installs this change as it loads.", { powerful, canRunWithout: false, tiers: POLICY_CAPABILITIES.has(`registry:${domain}`) ? ALL_TIERS : IN_PROCESS })),

  /* Management. Not part of the public vocabulary: first-party mods hold these
   * through the `manage` namespace. */
  fixed("profiles:manage", { kind: "profiles", action: "manage" }, "Create profiles and switch between them",
    "The mod cannot create profiles or switch between them.", { powerful: true, tiers: FIRST_PARTY, namespace: "manage" }),
  fixed("session:control", { kind: "session", action: "control" }, "Save the game, return to the title screen, or quit",
    "The mod cannot save the game, leave it or quit for you.", { powerful: false, tiers: FIRST_PARTY, namespace: "manage" }),
  fixed("screens:manage", { kind: "screens", action: "manage" }, "Draw the game's mod, profile and settings screens in its own look",
    "The game's own management screens are shown instead.", { powerful: true, tiers: FIRST_PARTY, namespace: "manage" }),
  fixed("mod:authoring", { kind: "mod", action: "authoring" }, "The mod can use this game's mod authoring and validation library",
    "The mod cannot check drafts with this game's authoring library.", { powerful: false, tiers: FIRST_PARTY, namespace: "manage" }),
  fixed("options:manage", { kind: "options", action: "manage" }, "The mod can read and change game options, including cheat options that permanently disqualify a character from scoring",
    "The mod cannot edit cheat options; the options menu still works.", { powerful: true, tiers: FIRST_PARTY, namespace: "manage" }),
  /* Install and session loads are two grants: an install arrives switched off,
   * a session load is on as soon as the game reloads. The archive is forgotten
   * with the session; what its records did to a character is not. */
  fixed("mod:install", { kind: "mod", action: "install" }, "Add content mods to your library - records and tweaks, never code, and they arrive switched off until you read what they ask for and turn them on yourself",
    "The mod cannot add mods to your library.", { powerful: true, tiers: FIRST_PARTY, namespace: "manage" }),
  fixed("mod:session", { kind: "mod", action: "session" }, "Put content mods into the game for the rest of this session - records and tweaks, never code - which start working as soon as the game reloads, without waiting to be switched on. The mod is forgotten when you close the game; what it did to a character is not",
    "The mod cannot load test content into this session.", { powerful: true, tiers: FIRST_PARTY, namespace: "manage" }),
];

const KEBAB_ARG = "[a-z][a-z0-9-]*";
const HOST_ARG = "(?:[a-zA-Z0-9.-]+|\\[[0-9a-fA-F:.]+\\])(?::[0-9]{1,5})?";

/** Thrown by a template's builder when the argument is malformed past its pattern. */
export class CapabilityArgumentError extends Error {}

const TEMPLATE_ENTRIES: readonly TemplateEntry[] = [
  {
    capability: "event:<name>",
    prefix: "event:",
    suffix: "",
    args: [{ name: "name", pattern: KEBAB_ARG, description: "A game event name, such as turn-start." }],
    build: (name) => ({ kind: "event", name }),
    consent: "Observe the \"{name}\" game event",
    withoutIt: "The mod is not told when this event happens.",
    canRunWithout: true,
    powerful: false,
    namespace: "public",
    tiers: ALL_TIERS,
  },
  {
    capability: "state:<domain>.read",
    prefix: "state:",
    suffix: ".read",
    args: [{ name: "domain", pattern: KEBAB_ARG, description: "A known-world domain, such as player or monsters." }],
    build: (domain) => ({ kind: "state", domain, access: "read" }),
    consent: "Read {domain} game state",
    withoutIt: "The mod cannot read this part of the game state.",
    canRunWithout: true,
    powerful: false,
    namespace: "public",
    tiers: ALL_TIERS,
  },
  {
    capability: "network:<host>",
    prefix: "network:",
    suffix: "",
    args: [{
      name: "host",
      pattern: HOST_ARG,
      description: "A host name or address, with an optional port. Without a port it covers the scheme's default port only.",
    }],
    build: (raw) => {
      const host = raw.toLowerCase();
      const port = /:([0-9]+)$/.exec(host.startsWith("[") ? host.slice(host.indexOf("]") + 1) : host)?.[1];
      if (port !== undefined && (Number(port) < 1 || Number(port) > 65535)) {
        throw new CapabilityArgumentError("the port must be between 1 and 65535");
      }
      return { kind: "network", host };
    },
    consent: "Send network requests to {host}",
    withoutIt: "The mod cannot reach this server.",
    canRunWithout: true,
    powerful: true,
    namespace: "public",
    tiers: ALL_TIERS,
  },
];

/** Every capability in the vocabulary, fixed spellings first. */
export const CAPABILITY_VOCABULARY: readonly CapabilityEntry[] = [...FIXED_ENTRIES, ...TEMPLATE_ENTRIES];

/** The public vocabulary: what any tier may declare. Management and truth entries are absent. */
export const PUBLIC_CAPABILITIES: readonly CapabilityEntry[] = CAPABILITY_VOCABULARY.filter(
  (entry) => entry.namespace === "public",
);

const BY_SPELLING: ReadonlyMap<string, FixedEntry> = new Map(FIXED_ENTRIES.map((entry) => [entry.capability, entry]));

/** A capability string matched against the vocabulary. */
export interface CapabilityMatch {
  readonly entry: CapabilityEntry;
  readonly parsed: ParsedCapability;
  /** The argument values by name, for filling the consent text. */
  readonly args: Readonly<Record<string, string>>;
}

/**
 * Match `cap` against the vocabulary. Null for a string the vocabulary does not
 * know. Throws CapabilityArgumentError when the shape matches and the argument
 * does not make sense (a network port out of range).
 */
export function matchCapability(cap: string): CapabilityMatch | null {
  const known = BY_SPELLING.get(cap);
  if (known) return { entry: known, parsed: known.parsed, args: {} };
  for (const entry of TEMPLATE_ENTRIES) {
    if (!cap.startsWith(entry.prefix) || !cap.endsWith(entry.suffix)) continue;
    const value = cap.slice(entry.prefix.length, cap.length - entry.suffix.length);
    const arg = entry.args[0];
    if (arg === undefined || !new RegExp(`^(?:${arg.pattern})$`).test(value)) continue;
    const parsed = entry.build(value);
    const shown = parsed.kind === "network" ? parsed.host : value;
    return { entry, parsed, args: { [arg.name]: shown } };
  }
  return null;
}

/** The consent sentence for a matched capability, with its argument filled in. */
export function consentText(match: CapabilityMatch): string {
  return match.entry.consent.replace(/\{([a-z]+)\}/g, (whole, name: string) => match.args[name] ?? whole);
}

const TRUTH_PARSED: readonly string[] = FIXED_ENTRIES
  .filter((entry) => entry.namespace === "truth")
  .map((entry) => JSON.stringify(entry.parsed));

/**
 * True when `cap` (a string, or its parsed form) is in the `truth` namespace.
 * Every truth capability has a fixed spelling, so no template can produce one.
 */
export function isTruthCapability(cap: string | ParsedCapability): boolean {
  return typeof cap === "string"
    ? BY_SPELLING.get(cap)?.namespace === "truth"
    : TRUTH_PARSED.includes(JSON.stringify(cap));
}

/** True when `cap` is in the public vocabulary. A management or truth capability is not. */
export function isPublicCapability(cap: string): boolean {
  try {
    return matchCapability(cap)?.entry.namespace === "public";
  } catch {
    return false;
  }
}

/** The tiers that may hold `cap`; empty for a string the vocabulary does not know. */
export function capabilityTiers(cap: string): readonly CapabilityTier[] {
  try {
    return matchCapability(cap)?.entry.tiers ?? [];
  } catch {
    return [];
  }
}
