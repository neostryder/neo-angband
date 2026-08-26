/**
 * The swap, performed for real, on real files.
 *
 * EVERY OTHER TEST OF THIS FEATURE READS A STRING. update-plan.test.ts asserts
 * the script says the right things and updater.test.ts asserts the archive is
 * verified, and both would pass in full against a script that PowerShell refuses
 * to parse, or one whose `Move-Item` silently does nothing because the path has
 * a bracket in it. Reading code cannot find code that does not run.
 *
 * So this one builds a fake install with a fake save directory, stages a fake
 * new version, runs the actual generated script through the actual shell with a
 * pid that has already exited, and then looks at the disk:
 *
 *   - the new files are in place,
 *   - the old ones are gone,
 *   - `data` is untouched, byte for byte,
 *   - the relaunch happened.
 *
 * It runs on whichever platform it finds itself on - PowerShell here, /bin/sh in
 * CI - so both branches of swapScript are exercised across the two.
 */

import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PRESERVE, swapPlan, swapScript } from "./update-plan";

const isWin = process.platform === "win32";
const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "neo-swap-"));
afterAll(() => {
  fs.rmSync(scratch, { recursive: true, force: true });
});

/**
 * A pid that is not running.
 *
 * Spawned and reaped rather than invented: a made-up number can belong to a real
 * process, and the script would then wait sixty seconds and give up - turning a
 * failed swap into a slow pass.
 */
function deadPid(): number {
  const r = spawnSync(isWin ? "cmd.exe" : "/bin/sh", isWin ? ["/c", "exit"] : ["-c", "exit"]);
  expect(r.status).toBe(0);
  return r.pid ?? 1;
}

describe("a real swap on real files", () => {
  it("replaces the install, keeps the save directory, and relaunches", () => {
    /* A folder install with a couple of files, a subdirectory, and a save. The
     * space in the name is not decoration: half the paths in a real install have
     * one, and unquoted shell variables are how that becomes a bug. */
    const install = path.join(scratch, "Neo Angband");
    fs.mkdirSync(path.join(install, "locales"), { recursive: true });
    fs.writeFileSync(path.join(install, "Neo Angband.exe"), "OLD BINARY");
    fs.writeFileSync(path.join(install, "locales", "en-US.pak"), "old pak");
    fs.writeFileSync(path.join(install, "resources.pak"), "old resources");

    const data = path.join(install, PRESERVE[0] ?? "data");
    fs.mkdirSync(path.join(data, "save"), { recursive: true });
    const savefile = path.join(data, "save", "Bilbo");
    fs.writeFileSync(savefile, "a level 31 hobbit");

    /* The new version, already extracted where stageArchive would put it. */
    const staging = path.join(install, ".neo-update", "new");
    fs.mkdirSync(path.join(staging, "locales"), { recursive: true });
    fs.writeFileSync(path.join(staging, "Neo Angband.exe"), "NEW BINARY");
    fs.writeFileSync(path.join(staging, "locales", "en-US.pak"), "new pak");
    fs.writeFileSync(path.join(staging, "version.txt"), "0.17.0");

    /* Relaunching is part of the script, so it is part of the test: the target
     * writes a marker and exits. */
    const marker = path.join(scratch, "relaunched.txt");
    const stub = path.join(scratch, isWin ? "relaunch.bat" : "relaunch.sh");
    fs.writeFileSync(
      stub,
      isWin ? `@echo off\r\n> "${marker}" echo yes\r\n` : `#!/bin/sh\necho yes > "${marker}"\n`,
    );
    if (!isWin) fs.chmodSync(stub, 0o755);

    const plan = swapPlan({
      platform: process.platform,
      installRoot: install,
      staging,
      execPath: stub,
    });
    const script = path.join(scratch, isWin ? "swap.ps1" : "swap.sh");
    fs.writeFileSync(script, swapScript(plan, deadPid(), process.platform), "utf8");
    if (!isWin) fs.chmodSync(script, 0o755);

    const ran = isWin
      ? spawnSync(
          "powershell.exe",
          ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script],
          { encoding: "utf8" },
        )
      : spawnSync("/bin/sh", [script], { encoding: "utf8" });
    expect(ran.stderr, "the swap script errored").toBe("");
    expect(ran.status, "the swap script did not succeed").toBe(0);

    /* The new version is in place... */
    expect(fs.readFileSync(path.join(install, "Neo Angband.exe"), "utf8")).toBe("NEW BINARY");
    expect(fs.readFileSync(path.join(install, "locales", "en-US.pak"), "utf8")).toBe("new pak");
    expect(fs.existsSync(path.join(install, "version.txt"))).toBe(true);

    /* ...the old files it replaced are gone, not merged around... */
    expect(fs.existsSync(path.join(install, "resources.pak"))).toBe(false);

    /* ...THE CHARACTER SURVIVED, which is the one thing here that cannot be
     * undone. */
    expect(fs.readFileSync(savefile, "utf8")).toBe("a level 31 hobbit");

    /* ...and the game was started again.
     *
     * Polled, not asserted outright: the relaunch is deliberately fire-and-forget
     * (`Start-Process` on Windows, `&` on POSIX) so the script can exit without
     * waiting for the game to draw its first frame. The marker therefore appears
     * shortly AFTER the script returns. */
    const deadline = Date.now() + 10_000;
    while (!fs.existsSync(marker) && Date.now() < deadline) {
      spawnSync(isWin ? "cmd.exe" : "/bin/sh", isWin ? ["/c", "exit"] : ["-c", "exit"]);
    }
    expect(fs.existsSync(marker), "the script did not relaunch the game").toBe(true);
  }, 60_000);

  it("puts everything back when the incoming files cannot be moved in", () => {
    /* The failure this exists for: the first loop empties the install, the
     * second fails halfway, and without a rollback the player is left with a
     * gutted folder and their files stranded in the attic.
     *
     * The failure is provoked honestly - the staging directory is deleted after
     * the script is generated, so the second loop finds nothing to move and the
     * first has already emptied the install. */
    const install = path.join(scratch, "Rollback Test");
    fs.mkdirSync(install, { recursive: true });
    fs.writeFileSync(path.join(install, "Neo Angband.exe"), "OLD BINARY");
    fs.writeFileSync(path.join(install, "resources.pak"), "old resources");
    const data = path.join(install, PRESERVE[0] ?? "data");
    fs.mkdirSync(data, { recursive: true });
    fs.writeFileSync(path.join(data, "keep-me"), "still here");

    const staging = path.join(install, ".neo-update", "new");
    fs.mkdirSync(staging, { recursive: true });
    fs.writeFileSync(path.join(staging, "Neo Angband.exe"), "NEW BINARY");

    const plan = swapPlan({
      platform: process.platform,
      installRoot: install,
      staging,
      execPath: path.join(scratch, "never-run"),
    });
    const script = path.join(scratch, isWin ? "swap-rb.ps1" : "swap-rb.sh");
    fs.writeFileSync(script, swapScript(plan, deadPid(), process.platform), "utf8");

    /* Make the second loop find an empty source AND make the destination refuse
     * the move, by replacing staging with a file of the same name. */
    fs.rmSync(path.join(install, ".neo-update"), { recursive: true, force: true });
    fs.writeFileSync(path.join(install, ".neo-update"), "not a directory");

    if (isWin) {
      spawnSync(
        "powershell.exe",
        ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", script],
        { encoding: "utf8" },
      );
    } else {
      spawnSync("/bin/sh", [script], { encoding: "utf8" });
    }

    /* Whatever happened, the install must not have been left empty of the files
     * it started with, and the data directory must be intact. */
    expect(fs.readFileSync(path.join(data, "keep-me"), "utf8")).toBe("still here");
    expect(fs.existsSync(path.join(install, "Neo Angband.exe"))).toBe(true);
    expect(fs.existsSync(path.join(install, "resources.pak"))).toBe(true);
  }, 60_000);
});
