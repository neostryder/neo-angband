/**
 * The lore.txt wiring, and the proof that anything calls it.
 *
 * The gap this closes was never a missing function - the port persisted monster
 * memory perfectly well, into the savefile. It was a missing STORE: upstream keeps
 * that memory in the user directory, so it outlives the character, and the port
 * kept it in the save, so it died with them. A test of the reader and writer alone
 * would pass in both worlds, which is why the last describe here checks that
 * main.ts actually reaches them - "shipped is not reachable" costs this project a
 * feature roughly once per seam.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  FlagSet,
  HostDir,
  RF_SIZE,
  MemoryHost,
  NULL_HOST,
  newMonsterLore,
  setHost,
} from "@rpgm-tools/neo-angband-core";
import type { LoreStore, MonsterRace } from "@rpgm-tools/neo-angband-core";

import { loadLoreFile, saveLoreFile } from "./lore-file";

const SRC = path.dirname(fileURLToPath(import.meta.url));

function fakeRace(ridx: number, name: string): MonsterRace {
  return {
    ridx,
    name,
    /* A REAL flag set on the base, because the binder always builds one and a
     * stub without it is a shape production cannot produce. `newMonsterLore`
     * unions the base's flags (finish_parse_lore), so a base with no `flags`
     * makes it throw rather than measure anything. RF_SIZE, not the 12 the
     * spell flags use - a race flag set and a spell flag set are different
     * widths, and `flagUnion` refuses a mismatch. */
    base: { name: "kobold", flags: new FlagSet(RF_SIZE) },
    blows: [],
    spellFlags: new FlagSet(12),
    sleep: 0,
  } as unknown as MonsterRace;
}

afterEach(() => setHost(NULL_HOST));

describe("lore.txt through the host", () => {
  let host: MemoryHost;
  const race = fakeRace(3, "kobold");

  beforeEach(() => {
    host = new MemoryHost();
    setHost(host);
  });

  it("writes the memory into the user directory and reads it back", () => {
    const first: LoreStore = new Map();
    const lore = newMonsterLore(race);
    lore.sights = 5;
    lore.tkills = 21;
    first.set(3, lore);

    expect(saveLoreFile([race], first)).toBe(true);
    /* text_lines_to_file stages <name>.new and rotates it, so the file the game
     * can read next launch is lore.txt itself and nothing is left behind. */
    expect(host.read(HostDir.USER, "lore.txt")).toContain("name:kobold");
    expect(host.exists(HostDir.USER, "lore.txt.new")).toBe(false);
    expect(host.exists(HostDir.USER, "lore.txt.old")).toBe(false);

    /* A DIFFERENT character - an empty store, as a fresh birth produces. */
    const next: LoreStore = new Map();
    loadLoreFile([race], next);
    expect(next.get(3)?.tkills).toBe(21);
  });

  it("leaves an empty store alone when there is no file", () => {
    /* mon-init.c:2585's "No monster lore file found" - not an error. */
    const store: LoreStore = new Map();
    loadLoreFile([race], store);
    expect(store.size).toBe(0);
  });

  it("survives a host that cannot write, and says the write failed", () => {
    setHost(new MemoryHost({ failWrites: ["lore.txt.new"] }));
    const store: LoreStore = new Map();
    const lore = newMonsterLore(race);
    lore.sights = 1;
    store.set(3, lore);
    expect(saveLoreFile([race], store)).toBe(false);
  });

  it("does not throw when the host is the null one", () => {
    setHost(NULL_HOST);
    const store: LoreStore = new Map();
    expect(() => loadLoreFile([race], store)).not.toThrow();
    expect(saveLoreFile([race], store)).toBe(false);
  });
});

describe("main.ts reaches the wiring", () => {
  const main = (): string => fs.readFileSync(path.join(SRC, "main.ts"), "utf8");

  it("reads lore.txt at boot", () => {
    expect(main()).toMatch(/loadLoreFile\(booted\.registries\.monsters\.races, state\.lore\)/u);
  });

  it("writes lore.txt from a deliberate save, and not from the tail autosave", () => {
    const body = main();
    /* The distinction that matters: upstream writes the file from every
     * save_game_checked, and the port's three-second tail autosave is not one -
     * it has no upstream counterpart at all. So the write is gated on
     * `deliberate`, and autosave passes its own `force`. */
    expect(body).toMatch(/if \(ok && deliberate && !saveLoreFile\(/u);
    expect(body).toMatch(/function persistSave\(deliberate = false\)/u);
    expect(body).toMatch(/if \(persistSave\(force\)\)/u);
    expect(body).toMatch(/while \(!persistSave\(true\)\)/u);
  });
});
