/**
 * process_pref_file_expr, ported from reference/src/ui-prefs.c L453-575
 * (Angband 4.2.6): the prefix-expression language behind a pref file's `?:`
 * lines, which is how one .prf file carries per-race, per-class and per-frontend
 * variants of the same directive.
 *
 * This is the SHARED evaluator. It has to be shared because the port has two
 * pref parsers - prefs.ts (the general x_attr/x_char + keymap/colour surface)
 * and tile-prefs.ts (the graphics TileMap) - and upstream has exactly one
 * expression evaluator serving both. A second copy is how the graphics parser
 * came to have no `?:` support at all while the other parser had a version that
 * could not read a nested bracket; see the note on evaluate() below.
 *
 * Faithfulness notes, because two of these look like bugs and are not:
 *
 * - The variables are SYS, RACE and CLASS. That is the whole set (L553-560).
 *   In particular there is no GENDER: the string "GENDER" does not occur
 *   anywhere in reference/src, so every `[EQU $GENDER Female]` line in the
 *   shipped xtra-*.prf files - 66 of them - evaluates unknown, compares unequal,
 *   and is bypassed. Upstream has never drawn a female player tile from those
 *   files. Core keeps the wart; a mod may fix it.
 * - LEQ and GEQ are STRICT despite their names. Upstream sets the result to "0"
 *   when `strcmp(p, t) >= 0` (LEQ) or `<= 0` (GEQ), so `[LEQ 5 5]` is FALSE.
 *
 * An unknown variable, an unknown connective, and an empty expression all yield
 * "?o?o?"; an unterminated bracket yields "?x?x?". Both are non-"0", so the
 * caller does NOT bypass - upstream's fail-open behaviour, which is why a pref
 * file written for a newer game still applies most of its lines here.
 */

/** The `$VAR` values a `?:` line can test. Upstream's set, and only it. */
export interface PrefExprVars {
  /** ANGBAND_SYS: the front-end module's name (init.c L84, main.c L508). */
  SYS?: string;
  /** player->race->name, e.g. "Half-Troll". */
  RACE?: string;
  /** player->class->name, e.g. "Ranger". */
  CLASS?: string;
}

/** The value an unknown variable, unknown connective or empty expression takes. */
export const PREF_EXPR_UNKNOWN = "?o?o?";
/** The value an unterminated `[` takes. */
export const PREF_EXPR_MALFORMED = "?x?x?";

/** isspace(), for the leading-space skip. */
function isSpace(c: string): boolean {
  return c === " " || c === "\t" || c === "\n" || c === "\v" || c === "\f" || c === "\r";
}

/**
 * isprint() in the C locale: the token scan stops at anything else, so a byte
 * >= 0x7F ends a token exactly as it does upstream.
 */
function isPrint(c: string): boolean {
  const n = c.charCodeAt(0);
  return n >= 0x20 && n < 0x7f;
}

/** strcmp's sign, for LEQ/GEQ (upstream compares bytes, not numbers). */
function strcmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

interface Frame {
  /** The expression's value. */
  value: string;
  /** Upstream's `f`: the character that ended this token, "" for '\0'. */
  final: string;
  /** The index just past what was consumed. */
  next: number;
}

/**
 * One recursive step of process_pref_file_expr.
 *
 * Upstream walks a mutable buffer and terminates each token in place; this walks
 * an index instead, which is exactly equivalent because `s` only ever moves
 * forward and no position is read twice. The `f` out-parameter is carried in the
 * return value.
 */
function step(src: string, from: number, vars: PrefExprVars): Frame {
  let i = from;
  while (i < src.length && isSpace(src[i]!)) i++;
  const b = i;
  let value = PREF_EXPR_UNKNOWN;
  let final = "";

  if (src[i] === "[") {
    i++;
    let r = step(src, i, vars);
    i = r.next;
    final = r.final;
    let t = r.value;
    /* `*s && (f != ']')`: there is input left and the bracket has not closed. */
    const more = (): boolean => i < src.length && final !== "]";
    const nextTok = (): string => {
      r = step(src, i, vars);
      i = r.next;
      final = r.final;
      return r.value;
    };

    if (t.length === 0) {
      /* "Nothing" - the value stays unknown (L487-488). */
    } else if (t === "IOR") {
      value = "0";
      while (more()) {
        t = nextTok();
        if (t.length > 0 && t !== "0") value = "1";
      }
    } else if (t === "AND") {
      value = "1";
      while (more()) {
        t = nextTok();
        if (t.length > 0 && t === "0") value = "0";
      }
    } else if (t === "NOT") {
      value = "1";
      while (more()) {
        t = nextTok();
        if (t.length > 0 && t !== "0") value = "0";
      }
    } else if (t === "EQU" || t === "LEQ" || t === "GEQ") {
      const op = t;
      value = "1";
      /* The first operand is fetched outside the loop, then each subsequent one
       * is compared against its PREDECESSOR, not against the first (L505-532). */
      if (more()) t = nextTok();
      while (more()) {
        const p = t;
        t = nextTok();
        if (t.length === 0) continue;
        const c = strcmp(p, t);
        /* LEQ/GEQ are STRICT: upstream zeroes the result on `>= 0` and `<= 0`. */
        const fails = op === "EQU" ? c !== 0 : op === "LEQ" ? c >= 0 : c <= 0;
        if (fails) value = "0";
      }
    } else {
      /* An unknown connective: consume the bracket and stay unknown (L534-538). */
      while (more()) nextTok();
    }

    if (final !== "]") value = PREF_EXPR_MALFORMED;
    final = i < src.length ? src[i]! : "";
    if (final !== "") i++;
  } else {
    while (i < src.length && isPrint(src[i]!) && " []".indexOf(src[i]!) < 0) i++;
    const tok = src.slice(b, i);
    final = i < src.length ? src[i]! : "";
    if (final !== "") i++;
    if (tok.startsWith("$")) {
      /* L553-560: three variables, and an unrecognised one keeps the default. */
      const name = tok.slice(1);
      const v = name === "SYS" ? vars.SYS : name === "RACE" ? vars.RACE : name === "CLASS" ? vars.CLASS : undefined;
      if (v !== undefined) value = v;
    } else {
      value = tok;
    }
  }

  return { value, final, next: i };
}

/**
 * Evaluate a `?:` expression to upstream's string result. "0" is the only false
 * value; everything else - including "?o?o?" from an unknown variable - is true.
 *
 * The parser this replaced matched a single bracket level with a regular
 * expression, so `[AND [EQU $CLASS Mage] [EQU $RACE Elf]]` split into six bare
 * tokens, none of which was "0", and every AND came out TRUE. That is why the
 * shipped xtra-shb.prf's 132 `monster:<player>` lines all applied and the last
 * one won.
 */
export function evalPrefExpr(expr: string, vars: PrefExprVars = {}): string {
  return step(expr, 0, vars).value;
}

/** The `?` line's own question: does this expression bypass what follows? */
export function prefExprBypasses(expr: string, vars: PrefExprVars = {}): boolean {
  return evalPrefExpr(expr, vars) === "0";
}
