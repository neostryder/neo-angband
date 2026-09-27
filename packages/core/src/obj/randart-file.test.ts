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
import { bindProjections } from "../world/projection.js";
import type { ProjectionRecordJson } from "../world/projection.js";
import { doRandart } from "./randart.js";
import { parseDocument, randartFormat, serializeDocument } from "@rpgm-tools/neo-angband-mod-sdk";
import { RANDART_JSON, RANDART_TXT, readRandartExport } from "./randart-file.js";
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
  const reg = new ObjRegistry({
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
  /* randart.log quotes projections[i].name; bind them from the pack. */
  reg.projections = bindProjections(
    loadJson<{ records: ProjectionRecordJson[] }>("projection").records,
  );
  return reg;
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

describe("randart.json (PORT_TODO 5.5)", () => {
  const files = run(0x5eed, true);
  const txt = files.get(RANDART_JSON) ?? "";
  const parsed = parseDocument(txt, randartFormat);

  it("is written at all, and only when asked", () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.data.artifacts.length).toBeGreaterThan(50);
    expect(run(0x5eed, false).has(RANDART_JSON)).toBe(false);
  });

  it("names the seed as the unsigned value the generator was given", () => {
    expect(parsed.ok && parsed.data.seed).toBe(0x5eed);
  });

  it("writes the fields a record needs", () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    for (const art of parsed.data.artifacts.slice(0, 20)) {
      expect(art.baseTval.length).toBeGreaterThan(0);
      expect(Number.isInteger(art.level)).toBe(true);
      expect(Number.isInteger(art.weight)).toBe(true);
      expect(Number.isInteger(art.cost)).toBe(true);
      expect(Number.isInteger(art.allocProb)).toBe(true);
      expect(Number.isInteger(art.attackDice)).toBe(true);
    }
  });

  it("emits an activation's name and time together, or neither", () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    for (const art of parsed.data.artifacts) {
      if (art.activation !== undefined) {
        expect(art.activation.name.length).toBeGreaterThan(0);
        expect(Number.isInteger(art.activation.base)).toBe(true);
      }
    }
  });

  it("uses brand and slay codes, and curse names", () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const brands = parsed.data.artifacts.flatMap((art) => art.brands ?? []);
    const slays = parsed.data.artifacts.flatMap((art) => art.slays ?? []);
    const curses = parsed.data.artifacts.flatMap((art) => art.curses ?? []);
    expect(brands.length + slays.length).toBeGreaterThan(0);
    for (const code of [...brands, ...slays]) expect(code).toMatch(/^[A-Z0-9_]+$/);
    for (const curse of curses) expect(curse.name).toMatch(/[a-z]/);
  });

  it("is reproducible from the seed", () => {
    expect(run(0x5eed, true).get(RANDART_JSON)).toBe(txt);
    expect(run(0x5eee, true).get(RANDART_JSON)).not.toBe(txt);
  });

  it("round-trips the export byte-stably", () => {
    expect(parsed.ok && serializeDocument(randartFormat, parsed.data)).toBe(txt);
  });

  it("converts an old export once and keeps corrupt new documents", () => {
    const files = new Map<string, string>([[RANDART_TXT, [
      "# Artifact file for random artifacts with seed 00005eed",
      "name:of Power",
      "base-object:sword:long sword",
      "level:20", "weight:30", "cost:1000", "alloc:10:1 to 100",
      "attack:2d6:5:5", "armor:0:0", "desc:A sword.",
    ].join("\n")]]);
    const io = {
      ...NULL_HOST,
      exists: (_dir: HostDir, name: string) => files.has(name),
      read: (_dir: HostDir, name: string) => files.get(name) ?? null,
      write: (_dir: HostDir, name: string, body: string) => { files.set(name, body); return "ok" as WriteOutcome; },
      remove: (_dir: HostDir, name: string) => files.delete(name),
    } as HostIo;
    expect(readRandartExport(io)?.seed).toBe(0x5eed);
    expect(files.has(RANDART_TXT)).toBe(false);
    const converted = files.get(RANDART_JSON)!;
    expect(parseDocument(converted, randartFormat).ok).toBe(true);
    for (const bad of ["{broken", '{"format":"neo-angband/object/randart","schemaVersion":99,"data":{}}']) {
      files.set(RANDART_JSON, bad);
      expect(readRandartExport(io)).toBeNull();
      expect(files.get(RANDART_JSON)).toBe(bad);
    }
  });
});
