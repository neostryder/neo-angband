#!/usr/bin/env node
/**
 * Build a mod's TypeScript into the `plugin.js` its folder ships.
 *
 *   neo-angband-mod-build [--root <dir>] [--mods a,b] [--out <dir>] [--check]
 *
 * WHY THIS EXISTS. A mod is distributed as a FOLDER: manifest.json plus plugin.js, an
 * ES module the game imports from wherever that folder ended up - a loopback URL on
 * desktop, a blob: from a browser directory picker, IndexedDB for one installed from a
 * repository. The source is TypeScript, and TypeScript is not a thing a browser
 * imports, so something has to do the transform.
 *
 * WHY IT LIVES IN THE SDK. It used to live in the engine repository, next to the mods
 * that were bundled into the app - which meant the only way to build a plugin.js was
 * to have the whole engine repository checked out. Now that every mod lives in its own
 * repository, including the first-party ones, that is backwards: the rules below are
 * the plugin ABI, the ABI belongs to the SDK, and the SDK is published. A mod repo
 * installs @rpgm-tools/neo-angband-mod-sdk and runs this. Copying the script into each
 * mod repo was the alternative, and it would have put three drifting copies of the
 * same three guarantees in three places.
 *
 * WHAT IT MUST GUARANTEE, and why each is checked rather than assumed:
 *
 *  1. NO BARE IMPORTS, AND NO INLINED ENGINE. "@rpgm-tools/neo-angband-core" does not
 *     resolve in a module fetched from a folder - it resolves against the document,
 *     where nothing is published. The engine arrives as `ctx.core` instead. A mod's
 *     source may import core for TYPES, which esbuild erases.
 *
 *     Every non-relative specifier is therefore marked EXTERNAL, and a surviving one
 *     is fatal. That is not a detail. Without it, esbuild RESOLVES the import (a mod
 *     repo has core as a devDependency, so it is right there in node_modules) and
 *     inlines what it finds - and then this scan can never fire, because there is no
 *     bare import left to see. Measured on the engine repo's own script, which did
 *     not mark anything external: a plugin.ts doing `import { TMD } from
 *     "@rpgm-tools/neo-angband-core"` built clean, exit 0, and shipped a private copy
 *     of the timed-effect table inside plugin.js. For a frozen constant that is
 *     merely wasteful; for anything with module state - a registry, a cache, the RNG -
 *     it is a SECOND INSTANCE of the engine's state living inside the mod, which is
 *     the exact failure the ABI's "the engine is passed in" rule exists to prevent.
 *     A guard that cannot fail is worse than no guard: it reads as coverage.
 *
 *  2. ONE FILE. The ABI permits relative imports between a mod's own scripts, but
 *     bundling them is strictly better for a distributed artefact: one request, one
 *     digest, and no chance of a half-downloaded dependency graph.
 *  3. A DEFAULT EXPORT THAT LOOKS LIKE A ModPlugin. The host validates this at load
 *     (validateModPlugin), but a broken artefact should fail HERE, where there is a
 *     build log, rather than as one line in a mod manager.
 *  4. THE COMMITTED plugin.js IS CURRENT. In a mod repository plugin.js is a committed
 *     artefact - it has to be, because that is the file the catalogue fetches at a tag
 *     and hashes. Which means it can go stale against its own source, silently, and the
 *     stale copy is the one players run. So `--check` compares byte for byte against
 *     whatever plugin.js is already there and fails on a difference. Nothing else in
 *     the chain would notice: the digest would match the stale file perfectly.
 *
 * `--check` builds and verifies without writing, for CI.
 *
 * TWO SHAPES OF --root, decided by what is in it:
 *
 *   a mod folder (has plugin.ts)       build it, writing beside its manifest.json
 *   a folder OF mod folders            build each one that has a plugin.ts
 *
 * The first is what a mod repository wants: plugin.js is a committed artefact there,
 * because that is the file the catalogue fetches and hashes. The second is what the
 * engine repository wants for its demo mods, and writes to --out.
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

/* esbuild is not a dependency of this package. The SDK is imported at RUNTIME by the
 * web build to validate manifests, and a native binary in that dependency tree is a
 * cost every consumer pays for a tool only mod authors run. So it is resolved when the
 * tool actually runs, and its absence names the remedy instead of stack-tracing. */
let build;
try {
  ({ build } = await import("esbuild"));
} catch {
  console.error(
    "[mod-build] esbuild is not installed. It is the transform this tool drives, and\n" +
      "[mod-build] it is deliberately not a dependency of the SDK (a native binary in\n" +
      "[mod-build] the runtime tree costs every consumer for a build-time tool).\n" +
      "[mod-build] Add it:  npm i -D esbuild",
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name, fallback) => {
  const at = args.indexOf(`--${name}`);
  return at >= 0 && args[at + 1] !== undefined ? args[at + 1] : fallback;
};
const check = args.includes("--check");
const root = resolve(process.cwd(), flag("root", "."));

function note(message) {
  console.log(`[mod-build] ${message}`);
}
let failed = false;
function fail(message) {
  console.error(`[mod-build] ${message}`);
  failed = true;
  process.exitCode = 1;
}

if (!existsSync(root) || !statSync(root).isDirectory()) {
  fail(`FATAL - --root ${root} is not a directory`);
  process.exit(1);
}

/**
 * The mod folders to build, and where each one's output goes.
 *
 * `single` is the mod-repository case, and its default output is the folder itself:
 * plugin.js is a committed artefact there, sitting next to the manifest.json it is
 * distributed with. Writing it anywhere else would leave the repo's own copy stale,
 * which is the one state nobody looks at.
 */
const single = existsSync(join(root, "plugin.ts"));
const outFlag = flag("out", null);
let targets;
if (single) {
  const id = readManifestId(root) ?? basename(root);
  targets = [{ id, dir: root, out: outFlag === null ? root : resolve(process.cwd(), outFlag, id) }];
} else {
  const all = readdirSync(root)
    .filter((id) => existsSync(join(root, id, "plugin.ts")))
    .sort();
  const requested = flag("mods", "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s !== "");
  for (const id of requested) {
    if (!all.includes(id)) {
      /* A typo'd id is a caller bug, not a missing artefact: name what does exist
       * rather than build nothing and exit 0. */
      fail(`FATAL - no mod '${id}' with a plugin.ts under ${root} (have: ${all.join(", ") || "none"})`);
      process.exit(1);
    }
  }
  const selected = requested.length > 0 ? requested : all;
  const outRoot = resolve(process.cwd(), outFlag ?? join(root, "..", "build", "mod-plugins"));
  targets = selected.map((id) => ({ id, dir: join(root, id), out: join(outRoot, id) }));
}

if (targets.length === 0) {
  /* Not an error - a repo may legitimately hold a content-only mod. But it is said out
   * loud, because "nothing to build" and "built everything" are the same exit code and
   * a CI step that quietly does nothing reads as a passing check. */
  note(`no mod under ${root} ships a plugin.ts; nothing to build`);
  process.exit(0);
}

note(`${check ? "checking" : "building"} ${targets.length}: ${targets.map((t) => t.id).join(", ")}`);

/** The manifest's own id, or null when there is no readable manifest. */
function readManifestId(dir) {
  try {
    const id = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")).id;
    return typeof id === "string" && id !== "" ? id : null;
  } catch {
    return null;
  }
}

/**
 * A bare (package) specifier in the bundle.
 *
 * Matches the specifier position of a static import/export-from and of a dynamic
 * `import("...")`, then keeps the ones that are not relative or absolute. Deliberately
 * not a full parse: esbuild has produced one module of its own output, and the only
 * imports left are the ones it was told to leave external - which is every bare one,
 * on purpose. See guarantee 1.
 */
function bareImports(code) {
  const specifiers = [
    ...code.matchAll(/(?:^|[\s;}])(?:import|export)[\s\S]{0,200}?from\s*["']([^"']+)["']/g),
    ...code.matchAll(/\bimport\s*\(\s*["']([^"']+)["']\s*\)/g),
    ...code.matchAll(/(?:^|[\s;}])import\s*["']([^"']+)["']/g),
  ].map((m) => m[1]);
  return [...new Set(specifiers.filter((s) => !PATH_LIKE.test(s)))];
}

/** Relative, POSIX-absolute, or Windows drive-absolute. Anything else is a package. */
const PATH_LIKE = /^(?:\.|\/|[A-Za-z]:[\\/])/;

/**
 * Leave every package specifier alone.
 *
 * `external: [...]` would need the names up front, and the point is to catch names
 * nobody predicted - a mod that reaches for lodash cannot resolve it from a mod folder
 * either. So the filter is "everything", narrowed here to specifiers that are not paths.
 *
 * The entry point is exempt explicitly. It arrives through onResolve like any other
 * specifier, as an ABSOLUTE path - which on Windows begins with a drive letter and so
 * is not relative by the naive test. Marking it external makes esbuild refuse the build
 * outright ("the entry point cannot be marked as external"), which is how this was
 * found: all three fixtures failed identically, including the one that must pass.
 */
const externalAll = {
  name: "external-bare-specifiers",
  setup(b) {
    b.onResolve({ filter: /.*/ }, (a) => {
      if (a.kind === "entry-point" || PATH_LIKE.test(a.path)) return null;
      return { path: a.path, external: true };
    });
  },
};

for (const { id, dir, out } of targets) {
  let js;
  try {
    const result = await build({
      entryPoints: [join(dir, "plugin.ts")],
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
      plugins: [externalAll],
      banner: {
        js:
          `// ${id} - generated from plugin.ts by neo-angband-mod-build\n` +
          `// (@rpgm-tools/neo-angband-mod-sdk). Edit the TypeScript source, not this file.`,
      },
    });
    js = result.outputFiles[0].text;
  } catch (e) {
    fail(`${id}: build failed - ${e.message}`);
    continue;
  }

  const bare = bareImports(js);
  if (bare.length > 0) {
    /* The failure this catches is invisible in a dev bundle and total in a player's
     * install, so it names the fix rather than just the problem. */
    fail(
      `${id}: plugin.js imports ${bare.map((s) => `"${s}"`).join(", ")} - a module ` +
        `loaded from a mod folder cannot resolve a package by name, and bundling one ` +
        `in would give the mod its own copy of that module's state. Take what you ` +
        `need from ctx.core, and import @rpgm-tools/neo-angband-core for TYPES only ` +
        `("import type { ... }").`,
    );
    continue;
  }

  /* Shape check. Importing the built module is the only way to see the default
   * export, and it is safe here: this is the author's own code, just compiled. */
  const dataUrl = `data:text/javascript;base64,${Buffer.from(js, "utf8").toString("base64")}`;
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
    const committed = join(out, "plugin.js");
    if (existsSync(committed)) {
      /* Guarantee 4. A stale committed artefact passes every other check in this file
       * and every digest in the catalogue, because the digest is taken FROM it. */
      const have = readFileSync(committed, "utf8");
      if (have !== js) {
        fail(
          `${id}: the committed ${relative(process.cwd(), committed)} does not match its ` +
            `source. It is what players actually run, and a digest taken from it would ` +
            `match it perfectly. Rebuild it and commit the result.`,
        );
        continue;
      }
      note(`${id}: ok, and the committed plugin.js is current (${(js.length / 1024).toFixed(1)} KiB, api ${plugin.api})`);
      continue;
    }
    note(`${id}: ok (${(js.length / 1024).toFixed(1)} KiB, api ${plugin.api})`);
    continue;
  }
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "plugin.js"), js, "utf8");
  if (resolve(out) !== resolve(dir)) {
    /* The manifest travels with it: a mod folder without one is not a mod, and the
     * shared validator (readModDir) requires a top-level manifest.json from every
     * source alike. Copied verbatim - this tool is not in the business of editing what
     * a mod declares, and a rewritten id would install under the wrong name. */
    writeFileSync(
      join(out, "manifest.json"),
      readFileSync(join(dir, "manifest.json"), "utf8"),
      "utf8",
    );
  }
  note(
    `${id}: wrote ${relative(process.cwd(), join(out, "plugin.js"))} ` +
      `(${(js.length / 1024).toFixed(1)} KiB, api ${plugin.api})`,
  );
}

if (failed) process.exitCode = 1;

/**
 * What is wrong with a built default export, or null.
 *
 * The same rules as the host's validateModPlugin, restated here rather than imported
 * because that module lives in the web front end and this is a plain script the SDK
 * ships. Importing a compiled copy would tie the build step to whether the front end
 * happens to have been built.
 *
 * A HAND-WRITTEN MIRROR DRIFTS, and this one did. When ModPlugin grew `controller`,
 * the host learned about it and this did not - so the Borg, whose only member is a
 * controller, built fine in the host's eyes and was refused here as "would do
 * nothing". The two lists are now cross-checked against each other by
 * plugin-abi-agreement.test.ts, which reads both files: the duplication is allowed
 * to exist, but not to disagree.
 */
function pluginProblem(plugin) {
  if (plugin === null || plugin === undefined) return "plugin.js has no default export";
  if (typeof plugin !== "object" && typeof plugin !== "function") {
    return `plugin.js default-exports a ${typeof plugin}, not a plugin object`;
  }
  if (!Number.isInteger(plugin.api)) return 'plugin.js declares no integer "api" version';
  if (
    plugin.hooks === undefined &&
    plugin.register === undefined &&
    plugin.controller === undefined &&
    plugin.frontend === undefined &&
    plugin.hud === undefined
  ) {
    return "plugin.js declares no hooks, register, controller, frontend or hud, so it would do nothing";
  }
  for (const name of ["hooks", "register", "controller", "frontend", "hud", "uninstall"]) {
    if (plugin[name] !== undefined && typeof plugin[name] !== "function") {
      return `plugin.js: ${name} is not a function`;
    }
  }
  return null;
}
