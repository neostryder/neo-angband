/**
 * Finding the loopback origins older builds stored characters under.
 *
 * A missed origin is a character the merge never sees, and nothing reports it, so
 * these tests are about what is found and in what order.
 */

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  DEFAULT_PORT,
  LEGACY_PORT_FILE,
  PORT_FILE,
  discoverStorageOrigins,
  lastLoopbackPort,
  legacyPorts,
} from "./legacy-origins.js";
import { loopbackPortFormat, serializeDocument } from "@rpgm-tools/neo-angband-mod-sdk";

/** A profile whose localStorage LevelDB names the given origins. */
function profileWith(origins: readonly number[][]): string {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "neo-port-"));
  const db = path.join(base, "session", "Local Storage", "leveldb");
  fs.mkdirSync(db, { recursive: true });
  /* One file per group, written oldest first, so the newest file is the LAST group. */
  origins.forEach((group, i) => {
    const body = group
      .map((p) => `_http://127.0.0.1:${p}\u0000\u0001neo-angband-active`)
      .join("\u0000");
    const name = i === origins.length - 1 ? `00002${i}.log` : `00000${i}.ldb`;
    fs.writeFileSync(path.join(db, name), body, "latin1");
    /* Explicit mtimes, so two writes in one millisecond cannot leave the order to chance. */
    const t = new Date(1_700_000_000_000 + i * 60_000);
    fs.utimesSync(path.join(db, name), t, t);
  });
  return base;
}

function inputsFor(base: string) {
  return { userDir: path.join(base, "user"), sessionDir: path.join(base, "session") };
}

function remember(base: string, port: number): void {
  const userDir = path.join(base, "user");
  fs.mkdirSync(userDir, { recursive: true });
  fs.writeFileSync(path.join(userDir, PORT_FILE), serializeDocument(loopbackPortFormat, { port }), "utf8");
}

describe("old loopback origins", () => {
  it("finds every origin of the install that reported the ephemeral-port bug", () => {
    const base = profileWith([[63457], [61806], [61038], [49494], [54979]]);
    expect(discoverStorageOrigins(inputsFor(base))).toEqual([54979, 49494, 61038, 61806, 63457]);
  });

  it("orders by newest file, then by order of appearance within a file", () => {
    const base = profileWith([[61806, 61038], [54979]]);
    expect(discoverStorageOrigins(inputsFor(base))).toEqual([54979, 61806, 61038]);
  });

  it("finds an origin that has only IndexedDB, such as one holding just installed mods", () => {
    const base = profileWith([[54979]]);
    const idb = path.join(base, "session", "IndexedDB");
    fs.mkdirSync(path.join(idb, "http_127.0.0.1_45872.indexeddb.leveldb"), { recursive: true });
    fs.mkdirSync(path.join(idb, "http_127.0.0.1_54979.indexeddb.leveldb"));
    fs.mkdirSync(path.join(idb, "neo-angband_game_0.indexeddb.leveldb"));
    expect(discoverStorageOrigins(inputsFor(base))).toEqual([54979, 45872]);
  });

  it("puts the port used last first, found in the profile or not", () => {
    const base = profileWith([[54979], [45872]]);
    remember(base, 45871);
    expect(legacyPorts(inputsFor(base))).toEqual([45871, 45872, 54979]);
    remember(base, 54979);
    expect(legacyPorts(inputsFor(base))).toEqual([54979, 45872]);
  });

  it("reads the remembered port from the old text file too, and falls back to the default", () => {
    const base = profileWith([]);
    expect(lastLoopbackPort(inputsFor(base))).toBe(DEFAULT_PORT);
    const userDir = path.join(base, "user");
    fs.mkdirSync(userDir, { recursive: true });
    fs.writeFileSync(path.join(userDir, LEGACY_PORT_FILE), "46001\n", "utf8");
    expect(lastLoopbackPort(inputsFor(base))).toBe(46001);
    for (const bad of ["0", "70000", "45871x", "not a port"]) {
      fs.writeFileSync(path.join(userDir, LEGACY_PORT_FILE), bad, "utf8");
      expect(lastLoopbackPort(inputsFor(base)), bad).toBe(DEFAULT_PORT);
    }
  });

  it("writes nothing, so an older build still finds its own port file", () => {
    const base = profileWith([[54979]]);
    remember(base, 45872);
    const before = fs.readdirSync(path.join(base, "user"));
    legacyPorts(inputsFor(base));
    expect(fs.readdirSync(path.join(base, "user"))).toEqual(before);
  });

  it("survives a profile with no storage and ignores files that are not LevelDB data", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "neo-port-"));
    expect(discoverStorageOrigins(inputsFor(empty))).toEqual([]);
    expect(legacyPorts(inputsFor(empty))).toEqual([DEFAULT_PORT]);

    const base = profileWith([[54979]]);
    const db = path.join(base, "session", "Local Storage", "leveldb");
    fs.writeFileSync(path.join(db, "LOCK"), "");
    fs.writeFileSync(path.join(db, "LOG"), "http://127.0.0.1:9999");
    fs.writeFileSync(path.join(db, "notes.txt"), "http://127.0.0.1:8888");
    fs.mkdirSync(path.join(db, "a-directory"));
    fs.writeFileSync(path.join(db, "000099.ldb"), "_https://example.com\u0000\u0001x");
    expect(discoverStorageOrigins(inputsFor(base))).toEqual([54979]);
  });
});
