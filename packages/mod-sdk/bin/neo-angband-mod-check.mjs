#!/usr/bin/env node
/**
 * Check a mod folder against the requirements the game enforces.
 *
 *   neo-angband-mod-check [path]            check the folder (default: .)
 *   neo-angband-mod-check --list            print every rule and why it exists
 *   neo-angband-mod-check --write-docs      regenerate docs/modding/REQUIREMENTS.md
 *
 * WHY A CLI AND NOT A DOCUMENT. An author following a document finds out whether they
 * got it right when somebody else's install fails. This runs the SAME rules the game
 * runs at install time - literally the same functions, imported from the SDK - so a
 * green run here means the game will accept the mod, and a red one names the field.
 *
 * ARCHIVES. If the folder holds committed .zip files, they are read as the payload
 * the way the installer reads them, so the "does this mod ship plugin.js" questions
 * are asked of the UNPACKED contents. Checking the repository's file list instead
 * would have answered "no plugin.js" for every mod that ships a pack, which is the
 * shape of wrong answer that makes a checker worse than nothing.
 *
 * Exit 0 when nothing REQUIRED failed. Advice never changes the exit code: a check
 * that fails a build over a missing description is a check authors route around.
 */

import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

import { MOD_REQUIREMENTS, checkMod, requirementsMarkdown } from "../dist/index.js";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);

/** Every file under `dir`, relative, with forward slashes. */
function walk(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    /* Skip what is never part of a mod, so the report is about the mod rather than
     * about node_modules. Mirrors mod-source.ts's NOT_PAYLOAD in spirit; the game's
     * own list is the authority for what actually installs. */
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else out.push(relative(base, full).split(sep).join("/"));
  }
  return out;
}

/**
 * The installed file list, unpacking any committed archive the manifest declares.
 *
 * Uses the same reasoning as the installer: a declared archive contributes its
 * CONTENTS, and its own path does not survive the install.
 */
async function installedFiles(root, repoFiles, declared) {
  const archives = declared?.archives ?? [];
  if (archives.length === 0) return repoFiles;
  let unzipSync;
  try {
    ({ unzipSync } = await import("fflate"));
  } catch {
    /* fflate is the game's unzip, not the SDK's dependency. Without it the archive
     * contents cannot be seen - so say so rather than reporting a mod as missing the
     * files that are inside a zip this could not open. */
    console.error(
      "note: fflate is not installed, so declared archives were not opened.\n" +
        "      Rules about the mod's files may be reported wrongly.\n" +
        "      Install it (npm i -D fflate) for an accurate check.",
    );
    return repoFiles;
  }
  const files = repoFiles.filter((f) => !archives.includes(f));
  for (const archive of archives) {
    let bytes;
    try {
      bytes = readFileSync(resolve(root, archive));
    } catch {
      console.error(`note: payload.archives names ${archive}, which is not there`);
      continue;
    }
    try {
      for (const name of Object.keys(unzipSync(bytes))) {
        if (!name.endsWith("/")) files.push(name);
      }
    } catch (e) {
      console.error(`note: ${archive} is not a readable zip (${e.message})`);
    }
  }
  return files;
}

if (flag("--list")) {
  for (const r of MOD_REQUIREMENTS) {
    console.log(`${r.level === "required" ? "MUST " : "SHOULD"}  ${r.title}`);
    console.log(`        ${r.id}`);
    console.log(`        ${r.why}\n`);
  }
  process.exit(0);
}

if (flag("--write-docs")) {
  /* Written relative to this script, so it works from any directory - and it is the
   * ONLY writer of that file, which is what lets a test assert the two agree. */
  const out = resolve(import.meta.dirname, "..", "..", "..", "docs", "modding", "REQUIREMENTS.md");
  writeFileSync(out, `${requirementsMarkdown()}\n`, "utf8");
  console.log(`wrote ${out}`);
  process.exit(0);
}

const root = resolve(argv.find((a) => !a.startsWith("-")) ?? ".");
try {
  if (!statSync(root).isDirectory()) throw new Error("not a directory");
} catch {
  console.error(`${root} is not a folder this can check.`);
  process.exit(2);
}

const repoFiles = walk(root);
let manifestText = null;
try {
  manifestText = readFileSync(join(root, "manifest.json"), "utf8");
} catch {
  /* manifest-present reports this; reading it here must not be fatal. */
}

let declared;
try {
  declared = manifestText === null ? undefined : JSON.parse(manifestText).payload;
} catch {
  /* manifest-json reports this. */
}

const files = await installedFiles(root, repoFiles, declared);
const report = checkMod({ files, manifestText, repoFiles, declaredPayload: declared });

const show = (findings, label) => {
  if (findings.length === 0) return;
  console.log(`\n${label}\n`);
  for (const f of findings) {
    console.log(`  ${f.title}`);
    console.log(`    ${f.problem}`);
    console.log(`    (${f.id})`);
  }
};

console.log(`checked ${root}`);
console.log(`  ${String(files.length)} installed file(s), ${String(MOD_REQUIREMENTS.length)} rules`);
show(report.errors, "MUST FIX - the game will refuse to install this:");
show(report.advice, "SHOULD FIX - players will notice:");

if (report.ok && report.advice.length === 0) console.log("\nAll clear.");
else if (report.ok) console.log("\nInstallable. The advice above is optional.");

process.exit(report.ok ? 0 : 1);
