#!/usr/bin/env node
/**
 * Replace `workspace:` ranges in the published manifests with real versions.
 *
 * npm publishes package.json exactly as it is on disk. Core's dependency on mod-sdk
 * is written "workspace:*", which only pnpm inside this repository understands, so
 * core 1.19.0 and 1.19.1 failed to install anywhere else (#318).
 *
 * This swaps each such range for the sibling's real version, by the same rules as
 * `pnpm pack`.
 *
 *   workspace:*       -> 1.2.3    (the sibling's exact version)
 *   workspace:^       -> ^1.2.3
 *   workspace:~       -> ~1.2.3
 *   workspace:<range> -> <range>
 *
 * The sibling has to be a package we publish, because a private one has nothing on
 * the registry to point at.
 *
 * Usage:
 *   node tools/pin-workspace-ranges.mjs           # print what would change
 *   node tools/pin-workspace-ranges.mjs --write   # rewrite the manifests in place (publish job only)
 *
 * check-npm-package calls withPinnedManifest instead of --write, so its run leaves
 * package.json as it found it.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { publishablePackages } from "./publishable.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const DEPENDENCY_FIELDS = ["dependencies", "peerDependencies", "optionalDependencies"];

/** Package name to version for every publishable package. */
export function publishedVersions(root = repoRoot) {
  const versions = new Map();
  for (const pkg of publishablePackages(root)) {
    const manifest = JSON.parse(readFileSync(join(root, "packages", pkg, "package.json"), "utf8"));
    versions.set(manifest.name, manifest.version);
  }
  return versions;
}

/**
 * Returns a copy with the workspace: ranges replaced in dependencies,
 * peerDependencies and optionalDependencies. devDependencies stay as they are,
 * since a consumer never installs them.
 */
export function pinnedManifest(manifest, versions) {
  const out = structuredClone(manifest);
  for (const field of DEPENDENCY_FIELDS) {
    const deps = out[field];
    if (!deps) continue;
    for (const [name, range] of Object.entries(deps)) {
      if (typeof range !== "string" || !range.startsWith("workspace:")) continue;
      const version = versions.get(name);
      if (version === undefined) {
        throw new Error(
          `${manifest.name}: ${field}.${name} is "${range}", but ${name} is not a published package`,
        );
      }
      const spec = range.slice("workspace:".length);
      deps[name] = spec === "*" ? version : spec === "^" || spec === "~" ? `${spec}${version}` : spec;
    }
  }
  return out;
}

/** The `workspace:` ranges left in a manifest's published dependency fields. */
export function workspaceRanges(manifest) {
  return DEPENDENCY_FIELDS.flatMap((field) =>
    Object.entries(manifest[field] ?? {})
      .filter(([, range]) => typeof range === "string" && range.startsWith("workspace:"))
      .map(([name, range]) => `${field}.${name}: ${range}`),
  );
}

/**
 * Run `fn` with packageRoot/package.json holding its pinned form, then write the
 * original text back, whether `fn` returns or throws.
 */
export function withPinnedManifest(packageRoot, versions, fn) {
  const file = join(packageRoot, "package.json");
  const original = readFileSync(file, "utf8");
  const manifest = JSON.parse(original);
  if (workspaceRanges(manifest).length === 0) return fn();
  writeFileSync(file, `${JSON.stringify(pinnedManifest(manifest, versions), null, 2)}\n`);
  try {
    return fn();
  } finally {
    writeFileSync(file, original);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const write = process.argv.includes("--write");
  const versions = publishedVersions();
  for (const pkg of publishablePackages()) {
    const file = join(repoRoot, "packages", pkg, "package.json");
    const manifest = JSON.parse(readFileSync(file, "utf8"));
    const ranges = workspaceRanges(manifest);
    if (ranges.length === 0) continue;
    const pinned = pinnedManifest(manifest, versions);
    for (const field of DEPENDENCY_FIELDS) {
      for (const [name, range] of Object.entries(manifest[field] ?? {})) {
        if (pinned[field][name] !== range) console.log(`${pkg}: ${field}.${name} ${range} -> ${pinned[field][name]}`);
      }
    }
    if (write) writeFileSync(file, `${JSON.stringify(pinned, null, 2)}\n`);
  }
}
