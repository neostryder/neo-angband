/**
 * Plain-language descriptions of mod capabilities, for the W2.4 consent prompt.
 *
 * A manifest's `capabilities` are terse machine strings (capabilities.ts
 * vocabulary: command:add, event:<name>, state:<domain>.read, network:<host>,
 * registry:<domain>). Before a user enables a plugin the manager must show, in
 * human terms, exactly what it is being allowed to do - and flag the powerful
 * ones (in-process system override, network egress, broad state reads) so
 * consent is informed. This module is the single source of that mapping; it is
 * pure so it can be unit-tested and reused by any host (web or Electron).
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
