/**
 * THE RATCHET on unported player-visible text.
 *
 * text-census.ts enumerates every string literal the C hands to a player-facing
 * call and checks the port contains it. This test fails if any of them is
 * missing WITHOUT an entry below saying why. That is the whole point: the port
 * has been declared complete several times and then found, by playing it, to be
 * missing messages a reviewer had no way to see. From here, a message that is
 * absent is either fixed or written down.
 *
 * It also fails in the OTHER direction - a stale entry here whose text the port
 * now has must be deleted - so the list cannot rot into a pile of excuses.
 *
 * WHAT THIS IS NOT: it proves the text EXISTS somewhere in the port, not that it
 * fires on the right event with the right message type. Presence is a floor, not
 * parity.
 *
 * Reason keys below are prefixed by category:
 *   host-io    - the C reads/writes a host file. The browser has no filesystem;
 *                the port keeps saves and scores in IndexedDB and hands dumps to
 *                the browser as downloads, so the C's file-error text has no
 *                counterpart. Not a gap.
 *   internal   - the C's own "please report this bug" diagnostics for malformed
 *                gamedata or an impossible argument. The port validates content
 *                when the pack is built and throws, so these are structurally
 *                unreachable rather than merely unwritten. Not a gap.
 *   capacity   - upstream's fixed-array housekeeping (monster compaction). The
 *                port uses growable collections, so the pass does not exist.
 *   dead-in-c  - dead code in Angband 4.2.6 itself: nothing calls it there
 *                either, so there is no behaviour to port.
 *   divergence - a ratified difference in how the port works, recorded elsewhere.
 *   GAP        - a real missing message. Tracked, not excused. Each says what it
 *                needs.
 */

import { describe, expect, it } from "vitest";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { runCensus } from "./text-census";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Literal -> why it is absent. Keys are the C literal, verbatim. */
const KNOWN_ABSENT: Record<string, readonly string[]> = {
  "host-io: scorefile is a file on disk; the port keeps the score table in IndexedDB (packages/web/src/score.ts)":
    [
      "Lock file in place for scorefile; not writing.",
      "Failed to create lock for scorefile; not writing.",
      "Failed to open new scorefile for writing.",
      "Failed to write new scores.",
      "Failed to close new scores.",
      "Couldn't delete old scorefile",
      "Couldn't move old scores.raw out of the way",
      "Couldn't rename new scorefile to scores.raw",
    ],

  "host-io: pref/keymap/visual files (.prf) on disk; the port persists these in browser storage":
    [
      "Failed to save %s.",
      "Visual attr/char tables reset.",
      "Failed to load '%s'!",
      "Loaded '%s'.",
      "Failed to create file %s",
      "Parse error in %s line %d column %d: %s: %s",
      "File name: ",
      "Replace existing file? ",
    ],

  "host-io: html/text dumps written to disk; the port offers them as browser downloads":
    [
      "Level dumped to %s.",
      "Level dumped to %s.html",
      "%s screen dump saved.",
      "Include monster list? ",
      "Failed to create file %s.new",
      "Cannot open '%s'.",
    ],

  "host-io: developer log files (pricing.log, randart.log, stats.log, spoilers) - the port's equivalents are pnpm --filter cli scripts writing through node:fs":
    [
      "Error - can't open pricing.log for writing.",
      "Error - can't close pricing.log file.",
      "Error - can't open randart.log for writing.",
      "Error - can't close randart.log file.",
      "Error - can't open stats.log for writing.",
      "Error - can't close stats.log file.",
      "Results are also recorded in %s.",
      "Cannot create spoiler file.",
      "Cannot close spoiler file.",
      "Successfully created a spoiler file.",
      "Map is in disconnect.html.",
      "Level generation statistics are in disconnect_gstat.txt",
      "Statistics generation not turned on in this build.",
      "Total levels with bad starts: %ld",
      "Total levels with disconnected areas: %ld",
      "Total levels isolated from stairs: %ld",
    ],

  "internal: malformed-gamedata diagnostics. The port validates the content pack at build time (packages/content) and throws on a bad record, so a live game cannot reach these":
    [
      "No message-invis for monster spell %d cast by %s.  Please report this bug.",
      "No message-miss for monster spell %d cast by %s.  Please report this bug.",
      "No message-vis for monster spell %d cast by %s.  Please report this bug.",
      "Bad effect description passed to effect_info().  Please report this bug.",
      "Bad effect description passed to effect_get_menu_name().  Please report this bug.",
      "Bug: invalid flag index, %d, passed to flag_message().",
      "Bug: flag '%s' (index %d) noticed but has no entry in object_property.txt.",
      "Mismatched count and effect list passed to effect_menu_new().  Please report this bug.",
      "Non-existent glyph requested. Please report this bug.",
      "ERROR: Effect handler not found for %s.",
      "Bug: TELEPORT_TO:SELF effect used that is not cast by a monster.",
      "No object: %d:%d (%s)",
      "Could not find %s shape!",
      "Could not find shape %d!",
      "%s has misconfigured digging chance; please report this bug.",
      "Sorry, could not deal with suffix",
    ],

  "capacity: compact_monsters is upstream's fixed mon_max array housekeeping; the port's monster list grows, so there is no compaction pass to announce":
    [
      "Compacting monsters...",
      "Too many monsters!",
      "Warning! Could not allocate a new monster.",
    ],

  "dead-in-c: player_restore_mana (player.c:351) has no callers anywhere in 4.2.6 - the effect handlers all take the RESTORE_MANA path in effect-handler-general.c, whose own message the port does have":
    ["You feel some of your energies returning."],

  "divergence: the Borg ships as a mod with its own UI, so there is no \"you are about to use the unsupported borg commands\" gate to pass (docs/BORG_AS_MOD.md)":
    [
      "You are about to use the dangerous, unsupported, borg commands!",
      "Are you sure you want to use the borg commands? ",
    ],

  "divergence: the port identifies a save by character id, not by filename, so two characters may share a name and there is no savefile to overwrite (docs/INSTALL.md, save export/import)":
    ["A savefile for that name exists.  Overwrite it? "],

  "divergence: no panic save. The port autosaves to IndexedDB continuously, so there is no separate panic file to offer on next launch":
    ["A panic save exists.  Use it? "],

  "GAP: guard messages upstream needs because a command can name a store the player is not in. The port's shop screens only offer buy/sell while a store is open, so no command can reach these - but that is an argument from the current UI, not from the C, and a mod adding remote trade would need them":
    [
      "You cannot purchase items when not in a store.",
      "You cannot buy that item because it's not in the store.",
      "You cannot afford that purchase.",
      "You are not currently at home.",
      "You cannot retrieve that item because it's not in the home.",
      "You cannot sell items when not in a store.",
      "I do not wish to purchase this item.",
      "You are not in your home.",
      "You see no store here.",
    ],

  "GAP: move_player's KNOWN-grid blocked branch (cmd-cave.c:1108-1130). Reached only when something OTHER than a deliberate walk drives move_player - the run loop (player-path.c:2042) and the whirlwind effect (effect-handler-attack.c:1838). The unknown-grid half is ported (game/player-turn.ts, walk-blocked.test.ts); this half needs those two call sites routed through the same block":
    [
      "There is a pile of rubble blocking your way.",
      "There is a door blocking your way.",
      "There is a wall blocking your way.",
    ],

  "GAP: save-failure handling (ui-game.c:1091-1155). An IndexedDB write CAN fail on a quota error, and the port neither retries nor says so":
    ["lore save failed!", "death save failed!", "Saving failed.  Try again? "],

  "GAP: needs drop_near's `verbose` parameter (obj-pile.c:1128-1152) threaded through the port's 15 dropNear call sites, plus floorCarry reporting whether the resulting stack is ignorable":
    ["You feel something roll beneath your feet."],

  "GAP: single missing lines, each a small fix in an existing function":
    [
      "No apparent path for exploration.", // the explore command, cmd-cave.c:1542
      "There is a scream and the door slams shut!", // cmd-cave.c:1595
      "That item is not within your reach.", // do_cmd_fire, player-attack.c:1339
      "Cancelled.", // ui-game.c:663
      "Are you sure? ", // ui-input.c:2014
      "Keep this keymap? ", // the keymap editor, ui-options.c:692
      "Do you want to quit? ", // ui-death.c:411
      "You are not allowed to change your name!", // ui-player.c:1250
      "Generation restarted: %s.", // generate.c:1165
      "Failed to place player; please report.  Restarting generation.", // gen-util.c:422
      "(up to 5 hex digits):", // the visuals editor, ui-knowledge.c:707
      "Enter 2 or 3 (for stat) character code and return or return to clear ", // ui-equip-cmp.c:1237
    ],

  "GAP: wizard/debug command prompts (cmd-wizard.c, wiz-debug.c, generate.c:831). In scope - the exact-parity mandate covers wizard mode and the cheat options - but the port's debug menu drives most of these without asking for their parameters":
    [
      "Acquire great objects? ",
      "Zap within what distance? ",
      "Number of simulations: ",
      "Stop if disconnected level found? ",
      "Type of Sim: Diving (1) or Clearing (2) ",
      "Regen randarts (warning SLOW)? ",
      "Number of simulations per depth: ",
      "Pit type (1-3): ",
      "Minimum depth: ",
      "Maximum depth: ",
      "Create instant artifacts? ",
      "Create which trap? ",
      "Enter curse name or index: ",
      "Enter curse power (0 removes): ",
      "Title for map: ",
      "Experience: ",
      "Choose cave profile? ",
      "Learn object kinds up to level (0-100)? ",
      "Do which effect: ",
      "Couldn't proceed.  Stop playing with item and lose all changes? ",
      "That was an invalid selection.  Use one of fobuztcdhmqgpra .",
      "Press any key.",
      "Which monster? ",
      "No monster found.",
      "Creating a lot of %s items.  Base level = %d.",
      "Summon which monster? ",
      "How many monsters? ",
      "Teleport range? ",
      "Enter ego item: ",
      "Enter new artifact: ",
      "Profile name (eg classic): ",
      "The air around you stops swirling...",
    ],
};

const ACCOUNTED = new Set(Object.values(KNOWN_ABSENT).flat());

describe("upstream text census (reference/src -> the port)", () => {
  const { calls, missing } = runCensus(ROOT);
  const absent = missing.map((m) => m.text);

  it("finds a substantial body of player-visible text to check", () => {
    /* A floor, not an exact count: upstream's literal set is fixed at 4.2.6, so
     * a large drop here means the extractor broke, not that the C changed. */
    expect(calls.length).toBeGreaterThan(600);
  });

  it("has no player-visible C text missing from the port without a reason", () => {
    const unaccounted = missing.filter((m) => !ACCOUNTED.has(m.text));
    const report = unaccounted
      .map((m) => `  ${m.file}:${m.line} ${m.fn}: ${JSON.stringify(m.text)}`)
      .join("\n");
    expect(
      unaccounted.length,
      unaccounted.length === 0
        ? ""
        : `\n${unaccounted.length} player-visible upstream string(s) are absent from the port and\n` +
          `not listed in KNOWN_ABSENT. Either port the message, or add it there with\n` +
          `the reason it does not apply:\n\n${report}\n`,
    ).toBe(0);
  });

  it("has no stale KNOWN_ABSENT entries", () => {
    const absentSet = new Set(absent);
    const stale = [...ACCOUNTED].filter((t) => !absentSet.has(t));
    expect(
      stale.length,
      stale.length === 0
        ? ""
        : `\nThe port now contains these strings, so their KNOWN_ABSENT entries are\n` +
          `stale and must be deleted:\n\n${stale
            .map((t) => `  ${JSON.stringify(t)}`)
            .join("\n")}\n`,
    ).toBe(0);
  });
});
