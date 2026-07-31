/**
 * The `arg_*` globals, which upstream keeps in the UI layer:
 *
 *   arg_force_name  ui-birth.c:97
 *   arg_name        ui-prefs.c:41
 *   arg_wizard      ui-game.c:79
 *   arg_graphics    ui-prefs.c
 *   ANGBAND_SYS     init.c:84, set by main.c:536
 *
 * They live here for the same reason they live there: they are set once by
 * `main()` before anything is drawn, and read by screens. The PARSING is in core
 * (host/args.ts) because `main.c` is shared by every front end; this file is the
 * front end's copy of the resulting state.
 *
 * Mutable, deliberately. `arg_name` is not read-only in the C either -
 * ui-game.c:848 clears it (and `savefile`) when the savefile-selection menu
 * finds the front end's chosen name already in use and names are not forced.
 *
 * On the web build `host.argv()` is empty, so every value stays at its default
 * and every branch below takes the same arm it has always taken. That is the
 * reduced front end working correctly, not a special case: upstream's own
 * front ends that never set these read the same defaults.
 */

import { DEFAULT_LAUNCH_ARGS, host, parseLaunchArgs } from "@rpgm-tools/neo-angband-core";
import type { LaunchArgs, LaunchModule, LaunchOutcome } from "@rpgm-tools/neo-angband-core";

/**
 * modules[] (main.c:63-95) for this port: one display module, the canvas
 * terminal, shared by the web and desktop front ends because they are the same
 * renderer. The name is what `-m` matches and what `$SYS` expands to in a pref
 * file (ui-prefs.c:557), so it must be this port's own rather than borrowed from
 * one of upstream's - `[EQU $SYS sdl2]` in lib/customize/font.prf pulls in
 * font-sdl2.prf, which is not this terminal's font table.
 */
export const LAUNCH_MODULES: readonly LaunchModule[] = [
  { name: "web", help: "Canvas terminal (browser and desktop)" },
];

/** init.c:84's default. Replaced by the module that initialises the display. */
const ANGBAND_SYS_DEFAULT = "xxx";

let current: LaunchArgs = DEFAULT_LAUNCH_ARGS;
let sys = ANGBAND_SYS_DEFAULT;
/** arg_name, separately, because it is cleared during play. */
let argNameValue = "";

/**
 * main()'s option loop, run once at startup.
 *
 * Returns the outcome so a front end WITH a console can print usage and quit
 * (the desktop main process does exactly that, before any window exists, which
 * is where upstream does it too). A front end without one gets the same
 * defaults it had before there was an argv at all.
 */
export function initLaunchArgs(argv: readonly string[]): LaunchOutcome {
  const outcome = parseLaunchArgs(argv, { modules: LAUNCH_MODULES });
  /* Only a successful parse latches. On usage/quit upstream never reaches the
   * display module, so leaving the defaults in place is what the game would
   * have seen; on `list-saves` it exits. Either way the flags must not be
   * half-applied. */
  if (outcome.kind === "run") {
    current = outcome.args;
    argNameValue = outcome.args.name;
    /* main.c:534-540: ANGBAND_SYS becomes the module's name when it initialises.
     * A `-m` naming something else never matches, and upstream then quits with
     * "Unable to prepare any 'display module'!" rather than running with it. */
    const wanted = outcome.args.module;
    const picked = LAUNCH_MODULES.find((m) => wanted === null || m.name === wanted);
    sys = picked ? picked.name : ANGBAND_SYS_DEFAULT;
  }
  return outcome;
}

/** Read argv from the installed host and apply it. */
export function initLaunchArgsFromHost(): LaunchOutcome {
  return initLaunchArgs(host().argv());
}

/** Reset to the pre-launch state. Tests only. */
export function resetLaunchArgs(): void {
  current = DEFAULT_LAUNCH_ARGS;
  sys = ANGBAND_SYS_DEFAULT;
  argNameValue = "";
}

export function launchArgs(): LaunchArgs {
  return current;
}

/**
 * arg_force_name: "the front end has pinned this character's name, do not let
 * the player change it and do not ask for it".
 *
 * Read at NINE places in the C, which is why the `-f` switch is a feature and
 * not the single message the text census could see. Seven are wired:
 *   ui-birth.c:124    quick-start: 'C' (change name) is not offered
 *   ui-birth.c:711    the birth command replay uses arg_name, no random name
 *   ui-birth.c:1287   the name stage is skipped entirely
 *   ui-input.c:1342   get_file auto-names the dump instead of prompting
 *   ui-options.c:66   the pref-file dump confirms a name instead of asking
 *   ui-options.c:1222 ...and so does the pref-file load
 *   ui-player.c:1249  'c' on the character sheet refuses the rename
 *
 * The remaining two are inside get_savefile_selection (ui-game.c:846 and :855):
 * the menu does NOT clear savefile/arg_name when the name is forced, and it drops
 * the "New game" row because the pinned name is already in use. Both read a real
 * savefile DIRECTORY, which this port does not have yet - the roster lives in
 * browser storage - so they come with Phase 5 rather than being guessed at now.
 */
export function argForceName(): boolean {
  return current.forceName;
}

/** arg_name (-u<who>). */
export function argName(): string {
  return argNameValue;
}

/** ui-game.c:848 clears it; nothing else writes it after startup. */
export function setArgName(value: string): void {
  argNameValue = value;
}

/** arg_wizard (-w), passed to savefile_load (ui-game.c:733). */
export function argWizard(): boolean {
  return current.wizard;
}

/** arg_graphics (-g). 0 is "not requested". */
export function argGraphics(): number {
  return current.graphics;
}

/** ANGBAND_SYS, for a pref file's `$SYS`. */
export function angbandSys(): string {
  return sys;
}
