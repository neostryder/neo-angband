#!/usr/bin/env node
/**
 * Check a mod against the requirements the game enforces and the fixed checks.
 *
 *   neo-angband-mod-check [path]            check a mod folder or a .zip (default: .)
 *   neo-angband-mod-check --list            print every rule and why it exists
 *   neo-angband-mod-check --write-docs      regenerate docs/modding/REQUIREMENTS.md
 *
 * Options for a check:
 *
 *   --json                 print the ModFindingReport as JSON instead of text
 *   --base <dir>           compose the mod's records over the record files in <dir>
 *                          (the content package's pack/ folder); found on its own
 *                          when @rpgm-tools/neo-angband-content is installed
 *   --first-party          allow the capabilities only first-party mods may request
 *
 * The rules are the SDK's own functions, the same ones the game runs as it
 * installs a mod, so a clean run here means the installer accepts the mod.
 *
 * ARCHIVES. Archives the manifest declares in payload.archives are opened and
 * checked the way the installer opens them, and their contents are checked as
 * the payload, so the "does this mod ship plugin.js" questions are asked of
 * the unpacked files.
 *
 * Exit 0 when no finding is a `block`, 1 when one is, 2 when the path cannot
 * be checked. Other severities never change the exit code.
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve, sep } from "node:path";

import { basePackFromFiles, readModArchive, runModChecks } from "../dist/checks/index.js";
import { CHECK_RULES, MOD_REQUIREMENTS, isPayloadPath, manifestFields, requirementsMarkdown, worstSeverity } from "../dist/index.js";

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const option = (name) => {
  const at = argv.indexOf(name);
  return at >= 0 ? argv[at + 1] : undefined;
};
const VALUED = new Set(["--base"]);

/** Every file under `dir`, relative, with forward slashes. */
function walk(dir, base = dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    /* Skip what is never part of a mod, so the report is about the mod rather than
     * about node_modules. isPayloadPath then applies the installer's own list. */
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, base));
    else out.push(relative(base, full).split(sep).join("/"));
  }
  return out;
}

if (flag("--list")) {
  for (const r of MOD_REQUIREMENTS) {
    console.log(`${r.level === "required" ? "MUST " : "SHOULD"}  ${r.title}`);
    console.log(`        ${r.id}`);
    console.log(`        ${r.why}\n`);
  }
  console.log("Fixed checks\n");
  for (const r of CHECK_RULES) {
    const tags = [r.severity, r.kind, ...(r.outcome === "could-not-check" ? ["could not check"] : []), ...(r.install ? ["at install"] : [])];
    console.log(`${r.title}`);
    console.log(`        ${r.id} (${tags.join(", ")})`);
    console.log(`        ${r.reason}\n`);
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

const target = argv.find((a, i) => !a.startsWith("-") && !VALUED.has(argv[i - 1] ?? "")) ?? ".";
const root = resolve(target);
let isZip = false;
try {
  const stat = statSync(root);
  isZip = stat.isFile() && root.toLowerCase().endsWith(".zip");
  if (!stat.isDirectory() && !isZip) throw new Error("not a folder or a zip");
} catch {
  console.error(`${root} is not a folder or a .zip this can check.`);
  process.exit(2);
}

/** The base game for the composition checks, or undefined when none can be found. */
async function basePacks() {
  let dir = option("--base");
  if (dir === undefined) {
    try {
      ({ packDir: dir } = await import("@rpgm-tools/neo-angband-content/pack"));
    } catch {
      /* Inside the Neo Angband repository the content package sits beside this one. */
      const sibling = resolve(import.meta.dirname, "..", "..", "content", "pack");
      if (existsSync(join(sibling, "manifest.json"))) dir = sibling;
    }
  }
  if (dir === undefined) return undefined;
  const files = {};
  for (const name of readdirSync(dir)) {
    if (name.toLowerCase().endsWith(".json")) files[name] = JSON.parse(readFileSync(join(dir, name), "utf8"));
  }
  return [basePackFromFiles(files)];
}

/** The payload as the installer would store it, plus the archives in it. */
function folderInput(dir) {
  const repoFiles = walk(dir);
  let declared;
  try {
    declared = manifestFields(JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")))?.payload;
  } catch {
    /* manifest-json reports this. */
  }
  /* A manifest that declares its payload gets exactly that, as the installer
   * fetches it; one that does not gets the repository minus build scaffolding. */
  const archives = declared?.archives ?? [];
  const listed = declared?.files ?? [];
  const paths = listed.length + archives.length === 0
    ? repoFiles.filter((p) => isPayloadPath(p))
    : [...new Set([...listed, ...archives])].filter((p) => repoFiles.includes(p));
  const files = paths.map((p) => [p, new Uint8Array(readFileSync(join(dir, p)))]);
  return { files, archives: archives.filter((a) => paths.includes(a)), repoFiles };
}

/** A .zip of the whole mod: its contents are the folder, minus one shared top folder. */
async function zipInput(path) {
  const reading = await readModArchive(basename(path), new Uint8Array(readFileSync(path)));
  let entries = reading.entries;
  const hasRootManifest = entries.some(([p]) => p.toLowerCase() === "manifest.json");
  const tops = new Set(entries.map(([p]) => p.split("/")[0]));
  if (!hasRootManifest && tops.size === 1 && entries.every(([p]) => p.includes("/"))) {
    const prefix = `${[...tops][0]}/`;
    entries = entries.map(([p, b]) => [p.slice(prefix.length), b]);
  }
  return { files: entries, archives: [], repoFiles: entries.map(([p]) => p), early: reading.findings };
}

const input = isZip ? await zipInput(root) : folderInput(root);
const base = await basePacks();
const { report, coverage } = await runModChecks(input, { ...(base ? { base } : {}), firstParty: flag("--first-party") });
const findings = [...(input.early ?? []), ...report.findings];
const full = { ...report, findings };
const worst = worstSeverity(findings);

if (flag("--json")) {
  console.log(JSON.stringify(full, null, 2));
  process.exit(worst === "block" ? 1 : 0);
}

const ORDER = ["block", "serious", "warning", "note"];
const HEAD = {
  block: "MUST FIX - the game will refuse this, or it will not work:",
  serious: "SERIOUS - review before publishing:",
  warning: "WARNINGS:",
  note: "NOTES:",
};

console.log(`checked ${root}`);
console.log(`  ${String(coverage.files)} payload file(s), ${String(coverage.scripts)} script(s) traced, composition ${coverage.composed ? "checked" : "not checked"}`);
for (const severity of ORDER) {
  const list = findings.filter((f) => f.severity === severity);
  if (list.length === 0) continue;
  console.log(`\n${HEAD[severity]}\n`);
  for (const f of list) {
    console.log(`  ${f.message}${f.outcome === "could-not-check" ? " (could not check)" : ""}`);
    for (const e of f.evidence.slice(0, 3)) {
      const at = e.file === undefined ? "" : `${e.file}${e.lines ? `:${String(e.lines[0])}` : ""}`;
      console.log(`    ${[at, e.excerpt].filter(Boolean).join("  ")}`);
    }
    if (f.suggestedFix) console.log(`    fix: ${f.suggestedFix}`);
    console.log(`    (${f.rule})`);
  }
}

if (findings.length === 0) console.log("\nAll clear.");
else if (worst !== "block") console.log("\nInstallable. Nothing above blocks the mod.");

process.exit(worst === "block" ? 1 : 0);
