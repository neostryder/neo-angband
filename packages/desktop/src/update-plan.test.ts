/**
 * The update plan, which is the only code in this project that can delete a
 * player's characters.
 *
 * Every test here is about an outcome that cannot be undone or cannot be seen:
 * a savefile removed, a half-swapped install, or - the quiet one - a "successful"
 * update that changed nothing because the app was running from a temp directory.
 */

import { describe, expect, it } from "vitest";
import {
  PRESERVE,
  WORK_DIRNAME,
  installRoot,
  psQuote,
  shQuote,
  swapPlan,
  swapScript,
  updatability,
} from "./update-plan";
import type { LaunchShape } from "./update-plan";

const shape = (over: Partial<LaunchShape> = {}): LaunchShape => ({
  platform: "win32",
  packaged: true,
  writable: true,
  ...over,
});

describe("whether this launch can be updated in place", () => {
  it("swaps an ordinary packaged folder install on all three platforms", () => {
    for (const platform of ["win32", "darwin", "linux"]) {
      expect(updatability(shape({ platform }))).toBe("swap");
    }
  });

  it("refuses in development, where there is no install to replace", () => {
    expect(updatability(shape({ packaged: false }))).toBe("none");
  });

  it("will not swap a single-file portable launch", () => {
    /* THE QUIET FAILURE. portable.exe unpacks to a temp directory and runs from
     * there, so swapping app.getPath("exe")'s folder appears to succeed and
     * changes nothing: progress bar, relaunch, same old version, no error. */
    expect(updatability(shape({ portableExecutableDir: "E:\\Neo Angband" }))).toBe("manual");
  });

  it("will not swap an AppImage, for the same reason", () => {
    expect(updatability(shape({ platform: "linux", appImage: "/media/usb/Neo.AppImage" }))).toBe(
      "manual",
    );
  });

  it("falls back to a download when the folder is read-only", () => {
    /* Dragged into Program Files, or an admin install. */
    expect(updatability(shape({ writable: false }))).toBe("manual");
  });

  it("offers nothing on a platform we do not ship", () => {
    expect(updatability(shape({ platform: "freebsd" }))).toBe("none");
  });
});

describe("what counts as the install root", () => {
  it("is the folder holding the exe on Windows", () => {
    expect(installRoot("win32", "C:\\Games\\Neo Angband\\Neo Angband.exe")).toBe(
      "C:\\Games\\Neo Angband",
    );
  });

  it("is the .app BUNDLE on macOS, not Contents/MacOS", () => {
    /* Replacing the innards and keeping the outer directory keeps the OLD
     * _CodeSignature, which is the state an arm64 Mac refuses to launch. */
    expect(installRoot("darwin", "/Applications/Neo Angband.app/Contents/MacOS/Neo Angband")).toBe(
      "/Applications/Neo Angband.app",
    );
  });

  it("falls back to the containing folder if the path is not a bundle", () => {
    expect(installRoot("darwin", "/opt/neo/neo-angband")).toBe("/opt/neo");
  });

  it("is the folder holding the binary on Linux", () => {
    expect(installRoot("linux", "/opt/Neo Angband/neo-angband")).toBe("/opt/Neo Angband");
  });
});

describe("the plan", () => {
  const win = swapPlan({
    platform: "win32",
    installRoot: "C:\\Games\\Neo Angband",
    staging: "C:\\Games\\Neo Angband\\.neo-update\\new",
    execPath: "C:\\Games\\Neo Angband\\Neo Angband.exe",
  });
  const mac = swapPlan({
    platform: "darwin",
    installRoot: "/Applications/Neo Angband.app",
    staging: "/Applications/.neo-update/Neo Angband.app",
    execPath: "/Applications/Neo Angband.app/Contents/MacOS/Neo Angband",
  });

  it("replaces the CONTENTS on Windows, keeping the folder's identity", () => {
    /* Shortcuts, Start-menu entries and the player's own path all point at the
     * folder; and the data directory lives inside it. */
    expect(win.mode).toBe("contents");
    expect(win.target).toBe("C:\\Games\\Neo Angband");
    expect(win.preserve).toContain("neo-angband-data");
  });

  it("replaces the whole BUNDLE on macOS, which holds no player data", () => {
    expect(mac.mode).toBe("bundle");
    expect(mac.target).toBe("/Applications/Neo Angband.app");
    expect(mac.preserve).toEqual([]);
  });

  it("parks the outgoing files on the SAME volume as the install", () => {
    /* os.tmpdir() is frequently another volume, where a rename becomes a copy,
     * stops being atomic, and can half-finish. */
    expect(win.attic.startsWith("C:\\Games\\Neo Angband")).toBe(true);
    expect(mac.attic.startsWith("/Applications/")).toBe(true);
  });
});

describe("the script that runs after we exit", () => {
  const plan = swapPlan({
    platform: "win32",
    installRoot: "C:\\Games\\Neo Angband",
    staging: "C:\\Games\\Neo Angband\\.neo-update\\new",
    execPath: "C:\\Games\\Neo Angband\\Neo Angband.exe",
  });
  const ps = swapScript(plan, 4242, "win32");
  const posix = swapScript(
    swapPlan({
      platform: "linux",
      installRoot: "/opt/neo",
      staging: "/opt/neo/.neo-update/new",
      execPath: "/opt/neo/neo-angband",
    }),
    4242,
    "linux",
  );

  it("waits for OUR process before touching anything", () => {
    expect(ps).toContain("4242");
    expect(ps).toMatch(/Get-Process -Id 4242/u);
    expect(posix).toMatch(/kill -0 4242/u);
  });

  it("gives up rather than swapping if we never exit", () => {
    /* An unbounded wait would leave a poller running forever AND a staged update
     * that silently never lands. Bailing leaves a working old install. */
    expect(ps).toMatch(/if \(Get-Process -Id 4242[^)]*\) \{[^}]*exit 1 \}/u);
    expect(posix).toMatch(/if kill -0 4242 2>\/dev\/null; then .*exit 1; fi/u);
  });

  it("moves the old files ASIDE before moving the new ones in, and deletes last", () => {
    /* The ordering IS the safety property: a crash between the first two steps
     * leaves a complete attic to restore from. */
    const aside = ps.indexOf("Destination (Join-Path $attic");
    const movedIn = ps.indexOf("Destination (Join-Path $target");
    const deleted = ps.indexOf("Remove-Item -LiteralPath $attic");
    expect(aside).toBeGreaterThan(-1);
    expect(movedIn).toBeGreaterThan(aside);
    expect(deleted).toBeGreaterThan(movedIn);
  });

  it("puts the old files back if moving the new ones in fails", () => {
    expect(ps).toContain("catch");
    expect(ps).toMatch(/foreach \(\$n in \$moved\)/u);
    /* The POSIX contents script had NO rollback when this test was written: a
     * failure halfway through the second loop left the install gutted and the
     * old files stranded in the attic. */
    expect(posix).toContain("restore()");
    expect(posix).toMatch(/mv "\$e" "\$target\/\$\(basename "\$e"\)" \|\| restore/u);
  });

  it("records the rolled-back names one per line, not as shell words", () => {
    /* Half of an Electron folder is "Neo Angband something". `for n in $moved`
     * would split those, and a rollback that silently skips the files with
     * spaces is worse than none. */
    expect(posix).toContain(`while IFS= read -r n`);
    expect(posix).not.toMatch(/for n in \$moved/u);
  });

  it("NEVER moves the data directory", () => {
    /* The one irreversible mistake available here. There is no save-scumming in
     * this game, so a deleted savefile is a dead character. */
    for (const name of PRESERVE) {
      expect(ps).toContain(psQuote(name));
      expect(posix).toContain(name);
    }
    expect(ps).toMatch(/if \(\$keep -contains \$e\.Name\) \{ continue \}/u);
  });

  it("does not sweep its own working directory into the attic", () => {
    expect(ps).toContain(`$e.Name -eq '${WORK_DIRNAME}'`);
    expect(posix).toContain(WORK_DIRNAME);
  });

  it("relaunches the game", () => {
    expect(ps).toContain("Start-Process");
    expect(posix).toContain("/opt/neo/neo-angband");
  });

  it("opens the BUNDLE on macOS rather than the inner binary", () => {
    const mac = swapScript(
      swapPlan({
        platform: "darwin",
        installRoot: "/Applications/Neo Angband.app",
        staging: "/Applications/.neo-update/Neo Angband.app",
        execPath: "/Applications/Neo Angband.app/Contents/MacOS/Neo Angband",
      }),
      1,
      "darwin",
    );
    expect(mac).toContain("open '/Applications/Neo Angband.app'");
    expect(mac).not.toContain("Contents/MacOS/Neo Angband' &");
  });
});

describe("quoting, because every path here has a space in it", () => {
  it("survives the product name", () => {
    expect(psQuote("C:\\Games\\Neo Angband")).toBe("'C:\\Games\\Neo Angband'");
    expect(shQuote("/Applications/Neo Angband.app")).toBe("'/Applications/Neo Angband.app'");
  });

  it("escapes a quote in the path rather than ending the string", () => {
    expect(psQuote("a'b")).toBe("'a''b'");
    expect(shQuote("a'b")).toBe(`'a'\\''b'`);
  });
});
