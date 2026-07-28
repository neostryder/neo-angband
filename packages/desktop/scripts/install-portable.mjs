/**
 * Build a self-contained Neo Angband folder and put it somewhere real.
 *
 *   pnpm --filter @neo-angband/desktop install:portable
 *   pnpm --filter @neo-angband/desktop install:portable "D:\Games\Neo Angband"
 *
 * Default target: C:\Games\Neo Angband on Windows, ~/Games/Neo Angband elsewhere.
 * Override with the first argument or NEO_ANGBAND_INSTALL_DIR.
 *
 * Why a script rather than an electron-builder target: `--dir` already produces
 * the unpacked folder, but it produces it inside dist-desktop/ under a
 * platform-specific name, and what is wanted is that folder INSTALLED at a chosen
 * path, repeatedly, without destroying the data it accumulated. Those are two
 * different jobs and electron-builder only does the first.
 *
 * The one rule this script exists to keep: THE DATA FOLDER SURVIVES. Rebuilding
 * over an install must never take the player's characters with it - there is no
 * save-scumming in this game, so a deleted savefile is a dead character. Every
 * other entry in the target is replaced.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PKG = path.join(HERE, "..");

/** Kept byte-for-byte across a reinstall. Must match data-dir.ts. */
const PRESERVE = new Set(["neo-angband-data"]);

function defaultTarget() {
  if (process.env["NEO_ANGBAND_INSTALL_DIR"]) {
    return path.resolve(process.env["NEO_ANGBAND_INSTALL_DIR"]);
  }
  return process.platform === "win32"
    ? path.join("C:\\", "Games", "Neo Angband")
    : path.join(os.homedir(), "Games", "Neo Angband");
}

function run(cmd, args, cwd) {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", shell: true });
  if (r.status !== 0) {
    console.error(`\n[install-portable] failed: ${cmd} ${args.join(" ")}`);
    process.exit(r.status ?? 1);
  }
}

/** Where electron-builder left the unpacked app for this platform. */
function unpackedDir() {
  const out = path.join(PKG, "dist-desktop");
  const candidates = fs.existsSync(out) ? fs.readdirSync(out) : [];
  const found = candidates.find((n) => n.endsWith("-unpacked") || n === "linux-unpacked");
  if (!found) {
    console.error(
      `[install-portable] no unpacked build found in ${out}\n` +
        `  saw: ${candidates.join(", ") || "(nothing)"}`,
    );
    process.exit(1);
  }
  return path.join(out, found);
}

function clearExceptData(target) {
  for (const entry of fs.readdirSync(target)) {
    if (PRESERVE.has(entry)) continue;
    fs.rmSync(path.join(target, entry), { recursive: true, force: true });
  }
}

const target = process.argv[2] ? path.resolve(process.argv[2]) : defaultTarget();

console.log(`[install-portable] building the renderer and main process`);
run("pnpm", ["--filter", "@neo-angband/web", "bundle"], PKG);
run("pnpm", ["run", "build"], PKG);

console.log(`[install-portable] packaging (electron-builder --dir)`);
run("npx", ["electron-builder", "--dir"], PKG);

const source = unpackedDir();
const existed = fs.existsSync(target);
if (existed) {
  const kept = fs.readdirSync(target).filter((n) => PRESERVE.has(n));
  console.log(
    `[install-portable] replacing ${target}` +
      (kept.length ? ` (keeping ${kept.join(", ")})` : ""),
  );
  clearExceptData(target);
} else {
  console.log(`[install-portable] creating ${target}`);
  fs.mkdirSync(target, { recursive: true });
}

fs.cpSync(source, target, { recursive: true });

/* No installed.txt is written, which is the whole point: an unmarked folder is a
 * portable one, so the game will keep its data in neo-angband-data right here.
 * Created now rather than at first launch so the folder is self-evidently
 * self-contained when the player looks at it. */
const data = path.join(target, "neo-angband-data");
fs.mkdirSync(path.join(data, "mods"), { recursive: true });

const exe =
  process.platform === "win32"
    ? path.join(target, "Neo Angband.exe")
    : path.join(target, "neo-angband");

console.log(`
[install-portable] done.

  folder   ${target}
  run      ${exe}
  data     ${data}

Everything the game writes stays in that data folder: savefiles, settings,
scores, character dumps, and mods (drop a mod folder in ${path.join(data, "mods")}).
Move or copy the whole folder and the game moves with it.
`);
