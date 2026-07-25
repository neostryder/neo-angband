import { readFileSync } from "node:fs";
import { gamedataSpecs } from "../../../packages/content/dist/specs/index.js";

const parseFns = new Map();
for (const f of [
  "init.c",
  "obj-init.c",
  "mon-init.c",
  "generate.c",
  "player-timed.c",
  "store.c",
  "obj-chest.c",
  "mon-summon.c",
  "player-quest.c",
  "ui-entry.c",
  "ui-entry-renderers.c",
  "ui-knowledge.c",
  "ui-visuals.c",
]) {
  const text = readFileSync(`reference/src/${f}`, "utf8");
  const fnRe =
    /(?:struct\s+parser\s*\*|static\s+struct\s+parser\s*\*)\s*(\w+)\s*\([^)]*\)\s*\{/g;
  let m;
  const funcs = [];
  while ((m = fnRe.exec(text))) funcs.push({ name: m[1], index: m.index });
  for (let i = 0; i < funcs.length; i++) {
    const start = funcs[i].index;
    const end = i + 1 < funcs.length ? funcs[i + 1].index : Math.min(text.length, start + 30000);
    const body = text.slice(start, end);
    const regs = [];
    const re = /parser_reg\s*\(\s*\w+\s*,\s*((?:"[^"]*"\s*)+)\s*,/g;
    let rm;
    while ((rm = re.exec(body))) {
      const parts = [...rm[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]);
      regs.push(parts.join(""));
    }
    if (regs.length) parseFns.set(funcs[i].name, { file: f, regs });
  }
}

let imperfect = 0;
for (const spec of gamedataSpecs) {
  const tsFmts = new Set(spec.directives.map((d) => d.fmt));
  let best = null;
  for (const [fn, info] of parseFns) {
    const cFmts = new Set(info.regs);
    let ov = 0;
    for (const f of tsFmts) if (cFmts.has(f)) ov++;
    // For ui_entry, C registers label%d via format() loop - inject expected
    const score = ov / Math.max(tsFmts.size, cFmts.size, 1);
    if (!best || score > best.score) best = { fn, info, ov, score, cFmts };
  }
  // Special-case ui_entry: add synthetic label1-10
  if (spec.name === "ui_entry" || spec.name === "ui_entry_base") {
    const c = new Set(best.cFmts);
    for (let i = 1; i <= 10; i++) c.add(`label${i} str label${i}`);
    let ov = 0;
    for (const f of tsFmts) if (c.has(f)) ov++;
    const score = ov / Math.max(tsFmts.size, c.size, 1);
    best = { ...best, ov, score, cFmts: c, note: "injected label1-10" };
  }
  const onlyTs = [...tsFmts].filter((f) => !best.cFmts.has(f));
  const onlyC = [...best.cFmts].filter((f) => !tsFmts.has(f));
  if (onlyTs.length || onlyC.length || best.score < 1) {
    imperfect++;
    console.log(spec.name, "match", best.fn, "score", best.score.toFixed(2), best.note || "");
    if (onlyTs.length) console.log("  ONLY_TS", onlyTs);
    if (onlyC.length) console.log("  ONLY_C", onlyC);
  } else {
    console.log("OK", spec.name, "->", best.fn, `(${best.ov} fmts)`);
  }
}
console.log("imperfect:", imperfect);

// MAX_SHORTENED
const uh = readFileSync("reference/src/ui-entry.h", "utf8");
console.log(
  "MAX_SHORTENED",
  uh.match(/MAX_SHORTENED[^\n]*/)?.[0],
);

// Compare object_property bindui: C has optional uival?
const oi = readFileSync("reference/src/obj-init.c", "utf8");
const m = oi.match(/parser_reg\(p, "bindui[^"]+"/);
console.log("object_property bindui C:", m?.[0]);
const m2 = oi.match(/parser_reg\(p, ((?:"[^"]*"\s*)+),\s*parse_object_property_bindui/);
if (m2) {
  const parts = [...m2[1].matchAll(/"([^"]*)"/g)].map((x) => x[1]);
  console.log("joined:", parts.join(""));
}

// player_property multi desc?
const pp = readFileSync("reference/lib/gamedata/player_property.txt", "utf8");
let rec = null,
  dc = 0,
  multiDesc = 0;
for (const line of pp.split("\n")) {
  const x = line.trimStart();
  if (x.startsWith("type:")) {
    if (dc > 1) multiDesc++;
    rec = x;
    dc = 0;
  } else if (x.startsWith("desc:")) dc++;
}
if (dc > 1) multiDesc++;
console.log("player_property multi-desc records", multiDesc);

// object_property multi desc
const op = readFileSync("reference/lib/gamedata/object_property.txt", "utf8");
rec = null;
dc = 0;
multiDesc = 0;
for (const line of op.split("\n")) {
  const x = line.trimStart();
  if (x.startsWith("name:")) {
    if (dc > 1) multiDesc++;
    dc = 0;
  } else if (x.startsWith("desc:")) dc++;
}
if (dc > 1) multiDesc++;
console.log("object_property multi-desc records", multiDesc);

// Check for any stock multi bindui
function multiDir(file, startDir, dir) {
  const t = readFileSync(`reference/lib/gamedata/${file}.txt`, "utf8");
  let c = 0,
    multi = 0;
  for (const line of t.split("\n")) {
    const x = line.trimStart();
    if (x.startsWith(startDir + ":")) {
      if (c > 1) multi++;
      c = 0;
    } else if (x.startsWith(dir + ":")) c++;
  }
  if (c > 1) multi++;
  return multi;
}
console.log("multi bindui object_property", multiDir("object_property", "name", "bindui"));
console.log("multi bindui player_property", multiDir("player_property", "type", "bindui"));

// Comments claiming multi bindui
const opHead = op.slice(0, 800);
console.log("--- object_property header comments ---");
console.log(opHead);

// Check store: name is null because recordStart is store not name
const store = JSON.parse(readFileSync("packages/content/pack/store.json", "utf8"));
console.log("store keys", Object.keys(store.records[0]));
console.log("store[0].store", store.records[0].store);

// history structure vs source
const hist = JSON.parse(readFileSync("packages/content/pack/history.json", "utf8"));
console.log("history[0]", JSON.stringify(hist.records[0]));
const ht = readFileSync("reference/lib/gamedata/history.txt", "utf8").split("\n").filter((l) => l.startsWith("chart:") || l.startsWith("phrase:")).slice(0, 4);
console.log("history source", ht);

// Compare body slots count to C
const body = JSON.parse(readFileSync("packages/content/pack/body.json", "utf8"));
console.log("body slots", body.records[0].slot.length);

// Verify monster count 624, object 375 against C expectations (z-info or similar)
// Check if pack.manifest matches all loaded C files except deferred
const cLoads = [
  "activation","artifact","blow_effects","blow_methods","body","brand","chest_trap","class",
  "constants","curse","dungeon_profile","ego_item","flavor","hints","history","monster",
  "monster_base","monster_spell","names","object","object_base","object_property","p_race",
  "pain","pit","player_property","player_timed","projection","quest","realm","room_template",
  "shape","slay","store","summon","terrain","trap","ui_entry","ui_entry_base","ui_entry_renderer",
  "ui_knowledge","vault","visuals","world"
];
const man = JSON.parse(readFileSync("packages/content/pack/manifest.json","utf8"));
const manFiles = new Set(man.files.map(f=>f.replace('.json','')));
for (const c of cLoads) {
  if (!manFiles.has(c)) console.log("MISSING FROM MANIFEST", c);
}
// C also loads lore and randart - not in lane
console.log("extra in manifest not in cLoads", [...manFiles].filter(f=>!cLoads.includes(f)));

// Field presence: for monster record with all directives, compare keys
const mon = JSON.parse(readFileSync("packages/content/pack/monster.json","utf8"));
const morg = mon.records.find(r=>r.name&&r.name.includes("Morgoth"));
console.log("Morgoth keys", Object.keys(morg));
console.log("Morgoth speed/hp/ac/exp/depth/rarity/sleep", morg.speed, morg.hit, morg.ac, morg.exp, morg.depth, morg.rarity, morg.sleep);
// Parse from source
const mt = readFileSync("reference/lib/gamedata/monster.txt","utf8");
const mi = mt.indexOf("name:Morgoth");
const chunk = mt.slice(mi, mi+800);
console.log(chunk);
