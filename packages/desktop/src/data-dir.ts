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
 * Three shapes, in priority order:
 *
 *  1. `NEO_ANGBAND_DATA` - an explicit path. This is `ANGBAND_PATH`.
 *  2. A portable launch: `PORTABLE_EXECUTABLE_DIR` is exported by
 *     electron-builder's `portable` target and names the directory the user's
 *     single .exe actually sits in (the app itself unpacks to a temp directory,
 *     so `app.getPath("exe")` is NOT that place and must not be used for it).
 *  3. An opt-in marker: a `neo-angband-data` directory beside the executable.
 *     This is how an unzipped or installed copy is turned portable without any
 *     setting inside the game - make the folder, and the game uses it. It also
 *     covers the `zip`/`dir` targets, where the exe already sits in its own
 *     self-contained folder.
 *
 * Otherwise: Electron's per-user data directory, which is where an installed
 * desktop game's savefiles belong.
 *
 * This is a pure function over its inputs so it can be tested without launching
 * Electron. `main.ts` supplies the real ones once, before anything reads a path.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/** The directory name that opts an install into keeping data beside itself. */
export const PORTABLE_MARKER = "neo-angband-data";

/** The environment variable that overrides everything. init.c's ANGBAND_PATH. */
export const DATA_ENV_VAR = "NEO_ANGBAND_DATA";

/**
 * Why the base is what it is. Reported to the player rather than kept secret:
 * "where are my saves" must be answerable without reading this file.
 */
export type DataBaseKind =
  /** NEO_ANGBAND_DATA named it. */
  | "env"
  /** Launched as the portable executable. */
  | "portable"
  /** A neo-angband-data directory sits beside the executable. */
  | "marker"
  /** Electron's per-user application data directory. */
  | "user";

export interface DataBaseChoice {
  readonly base: string;
  readonly kind: DataBaseKind;
  /** True when the tree travels with the install rather than with the user. */
  readonly portable: boolean;
}

export interface DataBaseInputs {
  /** process.env, or the two variables from it. */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Directory containing the running executable: dirname(app.getPath("exe")). */
  readonly exeDir: string;
  /** Electron's app.getPath("userData"). */
  readonly userData: string;
  /** Existence test, injected so the resolution can be tested without a disk. */
  readonly isDir?: (p: string) => boolean;
}

function dirExists(p: string): boolean {
  try {
    return fs.statSync(p).isDirectory();
  } catch {
    return false;
  }
}

/** The first of the three shapes that applies, else the per-user directory. */
export function resolveDataBase(inputs: DataBaseInputs): DataBaseChoice {
  const isDir = inputs.isDir ?? dirExists;

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

  const beside = path.join(inputs.exeDir, PORTABLE_MARKER);
  if (isDir(beside)) {
    return { base: beside, kind: "marker", portable: true };
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
