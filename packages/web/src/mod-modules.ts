/**
 * A mod's SCRIPTS - more than one of them - in a folder a browser tab was handed.
 *
 * The desktop build never needs this. There, a pack's files are served from the
 * shell's own loopback origin, so `plugin.js` has a real URL, `./lib/dice.js`
 * beside it resolves against that URL, and the browser fetches it like any other
 * module. Nothing to do.
 *
 * A folder the player PICKED in a browser tab has no location of any kind: it is a
 * set of FileSystemHandles, and the only way to hand one to `import()` is to wrap
 * its bytes in a blob: URL. A blob URL is opaque - it has no path component to
 * resolve against - so a relative specifier inside such a module points at nothing
 * and the import fails with "Failed to fetch dynamically imported module", naming
 * the entry file rather than the line at fault. That is the whole problem, and the
 * reason the first cut of the plugin loader said a folder plugin had to be bundled
 * into one file.
 *
 * "Bundle it first" is not an acceptable answer. A mod is data, images and scripts
 * in a folder; requiring a build step to ship one puts a toolchain between an
 * author and the game, and it would have been a limit of THIS module's first
 * implementation quietly reported as a limit of the browser.
 *
 * So the graph is resolved here: read the entry, find its relative specifiers,
 * build each dependency first, and rewrite the specifier to the dependency's blob
 * URL. Every module still loads as its own module - separate scope, live bindings,
 * `export`/`import` semantics intact - which is why this is a rewrite of specifiers
 * and not a concatenation. Concatenating would merge every file's top-level scope
 * and silently break any two that use the same name.
 *
 * WHAT THIS DOES NOT SUPPORT, stated rather than discovered:
 *
 *  - A CYCLE. ES modules allow them; blob URLs cannot express one, because a
 *    parent's text must be finished before its URL exists and a cycle needs both
 *    URLs at once. Reported by name, both files, so it reads as a fact about the
 *    mod rather than a mystery about the game.
 *  - An EXTENSIONLESS specifier ("./helper"). No browser has ever resolved one;
 *    that is a Node/bundler convenience. Reported with the fix, because an author
 *    who works in Node writes it by habit.
 *  - A specifier that leaves the pack folder. A mod may read its own files.
 *
 * A service worker serving the picked folder under a synthetic path would give
 * every file a real URL and make all of this unnecessary - no scanning, no cycle
 * limit. It was not taken: it needs a second build artifact, an activation the
 * first load has to wait for, and a scope that has to coexist with the PWA's own
 * worker, in exchange for a capability only a reduced front end is missing. If
 * this file ever stops being enough, that is the thing to build.
 */

/** One import/export specifier, and where its string literal sits in the source. */
export interface FoundSpecifier {
  /** The specifier text, unescaped. */
  readonly spec: string;
  /** Index of the opening quote. */
  readonly start: number;
  /** Index one past the closing quote. */
  readonly end: number;
}

type Token = { kind: "word" | "punct"; text: string };

const REGEX_OK_AFTER_WORD = new Set([
  "return",
  "typeof",
  "instanceof",
  "in",
  "of",
  "new",
  "delete",
  "void",
  "case",
  "do",
  "else",
  "yield",
  "await",
]);

/**
 * Every module specifier in a source file, in source order.
 *
 * The rule is deliberately narrow: a string literal counts as a specifier only
 * when the token immediately before it is the word `from`, or the word `import`,
 * or `import` followed by `(`. That is exactly the set of positions the grammar
 * puts a module specifier in, and it excludes the strings that look similar -
 * `export default "text"`, `const from = "./x.js"`, an object key spelled `from`.
 *
 * Comments, string literals, template literals and regex literals are skipped, so
 * a `from "./x"` inside any of them is not mistaken for code. Regex detection uses
 * the usual preceding-token heuristic, which is not a parser: the failure mode is a
 * rewritten specifier inside an exotic regex, and that shows up as a SyntaxError at
 * import time - loud, and reported - rather than as a wrong program.
 */
export function findSpecifiers(source: string): FoundSpecifier[] {
  const out: FoundSpecifier[] = [];
  /* The two most recent tokens; that is all the rule above needs. */
  let prev1: Token | null = null;
  let prev2: Token | null = null;
  const push = (t: Token): void => {
    prev2 = prev1;
    prev1 = t;
  };

  /* Template-literal nesting: a `${...}` holds CODE, which may itself hold a
   * template holding a string. Tracked as a stack of brace depths rather than a
   * boolean, or a nested `}` closes the wrong thing. */
  const template: number[] = [];
  let braces = 0;

  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i] as string;

    // -- comments -------------------------------------------------------
    if (ch === "/" && source[i + 1] === "/") {
      const nl = source.indexOf("\n", i);
      i = nl < 0 ? n : nl + 1;
      continue;
    }
    if (ch === "/" && source[i + 1] === "*") {
      const close = source.indexOf("*/", i + 2);
      i = close < 0 ? n : close + 2;
      continue;
    }

    // -- whitespace -----------------------------------------------------
    if (ch === " " || ch === "\t" || ch === "\r" || ch === "\n") {
      i++;
      continue;
    }

    // -- string literals: the only place a specifier can be -------------
    if (ch === '"' || ch === "'") {
      const lit = readString(source, i, ch);
      if (isSpecifierPosition(prev1, prev2)) {
        out.push({ spec: lit.value, start: i, end: lit.end });
      }
      i = lit.end;
      push({ kind: "punct", text: ch });
      continue;
    }

    // -- template literals ----------------------------------------------
    if (ch === "`") {
      i = skipTemplate(source, i, template, () => braces);
      push({ kind: "punct", text: "`" });
      continue;
    }
    if (ch === "$" && source[i + 1] === "{" && template.length > 0) {
      /* Entering a substitution: the body is code, so fall through to normal
       * scanning and remember the depth to return at. */
      template[template.length - 1] = braces;
      braces++;
      i += 2;
      push({ kind: "punct", text: "${" });
      continue;
    }

    // -- regex vs division ----------------------------------------------
    if (ch === "/") {
      if (regexAllowed(prev1)) {
        i = skipRegex(source, i);
        push({ kind: "punct", text: "/re/" });
      } else {
        i++;
        push({ kind: "punct", text: "/" });
      }
      continue;
    }

    // -- identifiers ----------------------------------------------------
    if (isWordStart(ch)) {
      let j = i + 1;
      while (j < n && isWordPart(source[j] as string)) j++;
      push({ kind: "word", text: source.slice(i, j) });
      i = j;
      continue;
    }

    // -- everything else -------------------------------------------------
    if (ch === "{") braces++;
    if (ch === "}") {
      braces--;
      const back = template[template.length - 1];
      if (template.length > 0 && back !== undefined && braces === back) {
        /* Closing a `${}`: resume the template's string part. */
        i = skipTemplate(source, i, template, () => braces, true);
        push({ kind: "punct", text: "`" });
        continue;
      }
    }
    push({ kind: "punct", text: ch });
    i++;
  }
  return out;
}

/** `from "x"`, `import "x"`, `import("x")` - and nothing else. */
function isSpecifierPosition(prev1: Token | null, prev2: Token | null): boolean {
  if (!prev1) return false;
  if (prev1.kind === "word" && (prev1.text === "from" || prev1.text === "import")) {
    return true;
  }
  return (
    prev1.kind === "punct" &&
    prev1.text === "(" &&
    prev2?.kind === "word" &&
    prev2.text === "import"
  );
}

function isWordStart(ch: string): boolean {
  return /[A-Za-z_$]/u.test(ch);
}

function isWordPart(ch: string): boolean {
  return /[A-Za-z0-9_$]/u.test(ch);
}

/** A `/` opens a regex unless the previous token could end an expression. */
function regexAllowed(prev1: Token | null): boolean {
  if (!prev1) return true;
  if (prev1.kind === "word") return REGEX_OK_AFTER_WORD.has(prev1.text);
  /* `)` and `]` end an expression, so `/` after them divides. `}` is genuinely
   * ambiguous (block end vs object literal); a block is far commoner, and a regex
   * right after an object literal is not a thing anyone writes. */
  return (
    prev1.text !== ")" &&
    prev1.text !== "]" &&
    prev1.text !== "/re/" &&
    prev1.text !== '"' &&
    prev1.text !== "'" &&
    prev1.text !== "`"
  );
}

function readString(
  source: string,
  at: number,
  quote: string,
): { value: string; end: number } {
  let i = at + 1;
  let value = "";
  while (i < source.length) {
    const ch = source[i] as string;
    if (ch === "\\") {
      /* Only the escapes a path can contain need decoding; anything else is
       * passed through, because a specifier with an exotic escape is not a path
       * this can resolve anyway and will be reported as missing. */
      const next = source[i + 1] ?? "";
      value += next === "n" ? "\n" : next === "t" ? "\t" : next;
      i += 2;
      continue;
    }
    if (ch === quote) return { value, end: i + 1 };
    if (ch === "\n") return { value, end: i }; // unterminated; let the engine complain
    value += ch;
    i++;
  }
  return { value, end: i };
}

/**
 * Skip a template literal from its backtick to its closing one, stopping early at
 * a `${` (whose body is code the caller must scan).
 */
function skipTemplate(
  source: string,
  at: number,
  stack: number[],
  braces: () => number,
  resuming = false,
): number {
  let i = at + 1;
  if (!resuming) stack.push(braces());
  while (i < source.length) {
    const ch = source[i] as string;
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "`") {
      stack.pop();
      return i + 1;
    }
    if (ch === "$" && source[i + 1] === "{") return i; // caller handles the code
    i++;
  }
  stack.pop();
  return i;
}

function skipRegex(source: string, at: number): number {
  let i = at + 1;
  let inClass = false;
  while (i < source.length) {
    const ch = source[i] as string;
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (ch === "\n") return i; // not a regex after all; stop rather than run away
    if (ch === "[") inClass = true;
    else if (ch === "]") inClass = false;
    else if (ch === "/" && !inClass) {
      i++;
      while (i < source.length && /[a-z]/u.test(source[i] as string)) i++; // flags
      return i;
    }
    i++;
  }
  return i;
}

/* ------------------------------------------------------------------ *
 * The graph.
 * ------------------------------------------------------------------ */

/** Whether a specifier is one this resolves (as opposed to a bare package name). */
export function isRelative(spec: string): boolean {
  return spec.startsWith("./") || spec.startsWith("../");
}

/**
 * Resolve a relative specifier against the importing file's path, both relative to
 * the pack root. Returns null when it would leave the pack.
 */
export function resolveModulePath(from: string, spec: string): string | null {
  const parts = from.split("/");
  parts.pop(); // the importing file itself
  for (const seg of spec.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length === 0) return null; // out of the pack
      parts.pop();
      continue;
    }
    parts.push(seg);
  }
  return parts.length > 0 ? parts.join("/") : null;
}

export interface ModuleGraphSource {
  /** One file's text by pack-relative path, or null when the pack has no such file. */
  read(path: string): Promise<string | null>;
  /** Turn a module's (rewritten) text into a URL `import()` will take. */
  urlFor(path: string, text: string): string;
}

export interface ModuleGraphResult {
  /** The entry module's URL, or null when the graph could not be built. */
  readonly url: string | null;
  /** Every URL created, so the caller can release them all. Entry included. */
  readonly urls: readonly string[];
  /** Pack-relative paths that made it into the graph, entry first. */
  readonly files: readonly string[];
  /** Why it could not be built, in one line an author can act on. */
  readonly problem: string | null;
}

/**
 * Wrap a module and every module it reaches, rewriting relative specifiers to the
 * URLs of the wrapped dependencies.
 *
 * Depth-first and post-order, because a parent's text cannot be finished until its
 * children have URLs. `urls` is returned even on failure: the modules built before
 * the bad one still hold blob URLs, and leaking them would pin a mod's whole source
 * in memory for the life of the document.
 */
export async function buildModuleGraph(
  entry: string,
  src: ModuleGraphSource,
): Promise<ModuleGraphResult> {
  const done = new Map<string, string>();
  const urls: string[] = [];
  const files: string[] = [];
  const stack: string[] = [];

  const build = async (path: string): Promise<string> => {
    const already = done.get(path);
    if (already !== undefined) return already;
    if (stack.includes(path)) {
      throw new Error(
        `${stack[stack.length - 1] ?? entry} and ${path} import each other. ` +
          `A folder mod's scripts are loaded as blob: URLs, and a cycle cannot be ` +
          `expressed as one - each file's address only exists once its text is final. ` +
          `Move the shared part into a third file that neither imports back.`,
      );
    }
    const text = await src.read(path);
    if (text === null) {
      throw new Error(
        /\.[a-z0-9]+$/iu.test(path)
          ? `${path} is imported but is not in the mod folder`
          : `${path} is imported but is not in the mod folder - a browser needs the ` +
            `file extension on a relative import ("./helper.js", not "./helper")`,
      );
    }
    stack.push(path);
    files.push(path);

    let out = "";
    let last = 0;
    for (const found of findSpecifiers(text)) {
      if (!isRelative(found.spec)) continue; // bare: left alone, see the header
      const dep = resolveModulePath(path, found.spec);
      if (dep === null) {
        throw new Error(
          `${path} imports "${found.spec}", which is outside the mod folder. ` +
            `A mod may only load its own files.`,
        );
      }
      const depUrl = await build(dep);
      out += text.slice(last, found.start) + JSON.stringify(depUrl);
      last = found.end;
    }
    out += text.slice(last);

    stack.pop();
    const url = src.urlFor(path, out);
    urls.push(url);
    done.set(path, url);
    return url;
  };

  try {
    const url = await build(entry);
    return { url, urls, files, problem: null };
  } catch (e) {
    return {
      url: null,
      urls,
      files,
      problem: e instanceof Error ? e.message : String(e),
    };
  }
}
