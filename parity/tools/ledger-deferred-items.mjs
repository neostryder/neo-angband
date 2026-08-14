/**
 * The ledger's `deferred:` LIST ITEMS, which the deferral census cannot see.
 *
 * HOW THIS WAS MISSED. deferral-census.mjs greps for deferral WORDING, and the
 * comment justifying its bare-`deferred:`-key exclusion said "the entries UNDER
 * it do [state what is missing], and they are matched on their own text". That is
 * only true of an entry that happens to repeat the word. Most do not:
 *
 *   deferred:
 *     - Curse contributions to object_to_hit/to_dam/weight.
 *     - monster_attack_monster (monster-vs-monster melee).
 *
 * Neither line contains a keyword, so neither was ever a census row - and both
 * had stopped being true. The exclusion was right (a field name is not a claim)
 * and the reasoning attached to it was wrong, which is a worse failure than the
 * exclusion would have been on its own.
 *
 * So: a second, structural scanner. It reads the block under each `deferred:`,
 * `stubbed:` or `partial-codes:` key and emits one row per bullet, keyed by file
 * and line so the same verdict tool can adjudicate them.
 *
 * Usage:
 *   node parity/tools/ledger-deferred-items.mjs             # write the TSV
 *   node parity/tools/ledger-deferred-items.mjs --summary    # counts per file
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const LEDGER = path.join(ROOT, "parity", "ledger");
const OUT = path.join(ROOT, "parity", "reports", "ledger-deferred-items.tsv");

/** Keys whose list items are claims about what the port does not do. */
const KEYS = /^(\s*)(deferred|stubbed|partial-codes):\s*$/;

/**
 * Bullets under a claim key.
 *
 * Text-based rather than YAML-parsed on purpose: the row has to carry a LINE
 * NUMBER so a verdict can point at it and a reader can open it, and a parsed
 * tree has thrown that away. Continuation lines are folded into the bullet they
 * belong to, so a wrapped claim stays one row.
 */
function itemsIn(file) {
  const rel = path.relative(ROOT, file).replace(/\\/g, "/");
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  const out = [];
  let inBlock = null;
  let cur = null;
  const flush = () => {
    if (cur) out.push(cur);
    cur = null;
  };
  for (const [i, raw] of lines.entries()) {
    const m = KEYS.exec(raw);
    if (m) {
      flush();
      inBlock = { key: m[2], indent: m[1].length };
      continue;
    }
    if (!inBlock) continue;
    if (raw.trim() === "") continue;
    const indent = raw.length - raw.trimStart().length;
    /* Back to the key's level (or a new document) ends the block. */
    if (indent <= inBlock.indent || raw.startsWith("---")) {
      flush();
      inBlock = null;
      continue;
    }
    if (/^\s*-\s/.test(raw)) {
      flush();
      cur = {
        file: rel,
        line: i + 1,
        key: inBlock.key,
        text: raw.trim().replace(/^-\s*/, ""),
      };
    } else if (cur) {
      cur.text += ` ${raw.trim()}`;
    }
  }
  flush();
  return out;
}

const files = fs
  .readdirSync(LEDGER)
  .filter((f) => f.endsWith(".yaml"))
  .map((f) => path.join(LEDGER, f));

const rows = files.flatMap(itemsIn);

/** Prior verdicts, by (file, collapsed text) as the census does. */
const idOf = (r) => `${r.file}\u0000${r.text.replace(/\s+/gu, " ").slice(0, 120)}`;
const prior = new Map();
if (fs.existsSync(OUT)) {
  const lines = fs.readFileSync(OUT, "utf8").split(/\r?\n/);
  const head = (lines[0] ?? "").split("\t");
  const iFile = head.indexOf("file");
  const iVerdict = head.indexOf("verdict");
  const iEvidence = head.indexOf("evidence");
  const iText = head.indexOf("text");
  if (iFile >= 0 && iVerdict >= 0 && iText >= 0) {
    for (const l of lines.slice(1)) {
      if (l.trim() === "") continue;
      const c = l.split("\t");
      if ((c[iVerdict] ?? "") === "") continue;
      prior.set(idOf({ file: c[iFile] ?? "", text: c[iText] ?? "" }), {
        verdict: c[iVerdict] ?? "",
        evidence: iEvidence >= 0 ? (c[iEvidence] ?? "") : "",
      });
    }
  }
}

const matched = new Set();
for (const r of rows) {
  const carried = prior.get(idOf(r));
  r.verdict = carried?.verdict ?? "";
  r.evidence = carried?.evidence ?? "";
  if (carried) matched.add(idOf(r));
}

if (process.argv.includes("--summary")) {
  const byFile = new Map();
  for (const r of rows) byFile.set(r.file, (byFile.get(r.file) ?? 0) + 1);
  const done = rows.filter((r) => r.verdict !== "").length;
  console.log(`items: ${rows.length}  adjudicated: ${done}  remaining: ${rows.length - done}`);
  for (const [f, n] of [...byFile].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(3)}  ${f}`);
  }
} else {
  fs.mkdirSync(path.dirname(OUT), { recursive: true });
  const head = "file\tline\tkey\tverdict\tevidence\ttext";
  const body = rows.map((r) =>
    [r.file, r.line, r.key, r.verdict, r.evidence, r.text.replace(/\t/gu, " ").slice(0, 400)].join("\t"),
  );
  fs.writeFileSync(OUT, `${[head, ...body].join("\n")}\n`, "utf8");
  console.log(`${rows.length} items -> ${path.relative(ROOT, OUT)}`);
  console.log(`carried ${matched.size} of ${prior.size} prior verdict(s) forward`);
  const dropped = [...prior.keys()].filter((k) => !matched.has(k));
  if (dropped.length > 0) {
    console.log(`dropped ${dropped.length} (their item no longer exists):`);
    for (const k of dropped) console.log(`  ${prior.get(k)?.verdict ?? "?"}  ${k.replace("\u0000", " ").slice(0, 110)}`);
  }
}
