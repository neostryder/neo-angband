/**
 * Gamedata compiler CLI.
 *
 * Reads reference/lib/gamedata/<file>.txt (Angband 4.2.6, the read-only
 * source of truth) and emits packages/content/pack/<file>.json plus a
 * pack manifest. Run from the built output: `pnpm --filter
 * @neo-angband/content compile` (or `node dist/compile.js`).
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { compileGamedata } from "./records.js";
import { gamedataSpecs } from "./specs/index.js";

interface Manifest {
  id: string;
  name: string;
  version: string;
  engine: string;
  files: string[];
}

export function main(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const contentRoot = path.resolve(here, "..");
  const repoRoot = path.resolve(contentRoot, "..", "..");
  const gamedataDir = path.join(repoRoot, "reference", "lib", "gamedata");
  const packDir = path.join(contentRoot, "pack");
  mkdirSync(packDir, { recursive: true });

  const files: string[] = [];
  for (const spec of gamedataSpecs) {
    const sourcePath = path.join(gamedataDir, `${spec.name}.txt`);
    const text = readFileSync(sourcePath, "utf8");
    const compiled = compileGamedata(text, spec);
    const outName = `${spec.name}.json`;
    writeFileSync(path.join(packDir, outName), `${JSON.stringify(compiled, null, 2)}\n`);
    files.push(outName);
    console.log(`${outName}: ${compiled.records.length} records`);
  }

  const manifest: Manifest = {
    id: "core",
    name: "Angband",
    version: "4.2.6",
    engine: ">=0.1.0",
    files,
  };
  writeFileSync(path.join(packDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`manifest.json: ${files.length} files`);
}

main();
