/**
 * Rejection paths of the object-domain parsers, ported from the upstream
 * unit tests reference/src/tests/parse/{k-info,a-info,e-info,objbase,curse,
 * objprop,flavor,slay,brand}.c.
 *
 * The port splits upstream's parse handlers in two: `content` compiles the
 * .txt to JSON (line grammar only) and `ObjRegistry` (packages/core/src/obj/
 * bind.ts) does the name-to-enum resolution, cross-record lookups and range
 * checks that upstream's obj-init.c handlers do inline. Every error code the
 * upstream tests assert therefore lands here, not in the compiler - and none
 * of it is reachable from the shipped gamedata, so the W5 data-exactness
 * suite is structurally blind to all of it.
 *
 * Method: take the real committed pack, deep-copy it, plant exactly the token
 * the upstream test plants, and require ObjRegistry to refuse it. The
 * unmutated pack is asserted to bind cleanly first, so a throw can only come
 * from the mutation.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ObjRegistry, grabIntRange } from "./bind";
import type { ObjPackJson } from "./types";

function load(name: string): unknown {
  return JSON.parse(
    readFileSync(new URL(`../../../content/pack/${name}.json`, import.meta.url), "utf8"),
  );
}

const BASE_PACK: ObjPackJson = {
  objectBase: load("object_base"),
  object: load("object"),
  egoItem: load("ego_item"),
  artifact: load("artifact"),
  curse: load("curse"),
  brand: load("brand"),
  slay: load("slay"),
  activation: load("activation"),
  objectProperty: load("object_property"),
  flavor: load("flavor"),
} as ObjPackJson;

function freshPack(): ObjPackJson {
  return JSON.parse(JSON.stringify(BASE_PACK)) as ObjPackJson;
}

/* Every mutation below starts from a pack that is known to bind. */
it("the unmutated pack binds without error (control)", () => {
  expect(() => new ObjRegistry(freshPack())).not.toThrow();
});

/**
 * Mutate one record of one pack file and require the bind to throw.
 * `pick` selects the record; `mutate` plants the bad token.
 */
function expectReject(
  mutate: (pack: ObjPackJson) => void,
  message: RegExp,
): void {
  const pack = freshPack();
  mutate(pack);
  expect(() => new ObjRegistry(pack)).toThrow(message);
}

type Rec = Record<string, unknown>;

function first(pack: ObjPackJson, file: keyof ObjPackJson): Rec {
  const records = (pack[file] as unknown as { records: Rec[] }).records;
  const rec = records[0];
  if (rec === undefined) throw new Error(`${String(file)} has no records`);
  return rec;
}

/** The last record, which for the reverse-bound lists is index 1. */
function last(pack: ObjPackJson, file: keyof ObjPackJson): Rec {
  const records = (pack[file] as unknown as { records: Rec[] }).records;
  const rec = records[records.length - 1];
  if (rec === undefined) throw new Error(`${String(file)} has no records`);
  return rec;
}

describe("objbase.c: object_base rejections", () => {
  it("rejects an unknown `default:` label (test_default_bad0)", () => {
    /* obj-init.c parse_object_base_defaults returns
     * PARSE_ERROR_UNDEFINED_DIRECTIVE for a label it does not know. */
    expectReject((p) => {
      const header = (p.objectBase as unknown as { header: { default: unknown[] } }).header;
      header.default.push({ label: "xyzzy", value: 8 });
    }, /object_base: unknown default xyzzy/);
  });

  it("rejects an unknown tval on `name:` (test_name_bad0)", () => {
    expectReject((p) => {
      (first(p, "objectBase")["name"] as Rec)["tval"] = "xyzzy";
    }, /object_base: unknown tval xyzzy/);
  });

  it("rejects an unknown flag (test_flags_bad0)", () => {
    expectReject((p) => {
      first(p, "objectBase")["flags"] = ["XYZZY"];
    }, /object_base: invalid flag XYZZY/);
  });
});

describe("k-info.c: object (kind) rejections", () => {
  it("rejects an unknown tval on `type:` (test_type_bad0)", () => {
    expectReject((p) => {
      first(p, "object")["type"] = "xyzzy";
    }, /object: unknown tval xyzzy/);
  });

  it("rejects an unknown flag (test_flags_bad0)", () => {
    expectReject((p) => {
      first(p, "object")["flags"] = ["IGNORE_ACID", "XYZZY"];
    }, /object: invalid flag XYZZY/);
  });

  it("rejects unknown modifier and resistance value names (test_values_bad0)", () => {
    for (const token of ["XYZZY[8]", "RES_XYZZY[-1]"]) {
      expectReject((p) => {
        first(p, "object")["values"] = [token];
      }, /object: invalid value/);
    }
  });

  it("rejects malformed value brackets (test_values_bad0)", () => {
    /* find_value_arg needs both brackets; without them grab_* cannot
     * match any name, so the token is INVALID_VALUE upstream. */
    for (const token of ["STEALTH1]", "RES_ELEC1]", "STEALTH[1", "RES_ELEC[1"]) {
      expectReject((p) => {
        first(p, "object")["values"] = [token];
      }, /invalid value|object: invalid value/);
    }
  });

  it("rejects an unrecognised slay code (test_slay_bad0)", () => {
    expectReject((p) => {
      first(p, "object")["slay"] = ["XYZZY"];
    }, /object: unrecognised slay XYZZY/);
  });

  it("rejects an unrecognised brand code (test_brand_bad0)", () => {
    expectReject((p) => {
      first(p, "object")["brand"] = ["XYZZY"];
    }, /object: unrecognised brand XYZZY/);
  });

  it("rejects an unrecognised curse name (test_curse_bad0)", () => {
    expectReject((p) => {
      first(p, "object")["curse"] = [{ name: "xyzzy", power: 15 }];
    }, /object: unrecognised curse xyzzy/);
  });
});

describe("k-info.c test_alloc_bad0: malformed allocation ranges", () => {
  /**
   * The eight malformed forms from k-info.c that the port's grabIntRange
   * refuses. Upstream also rejects three overflowing forms
   * ("-8989999988989898889389 to 1", "1 to 38928673939573967296967390 23",
   * "1119392572692029396720296 to 3399268...") because grab_int_range
   * checks `lv1 <= INT_MIN || lv1 >= INT_MAX` (datafile.c:329-333, 352-355);
   * the port's regex has no such bound. That divergence is recorded as a
   * port defect in
   * parity/phase3-2026-07-25/findings/W3-UNIT-TESTS-parse.md and is
   * deliberately NOT asserted here.
   */
  const malformed = [
    "7",
    "2to 7",
    "2 to7",
    "a to 7",
    "2 to b",
    "2 x 7",
    "2 sto 7",
    "2 top 7",
  ];

  it.each(malformed)("grabIntRange rejects %j", (range) => {
    expect(() => grabIntRange(range)).toThrow(/invalid allocation range/);
  });

  it("accepts the well-formed form", () => {
    expect(grabIntRange("1 to 75")).toEqual([1, 75]);
    expect(grabIntRange("-5 to 10")).toEqual([-5, 10]);
  });

  it("a malformed alloc on a kind fails the whole bind", () => {
    expectReject((p) => {
      const rec = first(p, "object");
      rec["alloc"] = { common: 2, minmax: "2 x 7" };
    }, /invalid allocation range/);
  });
});

describe("e-info.c: ego_item rejections", () => {
  it("rejects an unknown tval on `type:` (test_type_bad0)", () => {
    expectReject((p) => {
      first(p, "egoItem")["type"] = ["xyzzy"];
    }, /ego: unknown tval xyzzy/);
  });

  it("rejects a tval with no object kinds (test_type_bad0, NO_KIND_FOR_EGO_TYPE)", () => {
    /* obj-init.c parse_ego_type walks k_info for a kind of that tval and
     * returns PARSE_ERROR_NO_KIND_FOR_EGO_TYPE when there is none.
     * "magic book" is a real tval with zero `type:` lines in object.txt
     * (spellbooks come from class.txt's book: directive), so it resolves
     * but has no kinds - the exact shape upstream probes with type:light
     * against its stub k_info. */
    expectReject((p) => {
      first(p, "egoItem")["type"] = ["magic book"];
    }, /ego: no kind for ego type magic book/);
  });

  it("rejects an unknown sval on `item:` (test_item_bad0)", () => {
    expectReject((p) => {
      first(p, "egoItem")["item"] = [{ tval: "helm", sval: "Xyzzy Cap" }];
    }, /ego: unknown sval Xyzzy Cap/);
  });

  it("rejects an unknown tval on `item:` (test_item_bad0)", () => {
    expectReject((p) => {
      first(p, "egoItem")["item"] = [{ tval: "xyzzy", sval: "Skullcap" }];
    }, /ego: unknown tval xyzzy/);
  });

  it("rejects an unknown flag (test_flags_bad0)", () => {
    expectReject((p) => {
      first(p, "egoItem")["flags"] = ["XYZZY"];
    }, /ego: invalid flag XYZZY/);
  });

  it("rejects an unknown flags-off flag (test_flags_off_bad0)", () => {
    expectReject((p) => {
      first(p, "egoItem")["flags-off"] = ["XYZZY"];
    }, /ego: invalid flag-off XYZZY/);
  });

  it("rejects unknown values and min-values (test_values_bad0, test_min_values_bad0)", () => {
    expectReject((p) => {
      first(p, "egoItem")["values"] = ["XYZZY[2]"];
    }, /ego: invalid value XYZZY\[2\]/);
    expectReject((p) => {
      first(p, "egoItem")["min-values"] = ["XYZZY[3]"];
    }, /ego: invalid min-value XYZZY\[3\]/);
  });

  /**
   * The seven OUT_OF_BOUNDS allocation ranges from e-info.c test_alloc_bad0.
   * obj-init.c parse_ego_alloc bounds both ends to 0..255.
   */
  const outOfBounds = [
    "-1 to 100",
    "0 to 290",
    "370 to 40",
    "30 to -7",
    "-70 to -3",
    "-10 to 371",
    "268 to 500",
  ];

  it.each(outOfBounds)("rejects the out-of-bounds range %j", (minmax) => {
    expectReject((p) => {
      first(p, "egoItem")["alloc"] = { common: 40, minmax };
    }, /ego: allocation out of bounds/);
  });

  it("rejects a range with no separator (test_alloc_bad0, INVALID_ALLOCATION)", () => {
    expectReject((p) => {
      first(p, "egoItem")["alloc"] = { common: 40, minmax: "10 100" };
    }, /invalid allocation range/);
  });

  it("rejects unrecognised slay, brand and curse (test_slay/brand/curse_bad0)", () => {
    expectReject((p) => {
      first(p, "egoItem")["slay"] = ["XYZZY"];
    }, /ego: unrecognised slay XYZZY/);
    expectReject((p) => {
      first(p, "egoItem")["brand"] = ["XYZZY"];
    }, /ego: unrecognised brand XYZZY/);
    expectReject((p) => {
      first(p, "egoItem")["curse"] = [{ name: "xyzzy", power: 5 }];
    }, /ego: unrecognised curse xyzzy/);
  });
});

describe("a-info.c: artifact rejections", () => {
  it("rejects an unknown tval on `base-object:` (test_badtval0)", () => {
    expectReject((p) => {
      (first(p, "artifact")["base-object"] as Rec)["tval"] = "xyzzy";
    }, /artifact: unknown tval xyzzy/);
  });

  it("rejects `graphics:` on an ordinary artifact (test_graphics_bad0)", () => {
    /* PARSE_ERROR_NOT_SPECIAL_ARTIFACT: only an INSTA_ART base object may
     * carry per-artifact graphics (obj-init.c parse_artifact_graphics). */
    expectReject((p) => {
      const records = (p.artifact as unknown as { records: Rec[] }).records;
      const ordinary = records.find((r) => r["graphics"] === undefined);
      expect(ordinary, "artifact.txt must contain a non-special artifact").toBeDefined();
      (ordinary as Rec)["graphics"] = { glyph: "~", color: "y" };
    }, /is not a special artifact/);
  });

  it("rejects unknown flags, including bad element suffixes (test_flags_bad0)", () => {
    for (const flag of ["XYZZY", "HATES_XYZZY", "IGNORE_XYZZY"]) {
      expectReject((p) => {
        first(p, "artifact")["flags"] = [flag];
      }, /artifact: invalid flag/);
    }
  });

  it("rejects unknown values (test_values_bad0)", () => {
    for (const token of ["XYZZY[-4]", "RES_XYZZY[1]"]) {
      expectReject((p) => {
        first(p, "artifact")["values"] = [token];
      }, /artifact: invalid value/);
    }
  });

  it("rejects unrecognised slay, brand and curse (test_slay/brand/curse_bad0)", () => {
    expectReject((p) => {
      first(p, "artifact")["slay"] = ["XYZZY"];
    }, /unrecognised slay XYZZY/);
    expectReject((p) => {
      first(p, "artifact")["brand"] = ["XYZZY"];
    }, /unrecognised brand XYZZY/);
    expectReject((p) => {
      first(p, "artifact")["curse"] = [{ name: "xyzzy", power: 25 }];
    }, /unrecognised curse xyzzy/);
  });
});

describe("curse.c: curse rejections", () => {
  it("rejects an unknown tval on `type:` (test_type_bad0)", () => {
    expectReject((p) => {
      last(p, "curse")["type"] = ["xyzzy"];
    }, /curse: unknown tval xyzzy/);
  });

  it("rejects unknown flags (test_flags_bad0)", () => {
    for (const flag of ["XYZZY", "IGNORE_XYZZY"]) {
      expectReject((p) => {
        last(p, "curse")["flags"] = [flag];
      }, /curse: invalid flag/);
    }
  });

  it("rejects unknown values (test_values_bad0)", () => {
    for (const token of ["XYZZY[-8]", "RES_XYZZY[-1]"]) {
      expectReject((p) => {
        last(p, "curse")["values"] = [token];
      }, /curse: invalid value/);
    }
  });

  it("rejects an unknown conflict flag (test_conflict_flags_bad0)", () => {
    expectReject((p) => {
      last(p, "curse")["conflict-flags"] = ["XYZZY"];
    }, /curse: invalid conflict flag XYZZY/);
  });
});

describe("slay.c / brand.c: race-flag rejections", () => {
  it("rejects an unknown slay race-flag (slay.c test_race_flag_bad0)", () => {
    expectReject((p) => {
      last(p, "slay")["race-flag"] = "XYZZY";
    }, /slay: invalid race flag XYZZY/);
  });

  it("rejects an unknown brand resist-flag (brand.c test_resist_flag_bad0)", () => {
    expectReject((p) => {
      last(p, "brand")["resist-flag"] = "XYZZY";
    }, /brand: invalid race flag XYZZY/);
  });

  it("rejects an unknown brand vuln-flag (brand.c test_vuln_flag_bad0)", () => {
    expectReject((p) => {
      last(p, "brand")["vuln-flag"] = "XYZZY";
    }, /brand: invalid race flag XYZZY/);
  });
});

describe("objprop.c: object_property rejections", () => {
  it("rejects an unknown type (test_type_bad0, INVALID_PROPERTY)", () => {
    expectReject((p) => {
      first(p, "objectProperty")["type"] = "xyzzy";
    }, /object_property: invalid type xyzzy/);
  });

  it("rejects an unknown subtype (test_subtype_bad0)", () => {
    expectReject((p) => {
      const records = (p.objectProperty as unknown as { records: Rec[] }).records;
      const withSubtype = records.find((r) => r["subtype"] !== undefined);
      expect(withSubtype, "object_property.txt must use subtype:").toBeDefined();
      (withSubtype as Rec)["subtype"] = "xyzzy";
    }, /object_property: invalid subtype xyzzy/);
  });

  it("rejects an unknown id-type (test_id_type_bad0)", () => {
    expectReject((p) => {
      const records = (p.objectProperty as unknown as { records: Rec[] }).records;
      const withId = records.find((r) => r["id-type"] !== undefined);
      expect(withId, "object_property.txt must use id-type:").toBeDefined();
      (withId as Rec)["id-type"] = "xyzzy";
    }, /object_property: invalid id-type xyzzy/);
  });

  it("rejects an unknown code for its type (test_code_bad0)", () => {
    /* obj-init.c parse_object_property_code dispatches on the record's
     * type, so a bogus code is INVALID_OBJ_PROP_CODE whichever type it is. */
    expectReject((p) => {
      first(p, "objectProperty")["code"] = "xyzzy";
    }, /object_property: invalid code xyzzy/);
  });
});

describe("flavor.c: flavor rejections", () => {
  it("rejects an unknown tval on `kind:` (test_kind_bad0)", () => {
    expectReject((p) => {
      (first(p, "flavor")["kind"] as Rec)["tval"] = "xyzzy";
    }, /flavor: unknown tval xyzzy/);
  });
});
