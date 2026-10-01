/**
 * The `http://127.0.0.1:<port>` origins older builds stored characters under.
 *
 * Builds before the `neo-angband://game` origin (app-origin.ts) served the game
 * over a loopback port, and the port was part of the origin. The earliest of them
 * took a new ephemeral port every launch, so one profile can hold many such
 * origins: five were measured in the install that reported it,
 * `http://127.0.0.1:{49494,54979,61038,61806,63457}`, with three living characters
 * spread over two of them. Later builds remembered one port in
 * `user/loopback-port.json` and moved to the next free one when it was taken.
 *
 * This module only finds those origins. recoverStrandedOrigins in main.ts reads each
 * one once and merges what it holds into the current origin (origin-merge.ts). The
 * port a copy used last comes first, because it holds the newest settings and the
 * merge keeps the first value it sees for a setting.
 *
 * Nothing here writes. The remembered port file is left in place, so a player who
 * goes back to an older build still finds that build's own storage.
 *
 * A pure function over injected inputs, like data-dir.ts, so the whole decision is
 * testable without launching Electron.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { loopbackPortFormat, parseDocument } from "@rpgm-tools/neo-angband-mod-sdk";

/** Where older builds remembered their port, under the ANGBAND_DIR_USER tree. */
export const PORT_FILE = "loopback-port.json";
export const LEGACY_PORT_FILE = "loopback-port.txt";

/** The port older builds took when none was remembered. */
export const DEFAULT_PORT = 45871;

export interface OriginInputs {
  /** The ANGBAND_DIR_USER directory, where the port was remembered. */
  readonly userDir: string;
  /** Chromium's session data directory: app.getPath("sessionData"). */
  readonly sessionDir: string;
  readonly readFile?: (p: string) => string | null;
  readonly readDirNewestFirst?: (p: string) => readonly string[];
}

function readFileOrNull(p: string): string | null {
  try {
    return fs.readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

/** Directory entries as absolute paths, most recently modified first. */
function readDirNewestFirst(dir: string): readonly string[] {
  try {
    return fs
      .readdirSync(dir)
      .map((name) => path.join(dir, name))
      .map((p) => ({ p, mtime: fs.statSync(p).mtimeMs }))
      .sort((a, b) => b.mtime - a.mtime)
      .map((e) => e.p);
  } catch {
    return [];
  }
}

/** A port number, or null. Strict: "45871x" is not 45871, and 0 is not a port. */
function parsePort(text: string | null): number | null {
  if (text === null) return null;
  const trimmed = text.trim();
  if (!/^\d{1,5}$/.test(trimmed)) return null;
  const n = Number.parseInt(trimmed, 10);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return null;
  return n;
}

/**
 * The loopback origins this profile has stored anything under, newest first.
 *
 * Two places are read. localStorage's LevelDB is scanned for the origin strings
 * its keys start with (`_http://127.0.0.1:54979\0\1<key>`), newest file first,
 * because the write-ahead log is the newest file and holds the last launch's
 * writes. IndexedDB keeps one folder per origin
 * (`http_127.0.0.1_54979.indexeddb.leveldb`), which catches an origin that holds
 * installed mods and nothing in localStorage.
 *
 * A text scan, not a LevelDB read: this runs before any window opens, on files
 * Chromium owns, and the only question is which origins appear. It can prove an
 * origin is there and never that one is absent, which is why the remembered port
 * is added by legacyPorts whether or not it is found here.
 */
export function discoverStorageOrigins(inputs: OriginInputs): readonly number[] {
  const readDir = inputs.readDirNewestFirst ?? readDirNewestFirst;
  const ports: number[] = [];
  const add = (text: string | undefined): void => {
    const port = parsePort(text ?? null);
    if (port !== null && !ports.includes(port)) ports.push(port);
  };
  for (const file of readDir(path.join(inputs.sessionDir, "Local Storage", "leveldb"))) {
    const ext = path.extname(file).toLowerCase();
    if (ext !== ".ldb" && ext !== ".log") continue;
    let text: string;
    try {
      /* latin1, so the bytes around the keys are read as bytes and a utf8 decode
       * cannot break a match. */
      text = fs.readFileSync(file, "latin1");
    } catch {
      continue;
    }
    for (const m of text.matchAll(/http:\/\/127\.0\.0\.1:(\d{1,5})/g)) add(m[1]);
  }
  for (const dir of readDir(path.join(inputs.sessionDir, "IndexedDB"))) {
    add(/^http_127\.0\.0\.1_(\d{1,5})\.indexeddb\.leveldb$/.exec(path.basename(dir))?.[1]);
  }
  return ports;
}

/** The port an older build used last: the remembered one, or the default. */
export function lastLoopbackPort(inputs: OriginInputs): number {
  const readFile = inputs.readFile ?? readFileOrNull;
  const current = readFile(path.join(inputs.userDir, PORT_FILE));
  if (current !== null) {
    const parsed = parseDocument(current, loopbackPortFormat);
    const port = parsed.ok ? parsePort(String(parsed.data.port)) : null;
    if (port !== null) return port;
  }
  return parsePort(readFile(path.join(inputs.userDir, LEGACY_PORT_FILE))) ?? DEFAULT_PORT;
}

/** Every old origin to carry over, the one used last first. */
export function legacyPorts(inputs: OriginInputs): readonly number[] {
  const last = lastLoopbackPort(inputs);
  return [last, ...discoverStorageOrigins(inputs).filter((p) => p !== last)];
}
