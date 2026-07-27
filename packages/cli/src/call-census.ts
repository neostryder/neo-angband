/**
 * Upstream CALL-SITE CENSUS: a mechanical detector for functions the port has
 * but does not call everywhere the C calls them.
 *
 * WHY THIS EXISTS
 * ---------------
 * text-census.ts finds text the port never says. This finds the other half of
 * the same failure, and the one behind most of the bugs found by playing:
 * the function IS ported, correct, and tested - and one of its callers was
 * never wired up. That family has produced, so far:
 *
 *   - calc_inventory not run on savefile load (the pack sorted itself only
 *     after the first pickup)
 *   - ExpDeps.msg never supplied, so every level-up was silent
 *   - OBJ_NOTICE_ASSESSED never set at birth
 *   - pack_overflow(NULL) at game-world.c:947 unwired
 *   - dungeon_get_next_level's seam wired at ZERO of its 12 call sites, so
 *     stairs skipped Sauron's quest level entirely
 *
 * Every one of those is invisible to a reviewer reading the ported function,
 * because the ported function is fine. What is missing is a call, somewhere
 * else, that nobody was looking at.
 *
 * HOW IT MATCHES
 * --------------
 * Names are normalized to letters and digits, lowercased, so the C's
 * snake_case and the port's camelCase land on the same key:
 * `calc_inventory` and `calcInventory` are both `calcinventory`. That is the
 * whole mapping - it is blunt on purpose, since anything cleverer would need a
 * hand-maintained table that could itself go stale.
 *
 * TIER 1 (the gate): for each C function whose name the port also defines,
 * compare the number of DISTINCT call sites on each side. Fewer on the port
 * side is a lead: either a caller is missing, or the port reaches that call
 * through a different shape and the difference is accounted for in the test's
 * allowlist. Only functions the port already has are in scope here, which
 * keeps the population small enough to triage honestly.
 *
 * TIER 2 (a report, not a gate): C functions with no port definition of that
 * name at all, ranked by how many places the C calls them from. Most entries
 * are static helpers whose logic was inlined, or functions the port renamed
 * deliberately (do_cmd_go_down is the "descend" command handler), so this
 * cannot be a gate without a table of thousands. It is a mining list.
 *
 * WHAT IT CANNOT SEE
 * ------------------
 * Call COUNTS, not call CORRECTNESS: it cannot tell whether the port calls the
 * function at the same point in the same order with the same arguments. A port
 * that calls a function from ten wrong places passes. It is a floor under the
 * port's wiring, not a proof of it.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { stripComments } from "./text-census";

/** One upstream function: where it is defined and where it is called from. */
export interface CFunction {
  /** The C name, verbatim (e.g. "calc_inventory"). */
  name: string;
  /** Normalized match key (letters and digits, lowercased). */
  key: string;
  /** Repo-relative path of the definition, forward slashes. */
  file: string;
  line: number;
  /** Whether the definition is `static` (file-local in the C). */
  isStatic: boolean;
  /** Distinct "file:line" call sites across the in-scope C tree. */
  callSites: string[];
}

/** A port symbol of the same normalized name. */
export interface PortSymbol {
  key: string;
  /** The identifier as the port spells it (first definition seen). */
  name: string;
  /** "file:line" of each definition. */
  defs: string[];
  /** Distinct "file:line" call sites in the port. */
  callSites: string[];
  /**
   * Distinct "file:line" of every OTHER mention of the identifier - including
   * being passed as a callback (`{ ok: objCanZap }`) or re-exported. A symbol
   * that is referenced but never called with parens is wired, not dead, so
   * this is what tier 1 tests; counting only calls flagged every
   * callback-style seam in the port as unused.
   */
  refs: string[];
}

/** A tier-1 finding: ported, but called from fewer places than the C. */
export interface UnderCalled {
  name: string;
  portName: string;
  key: string;
  cFile: string;
  cLine: number;
  cCalls: number;
  portCalls: number;
  /** Other mentions of the port symbol (callback wiring, re-exports). */
  portRefs: number;
  /** The C call sites, so the missing one can be found by elimination. */
  cCallSites: string[];
}

/** A tier-2 entry: no port definition of that name at all. */
export interface Unmatched {
  name: string;
  cFile: string;
  cLine: number;
  cCalls: number;
}

/**
 * Same scope rule as the text census, and for the same reasons: upstream's own
 * test tree, the per-platform front ends, and the Borg's console are not part
 * of the game this port owes a function to.
 */
function inScopeC(rel: string): boolean {
  if (!rel.endsWith(".c")) return false;
  if (rel.includes("/tests/")) return false;
  if (rel.includes("/borg/")) return false;
  return !/\/(?:main-|snd-)/u.test(rel);
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** Letters and digits only, lowercased: the snake_case <-> camelCase bridge. */
export function normalizeName(name: string): string {
  return name.replace(/[^A-Za-z0-9]/gu, "").toLowerCase();
}

/**
 * C names that normalize onto something far too common to compare, or that are
 * language/library rather than game logic. Matching these would drown the
 * signal in noise rather than add any.
 */
const C_NAME_SKIP = new Set([
  // z-layer allocation and string plumbing, not game behaviour.
  "mem_alloc", "mem_zalloc", "mem_free", "mem_realloc", "string_make",
  "string_free", "string_append", "my_strcpy", "my_strcat", "my_stricmp",
  "my_strnicmp", "format", "vformat", "strnfmt", "vstrnfmt", "quit", "plog",
  // Single-word names that collide with ordinary port identifiers.
  "main", "init", "cleanup", "free", "get", "set", "add", "remove", "next",
  "count", "name", "size", "type", "value", "text", "line", "list", "menu",
  "new", "copy", "test", "run", "step", "sound", "note", "search", "path",
]);

/** Where the port keeps code the C could correspond to. */
function portFiles(root: string): string[] {
  const out: string[] = [];
  for (const pkg of readdirSync(join(root, "packages"))) {
    try {
      for (const f of walk(join(root, "packages", pkg, "src"))) {
        if (!/\.tsx?$/u.test(f)) continue;
        if (/\.test\.[cm]?tsx?$/u.test(f)) continue;
        out.push(f);
      }
    } catch {
      /* optional tree */
    }
  }
  try {
    for (const f of walk(join(root, "packages", "web", "mods"))) {
      if (/\.tsx?$/u.test(f) && !/\.test\./u.test(f)) out.push(f);
    }
  } catch {
    /* optional tree */
  }
  return out;
}

/** Line number of a character offset, via a prefix scan done once per file. */
function lineIndex(src: string): (idx: number) => number {
  const starts: number[] = [0];
  for (let i = 0; i < src.length; i++) {
    if (src[i] === "\n") starts.push(i + 1);
  }
  return (idx: number): number => {
    let lo = 0;
    let hi = starts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((starts[mid] as number) <= idx) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };
}

/**
 * A C function DEFINITION: a return type and name starting at column 0, with
 * the body's `{` arriving before any `;`. That last clause is what separates a
 * definition from a prototype, which is the whole trick - upstream declares
 * everything in headers, and a header prototype is not a call site either.
 */
const C_DEF =
  /^(static\s+)?(?:const\s+|unsigned\s+|signed\s+|struct\s+|enum\s+|union\s+)*[A-Za-z_][\w]*\s*\**\s*\**\s*([a-z_][a-z0-9_]*)\s*\(/gmu;

/** Every in-scope C function, with its distinct call sites. */
export function extractCFunctions(root: string): CFunction[] {
  const refDir = join(root, "reference", "src");
  const sources = new Map<string, string>();
  for (const file of walk(refDir)) {
    const rel = relative(root, file).split(sep).join("/");
    if (!inScopeC(rel)) continue;
    sources.set(rel, stripComments(readFileSync(file, "utf8")));
  }

  const defs: CFunction[] = [];
  const seen = new Set<string>();
  for (const [rel, src] of sources) {
    const lineAt = lineIndex(src);
    C_DEF.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = C_DEF.exec(src)) !== null) {
      const name = m[2] as string;
      // Body, not prototype: `{` before `;`.
      const close = src.indexOf(")", m.index + m[0].length - 1);
      if (close < 0) continue;
      const after = src.slice(close + 1, close + 200);
      if (!/^[^;]*\{/su.test(after)) continue;
      if (C_NAME_SKIP.has(name)) continue;
      // Keep one definition per name; a static duplicate in another file is
      // the same behaviour as far as "does the port have this" goes.
      if (seen.has(name)) continue;
      seen.add(name);
      defs.push({
        name,
        key: normalizeName(name),
        file: rel,
        line: lineAt(m.index),
        isStatic: m[1] !== undefined,
        callSites: [],
      });
    }
  }

  // Call sites: `name(` not preceded by an identifier character, anywhere in
  // the in-scope C, minus the definition site itself.
  for (const def of defs) {
    const re = new RegExp(String.raw`(^|[^\w])${def.name}\s*\(`, "gmu");
    for (const [rel, src] of sources) {
      const lineAt = lineIndex(src);
      re.lastIndex = 0;
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        const line = lineAt(m.index);
        if (rel === def.file && line === def.line) continue;
        const at = `${rel}:${line}`;
        if (!def.callSites.includes(at)) def.callSites.push(at);
      }
    }
  }
  return defs;
}

/** Port definitions of a function-like symbol, keyed by normalized name. */
const PORT_DEF =
  /(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)|(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]*)?=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*(?::[^=]*)?=>|^\s{2}(?:private\s+|public\s+|protected\s+)?(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*:/gmu;

/** Every port symbol that could correspond to a C function. */
export function extractPortSymbols(root: string): Map<string, PortSymbol> {
  const byKey = new Map<string, PortSymbol>();
  const files: { rel: string; src: string }[] = [];
  for (const file of portFiles(root)) {
    const rel = relative(root, file).split(sep).join("/");
    files.push({ rel, src: stripComments(readFileSync(file, "utf8")) });
  }

  const record = (key: string, name: string): PortSymbol => {
    let sym = byKey.get(key);
    if (!sym) {
      sym = { key, name, defs: [], callSites: [], refs: [] };
      byKey.set(key, sym);
    }
    return sym;
  };

  for (const { rel, src } of files) {
    const lineAt = lineIndex(src);
    PORT_DEF.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = PORT_DEF.exec(src)) !== null) {
      const name = (m[1] ?? m[2] ?? m[3]) as string;
      const key = normalizeName(name);
      if (!key) continue;
      record(key, name).defs.push(`${rel}:${lineAt(m.index)}`);
    }
  }

  // Calls AND plain references. The distinction matters: the port wires a lot
  // of upstream predicates as callbacks (`{ ok: objCanZap }`), which is a use,
  // not a gap - counting only `name(` flagged every one of those as dead.
  const CALL = /([A-Za-z_$][\w$]*)(\s*\()?/gu;
  for (const { rel, src } of files) {
    const lineAt = lineIndex(src);
    CALL.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CALL.exec(src)) !== null) {
      // Skip a definition's own name-and-paren (handled by the def scan).
      const before = src.slice(Math.max(0, m.index - 12), m.index);
      if (/\b(?:function|class)\s+$/u.test(before)) continue;
      const key = normalizeName(m[1] as string);
      const sym = byKey.get(key);
      if (!sym) continue;
      if (m[2] === undefined) {
        const ref = `${rel}:${lineAt(m.index)}`;
        if (!sym.defs.includes(ref) && !sym.refs.includes(ref)) {
          sym.refs.push(ref);
        }
        continue;
      }
      const at = `${rel}:${lineAt(m.index)}`;
      if (sym.defs.includes(at)) continue;
      if (!sym.callSites.includes(at)) sym.callSites.push(at);
    }
  }
  return byKey;
}

/** The census: tier-1 under-called functions and tier-2 unmatched names. */
export function callCensus(
  cFns: readonly CFunction[],
  port: Map<string, PortSymbol>,
): { underCalled: UnderCalled[]; unmatched: Unmatched[] } {
  const underCalled: UnderCalled[] = [];
  const unmatched: Unmatched[] = [];
  for (const fn of cFns) {
    const sym = port.get(fn.key);
    if (!sym || sym.defs.length === 0) {
      if (fn.callSites.length > 0) {
        unmatched.push({
          name: fn.name,
          cFile: fn.file,
          cLine: fn.line,
          cCalls: fn.callSites.length,
        });
      }
      continue;
    }
    if (sym.callSites.length < fn.callSites.length) {
      underCalled.push({
        name: fn.name,
        portName: sym.name,
        key: fn.key,
        cFile: fn.file,
        cLine: fn.line,
        cCalls: fn.callSites.length,
        portCalls: sym.callSites.length,
        portRefs: sym.refs.length,
        cCallSites: fn.callSites,
      });
    }
  }
  // Worst shortfall first in tier 1; most-called first in tier 2.
  underCalled.sort(
    (a, b) => b.cCalls - b.portCalls - (a.cCalls - a.portCalls),
  );
  unmatched.sort((a, b) => b.cCalls - a.cCalls);
  return { underCalled, unmatched };
}

/** Run the whole call-site census against a repo root. */
export function runCallCensus(root: string): {
  cFns: CFunction[];
  port: Map<string, PortSymbol>;
  underCalled: UnderCalled[];
  unmatched: Unmatched[];
} {
  const cFns = extractCFunctions(root);
  const port = extractPortSymbols(root);
  return { cFns, port, ...callCensus(cFns, port) };
}
