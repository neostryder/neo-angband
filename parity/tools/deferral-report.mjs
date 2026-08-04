/**
 * Fill the generated appendix of parity/DEFERRALS.md from the census.
 *
 * WHY IT IS GENERATED. The prose above the marker is the part a person has to
 * write - which items collapse into one, which of them a player would notice,
 * what the mechanism is behind an "unnecessary" verdict. The row list is the part
 * that goes stale the moment anyone edits a note, and a hand-maintained copy of
 * 367 rows would be wrong within a week. So the file is authored prose plus a
 * machine-written appendix, and a test fails when the appendix is out of date.
 *
 * Usage:
 *   node parity/tools/deferral-report.mjs           # rewrite the appendix
 *   node parity/tools/deferral-report.mjs --check   # exit 1 if it would change
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const CENSUS = path.join(ROOT, "parity", "reports", "deferral-census.tsv");
const DOC = path.join(ROOT, "parity", "DEFERRALS.md");

const BEGIN = "<!-- BEGIN GENERATED: deferral-report.mjs -->";
const END = "<!-- END GENERATED -->";

/** What each verdict means, in the order the appendix presents them. */
const ORDER = [
  ["real", "Confirmed absent and owed"],
  ["partial", "Part ported; the note must say which part is not"],
  ["real-dead", "Present and unreachable"],
  ["divergence", "Deliberately different, with the mechanism named"],
  ["n-a", "Not applicable to this port, with the mechanism named"],
  ["ported", "Done; the note was stale and has been rewritten"],
  ["stale-doc", "The note described a state of the code that no longer holds"],
  ["note-is-fix", "The wording sits inside a record of a FIX, not a gap"],
  ["not-a-deferral", "Ordinary English, not a parity claim"],
];

function rows() {
  const lines = fs.readFileSync(CENSUS, "utf8").split(/\r?\n/);
  const head = (lines[0] ?? "").split("\t");
  const at = (n) => head.indexOf(n);
  const [iFile, iLine, iVerdict, iEvidence, iText] = [
    at("file"),
    at("line"),
    at("verdict"),
    at("evidence"),
    at("text"),
  ];
  const out = [];
  for (const l of lines.slice(1)) {
    if (l.trim() === "") continue;
    const c = l.split("\t");
    out.push({
      ref: `${c[iFile]}:${c[iLine]}`,
      verdict: c[iVerdict] ?? "",
      evidence: c[iEvidence] ?? "",
      text: c[iText] ?? "",
    });
  }
  return out;
}

const all = rows();
const counts = new Map();
for (const r of all) counts.set(r.verdict || "(unadjudicated)", (counts.get(r.verdict || "(unadjudicated)") ?? 0) + 1);

const md = [];
md.push("## Appendix: every row, with its verdict");
md.push("");
md.push(`Generated from \`parity/reports/deferral-census.tsv\` (${all.length} rows).`);
md.push("");
md.push("| verdict | meaning | rows |");
md.push("| --- | --- | --- |");
for (const [v, meaning] of ORDER) {
  const n = counts.get(v) ?? 0;
  if (n > 0) md.push(`| \`${v}\` | ${meaning} | ${n} |`);
}
const unadjudicated = counts.get("(unadjudicated)") ?? 0;
md.push(`| | **total** | **${all.length}** |`);
md.push("");
if (unadjudicated > 0) {
  /* Named rather than omitted: an incomplete census that cannot show its own
   * incompleteness is the failure this whole exercise exists to avoid. */
  md.push(`**${unadjudicated} row(s) are still unadjudicated.**`);
  md.push("");
}

for (const [v, meaning] of ORDER) {
  const mine = all.filter((r) => r.verdict === v);
  if (mine.length === 0) continue;
  md.push(`### \`${v}\` - ${meaning} (${mine.length})`);
  md.push("");
  for (const r of mine) {
    md.push(`- \`${r.ref}\` - ${r.evidence || "_(no evidence recorded)_"}`);
  }
  md.push("");
}

const body = `${BEGIN}\n\n${md.join("\n").trimEnd()}\n\n${END}`;
const doc = fs.readFileSync(DOC, "utf8");
const start = doc.indexOf(BEGIN);
const stop = doc.indexOf(END);
if (start < 0 || stop < 0) {
  console.error(`parity/DEFERRALS.md is missing its generated markers`);
  process.exit(1);
}
const next = doc.slice(0, start) + body + doc.slice(stop + END.length);

if (process.argv.includes("--check")) {
  if (next !== doc) {
    console.error("parity/DEFERRALS.md appendix is stale - run node parity/tools/deferral-report.mjs");
    process.exit(1);
  }
  console.log("parity/DEFERRALS.md appendix is current");
} else {
  fs.writeFileSync(DOC, next, "utf8");
  console.log(`wrote the appendix: ${all.length} rows, ${ORDER.filter(([v]) => (counts.get(v) ?? 0) > 0).length} verdict groups`);
}
