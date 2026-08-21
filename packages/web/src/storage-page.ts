/**
 * "Where your characters live": the screen that says, in one place, what will
 * destroy a roster.
 *
 * WHY A WHOLE SCREEN. Everything this game has ever saved lives in browser
 * storage - the roster in localStorage, the installed mods in IndexedDB - and on
 * the desktop build that is just as true, because the shell serves the same bundle
 * to a Chromium origin (save-transfer.ts has the measurement). The consequence is
 * not obvious to anybody who has not been told: a routine "clear browsing data",
 * a disk-cleanup tool, or a profile reset takes every character AND every
 * installed mod, at once, with no undo and nothing on disk to recover from. Under
 * decision 16 (death is permanent, there are no restore points) that is the
 * largest single risk to a player's game, and it is one they can avoid entirely
 * once they know about it.
 *
 * storage-persist.ts covers the OTHER half - the browser evicting the bucket on
 * its own - and `navigator.storage.persist()` fixes that half. It cannot fix this
 * one: persistence is protection from the browser's housekeeping, never from the
 * player's. So this screen exists to be read, and the character-select notice
 * exists to point at it.
 *
 * Pure builder, like report.ts and game-menu.ts: main.ts owns the painting, so
 * every line here can be asserted without a browser. The lines are written to fit
 * 80 columns, which is the whole terminal (a sliced row loses its END, and the end
 * of these rows is where the warning is).
 */

export type StorageTone = "head" | "text" | "warn" | "good" | "dim";

export interface StorageLine {
  readonly text: string;
  readonly tone: StorageTone;
}

export interface StoragePageInput {
  /** True for the Electron shell, which has a real folder to name. */
  readonly desktop: boolean;
  /** The desktop data folder, when the shell reported one. */
  readonly home?: string | undefined;
  /** The origin the roster is scoped to - a real site, or the loopback shell. */
  readonly origin: string;
  readonly characters: number;
  /** Installed mods, which share the same storage and the same fate. */
  readonly mods: number;
  /** Whether the origin is exempt from the browser's OWN eviction. */
  readonly persisted: boolean;
  /** navigator.storage.estimate(), when the engine will say. */
  readonly usage: number | null;
  readonly quota: number | null;
}

/** A byte count a player can read, up to the GB an origin quota is measured in. */
function size(bytes: number): string {
  const mb = bytes / 1_000_000;
  if (mb < 1) return `${(bytes / 1000).toFixed(0)} kB`;
  if (mb < 1000) return `${mb.toFixed(mb < 10 ? 1 : 0)} MB`;
  return `${(mb / 1000).toFixed(mb < 10_000 ? 1 : 0)} GB`;
}

/** "7 characters", "1 character", "no characters". */
function count(n: number, one: string, many: string): string {
  if (n === 0) return `no ${many}`;
  return `${String(n)} ${n === 1 ? one : many}`;
}

/**
 * The screen, top to bottom.
 *
 * Ordered by what a player needs first: what is at stake, then exactly what
 * destroys it, then what to do about it. The backup instruction is NOT last -
 * a reader who stops halfway should already have been told to export.
 */
export function storageLines(input: StoragePageInput): readonly StorageLine[] {
  const out: StorageLine[] = [];
  const add = (text: string, tone: StorageTone = "text"): void => {
    out.push({ text, tone });
  };

  add(
    `${count(input.characters, "character", "characters")} and ` +
      `${count(input.mods, "mod", "mods")} are stored here.`,
    "head",
  );
  add("");
  if (input.desktop) {
    add("Not as files you can browse. The game keeps them in its data folder:");
    add(`  ${input.home ?? input.origin}`, "dim");
    add("");
    add("You can copy that whole folder, while the game is closed, as a backup.");
  } else {
    add("Not as files on your computer. They belong to this site, in the");
    add("browser's own storage:");
    add(`  ${input.origin}`, "dim");
    add("");
    add("A different browser, a different profile, or a different address is a");
    add("different roster - these characters will not appear there.");
  }
  add("");

  add("WHAT DESTROYS ALL OF IT AT ONCE, with no undo:", "warn");
  add('  - "Clear browsing data" or "Clear site data" covering this site');
  add("  - A cleanup tool (Disk Cleanup, CCleaner, a browser extension, a");
  add('    "free up space" setting) or an automation that runs one for you');
  add(
    input.desktop
      ? "  - Deleting or moving the game's data folder, or uninstalling"
      : "  - Resetting the browser, or deleting its profile",
  );
  add("");
  add("That takes the MODS with the characters: both live in the same storage", "warn");
  add("for this site, so anything that reaches one reaches the other.", "warn");
  add("");
  add("Death is permanent in this game, so a character lost this way cannot be");
  add("recovered from anything except a file you exported yourself.");
  add("");
  add("SO EXPORT ONE: on the character list, Shift-X writes the highlighted", "good");
  add("character to a file. Shift-M reads one back, in any copy of the game.", "good");
  add("");

  /* The eviction half, reported rather than promised - and only ever as the
   * smaller of the two risks, because it is the one the game has already done
   * something about. */
  add(
    input.persisted
      ? "This site is marked persistent, so the browser will not clear it to"
      : "This site is NOT marked persistent, so the browser may clear it to",
    input.persisted ? "dim" : "warn",
  );
  add(
    input.persisted
      ? "reclaim space on its own. That is the only part of the above it covers."
      : "reclaim space on its own. Installing the game as an app usually earns it.",
    input.persisted ? "dim" : "warn",
  );
  if (input.usage !== null && input.quota !== null && input.quota > 0) {
    add(`Using ${size(input.usage)} of ${size(input.quota)} available here.`, "dim");
  }
  return out;
}
