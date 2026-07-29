#!/usr/bin/env node
/**
 * private-scan - refuse to let private information reach a public commit.
 *
 * This repository is PUBLIC. A handful of things must never appear in it: the
 * maintainer's legal name, work email and employer, the private codenames of
 * other projects, and absolute paths that name the machine's user account. They
 * are easy to type by accident, because every one of them is a natural thing to
 * write in a commit message or a code comment while working.
 *
 * Two modes, deliberately different:
 *
 *   --staged   Scan what is about to be COMMITTED, reading the staged blobs
 *              rather than the working tree, so a partially-staged file is
 *              judged on the half that is actually going in. This is the
 *              pre-commit gate (.githooks/pre-commit).
 *   (default)  Scan every tracked file. This is the CI gate, and it catches
 *              anything that got in before the hook existed or around it with
 *              `--no-verify`. A hook alone is not a control; it is a courtesy.
 *
 * TWO RULE TIERS, because precision matters more than a big pattern list:
 *
 *   ALWAYS     Terms with no legitimate use in this repository at all. Any hit
 *              is a failure, wherever it is.
 *   BASELINED  Terms that ARE legitimate here in specific places - "Gandalf" is
 *              Angband's own default character name - and are private codenames
 *              everywhere else. These are checked against a recorded per-file
 *              count in private-scan-baseline.json.
 *
 * The baseline fails in BOTH directions: an unlisted hit fails, AND a listed
 * entry that no longer matches fails. A one-way allowlist rots silently - it
 * keeps passing long after the thing it excused is gone, and then excuses
 * something else that moved into the same slot.
 *
 * EXEMPT: reference/** is upstream Angband, vendored verbatim and never edited,
 * so the rule does not apply to it. This file and its baseline are exempt too,
 * for the obvious reason that they have to contain the patterns to test for
 * them. That is a real hole - private text hidden in tools/private-scan* would
 * not be caught - and it is stated rather than papered over with obfuscated
 * pattern-building, which would cost more in readability than it buys.
 *
 * Exit 0 clean, 1 on findings, 2 on a usage or git error.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = dirname(HERE);
const DEFAULT_BASELINE = join(HERE, "private-scan-baseline.json");

/**
 * Terms with no legitimate use anywhere in a public Angband port.
 *
 * `why` is printed with the finding: a scanner that only says "match" teaches
 * nobody what to write instead, and the next author reintroduces it.
 */
const ALWAYS = [
  {
    id: "legal-name",
    re: /\b(?:Aaron|Westover)\b/gi,
    why: "the maintainer's legal name - use the public handle 'neostryder' instead",
  },
  {
    id: "work-email",
    re: /aaron[._]westover|@gce\.com/gi,
    why: "the maintainer's work email address",
  },
  {
    id: "employer",
    // Case-sensitive: lowercase 'gce' occurs inside ordinary words.
    re: /\bGCE\b/g,
    why: "the maintainer's employer, which has nothing to do with this project",
  },
  {
    id: "codename-rpgm-forge",
    re: /\bRPGM[- ]Forge\b/gi,
    why: "a private project codename ('RPGM Tools' as an attribution is fine and expected)",
  },
  {
    id: "codename-one-plan",
    re: /\bOne Plan\b/g,
    why: "a private project codename",
  },
  {
    id: "codename-steward",
    re: /\bSteward\b/gi,
    why: "a private project codename",
  },
  {
    id: "private-workspace",
    re: /_neo-angband-private|ai-cli-toolkit/gi,
    why: "a path inside the private workspace, which must not be referenced from the public repo",
  },
];

/**
 * Terms that are legitimate in known places and private codenames elsewhere.
 * Every occurrence must be accounted for in the baseline, by file and count.
 */
const BASELINED = [
  {
    id: "user-home-path",
    /* Any absolute Windows or POSIX path that names a user account. Two real
     * leaks were found this way - a hardcoded sqlite3.exe under the machine's
     * profile, and a session-specific scratch directory - but INVENTED paths are
     * also perfectly good test fixtures ("/home/somebody/Games/x.AppImage"), so
     * this is baselined rather than banned. */
    re: /\b[A-Za-z]:[\\/]Users[\\/][^\\/\s"'`)\]]+|(?<![\w.])\/(?:home|Users)\/[^\s"'`)\]]+/g,
    why: "an absolute path naming a user account - use a repo-relative path, the OS temp dir, or an env var",
  },
  {
    id: "codename-gandalf",
    re: /\bGandalf\b/gi,
    why:
      "a private project codename - but ALSO upstream Angband content: a syllable in " +
      "names.txt:335 and the Staff of Gandalf's description in artifact.txt:872, both " +
      "of which the port mirrors. Legitimate uses are recorded per file in " +
      "tools/private-scan-baseline.json",
  },
];

/** reference/ is vendored upstream; the scanner and its baseline must self-exempt. */
const EXEMPT_PREFIXES = ["reference/", "tools/private-scan"];

/** Anything whose bytes are not text. Scanning these is noise, not signal. */
const BINARY_EXT =
  /\.(png|jpg|jpeg|gif|bmp|ico|webp|woff2?|ttf|otf|fon|wav|ogg|mp3|zip|gz|exe|dll|node|pdf|asar)$/i;

function git(args) {
  return execFileSync("git", args, {
    cwd: REPO,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
}

/** Tracked paths, or staged paths when gating a commit. */
function listFiles(staged) {
  const args = staged
    ? ["diff", "--cached", "--name-only", "--diff-filter=ACMR", "-z"]
    : ["ls-files", "-z"];
  return git(args)
    .split("\0")
    .filter(Boolean)
    .filter((p) => !EXEMPT_PREFIXES.some((x) => p.startsWith(x)))
    .filter((p) => !BINARY_EXT.test(p));
}

/**
 * The staged content, not the working tree. A file can be staged clean and dirty
 * in the tree (or the reverse), and the commit is what this gate is about.
 */
function readStaged(path) {
  try {
    return execFileSync("git", ["show", `:${path}`], {
      cwd: REPO,
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch {
    return null; // deleted, or a submodule entry
  }
}

/** --files: the path is taken as given, not resolved against the repo root. */
function readAbsolute(path) {
  if (!existsSync(path)) return null;
  try {
    return readFileSync(path, "utf8");
  } catch {
    return null;
  }
}

function readWorking(path) {
  const full = join(REPO, path);
  if (!existsSync(full)) return null;
  try {
    return readFileSync(full, "utf8");
  } catch {
    return null;
  }
}

/** Every rule hit in one file's text, with the line for the report. */
function scanText(path, text, rules) {
  const hits = [];
  const lines = text.split(/\r?\n/);
  for (const rule of rules) {
    lines.forEach((line, i) => {
      // Fresh lastIndex per line: a /g/ regex is stateful across .exec calls.
      rule.re.lastIndex = 0;
      let m;
      while ((m = rule.re.exec(line)) !== null) {
        hits.push({ rule: rule.id, why: rule.why, path, line: i + 1, text: line.trim(), match: m[0] });
        if (m.index === rule.re.lastIndex) rule.re.lastIndex++; // zero-width guard
      }
    });
  }
  return hits;
}

function loadBaseline(path) {
  if (!existsSync(path)) return { entries: [] };
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * `--files a b c` scans exactly those paths off disk instead of asking git, and
 * `--baseline p` swaps the baseline. Neither is used in anger: they exist so the
 * test can plant a known-bad fixture and prove the detector actually BITES, and
 * can point the baseline at a doctored copy to prove the stale-entry direction
 * fires. A gate nobody has watched fail is not known to work.
 */
function parseArgs(argv) {
  const out = { staged: false, files: null, baseline: DEFAULT_BASELINE };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--staged") out.staged = true;
    else if (argv[i] === "--baseline") out.baseline = argv[++i];
    else if (argv[i] === "--files") {
      out.files = [];
      while (i + 1 < argv.length && !argv[i + 1].startsWith("--")) out.files.push(argv[++i]);
    } else {
      console.error(`private-scan: unknown argument '${argv[i]}'`);
      process.exit(2);
    }
  }
  return out;
}

function main(argv) {
  const opts = parseArgs(argv);
  const staged = opts.staged;
  const files = opts.files ?? listFiles(staged);
  const read = opts.files ? (p) => readAbsolute(p) : staged ? readStaged : readWorking;

  const alwaysHits = [];
  /** rule -> path -> count, for the baselined tier. */
  const counted = new Map();

  for (const path of files) {
    const text = read(path);
    if (text === null) continue;
    if (text.includes("\0")) continue; // binary without a telling extension
    alwaysHits.push(...scanText(path, text, ALWAYS));
    for (const hit of scanText(path, text, BASELINED)) {
      const byPath = counted.get(hit.rule) ?? new Map();
      byPath.set(hit.path, (byPath.get(hit.path) ?? 0) + 1);
      counted.set(hit.rule, byPath);
    }
  }

  const baseline = loadBaseline(opts.baseline);
  const problems = [];
  /* Only a whole-tree run sees every file, so only a whole-tree run may call a
   * baseline entry stale. --staged and --files both read a subset. */
  const partial = staged || opts.files !== null;

  for (const hit of alwaysHits) {
    problems.push(`${hit.path}:${hit.line}  [${hit.rule}] "${hit.match}"\n      ${hit.text}\n      why: ${hit.why}`);
  }

  /* The baselined tier, both directions. In --staged mode only the staged files
   * were read, so a baseline entry for an untouched file is simply absent from
   * `counted` and MUST NOT be reported stale - the stale check is a whole-tree
   * property and only the whole-tree run can decide it. */
  const seen = new Set();
  for (const entry of baseline.entries ?? []) {
    const actual = counted.get(entry.rule)?.get(entry.path) ?? 0;
    seen.add(`${entry.rule} ${entry.path}`);
    if (partial && !files.includes(entry.path)) continue;
    if (actual === entry.count) continue;
    problems.push(
      actual === 0
        ? `tools/private-scan-baseline.json  [stale] ${entry.rule} in ${entry.path} is baselined at ` +
          `${entry.count} but no longer occurs there. Remove the entry - a baseline that ` +
          `outlives what it excused will silently excuse the next thing that lands in the same file.`
        : `${entry.path}  [${entry.rule}] occurs ${actual}x, baselined at ${entry.count}. ` +
          `If the new occurrences are legitimate (Angband's own default name), raise the ` +
          `count in tools/private-scan-baseline.json and say why.`,
    );
  }
  for (const [rule, byPath] of counted) {
    for (const [path, count] of byPath) {
      if (seen.has(`${rule} ${path}`)) continue;
      const why = BASELINED.find((r) => r.id === rule)?.why ?? "";
      problems.push(
        `${path}  [${rule}] ${count} unlisted occurrence(s).\n      why: ${why}`,
      );
    }
  }

  if (problems.length === 0) {
    const scope = staged ? "staged" : "tracked";
    console.log(`private-scan: clean (${files.length} ${scope} files)`);
    return 0;
  }

  console.error(
    `private-scan: ${problems.length} problem(s) - this repository is PUBLIC.\n`,
  );
  for (const p of problems) console.error(`  ${p}\n`);
  console.error(
    staged
      ? "Fix the staged content and commit again. `git commit --no-verify` bypasses this\n" +
        "hook, but the same scan runs over the whole tree in CI, so it only defers the failure."
      : "Run `node tools/private-scan.mjs` after fixing to confirm.",
  );
  return 1;
}

process.exit(main(process.argv.slice(2)));
