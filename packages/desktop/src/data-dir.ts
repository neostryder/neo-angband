/**
 * Where the writable tree lives: init.c's ANGBAND_DIR_* base, chosen per install.
 *
 * Upstream has exactly this decision and makes it at build time. `init.c`'s
 * `init_stuff` reads the `ANGBAND_PATH` environment variable if it is set, and
 * otherwise falls back to a compiled-in default; the Windows front end
 * (`main-win.c`) instead puts everything beside the executable, which is why a
 * downloaded Angband for Windows has always been effectively portable. So both
 * shapes are upstream's - the choice here is only *which one this launch gets*.
 *
 * Self-contained is the DEFAULT, not an option (ratified 2026-07-28): unless the
 * copy was put there by the installer, everything - config, saves, scores, dumps
 * and mods - lives in one folder with the executable, and nothing is smeared
 * across the OS user profile. That is upstream's Windows shape exactly: a
 * downloaded Angband is a folder with `angband.exe` and `lib/` beside it.
 *
 * Four shapes, in priority order:
 *
 *  1. `NEO_ANGBAND_DATA` - an explicit path. This is `ANGBAND_PATH`.
 *  2. A single-file portable launch: `PORTABLE_EXECUTABLE_DIR` (electron-builder's
 *     `portable` target) or `APPIMAGE` (an AppImage) names where the file the user
 *     actually double-clicked lives. The app itself unpacks to a temp directory in
 *     both cases, so `app.getPath("exe")` is NOT that place and must not be used
 *     for it.
 *  3. An opt-in marker: a `neo-angband-data` directory beside the executable.
 *     Makes an INSTALLED copy portable with no setting inside the game - make the
 *     folder, and the game uses it.
 *  4. A folder install (the `dir`/`zip` targets, and `install-portable.mjs`): the
 *     app is packaged, the installer did not leave its marker, and the folder is
 *     writable. This is the shape a player gets by unzipping the game into
 *     `C:\Games\Neo Angband`, and it is self-contained without being asked.
 *
 * Otherwise: Electron's per-user data directory. Two cases reach it, and both
 * want it - an installed copy (whose uninstaller would otherwise delete the
 * player's characters along with the program), and a folder the OS will not let
 * the game write to, such as one dragged into Program Files.
 *
 * macOS is deliberately excluded from shape 4. Data inside `Foo.app/Contents`
 * breaks the bundle's signature and is what a dmg install throws away on the next
 * upgrade; a Mac player who wants portable uses shape 1 or 3.
 *
 * This is a pure function over its inputs so it can be tested without launching
 * Electron. `main.ts` supplies the real ones once, before anything reads a path.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/** The directory name that holds everything the game writes. */
export const PORTABLE_MARKER = "neo-angband-data";

/** The environment variable that overrides everything. init.c's ANGBAND_PATH. */
export const DATA_ENV_VAR = "NEO_ANGBAND_DATA";

/**
 * The file the NSIS installer writes into its install directory.
 *
 * The discriminator has to be written by whoever CREATED the directory, because
 * an installed copy and an unzipped copy are otherwise the same thing on disk -
 * an executable with `resources/` beside it. So the installer marks its own work
 * (`build/installer.nsh`), and everything unmarked is treated as a folder the
 * player assembled and therefore owns.
 *
 * Marked the way round that fails safe: if the marker is somehow missing from an
 * installed copy, the game keeps data beside itself, which is recoverable. The
 * other way round - an unzipped folder wrongly judged "installed" - would scatter
 * data into the user profile after the player deliberately chose a portable copy.
 */
export const INSTALLED_MARKER = "installed.txt";

/**
 * Why the base is what it is. Reported to the player rather than kept secret:
 * "where are my saves" must be answerable without reading this file.
 */
export type DataBaseKind =
  /** NEO_ANGBAND_DATA named it. */
  | "env"
  /** Launched as a single-file portable executable or an AppImage. */
  | "portable"
  /** A neo-angband-data directory sits beside the executable. */
  | "marker"
  /** A packaged folder the installer did not create: the default. */
  | "folder"
  /** Electron's per-user application data directory. */
  | "user";

export interface DataBaseChoice {
  readonly base: string;
  readonly kind: DataBaseKind;
  /** True when the tree travels with the install rather than with the user. */
  readonly portable: boolean;
}

export interface DataBaseInputs {
  /** process.env, or just the variables named above from it. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Directory containing the running executable: dirname(app.getPath("exe")). */
  readonly exeDir: string;
  /** Electron's app.getPath("userData"). */
  readonly userData: string;
  /**
   * app.isPackaged. Shape 4 is only for a shipped folder: in a checkout the
   * executable is `node_modules/electron/dist/electron.exe`, and treating that as
   * a folder install would put a developer's characters inside node_modules,
   * where the next `pnpm install` deletes them.
   */
  readonly packaged: boolean;
  /** process.platform, for the macOS exclusion. */
  readonly platform: string;
  /** Existence test, injected so the resolution can be tested without a disk. */
  readonly isDir?: (p: string) => boolean;
  /** Same, for the installer's marker FILE. */
  readonly isFile?: (p: string) => boolean;
  /** Can the game create things in this directory? */
  readonly isWritable?: (p: string) => boolean;
}

function dirExists(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

function fileExists(p: string): boolean {
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

/**
 * Writable in the sense that matters: can a directory be CREATED here.
 *
 * `fs.accessSync(W_OK)` is the obvious call and is not enough on Windows, where
 * it reports success for directories the ACL will refuse a write in (it checks
 * only the read-only attribute). So the test is the operation itself.
 */
function canWrite(p: string): boolean {
  const probe = path.join(p, ".neo-probe");
  try {
    fs.mkdirSync(probe);
    fs.rmdirSync(probe);
    return true;
  } catch {
    return false;
  }
}

/** The first of the four shapes that applies, else the per-user directory. */
export function resolveDataBase(inputs: DataBaseInputs): DataBaseChoice {
  const isDir = inputs.isDir ?? dirExists;
  const isFile = inputs.isFile ?? fileExists;
  const isWritable = inputs.isWritable ?? canWrite;

  const explicit = (inputs.env[DATA_ENV_VAR] ?? "").trim();
  if (explicit !== "") {
    /* Resolved, so a relative path is not silently interpreted against whatever
     * directory the app happened to be launched from later on. */
    return { base: path.resolve(explicit), kind: "env", portable: true };
  }

  const portableDir = (inputs.env["PORTABLE_EXECUTABLE_DIR"] ?? "").trim();
  if (portableDir !== "") {
    return {
      base: path.join(path.resolve(portableDir), PORTABLE_MARKER),
      kind: "portable",
      portable: true,
    };
  }

  /* An AppImage names the FILE, not its directory - the Linux equivalent of the
   * same problem, since an AppImage also mounts itself somewhere temporary. */
  const appImage = (inputs.env["APPIMAGE"] ?? "").trim();
  if (appImage !== "") {
    return {
      base: path.join(path.dirname(path.resolve(appImage)), PORTABLE_MARKER),
      kind: "portable",
      portable: true,
    };
  }

  const beside = path.join(inputs.exeDir, PORTABLE_MARKER);
  if (isDir(beside)) {
    return { base: beside, kind: "marker", portable: true };
  }

  if (
    inputs.packaged &&
    inputs.platform !== "darwin" &&
    !isFile(path.join(inputs.exeDir, INSTALLED_MARKER)) &&
    isWritable(inputs.exeDir)
  ) {
    return { base: beside, kind: "folder", portable: true };
  }

  return { base: inputs.userData, kind: "user", portable: false };
}

/**
 * Is the chosen base actually writable?
 *
 * A portable install can easily land somewhere read-only - Program Files, a
 * mounted image, a network share - and the failure mode without this check is a
 * game that looks fine until the first save quietly fails. Upstream has the same
 * hazard and the same answer: `init.c` calls `create_needed_dirs` at startup and
 * `quit`s with a message if it cannot make them.
 *
 * Deliberately NOT a silent fallback to the per-user directory. Somebody who
 * made a `neo-angband-data` folder wants their data there; moving it elsewhere
 * without saying so is how a player loses a character and never learns where it
 * went.
 */
export function checkWritable(base: string): string | null {
  const probe = path.join(base, ".write-probe");
  try {
    fs.mkdirSync(base, { recursive: true });
    fs.writeFileSync(probe, "");
    fs.unlinkSync(probe);
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}
