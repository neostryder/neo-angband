/**
 * A census of which record types carry a mod's own fields.
 *
 * WHY A CENSUS AND NOT ONE TEST PER TYPE. The failure this guards against is an
 * ABSENCE - a binder nobody wired up. Per-type tests cannot see that: the suite
 * stays green while a mod author writes a field on an artifact, gets no error,
 * and finds nothing at runtime, which is exactly the experience `ext` exists to
 * end. So COVERED_FILES is the claim, every entry is exercised against the real
 * shipped pack, and adding a bound record type without wiring it is a failure
 * here rather than a discovery six months later.
 *
 * THE INJECTION IS INTO EVERY RECORD OF THE FILE, not the first one. Bound
 * order is not record order - vaults, curses and room templates are reversed,
 * object_base is indexed by tval, and artifacts and curses reserve index 0 -
 * so "record i becomes bound record i" would be a claim about each binder that
 * this test would then be asserting by accident. Injecting everywhere and
 * counting the survivors is order-independent.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindCore } from "../session/boot.js";
import type { CorePack } from "../session/boot.js";
import { loadRoomTemplates } from "../gen/room.js";
import { PlayerRegistry } from "../player/bind.js";
import type { ModExtensible } from "./extension.js";
import { CORE_RECORD_KEYS } from "./record-keys.js";

/** A key no gamedata file uses, standing in for a field a mod added. */
const SENTINEL = "neo-angband:test-extension";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../../content/pack/${name}.json`, import.meta.url), "utf8"),
  ) as T;
}

function loadRecords<T>(name: string): T[] {
  const raw = loadJson<T[] | { records: T[] }>(name);
  return Array.isArray(raw) ? raw : raw.records;
}

/**
 * Load a file's records with the sentinel written onto every one of them, or
 * untouched when `inject` is false.
 *
 * `inject` is a parameter rather than two helpers because the control matters:
 * the same pack is bound twice and the second run must differ ONLY in this.
 */
function records<T>(name: string, inject: boolean): T[] {
  const recs = loadRecords<Record<string, unknown>>(name);
  if (inject) for (const r of recs) r[SENTINEL] = name;
  return recs as T[];
}

/** The whole pack, optionally carrying a mod's field on every record. */
function buildPack(inject: boolean): CorePack {
  return {
    constants: loadJson("constants"),
    terrain: records("terrain", inject),
    roomTemplates: records("room_template", inject),
    vaults: records("vault", inject),
    dungeonProfiles: loadRecords("dungeon_profile"),
    projection: records("projection", inject),
    trap: records("trap", inject),
    store: records("store", inject),
    names: loadRecords("names"),
    obj: {
      objectBase: { ...loadJson<object>("object_base"), records: records("object_base", inject) },
      object: { records: records("object", inject) },
      egoItem: { records: records("ego_item", inject) },
      artifact: { records: records("artifact", inject) },
      curse: { records: records("curse", inject) },
      brand: loadJson("brand"),
      slay: loadJson("slay"),
      activation: loadJson("activation"),
      objectProperty: loadJson("object_property"),
      flavor: loadJson("flavor"),
    },
    mon: {
      pain: loadRecords("pain"),
      blowMethods: loadRecords("blow_methods"),
      blowEffects: loadRecords("blow_effects"),
      monsterSpells: loadRecords("monster_spell"),
      monsterBases: records("monster_base", inject),
      monsters: records("monster", inject),
      summons: loadRecords("summon"),
      pits: loadRecords("pit"),
    },
  } as CorePack;
}

function buildPlayers(inject: boolean): PlayerRegistry {
  return new PlayerRegistry({
    realms: loadRecords("realm"),
    history: loadRecords("history"),
    bodies: loadRecords("body"),
    properties: loadRecords("player_property"),
    timed: loadRecords("player_timed"),
    shapes: loadRecords("shape"),
    races: records("p_race", inject),
    classes: records("class", inject),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);
}

/**
 * Every pack file whose records become a bound type, and how to reach those
 * bound values.
 *
 * A file NOT here is a deliberate statement that its records do not become an
 * addressable runtime record - see the "not yet covered" test, which pins the
 * remainder so the list cannot quietly shrink.
 */
const COVERED_FILES: Record<string, (p: Bound) => readonly (ModExtensible | null)[]> = {
  object: (p) => p.reg.objects.kinds,
  object_base: (p) => p.reg.objects.bases,
  ego_item: (p) => p.reg.objects.egos,
  artifact: (p) => p.reg.objects.artifacts,
  curse: (p) => p.reg.objects.curses,
  monster: (p) => p.reg.monsters.races,
  monster_base: (p) => [...p.reg.monsters.bases.values()],
  terrain: (p) => p.reg.features.allFeatures(),
  trap: (p) => p.reg.traps ?? [],
  vault: (p) => p.reg.rooms.vaults,
  /* RoomRegistry exposes vaults but not templates, so this reads the binder
   * directly. It is the same function bindCore calls. */
  room_template: (p) => p.templates,
  projection: (p) => p.reg.projections ?? [],
  store: (p) => p.reg.stores?.stores ?? [],
  p_race: (p) => p.players.races,
  class: (p) => p.players.classes,
};

interface Bound {
  reg: ReturnType<typeof bindCore>;
  players: PlayerRegistry;
  templates: ReturnType<typeof loadRoomTemplates>;
}

function bindAll(inject: boolean): Bound {
  const pack = buildPack(inject);
  return {
    reg: bindCore(pack),
    players: buildPlayers(inject),
    templates: loadRoomTemplates(pack.roomTemplates),
  };
}

const modded = bindAll(true);
const plain = bindAll(false);

describe("a mod's own field survives binding", () => {
  for (const [file, reach] of Object.entries(COVERED_FILES)) {
    it(`${file} records carry it`, () => {
      const bound = reach(modded).filter((b): b is ModExtensible => b !== null);
      expect(bound.length, "the file bound at least one record").toBeGreaterThan(0);
      const carrying = bound.filter((b) => b.ext?.[SENTINEL] === file);
      expect(carrying.length, `${file}: no bound record carried the added field`).toBeGreaterThan(
        0,
      );
    });
  }

  it("does not invent one when no mod added anything", () => {
    /* The control. Without it every assertion above would still pass if
     * attachExt copied the whole record unconditionally, and `ext` being
     * present would stop meaning "a mod put this here". */
    for (const [file, reach] of Object.entries(COVERED_FILES)) {
      const withExt = reach(plain)
        .filter((b): b is ModExtensible => b !== null)
        .filter((b) => b.ext !== undefined);
      expect(withExt, `${file}: unmodded records must have no ext`).toHaveLength(0);
    }
  });

  it("carries the mod's key and nothing of core's", () => {
    const kind = modded.reg.objects.kinds.find((k) => k.ext !== undefined);
    expect(kind?.ext).toEqual({ [SENTINEL]: "object" });
  });
});

describe("the census names what is NOT covered", () => {
  it("lists every remaining record file, so the gap is a statement", () => {
    /* These files' records either have no bound counterpart a plugin can hold
     * (constants, visuals, flavor, manifest), or bind into a structure keyed
     * by something other than the record (names sections, history charts,
     * ui_entry tables). Shrinking this list is the work; it changing WITHOUT
     * a matching COVERED_FILES entry is the accident. */
    const remaining = Object.keys(CORE_RECORD_KEYS)
      .filter((f) => !(f in COVERED_FILES))
      .sort();
    expect(remaining).toEqual([
      "activation",
      "blow_effects",
      "blow_methods",
      "body",
      "brand",
      "chest_trap",
      "constants",
      "dungeon_profile",
      "flavor",
      "hints",
      "history",
      "monster_spell",
      "names",
      "object_property",
      "pain",
      "pit",
      "player_property",
      "player_timed",
      "quest",
      "realm",
      "shape",
      "slay",
      "summon",
      "ui_entry",
      "ui_entry_base",
      "ui_entry_renderer",
      "ui_knowledge",
      "visuals",
      "world",
    ]);
  });
});
