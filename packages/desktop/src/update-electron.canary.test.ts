/**
 * The swap, launched from a REAL ELECTRON MAIN PROCESS, because that is the
 * only place the bug it guards against exists.
 *
 * WHAT WENT WRONG AND WHY NOTHING CAUGHT IT. `launchSwap` used to spawn the
 * swap script with `{ detached: true }`, which every other test agreed was
 * correct - update-swap.integration.test.ts even runs the generated script
 * through real PowerShell against real files and watches the swap succeed. It
 * passes. It always passed. What it does not do is run under Electron, and
 * Electron is the whole problem: Chromium puts its browser process in a Windows
 * JOB OBJECT with kill-on-close, a new process joins its creator's job unless it
 * is created with CREATE_BREAKAWAY_FROM_JOB, and Node's `detached` does not set
 * that flag. So the swapper died with the app about 150 ms after it started, on
 * every Windows machine, for every release the updater shipped in - and left no
 * error anywhere, because from inside the app everything had succeeded.
 *
 * A unit test of `launchSwap` cannot see this. A test of the script cannot see
 * it. Reading the code cannot see it: `detached: true` is exactly what the
 * documentation tells you to write. Only a child that is asked to OUTLIVE A
 * REAL ELECTRON PROCESS can see it, so that is what this does - it bundles the
 * real updater, hands it to a real Electron, quits, and then looks at the disk.
 *
 * WINDOWS ONLY, deliberately and not as an exclusion: job objects are a Windows
 * concept, the Unix branch is a plain detached spawn that genuinely does
 * outlive its parent, and the script itself is covered on both platforms by
 * update-swap.integration.test.ts. A guard that cannot fail on Linux would be
 * noise there and would hide that this one has teeth here.
 */

import { afterAll, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { buildSync } from "esbuild";
import { makeZip } from "./zip-fixture";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const isWin = process.platform === "win32";
const here = path.dirname(fileURLToPath(import.meta.url));

let scratch = "";
afterAll(() => {
  if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
});

describe.skipIf(!isWin)("a swap launched from Electron", () => {
  it("outlives the app, replaces the install, and relaunches", async () => {
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), "neo-canary-"));
    const install = path.join(scratch, "install");
    const staging = path.join(install, ".neo-update", "new");
    const saves = path.join(install, "neo-angband-data");
    const relaunched = path.join(scratch, "relaunched.txt");
    const errFile = path.join(scratch, "launch-error.txt");

    fs.mkdirSync(staging, { recursive: true });
    fs.mkdirSync(saves, { recursive: true });
    /* The old install: a marker file, and a "program" that the swap will replace
     * and then start. The character must survive; that is the one thing this
     * project will not trade for an update. */
    fs.writeFileSync(path.join(install, "version.txt"), "old");
    fs.writeFileSync(path.join(install, "app.cmd"), "@echo off\r\n");
    fs.writeFileSync(path.join(saves, "Bilbo.sav"), "a character");
    /* The new version, staged exactly as stageArchive would leave it. */
    fs.writeFileSync(path.join(staging, "version.txt"), "new");
    fs.writeFileSync(
      path.join(staging, "app.cmd"),
      `@echo off\r\n>"${relaunched}" echo relaunched\r\n`,
    );

    /* The REAL updater, bundled - not a re-implementation of it. A hand-written
     * stand-in here would be a test of my own idea of the launcher, and the
     * launcher is the thing that was wrong. */
    const bundle = path.join(scratch, "updater.cjs");
    buildSync({
      entryPoints: [path.join(here, "updater.ts")],
      bundle: true,
      platform: "node",
      format: "cjs",
      packages: "external",
      outfile: bundle,
    });

    const appDir = path.join(scratch, "app");
    fs.mkdirSync(appDir);
    fs.writeFileSync(
      path.join(appDir, "package.json"),
      JSON.stringify({ name: "neo-canary", main: "main.cjs" }),
    );
    fs.writeFileSync(
      path.join(appDir, "main.cjs"),
      `const { app } = require("electron");
const fs = require("node:fs");
const { launchSwap } = require(${JSON.stringify(bundle)});
app.whenReady().then(async () => {
  try {
    await launchSwap({
      root: ${JSON.stringify(install)},
      staging: ${JSON.stringify(staging)},
      platform: "win32",
      execPath: ${JSON.stringify(path.join(install, "app.cmd"))},
      pid: process.pid,
    });
  } catch (err) {
    fs.writeFileSync(${JSON.stringify(errFile)}, String(err && err.message));
  }
  app.quit();
});
`,
    );

    const electronPath = (await import("electron")).default as unknown as string;
    const run = spawnSync(electronPath, [appDir], { encoding: "utf8", timeout: 60_000 });
    expect(fs.existsSync(errFile) ? fs.readFileSync(errFile, "utf8") : "").toBe("");
    expect(run.error).toBeUndefined();

    /* The app has exited; the swapper has not. Wait for IT, which is the whole
     * point - the old code's swapper was already dead by now. */
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline && !fs.existsSync(relaunched)) {
      await new Promise((r) => setTimeout(r, 500));
    }

    const log = path.join(install, ".neo-update", "swap.log");
    const trace = fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "(no swap.log)";

    expect(fs.readFileSync(path.join(install, "version.txt"), "utf8"), trace).toBe("new");
    expect(fs.readFileSync(path.join(saves, "Bilbo.sav"), "utf8")).toBe("a character");
    expect(fs.existsSync(relaunched), `the relaunch never happened.\n${trace}`).toBe(true);
    expect(trace).toContain("swap complete");
  }, 120_000);

  /**
   * AN ARCHIVE THAT CONTAINS `resources/app.asar` CANNOT BE UNPACKED INSIDE
   * ELECTRON without saying so first, and every archive shipped here is one.
   *
   * Electron patches `fs` so that any path containing `.asar` is an archive
   * rather than a file. Writing `resources/app.asar` therefore does not write a
   * file - the patched fs tries to open the directory being created as an asar
   * and throws `Invalid package`, stopping the extraction halfway. unpack.ts is
   * covered thoroughly by unpack.test.ts against real archives, and every one
   * of those tests passes, because vitest is plain Node and nothing there is
   * patched. Same shape as the swap bug: correct code, real coverage, and a
   * host that changes the rules.
   *
   * Found by running the real updater against a real release and reading the
   * error off the screen.
   */
  it("unpacks an archive containing resources/app.asar", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "neo-asar-"));
    try {
      const zip = path.join(dir, "release.zip");
      fs.writeFileSync(
        zip,
        makeZip([
          { name: "app.exe", data: "an executable" },
          { name: "resources/", kind: "dir" },
          { name: "resources/app-update.yml", data: "provider: github" },
          /* The one that matters. Its CONTENT is irrelevant - it is the NAME
           * that Electron reacts to. */
          { name: "resources/app.asar", data: "not really an asar, and it does not need to be" },
        ]),
      );

      const bundle = path.join(dir, "updater.cjs");
      buildSync({
        entryPoints: [path.join(here, "updater.ts")],
        bundle: true,
        platform: "node",
        format: "cjs",
        packages: "external",
        outfile: bundle,
      });

      const root = path.join(dir, "install");
      fs.mkdirSync(root);
      const result = path.join(dir, "result.json");
      const appDir = path.join(dir, "app");
      fs.mkdirSync(appDir);
      fs.writeFileSync(
        path.join(appDir, "package.json"),
        JSON.stringify({ name: "neo-asar-canary", main: "main.cjs" }),
      );
      fs.writeFileSync(
        path.join(appDir, "main.cjs"),
        `const { app } = require("electron");
const fs = require("node:fs");
const { stageArchive } = require(${JSON.stringify(bundle)});
app.whenReady().then(async () => {
  let out = { ok: false, error: null };
  try {
    const staged = await stageArchive(${JSON.stringify(zip)}, ${JSON.stringify(root)}, "win32");
    out = { ok: true, entries: fs.readdirSync(require("node:path").join(staged, "resources")) };
  } catch (err) {
    out = { ok: false, error: String(err && err.message) };
  }
  fs.writeFileSync(${JSON.stringify(result)}, JSON.stringify(out));
  app.quit();
});
`,
      );

      const electronPath = (await import("electron")).default as unknown as string;
      const run = spawnSync(electronPath, [appDir], { encoding: "utf8", timeout: 60_000 });
      expect(
        fs.existsSync(result),
        `electron wrote no result.
stdout: ${run.stdout ?? ""}
stderr: ${run.stderr ?? ""}`,
      ).toBe(true);
      const out = JSON.parse(fs.readFileSync(result, "utf8")) as {
        ok: boolean;
        error: string | null;
        entries?: string[];
      };
      expect(out.error ?? null).toBeNull();
      expect(out.ok).toBe(true);
      expect(out.entries).toContain("app.asar");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
