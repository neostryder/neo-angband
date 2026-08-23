/**
 * W5 data exactness: an independent re-parse of every reference gamedata
 * file, field-by-field / index-by-index against the committed pack the game
 * loads (packages/content/pack/*.json).
 *
 * The reader lives in data-exactness.reader.ts and does not call
 * packages/content's parseLine / compileGamedata, so a shared parser bug
 * cannot hide on both sides of the diff.
 *
 * Format registration (parser_reg format strings, repeat, childOf) is taken
 * from gamedataSpecs. That metadata is transcribed from the C registration
 * tables, so on its own it would be a shared-source hole: a wrong format
 * string would make both sides agree. The "spec format strings match
 * parser_reg" guard below closes it by re-reading the format strings straight
 * out of reference/src/*.c and requiring an exact (strtok-normalized) match.
 *
 * The remaining port-supplied metadata (repeat, childOf, recordStart, header,
 * orderKey) is NOT independently derivable from the C sources (it is implicit
 * in the handler bodies) and is therefore not verified here. See the coverage
 * guards for what is checked instead.
 *
 * old_class.txt is present upstream but deliberately not compiled (retired
 * data); it is covered by an explicit exclusion below.
 */

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import {
  extractDirectiveKeys,
  extractDirectiveSequence,
  extractParserRegFormats,
  independentCompile,
  independentIsValidRandom,
  independentParseLine,
  independentParseSignature,
  normalizeFormat,
  splitFlagList,
  type CompiledFile,
  type DirectiveSignature,
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
const referenceRoot = path.join(repoRoot, "reference");

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

/**
 * Task #27, the directive-coverage guard.
 *
 * A re-parse is only as good as the directive set it understands: a directive
 * that appears in the .txt but not in the reader's table would either throw or
 * (if the pack's compiler ignored it too) let both sides agree on incomplete
 * data. Two directions are guarded:
 *
 *   1. every directive key occurring in reference/lib/gamedata/<file>.txt is
 *      registered for that file's spec (UNHANDLED_TXT_DIRECTIVES below);
 *   2. every key the pack emits at record root is either a registered
 *      directive or a declared synthetic order key (SYNTHETIC_PACK_KEYS below).
 *
 * Direction 2 is what catches `drop-order`: it is not an upstream directive at
 * all but a key the pack's compiler generates, so only the pack side can
 * reveal it. Blanket skips are not permitted. Each exclusion is an individual
 * entry with a stated reason.
 */

/**
 * Directives that occur in a .txt file but are deliberately not registered.
 * Each entry needs a reason grounded in the C sources.
 */
const UNHANDLED_TXT_DIRECTIVES: readonly {
  readonly file: string;
  readonly directive: string;
  readonly reason: string;
}[] = [
  // none: every directive in every compiled gamedata file is registered.
];

/**
 * Keys the pack's compiler synthesizes rather than reading from a directive.
 * The reader must generate each of these too (via DirectiveDef.orderKey or
 * DirectiveDef.mergeInto - `kind` distinguishes which), or the field-level
 * diff below would report the whole column as missing.
 */
const SYNTHETIC_PACK_KEYS: readonly {
  readonly file: string;
  readonly key: string;
  readonly reason: string;
  /** Which mechanism generates it. Defaults to "orderKey". */
  readonly kind?: "orderKey" | "mergeInto";
}[] = [
  {
    file: "monster",
    key: "drop-order",
    reason:
      "C keeps drop: and drop-base: in one monster_drop list (parse_monster_drop / parse_monster_drop_base both prepend to r->drops, mon-init.c:1534,1558), so the two directives interleave. The pack splits them into per-directive arrays and records the original file order here; declared via orderKey on both directives in specs/mon-init.ts.",
  },
  {
    file: "flavor",
    key: "entries",
    kind: "mergeInto",
    reason:
      "flavor.txt's fixed: and flavor: lines both belong to one per-record list (issue #2): a record's true line order was not recoverable from split fixed/flavor arrays because the entry index is flavor.txt's own numbering, not file order. The pack now emits one array per record, each entry tagged kind: \"fixed\" | \"flavor\", declared via mergeInto on both directives in specs/init.ts.",
  },
];

/**
 * parser_reg() calls whose format string is built at run time, so it never
 * appears as a string literal in the C source. Rather than excusing these,
 * each entry re-derives the exact family (bounds included) from the same C
 * file, so a change upstream breaks the derivation instead of passing silently.
 */
const PROGRAMMATIC_PARSER_REG: readonly {
  readonly source: string;
  readonly reason: string;
  readonly derive: (src: string) => string[];
}[] = [
  {
    source: "src/ui-entry.c",
    reason:
      'ui-entry.c:2289-2292 registers the shortened-label family in a loop: parser_reg(p, format("label%d str label%d", i, i), ...) for i = 1..MAX_SHORTENED. The template, the loop bounds and the value of MAX_SHORTENED are all read back out of ui-entry.c below, so the family is verified rather than assumed. One parser serves both ui_entry_base.txt and ui_entry.txt (run_parse_ui_entry, ui-entry.c:2301).',
    derive: (src) => {
      const hasTemplate = /parser_reg\(\s*p,\s*format\("label%d str label%d",\s*i,\s*i\)/.test(src);
      const hasLoop = /for\s*\(\s*i\s*=\s*1;\s*i\s*<=\s*MAX_SHORTENED;\s*\+\+i\s*\)/.test(src);
      const bound = /#define\s+MAX_SHORTENED\s+\((\d+)\)/.exec(src);
      if (!hasTemplate || !hasLoop || bound === null) return [];
      return Array.from(
        { length: Number(bound[1]) },
        (_unused, k) => `label${k + 1} str label${k + 1}`,
      );
    },
  },
];

/** Structural view shared by the port's FileSpec and the reader's FileSpec. */
interface AnySpec {
  readonly directives: readonly {
    readonly fmt: string;
    readonly orderKey?: string;
    readonly mergeInto?: string;
  }[];
}

function handledDirectives(spec: AnySpec): Set<string> {
  return new Set(spec.directives.map((d) => normalizeFormat(d.fmt).split(" ")[0]!));
}

function declaredOrderKeys(spec: AnySpec): Set<string> {
  const out = new Set<string>();
  for (const d of spec.directives) {
    if (d.orderKey !== undefined) out.add(d.orderKey);
  }
  return out;
}

function declaredMergeKeys(spec: AnySpec): Set<string> {
  const out = new Set<string>();
  for (const d of spec.directives) {
    if (d.mergeInto !== undefined) out.add(d.mergeInto);
  }
  return out;
}

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
    ...(spec.header === undefined ? {} : { header: spec.header }),
    directives: spec.directives.map((d) => ({
      fmt: d.fmt,
      ...(d.repeat === undefined ? {} : { repeat: d.repeat }),
      ...(d.childOf === undefined ? {} : { childOf: d.childOf }),
      ...(d.orderKey === undefined ? {} : { orderKey: d.orderKey }),
      ...(d.mergeInto === undefined ? {} : { mergeInto: d.mergeInto }),
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

/** Record-root keys the pack emits for a file (records plus header). */
function packRootKeys(pack: CompiledFile): Set<string> {
  const keys = new Set<string>();
  for (const rec of pack.records) {
    for (const k of Object.keys(rec)) keys.add(k);
  }
  if (pack.header !== undefined) {
    for (const k of Object.keys(pack.header)) keys.add(k);
  }
  return keys;
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

      // Independent cross-check on the record splitter: the number of records
      // must equal the number of record-start directive lines in the raw text,
      // counted by a scanner that does not share the compile path.
      if (spec.recordStart !== null) {
        expect(extractDirectiveKeys(text).get(spec.recordStart) ?? 0).toBe(ref.records.length);
      } else {
        expect(ref.records.length).toBe(1);
      }
    });
  }
});

describe("W5 directive coverage guard (task #27)", () => {
  it("every directive occurring in a compiled .txt is registered for that file", () => {
    const unhandled: string[] = [];
    const allowed = new Set(
      UNHANDLED_TXT_DIRECTIVES.map((a) => `${a.file}:${a.directive}`),
    );
    const usedAllowances = new Set<string>();

    for (const spec of gamedataSpecs) {
      const handled = handledDirectives(spec);
      for (const directive of extractDirectiveKeys(readSource(spec.name)).keys()) {
        if (handled.has(directive)) continue;
        const key = `${spec.name}:${directive}`;
        if (allowed.has(key)) {
          usedAllowances.add(key);
          continue;
        }
        unhandled.push(key);
      }
    }
    expect(unhandled).toEqual([]);
    // A stale allowance is a silent hole; require every entry to be live.
    expect([...allowed].filter((k) => !usedAllowances.has(k))).toEqual([]);
  });

  it("every key the pack emits at record root is a registered directive, a declared order key, or a declared merge key", () => {
    const unaccounted: string[] = [];
    const allowed = new Map<string, (typeof SYNTHETIC_PACK_KEYS)[number]>(
      SYNTHETIC_PACK_KEYS.map((s) => [`${s.file}:${s.key}`, s]),
    );
    const usedAllowances = new Set<string>();

    for (const spec of gamedataSpecs) {
      const handled = handledDirectives(spec);
      const orderKeys = declaredOrderKeys(spec);
      const mergeKeys = declaredMergeKeys(spec);
      for (const key of packRootKeys(readPack(spec.name))) {
        if (handled.has(key)) continue;
        const id = `${spec.name}:${key}`;
        if (orderKeys.has(key) || mergeKeys.has(key)) {
          // Generated, and the reader generates it too, but it still has to be
          // named in SYNTHETIC_PACK_KEYS so nobody adds one without a reason.
          if (!allowed.has(id)) {
            unaccounted.push(`${id} (order/merge key with no SYNTHETIC_PACK_KEYS entry)`);
            continue;
          }
          usedAllowances.add(id);
          continue;
        }
        unaccounted.push(`${id} (not a directive, not a declared order/merge key)`);
      }
    }
    expect(unaccounted).toEqual([]);
    expect([...allowed.keys()].filter((k) => !usedAllowances.has(k))).toEqual([]);
  });

  it("every synthetic pack key is declared as an order/merge key the reader also generates", () => {
    for (const entry of SYNTHETIC_PACK_KEYS) {
      const spec = gamedataSpecs.find((s) => s.name === entry.file);
      expect(spec, `no spec for ${entry.file}`).toBeDefined();
      const declared = entry.kind === "mergeInto" ? declaredMergeKeys : declaredOrderKeys;
      // Declared on the spec (so the pack compiler emits it) ...
      expect(declared(spec!), `${entry.file}:${entry.key}`).toContain(entry.key);
      // ... and surviving the port -> reader spec translation (so the
      // independent re-parse emits it as well). Dropping it here is exactly the
      // drop-order gap this guard exists to catch.
      expect(declared(toReaderSpec(spec!))).toContain(entry.key);
      expect(entry.reason.length).toBeGreaterThan(40);
    }
  });

  it("spec format strings are the verbatim parser_reg() strings in the upstream C source", () => {
    const problems: string[] = [];
    const cCache = new Map<string, Map<string, Set<string>>>();

    const formatsFor = (relPath: string): Map<string, Set<string>> => {
      const cached = cCache.get(relPath);
      if (cached !== undefined) return cached;
      const src = readFileSync(path.join(referenceRoot, relPath), "utf8");
      const derived = PROGRAMMATIC_PARSER_REG.filter((e) => e.source === relPath).flatMap((e) =>
        e.derive(src),
      );
      const byDirective = new Map<string, Set<string>>();
      for (const registered of [...extractParserRegFormats(src), ...derived.map(normalizeFormat)]) {
        const directive = registered.split(" ")[0]!;
        const set = byDirective.get(directive) ?? new Set<string>();
        set.add(registered);
        byDirective.set(directive, set);
      }
      cCache.set(relPath, byDirective);
      return byDirective;
    };

    for (const spec of gamedataSpecs) {
      const registered = new Map<string, Set<string>>();
      for (const relPath of spec.upstream) {
        for (const [directive, formats] of formatsFor(relPath)) {
          const set = registered.get(directive) ?? new Set<string>();
          for (const f of formats) set.add(f);
          registered.set(directive, set);
        }
      }
      for (const def of spec.directives) {
        const want = normalizeFormat(def.fmt);
        const directive = want.split(" ")[0]!;
        const candidates = registered.get(directive);
        if (candidates === undefined) {
          problems.push(
            `${spec.name}: "${directive}" is not registered by parser_reg in ${spec.upstream.join(", ")}`,
          );
        } else if (!candidates.has(want)) {
          problems.push(
            `${spec.name}: format mismatch for "${directive}"\n    spec: ${want}\n    C:    ${[...candidates].join(" | ")}`,
          );
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it("programmatically registered directive families are derivable and fully present", () => {
    expect(PROGRAMMATIC_PARSER_REG.length).toBeGreaterThan(0);
    for (const entry of PROGRAMMATIC_PARSER_REG) {
      const src = readFileSync(path.join(referenceRoot, entry.source), "utf8");
      const derived = entry.derive(src);
      // An empty derivation means the C shape this entry assumes has changed.
      expect(derived.length, `${entry.source}: derivation produced nothing`).toBeGreaterThan(0);
      // Reverse direction: the spec must carry the whole family, not a prefix.
      for (const spec of gamedataSpecs) {
        if (!spec.upstream.includes(entry.source)) continue;
        const specFormats = new Set(spec.directives.map((d) => normalizeFormat(d.fmt)));
        for (const want of derived.map(normalizeFormat)) {
          expect(specFormats, `${spec.name} is missing "${want}"`).toContain(want);
        }
      }
    }
  });
});

describe("W5 data exactness: base inheritance", () => {
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
      // Pack stores unresolved base: reference. Only resolvability is verified.
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
    // no object_base row, same as reference/src/obj-tval.c.
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

describe("W5 data exactness: synthetic order keys match raw file order", () => {
  /**
   * Third derivation of the order groups, from the bare directive sequence of
   * the .txt: no field parsing, no record assembly, no shared code with either
   * compiler. If drop-order in the pack ever stops describing the actual file
   * order of drop:/drop-base:, this fails independently of the field diff.
   */
  for (const spec of gamedataSpecs) {
    const orderKeys = declaredOrderKeys(spec);
    if (orderKeys.size === 0) continue;
    it(`${spec.name}.txt order keys (${[...orderKeys].join(", ")})`, () => {
      const memberOf = new Map<string, string>();
      for (const def of spec.directives) {
        if (def.orderKey !== undefined) {
          memberOf.set(normalizeFormat(def.fmt).split(" ")[0]!, def.orderKey);
        }
      }
      const perRecord: Array<Map<string, string[]>> = [];
      const seen: Array<Map<string, number>> = [];
      for (const directive of extractDirectiveSequence(readSource(spec.name))) {
        if (directive === spec.recordStart) {
          perRecord.push(new Map());
          seen.push(new Map());
        }
        const key = memberOf.get(directive);
        if (key === undefined) continue;
        const groups = perRecord[perRecord.length - 1];
        const counts = seen[seen.length - 1];
        expect(groups, `${directive} before the first record`).toBeDefined();
        const n = counts!.get(directive) ?? 0;
        counts!.set(directive, n + 1);
        const list = groups!.get(key) ?? [];
        list.push(`${directive}:${n}`);
        groups!.set(key, list);
      }

      const pack = readPack(spec.name);
      expect(perRecord).toHaveLength(pack.records.length);
      const mismatches: string[] = [];
      for (let i = 0; i < pack.records.length; i++) {
        for (const key of orderKeys) {
          const expected = perRecord[i]!.get(key);
          const actual = pack.records[i]![key];
          const want = expected === undefined ? undefined : JSON.stringify(expected);
          const got = actual === undefined ? undefined : JSON.stringify(actual);
          if (want !== got) {
            mismatches.push(`record ${i} ${key}: raw=${want ?? "<absent>"} pack=${got ?? "<absent>"}`);
          }
        }
      }
      expect(mismatches).toEqual([]);
    });
  }
});

describe("W5 reader semantics vs reference/src/parser.c", () => {
  /**
   * The oracle needs its own guard: a reader that mis-tokenizes would agree
   * with a pack compiled by a parser that mis-tokenizes the same way. Expected
   * values here are read off parser.c by hand, not produced by either parser.
   */
  const sig = (fmt: string): ((d: string) => DirectiveSignature | undefined) => {
    const parsed = independentParseSignature(fmt);
    return (d) => (d === parsed.directive ? parsed : undefined);
  };

  it("blank lines, whitespace-only lines and '#' comments yield no directive", () => {
    const lookup = sig("name str name");
    expect(independentParseLine("", lookup)).toBeNull();
    expect(independentParseLine("   \t ", lookup)).toBeNull();
    expect(independentParseLine("# name:x", lookup)).toBeNull();
    expect(independentParseLine("   # indented comment", lookup)).toBeNull();
  });

  it("leading whitespace is stripped before tokenizing (parser.c:240)", () => {
    expect(independentParseLine("  name:Grip", sig("name str name"))).toEqual({
      directive: "name",
      values: { name: "Grip" },
    });
  });

  it("str consumes the rest of the line, colons and all (PARSE_T_STR, parser.c:293)", () => {
    expect(independentParseLine("desc:a:b:c", sig("desc str desc"))).toEqual({
      directive: "desc",
      values: { desc: "a:b:c" },
    });
  });

  it("strtok(\":\") collapses runs of delimiters, so an empty field is invisible", () => {
    expect(independentParseLine("blow::HIT", sig("blow sym method"))).toEqual({
      directive: "blow",
      values: { method: "HIT" },
    });
  });

  it("int uses strtol base 0: hex and octal literals, trailing garbage ignored", () => {
    const lookup = sig("v int value");
    expect(independentParseLine("v:0x1f", lookup)?.values["value"]).toBe(31);
    expect(independentParseLine("v:010", lookup)?.values["value"]).toBe(8);
    expect(independentParseLine("v:-12", lookup)?.values["value"]).toBe(-12);
    expect(independentParseLine("v:12abc", lookup)?.values["value"]).toBe(12);
    expect(() => independentParseLine("v:abc", lookup)).toThrow(/NOT_NUMBER/);
  });

  it("uint rejects a leading '-' (parser.c:326)", () => {
    const lookup = sig("v uint value");
    expect(independentParseLine("v:7", lookup)?.values["value"]).toBe(7);
    expect(() => independentParseLine("v:-7", lookup)).toThrow(/NOT_NUMBER/);
  });

  it("char takes exactly one code point and requires ':' or EOL after it", () => {
    const lookup = sig("glyph char glyph sym color");
    expect(independentParseLine("glyph:d:r", lookup)).toEqual({
      directive: "glyph",
      values: { glyph: "d", color: "r" },
    });
    expect(() => independentParseLine("glyph:dd:r", lookup)).toThrow(/FIELD_TOO_LONG/);
  });

  it("a missing optional field ends the line; a missing mandatory field throws", () => {
    expect(independentParseLine("blow:HIT", sig("blow sym method ?sym effect"))).toEqual({
      directive: "blow",
      values: { method: "HIT" },
    });
    expect(() => independentParseLine("blow", sig("blow sym method"))).toThrow(/MISSING_FIELD/);
  });

  it("an unregistered directive throws rather than being skipped", () => {
    expect(() => independentParseLine("bogus:1", sig("name str name"))).toThrow(
      /UNDEFINED_DIRECTIVE/,
    );
  });

  it("parse_random accepts the upstream grammar and rejects trailing garbage", () => {
    for (const ok of ["1", "20d10", "d4", "-3", "10+2d6", "5+d4", "2d6M10", "0"]) {
      expect(independentIsValidRandom(ok), ok).toBe(true);
    }
    // "1M5" is rejected upstream too: after the first number, i == 0 and the
    // next char is neither 'd' nor '+', so parse_random requires end-of-string
    // (parser.c:183).
    for (const bad of ["", "d", "1d", "abc", "5x", "1+", "+5", "2d6M", "1d2d3", "1M5"]) {
      expect(independentIsValidRandom(bad), bad).toBe(false);
    }
  });

  it("splitFlagList follows strtok(s, \" |\"): runs of delimiters collapse", () => {
    expect(splitFlagList("UNIQUE | MALE")).toEqual(["UNIQUE", "MALE"]);
    expect(splitFlagList("  A||B  C ")).toEqual(["A", "B", "C"]);
    expect(splitFlagList("")).toEqual([]);
    expect(splitFlagList(" | ")).toEqual([]);
  });

  it("extractParserRegFormats joins adjacent literals the way the C compiler does", () => {
    const src = [
      'parser_reg(p, "melee-critical-level int cutoff int mult int add "',
      '\t"int msg", parse_x);',
      'parser_reg(p, "name str name", parse_y);',
      "parser_reg(p, buf, parse_z);",
    ].join("\n");
    expect(extractParserRegFormats(src)).toEqual([
      "melee-critical-level int cutoff int mult int add int msg",
      "name str name",
    ]);
  });

  it("extractDirectiveSequence keeps file order and drops non-data lines", () => {
    const text = "# c\n\nname:a\n  drop:x\n\ndrop-base:y\nname:b\n";
    expect(extractDirectiveSequence(text)).toEqual([
      "name",
      "drop",
      "drop-base",
      "name",
    ]);
  });
});

describe("W5 data exactness: deferred sources", () => {
  it("old_class.txt exists upstream and is not in the pack", () => {
    const text = readFileSync(path.join(gamedataDir, "old_class.txt"), "utf8");
    expect(text.length).toBeGreaterThan(0);
    expect(gamedataSpecs.find((s) => s.name === "old_class")).toBeUndefined();
  });
});
