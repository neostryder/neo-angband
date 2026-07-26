/**
 * Record assembly: turns a parsed gamedata file into JSON records.
 *
 * A FileSpec mirrors one upstream init_parse_* registration set. Records
 * begin at the record-start directive; other directives attach to the
 * current record. Directives marked `repeat` accumulate into arrays (in
 * file order). Directives marked `childOf` attach to the most recent
 * instance of one of their parent directives, replicating the upstream
 * "walk to the last effect/book/spell/level" parsing idiom; when no parent
 * instance exists yet in the record they attach to the record itself
 * (upstream treats that as "human, not parser error") unless the directive
 * is marked `requireParent`, where upstream instead reports
 * PARSE_ERROR_MISSING_RECORD_HEADER. A repeat of a non-`repeat` directive is
 * refused as PARSE_ERROR_REPEATED_DIRECTIVE unless it is marked `lastWins`,
 * where upstream overwrites the previous value.
 *
 * Output key order is spec order (the upstream registration order), not
 * encounter order, so records diff cleanly against the .txt sources.
 */

import { ParseError, parseLine, parseSignature } from "./parser.js";
import type { DirectiveSignature } from "./parser.js";

export interface DirectiveDef {
  /** The exact upstream parser_reg() format string. */
  readonly fmt: string;
  /** Accumulate repeated occurrences into an array. */
  readonly repeat?: boolean;
  /** Attach to the most recent instance of one of these directives. */
  readonly childOf?: readonly string[];
  /** Preserve encounter order for a cross-directive repeated list. */
  readonly orderKey?: string;
  /**
   * A repeat of this directive REPLACES the previous value instead of being
   * refused. Upstream returns PARSE_ERROR_REPEATED_DIRECTIVE only where a
   * handler explicitly checks for a value already being set; the dice
   * handlers instead dice_free() the old dice and store the new one, so the
   * last line wins (init.c parse_class_dice, obj-init.c parse_object_dice,
   * player-timed.c parse_player_timed_effect_dice, init.c parse_trap_dice).
   * Asserted by c-info.c/k-info.c test_dice0 and ptimed.c test_effectdice0.
   */
  readonly lastWins?: boolean;
  /**
   * This directive is an ERROR when none of its `childOf` parents has been
   * seen yet, rather than attaching to the enclosing record. Upstream is
   * split on this: class.txt, object.txt and trap.txt treat an orphan
   * effect detail as "human, not parser, error" and return
   * PARSE_ERROR_NONE, but player-timed.c's four effect-* handlers return
   * PARSE_ERROR_MISSING_RECORD_HEADER when `ps->e` is NULL
   * (player-timed.c L473-560, asserted by ptimed.c test_missing_effect0).
   */
  readonly requireParent?: boolean;
}

export interface FileSpec {
  /** Gamedata file stem, e.g. "monster" for lib/gamedata/monster.txt. */
  readonly name: string;
  /** Upstream C sources that register this file's parser. */
  readonly upstream: readonly string[];
  /** Directive that begins a record; null for singleton files (constants). */
  readonly recordStart: string | null;
  /** Directives collected before the first record (e.g. object_base defaults). */
  readonly header?: readonly string[];
  readonly directives: readonly DirectiveDef[];
}

export type JsonPrimitive = string | number | boolean;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

export interface CompiledFile {
  file: string;
  source: string;
  header?: JsonObject;
  records: JsonObject[];
}

/** A container node: a directive instance that other directives attach to. */
class Node {
  readonly fields: Array<readonly [string, JsonPrimitive]> = [];
  readonly children = new Map<string, Slot>();
  readonly orderGroups = new Map<string, string[]>();
}

type Value = JsonPrimitive | JsonObject | Node;
type Slot = Value | Value[];

interface CompiledDirective {
  readonly def: DirectiveDef;
  readonly sig: DirectiveSignature;
  readonly isContainer: boolean;
}

interface Instance {
  readonly node: Node;
  readonly seq: number;
}

function buildTable(spec: FileSpec): Map<string, CompiledDirective> {
  const parents = new Set<string>();
  for (const def of spec.directives) {
    for (const parent of def.childOf ?? []) {
      parents.add(parent);
    }
  }
  const table = new Map<string, CompiledDirective>();
  for (const def of spec.directives) {
    const sig = parseSignature(def.fmt);
    if (table.has(sig.directive)) {
      throw new Error(`${spec.name}: duplicate directive spec "${sig.directive}"`);
    }
    table.set(sig.directive, { def, sig, isContainer: parents.has(sig.directive) });
  }
  for (const parent of parents) {
    if (!table.has(parent)) {
      throw new Error(`${spec.name}: childOf refers to unknown directive "${parent}"`);
    }
  }
  return table;
}

function makeValue(cd: CompiledDirective, values: Readonly<Record<string, string | number>>): Value {
  const entries: Array<readonly [string, JsonPrimitive]> = [];
  for (const field of cd.sig.fields) {
    const v = values[field.name];
    if (v !== undefined) {
      entries.push([field.name, v]);
    }
  }
  if (cd.isContainer) {
    const node = new Node();
    node.fields.push(...entries);
    return node;
  }
  if (cd.sig.fields.length === 1) {
    const only = entries[0];
    /* A lone optional field that is absent leaves a bare presence marker. */
    return only === undefined ? true : only[1];
  }
  const obj: JsonObject = {};
  for (const [k, v] of entries) {
    obj[k] = v;
  }
  return obj;
}

function finalizeValue(v: Value, spec: FileSpec, table: Map<string, CompiledDirective>): JsonValue {
  return v instanceof Node ? finalizeNode(v, spec, table) : v;
}

function finalizeNode(
  node: Node,
  spec: FileSpec,
  table: Map<string, CompiledDirective>,
): JsonObject {
  const out: JsonObject = {};
  for (const [k, v] of node.fields) {
    out[k] = v;
  }
  /* Emit child directives in spec (upstream registration) order. */
  for (const def of spec.directives) {
    const directive = def.fmt.split(" ", 1)[0];
    if (directive === undefined) {
      continue;
    }
    const slot = node.children.get(directive);
    if (slot === undefined) {
      continue;
    }
    out[directive] = Array.isArray(slot)
      ? slot.map((v) => finalizeValue(v, spec, table))
      : finalizeValue(slot, spec, table);
  }
  for (const [key, order] of node.orderGroups) out[key] = [...order];
  return out;
}

/**
 * Compile the text of one gamedata file into JSON records.
 * Throws on any line the upstream parser would reject and on duplicate
 * occurrences of directives the spec does not mark as repeating.
 *
 * This is the port's `parse_file` (datafile.c:87) plus the `fp->run` half of
 * `run_parser` (datafile.c:45): one line-at-a-time loop over the file feeding
 * `parseLine` (upstream `parser_parse`). Two deliberate differences, both
 * unobservable on shipped 4.2.6 data (W1-CAVE-SAVE-DATA.md, datafile section):
 * - Upstream tries ANGBAND_DIR_USER/<name>.txt before ANGBAND_DIR_GAMEDATA
 *   (datafile.c:96-105); user data-file overriding is the mod substrate's job
 *   here, and the compiler reads only reference/lib/gamedata.
 * - Upstream logs up to get_parser_error_limit() parse errors and returns the
 *   FIRST (datafile.c:113-141); this throws on the first. `parse_file_quit_
 *   not_found` (datafile.c:71) is the readFileSync throw in compile.ts.
 */
export function compileGamedata(text: string, spec: FileSpec): CompiledFile {
  const table = buildTable(spec);
  const lookup = (directive: string): DirectiveSignature | undefined =>
    table.get(directive)?.sig;

  const records: Node[] = [];
  const headerNode = spec.header !== undefined ? new Node() : null;
  let current: Node | null = null;
  if (spec.recordStart === null) {
    current = new Node();
    records.push(current);
  }
  let lastInstance = new Map<string, Instance>();
  let seq = 0;

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    let raw = lines[i] ?? "";
    if (raw.endsWith("\r")) {
      raw = raw.slice(0, -1);
    }
    if (i === 0 && raw.charCodeAt(0) === 0xfeff) {
      raw = raw.slice(1);
    }
    const where = `${spec.name}.txt:${i + 1}`;
    let parsed;
    try {
      parsed = parseLine(raw, lookup);
    } catch (err) {
      if (err instanceof ParseError) {
        throw new Error(`${where}: ${err.code}: ${err.message}`);
      }
      throw err;
    }
    if (parsed === null) {
      continue;
    }
    const cd = table.get(parsed.directive);
    if (cd === undefined) {
      /* parseLine already resolved the directive, so this cannot happen. */
      throw new Error(`${where}: unregistered directive "${parsed.directive}"`);
    }

    if (spec.recordStart !== null && parsed.directive === spec.recordStart) {
      current = new Node();
      records.push(current);
      lastInstance = new Map();
      seq = 0;
    }

    let root: Node;
    if (current !== null) {
      root = current;
    } else if (headerNode !== null && (spec.header ?? []).includes(parsed.directive)) {
      root = headerNode;
    } else {
      throw new Error(`${where}: directive "${parsed.directive}" before first record`);
    }

    const value = makeValue(cd, parsed.values);

    /* Resolve the attachment target. */
    let target = root;
    if (cd.def.childOf !== undefined) {
      let best: Instance | null = null;
      for (const parent of cd.def.childOf) {
        const inst = lastInstance.get(parent);
        if (inst !== undefined && (best === null || inst.seq > best.seq)) {
          best = inst;
        }
      }
      if (best !== null) {
        target = best.node;
      } else if (cd.def.requireParent === true) {
        throw new Error(
          `${where}: MISSING_RECORD_HEADER: "${parsed.directive}" before any ` +
            `${cd.def.childOf.join(" / ")}`,
        );
      }
    }

    if (cd.def.repeat === true) {
      const slot = target.children.get(parsed.directive);
      const occurrence = slot === undefined ? 0 : Array.isArray(slot) ? slot.length : 0;
      if (slot === undefined) {
        target.children.set(parsed.directive, [value]);
      } else if (Array.isArray(slot)) {
        slot.push(value);
      } else {
        throw new Error(`${where}: repeat directive "${parsed.directive}" collided with a single value`);
      }
      if (cd.def.orderKey !== undefined) {
        const order = target.orderGroups.get(cd.def.orderKey) ?? [];
        order.push(`${parsed.directive}:${occurrence}`);
        target.orderGroups.set(cd.def.orderKey, order);
      }
    } else {
      if (target.children.has(parsed.directive) && cd.def.lastWins !== true) {
        throw new Error(
          `${where}: duplicate directive "${parsed.directive}" (not marked repeat in the spec)`,
        );
      }
      target.children.set(parsed.directive, value);
    }

    if (value instanceof Node) {
      lastInstance.set(parsed.directive, { node: value, seq: ++seq });
    }
  }

  const finalized = records.map((r) => finalizeNode(r, spec, table));
  const source = `lib/gamedata/${spec.name}.txt`;
  if (headerNode !== null && headerNode.children.size > 0) {
    return {
      file: spec.name,
      source,
      header: finalizeNode(headerNode, spec, table),
      records: finalized,
    };
  }
  return { file: spec.name, source, records: finalized };
}
