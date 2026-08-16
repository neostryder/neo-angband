/**
 * Moving an imported mod archive out of the way, and the name rules that go with it.
 *
 * SEPARATE FROM main.ts BECAUSE IT IS THE PART THAT CAN BE WRONG. The ipcMain
 * handler around this is Electron and cannot be unit-tested; the file operation is
 * plain `node:fs` and has three behaviours worth pinning: it refuses a name it does
 * not own, it never overwrites an archive already put aside, and it survives a
 * `mods/` folder that is a mount point or a junction - which is exactly what an
 * external mod manager's deploy target often is.
 *
 * IT MOVES, IT DOES NOT DELETE. The zip is the player's copy of somebody else's
 * work; the game took what it needed from it and has no business being the only
 * place it survives. That is the whole reason this module is not called `discard`
 * any more.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/** The subfolder of `mods/` that imported archives are moved into. */
export const IMPORTED_DIRNAME = "imported";

/**
 * Is this a name this process will touch inside the mods folder?
 *
 * The renderer supplies it, so it is checked as if it were hostile: one path segment,
 * no separators, no traversal, and the extension the import screen actually offers.
 * `path.basename` is not a substitute - it would turn `../../x.zip` into `x.zip` and
 * accept it, which is a check that repairs an attack into a success.
 */
export function isModZipName(name: unknown): name is string {
  return (
    typeof name === "string" &&
    name.length > 0 &&
    name.length <= 255 &&
    !name.includes("/") &&
    !name.includes("\\") &&
    !name.startsWith(".") &&
    !name.includes("\0") &&
    name.toLowerCase().endsWith(".zip")
  );
}

/**
 * A name in the archive folder that is not taken yet.
 *
 * Numbered rather than overwriting, and it matters: importing v2 of a mod whose v1
 * zip is already put aside must not destroy v1. The suffix goes before the extension
 * so the file still looks like what it is to anything that sorts or opens by one.
 *
 * Bounded, because a loop that cannot end has no business in a file operation. At a
 * hundred taken names the caller is told, and the archive stays where it is.
 */
export function freeArchiveName(dir: string, leaf: string): string | null {
  const dot = leaf.lastIndexOf(".");
  const stem = dot > 0 ? leaf.slice(0, dot) : leaf;
  const ext = dot > 0 ? leaf.slice(dot) : "";
  for (let n = 0; n < 100; n++) {
    const name = n === 0 ? leaf : `${stem}-${String(n)}${ext}`;
    if (!fs.existsSync(path.join(dir, name))) return name;
  }
  return null;
}

/** What the renderer is told. `to` is relative to the mods folder. */
export type ArchiveResult =
  | { readonly ok: true; readonly to: string }
  | { readonly ok: false; readonly error: string };

/**
 * Move one archive from `modsDir` into `modsDir/imported/`.
 *
 * AFTER THE INSTALL, NEVER BEFORE. The renderer calls this only once IndexedDB has
 * committed, because the two cannot be made atomic and only one order is survivable:
 * move-then-store loses track of the archive when storage refuses it, and
 * store-then-move leaves a file the player can tidy up themselves. Prefer the
 * wreckage that costs a tidy-up over the wreckage that costs the file.
 *
 * `lstat`, not `stat`: a symlink named `x.zip` is refused rather than followed, so
 * this cannot be talked into moving something from outside the folder it owns.
 */
export function archiveModZip(modsDir: string, leaf: unknown): ArchiveResult {
  if (!isModZipName(leaf)) return { ok: false, error: "that is not a mod archive's name" };
  const file = path.join(modsDir, leaf);
  const into = path.join(modsDir, IMPORTED_DIRNAME);
  try {
    if (!fs.lstatSync(file).isFile()) {
      return { ok: false, error: "that is not a file in the mods folder" };
    }
    fs.mkdirSync(into, { recursive: true });
    const name = freeArchiveName(into, leaf);
    if (name === null) {
      return { ok: false, error: `${IMPORTED_DIRNAME} already holds 100 copies of that name` };
    }
    const dest = path.join(into, name);
    try {
      fs.renameSync(file, dest);
    } catch {
      /* EXDEV: across a device boundary a rename cannot work at all. Copy first,
       * then remove the original - in that order, so a failure leaves the archive
       * where it was rather than nowhere. */
      fs.copyFileSync(file, dest);
      fs.unlinkSync(file);
    }
    return { ok: true, to: `${IMPORTED_DIRNAME}/${name}` };
  } catch (err) {
    /* Answered, not thrown. The mod is already installed by the time this runs, so
     * the screen has to say "installed, but the zip is still where it was" - which it
     * can only do if it is told why. */
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
