/**
 * W5 — Data exactness: independent re-parse of every reference gamedata
 * file, field-by-field / index-by-index against the committed pack the game
 * loads (packages/content/pack/*.json).
 *
 * The reader lives in data-exactness.reader.ts and does not call
 * packages/content's parseLine / compileGamedata, so a shared parser bug
 * cannot hide on both sides of the diff.
 *
 * Format registration (parser_reg format strings, repeat, childOf) is taken
 * from gamedataSpecs — those are the C registration tables, not the parser
 * engine. old_class.txt is present upstream but deliberately not compiled
 * (retired data); it is covered by an explicit exclusion below.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  independentCompile,
  splitFlagList,
  type CompiledFile,
  type FileSpec as ReaderFileSpec,
  type JsonObject,
  type JsonValue,
} from "./data-exactness.reader.js";
import { gamedataSpecs } from "./specs/index.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const contentRoot = path.resolve(here, "..");
const repoRoot = path.resolve(contentRoot, "..", "..");
const gamedataDir = path.join(repoRoot, "reference", "lib", "gamedata");
const packDir = path.join(contentRoot, "pack");

/**
 * Explicit allow-list of known, legitimate pack ≠ reference differences.
 * Each entry must name the reason. Prefer fixing the pack over adding entries.
 * Empty by default: every structural mismatch is a real finding.
 */
const ALLOW_LIST: readonly {
  readonly file: string;
  readonly record?: string;
  readonly path: string;
  readonly reason: string;
}[] = [
  // none yet
];

/** Files under reference/lib/gamedata that are intentionally not in the pack. */
const DEFERRED_SOURCES: readonly { readonly name: string; readonly reason: string }[] = [
  {
    name: "old_class",
    reason:
      "Retired class data kept upstream for reference only; packages/content specs defer it (see specs/index.ts).",
  },
];

function readPack(name: string): CompiledFile {
  return JSON.parse(readFileSync(path.join(packDir, `${name}.json`), "utf8")) as CompiledFile;
}

function readSource(name: string): string {
  return readFileSync(path.join(gamedataDir, `${name}.txt`), "utf8");
}

function toReaderSpec(spec: (typeof gamedataSpecs)[number]): ReaderFileSpec {
  return {
    name: spec.name,
    recordStart: spec.recordStart,
    header: spec.header,
    directives: spec.directives.map((d) => ({
      fmt: d.fmt,
      repeat: d.repeat,
      childOf: d.childOf,
    })),
  };
}

function recordLabel(rec: JsonObject, index: number): string {
  for (const key of ["name", "code", "store", "type", "level"] as const) {
    const v = rec[key];
    if (typeof v === "string" || typeof v === "number") return `${key}=${v}`;
    if (v !== null && typeof v === "object" && !Array.isArray(v)) {
      const obj = v as JsonObject;
      if (typeof obj["name"] === "string") return `${key}.name=${obj["name"]}`;
      if (typeof obj["tval"] === "string") return `${key}.tval=${obj["tval"]}`;
    }
  }
  return `#${index}`;
}

export interface Diff {
  file: string;
  record: string;
  field: string;
  reference: string;
  port: string;
}

function fmt(v: unknown): string {
  if (v === undefined) return "<missing>";
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

function isAllowed(file: string, record: string, fieldPath: string): boolean {
  return ALLOW_LIST.some(
    (a) =>
      a.file === file &&
      a.path === fieldPath &&
      (a.record === undefined || a.record === record),
  );
}

function deepDiff(
  file: string,
  record: string,
  fieldPath: string,
  ref: JsonValue | undefined,
  port: JsonValue | undefined,
  out: Diff[],
): void {
  if (isAllowed(file, record, fieldPath)) return;

  if (ref === undefined && port === undefined) return;
  if (ref === undefined || port === undefined) {
    out.push({
      file,
      record,
      field: fieldPath || "(root)",
      reference: fmt(ref),
      port: fmt(port),
    });
    return;
  }

  if (Array.isArray(ref) || Array.isArray(port)) {
    if (!Array.isArray(ref) || !Array.isArray(port)) {
      out.push({ file, record, field: fieldPath, reference: fmt(ref), port: fmt(port) });
      return;
    }
    const n = Math.max(ref.length, port.length);
    for (let i = 0; i < n; i++) {
      deepDiff(file, record, `${fieldPath}[${i}]`, ref[i], port[i], out);
    }
    return;
  }

  if (ref !== null && typeof ref === "object" && port !== null && typeof port === "object") {
    const rk = Object.keys(ref as JsonObject);
    const pk = Object.keys(port as JsonObject);
    const keys = new Set([...rk, ...pk]);
    for (const k of keys) {
      const next = fieldPath ? `${fieldPath}.${k}` : k;
      deepDiff(
        file,
        record,
        next,
        (ref as JsonObject)[k],
        (port as JsonObject)[k],
        out,
      );
    }
    return;
  }

  if (ref !== port) {
    out.push({ file, record, field: fieldPath || "(root)", reference: fmt(ref), port: fmt(port) });
  }
}

function diffCompiled(file: string, ref: CompiledFile, pack: CompiledFile): Diff[] {
  const out: Diff[] = [];
  if (ref.file !== pack.file) {
    out.push({
      file,
      record: "(meta)",
      field: "file",
      reference: fmt(ref.file),
      port: fmt(pack.file),
    });
  }
  if (ref.source !== pack.source) {
    out.push({
      file,
      record: "(meta)",
      field: "source",
      reference: fmt(ref.source),
      port: fmt(pack.source),
    });
  }
  deepDiff(file, "(header)", "header", ref.header as JsonValue | undefined, pack.header as JsonValue | undefined, out);

  const n = Math.max(ref.records.length, pack.records.length);
  for (let i = 0; i < n; i++) {
    const rRec = ref.records[i];
    const pRec = pack.records[i];
    const label =
      rRec !== undefined
        ? recordLabel(rRec, i)
        : pRec !== undefined
          ? recordLabel(pRec, i)
          : `#${i}`;
    if (rRec === undefined || pRec === undefined) {
      out.push({
        file,
        record: label,
        field: `(record index ${i})`,
        reference: rRec === undefined ? "<missing record>" : fmt(rRec),
        port: pRec === undefined ? "<missing record>" : fmt(pRec),
      });
      continue;
    }
    deepDiff(file, label, "", rRec, pRec, out);
  }
  return out;
}

/** Count leaf field comparisons (every primitive or missing-vs-present). */
function countLeaves(v: JsonValue | undefined): number {
  if (v === undefined || v === null) return 1;
  if (Array.isArray(v)) return v.reduce<number>((n, x) => n + countLeaves(x), 0) || 1;
  if (typeof v === "object") {
    const keys = Object.keys(v as JsonObject);
    if (keys.length === 0) return 1;
    return keys.reduce((n, k) => n + countLeaves((v as JsonObject)[k]), 0);
  }
  return 1;
}

/** Collect every flags-like string payload and its split tokens. */
function collectFlagPayloads(
  v: JsonValue,
  pathSoFar: string,
  out: Array<{ path: string; raw: string; tokens: string[] }>,
): void {
  if (typeof v === "string") {
    // Heuristic: paths ending in flags / flags-off / spells / values / etc. that use '|' lists
    if (
      /(^|\.)(flags|flags-off|conflict-flags|obj-flags|player-flags|spells|values|min-values|colors|labelcolors|symbols)(\[\d+\])?$/.test(
        pathSoFar,
      ) ||
      v.includes("|")
    ) {
      if (v.includes("|") || /(flags|spells|values)/.test(pathSoFar)) {
        out.push({ path: pathSoFar, raw: v, tokens: splitFlagList(v) });
      }
    }
    return;
  }
  if (Array.isArray(v)) {
    v.forEach((x, i) => collectFlagPayloads(x, `${pathSoFar}[${i}]`, out));
    return;
  }
  if (v !== null && typeof v === "object") {
    for (const [k, child] of Object.entries(v as JsonObject)) {
      const next = pathSoFar ? `${pathSoFar}.${k}` : k;
      collectFlagPayloads(child as JsonValue, next, out);
    }
  }
}

// ─── Stats for the findings report (exported for optional external use) ───
export interface ExactnessStats {
  filesCompared: number;
  recordsCompared: number;
  leafFieldsCompared: number;
  diffs: Diff[];
  deferred: typeof DEFERRED_SOURCES;
  sourceTxtCount: number;
  packJsonCount: number;
  inheritance: {
    monstersChecked: number;
    missingBases: string[];
    objectsChecked: number;
    missingObjectBases: string[];
  };
}

export function runExactnessAudit(): ExactnessStats {
  const sourceTxt = readdirSync(gamedataDir)
    .filter((f) => f.endsWith(".txt"))
    .map((f) => f.replace(/\.txt$/, ""))
    .sort();
  const packJson = readdirSync(packDir)
    .filter((f) => f.endsWith(".json") && f !== "manifest.json")
    .map((f) => f.replace(/\.json$/, ""))
    .sort();

  const allDiffs: Diff[] = [];
  let recordsCompared = 0;
  let leafFieldsCompared = 0;

  for (const spec of gamedataSpecs) {
    const text = readSource(spec.name);
    const ref = independentCompile(text, toReaderSpec(spec));
    const pack = readPack(spec.name);
    recordsCompared += Math.max(ref.records.length, pack.records.length);
    for (const r of ref.records) leafFieldsCompared += countLeaves(r);
    if (ref.header) leafFieldsCompared += countLeaves(ref.header);
    allDiffs.push(...diffCompiled(spec.name, ref, pack));
  }

  // Inheritance: resolve monster base: the way mon-init.c does (lookup + flag union readiness).
  const monBase = independentCompile(readSource("monster_base"), toReaderSpec(gamedataSpecs.find((s) => s.name === "monster_base")!));
  const mon = independentCompile(readSource("monster"), toReaderSpec(gamedataSpecs.find((s) => s.name === "monster")!));
  const baseNames = new Set(
    monBase.records.map((r) => r["name"]).filter((n): n is string => typeof n === "string"),
  );
  const missingBases: string[] = [];
  for (const r of mon.records) {
    const base = r["base"];
    const name = typeof r["name"] === "string" ? r["name"] : "?";
    if (typeof base === "string" && !baseNames.has(base)) {
      missingBases.push(`${name} -> ${base}`);
    }
  }

  // Object kinds reference object_base by type (tval name).
  const objBase = independentCompile(
    readSource("object_base"),
    toReaderSpec(gamedataSpecs.find((s) => s.name === "object_base")!),
  );
  const obj = independentCompile(
    readSource("object"),
    toReaderSpec(gamedataSpecs.find((s) => s.name === "object")!),
  );
  const tvalNames = new Set<string>(["none"]); // TV_NONE placeholders; see obj-tval.c
  for (const r of objBase.records) {
    const n = r["name"];
    if (n !== null && typeof n === "object" && !Array.isArray(n)) {
      const tval = (n as JsonObject)["tval"];
      if (typeof tval === "string") tvalNames.add(tval);
    } else if (typeof n === "string") {
      tvalNames.add(n);
    }
  }
  const missingObjectBases: string[] = [];
  for (const r of obj.records) {
    const t = r["type"];
    const name = typeof r["name"] === "string" ? r["name"] : "?";
    if (typeof t === "string" && !tvalNames.has(t)) {
      missingObjectBases.push(`${name} -> ${t}`);
    }
  }

  return {
    filesCompared: gamedataSpecs.length,
    recordsCompared,
    leafFieldsCompared,
    diffs: allDiffs,
    deferred: DEFERRED_SOURCES,
    sourceTxtCount: sourceTxt.length,
    packJsonCount: packJson.length,
    inheritance: {
      monstersChecked: mon.records.length,
      missingBases,
      objectsChecked: obj.records.length,
      missingObjectBases,
    },
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe("W5 data exactness: every gamedata source is accounted for", () => {
  it("reference/lib/gamedata has 45 .txt files; pack covers all non-deferred", () => {
    const sourceTxt = readdirSync(gamedataDir)
      .filter((f) => f.endsWith(".txt"))
      .map((f) => f.replace(/\.txt$/, ""))
      .sort();
    expect(sourceTxt).toHaveLength(45);

    const deferred = new Set(DEFERRED_SOURCES.map((d) => d.name));
    const expectedPack = sourceTxt.filter((n) => !deferred.has(n)).sort();
    const packNames = gamedataSpecs.map((s) => s.name).sort();
    expect(packNames).toEqual(expectedPack);

    const onDisk = readdirSync(packDir)
      .filter((f) => f.endsWith(".json") && f !== "manifest.json")
      .map((f) => f.replace(/\.json$/, ""))
      .sort();
    expect(onDisk).toEqual(packNames);
  });
});

describe("W5 data exactness: independent re-parse vs committed pack", () => {
  for (const spec of gamedataSpecs) {
    it(`${spec.name}.txt field-level match`, () => {
      const text = readSource(spec.name);
      const ref = independentCompile(text, toReaderSpec(spec));
      const pack = readPack(spec.name);
      const diffs = diffCompiled(spec.name, ref, pack);
      if (diffs.length > 0) {
        const sample = diffs
          .slice(0, 25)
          .map(
            (d) =>
              `  [${d.record}] ${d.field}\n    ref:  ${d.reference}\n    port: ${d.port}`,
          )
          .join("\n");
        expect.fail(
          `${diffs.length} difference(s) in ${spec.name} (showing up to 25):\n${sample}`,
        );
      }
      expect(ref.records.length).toBe(pack.records.length);
      expect(ref.records.length).toBeGreaterThan(0);
    });
  }
});

describe("W5 data exactness: flags split and base inheritance", () => {
  it("flags: / spells: payloads tokenize on ' |' consistently in pack and re-parse", () => {
    const problems: string[] = [];
    for (const spec of gamedataSpecs) {
      const text = readSource(spec.name);
      const ref = independentCompile(text, toReaderSpec(spec));
      const pack = readPack(spec.name);
      for (let i = 0; i < ref.records.length; i++) {
        const refFlags: Array<{ path: string; raw: string; tokens: string[] }> = [];
        const packFlags: Array<{ path: string; raw: string; tokens: string[] }> = [];
        collectFlagPayloads(ref.records[i]!, "", refFlags);
        collectFlagPayloads(pack.records[i]!, "", packFlags);
        // Same paths, same tokens after C strtok(" |") split.
        const packByPath = new Map(packFlags.map((f) => [f.path, f]));
        for (const f of refFlags) {
          const p = packByPath.get(f.path);
          if (p === undefined) continue; // structural test covers missing paths
          if (f.raw !== p.raw) {
            problems.push(`${spec.name}[${i}] ${f.path}: raw ref=${JSON.stringify(f.raw)} pack=${JSON.stringify(p.raw)}`);
          } else if (f.tokens.join("\0") !== p.tokens.join("\0")) {
            problems.push(
              `${spec.name}[${i}] ${f.path}: tokens ref=${f.tokens.join("|")} pack=${p.tokens.join("|")}`,
            );
          }
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("monster base: names resolve (C lookup_monster_base) and flags-off is well-formed", () => {
    const monBaseSpec = gamedataSpecs.find((s) => s.name === "monster_base")!;
    const monSpec = gamedataSpecs.find((s) => s.name === "monster")!;
    const bases = independentCompile(readSource("monster_base"), toReaderSpec(monBaseSpec));
    const monsters = independentCompile(readSource("monster"), toReaderSpec(monSpec));
    const baseByName = new Map<string, JsonObject>();
    for (const b of bases.records) {
      if (typeof b["name"] === "string") baseByName.set(b["name"], b);
    }

    const missing: string[] = [];
    const badFlagsOff: string[] = [];
    for (const m of monsters.records) {
      const name = typeof m["name"] === "string" ? m["name"] : "?";
      const base = m["base"];
      if (typeof base !== "string") continue;
      const b = baseByName.get(base);
      if (b === undefined) {
        missing.push(`${name} -> ${base}`);
        continue;
      }
      // Effective glyph: monster glyph overrides base glyph (parse_monster_base + glyph).
      // Pack stores unresolved base: reference — we only verify resolvability here.
      const flagsOff = m["flags-off"];
      if (Array.isArray(flagsOff)) {
        for (const line of flagsOff) {
          if (typeof line === "string") {
            for (const tok of splitFlagList(line)) {
              if (tok.length === 0) badFlagsOff.push(`${name}: empty flag token`);
            }
          }
        }
      }
    }
    expect(missing).toEqual([]);
    expect(badFlagsOff).toEqual([]);
  });

  it("object type: references an object_base tval name (C kb_info / tval)", () => {
    const baseSpec = gamedataSpecs.find((s) => s.name === "object_base")!;
    const objSpec = gamedataSpecs.find((s) => s.name === "object")!;
    const bases = independentCompile(readSource("object_base"), toReaderSpec(baseSpec));
    const objects = independentCompile(readSource("object"), toReaderSpec(objSpec));
    const tvals = new Set<string>();
    for (const b of bases.records) {
      const n = b["name"];
      if (n !== null && typeof n === "object" && !Array.isArray(n)) {
        const t = (n as JsonObject)["tval"];
        if (typeof t === "string") tvals.add(t);
      }
    }
    // C tval_find_idx also knows "none" (TV_NONE) for internal placeholders
    // (<pile>, <unknown item>, <unknown treasure>, <curse object>) that have
    // no object_base row — same as reference/src/obj-tval.c.
    tvals.add("none");
    const missing: string[] = [];
    for (const o of objects.records) {
      const t = o["type"];
      const name = typeof o["name"] === "string" ? o["name"] : "?";
      if (typeof t === "string" && !tvals.has(t)) missing.push(`${name} -> ${t}`);
    }
    expect(missing).toEqual([]);
  });
});

describe("W5 data exactness: deferred sources", () => {
  it("old_class.txt exists upstream and is not in the pack", () => {
    const text = readFileSync(path.join(gamedataDir, "old_class.txt"), "utf8");
    expect(text.length).toBeGreaterThan(0);
    expect(gamedataSpecs.find((s) => s.name === "old_class")).toBeUndefined();
  });
});
