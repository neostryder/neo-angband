/**
 * The character-transfer file: what it carries, and what it refuses.
 *
 * THE FACT THAT MAKES THIS NECESSARY, and it is not obvious: the desktop build
 * is this same web bundle inside Electron and keeps its roster in localStorage
 * too, partitioned by the loopback origin the shell serves it from. Installing
 * the desktop build therefore does NOT bring your characters with it, and
 * neither does a second browser or a second profile. A file is the only route,
 * so the file has to be right.
 *
 * The refusals get more attention than the happy path, because every one of them
 * is a player standing in a file dialog having picked the wrong thing, and
 * "invalid file" leaves them choosing between three explanations.
 */

import { describe, expect, it } from "vitest";
import {
  TRANSFER_EXT,
  TRANSFER_MAGIC,
  TRANSFER_VERSION,
  decodeTransfer,
  encodeTransfer,
  transferFilename,
  type TransferMeta,
} from "./save-transfer";

const META: TransferMeta = {
  name: "Grond",
  race: "Half-Troll",
  cls: "Warrior",
  sex: "Male",
  level: 17,
  depth: 12,
  maxDepth: 14,
  turn: 41_233,
  alive: true,
};

const FILE = encodeTransfer({
  meta: META,
  save: "AAECAwQ=",
  engine: "0.10.0",
  exportedAt: "2026-07-31T12:00:00.000Z",
  lineage: "lin-grond",
});

describe("a character survives the round trip", () => {
  it("carries the save bytes back byte-for-byte", () => {
    const r = decodeTransfer(FILE);
    expect(r.ok).toBe(true);
    expect(r.ok && r.file.save).toBe("AAECAwQ=");
  });

  it("carries every roster field the picker shows", () => {
    const r = decodeTransfer(FILE);
    expect(r.ok && r.file.meta).toEqual(META);
  });

  it("records the engine that wrote it and when", () => {
    const r = decodeTransfer(FILE);
    expect(r.ok && r.file.engine).toBe("0.10.0");
    expect(r.ok && r.file.exportedAt).toBe("2026-07-31T12:00:00.000Z");
  });

  it("carries NO slot id", () => {
    /* An id belongs to the roster it came from. Honouring one from a file would
     * let an import land on top of a character already in that slot - and the
     * case a player will actually hit is importing the same file twice. */
    expect(JSON.parse(FILE)).not.toHaveProperty("id");
    expect(JSON.parse(FILE).meta).not.toHaveProperty("id");
  });

  it("is a file a human can open", () => {
    expect(FILE).toContain("\n");
    expect(FILE.endsWith("\n")).toBe(true);
    expect(JSON.parse(FILE).magic).toBe(TRANSFER_MAGIC);
    expect(JSON.parse(FILE).version).toBe(TRANSFER_VERSION);
  });
});

describe("what it refuses, and how it says so", () => {
  it("refuses something that is not JSON, saying that", () => {
    const r = decodeTransfer("not a file at all");
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.why).toContain("not even JSON");
  });

  it("refuses the WRONG KIND of file before mentioning versions", () => {
    /* A pref file, a save, somebody's unrelated JSON. Reporting a version
     * problem here would send the player looking for a newer game. */
    const r = decodeTransfer(JSON.stringify({ version: 1, save: "x" }));
    expect(r.ok === false && r.why).toContain("not a Neo Angband character file");
    expect(r.ok === false && r.why).not.toMatch(/format|version/u);
  });

  it("refuses a file from a NEWER game, and says which format it is", () => {
    const newer = JSON.stringify({ ...JSON.parse(FILE), version: TRANSFER_VERSION + 1 });
    const r = decodeTransfer(newer);
    expect(r.ok === false && r.why).toContain(String(TRANSFER_VERSION + 1));
    expect(r.ok === false && r.why).toContain("newer version of the game");
  });

  it("accepts a file from an OLDER format", () => {
    /* Nothing to migrate yet, and refusing one would be inventing a
     * compatibility break that has not happened. */
    const older = JSON.stringify({ ...JSON.parse(FILE), version: 0 });
    expect(decodeTransfer(older).ok).toBe(true);
  });

  it("refuses a file with no save data rather than importing an empty slot", () => {
    const r = decodeTransfer(JSON.stringify({ ...JSON.parse(FILE), save: "" }));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.why).toContain("no save data");
  });

  it("refuses a nameless character", () => {
    /* The one metadata field with no sensible default: a blank row in the picker
     * is indistinguishable from a corrupt roster. */
    const anon = JSON.parse(FILE);
    anon.meta.name = "";
    expect(decodeTransfer(JSON.stringify(anon)).ok).toBe(false);
  });
});

describe("metadata off a disk is defended, not trusted", () => {
  it("clamps a nonsense level rather than putting NaN in the roster", () => {
    const bad = JSON.parse(FILE);
    bad.meta.level = "seventeen";
    bad.meta.depth = -5;
    bad.meta.turn = Number.POSITIVE_INFINITY;
    const r = decodeTransfer(JSON.stringify(bad));
    expect(r.ok).toBe(true);
    expect(r.ok && r.file.meta.level).toBe(0);
    expect(r.ok && r.file.meta.depth).toBe(0);
    expect(r.ok && r.file.meta.turn).toBe(0);
  });

  it("keeps a dead character dead", () => {
    /* Decision 16 is not enforced by this module - a file can always be copied,
     * exactly as a .sav can in upstream - but the flag travels, so an imported
     * tombstone arrives as a tombstone rather than as a playable character. */
    const dead = JSON.parse(FILE);
    dead.meta.alive = false;
    const r = decodeTransfer(JSON.stringify(dead));
    expect(r.ok && r.file.meta.alive).toBe(false);
  });

  it("treats a missing alive flag as ALIVE", () => {
    /* Every file this build writes carries it, and a dead slot has no bytes to
     * export in the first place - so defaulting to dead would turn an old or
     * hand-made file into an unplayable tombstone. */
    const old = JSON.parse(FILE);
    delete old.meta.alive;
    const r = decodeTransfer(JSON.stringify(old));
    expect(r.ok && r.file.meta.alive).toBe(true);
  });
});

describe("the filename", () => {
  it("names the character and the level", () => {
    expect(transferFilename(META)).toBe(`Grond-L17${TRANSFER_EXT}`);
  });

  it("survives a name a filesystem would not take", () => {
    const messy = { ...META, name: 'A/B\\C:*?"<>|D' };
    const name = transferFilename(messy);
    expect(name).not.toMatch(/[/\\:*?"<>|]/u);
    expect(name.endsWith(TRANSFER_EXT)).toBe(true);
  });

  it("still produces a filename for an unnamed character", () => {
    expect(transferFilename({ ...META, name: "???" })).toBe(`character-L17${TRANSFER_EXT}`);
  });
});
