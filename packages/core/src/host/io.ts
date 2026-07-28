/**
 * The host layer: z-file.c's file access and init.c's directory set, as an
 * interface core can be handed instead of a platform it has to guess at.
 *
 * WHY THIS EXISTS
 *
 * Upstream is not a browser program that happens to run on desktops; it is a
 * desktop program with several front ends (main-sdl2.c, main-gcu.c, main-win.c)
 * over ONE host layer (z-file.c) and ONE directory set (init.c's ANGBAND_DIR_*).
 * The port had the first half of that - a platform-agnostic core with the front
 * end in packages/web - but no second half: every feature that needed a file
 * asked the browser, got "no", and was then quietly reshaped to fit the answer.
 *
 * That reshaping is the bug. Measured on 2026-07-28, 18 of the 35 remaining
 * text-census absences exist only because there is no host filesystem, no argv
 * and no process to receive a signal - not because the C was hard to read. And
 * the damage is not limited to absences: a platform limit that goes unmodelled
 * turns into an invented stand-in (the "use the CLI" spoiler line, the PNG
 * screen dump), which is worse, because a stand-in FILLS the slot and neither
 * census can see it.
 *
 * So the host is a first-class, injectable seam with three adapters:
 *
 *   - desktop (Electron main process, real node:fs)  - full capability
 *   - cli     (node:fs directly)                     - full capability
 *   - web     (localStorage, one key per file)       - reduced, and SAYS so
 *
 * THE RULE THIS ENCODES: the reference C defines the semantics. A front end
 * either expresses them or is recorded as reduced, via `capabilities`. What a
 * front end cannot do must never edit what the game IS.
 */

/** file_mode (z-file.h L113-118). */
export enum FileMode {
  WRITE = 0,
  READ = 1,
  APPEND = 2,
}

/**
 * file_type (z-file.h L123-129). Upstream passes this so systems without file
 * extensions can tag the file; it reaches the platform through file_open_hook.
 * Kept because the HTML tag distinguishes the screen dump and disconnect.html
 * from the text dumps, and a host may want to act on that.
 */
export enum FileType {
  TEXT = 1,
  SAVE = 2,
  RAW = 3,
  HTML = 4,
}

/**
 * init.c's ANGBAND_DIR_* (init.h L229-241), minus the read-only gamedata roots
 * the port ships as bundled JSON rather than a tree on disk. These five are the
 * ones the game WRITES to, which is exactly the set a browser cannot provide.
 */
export enum HostDir {
  /** ANGBAND_DIR_USER: dumps, pref files, lore.txt, spoilers, the dev logs. */
  USER = "user",
  /** ANGBAND_DIR_SAVE: one savefile per character. */
  SAVE = "save",
  /** ANGBAND_DIR_PANIC: the signal handler's separate savefile. */
  PANIC = "panic",
  /** ANGBAND_DIR_SCORES: the shared score list. */
  SCORES = "scores",
  /** ANGBAND_DIR_ARCHIVE: retired characters' savefiles. */
  ARCHIVE = "archive",
}

/**
 * What a host can actually do. A screen reads this to decide which of
 * upstream's paths it can take; it must NEVER be used to decide what the game
 * means. Every field is a statement about the platform, not about the port.
 */
export interface HostCapabilities {
  /**
   * Files persist somewhere the user can see and other programs can reach. On
   * the web adapter this is false: localStorage is private to the origin and
   * evictable, so a mod manager cannot deploy into it and a "clear browsing
   * data" destroys it.
   */
  readonly realFiles: boolean;
  /** A process command line exists (main.c's switches: -f, -u, -w, -p, ...). */
  readonly argv: boolean;
  /** The host can be told the process is dying, so a panic save can be written. */
  readonly signals: boolean;
  /**
   * More than one terminal window can exist. Upstream's ANGBAND_TERM_MAX is 8
   * (ui-term.h:244); a single canvas is 1, which is why the port's subwindow
   * setup, its window: pref directive and its option_dump are all hollow.
   */
  readonly termCount: number;
  /** Directories can be listed and watched, so an on-disk mod tree can be found. */
  readonly directories: boolean;
}

/**
 * The write outcomes upstream's callers distinguish. file_open failing and
 * file_close failing are reported with DIFFERENT messages at the same call site
 * (wiz-spoil.c: "Cannot create spoiler file." vs "Cannot close spoiler file."),
 * so a host must be able to tell them apart rather than returning one boolean.
 */
export type WriteOutcome = "ok" | "create-failed" | "close-failed";

/**
 * z-file.c's file access, per directory. Paths are LEAF names within a HostDir,
 * not host paths: core never composes a path (that is path_build's job, and it
 * is host-specific), and a leaf-only API cannot traverse out of its directory.
 */
export interface HostIo {
  /** What this host can do. Checked, never assumed. */
  readonly capabilities: HostCapabilities;

  /**
   * path_build(dir, name) purely for DISPLAY - the text upstream prints in
   * prompts and messages ("Cannot open '%s'."). Never used to open anything.
   */
  displayPath(dir: HostDir, name: string): string;

  /** file_exists (z-file.h L135). */
  exists(dir: HostDir, name: string): boolean;

  /** file_open(MODE_READ) + a file_getl loop: the whole text, or null if absent. */
  read(dir: HostDir, name: string): string | null;

  /**
   * file_open(mode, ftype) + file_put + file_close, as one call. The two
   * failure modes stay distinct; see WriteOutcome.
   */
  write(
    dir: HostDir,
    name: string,
    text: string,
    mode?: FileMode,
    ftype?: FileType,
  ): WriteOutcome;

  /** file_delete (z-file.h L145). */
  remove(dir: HostDir, name: string): boolean;

  /** file_move (z-file.h L169). */
  move(dir: HostDir, from: string, to: string): boolean;

  /**
   * file_newer (z-file.h L174). This is the gate on upstream's panic-save
   * prompt (ui-game.c:709-720), so a host without timestamps must say so rather
   * than guess: null means "cannot tell", which is not the same as false.
   */
  newer(dir: HostDir, first: string, second: string): boolean | null;

  /** The directory listing. Upstream reaches this through its platform layer. */
  list(dir: HostDir): string[];

  /**
   * main.c's argv, minus the program name. Empty when capabilities.argv is
   * false - which is why ui-player.c:1250's "You are not allowed to change your
   * name!" (reachable only via -f / arg_force_name) has no way to fire on the
   * web adapter.
   */
  argv(): readonly string[];
}

/**
 * A host that has no directories at all: every read misses and every write
 * fails. This is what core falls back to when nothing was injected, so a
 * missing host is a reported failure rather than a thrown exception - the same
 * discipline z-file.c uses, where file_open just returns NULL.
 *
 * Deliberately NOT a silent success. A write that claims to have worked while
 * storing nothing is the failure mode already recorded against persistSave.
 */
export const NULL_HOST: HostIo = {
  capabilities: {
    realFiles: false,
    argv: false,
    signals: false,
    termCount: 1,
    directories: false,
  },
  displayPath: (dir, name) => `${dir}/${name}`,
  exists: () => false,
  read: () => null,
  write: () => "create-failed",
  remove: () => false,
  move: () => false,
  newer: () => null,
  list: () => [],
  argv: () => [],
};

let current: HostIo = NULL_HOST;

/** Install the host for this process. The front end calls this at startup. */
export function setHost(host: HostIo): void {
  current = host;
}

/** The installed host, or NULL_HOST if the front end never set one. */
export function host(): HostIo {
  return current;
}

/**
 * text_lines_to_file (z-textblock.c L703-737): write <name>.new, rotate it into
 * place over any existing file, and keep <name>.old only for the length of the
 * rename. Returns an `errr` exactly as the C does - 0 on success, -1 when the
 * staged file could not be opened - because callers read it that way:
 *
 *     if (text_lines_to_file(path, writer)) msg("Failed to create file %s.new", path);
 *
 * Lives here rather than in a front end because the staging sequence is host
 * behaviour that every adapter owes, and it was previously duplicated in the
 * web layer alone.
 */
export function textLinesToFile(
  io: HostIo,
  dir: HostDir,
  name: string,
  text: string,
): number {
  const newName = `${name}.new`;
  const oldName = `${name}.old`;

  /* Write new file (L714-724). */
  if (io.write(dir, newName, text) !== "ok") return -1;

  /* Move files around (L726-734). */
  if (!io.exists(dir, name)) {
    io.move(dir, newName, name);
  } else if (io.move(dir, name, oldName)) {
    io.move(dir, newName, name);
    io.remove(dir, oldName);
  } else {
    io.remove(dir, newName);
  }

  return 0;
}
