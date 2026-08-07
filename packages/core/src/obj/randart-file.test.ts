/**
 * randart.txt as a FILE, not as a set of format strings (PORT_TODO 5.5).
 *
 * The census next door proves each write_randart_entry line has a counterpart
 * in the source. That is a statement about text. This one runs a real
 * generation against the real content pack with `createFile` true, reads what
 * landed in ANGBAND_DIR_USER, and checks that the result is a data file the
 * game's own grammar describes - because a writer whose caller never runs is
 * indistinguishable from a writer that works.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { HostDir, NULL_HOST } from "../host/io.js";
import type { HostIo, WriteOutcome } from "../host/io.js";
import { ObjRegistry } from "./bind.js";
import { bindConstants } from "../constants.js";
import { doRandart } from "./randart.js";
import { RANDART_TXT } from "./randart-file.js";
import type { ObjPackJson } from "./types.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as T;
}

function makeReg(): ObjRegistry {
  return new ObjRegistry({
    objectBase: loadJson("object_base"),
    object: loadJson("object"),
    egoItem: loadJson("ego_item"),
    artifact: loadJson("artifact"),
    curse: loadJson("curse"),
    brand: loadJson("brand"),
    slay: loadJson("slay"),
    activation: loadJson("activation"),
    objectProperty: loadJson("object_property"),
    flavor: loadJson("flavor"),
  } as ObjPackJson);
}

/** object_prep's z_info, for the real make_fake_artifact. */
const constants = bindConstants(loadJson("constants"));

function run(seed: number, createFile: boolean): Map<string, string> {
  const files = new Map<string, string>();
  const io = {
    ...NULL_HOST,
    displayPath: (dir: HostDir, name: string) => `${dir}/${name}`,
    exists: (dir: HostDir, name: string) =>
      dir === HostDir.USER && files.has(name),
    read: (dir: HostDir, name: string) =>
      dir === HostDir.USER ? (files.get(name) ?? null) : null,
    write: (dir: HostDir, name: string, text: string) => {
      if (dir !== HostDir.USER) return "create-failed" as WriteOutcome;
      files.set(name, text);
      return "ok" as WriteOutcome;
    },
  } as unknown as HostIo;
  doRandart(makeReg(), constants, seed, createFile, undefined, undefined, io);
  return files;
}

describe("randart.txt (PORT_TODO 5.5)", () => {
  const files = run(0x5eed, true);
  const txt = files.get(RANDART_TXT) ?? "";
  const records = txt.split(/\n(?=name:)/).slice(1);

  it("is written at all, and only when asked", () => {
    /* The other half of the seam: createFile false must leave no file behind,
     * or "it writes randart.txt" would be true of every caller. */
    expect(txt.length).toBeGreaterThan(1000);
    expect(run(0x5eed, false).has(RANDART_TXT)).toBe(false);
  });

  it("names the seed in C's %08lx form", () => {
    expect(txt.startsWith("# Artifact file for random artifacts with seed ")).toBe(
      true,
    );
    expect(txt).toContain("seed 00005eed\n");
  });

  it("writes one record per artifact, each with the required keys", () => {
    expect(records.length).toBeGreaterThan(50);
    for (const rec of records.slice(0, 20)) {
      for (const key of ["base-object:", "level:", "weight:", "cost:", "alloc:"]) {
        expect(rec, key).toContain(key);
      }
      /* alloc: is "prob:min to max" - the space-separated form the parser
       * expects, not a third colon. */
      expect(rec).toMatch(/\nalloc:\d+:\d+ to \d+\n/);
      /* attack: is "DdS:toh:tod". */
      expect(rec).toMatch(/\nattack:\d+d\d+:-?\d+:-?\d+\n/);
    }
  });

  it("emits act: and time: together, or neither", () => {
    for (const rec of records) {
      expect(rec.includes("\nact:"), rec.slice(0, 40)).toBe(
        rec.includes("\ntime:"),
      );
    }
  });

  it("uses brand and slay CODES, and curse NAMES, as the parser reads them", () => {
    /* A brand written by name ("acid brand") would look right in a diff and
     * fail to parse; upstream writes brands[j].code and curses[j].name, which
     * are different fields with different conventions. */
    const brands = [...txt.matchAll(/\nbrand:(.+)/g)].map((m) => m[1]!);
    const slays = [...txt.matchAll(/\nslay:(.+)/g)].map((m) => m[1]!);
    expect(brands.length + slays.length).toBeGreaterThan(0);
    for (const code of [...brands, ...slays]) {
      expect(code, code).toMatch(/^[A-Z0-9_]+$/);
    }
    for (const m of txt.matchAll(/\ncurse:([^:]+):(-?\d+)/g)) {
      expect(m[1], m[1]).toMatch(/[a-z]/);
    }
  });

  it("is reproducible from the seed", () => {
    expect(run(0x5eed, true).get(RANDART_TXT)).toBe(txt);
    expect(run(0x5eee, true).get(RANDART_TXT)).not.toBe(txt);
  });
});
