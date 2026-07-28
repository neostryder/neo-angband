/**
 * Bundle the Electron main process and its preload.
 *
 * WHY A BUNDLER AT ALL
 *
 * The main process needs NodeRawFs - the same real-filesystem adapter the CLI
 * uses - because the alternative is a second hand-written copy of z-file.c's
 * syscalls in the desktop shell, and two copies drift. Getting a workspace
 * package into an Electron main process without a bundler means shipping
 * node_modules symlinks inside the packaged app, which is exactly the fragile
 * part of Electron packaging. Bundling produces two self-contained CommonJS
 * files instead, so electron-builder has nothing to resolve.
 *
 * `electron` stays external (it is injected by the runtime, not installed), and
 * esbuild leaves node: builtins external automatically under platform "node".
 */

import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(here, "..");

/* Electron 38 ships Node 22. */
const TARGET = "node22";

const common = {
  bundle: true,
  platform: "node",
  target: TARGET,
  format: "cjs",
  external: ["electron"],
  sourcemap: true,
  logLevel: "info",
};

await build({
  ...common,
  entryPoints: [path.join(root, "src", "main.ts")],
  outfile: path.join(root, "dist", "main.cjs"),
});

await build({
  ...common,
  entryPoints: [path.join(root, "src", "preload.ts")],
  outfile: path.join(root, "dist", "preload.cjs"),
});
