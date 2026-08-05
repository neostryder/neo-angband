/**
 * Cross-check every `real` verdict against the port, by the C NAME.
 *
 * WHY THIS EXISTS. The first tranche was adjudicated partly on greps for a
 * camelCase transliteration of the C symbol - `changeItemQuantity` for
 * do_cmd_wiz_change_item_quantity, `playItem` for do_cmd_wiz_play_item,
 * `storeInit` for store_init, `showFloor` for show_floor. All four came back
 * empty and all four were recorded as "absent (0 sites)". All four are PORTED:
 * the port calls them runChangeQuantity, runPlayItem, storeChooseOwner and
 * showFloorList. Four of the eight verdicts resting on that evidence shape were
 * wrong - a 50% error rate - and every one of them would have put finished work
 * on a to-do list.
 *
 * A failed transliteration grep is not evidence of absence. What this codebase
 * DOES do reliably is cite the upstream function by its real C name in a comment
 * beside the port of it. So the far better question is: does the C name appear
 * anywhere in the port OTHER than in the deferral note that claims it is
 * missing?
 *
 * A hit is a LEAD, not a verdict - it may be the note's own restatement, a
 * mention in a sibling comment, or a genuine implementation. The point is that
 * an absence claim with a hit next to it has to be looked at by a human before
 * it goes on a work list. Same discipline as deferral-triage.mjs: this writes
 * evidence for a reader, never a verdict.
 *
 * Usage:
 *   node parity/tools/deferral-crosscheck.mjs [--verdict real] [--target <tsv>]
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const tIdx = process.argv.indexOf("--target");
const LIST =
  tIdx >= 0
    ? path.resolve(ROOT, process.argv[tIdx + 1])
    : path.join(ROOT, "parity", "reports", "deferral-census.tsv");
const vIdx = process.argv.indexOf("--verdict");
const WANT = vIdx >= 0 ? process.argv[vIdx + 1] : "real";

/** Every port source file, with its text. Tests included: a test naming the C
 * function is itself evidence that something implements it. */
const bodies = new Map();
const walk = (dir) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.ts$/u.test(e.name)) bodies.set(path.relative(ROOT, p).replace(/\\/gu, "/"), fs.readFileSync(p, "utf8"));
  }
};
for (const sub of ["core", "web", "cli", "desktop", "mod-sdk"]) {
  const dir = path.join(ROOT, "packages", sub, "src");
  if (fs.existsSync(dir)) walk(dir);
}

const lines = fs.readFileSync(LIST, "utf8").split(/\r?\n/u);
const head = (lines[0] ?? "").split("\t");
const iFile = head.indexOf("file");
const iLine = head.indexOf("line");
const iVerdict = head.indexOf("verdict");
const iEvidence = head.indexOf("evidence");
const iText = head.length - 1;

/**
 * The C identifiers a note names. Two or more underscore-separated parts, so
 * `to_h` and `obj` do not qualify but `do_cmd_wiz_play_item` does. Short and
 * ubiquitous names are dropped: a hit on `square_isempty` means something, a hit
 * on `obj_known` is noise in a codebase that says it everywhere.
 */
const NOISE = new Set(["obj_known", "known_obj", "to_dam", "to_hit", "player_state", "known_state"]);
function csyms(text) {
  const out = new Set();
  for (const m of text.matchAll(/\b([a-z][a-z0-9]*(?:_[a-z0-9]+){1,})\b/gu)) {
    if (m[1].length >= 8 && !NOISE.has(m[1])) out.add(m[1]);
  }
  return [...out];
}

/**
 * The marker a reader writes into a row's EVIDENCE once they have opened the
 * lead and decided what it means. Without it this tool re-prints every lead
 * forever, which is the same as printing none: a list that never shrinks is not
 * a worklist, and the row that stays `real` after being read is
 * indistinguishable from the row nobody looked at.
 *
 * It is deliberately a marker on the evidence rather than a side file, so the
 * reading and the reason for the verdict live in the same cell.
 */
const READ = "LEAD READ";
const SHOW_READ = process.argv.includes("--all");

let checked = 0;
let withHits = 0;
let read = 0;
for (const l of lines.slice(1)) {
  if (l.trim() === "") continue;
  const c = l.split("\t");
  if ((c[iVerdict] ?? "") !== WANT) continue;
  const wasRead = (c[iEvidence] ?? "").includes(READ);
  if (wasRead && !SHOW_READ) {
    read++;
    continue;
  }
  const own = `${c[iFile]}`.replace(/\\/gu, "/");
  const syms = csyms(c[iText] ?? "");
  if (syms.length === 0) continue;
  checked++;
  const hits = [];
  for (const s of syms) {
    const re = new RegExp(`\\b${s}\\b`, "u");
    for (const [p, body] of bodies) {
      /* The note's own file is excluded: a source comment claiming the thing is
       * missing names it, and that self-reference is exactly what must not count
       * as evidence of a port. */
      if (p === own) continue;
      if (re.test(body)) {
        hits.push(`${s} -> ${p}`);
        break;
      }
    }
  }
  if (hits.length === 0) continue;
  withHits++;
  console.log(`${own}:${c[iLine]}`);
  for (const h of hits) console.log(`    ${h}`);
}
console.error(
  `\n${withHits} UNREAD of ${checked} \`${WANT}\` rows name a C symbol the port mentions ` +
    `elsewhere - each is a LEAD to read, not a verdict. ${read} already read ` +
    `(evidence says "${READ}"; --all re-prints them).`,
);
