/**
 * Carrying one character from one copy of the game to another.
 *
 * WHY THIS IS NEEDED AT ALL, and it is not the reason most people would guess.
 * The desktop build is the SAME web bundle running inside Electron, and it keeps
 * the roster in localStorage exactly as a browser tab does - partitioned by the
 * loopback origin the shell serves it from (packages/desktop/src/loopback-port.ts).
 * So "install the desktop build" does not move a character to it, and neither
 * does using a second browser, a second profile, or a phone. Measured, not
 * assumed: writeSlot goes to localStorage on both platforms, and nothing about
 * the desktop host's real-file capability touches the roster.
 *
 * So a transfer needs a FILE, and the file needs to say what it is. This module
 * is that format and nothing else - no storage, no UI - because the two ends are
 * written months apart and the only thing keeping them agreeing is a shape both
 * of them read from one place.
 *
 * WHAT IS IN IT. The save bytes, base64, exactly as the slot holds them, plus the
 * roster metadata so the receiving picker can show the character without decoding
 * a save it may not be able to read yet. The metadata is a CONVENIENCE and is
 * treated as such - it is re-derived from the game the first time that character
 * is saved, so a hand-edited level number is a cosmetic lie that lasts one turn,
 * not a cheat.
 *
 * WHAT IS DELIBERATELY NOT IN IT: the slot id. An id is unique to the roster it
 * came from, and honouring one from a file would let an import silently overwrite
 * a character already in that slot. The importer allocates a new id, always.
 *
 * WHAT IS IN IT INSTEAD, and the distinction is the whole of the anti-scum story:
 * the LINEAGE - who the character is, rather than which slot they were in. It
 * survives the trip, so the receiving roster can tell "this is my Bilbo, from
 * another surface" from "this is a stranger called Bilbo". transfer-gate.ts is
 * what does the telling; this module only carries the field.
 *
 * NO SAVE-SCUMMING GUARANTEE IS BROKEN BY THIS, and it is worth being exact
 * rather than reassuring. What decision 16 forbids is the GAME offering a restore:
 * no in-game restore point, no reload-on-death, and death still turns a slot into
 * a tombstone. An imported dead character stays dead - `alive: false` travels with
 * the metadata and the bytes of a dead slot are gone before an export can see
 * them - and with the lineage in hand, transfer-gate.ts also refuses a file from
 * before a death this roster remembers, and one that is no further along than the
 * copy already here. What is still possible: a second install that never saw the
 * death, and a hand-edited lineage. transfer-gate.ts's head comment says why
 * neither is worth engineering against.
 */

/** The current file format. Bumped only when an older file would be MISREAD. */
export const TRANSFER_VERSION = 1;

/** What the file says it is, so a wrong file is refused rather than parsed. */
export const TRANSFER_MAGIC = "neo-angband-character";

/** The extension the exporter suggests. */
export const TRANSFER_EXT = ".neochar";

/** The roster fields that travel with the bytes. */
export interface TransferMeta {
  readonly name: string;
  readonly race: string;
  readonly cls: string;
  readonly sex: string;
  readonly level: number;
  readonly depth: number;
  readonly maxDepth: number;
  readonly turn: number;
  readonly alive: boolean;
}

export interface TransferFile {
  readonly magic: typeof TRANSFER_MAGIC;
  readonly version: number;
  /** The engine that wrote it, for a human reading the file and for the refusal message. */
  readonly engine: string;
  readonly exportedAt: string;
  readonly meta: TransferMeta;
  /** The slot's save bytes, base64, byte-for-byte as the slot holds them. */
  readonly save: string;
  /**
   * Who this character is (roster.ts's `lineage`), so a receiving roster can
   * recognise its own character coming back.
   *
   * Optional on the READ side only, and it stays optional: files written before
   * this field existed are still importable, and a build that meets one treats it
   * as a character it has never seen - which is what it was doing already.
   */
  readonly lineage?: string;
}

/** Serialise one character. Pretty-printed: this is a file a human may open. */
export function encodeTransfer(input: {
  readonly meta: TransferMeta;
  readonly save: string;
  readonly engine: string;
  readonly exportedAt: string;
  readonly lineage: string;
}): string {
  const file: TransferFile = {
    magic: TRANSFER_MAGIC,
    version: TRANSFER_VERSION,
    engine: input.engine,
    exportedAt: input.exportedAt,
    lineage: input.lineage,
    meta: input.meta,
    save: input.save,
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** A filename a player will recognise a week later, safe on every filesystem. */
export function transferFilename(meta: TransferMeta): string {
  const safe = meta.name.replace(/[^\w.-]+/gu, "-").replace(/^-+|-+$/gu, "");
  return `${safe || "character"}-L${String(meta.level)}${TRANSFER_EXT}`;
}

export type TransferResult =
  | { readonly ok: true; readonly file: TransferFile }
  | { readonly ok: false; readonly why: string };

/**
 * Read a transfer file, or say why it is not one.
 *
 * Never throws, and every refusal names what was wrong with THIS file: the
 * player picked it out of a file dialog, so "invalid" alone leaves them guessing
 * between the wrong file, a truncated download and a version they cannot use.
 */
export function decodeTransfer(text: string): TransferResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return {
      ok: false,
      why: `that file is not a character file - it is not even JSON (${
        e instanceof Error ? e.message : String(e)
      })`,
    };
  }
  if (raw === null || typeof raw !== "object") {
    return { ok: false, why: "that file is not a character file" };
  }
  const o = raw as Record<string, unknown>;
  if (o["magic"] !== TRANSFER_MAGIC) {
    /* Checked before the version, so a save file, a pref file or somebody's
     * unrelated JSON is refused as the wrong KIND of thing rather than as a
     * version problem the player might try to solve. */
    return { ok: false, why: "that file is not a Neo Angband character file" };
  }
  const version = o["version"];
  if (typeof version !== "number" || !Number.isInteger(version)) {
    return { ok: false, why: "that character file does not say which format it is in" };
  }
  if (version > TRANSFER_VERSION) {
    return {
      ok: false,
      why:
        `that character file is format ${String(version)} and this build reads ` +
        `${String(TRANSFER_VERSION)} - it was written by a newer version of the game`,
    };
  }
  const save = o["save"];
  if (typeof save !== "string" || save.length === 0) {
    return { ok: false, why: "that character file carries no save data" };
  }
  const meta = readMeta(o["meta"]);
  if (!meta) {
    return { ok: false, why: "that character file's details are missing or malformed" };
  }
  return {
    ok: true,
    file: {
      magic: TRANSFER_MAGIC,
      version,
      engine: typeof o["engine"] === "string" ? o["engine"] : "unknown",
      exportedAt: typeof o["exportedAt"] === "string" ? o["exportedAt"] : "",
      /* Absent or the wrong type reads as absent, NOT as a refusal: the gate that
       * uses this treats a file with no lineage as a character it has not met,
       * which is the pre-lineage behaviour and is safe. */
      ...(typeof o["lineage"] === "string" && o["lineage"] !== ""
        ? { lineage: o["lineage"] }
        : {}),
      meta,
      save,
    },
  };
}

/**
 * The metadata, defended field by field, or null when the shape is wrong.
 *
 * Every number is clamped to something the picker can render rather than
 * trusted: this file came off a disk, and a NaN level or a negative depth would
 * become a roster row that reads as corruption of the player's own save list.
 */
function readMeta(v: unknown): TransferMeta | null {
  if (v === null || typeof v !== "object") return null;
  const m = v as Record<string, unknown>;
  const str = (k: string): string => (typeof m[k] === "string" ? (m[k] as string) : "");
  const num = (k: string): number => {
    const n = m[k];
    return typeof n === "number" && Number.isFinite(n) ? Math.max(0, Math.trunc(n)) : 0;
  };
  const name = str("name");
  if (name === "") return null; // the one field with no sensible default
  return {
    name,
    race: str("race"),
    cls: str("cls"),
    sex: str("sex"),
    level: num("level"),
    depth: num("depth"),
    maxDepth: num("maxDepth"),
    turn: num("turn"),
    /* Absent reads as ALIVE, because every file this build writes carries the
     * field and a dead slot has no bytes to export in the first place. Defaulting
     * to dead would turn an old or hand-made file into an unplayable tombstone. */
    alive: m["alive"] !== false,
  };
}
