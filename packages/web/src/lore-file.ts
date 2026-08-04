/**
 * lore.txt, wired: the read at startup and the write on a deliberate save.
 *
 * WHY THIS IS NOT JUST A DUMP. Upstream's monster memory lives in the USER
 * directory, not in the savefile - `lore_save` from `save_game_checked`
 * (ui-game.c:1089), read back by `lore_parser` at startup. The user directory
 * belongs to the player, so monster knowledge SURVIVES DEATH: that is what makes
 * `tkills` "monsters killed in all lives" and what makes lore-describe's "your
 * ancestors have exterminated at least %d of the creatures" able to be true.
 *
 * The port kept the whole lore record in the JSON save, so the knowledge died
 * with the character and that sentence could never be about an ancestor. See
 * core/src/mon/lore-file.ts for the split this restores.
 *
 * WHEN IT IS WRITTEN. Upstream writes it from every `save_game_checked`, and
 * upstream saves when the player says so or on a level change. This port also
 * autosaves every three seconds during play, which has NO upstream counterpart -
 * it is a platform accommodation for a tab that can close - so it owes upstream
 * nothing. The file is written from the saves that ARE ports of `save_game` and
 * `save_game_checked`: the 'S' command, a level change, the options screen, and
 * close_game. A throttled tail autosave does not rewrite it.
 */

import { applyLoreFile, parseLoreFile, writeLoreEntries, LORE_FILE } from "@rpgm-tools/neo-angband-core";
import type { LoreStore, MonsterRace } from "@rpgm-tools/neo-angband-core";

import { userRead, userTextLinesToFile, userPath } from "./user-io";
import { log } from "./logging";

/**
 * Read lore.txt over a freshly started or loaded game's lore store.
 *
 * Never fatal, and never silent about what it could not use: a file that names
 * monsters this build does not have (a mod switched off since the last save) is
 * reported rather than being taken for an empty file.
 */
export function loadLoreFile(races: readonly MonsterRace[], store: LoreStore): void {
  let text: string | null;
  try {
    text = userRead(LORE_FILE);
  } catch (err) {
    /* A host read should not throw, but a host is injectable and this runs at
     * boot, where a throw is a canvas that never paints. */
    log.warn("lore", "could not read the monster memory file", err);
    return;
  }
  if (text === null) return; /* "No monster lore file found" (mon-init.c:2585). */

  try {
    const res = applyLoreFile(races, store, parseLoreFile(text));
    log.info(
      "lore",
      `${res.applied} race(s) from ${userPath(LORE_FILE)}` +
        (res.ignored ? `, ${res.ignored} drop/friends/mimic line(s) not modelled` : "") +
        (res.unknownRaces.length
          ? `, ${res.unknownRaces.length} for monster(s) this build does not have (${res.unknownRaces.slice(0, 5).join(", ")})`
          : ""),
    );
    /* A line the parser could not read is a bug in the writer or a corrupted
     * file, and either way naming it is the only way it gets fixed. */
    for (const line of res.bad.slice(0, 10)) log.warn("lore", `unreadable line: ${line}`);
  } catch (err) {
    log.warn("lore", "could not apply the monster memory file", err);
  }
}

/**
 * lore_save (mon-lore.c:1903): the whole memory through text_lines_to_file.
 *
 * Returns false on upstream's one failure - the staged file it could not create -
 * so the caller can print its message. Writing this is never worth losing a save
 * over, so a throw is caught and reported as a failure rather than propagating
 * into the save path that called it.
 */
export function saveLoreFile(races: readonly MonsterRace[], store: LoreStore): boolean {
  try {
    return userTextLinesToFile(LORE_FILE, writeLoreEntries(races, store)) === 0;
  } catch (err) {
    log.warn("lore", "could not write the monster memory file", err);
    return false;
  }
}
