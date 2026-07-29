/**
 * The loopback port, and why it is not allowed to change.
 *
 * THE BUG THIS EXISTS TO FIX. The renderer is served over `http://127.0.0.1:<port>`
 * (see startServer for why HTTP), and the port was ephemeral - `listen(0)`, a
 * different number every launch. A port is part of a web ORIGIN, and localStorage
 * is partitioned per origin. The web build keeps the character roster in
 * localStorage. So every launch of the desktop build opened a brand-new, empty
 * storage area: no character could ever be resumed, a character created and saved
 * was gone at the next launch, and nothing anywhere reported an error, because
 * nothing had failed - the game was reading a different, genuinely empty store.
 *
 * Measured in a real install's profile before the fix: five distinct origins,
 * `http://127.0.0.1:{49494,54979,61038,61806,63457}`, one per launch, in one
 * Chromium profile.
 *
 * Under decision 16 (no save-scumming; death is permanent) this is the worst class
 * of defect the platform can produce, so the port is now resolved once, PERSISTED,
 * and a failure to bind it is a visible error rather than a silent fallback to a
 * different number - a fallback would hide the player's characters exactly as the
 * ephemeral port did.
 *
 * Existing installs are not abandoned: the origins already in the profile are
 * discovered here and handed to origin-merge.ts, which moves the characters found
 * in them into the stable origin.
 *
 * Deliberately NOT "adopt the newest origin and carry on". That was the first plan
 * and measuring killed it: in the install that reported the bug the newest origin
 * held only a stale active pointer, while the three surviving characters were in
 * the two before it. A single origin cannot be the answer when the characters are
 * spread over several - they have to be brought together.
 *
 * Upstream has no analogue - it has no browser engine and no origins - so the
 * governing rule is the ratified platform one: a NECESSARY accommodation for the
 * new platform belongs in the port proper, and this is as necessary as it gets.
 * The durable fix is Phase 5 (real savefiles through the host bridge, where a save
 * is a file and no origin can hide it); this makes the current shape safe until
 * then, and stays useful afterwards for every other thing localStorage holds.
 *
 * A pure function over injected inputs, like data-dir.ts, so the whole decision is
 * testable without launching Electron.
 */

import * as fs from "node:fs";
import * as path from "node:path";

/** Overrides everything, and is remembered once used. */
export const PORT_ENV = "NEO_ANGBAND_PORT";

/** Where the choice is remembered, under the ANGBAND_DIR_USER tree. */
export const PORT_FILE = "loopback-port.txt";

/**
 * The port a fresh install takes.
 *
 * Unassigned by IANA and outside the range Windows hands out for ephemeral
 * sockets by default (49152-65535), so an unrelated program is unlikely to be
 * holding it and the game is unlikely to be handed it by accident either.
 */
export const DEFAULT_PORT = 45871;

export type PortSource =
  /** NEO_ANGBAND_PORT named it. */
  | "env"
  /** Remembered from a previous launch. */
  | "file"
  /** No choice recorded yet: the constant above. */
  | "default";

export interface PortChoice {
  readonly port: number;
  readonly source: PortSource;
  /**
   * Every loopback origin found in the profile, newest first. Reported so a
   * player whose characters are in an older one can name it with NEO_ANGBAND_PORT
   * rather than having to guess.
   */
  readonly known: readonly number[];
}

export interface PortInputs {
  readonly env: Readonly<Record<string, string | undefined>>;
  /** The ANGBAND_DIR_USER directory, where the choice is remembered. */
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

/** A port number that can actually be bound, or null. */
function parsePort(text: string | null): number | null {
  if (text === null) return null;
  const trimmed = text.trim();
  /* Strict, where atoi() would be lenient: "45871x" must not quietly become
   * 45871. This value decides which storage area the characters are in, so a
   * typo has to be rejected and reported, not half-honoured. */
  if (!/^\d{1,5}$/.test(trimmed)) return null;
  const n = Number.parseInt(trimmed, 10);
  /* Port 0 is exactly the ephemeral request this module exists to stop, so it is
   * rejected rather than honoured. */
  if (!Number.isInteger(n) || n < 1 || n > 65535) return null;
  return n;
}

/**
 * The loopback origins this profile has stored anything under, newest first.
 *
 * Read out of Chromium's localStorage LevelDB by scanning for the origin strings
 * its keys are prefixed with (`_http://127.0.0.1:54979\0\1<key>`). Deliberately a
 * text scan and not a LevelDB read: this runs before the window opens, on a
 * database Chromium owns, and the only question being asked is which origins
 * appear - a question the key bytes answer without a parser, a dependency, or any
 * risk of touching the file. Values live in Snappy-compressed blocks and are NOT
 * read here; they are not needed and must not be disturbed.
 *
 * Newest FILE first, because the write-ahead log is the newest file and holds the
 * most recent launch's writes.
 */
export function discoverStorageOrigins(inputs: PortInputs): readonly number[] {
  const readDir = inputs.readDirNewestFirst ?? readDirNewestFirst;
  const dir = path.join(inputs.sessionDir, "Local Storage", "leveldb");
  const ports: number[] = [];
  for (const file of readDir(dir)) {
    const ext = path.extname(file).toLowerCase();
    if (ext !== ".ldb" && ext !== ".log") continue;
    let text: string;
    try {
      /* latin1: the bytes are read as bytes. A utf8 decode would mangle the
       * binary record framing around the keys and could break a match. */
      text = fs.readFileSync(file, "latin1");
    } catch {
      continue;
    }
    for (const m of text.matchAll(/http:\/\/127\.0\.0\.1:(\d{1,5})/g)) {
      const port = parsePort(m[1] ?? null);
      if (port !== null && !ports.includes(port)) ports.push(port);
    }
  }
  return ports;
}

/**
 * Resolve the port: an explicit request, then the remembered one, then the default.
 * Origins already in the profile are reported but never chosen - see the header.
 */
export function resolveLoopbackPort(inputs: PortInputs): PortChoice {
  const readFile = inputs.readFile ?? readFileOrNull;
  const known = discoverStorageOrigins(inputs);

  const fromEnv = parsePort(inputs.env[PORT_ENV] ?? null);
  if (fromEnv !== null) return { port: fromEnv, source: "env", known };

  const fromFile = parsePort(readFile(path.join(inputs.userDir, PORT_FILE)));
  if (fromFile !== null) return { port: fromFile, source: "file", known };

  return { port: DEFAULT_PORT, source: "default", known };
}

/**
 * Remember the choice, including an explicit one.
 *
 * An env override is persisted too, deliberately. The alternative - honour it for
 * one launch and silently revert - is the same shape of trap as the ephemeral
 * port: the characters written during that launch would become invisible at the
 * next one. Best effort: failing to record it costs the next launch a repair from
 * `adopted`, not any data.
 */
export function rememberLoopbackPort(userDir: string, port: number): void {
  try {
    fs.mkdirSync(userDir, { recursive: true });
    fs.writeFileSync(path.join(userDir, PORT_FILE), `${port}\n`, "utf8");
  } catch {
    /* best effort */
  }
}
