/**
 * Tests for the generated list modules (scripts/codegen-lists.mjs over
 * reference/src/list-*.h). Counts and spot entries are pinned against the
 * upstream 4.2.6 headers; NAME -> value maps must match the upstream enum
 * values, including implicit prepended entries (OF_NONE, EF_NONE, the
 * stats before OBJ_MOD_*, the elements before PROJ_*).
 */

import { describe, expect, it } from "vitest";
import {
  DUN,
  DUN_PROFILE_ENTRIES,
  EF,
  EFFECT_ENTRIES,
  ELEM,
  ELEMENT_ENTRIES,
  FEAT,
  MON_RACE_FLAG_ENTRIES,
  MON_TIMED_ENTRIES,
  OBJ_MOD,
  OBJECT_FLAG_ENTRIES,
  OBJECT_MODIFIER_ENTRIES,
  OF,
  PROJ,
  PROJECTION_ENTRIES,
  RF,
  ROOMF,
  SQUARE,
  STAT,
  STAT_ENTRIES,
  TERRAIN_ENTRIES,
  TV,
  TVAL_ENTRIES,
} from "./index";

describe("object-flags", () => {
  it("has 39 entries and OF_PROT_FEAR", () => {
    expect(OBJECT_FLAG_ENTRIES.length).toBe(39);
    const protFear = OBJECT_FLAG_ENTRIES.find((e) => e.name === "PROT_FEAR");
    expect(protFear).toBeDefined();
    expect(protFear?.debugLabel).toBe("pFear");
  });

  it("matches the upstream OF_ enum values (OF_NONE implicit at 0)", () => {
    expect(OF.NONE).toBe(0);
    expect(OF.SUST_STR).toBe(1);
    expect(OF.PROT_FEAR).toBe(6);
    expect(OF.MAX).toBe(39);
  });

  it("keeps in-string whitespace exactly (debug labels)", () => {
    const esp = OBJECT_FLAG_ENTRIES.find((e) => e.name === "TELEPATHY");
    expect(esp?.debugLabel).toBe("  ESP");
  });
});

describe("elements", () => {
  it("has 25 entries with ACID at index 0", () => {
    expect(ELEMENT_ENTRIES.length).toBe(25);
    expect(ELEMENT_ENTRIES[0].name).toBe("ACID");
    expect(ELEM.ACID).toBe(0);
    expect(ELEM.ARROW).toBe(24);
  });
});

describe("effects", () => {
  it("count matches the header (112 EFFECT entries)", () => {
    expect(EFFECT_ENTRIES.length).toBe(112);
  });

  it("matches the upstream EF_ enum values (EF_NONE implicit at 0)", () => {
    expect(EF.NONE).toBe(0);
    expect(EF.RANDOM).toBe(1);
    expect(EF.UNSCRAMBLE_STATS).toBe(112);
  });

  it("keeps all macro arguments, including multi-line entries", () => {
    const damage = EFFECT_ENTRIES.find((e) => e.name === "DAMAGE");
    expect(damage).toEqual({
      name: "DAMAGE",
      aim: false,
      info: "hurt",
      args: 1,
      infoFlags: "EFINFO_DICE",
      description: "does %s damage to the player",
      menuName: "",
    });
    /* GRANITE spans two source lines in the header. */
    const granite = EFFECT_ENTRIES.find((e) => e.name === "GRANITE");
    expect(granite?.args).toBe(0);
    expect(granite?.description).toBe(
      "causes a granite wall to fall behind you",
    );
  });
});

describe("mon-race-flags", () => {
  it("has 85 entries including RF_UNIQUE", () => {
    expect(MON_RACE_FLAG_ENTRIES.length).toBe(85);
    const unique = MON_RACE_FLAG_ENTRIES.find((e) => e.name === "UNIQUE");
    expect(unique).toBeDefined();
    expect(unique?.type).toBe("RFT_OBV");
  });

  it("matches the upstream RF_ enum values (NONE is a real entry)", () => {
    expect(MON_RACE_FLAG_ENTRIES[0].name).toBe("NONE");
    expect(RF.NONE).toBe(0);
    expect(RF.UNIQUE).toBe(1);
  });
});

describe("tvals", () => {
  it("has 36 entries including TV_SWORD", () => {
    expect(TVAL_ENTRIES.length).toBe(36);
    const sword = TVAL_ENTRIES.find((e) => e.name === "SWORD");
    expect(sword?.textName).toBe("sword");
  });

  it("matches the upstream TV_ enum values (TV_NULL at 0)", () => {
    expect(TV.NULL).toBe(0);
    expect(TV.SWORD).toBe(9);
    expect(TV.GOLD).toBe(35);
  });
});

describe("cross-header enum composition", () => {
  it("OBJ_MOD_ values start after the five stats", () => {
    expect(STAT_ENTRIES.length).toBe(5);
    expect(STAT.STR).toBe(0);
    expect(OBJ_MOD.STR).toBe(0);
    expect(OBJ_MOD.CON).toBe(4);
    expect(OBJ_MOD.STEALTH).toBe(5);
    expect(OBJECT_MODIFIER_ENTRIES[0].name).toBe("STEALTH");
  });

  it("PROJ_ values start after the 25 elements", () => {
    expect(PROJECTION_ENTRIES.length).toBe(31);
    expect(PROJ.ACID).toBe(0);
    expect(PROJ.LIGHT_WEAK).toBe(25);
    expect(PROJ.MON_CRUSH).toBe(55);
  });

  it("ROOMF_ values start after the implicit ROOMF_NONE", () => {
    expect(ROOMF.NONE).toBe(0);
    expect(ROOMF.FEW_ENTRANCES).toBe(1);
  });
});

describe("value conversion", () => {
  it("converts NULL to null and keeps identifiers as strings", () => {
    const random = EFFECT_ENTRIES.find((e) => e.name === "RANDOM");
    expect(random?.info).toBeNull();
    const sleep = MON_TIMED_ENTRIES.find((e) => e.name === "SLEEP");
    expect(sleep?.save).toBe(true);
    expect(sleep?.stack).toBe("NO");
    expect(sleep?.resistFlag).toBe("RF_NO_SLEEP");
    expect(sleep?.time).toBe(10000);
    expect(sleep?.messageIncrease).toBe(0);
  });

  it("supports string names with spaces (rooms, dun profiles)", () => {
    expect(DUN_PROFILE_ENTRIES.length).toBe(9);
    expect(DUN["hard centre"]).toBe(5);
    expect(DUN_PROFILE_ENTRIES[5].builder).toBe("hard_centre");
  });

  it("terrain and square flags line up with cave.h", () => {
    expect(TERRAIN_ENTRIES.length).toBe(25);
    expect(FEAT.NONE).toBe(0);
    expect(FEAT.PASS_RUBBLE).toBe(24);
    expect(SQUARE.MARK).toBe(1);
    expect(SQUARE.CLOSE_PLAYER).toBe(21);
  });
});
