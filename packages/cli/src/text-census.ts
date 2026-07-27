/**
 * Upstream TEXT CENSUS: a mechanical detector for unported player-visible text.
 *
 * WHY THIS EXISTS
 * ---------------
 * Ten rounds of "read the C, port what is missing, declare parity" were each
 * followed by a play session that found more missing content. Reading code does
 * not find absent code reliably - a reviewer confirms what IS there and cannot
 * see the message that was never written. Every one of those play-session finds
 * had the same shape: a string the C shows the player that the port never emits
 * (the level-up "Welcome to level %d.", the heavy-weapon warnings, the
 * blocked-by-rubble messages).
 *
 * So this does not read code. It enumerates every string literal the C hands to
 * a player-facing call and asks one mechanical question: does that text appear
 * anywhere in the port at all? A miss is either a real gap or an entry in
 * `KNOWN_ABSENT` with a reason. Nothing may be silently absent.
 *
 * HOW IT MATCHES
 * --------------
 * A C literal is split on printf specifiers into ANCHORS - the literal runs a
 * player actually reads ("Welcome to level ", "You have trouble wielding such a
 * heavy bow."). Anchors shorter than MIN_ANCHOR are dropped as too generic to
 * search for. A call counts as PRESENT when every one of its anchors appears
 * somewhere in the port's source text.
 *
 * Comments are stripped from BOTH sides. On the C side so a commented-out or
 * documented message is not mistaken for a live one; on the port side because
 * a citation in a doc comment is exactly how a gap hides - `player-attack.c`'s
 * "The %s finds a mark." was named in a ranged-cmd.ts comment while the branch
 * that should emit it did not exist.
 *
 * WHAT IT CANNOT SEE
 * ------------------
 * Presence, not correctness: it proves the text exists somewhere in the port,
 * not that it fires on the right event, in the right order, with the right
 * message type. It also cannot see text the C builds entirely from data
 * (monster spell messages live in gamedata, not in a C literal). It is a floor
 * under the port's content, not a parity proof.
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/** One player-facing C call carrying a literal. */
export interface TextCall {
  /** Repo-relative C path, forward slashes (e.g. "reference/src/player.c"). */
  file: string;
  line: number;
  /** The C function (msg, msgt, get_check, ...). */
  fn: string;
  /** The literal as the C sees it, escapes resolved. */
  text: string;
  /** The searchable literal runs between printf specifiers. */
  anchors: string[];
}

/**
 * The C calls whose string argument is shown to a player. `skip` is how many
 * leading arguments come before the format string (msgt takes a message type
 * first). Deliberately excludes the diagnostic channels that never reach a
 * normal player: quit/plog/bell take developer text, and Term_putstr/prt draw
 * text whose literal is nearly always assembled by format() upstream.
 */
const CALLS: readonly { fn: string; skip: number }[] = [
  { fn: "msgt", skip: 1 },
  { fn: "msg", skip: 0 },
  { fn: "get_check", skip: 0 },
  { fn: "textui_get_check", skip: 0 },
  { fn: "get_string", skip: 0 },
  { fn: "get_quantity", skip: 0 },
];

/**
 * Anchors shorter than this are dropped: "The", "You", " (%d)" and friends match
 * everywhere and would make the census meaningless. Long enough to be a phrase,
 * short enough to keep "Cancelled." and "Are you sure? ".
 */
const MIN_ANCHOR = 8;

/** printf specifiers, which split a literal into its anchors. */
const SPEC =
  /%[-+ #0]*[\d*]*(?:\.[\d*]+)?(?:hh|h|ll|l|L|z|j|t)?[diouxXeEfgGaAcspn%]/gu;

/**
 * C source files that are not part of the game a player runs, so the text in
 * them is out of scope by construction rather than by judgement:
 * - `tests/` is upstream's own unit-test tree.
 * - `main-*.c` / `snd-*.c` are per-platform front ends (SDL2, Windows, curses);
 *   the port's front end is packages/web and owes them no text.
 * - `borg/` is the autoplayer's own debug console (borg_commands' grid dumps,
 *   power readouts, "Borg Version: %s"). The Borg ships as a MOD and is out of
 *   the parity gate until the port itself is complete, so its ~56 developer
 *   readouts would swamp the signal here. packages/borg has its own tests.
 */
function inScope(rel: string): boolean {
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

/**
 * Blank out comments, preserving offsets and line structure so reported line
 * numbers stay true. Handles both languages: `//`, `/* *\/`, and (for the port)
 * quotes plus template literals, so a `//` inside a string is left alone.
 */
export function stripComments(src: string): string {
  const out = src.split("");
  let i = 0;
  const blank = (from: number, to: number): void => {
    for (let k = from; k < to; k++) if (out[k] !== "\n") out[k] = " ";
  };
  while (i < src.length) {
    const c = src[i];
    if (c === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      const end = nl === -1 ? src.length : nl;
      blank(i, end);
      i = end;
    } else if (c === "/" && src[i + 1] === "*") {
      const close = src.indexOf("*/", i + 2);
      const end = close === -1 ? src.length : close + 2;
      blank(i, end);
      i = end;
    } else if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i++;
      while (i < src.length && src[i] !== quote) {
        if (src[i] === "\\") i++;
        else if (src[i] === "\n" && quote !== "`") break; // unterminated
        i++;
      }
      i++;
    } else {
      i++;
    }
  }
  return out.join("");
}

/**
 * Read a C string literal starting at `i` (which must be the opening quote),
 * following adjacent-literal concatenation so a message split across source
 * lines comes back as the one string the player sees.
 */
function readLiteral(src: string, i: number): { text: string; end: number } {
  let text = "";
  for (;;) {
    while (i < src.length && /\s/u.test(src[i] ?? "")) i++;
    if (src[i] !== '"') break;
    i++;
    while (i < src.length && src[i] !== '"') {
      if (src[i] === "\\") {
        const c = src[i + 1];
        text +=
          c === "n" ? "\n" : c === "t" ? "\t" : c === "0" ? "" : (c ?? "");
        i += 2;
      } else {
        text += src[i];
        i++;
      }
    }
    i++;
  }
  return { text, end: i };
}

/** Skip `n` comma-separated arguments from `i`; -1 if the call ends first. */
function skipArgs(src: string, i: number, n: number): number {
  let depth = 0;
  let seen = 0;
  for (; i < src.length; i++) {
    const c = src[i];
    if (c === "(" || c === "[") depth++;
    else if (c === ")" || c === "]") {
      if (depth === 0) return -1;
      depth--;
    } else if (c === '"') {
      i = readLiteral(src, i).end - 1;
    } else if (c === "," && depth === 0) {
      if (++seen === n) return i + 1;
    }
  }
  return -1;
}

/** The searchable literal runs of a C format string. */
export function anchorsOf(text: string): string[] {
  return text
    .split(SPEC)
    .map((s) => s.replace(/\s+/gu, " ").trim())
    .filter((s) => s.length >= MIN_ANCHOR);
}

/** Every player-facing literal in the C tree, in file order. */
export function extractUpstreamText(root: string): TextCall[] {
  const refDir = join(root, "reference", "src");
  const calls: TextCall[] = [];
  for (const file of walk(refDir)) {
    const rel = relative(root, file).split(sep).join("/");
    if (!inScope(rel)) continue;
    const src = stripComments(readFileSync(file, "utf8"));
    // Line offsets once per file rather than a slice+split per hit.
    const lineAt = (idx: number): number => {
      let line = 1;
      for (let k = 0; k < idx; k++) if (src[k] === "\n") line++;
      return line;
    };
    for (const { fn, skip } of CALLS) {
      const re = new RegExp(String.raw`(^|[^\w])${fn}\s*\(`, "gu");
      let m: RegExpExecArray | null;
      while ((m = re.exec(src)) !== null) {
        let i = m.index + m[0].length;
        if (skip > 0) {
          i = skipArgs(src, i, skip);
          if (i < 0) continue;
        }
        while (i < src.length && /\s/u.test(src[i] ?? "")) i++;
        if (src[i] !== '"') continue;
        const { text } = readLiteral(src, i);
        if (!text) continue;
        const anchors = anchorsOf(text);
        if (anchors.length === 0) continue;
        calls.push({ file: rel, line: lineAt(m.index), fn, text, anchors });
      }
    }
  }
  return calls;
}

/**
 * Everything a player-visible string could legitimately live in: package
 * sources, the bundled mods, and the compiled gamedata. Tests are excluded on
 * purpose - a message that exists only in its own test is not shipped text.
 * Comments are stripped so a citation cannot stand in for an implementation.
 */
export function portHaystack(root: string): string {
  const parts: string[] = [];
  const add = (dir: string, exts: RegExp): void => {
    let files: string[];
    try {
      files = walk(dir);
    } catch {
      return; // optional tree (e.g. an unbuilt package)
    }
    for (const f of files) {
      if (!exts.test(f)) continue;
      if (/\.test\.[cm]?tsx?$/u.test(f)) continue;
      const src = readFileSync(f, "utf8");
      parts.push(/\.(?:json|txt)$/u.test(f) ? src : stripComments(src));
    }
  };
  for (const pkg of readdirSync(join(root, "packages"))) {
    add(join(root, "packages", pkg, "src"), /\.(?:ts|tsx|json)$/u);
  }
  add(join(root, "packages", "web", "mods"), /\.(?:ts|json)$/u);
  add(join(root, "packages", "content", "data"), /\.(?:json|txt)$/u);
  // " " so a phrase cannot accidentally straddle two files.
  return parts.join("\n \n");
}

/** A call whose text the port does not contain, with the anchors that missed. */
export interface Missing extends TextCall {
  absent: string[];
}

/**
 * The census: every distinct C literal whose text the port does not contain.
 * Deduplicated by literal, since upstream emits some messages from several
 * sites and one absence is one gap.
 */
export function census(calls: readonly TextCall[], haystack: string): Missing[] {
  const missing: Missing[] = [];
  const seen = new Set<string>();
  for (const call of calls) {
    const absent = call.anchors.filter((a) => !haystack.includes(a));
    if (absent.length === 0) continue;
    if (seen.has(call.text)) continue;
    seen.add(call.text);
    missing.push({ ...call, absent });
  }
  return missing;
}

/** Run the whole census against a repo root. */
export function runCensus(root: string): {
  calls: TextCall[];
  missing: Missing[];
} {
  const calls = extractUpstreamText(root);
  return { calls, missing: census(calls, portHaystack(root)) };
}
