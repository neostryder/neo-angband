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
  INSTALLED_MARKER,
  PORTABLE_MARKER,
  checkWritable,
  resolveDataBase,
} from "./data-dir";

const EXE_DIR = path.resolve("/apps/neo-angband");
const USER_DATA = path.resolve("/users/somebody/AppData/Roaming/Neo Angband");
const INSTALLED = path.join(EXE_DIR, INSTALLED_MARKER);

/**
 * The default case here is a DEVELOPMENT launch - unpackaged, no markers - so
 * that every test which means "a shipped folder" has to say `packaged: true` out
 * loud. The two are only one boolean apart and they must not be conflated: in a
 * checkout the executable lives in node_modules.
 */
const base = (
  env: Record<string, string | undefined> = {},
  markers: readonly string[] = [],
  opts: { packaged?: boolean; platform?: string; writable?: boolean } = {},
) =>
  resolveDataBase({
    env,
    exeDir: EXE_DIR,
    userData: USER_DATA,
    packaged: opts.packaged ?? false,
    platform: opts.platform ?? "win32",
    isDir: (p) => markers.includes(p),
    isFile: (p) => markers.includes(p),
    isWritable: () => opts.writable ?? true,
  });

/** A packaged folder build: the shape a player unzips into C:\Games. */
const shipped = (
  env: Record<string, string | undefined> = {},
  markers: readonly string[] = [],
  opts: { platform?: string; writable?: boolean } = {},
) => base(env, markers, { ...opts, packaged: true });

describe("resolveDataBase", () => {
  it("keeps everything in the folder for a shipped copy the installer did not place", () => {
    /* The ratified default (2026-07-28): the executable, its config, saves and
     * mods in one folder, nothing in the OS user profile. Upstream's Windows
     * shape - angband.exe with lib/ beside it. */
    expect(shipped()).toEqual({
      base: path.join(EXE_DIR, PORTABLE_MARKER),
      kind: "folder",
      portable: true,
    });
  });

  it("uses the per-user directory for a copy the installer placed", () => {
    /* The uninstaller deletes its install directory. A character inside it is a
     * character deleted by an uninstall, which under the no-save-scumming policy
     * is unrecoverable - so an installed copy is the one shape that does NOT
     * keep data beside itself. */
    expect(shipped({}, [INSTALLED])).toEqual({
      base: USER_DATA,
      kind: "user",
      portable: false,
    });
  });

  it("uses the per-user directory when the folder cannot be written to", () => {
    /* Dragged into Program Files. Falling back is right here and only here: the
     * player expressed no portable intent, so the game picks the location that
     * works rather than refusing to start. */
    expect(shipped({}, [], { writable: false }).kind).toBe("user");
  });

  it("does not treat a development checkout as a folder install", () => {
    /* Unpackaged, the executable is node_modules/electron/dist/electron.exe, and
     * a `neo-angband-data` beside it would be inside node_modules - deleted by
     * the next install, and shared between every Electron app on the machine. */
    expect(base().kind).toBe("user");
  });

  it("does not put data inside a macOS app bundle", () => {
    /* exeDir there is Foo.app/Contents/MacOS: writing into it breaks the bundle
     * signature and a dmg upgrade replaces the whole bundle. */
    expect(shipped({}, [], { platform: "darwin" }).kind).toBe("user");
  });

  it("still honours an explicit marker inside an installed copy", () => {
    /* The documented way to make an installed copy portable, so it must outrank
     * the installer's own marker rather than the other way round. */
    const marker = path.join(EXE_DIR, PORTABLE_MARKER);
    expect(shipped({}, [INSTALLED, marker]).kind).toBe("marker");
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
      expect(base({ APPIMAGE: blank }).kind).toBe("user");
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
    expect(base({ APPIMAGE: "/z/a.AppImage" }).portable).toBe(true);
    expect(base({}, [marker]).portable).toBe(true);
    expect(shipped().portable).toBe(true);
    /* Only the two shapes that put data in the user profile are non-portable. */
    expect(shipped({}, [INSTALLED]).portable).toBe(false);
    expect(base().portable).toBe(false);
  });

  it("defaults to real disk checks when none are injected", () => {
    /* The production call passes no predicates, so the defaults must actually look
     * at the disk. Three things are checked here because all three defaults are
     * separate functions and any of them silently answering "yes" would send a
     * player's saves to the wrong place:
     *   - the marker must be a DIRECTORY, not a file of the same name;
     *   - the installer's marker must be a FILE;
     *   - writability must be the real thing.
     */
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "neo-database-"));
    const real = (exeDir: string, packaged = false) =>
      resolveDataBase({
        env: {},
        exeDir,
        userData: USER_DATA,
        packaged,
        platform: "win32",
      }).kind;
    try {
      fs.writeFileSync(path.join(tmp, PORTABLE_MARKER), "not a directory");
      expect(real(tmp)).toBe("user");

      fs.unlinkSync(path.join(tmp, PORTABLE_MARKER));
      fs.mkdirSync(path.join(tmp, PORTABLE_MARKER));
      expect(real(tmp)).toBe("marker");

      /* Marker gone: a packaged copy of a writable folder is the new default. */
      fs.rmSync(path.join(tmp, PORTABLE_MARKER), { recursive: true });
      expect(real(tmp, true)).toBe("folder");

      /* ...until the installer says it owns the folder. */
      fs.writeFileSync(path.join(tmp, INSTALLED_MARKER), "installed");
      expect(real(tmp, true)).toBe("user");

      /* A DIRECTORY named installed.txt is not the installer's marker. */
      fs.unlinkSync(path.join(tmp, INSTALLED_MARKER));
      fs.mkdirSync(path.join(tmp, INSTALLED_MARKER));
      expect(real(tmp, true)).toBe("folder");
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("leaves no probe behind when it tests writability", () => {
    /* canWrite creates and removes a directory in the player's game folder. A
     * leftover `.neo-probe` would be a permanent unexplained entry in it. */
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "neo-probe-"));
    try {
      expect(
        resolveDataBase({
          env: {},
          exeDir: tmp,
          userData: USER_DATA,
          packaged: true,
          platform: "win32",
        }).kind,
      ).toBe("folder");
      expect(fs.readdirSync(tmp)).toEqual([]);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  it("puts an AppImage's data beside the file, not in its mount point", () => {
    /* An AppImage mounts itself under /tmp/.mount_XXXX, so exeDir is deleted the
     * moment the game exits. APPIMAGE names the real file - and it is a FILE, so
     * unlike PORTABLE_EXECUTABLE_DIR it has to be dirname'd. */
    const file = path.resolve("/home/somebody/Games/NeoAngband.AppImage");
    const r = base({ APPIMAGE: file }, [], { platform: "linux" });
    expect(r).toEqual({
      base: path.join(path.dirname(file), PORTABLE_MARKER),
      kind: "portable",
      portable: true,
    });
  });

  it("prefers PORTABLE_EXECUTABLE_DIR over APPIMAGE if both somehow appear", () => {
    const r = base(
      { PORTABLE_EXECUTABLE_DIR: path.resolve("/media/usb"), APPIMAGE: "/x/y.AppImage" },
      [],
    );
    expect(r.base).toBe(path.join(path.resolve("/media/usb"), PORTABLE_MARKER));
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
