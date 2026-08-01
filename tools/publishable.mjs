#!/usr/bin/env node
/**
 * Which packages get published to npm - the one place that answers it.
 *
 * There used to be four: a `PUBLISHABLE` literal in tools/check-npm-package.mjs,
 * a `PUBLISHED` literal in packages/core/src/npm-publish.test.ts, and two
 * `for pkg in core mod-sdk` loops in .github/workflows/publish-npm.yml - each
 * with a comment asking a human to keep it in step with the others. Making one
 * more package publishable meant four edits, and three of the four would fail
 * silently: the workflow would simply never publish the new package, and no test
 * in the repository was in a position to say so.
 *
 * THE RULE. A package is publishable exactly when npm would publish it - that
 * is, when its manifest does not carry `private: true`. This is not a proxy for
 * the answer; npm enforces it, so a package that is wrong here is wrong at the
 * registry too, which is the only place it could matter.
 *
 * Plain .mjs with no dependencies, because the git-hook-adjacent tooling in this
 * repository runs with bare node before any build, and because the release
 * workflow reads it with `node -p` from a shell loop.
 *
 * Usage:
 *   node tools/publishable.mjs          # one package directory name per line
 *   import { publishablePackages } from "./publishable.mjs"
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** The package DIRECTORY names under packages/, sorted, that npm may publish. */
export function publishablePackages(root = repoRoot) {
  const dir = join(root, "packages");
  return readdirSync(dir)
    .filter((name) => existsSync(join(dir, name, "package.json")))
    .filter((name) => {
      const manifest = JSON.parse(readFileSync(join(dir, name, "package.json"), "utf8"));
      return manifest.private !== true;
    })
    .sort();
}

/* Printed one per line so a shell can read it with a bare `for` loop. */
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, "/"))) {
  process.stdout.write(publishablePackages().join("\n") + "\n");
}
