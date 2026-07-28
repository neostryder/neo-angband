/**
 * The data-base decision, exercised without launching Electron.
 *
 * The reason this is worth a test file of its own: the base directory chosen at
 * startup is where a player's savefiles live for the lifetime of an install, and
 * under the no-save-scumming policy a wrong answer is unrecoverable character
 * loss rather than an inconvenience. It has already been wrong once - Electron
 * derived it from the scoped package name and put saves in a directory called
 * "@neo-angband/desktop".
 */

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  DATA_ENV_VAR,
  PORTABLE_MARKER,
  checkWritable,
  resolveDataBase,
} from "./data-dir";

const EXE_DIR = path.resolve("/apps/neo-angband");
const USER_DATA = path.resolve("/users/somebody/AppData/Roaming/Neo Angband");

/** No marker on disk unless a test says otherwise. */
const base = (
  env: Record<string, string | undefined> = {},
  markers: readonly string[] = [],
) =>
  resolveDataBase({
    env,
    exeDir: EXE_DIR,
    userData: USER_DATA,
    isDir: (p) => markers.includes(p),
  });

describe("resolveDataBase", () => {
  it("uses the per-user directory for an ordinary installed copy", () => {
    expect(base()).toEqual({
      base: USER_DATA,
      kind: "user",
      portable: false,
    });
  });

  it("goes portable when a marker directory sits beside the executable", () => {
    const marker = path.join(EXE_DIR, PORTABLE_MARKER);
    expect(base({}, [marker])).toEqual({
      base: marker,
      kind: "marker",
      portable: true,
    });
  });

  it("does not go portable for a marker somewhere else", () => {
    /* Only the executable's own directory counts; a same-named folder in the
     * user's Documents must not silently capture the install. */
    expect(base({}, [path.resolve("/somewhere/else", PORTABLE_MARKER)]).kind).toBe(
      "user",
    );
  });

  it("uses PORTABLE_EXECUTABLE_DIR, not the exe directory, for a portable launch", () => {
    /* The portable .exe unpacks itself to a temp directory, so app.getPath("exe")
     * is inside that temp copy and would put the player's saves somewhere the OS
     * deletes. electron-builder exports the real location. */
    const stick = path.resolve("/media/usb/games");
    const r = base({ PORTABLE_EXECUTABLE_DIR: stick });
    expect(r).toEqual({
      base: path.join(stick, PORTABLE_MARKER),
      kind: "portable",
      portable: true,
    });
    expect(r.base.startsWith(EXE_DIR)).toBe(false);
  });

  it("lets the environment variable override every other shape", () => {
    const chosen = path.resolve("/opt/angband-data");
    const marker = path.join(EXE_DIR, PORTABLE_MARKER);
    const r = base(
      {
        [DATA_ENV_VAR]: chosen,
        PORTABLE_EXECUTABLE_DIR: path.resolve("/media/usb"),
      },
      [marker],
    );
    expect(r).toEqual({ base: chosen, kind: "env", portable: true });
  });

  it("resolves a relative environment path immediately", () => {
    /* Left relative, it would be interpreted against whatever the working
     * directory happens to be when the first file is written - which for a
     * shortcut-launched app is not where the player thinks they are. */
    const r = base({ [DATA_ENV_VAR]: "saves-here" });
    expect(path.isAbsolute(r.base)).toBe(true);
    expect(r.base).toBe(path.resolve("saves-here"));
  });

  it("ignores blank and whitespace-only environment values", () => {
    /* An unset variable read through a shell often arrives as "" rather than
     * undefined, and "" resolves to the working directory - the single worst
     * available answer. */
    for (const blank of ["", "   ", "\t"]) {
      expect(base({ [DATA_ENV_VAR]: blank }).kind).toBe("user");
      expect(base({ PORTABLE_EXECUTABLE_DIR: blank }).kind).toBe("user");
    }
  });

  it("trims a padded environment value rather than resolving the spaces", () => {
    const chosen = path.resolve("/opt/data");
    expect(base({ [DATA_ENV_VAR]: `  ${chosen}  ` }).base).toBe(chosen);
  });

  it("reports portable for every shape that keeps data with the install", () => {
    const marker = path.join(EXE_DIR, PORTABLE_MARKER);
    expect(base({ [DATA_ENV_VAR]: "/x" }).portable).toBe(true);
    expect(base({ PORTABLE_EXECUTABLE_DIR: "/y" }).portable).toBe(true);
    expect(base({}, [marker]).portable).toBe(true);
    expect(base().portable).toBe(false);
  });

  it("defaults to a real existence check when none is injected", () => {
    /* The production call passes no isDir, so the default must actually look at
     * the disk - and must say no for a path that is a FILE, not a directory. */
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "neo-databse-"));
    try {
      fs.writeFileSync(path.join(tmp, PORTABLE_MARKER), "not a directory");
      expect(
        resolveDataBase({ env: {}, exeDir: tmp, userData: USER_DATA }).kind,
      ).toBe("user");
      fs.unlinkSync(path.join(tmp, PORTABLE_MARKER));
      fs.mkdirSync(path.join(tmp, PORTABLE_MARKER));
      expect(
        resolveDataBase({ env: {}, exeDir: tmp, userData: USER_DATA }).kind,
      ).toBe("marker");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});

describe("checkWritable", () => {
  it("creates the tree and reports no problem", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "neo-writable-"));
    try {
      const nested = path.join(tmp, "a", "b");
      expect(checkWritable(nested)).toBeNull();
      expect(fs.statSync(nested).isDirectory()).toBe(true);
      /* The probe must not be left behind for the player to wonder about. */
      expect(fs.readdirSync(nested)).toEqual([]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("reports a reason when the base cannot be made", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "neo-writable-"));
    try {
      /* A file where the directory needs to be: mkdir fails on every platform,
       * which is the portable way to provoke this. */
      const blocker = path.join(tmp, "blocked");
      fs.writeFileSync(blocker, "");
      const err = checkWritable(path.join(blocker, "data"));
      expect(err).not.toBeNull();
      expect(typeof err).toBe("string");
      expect(err).not.toBe("");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
