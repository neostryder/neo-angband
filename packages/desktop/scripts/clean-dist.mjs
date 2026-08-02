/**
 * Empty dist-desktop before electron-builder fills it.
 *
 * electron-builder overwrites the files it produces and leaves everything else
 * alone, so a directory that has seen more than one version accumulates them:
 * a `Neo Angband-0.1.0-portable.exe` from July was still sitting beside the
 * current build months later, indistinguishable from it in a file listing
 * except by a version number nobody reads before double-clicking. In CI it is a
 * fresh checkout and this does nothing; on a laptop it is the difference
 * between "the installer folder" and "an archive of every build I ever made".
 */

import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as path from "node:path";

const out = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "dist-desktop",
);
rmSync(out, { recursive: true, force: true });
console.log(`cleaned ${out}`);
