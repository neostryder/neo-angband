/**
 * Reach the compiled pack from outside this repository.
 *
 * The pack IS the package. `pack/*.json` is 2.0 of the 2.3 MB
 * @rpgm-tools/neo-angband-content unpacks to, and a mod repository installs this
 * package for exactly one reason: to generate a real Angband 4.2.6 level in its
 * tests instead of asserting against a hand-built cave.
 *
 * 0.11.0 shipped all 45 of those files and exported none of them. An `exports` map
 * ENCAPSULATES a package - a subpath that is not declared is not merely
 * undocumented, it is refused - so against the published tarball
 * `import "@rpgm-tools/neo-angband-content/pack/constants.json"` threw
 * ERR_PACKAGE_PATH_NOT_EXPORTED, and the index offered the compiler and nothing
 * else. The payload was unreachable by every path a consumer has.
 *
 * There are two kinds of consumer, so there are two ways in:
 *
 *   import { loadPackRecords } from "@rpgm-tools/neo-angband-content/pack";
 *   import monsters from "@rpgm-tools/neo-angband-content/pack/monster.json" with { type: "json" };
 *
 * This module is the first, for Node - a test runner, a build script, the CLI. The
 * second is for a bundler, which wants the file itself so it can inline it.
 *
 * It touches node:fs, which is why the index does NOT re-export it: the index goes
 * into a browser bundle, and a browser has no fs.
 */

import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

/**
 * Absolute path of the directory holding the compiled pack files.
 *
 * Resolved from this module rather than from the process's working directory, so
 * it is right whether the caller is in node_modules, in a workspace link, or in a
 * checkout. `../pack/` is correct from both `dist/pack.js` and `src/pack.ts`
 * because both sit one level under the package root.
 */
export const packDir: string = fileURLToPath(new URL("../pack/", import.meta.url));

/** What `manifest.json` in the pack directory declares. */
export interface PackManifestFile {
  /** Namespace the records are published under. `core` for the base game. */
  readonly id: string;
  readonly name: string;
  /** The Angband release this data was compiled from, not the port's version. */
  readonly version: string;
  /** Engine range the data requires, as a semver range. */
  readonly engine?: string;
  /** Every record file, in the order the engine must load them. */
  readonly files: readonly string[];
}

/** The shape every pack file other than the manifest has. */
interface RecordsFile<T> {
  readonly file: string;
  readonly source: string;
  readonly records: readonly T[];
}

function packPath(name: string): string {
  return join(packDir, `${name}.json`);
}

/**
 * Parse one pack file, named without its extension (`"monster"`, `"constants"`).
 *
 * A missing file is reported with the directory and the names that ARE there. The
 * bare ENOENT names one path and reads as a broken install; the common cause is a
 * typo or a file that moved between releases, and neither is visible in it.
 */
export function loadPackFile<T>(name: string): T {
  try {
    return JSON.parse(readFileSync(packPath(name), "utf8")) as T;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const available = readdirSync(packDir)
      .filter((f) => f.endsWith(".json"))
      .map((f) => f.slice(0, -".json".length));
    throw new Error(
      `no pack file "${name}.json" in ${packDir}\n` +
        `available: ${available.join(", ")}`,
    );
  }
}

/**
 * The `records` array of one pack file.
 *
 * Every file except the manifest wraps its records in an object that also carries
 * the gamedata file it was compiled from; callers almost always want the array.
 */
export function loadPackRecords<T>(name: string): T[] {
  return [...loadPackFile<RecordsFile<T>>(name).records];
}

/** The pack's manifest. */
export function loadPackManifest(): PackManifestFile {
  return loadPackFile<PackManifestFile>("manifest");
}

/**
 * Every record file this package ships, without extensions, IN LOAD ORDER.
 *
 * Order is load-bearing and it is not alphabetical: `object.json` references the
 * bases in `object_base.json`, monsters reference their blow methods. The manifest
 * is the one place that order is written down, so this reads it rather than
 * listing the directory.
 */
export function packFileNames(): string[] {
  return loadPackManifest().files.map((f) => f.replace(/\.json$/u, ""));
}
