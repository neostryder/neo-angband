/**
 * Independent gamedata re-parser for W5 data-exactness.
 *
 * Deliberately does NOT import packages/content's parseLine / compileGamedata.
 * Line-level semantics follow reference/src/parser.c (Angband 4.2.6);
 * record assembly follows the C init parsers' attach/repeat idioms as
 * documented in reference/src/{parser,parse,init,mon-init,obj-init}.c.
 *
 * Format registration data (parser_reg format strings + which directives
 * repeat / nest) is supplied by the caller so this module stays free of
 * packages/content's parser implementation. Because that metadata is itself
 * port-supplied, extractParserRegFormats() below lets the caller check the
 * format strings back against reference/src/*.c rather than trusting them.
 */

export type FieldType = "int" | "uint" | "sym" | "str" | "char" | "rand";

export interface FieldSpec {
  readonly type: FieldType;
  readonly name: string;
  readonly optional: boolean;
}

export interface DirectiveSignature {
  readonly directive: string;
  readonly fields: readonly FieldSpec[];
}

export interface DirectiveDef {
  readonly fmt: string;
  readonly repeat?: boolean;
  readonly childOf?: readonly string[];
  /**
   * Synthetic key that records the file order of a cross-directive repeat
   * group. C keeps such groups in one linked list (e.g. monster_drop, built by
   * prepending in parse_monster_drop / parse_monster_drop_base), so splitting
   * them into per-directive arrays would lose the interleaving. There is no
   * upstream directive of this name; the key is generated, and every generated
   * key must be declared here so the coverage guard can see it.
   */
  readonly orderKey?: string;
  /**
   * Fold this directive's occurrences into ONE ordered array shared with
   * every other directive naming the same key, each entry tagged
   * `kind: <directive name>`, instead of a per-directive array. Mirrors
   * records.ts's DirectiveDef.mergeInto exactly, so the independent re-parse
   * produces the same shape the compiler does.
   */
  readonly mergeInto?: string;
}

export interface FileSpec {
  readonly name: string;
  readonly recordStart: string | null;
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

const FIELD_TYPES: ReadonlySet<string> = new Set([
  "int",
  "uint",
  "sym",
  "str",
  "char",
  "rand",
]);

/** C isspace() (default "C" locale). */
function isSpace(code: number): boolean {
  return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0b || code === 0x0c || code === 0x0d;
}

function digitOf(ch: string, base: number): number | null {
  const c = ch.charCodeAt(0);
  let v: number;
  if (c >= 0x30 && c <= 0x39) v = c - 0x30;
  else if (c >= 0x41 && c <= 0x5a) v = c - 0x41 + 10;
  else if (c >= 0x61 && c <= 0x7a) v = c - 0x61 + 10;
  else return null;
  return v < base ? v : null;
}

/**
 * strtol(_, _, 0)-style scan: optional sign, 0x/0 base inference, trailing
 * garbage ignored (endptr not required to hit EOS).
 */
function scanInt(s: string, allowNegative: boolean): number | null {
  let i = 0;
  while (i < s.length && isSpace(s.charCodeAt(i))) i++;
  let neg = false;
  if (s[i] === "+" || s[i] === "-") {
    if (s[i] === "-") {
      if (!allowNegative) return null;
      neg = true;
    }
    i++;
  }
  let base = 10;
  if (s[i] === "0") {
    const n = s[i + 1];
    if ((n === "x" || n === "X") && s[i + 2] !== undefined && digitOf(s[i + 2]!, 16) !== null) {
      base = 16;
      i += 2;
    } else {
      base = 8;
    }
  }
  const start = i;
  let value = 0;
  while (i < s.length) {
    const d = digitOf(s[i]!, base);
    if (d === null) break;
    value = value * base + d;
    i++;
  }
  if (i === start) return null;
  return neg ? -value : value;
}

/**
 * Faithful reimplementation of parse_random() from reference/src/parser.c.
 * Validity only; the raw dice string is what gets stored.
 */
export function independentIsValidRandom(s: string): boolean {
  let pos = 0;
  let i = 0;
  let minI = 1;
  if (s[0] === "-") pos++;
  for (;;) {
    const c = s[pos];
    if (c === "d") {
      if (i > 2) return false;
      if (i < 2) i = 2;
      minI = 3;
      pos++;
    } else if (c === "M") {
      if (i === 2) return false;
      i = 3;
      minI = 4;
      pos++;
    } else {
      // scan base-10 number without base0 (upstream parse_random uses base 10)
      let p = pos;
      while (p < s.length && isSpace(s.charCodeAt(p))) p++;
      let negative = false;
      if (s[p] === "+" || s[p] === "-") {
        negative = s[p] === "-";
        p++;
      }
      const digStart = p;
      let value = 0;
      while (p < s.length) {
        const d = digitOf(s[p]!, 10);
        if (d === null) break;
        value = value * 10 + d;
        p++;
      }
      if (p === digStart) {
        let t = pos;
        while (t < s.length && isSpace(s.charCodeAt(t))) t++;
        return t >= s.length && i >= minI;
      }
      if (value > 2147483647 || (negative && value !== 0) || s[pos] === "+") {
        return false;
      }
      pos = p;
      if (i === 0) {
        if (s[pos] === "d") i = 1;
        else if (s[pos] === "+") {
          pos++;
          minI = 3;
        } else {
          let t = pos;
          while (t < s.length && isSpace(s.charCodeAt(t))) t++;
          if (t < s.length) return false;
          break;
        }
      } else if (i === 4) {
        return false;
      }
      i++;
    }
  }
  return true;
}

export function independentParseSignature(fmt: string): DirectiveSignature {
  const tokens = fmt.split(/\s+/).filter((t) => t.length > 0);
  const directive = tokens.shift();
  if (directive === undefined) throw new Error(`empty format string`);
  const fields: FieldSpec[] = [];
  while (tokens.length > 0) {
    const rawType = tokens.shift()!;
    const name = tokens.shift();
    if (name === undefined) throw new Error(`type without name in "${fmt}"`);
    const optional = rawType.startsWith("?");
    const typeName = optional ? rawType.slice(1) : rawType;
    if (!FIELD_TYPES.has(typeName)) throw new Error(`unknown type "${rawType}" in "${fmt}"`);
    const prev = fields[fields.length - 1];
    if (prev !== undefined) {
      if (!optional && prev.optional) throw new Error(`mandatory after optional in "${fmt}"`);
      if (prev.type === "str") throw new Error(`field after str in "${fmt}"`);
    }
    fields.push({ type: typeName as FieldType, name, optional });
  }
  return { directive, fields };
}

interface LineValues {
  directive: string;
  values: Record<string, string | number>;
}

/**
 * Parse one physical line. Returns null for blanks/comments.
 * Tokenizer mirrors strtok(":") for non-str/char and rest-of-line for str.
 */
export function independentParseLine(
  line: string,
  lookup: (directive: string) => DirectiveSignature | undefined,
): LineValues | null {
  let start = 0;
  while (start < line.length && isSpace(line.charCodeAt(start))) start++;
  if (start >= line.length || line[start] === "#") return null;

  // Cursor over the trimmed line body.
  let pos = start;

  const nextToken = (): string | null => {
    while (pos < line.length && line[pos] === ":") pos++;
    if (pos >= line.length) return null;
    const a = pos;
    while (pos < line.length && line[pos] !== ":") pos++;
    const tok = line.slice(a, pos);
    if (pos < line.length) pos++; // consume ':'
    return tok;
  };

  const rest = (): string | null => {
    if (pos >= line.length) return null;
    const tok = line.slice(pos);
    pos = line.length;
    return tok;
  };

  const takeChar = (): string | null => {
    if (pos >= line.length) return null;
    const cp = line.codePointAt(pos)!;
    const ch = String.fromCodePoint(cp);
    pos += ch.length;
    if (pos < line.length) {
      if (line[pos] === ":") pos++;
      else throw new Error(`FIELD_TOO_LONG`);
    }
    return ch;
  };

  const directiveTok = nextToken();
  if (directiveTok === null) throw new Error("MISSING_FIELD: directive");
  const sig = lookup(directiveTok);
  if (sig === undefined) throw new Error(`UNDEFINED_DIRECTIVE: ${directiveTok}`);

  const values: Record<string, string | number> = {};
  for (const field of sig.fields) {
    let tok: string | null;
    if (field.type === "char") tok = takeChar();
    else if (field.type === "str") tok = rest();
    else tok = nextToken();

    if (tok === null) {
      if (!field.optional) throw new Error(`MISSING_FIELD: ${field.name}`);
      break;
    }
    if (field.type === "int") {
      const n = scanInt(tok, true);
      if (n === null) throw new Error(`NOT_NUMBER: ${field.name}`);
      values[field.name] = n;
    } else if (field.type === "uint") {
      if (tok[0] === "-") throw new Error(`NOT_NUMBER: ${field.name}`);
      const n = scanInt(tok, false);
      if (n === null) throw new Error(`NOT_NUMBER: ${field.name}`);
      values[field.name] = n;
    } else if (field.type === "rand") {
      if (!independentIsValidRandom(tok)) throw new Error(`NOT_RANDOM: ${field.name}`);
      values[field.name] = tok;
    } else {
      values[field.name] = tok;
    }
  }
  return { directive: sig.directive, values };
}

/** Split a flags: payload the way C does: strtok(flags, " |"). */
export function splitFlagList(raw: string): string[] {
  const out: string[] = [];
  let i = 0;
  while (i < raw.length) {
    while (i < raw.length && (raw[i] === " " || raw[i] === "|")) i++;
    if (i >= raw.length) break;
    const a = i;
    while (i < raw.length && raw[i] !== " " && raw[i] !== "|") i++;
    out.push(raw.slice(a, i));
  }
  return out;
}

/**
 * A directive's compiled value. Deliberately excludes arrays so that
 * Array.isArray() narrows a slot to "repeated" vs "single" unambiguously.
 */
type Value = JsonPrimitive | JsonObject | Container;
type Slot = Value | Value[];

class Container {
  fields: Array<[string, JsonPrimitive]> = [];
  children = new Map<string, Slot>();
  orderGroups = new Map<string, string[]>();
  unions = new Map<string, JsonObject[]>();
}

interface CompiledDirective {
  def: DirectiveDef;
  sig: DirectiveSignature;
  isContainer: boolean;
}

function buildTable(spec: FileSpec): Map<string, CompiledDirective> {
  const parents = new Set<string>();
  for (const def of spec.directives) {
    for (const p of def.childOf ?? []) parents.add(p);
  }
  const table = new Map<string, CompiledDirective>();
  for (const def of spec.directives) {
    const sig = independentParseSignature(def.fmt);
    if (table.has(sig.directive)) {
      throw new Error(`${spec.name}: duplicate directive "${sig.directive}"`);
    }
    table.set(sig.directive, { def, sig, isContainer: parents.has(sig.directive) });
  }
  return table;
}

function makeValue(cd: CompiledDirective, values: Record<string, string | number>): Value {
  const entries: Array<[string, JsonPrimitive]> = [];
  for (const field of cd.sig.fields) {
    const v = values[field.name];
    if (v !== undefined) entries.push([field.name, v]);
  }
  if (cd.isContainer) {
    const node = new Container();
    node.fields.push(...entries);
    return node;
  }
  if (cd.def.mergeInto === undefined && cd.sig.fields.length === 1) {
    const only = entries[0];
    return only === undefined ? true : only[1];
  }
  const obj: JsonObject = {};
  for (const [k, v] of entries) obj[k] = v;
  return obj;
}

function finalize(slot: Value, spec: FileSpec): JsonValue {
  if (!(slot instanceof Container)) return slot;
  const out: JsonObject = {};
  for (const [k, v] of slot.fields) out[k] = v;
  // Emit children in registration order (upstream registration order). A
  // mergeInto directive emits its shared array once, at the first directive
  // that feeds it - mirrors records.ts's finalizeNode exactly.
  const emittedUnions = new Set<string>();
  for (const def of spec.directives) {
    const directive = def.fmt.split(/\s+/, 1)[0]!;
    if (def.mergeInto !== undefined) {
      if (emittedUnions.has(def.mergeInto)) continue;
      emittedUnions.add(def.mergeInto);
      const list = slot.unions.get(def.mergeInto);
      if (list !== undefined) out[def.mergeInto] = list.map((v) => ({ ...v }));
      continue;
    }
    const child = slot.children.get(directive);
    if (child === undefined) continue;
    out[directive] = Array.isArray(child)
      ? child.map((c) => finalize(c, spec))
      : finalize(child, spec);
  }
  for (const [key, order] of slot.orderGroups) out[key] = [...order];
  return out;
}

/**
 * Compile one gamedata file text into the same JSON shape as pack/*.json.
 * Engine is independent of packages/content/src/{parser,records}.ts.
 */
export function independentCompile(text: string, spec: FileSpec): CompiledFile {
  const table = buildTable(spec);
  const lookup = (d: string) => table.get(d)?.sig;

  const records: Container[] = [];
  const headerNode = spec.header !== undefined ? new Container() : null;
  let current: Container | null = null;
  if (spec.recordStart === null) {
    current = new Container();
    records.push(current);
  }

  // Most-recent container instances for childOf resolution.
  const lastOf = new Map<string, { node: Container; seq: number }>();
  let seq = 0;

  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    let raw = lines[i] ?? "";
    if (raw.endsWith("\r")) raw = raw.slice(0, -1);
    if (i === 0 && raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    const where = `${spec.name}.txt:${i + 1}`;
    let parsed: LineValues | null;
    try {
      parsed = independentParseLine(raw, lookup);
    } catch (err) {
      throw new Error(`${where}: ${err instanceof Error ? err.message : String(err)}`, {
        cause: err,
      });
    }
    if (parsed === null) continue;
    const cd = table.get(parsed.directive);
    if (cd === undefined) throw new Error(`${where}: unregistered "${parsed.directive}"`);

    if (spec.recordStart !== null && parsed.directive === spec.recordStart) {
      current = new Container();
      records.push(current);
      lastOf.clear();
      seq = 0;
    }

    let root: Container;
    if (current !== null) root = current;
    else if (headerNode !== null && (spec.header ?? []).includes(parsed.directive)) root = headerNode;
    else throw new Error(`${where}: directive "${parsed.directive}" before first record`);

    const value = makeValue(cd, parsed.values);

    let target = root;
    if (cd.def.childOf !== undefined) {
      let best: { node: Container; seq: number } | null = null;
      for (const parent of cd.def.childOf) {
        const inst = lastOf.get(parent);
        if (inst !== undefined && (best === null || inst.seq > best.seq)) best = inst;
      }
      if (best !== null) target = best.node;
    }

    if (cd.def.mergeInto !== undefined) {
      if (value instanceof Container) {
        throw new Error(`${where}: mergeInto directive "${parsed.directive}" cannot be a container`);
      }
      const tagged: JsonObject =
        typeof value === "object" && value !== null
          ? { kind: parsed.directive, ...value }
          : { kind: parsed.directive, value };
      const list = target.unions.get(cd.def.mergeInto) ?? [];
      list.push(tagged);
      target.unions.set(cd.def.mergeInto, list);
    } else if (cd.def.repeat === true) {
      const existing = target.children.get(parsed.directive);
      const occurrence = Array.isArray(existing) ? existing.length : 0;
      if (existing === undefined) target.children.set(parsed.directive, [value]);
      else if (Array.isArray(existing)) existing.push(value);
      else throw new Error(`${where}: repeat collision on "${parsed.directive}"`);
      if (cd.def.orderKey !== undefined) {
        const order = target.orderGroups.get(cd.def.orderKey) ?? [];
        order.push(`${parsed.directive}:${occurrence}`);
        target.orderGroups.set(cd.def.orderKey, order);
      }
    } else {
      if (target.children.has(parsed.directive)) {
        throw new Error(`${where}: duplicate "${parsed.directive}" (not marked repeat)`);
      }
      target.children.set(parsed.directive, value);
    }

    if (value instanceof Container) {
      lastOf.set(parsed.directive, { node: value, seq: ++seq });
    }
  }

  const finalized = records.map((r) => finalize(r, spec) as JsonObject);
  const source = `lib/gamedata/${spec.name}.txt`;
  if (headerNode !== null && headerNode.children.size > 0) {
    return {
      file: spec.name,
      source,
      header: finalize(headerNode, spec) as JsonObject,
      records: finalized,
    };
  }
  return { file: spec.name, source, records: finalized };
}

/**
 * The directive of every data line in a gamedata file, in file order.
 *
 * Mirrors the front of parser_parse(): skip leading isspace, drop blank and '#'
 * lines, then take the first strtok(line, ":") token (strtok skips a run of
 * leading delimiters). Deliberately does no field parsing, so it is an
 * independent check on the record splitter and the directive table.
 */
export function extractDirectiveSequence(text: string): string[] {
  const out: string[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    let raw = lines[i] ?? "";
    if (raw.endsWith("\r")) raw = raw.slice(0, -1);
    if (i === 0 && raw.charCodeAt(0) === 0xfeff) raw = raw.slice(1);
    let pos = 0;
    while (pos < raw.length && isSpace(raw.charCodeAt(pos))) pos++;
    if (pos >= raw.length || raw[pos] === "#") continue;
    while (pos < raw.length && raw[pos] === ":") pos++;
    if (pos >= raw.length) continue;
    const start = pos;
    while (pos < raw.length && raw[pos] !== ":") pos++;
    out.push(raw.slice(start, pos));
  }
  return out;
}

/** Every directive key that occurs in a gamedata file, with its line count. */
export function extractDirectiveKeys(text: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const key of extractDirectiveSequence(text)) {
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

/**
 * parse_specs() tokenizes the format string with strtok(fmt, " "), so runs of
 * whitespace collapse and leading/trailing whitespace is insignificant.
 */
export function normalizeFormat(fmt: string): string {
  return fmt.split(/\s+/).filter((t) => t.length > 0).join(" ");
}

/**
 * Every format string handed to parser_reg() in a C source file, normalized.
 *
 * Adjacent string literals are concatenated the way the C compiler does, so
 * registrations wrapped across source lines (e.g. init.c's melee-critical-level)
 * come back as the single format string parse_specs() actually sees.
 */
export function extractParserRegFormats(source: string): string[] {
  const out: string[] = [];
  const needle = "parser_reg(";
  let at = 0;
  for (;;) {
    const call = source.indexOf(needle, at);
    if (call < 0) break;
    at = call + needle.length;
    /* The format is the first string literal argument of the call. */
    let pos = at;
    while (pos < source.length && source[pos] !== '"' && source[pos] !== ";") pos++;
    if (source[pos] !== '"') continue;
    let fmt = "";
    for (;;) {
      pos++; /* past the opening quote */
      while (pos < source.length && source[pos] !== '"') {
        if (source[pos] === "\\") pos++;
        fmt += source[pos] ?? "";
        pos++;
      }
      pos++; /* past the closing quote */
      let peek = pos;
      while (peek < source.length && isSpace(source.charCodeAt(peek))) peek++;
      if (source[peek] !== '"') break;
      pos = peek;
    }
    out.push(normalizeFormat(fmt));
    at = pos;
  }
  return out;
}
