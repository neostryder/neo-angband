/**
 * RawFs across a process boundary, with both ends defined in one file.
 *
 * WHY THIS EXISTS
 *
 * On the desktop build the filesystem and the game are in different processes:
 * Electron's renderer is sandboxed (no node:fs), and the main process is where
 * the real files are. So the game's host has to make a call across that gap.
 *
 * The client and the server are written here together, deliberately. A hand-
 * written pair on either side of an IPC channel is two things that must agree
 * about op names and argument order forever, and nothing checks that they do -
 * exactly the drift the RawFs/RawFsHost split exists to prevent. Here, one file
 * owns the wire format.
 *
 * WHY SYNCHRONOUS
 *
 * z-file.c is synchronous, and so is every caller of it. `prefs_save` writes
 * inside a menu handler; the panic-save writes from a signal handler; the game
 * loop reads a pref file inline. Making the host async would push `await` up
 * through the whole command layer and change the game's control flow to suit the
 * transport - the same mistake, in a new place, as letting the browser decide
 * what a file is. The writes here are a few kilobytes to a local disk.
 *
 * WHY THE CLIENT COERCES EVERYTHING
 *
 * The transport can fail in ways a function call cannot: the channel may not be
 * registered, the other end may be a different version, the reply may be
 * undefined. Every result is therefore narrowed to the type RawFs promises, and
 * anything unexpected becomes that operation's FAILURE value rather than an
 * exception. That is z-file.c's discipline - file_open returns NULL, it does not
 * die - and it is what keeps a broken bridge from throwing halfway through a save.
 */

import { FileType, HostDir } from "./io";
import type { WriteOutcome } from "./io";
import type { RawFs } from "./raw";

/**
 * One synchronous round trip: an operation name and its arguments in, whatever
 * the far end returned out. Deliberately untyped, because it is a wire.
 */
export type RawFsTransport = (op: string, args: readonly unknown[]) => unknown;

/** The operation names on the wire. Exported so a host can log or gate them. */
export const RAW_FS_OPS = [
  "displayPath",
  "isFile",
  "readText",
  "writeText",
  "unlink",
  "rename",
  "mtime",
  "listFiles",
] as const;

export type RawFsOp = (typeof RAW_FS_OPS)[number];

/** Whether a value is one of init.c's five writable directories. */
export function isHostDir(v: unknown): v is HostDir {
  return (
    v === HostDir.USER ||
    v === HostDir.SAVE ||
    v === HostDir.PANIC ||
    v === HostDir.SCORES ||
    v === HostDir.ARCHIVE
  );
}

/** Whether a value is a valid write outcome as it comes back off the wire. */
function toWriteOutcome(v: unknown): WriteOutcome {
  /* Anything unrecognised is the open failure: reporting "could not create it"
   * about a write that may not have happened is the safe direction. Claiming
   * success is the failure mode already recorded against persistSave. */
  return v === "ok" || v === "close-failed" ? v : "create-failed";
}

/**
 * The CLIENT half: a RawFs that forwards every call over a transport. Used in
 * the sandboxed renderer, where `send` is a synchronous IPC call.
 */
export function rawFsOverTransport(send: RawFsTransport): RawFs {
  /** A transport hop that turns a thrown transport error into a null result. */
  const call = (op: RawFsOp, args: readonly unknown[]): unknown => {
    try {
      return send(op, args);
    } catch {
      /* A dead channel must look like a failed syscall, not a crash. */
      return undefined;
    }
  };

  return {
    displayPath(dir, name) {
      const r = call("displayPath", [dir, name]);
      /* Display text only, so a broken bridge still produces something
       * printable rather than "undefined" inside a message. */
      return typeof r === "string" ? r : `${dir}/${name}`;
    },
    isFile(dir, name) {
      return call("isFile", [dir, name]) === true;
    },
    readText(dir, name) {
      const r = call("readText", [dir, name]);
      return typeof r === "string" ? r : null;
    },
    writeText(dir, name, text, append, ftype) {
      return toWriteOutcome(call("writeText", [dir, name, text, append, ftype]));
    },
    unlink(dir, name) {
      return call("unlink", [dir, name]) === true;
    },
    rename(dir, from, to) {
      return call("rename", [dir, from, to]) === true;
    },
    mtime(dir, name) {
      const r = call("mtime", [dir, name]);
      /* Not Number.isFinite on a non-number: NaN or Infinity would make
       * file_newer's comparison meaningless, so both are "cannot tell". */
      return typeof r === "number" && Number.isFinite(r) ? r : null;
    },
    listFiles(dir) {
      const r = call("listFiles", [dir]);
      if (!Array.isArray(r)) return [];
      return r.filter((e): e is string => typeof e === "string");
    },
  };
}

/**
 * The SERVER half: turns a real RawFs into a transport handler. Used in the
 * trusted process.
 *
 * Every argument is validated here, because they arrive from the renderer and
 * the renderer is the untrusted side. An unknown op or a malformed argument list
 * returns that operation's failure value rather than throwing, so a hostile or
 * buggy caller cannot take down the main process.
 */
export function serveRawFs(raw: RawFs): RawFsTransport {
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

  return (op: string, args: readonly unknown[]): unknown => {
    const dir = args[0];
    if (!isHostDir(dir)) {
      /* Not a directory we own. Report each op's failure value. */
      return op === "listFiles" ? [] : op === "readText" || op === "mtime" ? null
        : op === "writeText" ? "create-failed"
        : op === "displayPath" ? "" : false;
    }

    switch (op) {
      case "listFiles":
        return raw.listFiles(dir);
      case "displayPath": {
        const name = str(args[1]);
        return name === null ? "" : raw.displayPath(dir, name);
      }
      case "isFile": {
        const name = str(args[1]);
        return name === null ? false : raw.isFile(dir, name);
      }
      case "readText": {
        const name = str(args[1]);
        return name === null ? null : raw.readText(dir, name);
      }
      case "mtime": {
        const name = str(args[1]);
        return name === null ? null : raw.mtime(dir, name);
      }
      case "unlink": {
        const name = str(args[1]);
        return name === null ? false : raw.unlink(dir, name);
      }
      case "rename": {
        const from = str(args[1]);
        const to = str(args[2]);
        return from === null || to === null ? false : raw.rename(dir, from, to);
      }
      case "writeText": {
        const name = str(args[1]);
        const text = str(args[2]);
        if (name === null || text === null) return "create-failed";
        const append = args[3] === true;
        const ftype = typeof args[4] === "number" ? (args[4] as FileType) : FileType.TEXT;
        return raw.writeText(dir, name, text, append, ftype);
      }
      default:
        /* An op this server does not know. False is the least destructive
         * answer: it reads as "that did not work" to every boolean caller. */
        return false;
    }
  };
}
