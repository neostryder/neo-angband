#!/usr/bin/env node
/**
 * Prove each publishable package works AS THE TARBALL npm would ship.
 *
 * A `files` list is a claim and a package.json `exports` map is a claim; the
 * bytes in the tarball are the measurement. This packs each package, extracts it
 * into an empty directory with no node_modules and no repository around it, and
 * imports every declared entry point with plain Node.
 *
 * That last step is the whole point. Before it existed, `@rpgm-tools/neo-angband-core`
 * emitted 4612 extensionless relative specifiers - `export * from "./rng"` - which
 * Vite resolves and Node does not, so the published engine would have been
 * unimportable by anyone not using a bundler. Every test in the repository passed,
 * because vitest runs through Vite. Only loading the artefact the way a consumer
 * loads it could find that.
 *
 * Usage:
 *   node tools/check-npm-package.mjs            # every publishable package
 *   node tools/check-npm-package.mjs core       # just one
 */

import { execFileSync, execSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { gunzipSync } from "node:zlib";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { publishablePackages } from "./publishable.mjs";
import { packResult } from "./npm-pack-result.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/* Derived from the manifests, not listed here - see tools/publishable.mjs for
 * why there is exactly one place that answers this. */
const PUBLISHABLE = publishablePackages();

const requested = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const packages = requested.length > 0 ? requested : PUBLISHABLE;

const onWindows = process.platform === "win32";
const npm = onWindows ? "npm.cmd" : "npm";

/**
 * Node refuses to spawn a .cmd without a shell (CVE-2024-27980), so on Windows
 * this builds ONE command string and hands it to execSync. Passing an argument
 * vector with `shell: true` would work but is deprecated (DEP0190) precisely
 * because the arguments are concatenated unescaped - doing the quoting here is the
 * same operation, admitted.
 */
function runNpm(args, cwd) {
  const opts = { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] };
  if (!onWindows) return execFileSync(npm, args, opts);
  return execSync([npm, ...args.map((a) => `"${a}"`)].join(" "), opts);
}

let failures = 0;

function note(message) {
  console.log(`[npm-package] ${message}`);
}

function fail(message) {
  console.error(`[npm-package] FAIL ${message}`);
  failures++;
}

/* Say which npm did the packing, in the log, every run. `npm pack --json`
 * changed shape between 11 and 12 and this script read the old one; what made
 * that survive was not the bug, it was that no run recorded the version it had
 * measured, so "green in CI" and "works on npm 12" looked like the same claim. */
note(`npm ${runNpm(["--version"], repoRoot).trim()} on node ${process.version}`);

/**
 * Extract a .tgz with zlib and a tar reader rather than shelling out to `tar`.
 *
 * `tar -xzf C:\...` fails under the GNU tar that ships with Git for Windows: a
 * `C:` prefix is a REMOTE HOST spec to it, so the check died on the platform it
 * was written on while passing in CI. Doing it here makes the tool behave the
 * same everywhere, which is the only reason to prefer 60 lines over one exec.
 */
function extractTgz(tarball, destination) {
  const buf = gunzipSync(readFileSync(tarball));
  const written = [];
  let offset = 0;
  /** A pax header sets the NEXT entry's real path when it exceeds 100 bytes. */
  let overridePath = null;

  const str = (start, length) => {
    const raw = buf.subarray(offset + start, offset + start + length);
    const end = raw.indexOf(0);
    return raw.subarray(0, end === -1 ? raw.length : end).toString("utf8");
  };

  while (offset + 512 <= buf.length) {
    const name = str(0, 100);
    if (name === "") break; // the two zero blocks that end an archive
    const sizeField = str(124, 12).trim();
    const size = sizeField === "" ? 0 : parseInt(sizeField, 8);
    const type = String.fromCharCode(buf[offset + 156]);
    const prefix = str(345, 155);
    const body = buf.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;

    if (type === "x" || type === "g") {
      /* pax record: "<len> path=<value>\n" */
      const match = /\d+ path=([^\n]*)\n/.exec(body.toString("utf8"));
      if (match) overridePath = match[1];
      continue;
    }
    const full = overridePath ?? (prefix === "" ? name : `${prefix}/${name}`);
    overridePath = null;

    if (full.includes("..")) throw new Error(`refusing traversal entry: ${full}`);
    const target = join(destination, full);
    if (type === "5") {
      mkdirSync(target, { recursive: true });
      continue;
    }
    if (type !== "0" && type !== "\0") {
      throw new Error(`unsupported tar entry type ${JSON.stringify(type)} for ${full}`);
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, body);
    written.push(full);
  }
  return written;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

for (const pkg of packages) {
  const packageRoot = join(repoRoot, "packages", pkg);
  if (!existsSync(join(packageRoot, "package.json"))) {
    fail(`${pkg}: no packages/${pkg}/package.json`);
    continue;
  }
  const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));
  const staging = mkdtempSync(join(tmpdir(), `neo-npm-${pkg}-`));

  try {
    /* --pack-destination keeps the tarball out of the working tree, so a failed
     * run cannot leave a .tgz behind for someone to commit. */
    const out = runNpm(["pack", "--pack-destination", staging, "--json"], packageRoot);
    const packed = packResult(out, pkg);
    const tarball = join(staging, packed.filename);

    extractTgz(tarball, staging);
    /* npm tarballs always root everything under `package/`. */
    const root = join(staging, "package");
    if (!existsSync(root)) {
      fail(`${pkg}: tarball did not contain a package/ root`);
      continue;
    }

    const files = walk(root).map((p) => p.slice(root.length + 1).replaceAll("\\", "/"));
    note(
      `${manifest.name}@${manifest.version}: ${files.length} files, ` +
        `${(packed.size / 1048576).toFixed(1)} MiB packed`,
    );

    const tests = files.filter((f) => /\.test\./.test(f));
    if (tests.length > 0) {
      fail(`${pkg}: ${tests.length} test file(s) in the tarball, e.g. ${tests[0]}`);
    }

    for (const required of ["README.md", "LICENSE.md", "package.json"]) {
      if (!files.includes(required)) fail(`${pkg}: tarball is missing ${required}`);
    }

    /* SHIPPED IS NOT THE SAME AS REACHABLE, and the gap is silent. An `exports`
     * map encapsulates a package: an undeclared subpath is refused, not merely
     * undocumented. content@0.11.0 shipped pack/ - 45 files, 2.0 of its 2.3 MB -
     * with no subpath for it, so the one thing the package is published FOR threw
     * ERR_PACKAGE_PATH_NOT_EXPORTED at every consumer, and 113 files, a green CI
     * and a successful publish all agreed it was fine.
     *
     * `bin` counts as reachable: npm installs a shim for it, and a bin target is
     * NOT supposed to be in the exports map. src/ is the standing exception - it
     * ships because the .js.map files point into it, and a debugger reads it by
     * path rather than by specifier. */
    const reachable = [
      ...Object.values(manifest.exports ?? {}).flatMap((entry) =>
        typeof entry === "string" ? [entry] : Object.values(entry),
      ),
      ...Object.values(manifest.bin ?? {}).map((t) => (t.startsWith("./") ? t : `./${t}`)),
    ];
    const shippedDirs = [...new Set(files.filter((f) => f.includes("/")).map((f) => f.split("/")[0]))];
    for (const dir of shippedDirs) {
      if (dir === "src") continue;
      if (reachable.some((t) => t.startsWith(`./${dir}/`))) continue;
      const bytes = files.filter((f) => f.startsWith(`${dir}/`)).length;
      fail(
        `${pkg}: ships ${dir}/ (${bytes} files) and no exports subpath reaches it.\n` +
          `        Nothing can import it - "exports" refuses undeclared subpaths.`,
      );
    }

    /* Resolve by BARE SPECIFIER through a real node_modules, not by joining the
     * target path ourselves. Importing the file directly is what this check used
     * to do, and it silently proves the wrong thing: a file URL bypasses the
     * exports map entirely, so it answers "does this file load" when the question
     * is "can a consumer reach it". */
    const consumer = join(staging, "consumer");
    const installed = join(consumer, "node_modules", ...manifest.name.split("/"));
    mkdirSync(dirname(installed), { recursive: true });
    renameSync(root, installed);
    writeFileSync(
      join(consumer, "package.json"),
      JSON.stringify({ name: "consumer", private: true, type: "module" }),
    );

    /* An extracted package has no node_modules of its own. For a package with zero
     * runtime dependencies that is exactly the isolation wanted here; for one WITH deps
     * a bare specifier would fail for a legitimate reason, so say what was skipped
     * rather than pretend the check ran. */
    const deps = Object.keys(manifest.dependencies ?? {});
    if (deps.length > 0) {
      note(`${pkg}: SKIPPED the isolated import check - declares ${deps.join(", ")}`);
    } else {
      for (const [subpath, entry] of Object.entries(manifest.exports ?? {})) {
        const target = typeof entry === "string" ? entry : entry.default;
        /* A pattern subpath is a promise about a SET of files, so check it with one
         * of the files actually in the tarball rather than inventing a name. */
        let specifier = manifest.name + subpath.slice(1);
        if (subpath.includes("*")) {
          const [before, after] = target.slice(2).split("*");
          const match = files.find((f) => f.startsWith(before) && f.endsWith(after));
          if (match === undefined) {
            fail(`${pkg}: exports "${subpath}" matches no file in the tarball`);
            continue;
          }
          const star = match.slice(before.length, match.length - after.length);
          specifier = manifest.name + subpath.slice(1).replace("*", star);
        } else if (!existsSync(join(installed, target))) {
          fail(`${pkg}: exports "${subpath}" points at missing ${target}`);
          continue;
        }
        const attributes = specifier.endsWith(".json") ? `, { with: { type: "json" } }` : "";
        try {
          const script =
            `const m = await import(${JSON.stringify(specifier)}${attributes});` +
            `const n = Object.keys(m).length;` +
            `if (n === 0) { console.error("no exports"); process.exit(3); }` +
            `console.log(n);`;
          const count = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
            cwd: consumer,
            encoding: "utf8",
            stdio: ["ignore", "pipe", "pipe"],
          }).trim();
          note(`${pkg}: node imported "${specifier}" -> ${count} exports`);
        } catch (error) {
          fail(
            `${pkg}: plain Node cannot import "${specifier}" (${target}).\n` +
              `        Either the exports map does not reach it, or this is the\n` +
              `        extensionless-specifier failure class: tsc emits specifiers\n` +
              `        verbatim, so a bundler-only import is invisible until something\n` +
              `        loads the artefact without a bundler.\n` +
              `        ${String(error.stderr ?? error.message).trim().split("\n").slice(0, 6).join("\n        ")}`,
          );
        }
      }
    }
  } catch (error) {
    fail(`${pkg}: ${error.message}`);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
}

if (failures > 0) {
  console.error(`[npm-package] ${failures} failure(s)`);
  process.exit(1);
}
note(`${packages.length} package(s) OK`);
