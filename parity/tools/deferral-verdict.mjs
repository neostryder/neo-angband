/**
 * Record an adjudication in the deferral census.
 *
 * The census is re-runnable and merges verdicts forward by (file, line-text)
 * identity, so a verdict has to be written INTO the TSV rather than kept in a
 * side file - and hand-editing a 441-row tab-separated file is how a verdict
 * lands in the wrong column. This writes the two cells by header name, the same
 * way deferral-census.mjs reads them.
 *
 * Usage:
 *   node parity/tools/deferral-verdict.mjs <file>:<line> <verdict> <evidence...>
 *   node parity/tools/deferral-verdict.mjs --batch <tsv>   # file:line \t verdict \t evidence
 *
 * The vocabulary, deliberately small - a verdict has to mean something a reader
 * can act on:
 *
 *   ported        the work is done; the note is stale and should be deleted
 *   note-is-fix   the "deferred" wording sits inside a record of a FIX (census noise)
 *   real          confirmed absent and owed; finish it
 *   real-dead     the function exists and NOTHING calls it (shipped is not reachable)
 *   partial       part is ported; the note must say which part is not
 *   n-a           not applicable to this port, with the mechanism named
 *   divergence    deliberately different, ratified, with the reason
 *   stale-doc     the note describes a state of the code that no longer holds
 *   not-a-deferral the census matched ordinary English, not a parity claim
 *                 (a `todo` variable, a setTimeout "deferred a tick", a mod
 *                 that "defers to" another mod). Kept as a VERDICT rather than
 *                 filtered out of the census, so the row stays visible and the
 *                 reason it does not count is written next to it.
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
/* The census by default; --target points it at another adjudicable TSV with the
 * same file/line/verdict/evidence columns (ledger-deferred-items.tsv). */
const tIdx = process.argv.indexOf("--target");
const OUT =
  tIdx >= 0
    ? path.resolve(ROOT, process.argv[tIdx + 1])
    : path.join(ROOT, "parity", "reports", "deferral-census.tsv");

const VERDICTS = new Set([
  "ported",
  "note-is-fix",
  "real",
  "real-dead",
  "partial",
  "n-a",
  "divergence",
  "stale-doc",
  "not-a-deferral",
]);

/** [file:line, verdict, evidence] triples from argv or a batch file. */
function requests() {
  let argv = process.argv.slice(2);
  const t = argv.indexOf("--target");
  if (t >= 0) argv = [...argv.slice(0, t), ...argv.slice(t + 2)];
  if (argv[0] === "--batch") {
    const body = fs.readFileSync(argv[1], "utf8");
    return body
      .split(/\r?\n/)
      .filter((l) => l.trim() !== "" && !l.startsWith("#"))
      .map((l) => {
        const [ref, verdict, ...rest] = l.split("\t");
        return [ref, verdict, rest.join(" ")];
      });
  }
  const [ref, verdict, ...evidence] = argv;
  return [[ref, verdict, evidence.join(" ")]];
}

const lines = fs.readFileSync(OUT, "utf8").split(/\r?\n/);
const head = (lines[0] ?? "").split("\t");
const iFile = head.indexOf("file");
const iLine = head.indexOf("line");
const iVerdict = head.indexOf("verdict");
const iEvidence = head.indexOf("evidence");
if (iFile < 0 || iLine < 0 || iVerdict < 0 || iEvidence < 0) {
  console.error("census header is missing a column this needs");
  process.exit(1);
}

let changed = 0;
const missed = [];
for (const [ref, verdict, evidence] of requests()) {
  if (!VERDICTS.has(verdict)) {
    console.error(`unknown verdict "${verdict}" for ${ref} (see the header of this file)`);
    process.exit(1);
  }
  const at = ref.lastIndexOf(":");
  const file = ref.slice(0, at);
  const line = ref.slice(at + 1);
  let hit = false;
  for (let i = 1; i < lines.length; i++) {
    const c = lines[i].split("\t");
    if (c[iFile] !== file || c[iLine] !== line) continue;
    /* A tab in the evidence would shift every later column, so it cannot be
     * allowed through - the whole point of this script is that the cells stay
     * where the header says they are. */
    c[iVerdict] = verdict;
    c[iEvidence] = evidence.replace(/\t/gu, " ");
    lines[i] = c.join("\t");
    hit = true;
    changed++;
    break;
  }
  if (!hit) missed.push(ref);
}

fs.writeFileSync(OUT, lines.join("\n"), "utf8");
console.log(`recorded ${changed} verdict(s)`);
/* A ref that matched nothing is a typo or a moved line, and silently recording
 * nothing is how an adjudication gets lost. */
if (missed.length) {
  console.error(`NO SUCH ROW (nothing recorded for these): ${missed.join(", ")}`);
  process.exit(1);
}
