/**
 * Mechanical triage of the deferral census: which notes name a C symbol the port
 * ALREADY HAS?
 *
 * WHY. Seven deferral notes were adjudicated by hand first, and all seven were stale -
 * the work had landed and the comment was never updated (monster_take_terrain_damage is
 * called by the scheduler; store_maint, store_carry and do_cmd_buy are all in
 * core/src/store; pickLock is supplied at session/game.ts:1716; monster_can_see IS plain
 * line of sight in the C, so the note was wrong about upstream as well as about the
 * port). Reviewing 444 rows one at a time at that hit rate is the wrong use of the
 * effort: what is needed is a filter that puts the plausibly-real ones first.
 *
 * WHAT THIS IS AND IS NOT. Name matching is EVIDENCE, NOT A VERDICT. A found symbol may
 * be defined and never called (the "shipped is not reachable" trap), and a missing one
 * may be present under a different name, inlined, or genuinely irrelevant. So this
 * writes a `hint` column and never a `verdict` - the verdict column stays empty until a
 * human has read the C and the port. Treating the hint as an answer would rebuild the
 * self-referential harness this project already got burned by once.
 *
 * Usage: node parity/tools/deferral-triage.mjs [--hint likely-real]
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const CENSUS = path.join(ROOT, "parity", "reports", "deferral-census.tsv");

if (!fs.existsSync(CENSUS)) {
  console.error("no census yet - run parity/tools/deferral-census.mjs first");
  process.exit(1);
}

/** Every identifier in the port, harvested once. Cheaper than a grep per symbol. */
function portSymbols() {
  const out = new Set();
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) {
        const body = fs.readFileSync(p, "utf8");
        /* Declarations only, not mentions: a symbol that appears solely inside a
         * comment is exactly the thing being audited and must not count as present. */
        for (const m of body.matchAll(
          /(?:function|const|let|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
        )) {
          out.add(m[1]);
        }
        for (const m of body.matchAll(/^\s*(?:readonly\s+)?([a-z][\w$]*)\s*[?:(]/gm)) {
          out.add(m[1]);
        }
      }
    }
  };
  for (const sub of ["core", "web", "cli", "desktop", "mod-sdk", "linoleum"]) {
    const dir = path.join(ROOT, "packages", sub, "src");
    if (fs.existsSync(dir)) walk(dir);
  }
  return out;
}

const camel = (s) => s.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase());

const SYMS = portSymbols();

/** C identifiers a note names: snake_case, or a known bare C name. */
function symbolsIn(text) {
  const found = new Set();
  for (const m of text.matchAll(/\b([a-z][a-z0-9]*(?:_[a-z0-9]+)+)\b/g)) found.add(m[1]);
  return [...found];
}

const lines = fs.readFileSync(CENSUS, "utf8").split(/\r?\n/);
const header = lines[0].split("\t");
const rows = lines.slice(1).filter((l) => l.trim() !== "").map((l) => l.split("\t"));
const iText = header.indexOf("text");
const iVerdict = header.indexOf("verdict");

const out = [];
const counts = {};
for (const r of rows) {
  const text = r[iText] ?? "";
  const syms = symbolsIn(text);
  const present = syms.filter((s) => SYMS.has(camel(s)) || SYMS.has(s));
  const absent = syms.filter((s) => !SYMS.has(camel(s)) && !SYMS.has(s));
  let hint;
  if (syms.length === 0) hint = "no-symbol";
  else if (absent.length === 0) hint = "likely-stale";
  else if (present.length > 0) hint = "mixed";
  else hint = "likely-real";
  counts[hint] = (counts[hint] ?? 0) + 1;
  out.push({ row: r, hint, present, absent });
}

const want = process.argv.includes("--hint")
  ? process.argv[process.argv.indexOf("--hint") + 1]
  : null;

if (want) {
  for (const o of out) {
    if (o.hint !== want) continue;
    if ((o.row[iVerdict] ?? "") !== "") continue;
    console.log(`${o.row[0]}:${o.row[1]}\t[${o.absent.join(" ")}]\t${(o.row[iText] ?? "").slice(0, 130)}`);
  }
} else {
  const withHint = [header.join("\t").replace("\ttext", "\thint\tabsent\ttext")];
  for (const o of out) {
    const r = [...o.row];
    const text = r.splice(iText, 1)[0];
    withHint.push([...r, o.hint, o.absent.join(" "), text].join("\t"));
  }
  fs.writeFileSync(CENSUS, `${withHint.join("\n")}\n`, "utf8");
  console.log(`triaged ${rows.length} rows:`);
  for (const [h, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)}  ${h}`);
  }
}
