/**
 * Plain-language descriptions of mod capabilities, for the W2.4 consent prompt.
 *
 * A manifest's `capabilities` are terse machine strings (capabilities.ts
 * vocabulary: command:add, event:<name>, state:<domain>.read, network:<host>,
 * registry:<domain>). Before a user enables a plugin the manager must show, in
 * human terms, what the mod DECLARED it means to do - and flag the powerful ones
 * (in-process system override, network egress, broad state reads) so consent is
 * informed. This module is the single source of that mapping; it is pure so it
 * can be unit-tested and reused by any host (web or Electron).
 *
 * DECLARED, not bounded, and the wording here is careful about it. For a mod that
 * ships code these lines are what its author said it would touch, not a limit on
 * what its code can reach: an in-process plugin holds the engine namespace, so
 * the registries the `registry:*` facades guard are reachable around them (see
 * docs/modding/PLUGINS.md, "What a capability gates"). That is why the consent
 * screen carries a separate in-process warning for every mod that ships code
 * rather than deriving one from `elevated` (mods.ts, capabilityConsentScreen),
 * and why no sentence in this file promises a mod CANNOT do something.
 */

import { parseCapability } from "@rpgm-tools/neo-angband-mod-sdk";

/** One capability rendered for consent: a human line plus a power flag. */
export interface CapabilityDescription {
  /** The raw capability string, verbatim. */
  cap: string;
  /** Plain-language statement of what enabling this grants. */
  text: string;
  /**
   * True for the powerful grants a user should weigh carefully: trusted
   * in-process system override (registry:*), network egress, and wildcard/broad
   * state reads. The UI highlights these.
   */
  elevated: boolean;
}

/** Describe one registry:<domain> override grant. */
function describeRegistry(domain: string): { text: string; elevated: boolean } {
  /* Keep this new front-end seam beside the long-lived core switch rather than
   * growing a measured dispatch table. The switch census deliberately records
   * that table's 15 core-style domains; menu data belongs to the web host. */
  if (domain === "menu") {
    return {
      text: "Rewrite one named game menu's semantic rows and layout",
      elevated: true,
    };
  }
  /* NOT elevated, on the same reasoning as registry:vocab: it is additive and
   * it cannot take anything away. A tile filler is only ever asked for content
   * the pack does not draw, and the door it writes through refuses an index
   * something already assigned - so the worst it can do is put a picture where
   * the player was seeing a letter. */
  if (domain === "tiles") {
    return {
      text: "Supply tiles for creatures and items your tile set does not draw",
      elevated: false,
    };
  }
  switch (domain) {
    case "*":
      return {
        text: "Override ANY game system - effects, level and dungeon generation, monster attacks, shops, commands, monster AI, what spells and breaths do, what a vault symbol means, and vocabulary (full trusted, in-process access)",
        elevated: true,
      };
    case "effect":
      return { text: "Override effect, combat, and magic logic", elevated: true };
    case "room":
      return { text: "Override dungeon / level generation", elevated: true };
    case "profile":
      return {
        text: "Add new kinds of dungeon level, and change which kind you get at a depth",
        elevated: true,
      };
    case "blow":
      return {
        text: "Change what monster attacks do to you, and add new kinds of attack",
        elevated: true,
      };
    case "store":
      return {
        text: "Change what shops buy from you and what they keep in stock",
        elevated: true,
      };
    case "command":
      return { text: "Change what player commands do (and add commands)", elevated: true };
    case "monster":
      return { text: "Override monster AI (take over monster turns)", elevated: true };
    case "projection":
      return {
        text: "Change what spells, breaths and other elements do to the dungeon, to items on the floor, and to you",
        elevated: true,
      };
    case "ui-entry":
      return {
        text: "Change how your resistances, abilities and stat modifiers are worked out and drawn on the character sheet and the equipment comparison",
        elevated: true,
      };
    case "glyph":
      return {
        text: "Change what the symbols in a room or vault layout mean when a level is drawn",
        elevated: true,
      };
    case "effect-info":
      return {
        text: "Change what the game tells you about a spell, potion or wand effect",
        elevated: true,
      };
    case "randart":
      return {
        text: "Change how random artifacts are built - what powers they can get, and what each kind of item starts with",
        elevated: true,
      };
    case "tval":
      return {
        text: "Teach the game about a new kind of item - whether it can be worn or wielded, how it is priced, and whether it has an unidentified flavour",
        elevated: true,
      };
    case "rune":
      return {
        text: "Teach the game about a new kind of RUNE - what it is called, what an item carries, and how the player learns it",
        elevated: true,
      };
    case "vocab":
      return {
        text: "Add new vocabulary - flags, stats, and other terms",
        elevated: false,
      };
    case "message":
      /* Additive vocabulary, same class as `vocab`: a mod appends its own MSG_
       * types after the compiled 153 and binds sample names to them. It can
       * also re-point a CORE message's samples, which is upstream's own
       * last-writer-wins behaviour for a second `sound:HIT:` line rather than
       * anything this seam invented - so a sound pack is the ordinary use, not
       * an elevated one. */
      return {
        text: "Add new message types, and choose which sounds play for them",
        elevated: false,
      };
    default:
      return { text: `Override the "${domain}" game system`, elevated: true };
  }
}

/**
 * Describe a single capability string. Never throws: an unrecognized string is
 * itself reported (as elevated) so a malformed manifest cannot hide a grant.
 */
export function describeCapability(cap: string): CapabilityDescription {
  let parsed;
  try {
    parsed = parseCapability(cap);
  } catch {
    return {
      cap,
      text: `Unrecognized capability "${cap}" (treated as high-risk)`,
      elevated: true,
    };
  }
  switch (parsed.kind) {
    case "command":
      return { cap, text: "Add new player commands", elevated: false };
    case "event":
      return { cap, text: `Observe the "${parsed.name}" game event`, elevated: false };
    case "state":
      return parsed.domain === "*"
        ? { cap, text: "Read ALL game state", elevated: true }
        : { cap, text: `Read ${parsed.domain} game state`, elevated: false };
    case "network":
      return parsed.host === "*"
        ? {
            cap,
            text: "Send network requests to ANY host (your data could leave this device)",
            elevated: true,
          }
        : {
            cap,
            text: `Send network requests to ${parsed.host}`,
            elevated: true,
          };
    case "registry": {
      const r = describeRegistry(parsed.domain);
      return { cap, text: r.text, elevated: r.elevated };
    }
    case "display":
      return {
        cap,
        text: "Draw the dungeon itself - everything you see of the map comes from this mod instead of the game",
        elevated: true,
      };
    case "backup":
      return {
        cap,
        text: "Write files into a folder you pick (it never learns the folder's real path, only whether a write succeeded)",
        elevated: false,
      };
    case "mod":
      /* BOTH HALVES OF THIS SENTENCE ARE LOAD-BEARING and neither is padding.
       * "Install mods" alone reads as "grant itself any capability it likes by
       * way of something it wrote", and that is not what the door does: it
       * refuses an archive that ships code or asks for capabilities, and what
       * arrives is switched off until the player has read its own list. A
       * consent line that left either out would be describing a much larger
       * grant than the one being made.
       *
       * THE SESSION ARM IS A DIFFERENT SENTENCE, not a softer version of this
       * one. "Switched off until you turn it on" is the whole reason the install
       * line is proportionate, and it is untrue of a session load: that one is on
       * as soon as the game reloads. Saying "just for this session" and stopping
       * there would be the lie this file exists not to tell - the archive is
       * forgotten, the records it composed were real, and anything they changed
       * about a character stays changed. */
      if (parsed.action === "session") {
        return {
          cap,
          text:
            "Put content mods into the game for the rest of this session - records and tweaks, never code - which " +
            "start working as soon as the game reloads, without waiting to be switched on. The mod is forgotten " +
            "when you close the game; what it did to a character is not",
          elevated: true,
        };
      }
      return {
        cap,
        text:
          "Add content mods to your library - records and tweaks, never code, and they arrive switched off until " +
          "you read what they ask for and turn them on yourself",
        elevated: true,
      };
    case "debug":
      /* SAID IN THE GAME'S OWN VOCABULARY, not the seam's. The player has already
       * been told once per character what the debug commands are and what using
       * them costs, in those words, so naming them here is the shortest route to
       * a grant they can actually picture. The score consequence is stated
       * because it is permanent and because nothing else on this list has one. */
      return {
        cap,
        text:
          "Conjure items and creatures into your game, the way the debug commands do - it asks first, and the " +
          "character it happens to is marked for good and can no longer be scored",
        elevated: true,
      };
    case "ui":
      /* Named, because the consent is worth exactly as much as the player's
       * ability to picture what changes. "Replace part of the interface" tells
       * them nothing; "your hit points, food and armour" tells them where to
       * look when it goes wrong. Elevated either way - it is their screen. */
      /* CREATE IS A DIFFERENT SENTENCE FROM REPLACE, and it needs its own arm
       * rather than a region name, because every name below is something the
       * player can already see and point at. This one is furniture that does
       * not exist yet.
       *
       * Until this landed the region arm fell through to the replace text and
       * told the player a region mod would "Draw the region part of the
       * interface instead of the game" - describing a takeover of something
       * they own, for a mod that only ADDS. It compiled, because the switch is
       * on `kind` and "region" is a legal region name, so nothing caught it:
       * a consent string is only checked by reading it. #261 */
      if (parsed.action === "create") {
        return {
          cap,
          text: "Add furniture of its own to your screen - panels this mod draws itself, over the map and beside the game's own",
          elevated: true,
        };
      }
      /* MOUNT IS A THIRD SENTENCE, and the wording is the part of this grant
       * that does any work. Everything else in the seam - the host-owned
       * container, the panel stack, the keyboard handoff, Escape - is
       * management, not containment: a plugin's code runs in the page and can
       * reach the document with or without this string (see capabilities.ts's
       * header, and capability-gate-reach.test.ts's measurement). So the one
       * thing this line must do is tell the player the two facts they would
       * otherwise have no way to learn - that what they are looking at may not
       * be the game, and that what they type into it is the mod's to read. It
       * deliberately does not say "mount a panel", which sounds like a bounded
       * rectangle and is not what is being agreed to. */
      if (parsed.action === "mount") {
        return {
          cap,
          text:
            "Draw its own interface over the game with real web pages - it can look exactly like the game's own screens, " +
            "cover them completely, and read whatever you type, paste or drop into it",
          elevated: true,
        };
      }
      return parsed.region === "*"
        ? {
            cap,
            text: "Draw the whole interface around the map - your messages, your vitals, the status line, every menu and every full screen all come from this mod",
            elevated: true,
          }
        : {
            cap,
            text: `Draw the ${uiRegionText(parsed.region)} instead of the game`,
            elevated: true,
          };
  }
}

/** What a player would call one HUD region, in the consent list. */
function uiRegionText(region: string): string {
  switch (region) {
    case "messages":
      return "message line at the top of the screen";
    case "sidebar":
      return "vitals panel - your hit points, food, armour and depth";
    case "status":
      return "status line along the bottom of the screen";
    case "menu":
      /* Not a region: every menu in the game, presented by this mod - which is
       * why the wording is about what the player will SEE change rather than
       * about a rectangle. The mod may leave most of them alone; the grant is
       * still over all of them, and that is what is being consented to. */
      return "menus and choices the game offers you";
    case "screen":
      /* Also not a region: the inventory, the character sheet, the knowledge
       * browser - the full-screen views. Same bargain as `menu`, and the same
       * reason for naming what changes rather than a rectangle. */
      return "full screens - your inventory, character sheet and the rest";
    default:
      return `"${region}" part of the interface`;
  }
}

/** Describe every capability a manifest requests, in declaration order. */
export function describeCapabilities(
  caps: readonly string[],
): CapabilityDescription[] {
  return caps.map(describeCapability);
}

/** True when any requested capability is one of the powerful (elevated) grants. */
export function hasElevatedCapability(caps: readonly string[]): boolean {
  return caps.some((c) => describeCapability(c).elevated);
}
