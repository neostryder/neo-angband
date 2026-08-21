// Copy upstream's tilesets from reference/lib/tiles into packages/web/public,
// where Vite can serve them.
//
// WHY THIS EXISTS. Vite serves `public/` and cannot reach outside its own
// package, so the tiles have to be inside packages/web. They were therefore
// committed twice - 20 MB in reference/ and the same 20 MB again in public/,
// 17.5 MB of it a single Shockbolt PNG. Two copies is two things to keep right,
// and they were not right: the five graf-*.prf files drifted onto upstream
// master's versions while every PNG beside them stayed at 4.2.6, and nothing
// noticed because nothing compared them.
//
// So the second copy is now GENERATED rather than committed. There is one copy
// in the repository, and the served tree is derived from it on every build,
// which makes drift impossible rather than merely detectable.
//
// WHAT IS NOT COPIED, and why each one is named rather than filtered away:
//
//   Makefile   upstream's per-tileset build glue, run only by its C build to
//              install the tiles. Nothing here builds a C program.
//   list.txt   the graphics-mode catalogue. It IS read - but at BUILD time, by
//              packages/core/scripts/gen-grafmode.mjs, which parses it into
//              grafmode-data.ts. The modes are compiled in and the game never
//              fetches the file.
//
// CREDITS.md is this project's, not upstream's, and is never touched: it carries Raymond
// Gaustadnes' grant of free use for the Shockbolt tiles and the condition that
// rides along with the art. It is committed, and it stays.
//
// Run with --check to compare without writing; that is what the test uses, so
// the guard exercises this code rather than trusting its last output.

import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "..", "..", "reference", "lib", "tiles");
const DEST = join(HERE, "..", "public", "tiles");

/** Upstream files the game does not serve. See the header for the reasons. */
const SKIP = new Set(["Makefile", "list.txt"]);

/** This project's, not upstream's - never generated, never overwritten. */
const OURS = new Set(["CREDITS.md"]);

/** Every file under `dir`, as paths relative to it, in a stable order. */
function walk(dir, base = dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full, base));
    else out.push(relative(base, full).split("\\").join("/"));
  }
  return out;
}

const check = process.argv.includes("--check");
const wanted = walk(SRC).filter((p) => !SKIP.has(p.split("/").pop()));

/* Paths that differ between the vendored tree and the served one. */
const wrong = [];
let copied = 0;

for (const rel of wanted) {
  const from = join(SRC, rel);
  const to = join(DEST, rel);
  const src = readFileSync(from);
  let dst = null;
  try {
    dst = readFileSync(to);
  } catch {
    /* not generated yet */
  }
  if (dst !== null && dst.equals(src)) continue;
  if (check) {
    wrong.push(dst === null ? `${rel} (missing)` : `${rel} (differs)`);
    continue;
  }
  mkdirSync(dirname(to), { recursive: true });
  writeFileSync(to, src);
  copied += 1;
}

/* Anything served that upstream does not have, except this project's own files, is stale -
 * a tileset renamed upstream would otherwise leave its old tree behind forever. */
let stale = [];
try {
  const served = new Set(wanted);
  stale = walk(DEST).filter((p) => !served.has(p) && !OURS.has(p.split("/").pop()));
} catch {
  /* nothing generated yet */
}

if (check) {
  const problems = [...wrong, ...stale.map((p) => `${p} (not in reference/)`)];
  if (problems.length) {
    console.error(
      `packages/web/public/tiles is out of step with reference/lib/tiles:\n` +
        problems.map((p) => `  ${p}`).join("\n") +
        `\n\nRun: node packages/web/scripts/sync-tiles.mjs`,
    );
    process.exit(1);
  }
  console.log(`sync-tiles: ${wanted.length} file(s) match reference/lib/tiles`);
} else {
  for (const rel of stale) console.warn(`sync-tiles: stale, delete by hand: ${rel}`);
  console.log(`sync-tiles: ${copied} copied, ${wanted.length - copied} already current`);
}
