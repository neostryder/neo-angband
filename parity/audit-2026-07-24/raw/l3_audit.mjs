/**
 * L3_data audit: compare C parser_reg formats to TS specs,
 * recompile gamedata, deep-equal pack JSON, field membership checks.
 */
import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const contentSrc = path.join(repo, "packages", "content", "src");
const packDir = path.join(repo, "packages", "content", "pack");
const gamedataDir = path.join(repo, "reference", "lib", "gamedata");
const srcDir = path.join(repo, "reference", "src");

// Dynamic import of compiled specs if available, else load from dist
async function loadSpecs() {
  const distIndex = path.join(repo, "packages", "content", "dist", "specs", "index.js");
  if (existsSync(distIndex)) {
    const mod = await import("file:///" + distIndex.replace(/\\/g, "/"));
    return mod.gamedataSpecs;
  }
  throw new Error("Need packages/content/dist built");
}

function extractParseFiles() {
  const out = [];
  for (const f of readdirSync(srcDir).filter((x) => x.endsWith(".c"))) {
    const text = readFileSync(path.join(srcDir, f), "utf8");
    const re = /parse_file(?:_quit_not_found)?\s*\([^,]+,\s*"([^"]+)"/g;
    let m;
    while ((m = re.exec(text))) {
      out.push({
        file: f,
        name: m[1],
        line: text.slice(0, m.index).split("\n").length,
      });
    }
  }
  return out;
}

function extractParserRegs(cFile) {
  const text = readFileSync(path.join(srcDir, cFile), "utf8");
  const regs = [];
  // Match parser_reg(p, "fmt", ...)
  const re = /parser_reg\s*\(\s*\w+\s*,\s*"([^"]+)"/g;
  let m;
  while ((m = re.exec(text))) {
    regs.push({
      fmt: m[1],
      line: text.slice(0, m.index).split("\n").length,
    });
  }
  return regs;
}

/** Find init_parse_* function bodies and their parser_reg lists by scanning for function names */
function extractInitParseFunctions() {
  const map = new Map(); // name -> {file, startLine, regs: []}
  for (const f of readdirSync(srcDir).filter((x) => x.endsWith(".c"))) {
    const text = readFileSync(path.join(srcDir, f), "utf8");
    // Find function definitions like struct parser *init_parse_xxx(void) or static struct parser *xxx_parser
    const fnRe =
      /(?:struct\s+parser\s*\*|static\s+struct\s+parser\s*\*)\s*(\w+)\s*\([^)]*\)\s*\{/g;
    let m;
    const funcs = [];
    while ((m = fnRe.exec(text))) {
      funcs.push({ name: m[1], index: m.index, line: text.slice(0, m.index).split("\n").length });
    }
    for (let i = 0; i < funcs.length; i++) {
      const start = funcs[i].index;
      const end = i + 1 < funcs.length ? funcs[i + 1].index : text.length;
      // Cap body at next function-looking boundary or 20000 chars
      const body = text.slice(start, Math.min(end, start + 30000));
      const regs = [];
      const re = /parser_reg\s*\(\s*\w+\s*,\s*"([^"]+)"/g;
      let rm;
      while ((rm = re.exec(body))) {
        regs.push({
          fmt: rm[1],
          line: text.slice(0, start + rm.index).split("\n").length,
        });
      }
      if (regs.length > 0) {
        map.set(funcs[i].name, { file: f, startLine: funcs[i].line, regs });
      }
    }
  }
  return map;
}

function deepEqual(a, b, path = "") {
  if (a === b) return null;
  if (typeof a !== typeof b) return `${path}: type ${typeof a} vs ${typeof b}`;
  if (a === null || b === null) return `${path}: ${a} vs ${b}`;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return `${path}: length ${a.length} vs ${b.length}`;
    for (let i = 0; i < a.length; i++) {
      const d = deepEqual(a[i], b[i], `${path}[${i}]`);
      if (d) return d;
    }
    return null;
  }
  if (typeof a === "object") {
    const ak = Object.keys(a).sort();
    const bk = Object.keys(b).sort();
    if (ak.length !== bk.length || ak.some((k, i) => k !== bk[i])) {
      const onlyA = ak.filter((k) => !bk.includes(k));
      const onlyB = bk.filter((k) => !ak.includes(k));
      return `${path}: keys onlyA=${onlyA.join(",")} onlyB=${onlyB.join(",")}`;
    }
    for (const k of ak) {
      const d = deepEqual(a[k], b[k], `${path}.${k}`);
      if (d) return d;
    }
    return null;
  }
  return `${path}: ${JSON.stringify(a)} vs ${JSON.stringify(b)}`;
}

async function main() {
  const report = [];
  const parseFiles = extractParseFiles();
  report.push("=== C parse_file targets ===");
  const byName = new Map();
  for (const p of parseFiles) {
    if (!byName.has(p.name)) byName.set(p.name, []);
    byName.get(p.name).push(`${p.file}:${p.line}`);
  }
  for (const [name, locs] of [...byName.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    report.push(`  ${name}: ${locs.join(", ")}`);
  }

  // Lane reference files
  const laneFiles = [
    "activation",
    "artifact",
    "blow_effects",
    "blow_methods",
    "body",
    "brand",
    "chest_trap",
    "class",
    "constants",
    "curse",
    "dungeon_profile",
    "ego_item",
    "flavor",
    "hints",
    "history",
    "monster",
    "monster_base",
    "monster_spell",
    "names",
    "object",
    "object_base",
    "object_property",
    "old_class",
    "p_race",
    "pain",
    "pit",
    "player_property",
    "player_timed",
    "projection",
    "quest",
    "realm",
    "room_template",
    "shape",
    "slay",
    "store",
    "summon",
    "terrain",
    "trap",
    "ui_entry",
    "ui_entry_base",
    "ui_entry_renderer",
    "ui_knowledge",
    "vault",
    "visuals",
    "world",
  ];

  report.push("\n=== Lane file vs C load ===");
  for (const name of laneFiles) {
    const loaded = byName.has(name);
    const packExists = existsSync(path.join(packDir, `${name}.json`));
    const txtExists = existsSync(path.join(gamedataDir, `${name}.txt`));
    report.push(
      `  ${name}: txt=${txtExists} pack=${packExists} c_load=${loaded ? byName.get(name).join("|") : "NO"}`,
    );
  }

  // Load TS specs and compare fmt strings
  const { compileGamedata } = await import(
    "file:///" + path.join(repo, "packages", "content", "dist", "records.js").replace(/\\/g, "/")
  );
  const specs = await loadSpecs();
  const specByName = new Map(specs.map((s) => [s.name, s]));

  // Extract C parser functions
  const parseFns = extractInitParseFunctions();
  report.push("\n=== C parser functions with regs ===");
  for (const [name, info] of [...parseFns.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    report.push(`  ${name} (${info.file}:${info.startLine}) regs=${info.regs.length}`);
  }

  // Heuristic mapping: for each TS spec, collect its fmts and find best matching C function
  report.push("\n=== Spec fmt vs C parser_reg match ===");
  const findings = [];

  for (const name of laneFiles) {
    const spec = specByName.get(name);
    if (!spec) {
      report.push(`  ${name}: NO SPEC`);
      if (name !== "old_class") {
        findings.push({ id: name, kind: "no_spec" });
      }
      continue;
    }
    const tsFmts = new Set(spec.directives.map((d) => d.fmt));
    // Find C function with highest overlap
    let best = null;
    for (const [fn, info] of parseFns) {
      const cFmts = new Set(info.regs.map((r) => r.fmt));
      let overlap = 0;
      for (const f of tsFmts) if (cFmts.has(f)) overlap++;
      const score = overlap / Math.max(tsFmts.size, cFmts.size, 1);
      if (!best || score > best.score || (score === best.score && overlap > best.overlap)) {
        best = { fn, info, overlap, score, cFmts };
      }
    }
    if (!best || best.overlap === 0) {
      report.push(`  ${name}: NO C MATCH for ${tsFmts.size} fmts`);
      findings.push({ id: name, kind: "no_c_match" });
      continue;
    }
    const onlyTs = [...tsFmts].filter((f) => !best.cFmts.has(f));
    const onlyC = [...best.cFmts].filter((f) => !tsFmts.has(f));
    report.push(
      `  ${name}: match ${best.fn} (${best.info.file}) overlap=${best.overlap}/${tsFmts.size} score=${best.score.toFixed(2)}`,
    );
    if (onlyTs.length) {
      report.push(`    ONLY_TS: ${onlyTs.join(" || ")}`);
      findings.push({ id: name, kind: "only_ts", items: onlyTs, cfn: best.fn });
    }
    if (onlyC.length) {
      report.push(`    ONLY_C: ${onlyC.join(" || ")}`);
      findings.push({ id: name, kind: "only_c", items: onlyC, cfn: best.fn });
    }

    // Check repeat flags: directives that appear multiple times per record in data
    // vs childOf structure - later
  }

  // Recompile all and deep-equal pack
  report.push("\n=== Recompile vs pack deep-equal ===");
  let recompileDiffs = 0;
  for (const spec of specs) {
    const text = readFileSync(path.join(gamedataDir, `${spec.name}.txt`), "utf8");
    let compiled;
    try {
      compiled = compileGamedata(text, spec);
    } catch (e) {
      report.push(`  ${spec.name}: COMPILE ERROR ${e.message}`);
      findings.push({ id: spec.name, kind: "compile_error", msg: e.message });
      recompileDiffs++;
      continue;
    }
    const packPath = path.join(packDir, `${spec.name}.json`);
    const pack = JSON.parse(readFileSync(packPath, "utf8"));
    const d = deepEqual(compiled, pack);
    if (d) {
      report.push(`  ${spec.name}: DIFF ${d}`);
      findings.push({ id: spec.name, kind: "pack_diff", msg: d });
      recompileDiffs++;
    } else {
      report.push(
        `  ${spec.name}: OK records=${compiled.records.length}${compiled.header ? " +header" : ""}`,
      );
    }
  }
  report.push(`Recompile diffs: ${recompileDiffs}`);

  // Check for directives in source that aren't in spec (would fail compile - already covered)
  // Check multi-occurrence of non-repeat directives in data
  report.push("\n=== Multi-occurrence non-repeat directives in data ===");
  for (const spec of specs) {
    const text = readFileSync(path.join(gamedataDir, `${spec.name}.txt`), "utf8");
    const table = new Map();
    for (const d of spec.directives) {
      const dir = d.fmt.split(" ")[0];
      table.set(dir, d);
    }
    let current = null;
    const counts = new Map(); // key = recordIndex:directive
    let recIdx = -1;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      let raw = lines[i];
      if (raw.endsWith("\r")) raw = raw.slice(0, -1);
      const t = raw.trimStart();
      if (!t || t.startsWith("#")) continue;
      const colon = t.indexOf(":");
      if (colon < 0) continue;
      const dir = t.slice(0, colon);
      if (spec.recordStart !== null && dir === spec.recordStart) {
        recIdx++;
        continue;
      }
      if (recIdx < 0 && spec.recordStart !== null) {
        // header
        continue;
      }
      const def = table.get(dir);
      if (!def) continue;
      if (def.repeat || def.childOf) continue; // childOf may also be single-per-parent
      // For non-repeat, non-childOf: count per record
      if (def.childOf) continue;
      const key = `${recIdx}:${dir}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    const multis = [...counts.entries()].filter(([, c]) => c > 1);
    if (multis.length) {
      // Group by directive
      const byDir = new Map();
      for (const [k, c] of multis) {
        const dir = k.split(":")[1];
        if (!byDir.has(dir)) byDir.set(dir, []);
        byDir.get(dir).push({ rec: k.split(":")[0], c });
      }
      for (const [dir, arr] of byDir) {
        const def = table.get(dir);
        if (def?.repeat) continue;
        report.push(
          `  ${spec.name}: non-repeat "${dir}" appears multi times on ${arr.length} records (e.g. rec ${arr[0].rec} x${arr[0].c})`,
        );
        findings.push({
          id: spec.name,
          kind: "multi_nonrepeat",
          dir,
          count: arr.length,
        });
      }
    }
  }

  // Compare C multi-accepted handlers: look for append-style vs single-assign
  // Spot-check: object_property bindui
  // Spot-check key record counts vs C expectations

  // Field value sampling: parse all values from txt via compile and check identity keys
  report.push("\n=== Record identity spot checks ===");
  const spotChecks = {
    monster: { key: "name", expectCount: null },
    object: { key: "name", expectCount: null },
    artifact: { key: "name", expectCount: null },
    activation: { key: "name", expectCount: null },
    ego_item: { key: "name", expectCount: null },
    class: { key: "name", expectCount: null },
    p_race: { key: "name", expectCount: null },
    world: { key: "name", expectCount: null },
    brand: { key: "code", expectCount: null },
    slay: { key: "code", expectCount: null },
    quest: { key: "name", expectCount: null },
    realm: { key: "name", expectCount: null },
  };

  for (const [name, chk] of Object.entries(spotChecks)) {
    const pack = JSON.parse(readFileSync(path.join(packDir, `${name}.json`), "utf8"));
    const keys = pack.records.map((r) => r[chk.key] ?? r.name ?? r.code ?? JSON.stringify(r).slice(0, 40));
    const dups = keys.filter((k, i) => keys.indexOf(k) !== i);
    report.push(
      `  ${name}: ${pack.records.length} records, first=${keys[0]}, last=${keys[keys.length - 1]}, dups=${dups.length}`,
    );
  }

  // Check bindui / other known multi-line issues against C comments and data
  report.push("\n=== Directives marked multi in data comments vs repeat flag ===");
  // For each gamedata file, find directives that appear more than once within a record in the SOURCE
  // (including those that would be childOf parents with repeat)
  for (const spec of specs) {
    const text = readFileSync(path.join(gamedataDir, `${spec.name}.txt`), "utf8");
    let recIdx = -1;
    const perRec = new Map(); // recIdx -> Map(dir -> count)
    for (const line of text.split("\n")) {
      let raw = line.endsWith("\r") ? line.slice(0, -1) : line;
      const t = raw.trimStart();
      if (!t || t.startsWith("#")) continue;
      const colon = t.indexOf(":");
      if (colon < 0) continue;
      const dir = t.slice(0, colon);
      if (spec.recordStart !== null && dir === spec.recordStart) {
        recIdx++;
        perRec.set(recIdx, new Map());
        // record start itself
        continue;
      }
      if (recIdx < 0) continue;
      const m = perRec.get(recIdx);
      m.set(dir, (m.get(dir) || 0) + 1);
    }
    const multiDirs = new Map(); // dir -> maxCount
    for (const [, m] of perRec) {
      for (const [dir, c] of m) {
        if (c > 1) multiDirs.set(dir, Math.max(multiDirs.get(dir) || 0, c));
      }
    }
    for (const [dir, maxC] of multiDirs) {
      const def = spec.directives.find((d) => d.fmt.split(" ")[0] === dir);
      if (!def) {
        report.push(`  ${spec.name}: multi dir "${dir}" (max ${maxC}) NOT IN SPEC`);
        findings.push({ id: spec.name, kind: "multi_not_in_spec", dir, maxC });
        continue;
      }
      const isArrayCapable = def.repeat || def.childOf; // childOf may still be single
      if (!def.repeat && !def.childOf) {
        // multi occurrence of non-repeat will fail compile - if pack exists, data must have at most 1
        // (compile would have failed otherwise)
        report.push(
          `  ${spec.name}: multi dir "${dir}" max=${maxC} but repeat=${!!def.repeat} childOf=${!!def.childOf} (pack exists so maybe only one record has multi - check)`,
        );
      } else if (!def.repeat && def.childOf) {
        // attach to parent - last wins if multiple without repeat
        if (maxC > 1) {
          report.push(
            `  ${spec.name}: multi childOf dir "${dir}" max=${maxC} without repeat (last-wins per parent?)`,
          );
        }
      }
    }
  }

  // C-side: directives that use append/list vs single field
  // Compare desc handling: many C parsers append desc lines; TS needs repeat:true
  report.push("\n=== Findings summary ===");
  report.push(JSON.stringify(findings, null, 2));
  report.push(`Total findings objects: ${findings.length}`);

  const outPath = path.join(repo, "parity", "audit-2026-07-24", "raw", "l3_audit_report.txt");
  writeFileSync(outPath, report.join("\n") + "\n");
  console.log(report.join("\n"));
  console.log("\nWrote", outPath);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
