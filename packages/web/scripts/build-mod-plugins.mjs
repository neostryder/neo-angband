#!/usr/bin/env node
/**
 * Build a bundled mod's TypeScript into the `plugin.js` its own repository ships.
 *
 *   node scripts/build-mod-plugins.mjs [--mods qol,bug-fixes] [--out <dir>] [--check]
 *
 * WHY THIS EXISTS. A mod is distributed as a folder: manifest.json plus plugin.js,
 * an ES module the game imports from wherever that folder ended up - a loopback URL
 * on desktop, a blob: from a browser directory picker, IndexedDB for one installed
 * from a repository. The source is TypeScript, and TypeScript is not a thing a
 * browser imports, so something has to do the transform. Nothing did: the bundled
 * mods were reachable only through Vite's build-time glob, which is why a mod could
 * not be extracted to its own repository without being rewritten by hand.
 *
 * WHAT IT MUST GUARANTEE, and why each is checked rather than assumed:
 *
 *  1. NO BARE IMPORTS. "@neo-angband/core" does not resolve in a module fetched
 *     from a folder - it resolves against the document, where nothing is published.
 *     The engine arrives as ctx.core instead. A mod's source may import core for
 *     TYPES, which esbuild erases; if a VALUE import survives into the output, the
 *     mod fails at import time in the player's hands and works perfectly in the dev
 *     bundle. So the output is scanned, and a surviving bare import is fatal.
 *  2. ONE FILE. The ABI permits relative imports between a mod's own scripts, but
 *     bundling them is strictly better for a distributed artefact: one request, one
 *     digest, and no chance of a half-downloaded dependency graph. stairs.ts and
 *     strings.ts land inside plugin.js.
 *  3. A DEFAULT EXPORT THAT LOOKS LIKE A ModPlugin. The host validates this at load
 *     (mod-plugin.ts validateModPlugin), but a broken artefact should fail HERE,
 *     where there is a build log, rather than as one line in a mod manager.
 *
 * `--check` builds and verifies without writing, for CI.
 *
 * The output is NOT committed to this repository. It is an artefact for the mod's
 * own repo, the same way the Linoleum packs are art for the mod's own repo: derived,
 * reproducible, and noise here.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const modsRoot = join(webRoot, "mods");

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] !== undefined ? args[at + 1] : fallback;
};
const check = args.includes("--check");
/* resolve, not join: an ABSOLUTE --out is the normal case for a caller writing to a
 * temp directory, and join() would have pasted it onto webRoot to make a path that
 * cannot exist. Relative values still land inside the package, as the default does. */
const outRoot = resolve(webRoot, flag("out", join("build", "mod-plugins")));

function note(message) {
  console.log(`[mod-plugins] ${message}`);
}
function fail(message) {
  console.error(`[mod-plugins] ${message}`);
  process.exitCode = 1;
}

/** Every bundled mod folder holding a plugin.ts entry point. */
function discover() {
  return readdirSync(modsRoot)
    .filter((id) => existsSync(join(modsRoot, id, "plugin.ts")))
    .sort();
}

const requested = flag("mods", "");
const all = discover();
const selected =
  requested === ""
    ? all
    : requested
        .split(",")
        .map((s) => s.trim())
        .filter((s) => s !== "");

for (const id of selected) {
  if (!all.includes(id)) {
    /* A typo'd id is a caller bug, not a missing artefact: name what does exist
     * rather than build nothing and exit 0. */
    fail(`FATAL - no bundled mod '${id}' with a plugin.ts (have: ${all.join(", ")})`);
    process.exit(1);
  }
}

if (selected.length === 0) {
  note("no bundled mod ships a plugin.ts; nothing to build");
  process.exit(0);
}

note(`${check ? "checking" : "building"} ${selected.length}: ${selected.join(", ")}`);

/**
 * A bare (package) specifier surviving into the bundle.
 *
 * Matches the specifier position of a static import/export-from and of a dynamic
 * `import("...")`, then keeps the ones that are not relative or absolute. Deliberately
 * not a full parse: esbuild has already produced one module of its own output, so the
 * only imports left are ones it was told to leave external - and it was told nothing
 * is external.
 */
function bareImports(code) {
  const specifiers = [
    ...code.matchAll(/(?:^|[\s;}])(?:import|export)[\s\S]{0,200}?from\s*["']([^"']+)["']/g),
    ...code.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
    ...code.matchAll(/(?:^|[\s;}])import\s*["']([^"']+)["']/g),
  ].map((m) => m[1]);
  return [...new Set(specifiers.filter((s) => !/^[./]/.test(s)))];
}

for (const id of selected) {
  const entry = join(modsRoot, id, "plugin.ts");
  let out;
  try {
    const result = await build({
      entryPoints: [entry],
      bundle: true,
      format: "esm",
      platform: "browser",
      target: "es2022",
      /* Readable output on purpose. A player can open plugin.js in the mod folder
       * they installed, and a mod they cannot read is a mod they cannot trust; the
       * few KB this costs are not worth the opacity. */
      minify: false,
      write: false,
      legalComments: "inline",
      banner: {
        js:
          `// ${id} - built from packages/web/mods/${id}/plugin.ts by\n` +
          `// packages/web/scripts/build-mod-plugins.mjs in the Neo Angband repository.\n` +
          `// Generated: edit the TypeScript source, not this file.`,
      },
    });
    out = result.outputFiles[0].text;
  } catch (e) {
    fail(`${id}: build failed - ${e.message}`);
    continue;
  }

  const bare = bareImports(out);
  if (bare.length > 0) {
    /* The failure this catches is invisible in the dev bundle and total in a
     * player's install, so it names the fix rather than just the problem. */
    fail(
      `${id}: plugin.js imports ${bare.map((s) => `"${s}"`).join(", ")} - a module ` +
        `loaded from a mod folder cannot resolve a package by name. Take what you ` +
        `need from ctx.core, and import @neo-angband/core for TYPES only ` +
        `("import type { ... }").`,
    );
    continue;
  }

  /* Shape check. Importing the built module is the only way to see the default
   * export, and it is safe here: this is first-party code we just compiled. */
  const dataUrl = `data:text/javascript;base64,${Buffer.from(out, "utf8").toString("base64")}`;
  let plugin;
  try {
    plugin = (await import(dataUrl)).default;
  } catch (e) {
    fail(`${id}: plugin.js does not import cleanly - ${e.message}`);
    continue;
  }
  const wrong = pluginProblem(plugin);
  if (wrong) {
    fail(`${id}: ${wrong}`);
    continue;
  }

  if (check) {
    note(`${id}: ok (${(out.length / 1024).toFixed(1)} KiB, api ${plugin.api})`);
    continue;
  }
  const dir = join(outRoot, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "plugin.js"), out, "utf8");
  /* The manifest travels with it: a mod folder without one is not a mod, and the
   * shared validator (readModDir) requires a top-level manifest.json from every
   * source alike. Copied verbatim - this script is not in the business of editing
   * what a mod declares. */
  writeFileSync(
    join(dir, "manifest.json"),
    readFileSync(join(modsRoot, id, "manifest.json"), "utf8"),
    "utf8",
  );
  note(
    `${id}: wrote ${relative(webRoot, join(dir, "plugin.js"))} ` +
      `(${(out.length / 1024).toFixed(1)} KiB, api ${plugin.api})`,
  );
}

/**
 * What is wrong with a built default export, or null.
 *
 * The same rules as the host's validateModPlugin, restated here rather than imported
 * because that module is TypeScript in the web package and this is a plain script.
 * The duplication is two field checks; importing a compiled copy would tie the build
 * step to whether the web package happens to have been built.
 */
function pluginProblem(plugin) {
  if (plugin === null || plugin === undefined) return "plugin.js has no default export";
  if (typeof plugin !== "object" && typeof plugin !== "function") {
    return `plugin.js default-exports a ${typeof plugin}, not a plugin object`;
  }
  if (!Number.isInteger(plugin.api)) return 'plugin.js declares no integer "api" version';
  if (plugin.hooks === undefined && plugin.register === undefined) {
    return "plugin.js declares neither hooks nor register, so it would do nothing";
  }
  for (const name of ["hooks", "register", "uninstall"]) {
    if (plugin[name] !== undefined && typeof plugin[name] !== "function") {
      return `plugin.js: ${name} is not a function`;
    }
  }
  return null;
}
