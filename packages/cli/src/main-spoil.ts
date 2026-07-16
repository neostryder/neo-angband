/**
 * `spoil` entry point: generate the wiz-spoil.c spoiler files (basic items,
 * artifacts, brief monster table, full monster lore) and print/write them.
 * Deterministic static-data dumps; no wall-clock, no RNG dependence.
 *
 * Usage: node dist/main-spoil.js [--kind obj|artifact|mon-desc|mon-info|all]
 *          [--out FILE]
 */

import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { loadGamePack } from "./pack";
import {
  spoilArtifact,
  spoilMonDesc,
  spoilMonInfo,
  spoilObjDesc,
} from "./spoilers";

type Kind = "obj" | "artifact" | "mon-desc" | "mon-info" | "all";

const KINDS: readonly Kind[] = ["obj", "artifact", "mon-desc", "mon-info", "all"];

function parseArgs(argv: string[]): { kind: Kind; out: string | null } {
  let kind: Kind = "all";
  let out: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`missing value for ${arg}`);
      return v;
    };
    switch (arg) {
      case "--kind": {
        const v = next();
        if (!KINDS.includes(v as Kind)) {
          throw new Error(`unknown kind: ${v} (expected ${KINDS.join("|")})`);
        }
        kind = v as Kind;
        break;
      }
      case "--out": out = next(); break;
      case "--": break; /* pnpm run forwards a bare -- separator; ignore it. */
      default: throw new Error(`unknown argument: ${arg}`);
    }
  }
  return { kind, out };
}

/** Render the requested spoiler kind (or all four, concatenated). */
export function renderSpoiler(
  pack: ReturnType<typeof loadGamePack>,
  kind: Kind,
): string {
  switch (kind) {
    case "obj": return spoilObjDesc(pack);
    case "artifact": return spoilArtifact(pack);
    case "mon-desc": return spoilMonDesc(pack);
    case "mon-info": return spoilMonInfo(pack);
    case "all":
      return (
        spoilObjDesc(pack) +
        spoilArtifact(pack) +
        spoilMonDesc(pack) +
        spoilMonInfo(pack)
      );
  }
}

function main(): void {
  const { kind, out } = parseArgs(process.argv.slice(2));
  const pack = loadGamePack();
  const text = renderSpoiler(pack, kind);
  if (out) {
    writeFileSync(out, text);
    process.stderr.write(`spoil: wrote ${out} (${kind})\n`);
  } else {
    process.stdout.write(text);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
