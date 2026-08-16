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
 * Usage: node parity/tools/deferral-triage.mjs [--target <tsv>] [--hint likely-real]
 *
 * --target points it at any adjudicable TSV with the same file/line/verdict/text
 * columns, which is how the 331 ledger `deferred:` items get the same reading
 * order as the census did. The symbol harvester below does not care which list
 * asked the question.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const tIdx = process.argv.indexOf("--target");
const CENSUS =
  tIdx >= 0
    ? path.resolve(ROOT, process.argv[tIdx + 1])
    : path.join(ROOT, "parity", "reports", "deferral-census.tsv");

if (!fs.existsSync(CENSUS)) {
  console.error(`no such list: ${CENSUS} - run parity/tools/deferral-census.mjs first`);
  process.exit(1);
}

/**
 * Every identifier in the port, harvested once, WITH the file that declares it
 * and how many other files mention it.
 *
 * "The name exists" was the first version of this, and it is the weaker half of
 * the question. A ported-looking symbol that nothing outside its own module ever
 * names is the shape of the trap this project has hit before: the function is
 * written, tested and unreachable, so a census reads it as present and play
 * never runs it. So presence is recorded as {decl, refs} and a symbol declared
 * with refs === 0 is triaged as `dead-candidate`, not as evidence of a port.
 *
 * refs counts FILES, not call sites, and it counts mentions rather than calls -
 * a comment naming the symbol in another module still counts. It is a filter for
 * reading order, never a verdict; see the note above about self-referential
 * harnesses.
 */
function portSymbols() {
  const decl = new Map();
  const mentions = new Map();
  const files = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) files.push(p);
    }
  };
  for (const sub of ["core", "web", "cli", "desktop", "mod-sdk", "linoleum"]) {
    const dir = path.join(ROOT, "packages", sub, "src");
    if (fs.existsSync(dir)) walk(dir);
  }
  const bodies = new Map();
  for (const p of files) {
    const body = fs.readFileSync(p, "utf8");
    bodies.set(p, body);
    /* Declarations only, not mentions: a symbol that appears solely inside a
     * comment is exactly the thing being audited and must not count as present. */
    for (const m of body.matchAll(
      /(?:function|const|let|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)/g,
    )) {
      if (!decl.has(m[1])) decl.set(m[1], p);
    }
    for (const m of body.matchAll(/^\s*(?:readonly\s+)?([a-z][\w$]*)\s*[?:(]/gm)) {
      if (!decl.has(m[1])) decl.set(m[1], p);
    }
  }
  for (const [name, home] of decl) {
    let n = 0;
    const re = new RegExp(`\\b${name.replace(/[$]/g, "\\$")}\\b`, "gu");
    for (const [p, body] of bodies) {
      const hits = (body.match(re) ?? []).length;
      /* In its OWN file the declaration itself is one of the hits, so a
       * module-private helper used twice inside its module reads as 1 and not 0.
       * The first cut of this counted other files only, and called
       * combat/hit.ts's hitChance and obj/make.ts's applyCurse dead - both are
       * called from within their own module. A statistic that cannot see the
       * shape of what it counts reports a gap that is not there. */
      n += p === home ? Math.max(0, hits - 1) : hits > 0 ? 1 : 0;
    }
    mentions.set(name, n);
  }
  return { has: (n) => decl.has(n), refs: (n) => mentions.get(n) ?? 0 };
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
const rawHeader = lines[0].split("\t");
const rawRows = lines.slice(1).filter((l) => l.trim() !== "").map((l) => l.split("\t"));

/**
 * Drop any hint/absent columns a PREVIOUS triage run left behind.
 *
 * Writing them unconditionally is not idempotent: three runs produced
 * `hint absent hint absent hint absent text`, every reader that looks up `text`
 * by name still worked, and every reader that took the 8th column silently got
 * a hint instead. A tool that corrupts its own input on the second run is worse
 * than one that refuses to run twice.
 */
const drop = new Set();
rawHeader.forEach((h, i) => {
  if (h === "hint" || h === "absent") drop.add(i);
});
const header = rawHeader.filter((_, i) => !drop.has(i));
const rows = rawRows.map((r) => r.filter((_, i) => !drop.has(i)));
const iText = header.indexOf("text");
const iVerdict = header.indexOf("verdict");

const out = [];
const counts = {};
for (const r of rows) {
  const text = r[iText] ?? "";
  const syms = symbolsIn(text);
  const nameOf = (s) => (SYMS.has(camel(s)) ? camel(s) : s);
  const present = syms.filter((s) => SYMS.has(camel(s)) || SYMS.has(s));
  const absent = syms.filter((s) => !SYMS.has(camel(s)) && !SYMS.has(s));
  /* Declared, but no other module in the port ever names it. */
  const orphan = present.filter((s) => SYMS.refs(nameOf(s)) === 0);
  let hint;
  if (syms.length === 0) hint = "no-symbol";
  else if (absent.length === 0 && orphan.length > 0) hint = "dead-candidate";
  else if (absent.length === 0) hint = "likely-stale";
  else if (present.length > 0) hint = "mixed";
  else hint = "likely-real";
  counts[hint] = (counts[hint] ?? 0) + 1;
  out.push({ row: r, hint, present, absent, orphan });
}

/* `--refs <camelName>`: what the reference count actually says about one symbol.
 * Present so the dead-candidate branch can be checked against a name whose
 * answer is known, rather than trusted because it printed nothing. */
if (process.argv.includes("--refs")) {
  const name = process.argv[process.argv.indexOf("--refs") + 1];
  console.log(`${name}: declared=${SYMS.has(name)} refs=${SYMS.refs(name)}`);
  process.exit(0);
}

const want = process.argv.includes("--hint")
  ? process.argv[process.argv.indexOf("--hint") + 1]
  : null;

if (want) {
  for (const o of out) {
    if (o.hint !== want) continue;
    if ((o.row[iVerdict] ?? "") !== "") continue;
    /* For a dead-candidate the interesting names are the ORPHANS, not the
     * absentees - there are none of the latter, which is why it is not
     * likely-real. */
    const names = o.hint === "dead-candidate" ? o.orphan : o.absent;
    console.log(`${o.row[0]}:${o.row[1]}\t[${names.join(" ")}]\t${(o.row[iText] ?? "").slice(0, 130)}`);
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
