/**
 * Restore points: a copy of everything the game has stored, taken on the first
 * launch of each new version before that version changes any of it (#330).
 *
 * An update can rewrite stored data on its first launch. 1.20.0 moved every
 * character, setting and mod into a new storage origin and left part of it behind
 * (#329). A restore point is the folder-level copy that makes such a launch
 * undoable: Chromium's storage folders (localStorage, IndexedDB and the quota
 * database that indexes them) and the game's own writable folders.
 *
 * Folders, not a page-level export, because a file copy needs no knowledge of what
 * is inside. It carries every origin, every mod's database and every value type as
 * it is, including ones a later version adds.
 *
 * Nothing here may stop a launch. A restore point that cannot be written is logged
 * by the caller and the game starts anyway.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { lastRunVersionFormat, parseDocument, restorePointFormat, serializeDocument } from "@rpgm-tools/neo-angband-mod-sdk";

/** Where restore points are kept, inside the data folder. */
export const RESTORE_DIR = "restore-points";
/** How many restore points are kept. */
export const KEEP = 3;
/** In the user folder: the version that last launched with this data. */
export const LAST_RUN_FILE = "last-run-version.json";
/** Inside each restore point: what it is and when it was taken. */
export const INFO_FILE = "restore-point.json";
/** The command-line switch that restores one, as `--restore-point=<name>` or `=latest`. */
export const RESTORE_SWITCH = "--restore-point";

/** Chromium's storage folders, inside the session-data folder. */
const CHROMIUM_FOLDERS = ["Local Storage", "IndexedDB", "WebStorage"] as const;

export interface RestorePaths {
  /** The data folder (USER_BASE): restore points are made under it. */
  readonly base: string;
  /** Chromium's session-data folder, which holds CHROMIUM_FOLDERS. */
  readonly sessionDir: string;
  /** The game's writable folders (user, save, scores...), by the name they get inside a restore point. */
  readonly gameDirs: Readonly<Record<string, string>>;
}

export interface RestorePointInfo {
  /** The folder name, which is also what `--restore-point=` takes. */
  readonly name: string;
  readonly fromVersion?: string;
  readonly toVersion: string;
  readonly createdAt: number;
  readonly reason: "update" | "before-restore";
}

/** Every folder a restore point holds: its name inside the restore point, and where it lives. */
function sources(paths: RestorePaths): [string, string][] {
  return [
    ...CHROMIUM_FOLDERS.map((f): [string, string] => [`chromium/${f}`, path.join(paths.sessionDir, f)]),
    ...Object.entries(paths.gameDirs).map(([name, dir]): [string, string] => [`game/${name}`, dir]),
  ];
}

/** The version that last ran with this data, or undefined for none recorded. */
export function lastRunVersion(userDir: string): string | undefined {
  try {
    const parsed = parseDocument(fs.readFileSync(path.join(userDir, LAST_RUN_FILE), "utf8"), lastRunVersionFormat);
    return parsed.ok ? parsed.data.version : undefined;
  } catch {
    return undefined;
  }
}

export function rememberRunVersion(userDir: string, version: string): void {
  fs.mkdirSync(userDir, { recursive: true });
  fs.writeFileSync(path.join(userDir, LAST_RUN_FILE), serializeDocument(lastRunVersionFormat, { version }), "utf8");
}

/** `20260930-201500`, in UTC, so names sort in the order they were taken. */
function stamp(now: number): string {
  return new Date(now).toISOString().replace(/[-:]/gu, "").replace("T", "-").slice(0, 15);
}

/** The finished restore points, newest first. A copy that never finished is not one. */
export function listRestorePoints(base: string): RestorePointInfo[] {
  const dir = path.join(base, RESTORE_DIR);
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  const out: RestorePointInfo[] = [];
  for (const name of names) {
    try {
      const parsed = parseDocument(fs.readFileSync(path.join(dir, name, INFO_FILE), "utf8"), restorePointFormat);
      if (parsed.ok) out.push({ name, ...parsed.data });
    } catch {
      /* No info file: an unfinished copy, removed by the next prune. */
    }
  }
  return out.sort((a, b) => b.createdAt - a.createdAt || b.name.localeCompare(a.name));
}

/**
 * Copy everything into a new restore point and return its name, or null when there
 * is nothing stored yet (a first install has nothing to protect).
 *
 * Written under a `.partial` name and renamed once the info file is in, so a copy
 * cut short by a crash or a full disk never looks like a restore point.
 */
export function takeRestorePoint(
  paths: RestorePaths,
  info: { fromVersion: string | undefined; toVersion: string; reason: "update" | "before-restore" },
  now = Date.now(),
): string | null {
  const present = sources(paths).filter(([, from]) => fs.existsSync(from));
  if (present.length === 0) return null;
  const suffix = info.reason === "before-restore" ? "-before-restore" : "";
  const name = `${info.toVersion}-${stamp(now)}${suffix}`;
  const final = path.join(paths.base, RESTORE_DIR, name);
  const partial = `${final}.partial`;
  fs.rmSync(partial, { recursive: true, force: true });
  for (const [inside, from] of present) {
    fs.cpSync(from, path.join(partial, inside), { recursive: true });
  }
  fs.writeFileSync(
    path.join(partial, INFO_FILE),
    serializeDocument(restorePointFormat, {
      ...(info.fromVersion === undefined ? {} : { fromVersion: info.fromVersion }),
      toVersion: info.toVersion,
      createdAt: now,
      reason: info.reason,
    }),
    "utf8",
  );
  fs.rmSync(final, { recursive: true, force: true });
  fs.renameSync(partial, final);
  return name;
}

/**
 * Keep the newest KEEP restore points and delete the rest, along with any copy that
 * never finished. `spare` is never deleted: the restore point just restored from,
 * which the player may want to go back to again.
 */
export function pruneRestorePoints(base: string, spare: readonly string[] = []): string[] {
  const dir = path.join(base, RESTORE_DIR);
  const finished = listRestorePoints(base);
  const kept = new Set([...finished.slice(0, KEEP).map((p) => p.name), ...spare]);
  const removed: string[] = [];
  let names: string[];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return removed;
  }
  for (const name of names) {
    if (kept.has(name)) continue;
    fs.rmSync(path.join(dir, name), { recursive: true, force: true });
    removed.push(name);
  }
  return removed;
}

/** The value of `--restore-point=<name>`, or undefined when the switch is absent. */
export function requestedRestorePoint(argv: readonly string[]): string | undefined {
  for (const arg of argv) {
    if (arg.startsWith(`${RESTORE_SWITCH}=`)) return arg.slice(RESTORE_SWITCH.length + 1);
  }
  return undefined;
}

/**
 * Put a restore point's folders back in place of the current ones.
 *
 * The current state is saved first as a `before-restore` restore point, so a
 * restore can itself be undone. Each folder is copied in beside the one it replaces
 * and swapped in by rename, so a folder is either the old one or the restored one,
 * never half of each. A folder the restore point does not have is left alone.
 *
 * Throws when `name` names no restore point. Must run before anything opens the
 * storage: after the single-instance lock and before the first window.
 */
export function restoreFrom(
  paths: RestorePaths,
  name: string,
  currentVersion: string,
  now = Date.now(),
): { restored: string; safety: string | null } {
  const all = listRestorePoints(paths.base);
  const chosen = name === "latest" ? all.find((p) => p.reason === "update") ?? all[0] : all.find((p) => p.name === name);
  if (!chosen) throw new Error(`no restore point named "${name}" in ${path.join(paths.base, RESTORE_DIR)}`);
  const from = path.join(paths.base, RESTORE_DIR, chosen.name);
  const safety = takeRestorePoint(paths, { fromVersion: undefined, toVersion: currentVersion, reason: "before-restore" }, now);
  for (const [inside, target] of sources(paths)) {
    const saved = path.join(from, inside);
    if (!fs.existsSync(saved)) continue;
    const incoming = `${target}.restoring`;
    const outgoing = `${target}.replaced`;
    fs.rmSync(incoming, { recursive: true, force: true });
    fs.rmSync(outgoing, { recursive: true, force: true });
    fs.cpSync(saved, incoming, { recursive: true });
    if (fs.existsSync(target)) fs.renameSync(target, outgoing);
    fs.renameSync(incoming, target);
    fs.rmSync(outgoing, { recursive: true, force: true });
  }
  pruneRestorePoints(paths.base, [chosen.name, ...(safety === null ? [] : [safety])]);
  return { restored: chosen.name, safety };
}
