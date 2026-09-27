/**
 * Cross-life monster memory.
 *
 * Race names and flag tokens keep the spellings the game already stores
 * ("Farmer Maggot", "UNIQUE"). Renaming them would drop a player's memory
 * of a race the moment the file was read back.
 */

import { defineFormat, json } from "./index.js";
import type { Validator } from "./index.js";

function nonEmpty(): Validator<string> {
  return {
    validate(value, path = "$") {
      const result = json.string.validate(value, path);
      if (!result.ok) return result;
      if (result.value.length === 0) {
        return { ok: false, issues: [{ path, message: "expected a non-empty string" }] };
      }
      return result;
    },
  };
}

function nonNegative(): Validator<number> {
  return {
    validate(value, path = "$") {
      const result = json.integer.validate(value, path);
      if (!result.ok) return result;
      if (result.value < 0) {
        return { ok: false, issues: [{ path, message: "expected a non-negative integer" }] };
      }
      return result;
    },
  };
}

const blowShape = json.object({
  index: nonNegative(),
  seen: json.integer,
  method: json.optional(nonEmpty()),
  effect: json.optional(nonEmpty()),
  damage: json.optional(nonEmpty()),
});

const blow: typeof blowShape = {
  validate(value, path = "$") {
    const result = blowShape.validate(value, path);
    if (!result.ok) return result;
    if (result.value.seen <= 0) {
      return { ok: false, issues: [{ path: `${path}["seen"]`, message: "seen must be positive" }] };
    }
    return result;
  },
};

export const loreFormat = defineFormat({
  format: "neo-angband/monster/lore",
  schemaVersion: 1,
  validator: json.object({
    races: json.array(json.object({
      name: nonEmpty(),
      allKnown: json.boolean,
      base: json.optional(nonEmpty()),
      sights: nonNegative(),
      deaths: nonNegative(),
      tkills: nonNegative(),
      wake: nonNegative(),
      ignore: nonNegative(),
      castInnate: nonNegative(),
      castSpell: nonNegative(),
      blows: json.optional(json.array(blow)),
      flags: json.optional(json.array(nonEmpty())),
      spells: json.optional(json.array(nonEmpty())),
    })),
  }),
  sample: {
    races: [
      {
        name: "kobold",
        allKnown: false,
        sights: 4,
        deaths: 1,
        tkills: 9,
        wake: 2,
        ignore: 3,
        castInnate: 5,
        castSpell: 6,
        blows: [{ index: 1, seen: 3, method: "HIT", effect: "HURT", damage: "0+1d4M0" }],
        flags: ["UNIQUE"],
        spells: ["SHRIEK"],
      },
    ],
  },
});
