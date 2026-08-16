/**
 * The port resolution, and the defect it closes.
 *
 * The defect was not a crash and produced no error: an ephemeral loopback port
 * changed the renderer's ORIGIN every launch, and localStorage - where the
 * character roster lives - is partitioned per origin, so every launch looked at an
 * empty store and honestly reported no saved characters. The regression this file
 * guards against is therefore an ABSENCE of stability, which is why the first test
 * is about the same inputs twice.
 */

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  DEFAULT_PORT,
  PORT_ENV,
  PORT_FILE,
  PORT_LADDER_SPAN,
  discoverStorageOrigins,
  portLadder,
  rememberLoopbackPort,
  resolveLoopbackPort,
} from "./loopback-port.js";

/** A profile whose localStorage LevelDB names the given origins. */
function profileWith(origins: readonly number[][]): string {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "neo-port-"));
  const db = path.join(base, "session", "Local Storage", "leveldb");
  fs.mkdirSync(db, { recursive: true });
  /* One file per group, written oldest first so mtime order is the array order
   * reversed - the newest file is the LAST group. */
  origins.forEach((group, i) => {
    const body = group
      .map((p) => `_http://127.0.0.1:${p}\u0000\u0001neo-angband-active`)
      .join("\u0000");
    const name = i === origins.length - 1 ? `00002${i}.log` : `00000${i}.ldb`;
    fs.writeFileSync(path.join(db, name), body, "latin1");
    /* Explicit mtimes: two writes inside the same millisecond would otherwise
     * leave the ordering to chance. */
    const t = new Date(1_700_000_000_000 + i * 60_000);
    fs.utimesSync(path.join(db, name), t, t);
  });
  return base;
}

function inputsFor(base: string, env: Record<string, string | undefined> = {}) {
  return {
    env,
    userDir: path.join(base, "user"),
    sessionDir: path.join(base, "session"),
  };
}

describe("loopback port stability (the roster's origin)", () => {
  it("gives the same port twice for the same install", () => {
    const base = profileWith([]);
    const first = resolveLoopbackPort(inputsFor(base));
    rememberLoopbackPort(inputsFor(base).userDir, first.port);
    const second = resolveLoopbackPort(inputsFor(base));

    expect(first.port).toBe(DEFAULT_PORT);
    expect(first.source).toBe("default");
    expect(second.port).toBe(first.port);
    expect(second.source).toBe("file");
  });

  it("keeps the stable port and only REPORTS the origins already in the profile", () => {
    /* The real install that reported the bug: five launches, five origins. The
     * newest of them held nothing but a stale active pointer while three living
     * characters sat in the two before it, which is why the port is not adopted
     * from any of them - origin-merge.ts brings them all to the stable one. */
    const base = profileWith([[63457], [61806], [61038], [49494], [54979]]);
    const choice = resolveLoopbackPort(inputsFor(base));

    expect(choice.source).toBe("default");
    expect(choice.port).toBe(DEFAULT_PORT);
    expect(choice.known).toEqual([54979, 49494, 61038, 61806, 63457]);
  });

  it("reports every origin found, so a stranded character can be named", () => {
    const base = profileWith([[61806, 61038], [54979]]);
    const choice = resolveLoopbackPort(inputsFor(base));
    /* Newest file first; within a file, order of appearance. */
    expect(choice.known).toEqual([54979, 61806, 61038]);
  });

  it("prefers a remembered choice over the default", () => {
    const base = profileWith([[54979]]);
    rememberLoopbackPort(inputsFor(base).userDir, 46000);
    const choice = resolveLoopbackPort(inputsFor(base));
    expect(choice).toMatchObject({ port: 46000, source: "file" });
  });

  it("lets the environment override, and remembers that too", () => {
    const base = profileWith([[54979]]);
    const choice = resolveLoopbackPort(inputsFor(base, { [PORT_ENV]: "50000" }));
    expect(choice).toMatchObject({ port: 50000, source: "env" });

    /* Persisted deliberately: honouring an override for one launch and reverting
     * silently would strand whatever was written during it. */
    rememberLoopbackPort(inputsFor(base).userDir, choice.port);
    expect(fs.readFileSync(path.join(base, "user", PORT_FILE), "utf8").trim()).toBe(
      "50000",
    );
    expect(resolveLoopbackPort(inputsFor(base)).port).toBe(50000);
  });

  it("refuses 0 and other unbindable numbers rather than going ephemeral", () => {
    const base = profileWith([]);
    for (const bad of ["0", "-1", "70000", "", "  ", "http", "45871x"]) {
      const choice = resolveLoopbackPort(inputsFor(base, { [PORT_ENV]: bad }));
      expect(choice.port, `for ${JSON.stringify(bad)}`).toBe(DEFAULT_PORT);
      expect(choice.source).toBe("default");
    }
  });

  it("survives a profile with no storage, an unreadable one, and junk files", () => {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "neo-port-"));
    expect(discoverStorageOrigins(inputsFor(empty))).toEqual([]);
    expect(resolveLoopbackPort(inputsFor(empty))).toMatchObject({
      port: DEFAULT_PORT,
      source: "default",
    });

    const base = profileWith([[54979]]);
    const db = path.join(base, "session", "Local Storage", "leveldb");
    fs.writeFileSync(path.join(db, "LOCK"), "");
    fs.writeFileSync(path.join(db, "CURRENT"), "MANIFEST-000001\n");
    fs.mkdirSync(path.join(db, "a-directory"));
    /* A non-loopback origin must not be mistaken for one. */
    fs.writeFileSync(path.join(db, "000099.ldb"), "_https://example.com\u0000\u0001x");
    expect(discoverStorageOrigins(inputsFor(base))).toEqual([54979]);
  });

  it("lets a remembered or default port move, and an explicit one never", () => {
    /* The whole safety argument for the ladder in one assertion. A player who set
     * NEO_ANGBAND_PORT is answering "which port", and quietly using a different one
     * would be the silent fallback this module exists to prevent. */
    const base = profileWith([]);
    expect(resolveLoopbackPort(inputsFor(base)).mayMove).toBe(true);
    rememberLoopbackPort(inputsFor(base).userDir, 46000);
    expect(resolveLoopbackPort(inputsFor(base)).mayMove).toBe(true);
    expect(
      resolveLoopbackPort(inputsFor(base, { [PORT_ENV]: "50000" })).mayMove,
    ).toBe(false);
  });

  it("ignores files that are not LevelDB data", () => {
    const base = profileWith([[54979]]);
    const db = path.join(base, "session", "Local Storage", "leveldb");
    /* LOG is Chromium's own text log and mentions nothing useful; a stray note
     * left in the folder must not become the game's origin. */
    fs.writeFileSync(path.join(db, "LOG"), "http://127.0.0.1:9999");
    fs.writeFileSync(path.join(db, "notes.txt"), "http://127.0.0.1:8888");
    expect(discoverStorageOrigins(inputsFor(base))).toEqual([54979]);
  });
});

describe("the port ladder (a second copy of the game)", () => {
  it("starts at the port asked for, so one copy is unaffected by the ladder existing", () => {
    /* The first rung IS the chosen port. If it were not, adding this feature would
     * have moved every existing install off its origin at the next launch. */
    expect(portLadder(DEFAULT_PORT)[0]).toBe(DEFAULT_PORT);
  });

  it("is the next port up, predictably, so the second copy is always +1", () => {
    expect(portLadder(DEFAULT_PORT).slice(0, 4)).toEqual([45871, 45872, 45873, 45874]);
  });

  it("is ascending, contiguous and free of duplicates", () => {
    const l = portLadder(DEFAULT_PORT);
    expect(l).toHaveLength(PORT_LADDER_SPAN);
    expect(new Set(l).size).toBe(l.length);
    for (let i = 1; i < l.length; i++) expect(l[i]).toBe((l[i - 1] as number) + 1);
  });

  it("stops below the range Windows hands out for ephemeral sockets", () => {
    /* Same reason DEFAULT_PORT sits below it: a port in that range can be given to
     * an unrelated program between two launches, and the characters are stored
     * against the number. So the ladder must not walk into it. */
    const l = portLadder(49140);
    expect(l).toEqual([49140, 49141, 49142, 49143, 49144, 49145, 49146, 49147, 49148, 49149, 49150, 49151]);
    expect(Math.max(...l)).toBeLessThan(49152);
  });

  it("honours a first port inside that range, having been given it deliberately", () => {
    /* NEO_ANGBAND_PORT=60000 does not ladder at all (mayMove is false), but the
     * function must not answer with an empty list if it is ever called that way -
     * an empty ladder would be a launch with no port to try. */
    expect(portLadder(60000)[0]).toBe(60000);
    expect(portLadder(60000).length).toBeGreaterThan(0);
  });

  it("never proposes a port that cannot exist", () => {
    const l = portLadder(65530);
    expect(Math.max(...l)).toBe(65535);
    expect(l.every((p) => p >= 1 && p <= 65535)).toBe(true);
  });
});
