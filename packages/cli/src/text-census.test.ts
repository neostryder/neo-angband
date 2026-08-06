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
import { runCensus } from "./text-census.js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Literal -> why it is absent. Keys are the C literal, verbatim. */
const KNOWN_ABSENT: Record<string, readonly string[]> = {
  "not-in-this-port (measured 2026-08-01): do_cmd_try_borg's consent gate (cmd-misc.c:125-140). Upstream the borg is compiled into the game and reached by a debug command, so the game itself has to warn you before handing it your character. Here the Borg is a MOD in its own repository, installed through the mod manager and switched on by its own \"Let the Borg play\" toggle, so there is no engine command to gate and no engine-side prompt to port - the consent is the install, and the toggle says what it does. The sibling debug-command gate IS ported, verbatim, in packages/web/src/wizard.ts. These two were counted present until 2026-08-01 only because packages/borg lived in this repository and quoted them":
    [
      "You are about to use the dangerous, unsupported, borg commands!",
      "Are you sure you want to use the borg commands? ",
    ],

  "divergence (derived from the C 2026-07-28): both belong to parts of do_cmd_save_screen the port has no counterpart for. \"Include monster list? \" (ui-command.c:558) is asked only when find_first_subwindow(PW_MONLIST) finds a monster-list SUBWINDOW to dump beside the main terminal, and the port has no subwindows at all - html_screenshot's other_term argument is always NULL here. \"Screen dump failed.\" (ui-command.c:510) reports the failure to write dump.prf, the temporary pref file upstream saves so it can reset_visuals(false) to raw attr/char for the dump and restore the graphics prefs afterwards (L504-528); the port's snapshotColored() already returns attr/char rather than pixels, so there is nothing to switch and nothing to preserve. The dump's OWN write failure is reported, with html_screenshot's own message (\"Cannot write the '%s' file!\", L324)":
    ["Include monster list? ", "Screen dump failed."],

  "not-in-this-build (derived from the C 2026-07-28): pricing.log sits inside `#ifdef PRICE_DEBUG` (obj-power.c:1117-1206), and PRICE_DEBUG is defined NOWHERE in the tree - not in configure.ac, not in any Makefile - so it is a hand-edit-only switch and these two lines cannot be reached by any shipped 4.2.6 build. Same class as the USE_STATS collectors, which the port already reports honestly through STATS_DISABLED_MSG":
    [
      "Error - can't open pricing.log for writing.",
      "Error - can't close pricing.log file.",
    ],

  "GAP (block E): the wiz-stats reporting half, all of it behind USE_STATS (configure.ac:258, \"default: disabled\"), so the interactive build correctly says STATS_DISABLED_MSG - but packages/cli IS the port's stats build, and there the equivalents are owed. stats.log is the Monte-Carlo report (wiz-stats.c:1214); the last five are disconnect_stats' output (wiz-stats.c:3137-3153): the five tallies, disconnect.html written through dump_level_header + a dump_level_body per problem level with a composed label and the distance array, and disconnect_gstat.txt from dump_generation_stats. dump_level is now ported (core game/dump-level.ts) including its dist[] '*' marking, which is exactly what this report needs; disconnectStats (cli/wiz-stats.ts) computes the tallies but returns only counts":
    [
      "Error - can't open stats.log for writing.",
      "Error - can't close stats.log file.",
      "Results are also recorded in %s.",
      "Map is in disconnect.html.",
      "Level generation statistics are in disconnect_gstat.txt",
      "Total levels with bad starts: %ld",
      "Total levels with disconnected areas: %ld",
      "Total levels isolated from stairs: %ld",
    ],

  "GAP (re-audited): malformed-gamedata diagnostics. My earlier reason - the port validates the pack at build time, so a live game cannot reach these - holds for the CORE pack and is wrong for MODS. A mod pack is loaded at runtime and can ship a spell with no message-vis, an effect name the registry does not know, or a flag with no object_property entry, which is exactly when upstream prints these. They are the mod SDK's diagnostic surface and belong there rather than as msg() lines; tracked as one job, not sixteen. CORRECTION 2026-07-28: this list held 16 and one of them did not belong. \"Sorry, could not deal with suffix\" (player-birth.c:1071) is not a gamedata diagnostic at all - player_birth bumps the previous character's roman-numeral suffix before any menu runs, and the message reports int_to_roman running out of NAME BUFFER, which any long-named player reaches in stock play. It was absent because the whole dynastic bump was: incrementNameSuffix existed in core with no caller anywhere, so the port always offered a blank name. Now wired (web/src/birth.ts previousName + msg). Re-derive the remaining 13 before building a validator on this premise. SECOND CORRECTION, same day: two more left this list by being PORTED rather than reclassified - flag_message's pair (obj-properties.c:98-105), which are reachable through a mod that removes or mistypes an object_property record and so needed no validator at all. Pulling on them found three defects the census could not see: an invented %s substitution, tags other than {name} left in the text instead of dropped, and a p->upkeep->playing gate the port had moved off two call sites onto all four (suppressing messages upstream sends). That is the eighth time a missing-message block turned out to sit on a behaviour defect, so treat every remaining entry here as a lead rather than a decided reason":
    [
      "No message-invis for monster spell %d cast by %s.  Please report this bug.",
      "No message-miss for monster spell %d cast by %s.  Please report this bug.",
      "No message-vis for monster spell %d cast by %s.  Please report this bug.",
      "Bad effect description passed to effect_info().  Please report this bug.",
      "Bad effect description passed to effect_get_menu_name().  Please report this bug.",
      "Mismatched count and effect list passed to effect_menu_new().  Please report this bug.",
      "Non-existent glyph requested. Please report this bug.",
      "ERROR: Effect handler not found for %s.",
      "Bug: TELEPORT_TO:SELF effect used that is not cast by a monster.",
      "No object: %d:%d (%s)",
      "Could not find %s shape!",
      "Could not find shape %d!",
      "%s has misconfigured digging chance; please report this bug.",
    ],

  "divergence (re-derived from the C 2026-07-27, upheld): the prompt exists because upstream's savefile PATH is derived from the character name - savefile_name_already_used (ui-game.c:1016) calls savefile_set_name(fname) and then file_exists on the result - so two characters of one name are one file. The port's roster keys each slot by a UUID (web/src/roster.ts newCharId / SLOT_PREFIX + id) and nothing dedupes on name, so a repeated name collides with nothing and there is no file to overwrite":
    ["A savefile for that name exists.  Overwrite it? "],

  "divergence (re-derived from the C 2026-07-27, upheld): start_game (ui-game.c:709-720) offers the panic file only when file_newer(panicfile, loadpath) - it can be newer because upstream's ordinary save happens on demand, so a crash leaves the signal handler's separate savefile_get_panic_name file ahead of it. The port autosaves the one slot continuously, so there is no second artifact and no staleness window for one to be newer than":
    ["A panic save exists.  Use it? "],

  /* "lore save failed!" was a block-E GAP entry here until 2026-08-03. It is
   * gone rather than annotated, because that is what this file's second test
   * demands of a string the port now emits - and lore_save is ported
   * (core/src/mon/lore-file.ts, wired in web/src/lore-file.ts). It was
   * mis-classified as a dump: the user directory outlives a character, so
   * upstream's monster memory survives death, which is what makes tkills
   * "killed in all lives" real. The port had kept the whole record in the
   * savefile, so nothing carried. */

  "GAP (block I): the glyph picker's code-point prompt, and behind it the whole visuals editor. glyph_command + display_glyphs (ui-knowledge.c:597-752) let the knowledge menus re-map any monster / object / feature / trap glyph: 'v' opens a picker, the arrows cycle colour, 'i' takes a hex code point, 'c'/'p' copy and paste, and every row shows its own attr/char. The port has no runtime x_attr/x_char override layer at all - visuals/tile-prefs.ts TileMap covers the GRAPHICS mapping only - so this needs that layer, the renderer reading it, and the picker UI":
    ["(up to 5 hex digits):"],

  "divergence (derived from the C 2026-07-28): the only way upstream reaches this get_check is a FAILED cmdq_push inside the do_cmd_wiz_play_item session (cmd-wizard.c:1723-1799) - the [c]urse / [s]tatistics / [r]eroll / [t]weak / [q]uantity keys each push a command, and cmdq_push returns non-zero only when the fixed command queue (CMD_QUEUE_SIZE, cmd-core.c) is full. The port has no command queue on that path: runPlayItem awaits the sub-flow directly in the same function, so there is no push, no full queue, and no way for the failure branch to fire. The two done_msg lines behind the same failure (Bailed out. / Couldn't queue command.) are unreachable for the same reason. If wizard commands are ever put on a real queue, all three come back with it":
    ["Couldn't proceed.  Stop playing with item and lose all changes? "],
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
