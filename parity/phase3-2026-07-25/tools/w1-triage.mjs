/*
 * Mechanical first pass over the W1 unmatched-symbol queue.
 *
 * The queue's "unmatched" verdict is a NAME-matching result, not a behavioural
 * one, and the port renames deliberately: cave-square.c's square_isfloor /
 * square_iscloseddoor / square_isstairs are Chunk METHODS isFloor /
 * isClosedDoor / isStairs (world/chunk.ts:286, :354, :358). A camelCase
 * transform of the C name finds none of them.
 *
 * So match on the COLLAPSED name -- lowercase, non-alphanumerics removed --
 * which makes square_iscloseddoor and isClosedDoor both "iscloseddoor", and
 * try the name both whole and with a leading C namespace prefix stripped.
 * That is a candidate-generator, not an adjudication: a collapsed hit says
 * "there is a plausible counterpart here, go look", and the file it points at
 * is the evidence a reviewer needs.
 */
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const OUT = process.argv[2] ?? "parity/phase3-2026-07-25/reports";
const Q = "parity/phase3-2026-07-25/reports/w1-adjudication-queue.tsv";
/* Symbols a human has adjudicated as having no port counterpart BY DESIGN
 * (native front end, mouse-only UI, dead C API). Without this the same handful
 * come back in the residue on every run and get re-adjudicated forever. Each
 * row must carry its rule and its reasoning; see findings/W1-CITED.md. */
const EXCL = "parity/phase3-2026-07-25/reports/w1-scope-excluded.tsv";

/* C namespace prefixes the port routinely drops, because the namespace becomes
 * the class or module instead (square_* -> Chunk methods, and so on). */
const PREFIXES = [
  "square_", "cave_", "player_", "monster_", "mon_", "object_", "obj_",
  "effect_handler_", "effect_", "do_cmd_", "cmd_", "textui_", "ui_", "get_",
  "player_know_", "know_", "store_", "wiz_", "borg_", "z_", "mem_", "string_",
  "file_", "path_", "msg_", "event_", "option_", "opt_", "target_", "list_",
];

/* C prefixes the port RENAMES rather than drops, verified against the port:
 * load.c rd_monster is session/save.ts deserializeMonster, save.c wr_* is
 * serialize*, and a datafile parse_foo becomes a parse* spec/helper. Stripping
 * "rd_" alone yields "monster", which collides with `interface Monster` and
 * points a reviewer at the wrong file; the alias points at the real one. */
const ALIASES = [
  ["rd_", "deserialize"],
  ["wr_", "serialize"],
  ["init_parse_", "parse"],
  ["finish_parse_", "parse"],
];

/* Suffixes the port appends to a C name; the C side never carries them, so an
 * index that only stores the full identifier cannot match. do_cmd_navigate_down
 * is navigateDownAction (game/player-path.ts), do_cmd_pathfind is
 * pathfindAction, and a C singular reader is often a plural port function
 * (rd_trap -> deserializeTraps). W1-CITED found these by hand; indexing the
 * stripped form is what stops the next run repeating that work. */
const SUFFIXES = ["action", "handler", "aux", "s"];

const collapse = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

function candidates(name) {
  const set = new Set([collapse(name)]);
  for (const p of PREFIXES) {
    if (name.startsWith(p) && name.length > p.length) set.add(collapse(name.slice(p.length)));
  }
  for (const [p, repl] of ALIASES) {
    if (name.startsWith(p) && name.length > p.length) {
      set.add(collapse(repl + name.slice(p.length)));
    }
  }
  return [...set].filter((c) => c.length >= 4); // 3-char stubs match everything
}

/* Word-boundary citation test. `src.includes("q_push")` is true for any file
 * mentioning cmdq_push, `file_put` for file_putf, `parser_new` for
 * store_parser_new, `chunk_find` for chunk_find_adjacent, and `lread` for the
 * English word "already" -- all five were counted as citations by the
 * substring test and all five were false. A citation of a LONGER C symbol is
 * not a citation of this one. */
function citeLine(src, name) {
  const re = new RegExp(`(?<![A-Za-z0-9_])${name}(?![A-Za-z0-9_])`, "g");
  const m = re.exec(src);
  if (!m) return -1;
  let line = 1;
  for (let i = 0; i < m.index; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", "dist", ".git"].includes(e.name)) continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|mjs|js)$/.test(e.name) && !/\.d\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

const files = walk("packages").map((f) => {
  const path = f.replace(/\\/g, "/");
  return { path, src: readFileSync(f, "utf8"), isTest: /\.test\.ts$/.test(path) };
});

/* identifier index: collapsed identifier -> port files declaring it. */
/* NOTE the absence of a `\*\s*` alternative on the method branch. It used to be
 * there, and it made every JSDoc line of the shape ` * some_c_name (file:line)`
 * register as a DECLARATION of some_c_name -- so a citation comment scored as an
 * implementation and PORTED-AND-CITED could rest on nothing but a comment. Only
 * the explicit citation-anchored rule below is allowed to draw a verdict from a
 * comment, and it labels it (`cite:`) when it does. */
const DECL =
  /(?:function|const|let|var|class|interface|type|enum)\s+([A-Za-z_$][\w$]*)|^[ \t]*(?:readonly\s+|public\s+|private\s+|static\s+)?([A-Za-z_$][\w$]*)\s*[(<]/gm;
const index = new Map();
/* Per-file declaration line numbers, for the citation-anchored rule below. */
const decls = new Map();
for (const f of files) {
  if (f.isTest) continue;
  const perFile = [];
  decls.set(f.path, perFile);
  for (const m of f.src.matchAll(DECL)) {
    const id = m[1] ?? m[2];
    if (!id) continue;
    let line = 1;
    for (let i = 0; i < m.index; i++) if (f.src.charCodeAt(i) === 10) line++;
    perFile.push([line, id]);
    if (id.length < 4) continue;
    const k = collapse(id);
    /* Index the identifier whole AND with a port-idiom suffix stripped, so a C
     * name the port suffixed still matches. */
    const keys = [k];
    for (const s of SUFFIXES) {
      if (k.endsWith(s) && k.length - s.length >= 4) keys.push(k.slice(0, -s.length));
    }
    for (const key of keys) {
      let e = index.get(key);
      if (!e) index.set(key, (e = new Set()));
      e.add(f.path);
    }
  }
  perFile.sort((a, b) => a[0] - b[0]);
}

/* name -> rule, from the human-adjudicated scope-exclusion list. */
const excluded = new Map(
  readFileSync(EXCL, "utf8")
    .trim()
    .split(/\r?\n/)
    .slice(1)
    .filter((l) => l.length > 0)
    .map((l) => {
      const [name, rule] = l.split("\t");
      return [name, rule];
    }),
);

/* Package preference when a collapsed name matches in several places. */
const rank = (p) =>
  p.includes("/core/") ? 0 : p.includes("/content/") ? 1 : p.includes("/web/") ? 2 : 3;

const items = readFileSync(Q, "utf8")
  .trim()
  .split(/\r?\n/)
  .slice(1)
  .map((l) => {
    const [bucket, isStatic, name, file, line] = l.split("\t");
    return { bucket, static: isStatic === "true", name, file, line };
  });

const out = [];
for (const it of items) {
  let hit = null;
  let via = "";
  for (const c of candidates(it.name)) {
    const f = index.get(c);
    if (f) {
      /* Prefer core: a borg or web file that happens to declare the same
       * collapsed name is a coincidence, not the port of an engine symbol. */
      hit = [...f].sort((a, b) => rank(a) - rank(b));
      via = c;
      break;
    }
  }
  /* Word-boundary citations, with the file and line so the reviewer does not
   * have to grep for them, and so the anchored rule below can use them. */
  const cites = [];
  for (const f of files) {
    if (f.isTest) continue;
    const line = citeLine(f.src, it.name);
    if (line > 0) cites.push([f.path, line]);
  }
  const namedCite = cites.length > 0;
  const base = it.file.split("/").pop();
  const areaWorked = files.some((f) => !f.isTest && f.src.includes(base));

  /* Citation-anchored counterpart: an explicit `/* c_name (file:line) *\/`
   * comment immediately above a declaration IS the adjudication, recorded in
   * the source where it cannot rot away from the code. Accept a declaration
   * within CITE_WINDOW lines after the citation. This is what makes the
   * W1-CITED citation comments load-bearing instead of decorative. The window
   * has to clear a full doc comment, several of which spell out a divergence
   * over a dozen lines before the declaration they belong to. */
  const CITE_WINDOW = 25;
  let anchored = null;
  for (const [path, line] of cites) {
    const d = (decls.get(path) ?? []).find(([dl]) => dl >= line && dl <= line + CITE_WINDOW);
    if (d) {
      anchored = [path, d[1]];
      break;
    }
  }

  const excl = excluded.get(it.name);

  let verdict;
  if (excl) verdict = "SCOPE-EXCLUDED";
  else if (hit && namedCite) verdict = "PORTED-AND-CITED";
  else if (anchored) verdict = "PORTED-AND-CITED";
  else if (hit) verdict = "CANDIDATE-RENAMED";
  else if (namedCite) verdict = "CITED-NO-CANDIDATE";
  else if (areaWorked) verdict = "AREA-WORKED-NO-CANDIDATE";
  else verdict = "NO-TRACE";

  const where = hit?.[0] ?? anchored?.[0] ?? cites[0]?.[0] ?? "";
  out.push({
    ...it,
    verdict,
    via: excl ?? (via || (anchored ? `cite:${anchored[1]}` : "")),
    where: excl ? "" : where.replace("packages/", ""),
  });
}

const counts = {};
for (const o of out) counts[o.verdict] = (counts[o.verdict] ?? 0) + 1;
console.log("=== mechanical verdicts over 1793 unmatched C symbols ===");
for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(String(v).padStart(5), k);
}

const residue = out.filter(
  (o) => o.verdict === "AREA-WORKED-NO-CANDIDATE" || o.verdict === "NO-TRACE",
);
console.log(`\n=== residue needing human adjudication: ${residue.length} ===`);
const byB = {};
for (const r of residue) {
  const k = `${r.bucket}/${r.static ? "static" : "extern"}`;
  byB[k] = (byB[k] ?? 0) + 1;
}
for (const [k, v] of Object.entries(byB).sort((a, b) => b[1] - a[1])) {
  console.log(String(v).padStart(5), k);
}

console.log("\n=== residue by C file, engine+extern only, top 20 ===");
const perFile = {};
for (const r of residue.filter((o) => o.bucket === "engine" && !o.static)) {
  perFile[r.file] = (perFile[r.file] ?? 0) + 1;
}
for (const [k, v] of Object.entries(perFile).sort((a, b) => b[1] - a[1]).slice(0, 20)) {
  console.log(String(v).padStart(4), k);
}

writeFileSync(
  `${OUT}/w1-triage.tsv`,
  ["bucket\tstatic\tname\tfile\tline\tmechanical\tmatched_as\tport_file"]
    .concat(
      out.map((o) =>
        [o.bucket, o.static, o.name, o.file, o.line, o.verdict, o.via, o.where].join("\t"),
      ),
    )
    .join("\n") + "\n",
);
console.log(`\nwrote ${OUT}/w1-triage.tsv`);
