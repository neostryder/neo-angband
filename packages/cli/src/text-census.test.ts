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
 *                the port keeps saves and scores in browser storage and hands dumps to
 *                the browser as downloads, so the C's file-error text has no
 *                counterpart. Not a gap.
 *   internal   - the C's own "please report this bug" diagnostics for malformed
 *                gamedata or an impossible argument. The port validates content
 *                when the pack is built and throws, so these are structurally
 *                unreachable rather than merely unwritten. Not a gap.
 *   divergence - a ratified difference in how the port works, recorded elsewhere.
 *                Re-derive these from the C before trusting one; the label is
 *                self-issued (see the memory note on ratified divergences), and
 *                the `capacity` and `dead-in-c` categories that used to sit here
 *                both turned out to be gaps under exactly that failure.
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
  "host-io: scorefile is a file on disk; the port keeps the score table in browser storage (packages/web/src/score.ts)":
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

  "GAP (re-audited): malformed-gamedata diagnostics. My earlier reason - the port validates the pack at build time, so a live game cannot reach these - holds for the CORE pack and is wrong for MODS. A mod pack is loaded at runtime and can ship a spell with no message-vis, an effect name the registry does not know, or a flag with no object_property entry, which is exactly when upstream prints these. They are the mod SDK's diagnostic surface and belong there rather than as msg() lines; tracked as one job, not sixteen":
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

  "divergence (re-derived from the C 2026-07-27, upheld): the prompt exists because upstream's savefile PATH is derived from the character name - savefile_name_already_used (ui-game.c:1016) calls savefile_set_name(fname) and then file_exists on the result - so two characters of one name are one file. The port's roster keys each slot by a UUID (web/src/roster.ts newCharId / SLOT_PREFIX + id) and nothing dedupes on name, so a repeated name collides with nothing and there is no file to overwrite":
    ["A savefile for that name exists.  Overwrite it? "],

  "divergence (re-derived from the C 2026-07-27, upheld): start_game (ui-game.c:709-720) offers the panic file only when file_newer(panicfile, loadpath) - it can be newer because upstream's ordinary save happens on demand, so a crash leaves the signal handler's separate savefile_get_panic_name file ahead of it. The port autosaves the one slot continuously, so there is no second artifact and no staleness window for one to be newer than":
    ["A panic save exists.  Use it? "],

  "GAP (block E): lore_save writes a human-readable lore.txt to the user directory (mon-lore.c:1904, called from ui-game.c:1089). The port has no lore dump at all - the monster memory lives in the save - so this belongs with the other dump equivalents rather than with the save-failure handling, which is now ported":
    ["lore save failed!"],

  "GAP: single missing lines, each a small fix in an existing function":
    [
      "Cancelled.", // ui-game.c:663
      "Are you sure? ", // ui-input.c:2014
      "Do you want to quit? ", // ui-death.c:411
      "You are not allowed to change your name!", // ui-player.c:1250
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
