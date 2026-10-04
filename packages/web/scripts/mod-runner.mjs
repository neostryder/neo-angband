// Run mods headless: boot the game under Node with the mods in the given folders,
// play a short fixed session with them off and then on, and print the report as a
// `neo-angband/mod/headless-run` document. See docs/modding/HEADLESS_RUNNER.md.
//
//   node packages/web/scripts/mod-runner.mjs <folder>... [--seed N] [--enable id,id] [--out file]
//
// Each folder is one mod (it holds manifest.json) or a directory of mod folders.
// Exit status: 0 when the run passed, 1 when it did not, 2 for a usage error.
//
// The loader this drives uses `import.meta.glob`, which only Vite understands, so
// the runner is imported through Vite's module runner. A mod's own plugin.js is
// imported by Node directly, so a stack trace names its file.

import { writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { runnerImport } from "vite";

const WEB = join(dirname(fileURLToPath(import.meta.url)), "..");

function usage(message) {
  process.stderr.write(`${message}\nusage: node packages/web/scripts/mod-runner.mjs <folder>... [--seed N] [--enable id,id] [--out file]\n`);
  process.exit(2);
}

const folders = [];
let seed;
let enable;
let out;
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === "--seed") {
    seed = Number(args[++i]);
    if (!Number.isSafeInteger(seed)) usage("--seed needs a whole number");
  } else if (arg === "--enable") {
    enable = (args[++i] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  } else if (arg === "--out") {
    out = args[++i];
    if (!out) usage("--out needs a file name");
  } else if (arg === "--help" || arg === "-h") {
    usage("Runs mods headless and prints the report.");
  } else if (arg.startsWith("--")) {
    usage(`unknown option ${arg}`);
  } else {
    folders.push(resolve(arg));
  }
}
if (folders.length === 0) usage("name at least one mod folder");

/* stdout carries the report alone; anything the game or a mod logs goes to stderr. */
for (const name of ["log", "info", "debug"]) {
  console[name] = (...items) => process.stderr.write(`${items.map(String).join(" ")}\n`);
}

const { module: runner } = await runnerImport(join(WEB, "src/mod-runner/index.ts"), {
  configFile: false,
  root: WEB,
  mode: "production",
  logLevel: "error",
});

let source;
try {
  source = runner.nodeModsSource(folders);
} catch (error) {
  usage(error instanceof Error ? error.message : String(error));
}

const report = await runner.runHeadless({
  source,
  ...(seed === undefined ? {} : { seed }),
  ...(enable === undefined ? {} : { enable }),
  importer: (url) => import(url),
  watchProcess: true,
});
const document = runner.headlessRunDocument(report);
if (out) writeFileSync(out, document);
else process.stdout.write(document);
process.exit(report.passed ? 0 : 1);
