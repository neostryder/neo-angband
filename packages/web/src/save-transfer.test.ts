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
  applyCodec,
  encodeSavedGame,
  saveGame,
  stampSavefile,
  startGame,
  type SavedGame,
} from "@rpgm-tools/neo-angband-core";
import { gzipSync } from "fflate";
import { loadGamePack } from "./pack";
import { gzipCodec } from "./save-codec";
import {
  TRANSFER_EXT,
  TRANSFER_MAGIC,
  TRANSFER_VERSION,
  MAX_TRANSFER_DECOMPRESSED_BYTES,
  MAX_TRANSFER_SAVE_BYTES,
  MAX_TRANSFER_TEXT_BYTES,
  decodeTransfer,
  encodeTransfer,
  peekTransferMeta,
  transferFilename,
  type TransferMeta,
} from "./save-transfer";

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

const MINIMAL_SAVE = {
  version: 1,
  player: {},
  actor: {},
  gear: {},
  rng: {},
  turn: 0,
  playing: true,
  isDead: false,
  flavor: {},
} as SavedGame;

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
  save: bytesToBase64(encodeSavedGame(MINIMAL_SAVE, undefined, gzipCodec)),
  engine: "0.10.0",
  exportedAt: "2026-07-31T12:00:00.000Z",
  lineage: "lin-grond",
});

/** A character file from the build that wrote magic, version and base64 slot bytes. */
function legacyFile(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    magic: TRANSFER_MAGIC,
    version: TRANSFER_VERSION,
    engine: "0.10.0",
    exportedAt: "2026-07-31T12:00:00.000Z",
    lineage: "lin-grond",
    meta: META,
    save: bytesToBase64(stampSavefile(applyCodec(new TextEncoder().encode(JSON.stringify(MINIMAL_SAVE)), gzipCodec))),
    ...over,
  });
}

describe("a character survives the round trip", () => {
  it("carries the save back, and an older file's slot bytes unchanged", () => {
    const r = decodeTransfer(FILE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const embedded = JSON.parse(FILE).data.save as { version: number; turn: number };
    expect(embedded.version).toBe(1);
    expect(embedded.turn).toBe(0);
    const old = legacyFile();
    const legacy = decodeTransfer(old);
    expect(legacy.ok && legacy.file.save).toBe(JSON.parse(old).save);
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
    const document = JSON.parse(FILE) as { data: { meta: object } };
    expect(document).not.toHaveProperty("id");
    expect(document.data).not.toHaveProperty("id");
    expect(document.data.meta).not.toHaveProperty("id");
  });

  it("is a file a human can open", () => {
    expect(FILE).toContain("\n");
    expect(FILE.endsWith("\n")).toBe(true);
    expect(JSON.parse(FILE).format).toBe("neo-angband/web/character-export");
    expect(JSON.parse(FILE).schemaVersion).toBe(1);
  });

  it("does not turn a failed integrity stamp into a verified save", () => {
    const bytes = encodeSavedGame(MINIMAL_SAVE, undefined, gzipCodec);
    bytes[bytes.length - 1] = bytes[bytes.length - 1] === 48 ? 49 : 48;
    const original = bytesToBase64(bytes);
    const file = encodeTransfer({
      meta: META,
      save: original,
      engine: "0.10.0",
      exportedAt: "2026-07-31T12:00:00.000Z",
      lineage: "lin-grond",
    });
    expect((JSON.parse(file) as { data: { save: string } }).data.save).toBe(original);
  });
});

describe("what it refuses, and how it says so", () => {
  it("accepts a normal-sized save exported from a real game", () => {
    const game = startGame(loadGamePack(), { seed: 20260823, depth: 1 });
    const save = bytesToBase64(encodeSavedGame(saveGame(game), undefined, gzipCodec));
    const text = encodeTransfer({
      meta: META,
      save,
      engine: "0.10.0",
      exportedAt: "2026-07-31T12:00:00.000Z",
      lineage: "lin-grond",
    });
    expect(decodeTransfer(text).ok).toBe(true);
  });

  it("rejects a gzip payload that expands beyond the import limit", () => {
    const expanded = new TextEncoder().encode("x".repeat(MAX_TRANSFER_DECOMPRESSED_BYTES + 1));
    const compressed = applyCodec(gzipSync(expanded), gzipCodec);
    expect(compressed.length).toBeLessThan(MAX_TRANSFER_SAVE_BYTES);
    const text = encodeTransfer({
      meta: META,
      save: bytesToBase64(compressed),
      engine: "0.10.0",
      exportedAt: "2026-07-31T12:00:00.000Z",
      lineage: "lin-grond",
    });
    expect(text.length).toBeLessThan(MAX_TRANSFER_TEXT_BYTES);
    const result = decodeTransfer(text);
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.why).toContain("expands beyond");
  });

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
    const newer = JSON.parse(FILE) as { schemaVersion: number };
    newer.schemaVersion = 2;
    const r = decodeTransfer(JSON.stringify(newer));
    expect(r.ok === false && r.why).toContain("2");
    expect(r.ok === false && r.why).toContain("newer version of the game");
    const oldNewer = decodeTransfer(legacyFile({ version: TRANSFER_VERSION + 1 }));
    expect(oldNewer.ok === false && oldNewer.why).toContain(String(TRANSFER_VERSION + 1));
  });

  it("accepts a file from an OLDER format", () => {
    /* An older character file still imports. Refusing one would strand it. */
    expect(decodeTransfer(legacyFile({ version: 0 })).ok).toBe(true);
  });

  it("refuses a file with no save data rather than importing an empty slot", () => {
    const empty = JSON.parse(FILE) as { data: { save: unknown } };
    empty.data.save = "";
    const r = decodeTransfer(JSON.stringify(empty));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.why).toContain("no save data");
  });

  it("refuses a nameless character", () => {
    /* The one metadata field with no sensible default: a blank row in the picker
     * is indistinguishable from a corrupt roster. */
    const anon = JSON.parse(FILE) as { data: { meta: { name: string } } };
    anon.data.meta.name = "";
    expect(decodeTransfer(JSON.stringify(anon)).ok).toBe(false);
  });
});

describe("metadata off a disk is defended, not trusted", () => {
  it("clamps a nonsense level rather than putting NaN in the roster", () => {
    const bad = JSON.parse(legacyFile()) as { meta: { level: unknown; depth: number; turn: number } };
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
    const dead = JSON.parse(FILE) as { data: { meta: { alive: boolean } } };
    dead.data.meta.alive = false;
    const r = decodeTransfer(JSON.stringify(dead));
    expect(r.ok && r.file.meta.alive).toBe(false);
  });

  it("treats a missing alive flag as ALIVE", () => {
    /* Every file this build writes carries it, and a dead slot has no bytes to
     * export in the first place - so defaulting to dead would turn an old or
     * hand-made file into an unplayable tombstone. */
    const old = JSON.parse(legacyFile()) as { meta: { alive?: boolean } };
    delete old.meta.alive;
    const r = decodeTransfer(JSON.stringify(old));
    expect(r.ok && r.file.meta.alive).toBe(true);
  });
});

describe("import size limits", () => {
  it("rejects an oversized transfer envelope before parsing it", () => {
    const result = decodeTransfer(" ".repeat(MAX_TRANSFER_TEXT_BYTES + 1));
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.why).toContain("larger than");
  });

  it("rejects an oversized encoded save before base64 decoding it", () => {
    const result = decodeTransfer(
      legacyFile({ save: "A".repeat((MAX_TRANSFER_SAVE_BYTES * 4) / 3 + 4) }),
    );
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.why).toContain("save data is larger");
  });
});

describe("peekTransferMeta: ticket #24's cheap header read", () => {
  it("reads the same lineage and meta decodeTransfer would, without touching save bytes", () => {
    const r = peekTransferMeta(FILE);
    expect(r.ok).toBe(true);
    expect(r.ok && r.meta).toEqual(META);
    expect(r.ok && r.lineage).toBe("lin-grond");
    expect(r.ok && r.engine).toBe("0.10.0");
  });

  it("succeeds on a file whose save data decodeTransfer would refuse - it never looks at `save`", () => {
    /* The whole point: identifying a character costs a JSON.parse, not the
     * base64 decode and decompression decodeTransfer pays to actually import
     * one. Garbage save bytes prove peekTransferMeta never reaches for them. */
    const garbageDoc = JSON.parse(FILE) as { data: { save: unknown } };
    garbageDoc.data.save = "not base64 at all!!";
    const garbage = JSON.stringify(garbageDoc);
    expect(decodeTransfer(garbage).ok).toBe(false);
    const r = peekTransferMeta(garbage);
    expect(r.ok).toBe(true);
    expect(r.ok && r.meta.name).toBe("Grond");
  });

  it("refuses the same wrong-kind and newer-version files decodeTransfer refuses, with the same reasons", () => {
    const notJson = peekTransferMeta("not a file at all");
    expect(notJson.ok).toBe(false);
    expect(notJson.ok === false && notJson.why).toContain("not even JSON");

    const wrongKind = peekTransferMeta(JSON.stringify({ version: 1, save: "x" }));
    expect(wrongKind.ok === false && wrongKind.why).toContain("not a Neo Angband character file");

    const newerDoc = JSON.parse(FILE) as { schemaVersion: number };
    newerDoc.schemaVersion = TRANSFER_VERSION + 1;
    const newer = peekTransferMeta(JSON.stringify(newerDoc));
    expect(newer.ok === false && newer.why).toContain("newer version of the game");
  });

  it("has no lineage for a file written before that field existed - absent, not refused", () => {
    const noLineage = JSON.parse(FILE) as { data: { lineage?: string } };
    delete noLineage.data.lineage;
    const r = peekTransferMeta(JSON.stringify(noLineage));
    expect(r.ok).toBe(true);
    expect(r.ok && r.lineage).toBeUndefined();
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
