/**
 * Deep field membership + structure audit for L3_data.
 * Walks every source directive line, parses via the port, finds the value in pack.
 * Also compares C handlers for append vs overwrite vs TS repeat flags.
 */
import { readFileSync, writeFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const packDir = path.join(repo, "packages", "content", "pack");
const gamedataDir = path.join(repo, "reference", "lib", "gamedata");
const srcDir = path.join(repo, "reference", "src");

const { compileGamedata, /* */ } = await import(
  "file:///" + path.join(repo, "packages", "content", "dist", "records.js").replace(/\\/g, "/")
);
const { parseLine } = await import(
  "file:///" + path.join(repo, "packages", "content", "dist", "parser.js").replace(/\\/g, "/")
);
const { gamedataSpecs } = await import(
  "file:///" + path.join(repo, "packages", "content", "dist", "specs", "index.js").replace(/\\/g, "/")
);
const { parseSignature } = await import(
  "file:///" + path.join(repo, "packages", "content", "dist", "parser.js").replace(/\\/g, "/")
);

function containsValue(node, needle) {
  if (needle === true) return true;
  if (node === needle) return true;
  if (typeof node === "number" && typeof needle === "number" && node === needle) return true;
  if (typeof node === "string" && typeof needle === "string" && node === needle) return true;
  if (Array.isArray(node)) {
    for (const x of node) if (containsValue(x, needle)) return true;
    return false;
  }
  if (node && typeof node === "object") {
    for (const v of Object.values(node)) if (containsValue(v, needle)) return true;
  }
  return false;
}

function findInRecord(rec, directive, values) {
  // Record may have directive as key
  if (!(directive in rec) && Object.keys(values).length === 0) return true;
  if (!(directive in rec)) {
    // single-field recordStart might put fields at top level
    for (const [k, v] of Object.entries(values)) {
      if (rec[k] !== v && !containsValue(rec, v)) return false;
    }
    return true;
  }
  const slot = rec[directive];
  // Multi-field: object or array of objects
  if (Object.keys(values).length === 0) {
    return slot === true || slot !== undefined;
  }
  if (Object.keys(values).length === 1) {
    const only = Object.values(values)[0];
    if (slot === only) return true;
    if (Array.isArray(slot) && slot.includes(only)) return true;
    if (containsValue(slot, only)) return true;
    // top-level field
    const k = Object.keys(values)[0];
    if (rec[k] === only) return true;
    return false;
  }
  // multi-field object match
  function objMatch(o) {
    if (!o || typeof o !== "object" || Array.isArray(o)) return false;
    for (const [k, v] of Object.entries(values)) {
      if (o[k] !== v) return false;
    }
    return true;
  }
  if (objMatch(slot)) return true;
  if (Array.isArray(slot) && slot.some(objMatch)) return true;
  if (containsValue(slot, values)) return true;
  // nested
  return containsValue(rec, Object.values(values)[0]);
}

const report = [];
const issues = [];

let totalValues = 0;
let missingValues = 0;
let parseFails = 0;

for (const spec of gamedataSpecs) {
  const text = readFileSync(path.join(gamedataDir, `${spec.name}.txt`), "utf8");
  const pack = JSON.parse(readFileSync(path.join(packDir, `${spec.name}.json`), "utf8"));
  const compiled = compileGamedata(text, spec);

  // Build lookup table
  const table = new Map();
  for (const d of spec.directives) {
    const sig = parseSignature(d.fmt);
    table.set(sig.directive, { def: d, sig });
  }
  const lookup = (dir) => table.get(dir)?.sig;

  let recIdx = -1;
  const lines = text.split("\n");
  let fileMissing = 0;
  let fileTotal = 0;
  let fileParseFail = 0;

  for (let i = 0; i < lines.length; i++) {
    let raw = lines[i] ?? "";
    if (raw.endsWith("\r")) raw = raw.slice(0, -1);
    if (i === 0 && raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    let parsed;
    try {
      parsed = parseLine(raw, lookup);
    } catch (e) {
      fileParseFail++;
      parseFails++;
      issues.push({
        file: spec.name,
        line: i + 1,
        kind: "parse_fail",
        msg: e.message,
        raw: raw.slice(0, 120),
      });
      continue;
    }
    if (parsed === null) continue;

    if (spec.recordStart !== null && parsed.directive === spec.recordStart) {
      recIdx++;
    }

    // membership of each field value
    for (const [k, v] of Object.entries(parsed.values)) {
      fileTotal++;
      totalValues++;
      // Search whole pack for value (strict for numbers/strings)
      let found = false;
      // Prefer current record
      if (spec.recordStart === null) {
        found = containsValue(pack.records[0], v) || containsValue(pack.header, v);
      } else if (recIdx >= 0 && pack.records[recIdx]) {
        found = containsValue(pack.records[recIdx], v);
        // also header for object_base defaults etc
        if (!found && pack.header) found = containsValue(pack.header, v);
      } else if (pack.header) {
        found = containsValue(pack.header, v);
      }
      if (!found) {
        // fallback whole pack
        found = containsValue(pack, v);
      }
      if (!found) {
        fileMissing++;
        missingValues++;
        if (fileMissing <= 5) {
          issues.push({
            file: spec.name,
            line: i + 1,
            kind: "missing_value",
            dir: parsed.directive,
            field: k,
            value: v,
            recIdx,
          });
        }
      }
    }
  }

  // Structure: record counts match
  if (compiled.records.length !== pack.records.length) {
    issues.push({
      file: spec.name,
      kind: "count_mismatch",
      compiled: compiled.records.length,
      pack: pack.records.length,
    });
  }

  // Deep equal already done; also check key presence order on sample records
  // Desc/flags arrays: when C appends with space vs newline - packaging keeps arrays which is fine

  report.push(
    `${spec.name}: values=${fileTotal} missing=${fileMissing} parseFail=${fileParseFail} records=${pack.records.length}`,
  );
}

// C append analysis: scan parse handlers for string_append / my_strcat / list push patterns
// vs single assignment for desc-like fields
report.push("\n=== C handler multi-line semantics (desc/flags/D) sample ===");

// Compare specific known tricky structures
function sampleCheck(name, pickFn) {
  const pack = JSON.parse(readFileSync(path.join(packDir, `${name}.json`), "utf8"));
  const text = readFileSync(path.join(gamedataDir, `${name}.txt`), "utf8");
  const info = pickFn(pack, text);
  report.push(`SAMPLE ${name}: ${JSON.stringify(info).slice(0, 500)}`);
  return info;
}

// Morgoth
sampleCheck("monster", (pack) => {
  const m = pack.records.find((r) => typeof r.name === "string" && r.name.includes("Morgoth"));
  return {
    name: m?.name,
    hit: m?.hit,
    speed: m?.speed,
    blows: m?.blow?.length,
    flags: Array.isArray(m?.flags) ? m.flags.length : typeof m?.flags,
    spells: m?.spell_freq ?? m["spell-freq"],
    depth: m?.depth,
    ac: m?.ac,
    exp: m?.exp,
  };
});

// Mage Magic Missile
sampleCheck("class", (pack) => {
  const mage = pack.records.find((r) => r.name === "Mage");
  const books = mage?.book;
  let mm = null;
  if (Array.isArray(books)) {
    for (const b of books) {
      if (Array.isArray(b.spell)) {
        for (const s of b.spell) {
          if (s.name === "Magic Missile" || s === "Magic Missile") {
            mm = s;
          }
          if (s && s.name && s.name.includes("Magic Missile")) mm = s;
        }
      }
    }
  }
  return {
    mageBooks: Array.isArray(books) ? books.length : books,
    mm: mm
      ? {
          name: mm.name,
          level: mm.level ?? mm["level"],
          mana: mm.mana,
          fail: mm.fail,
          effect: mm.effect,
          dice: mm.dice,
        }
      : null,
  };
});

// constants world labels
sampleCheck("constants", (pack) => {
  const r = pack.records[0];
  return {
    world: r.world,
    "level-max": r["level-max"]?.slice?.(0, 3) ?? r["level-max"],
    meleeCritLevels: r["melee-critical-level"],
  };
});

// vault D-row count vs rows
sampleCheck("vault", (pack) => {
  let mismatches = 0;
  let checked = 0;
  const examples = [];
  for (const v of pack.records) {
    const rows = v.rows;
    const D = v.D;
    if (rows === undefined || !Array.isArray(D)) continue;
    checked++;
    if (D.length !== rows) {
      mismatches++;
      if (examples.length < 5) examples.push({ name: v.name, rows, Dlen: D.length });
    }
  }
  return { checked, mismatches, examples };
});

// room_template same
sampleCheck("room_template", (pack) => {
  let mismatches = 0;
  let checked = 0;
  const examples = [];
  for (const v of pack.records) {
    const rows = v.rows;
    const D = v.D;
    if (rows === undefined || !Array.isArray(D)) continue;
    checked++;
    if (D.length !== rows) {
      mismatches++;
      if (examples.length < 8) examples.push({ name: v.name, rows, Dlen: D.length });
    }
  }
  return { checked, mismatches, examples };
});

// object_property bindui
sampleCheck("object_property", (pack, text) => {
  const multiBind = [];
  let rec = null;
  let count = 0;
  for (const line of text.split("\n")) {
    const t = line.trimStart();
    if (t.startsWith("name:")) {
      if (count > 1) multiBind.push({ rec, count });
      rec = t.slice(5);
      count = 0;
    } else if (t.startsWith("bindui:")) {
      count++;
    }
  }
  if (count > 1) multiBind.push({ rec, count });
  const withBind = pack.records.filter((r) => r.bindui).length;
  return { withBind, multiBindInSource: multiBind };
});

// player_property bindui multi?
sampleCheck("player_property", (pack, text) => {
  let rec = null;
  let count = 0;
  const multi = [];
  for (const line of text.split("\n")) {
    const t = line.trimStart();
    if (t.startsWith("type:")) {
      if (count > 1) multi.push({ rec, count });
      rec = t.slice(5);
      count = 0;
    } else if (t.startsWith("bindui:")) count++;
  }
  return { multi, total: pack.records.length };
});

// quest, realm, brand values
sampleCheck("quest", (pack) => ({
  records: pack.records,
}));
sampleCheck("realm", (pack) => ({
  names: pack.records.map((r) => r.name),
  first: pack.records[0],
}));
sampleCheck("brand", (pack) => ({
  codes: pack.records.map((r) => r.code),
  first: pack.records[0],
}));
sampleCheck("slay", (pack) => ({
  codes: pack.records.map((r) => r.code),
  first: pack.records[0],
}));
sampleCheck("world", (pack) => {
  // world records might nest under level key
  const depths = pack.records.map((r) => (r.level ? r.level.depth : r.depth));
  return {
    count: pack.records.length,
    first: pack.records[0],
    last: pack.records[pack.records.length - 1],
    depth0: depths[0],
    depthLast: depths[depths.length - 1],
  };
});

// activation first + nested effect
sampleCheck("activation", (pack) => {
  const a = pack.records[0];
  const nested = pack.records.find(
    (r) => Array.isArray(r.effect) && r.effect.some((e) => e && typeof e === "object" && e.dice),
  );
  return { first: a, nestedSample: nested ? { name: nested.name, effect: nested.effect } : null };
});

// Compare C vs TS: object_property bindui handler
const objInit = readFileSync(path.join(srcDir, "obj-init.c"), "utf8");
const binduiIdx = objInit.indexOf("parse_object_property_bindui");
report.push("\n=== bindui C handler snippet ===");
report.push(objInit.slice(binduiIdx, binduiIdx + 400));

// player_property bindui
const initC = readFileSync(path.join(srcDir, "init.c"), "utf8");
const ppBind = initC.indexOf("parse_player_prop_bindui");
if (ppBind < 0) {
  // try other names
  const idx = initC.indexOf("bindui");
  report.push("player prop bindui search around first hit:");
  report.push(initC.slice(Math.max(0, idx - 100), idx + 400));
} else {
  report.push(initC.slice(ppBind, ppBind + 400));
}

// Check category multi for ui_entry
sampleCheck("ui_entry", (pack, text) => {
  let multiCat = 0;
  let rec = null;
  let c = 0;
  for (const line of text.split("\n")) {
    const t = line.trimStart();
    if (t.startsWith("name:")) {
      if (c > 1) multiCat++;
      c = 0;
    } else if (t.startsWith("category:")) c++;
  }
  if (c > 1) multiCat++;
  const arrCats = pack.records.filter((r) => Array.isArray(r.category)).length;
  return { multiCatRecordsInSource: multiCat, packArrayCategories: arrCats };
});

// Check if flags on object are array and preserve all tokens
sampleCheck("object", (pack) => {
  const withFlags = pack.records.filter((r) => r.flags);
  const multi = withFlags.filter((r) => Array.isArray(r.flags));
  // Find one with multiple flag lines
  const sample = multi.find((r) => Array.isArray(r.flags) && r.flags.length > 1);
  return {
    withFlags: withFlags.length,
    multiFlagLines: multi.length,
    sample: sample ? { name: sample.name, flags: sample.flags } : null,
  };
});

// visuals structure
sampleCheck("visuals", (pack) => pack);

// names structure  
sampleCheck("names", (pack) => ({
  sections: pack.records.map((r) => ({
    section: r.section,
    words: Array.isArray(r.word) ? r.word.length : r.word,
  })),
}));

// history count
sampleCheck("history", (pack) => ({
  count: pack.records.length,
  first: pack.records[0],
  last: pack.records[pack.records.length - 1],
}));

// hints
sampleCheck("hints", (pack) => ({
  count: pack.records.length,
  first: pack.records[0],
  last: pack.records[pack.records.length - 1],
}));

// body
sampleCheck("body", (pack) => pack.records[0]);

// dungeon_profile
sampleCheck("dungeon_profile", (pack) => ({
  names: pack.records.map((r) => r.name),
  first: pack.records[0],
}));

// store
sampleCheck("store", (pack) => ({
  names: pack.records.map((r) => r.name),
  first: pack.records[0],
}));

// summon
sampleCheck("summon", (pack) => ({
  names: pack.records.map((r) => r.name),
  first: pack.records[0],
}));

// chest_trap
sampleCheck("chest_trap", (pack) => ({
  records: pack.records.map((r) => ({ name: r.name, code: r.code })),
}));

// Check old_class is not loaded by C
const allC = readdirSync(srcDir)
  .filter((f) => f.endsWith(".c"))
  .map((f) => readFileSync(path.join(srcDir, f), "utf8"))
  .join("\n");
report.push(`\nold_class mentions in C: ${(allC.match(/old_class/g) || []).length}`);
report.push(`parse_file old_class: ${allC.includes('"old_class"')}`);

// randart is loaded by C but not in lane - note only
report.push(`randart in C load: ${allC.includes('"randart"')}`);
report.push(`lore in C load: ${allC.includes('"lore"')}`);

// Cross-check: every field value from compiled present - already via deep equal of recompile

// Semantic packaging issues: when non-repeat childOf last-wins - verify against C
// dice on multi effects: each effect should have its own dice
sampleCheck("class", (pack) => {
  const mage = pack.records.find((r) => r.name === "Mage");
  // Walk effects with dice
  const books = mage?.book || [];
  let effectsWithDice = 0;
  let effects = 0;
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (node.effect) {
      const effs = Array.isArray(node.effect) ? node.effect : [node.effect];
      for (const e of effs) {
        if (e && typeof e === "object") {
          effects++;
          if (e.dice) effectsWithDice++;
        }
      }
    }
    for (const v of Object.values(node)) walk(v);
  };
  walk(mage);
  // Magic Missile detail
  let mmPath = null;
  for (const b of books) {
    if (!b.spell) continue;
    for (const s of b.spell) {
      if (s && s.name === "Magic Missile") {
        mmPath = s;
      }
    }
  }
  return { effects, effectsWithDice, magicMissile: mmPath };
});

// Compare Magic Missile source lines
const classTxt = readFileSync(path.join(gamedataDir, "class.txt"), "utf8");
const mmIdx = classTxt.indexOf("spell:Magic Missile");
report.push("\n=== Magic Missile source ===");
report.push(classTxt.slice(mmIdx, mmIdx + 350));

// Compare Morgoth source combat
const monTxt = readFileSync(path.join(gamedataDir, "monster.txt"), "utf8");
const morgIdx = monTxt.indexOf("name:Morgoth");
report.push("\n=== Morgoth source (partial) ===");
report.push(monTxt.slice(morgIdx, morgIdx + 600));

const morgPack = JSON.parse(readFileSync(path.join(packDir, "monster.json"), "utf8")).records.find(
  (r) => r.name && r.name.includes("Morgoth"),
);
report.push("\n=== Morgoth pack combat ===");
report.push(
  JSON.stringify(
    {
      name: morgPack.name,
      depth: morgPack.depth,
      rarity: morgPack.rarity,
      speed: morgPack.speed,
      hit: morgPack.hit ?? morgPack["hit-points"] ?? morgPack.hp,
      ac: morgPack.ac,
      sleep: morgPack.sleep,
      exp: morgPack.exp,
      blow: morgPack.blow,
      flags: morgPack.flags,
      "spell-freq": morgPack["spell-freq"],
      spell: morgPack.spell,
    },
    null,
    2,
  ).slice(0, 2000),
);

// Check for latent multi-bindui / multi-priority issues more carefully
// Scan all C parse handlers for directives that APPEND but TS has no repeat

// Heuristic: for each fmt in each C init_parse, look at handler name and see if body has
// string_append or append or mem_realloc list patterns

function analyzeAppendHandlers() {
  // Map known multi-line append directives from C by reading handlers that call
  // string_append or add to linked list
  const results = [];
  for (const f of ["init.c", "obj-init.c", "mon-init.c", "generate.c", "player-timed.c", "store.c", "obj-chest.c", "mon-summon.c", "player-quest.c", "ui-entry.c", "ui-entry-renderers.c", "ui-knowledge.c", "ui-visuals.c"]) {
    const text = readFileSync(path.join(srcDir, f), "utf8");
    // Find parser_reg with callback, then find if callback appends
    // parser_reg(p, "fmt...", parse_xxx);
    const re =
      /parser_reg\s*\(\s*\w+\s*,\s*"([^"]+(?:\"\s*\n\s*\"[^"]*)*)"\s*,\s*(\w+)\s*\)/g;
    let m;
    while ((m = re.exec(text))) {
      let fmt = m[1].replace(/"\s*\n\s*"/g, "");
      const handler = m[2];
      // Find handler function body
      const hre = new RegExp(
        `(?:static\\s+)?(?:enum\\s+)?(?:parser_error|errr|int)\\s+${handler}\\s*\\([^)]*\\)\\s*\\{`,
      );
      const hm = hre.exec(text);
      if (!hm) continue;
      const start = hm.index;
      // crude body end: next function at column 0 or static
      let end = start + 50;
      const rest = text.slice(start);
      // find matching brace
      let depth = 0;
      let started = false;
      for (let i = 0; i < rest.length && i < 5000; i++) {
        if (rest[i] === "{") {
          depth++;
          started = true;
        } else if (rest[i] === "}") {
          depth--;
          if (started && depth === 0) {
            end = start + i;
            break;
          }
        }
      }
      const body = text.slice(start, end + 1);
      const appends =
        /string_append|my_strcat|add_to_|next\s*=|mem_realloc|quark_add|append_|list_/.test(
          body,
        ) ||
        /\w+\s*=\s*string_make/.test(body) ||
        /textblock_/.test(body);
      // Also: tval_add, flags with of_union, etc.
      const flagUnion = /of_union|rf_union|tf_union|sf_union|pf_union|kf_union|cf_union|grab_flag|parser_get.*flags/.test(
        body,
      );
      const multi =
        appends ||
        flagUnion ||
        /while\s*\(/.test(body) ||
        body.includes("->next");
      // Single assign last-wins: parser_get and assign without append
      results.push({
        file: f,
        fmt: fmt.slice(0, 80),
        handler,
        multi: multi ? "maybe_multi" : "single",
        hasAppend: /string_append|my_strcat/.test(body),
        hasNext: body.includes("->next") || body.includes("mem_zalloc"),
      });
    }
  }
  return results;
}

const appendAnalysis = analyzeAppendHandlers();
// Cross with TS specs
const tsRepeat = new Map(); // "name:dir" -> repeat?
for (const spec of gamedataSpecs) {
  for (const d of spec.directives) {
    const dir = d.fmt.split(" ")[0];
    tsRepeat.set(`${spec.name}:${dir}`, {
      repeat: !!d.repeat,
      childOf: d.childOf,
      fmt: d.fmt,
    });
  }
}

// For each C multi with string_append, check TS has repeat
report.push("\n=== C string_append handlers vs TS repeat ===");
for (const a of appendAnalysis) {
  if (!a.hasAppend) continue;
  // Find which spec has this fmt
  let found = false;
  for (const spec of gamedataSpecs) {
    for (const d of spec.directives) {
      if (d.fmt === a.fmt || d.fmt.replace(/\s+/g, " ") === a.fmt.replace(/\s+/g, " ")) {
        found = true;
        if (!d.repeat) {
          report.push(
            `MISMATCH append without repeat: ${spec.name} "${a.fmt.slice(0, 50)}" handler=${a.handler}`,
          );
          issues.push({
            kind: "append_no_repeat",
            file: spec.name,
            fmt: a.fmt,
            handler: a.handler,
          });
        }
      }
    }
  }
  if (!found) {
    // try directive name only
  }
}

// More targeted: known multi-line string fields in gamedata
const multiStringDirs = [
  "desc",
  "text",
  "msg",
  "msg-good",
  "msg-bad",
  "msg-xtra",
  "act",
  "D",
  "word",
  "lore",
  "message",
  "message-vis",
  "message-invis",
  "message-miss",
  "message-save",
  "flags",
  "values",
  "slay",
  "brand",
  "curse",
];

report.push("\n=== Multi-line-ish directives: TS repeat flags ===");
for (const spec of gamedataSpecs) {
  for (const d of spec.directives) {
    const dir = d.fmt.split(" ")[0];
    if (multiStringDirs.includes(dir) || multiStringDirs.some((x) => dir.includes(x))) {
      report.push(
        `  ${spec.name}.${dir}: repeat=${!!d.repeat} childOf=${(d.childOf || []).join(",") || "-"} fmt=${d.fmt.slice(0, 60)}`,
      );
    }
  }
}

// Check object_property bindui specifically - C calls bind for each
const bindHandler = appendAnalysis.find((a) => a.handler.includes("bindui") || a.fmt.includes("bindui"));
report.push("\nbindui handlers: " + JSON.stringify(appendAnalysis.filter((a) => a.fmt.includes("bindui") || a.handler.includes("bindui"))));

// player property
const objPropSpec = gamedataSpecs.find((s) => s.name === "object_property");
const bindDef = objPropSpec.directives.find((d) => d.fmt.startsWith("bindui"));
report.push(`object_property.bindui: ${JSON.stringify(bindDef)}`);

// Check C parse_object_property_bindui
const pob = objInit.indexOf("parse_object_property_bindui");
// find function
const pobFn = objInit.lastIndexOf("static", pob);
report.push(objInit.slice(pob - 200, pob + 350));

// Field-level: compare a few numeric constants exactly
const constPack = JSON.parse(readFileSync(path.join(packDir, "constants.json"), "utf8"));
const constTxt = readFileSync(path.join(gamedataDir, "constants.txt"), "utf8");
// Extract world:max-depth etc
for (const label of ["max-depth", "day-length", "dungeon-hgt", "dungeon-wid", "pack-size", "food-value"]) {
  const m = constTxt.match(new RegExp(`(?:world|player|carry-cap):${label}:(\\d+)`));
  // search more broadly
  const re = new RegExp(`^[a-z-]+:${label}:(-?\\d+)`, "m");
  const m2 = constTxt.match(re);
  const packed = JSON.stringify(constPack);
  const has = packed.includes(`"label": "${label}"`) && packed.includes(m2 ? m2[1] : "???");
  report.push(`const ${label}: source=${m2?.[1]} in_pack_nearby=${has}`);
}

// World: depth 0 Town
const worldPack = JSON.parse(readFileSync(path.join(packDir, "world.json"), "utf8"));
const worldTxt = readFileSync(path.join(gamedataDir, "world.txt"), "utf8");
const w0 = worldTxt.match(/^level:(\d+):(\w+):(\S+):(\S+)/m);
report.push(`world first line: ${w0?.[0]}`);
report.push(`world pack[0]: ${JSON.stringify(worldPack.records[0])}`);

// Count issues
report.push(`\n=== TOTALS ===`);
report.push(`totalValues=${totalValues} missingValues=${missingValues} parseFails=${parseFails}`);
report.push(`issues=${issues.length}`);
report.push(JSON.stringify(issues.slice(0, 50), null, 2));

writeFileSync(
  path.join(repo, "parity", "audit-2026-07-24", "raw", "l3_field_report.txt"),
  report.join("\n") + "\n",
);
console.log(report.join("\n"));
