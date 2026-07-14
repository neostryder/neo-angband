import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindCore } from "../session/boot";
import type { CorePack } from "../session/boot";
import {
  ContentIdResolver,
  coreId,
  kindLocalId,
  makeId,
  parseId,
  slug,
} from "./ids";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as T;
}
function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

/** Pack zero, with traps bound so trap ids are exercised too. */
const pack: CorePack = {
  constants: loadJson("constants"),
  terrain: loadRecords("terrain"),
  roomTemplates: loadRecords("room_template"),
  vaults: loadRecords("vault"),
  dungeonProfiles: loadRecords("dungeon_profile"),
  trap: loadRecords("trap"),
  obj: {
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
  } as CorePack["obj"],
  mon: {
    pain: loadRecords("pain"),
    blowMethods: loadRecords("blow_methods"),
    blowEffects: loadRecords("blow_effects"),
    monsterSpells: loadRecords("monster_spell"),
    monsterBases: loadRecords("monster_base"),
    monsters: loadRecords("monster"),
    summons: loadRecords("summon"),
    pits: loadRecords("pit"),
  },
} as CorePack;

describe("slug", () => {
  it("kebab-cases names and codes deterministically", () => {
    expect(slug("Ring of Barahir")).toBe("ring-of-barahir");
    expect(slug("FIRE_3")).toBe("fire-3");
    expect(slug("  Multiple   Spaces  ")).toBe("multiple-spaces");
    expect(slug("Grip, Farmer Maggot's Dog")).toBe("grip-farmer-maggot-s-dog");
  });
});

describe("id compose/parse", () => {
  it("round-trips a simple id", () => {
    const id = makeId("core", "kobold");
    expect(id).toBe("core:kobold");
    expect(parseId(id)).toEqual({ namespace: "core", localid: "kobold" });
  });

  it("splits only on the first separator so localids may contain colons", () => {
    const id = coreId(kindLocalId(9 /* SWORD */, "Dagger"));
    const parsed = parseId(id);
    expect(parsed?.namespace).toBe("core");
    expect(parsed?.localid).toContain(":"); // tval:name
  });

  it("returns null for a bare token with no separator", () => {
    expect(parseId("kobold")).toBeNull();
  });
});

describe("ContentIdResolver over pack zero", () => {
  const reg = bindCore(pack);
  const ids = new ContentIdResolver(reg);

  it("mints a globally unique id for every entity in each registry", () => {
    const check = (n: number, id: (i: number) => string, base = 0): void => {
      const seen = new Set<string>();
      for (let i = base; i < n; i++) {
        const s = id(i);
        expect(seen.has(s)).toBe(false);
        seen.add(s);
      }
    };
    check(reg.objects.kinds.length, (i) => ids.kindId(i));
    check(reg.objects.egos.length, (i) => ids.egoId(i));
    check(reg.monsters.races.length, (i) => ids.raceId(i));
  });

  it("disambiguates genuine duplicate names with a numeric suffix", () => {
    // Two egos ship as "of Slay Animal"; they must get distinct ids, one bare
    // and one suffixed, and both must resolve back to their own eidx.
    const slayAnimal = reg.objects.egos.filter(
      (e) => e.name === "of Slay Animal",
    );
    expect(slayAnimal.length).toBeGreaterThan(1);
    const idset = new Set(slayAnimal.map((e) => ids.egoId(e.eidx)));
    expect(idset.size).toBe(slayAnimal.length);
    for (const e of slayAnimal) {
      expect(ids.egoIndex(ids.egoId(e.eidx))).toBe(e.eidx);
    }
  });

  it("round-trips every object kind index through its id", () => {
    for (const kind of reg.objects.kinds) {
      const id = ids.kindId(kind.kidx);
      expect(ids.kindIndex(id)).toBe(kind.kidx);
      expect(id.startsWith("core:")).toBe(true);
    }
  });

  it("round-trips every monster race index through its id", () => {
    for (const race of reg.monsters.races) {
      expect(ids.raceIndex(ids.raceId(race.ridx))).toBe(race.ridx);
    }
  });

  it("round-trips egos, artifacts, curses, brands, slays", () => {
    for (const ego of reg.objects.egos) {
      expect(ids.egoIndex(ids.egoId(ego.eidx))).toBe(ego.eidx);
    }
    for (let i = 1; i < reg.objects.artifacts.length; i++) {
      if (reg.objects.artifacts[i]) {
        expect(ids.artifactIndex(ids.artifactId(i))).toBe(i);
      }
    }
    for (let i = 1; i < reg.objects.curses.length; i++) {
      if (reg.objects.curses[i]) {
        expect(ids.curseIndex(ids.curseId(i))).toBe(i);
      }
    }
    for (let i = 1; i < reg.objects.brands.length; i++) {
      if (reg.objects.brands[i]) {
        expect(ids.brandIndex(ids.brandId(i))).toBe(i);
      }
    }
    for (let i = 1; i < reg.objects.slays.length; i++) {
      if (reg.objects.slays[i]) {
        expect(ids.slayIndex(ids.slayId(i))).toBe(i);
      }
    }
  });

  it("round-trips trap kinds and terrain features", () => {
    for (const trap of reg.traps ?? []) {
      expect(ids.trapIndex(ids.trapId(trap.tidx))).toBe(trap.tidx);
    }
    for (const feat of reg.features.allFeatures()) {
      expect(ids.featIndex(ids.featId(feat.fidx))).toBe(feat.fidx);
    }
  });

  it("resolves a known id independent of registry order (FLOOR feature)", () => {
    const floor = reg.features.byCodeName("FLOOR");
    expect(ids.featId(floor.fidx)).toBe("core:floor");
    expect(ids.featIndex("core:floor")).toBe(floor.fidx);
  });

  it("reports an unknown id as undefined, not a throw", () => {
    expect(ids.kindIndex("core:does-not-exist")).toBeUndefined();
    expect(ids.raceIndex("frost:frost-wyrm")).toBeUndefined();
  });
});
