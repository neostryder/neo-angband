/**
 * The random-artifact export.
 *
 * Flag, brand and slay tokens keep the data file's own spelling. The seed is
 * the unsigned 32-bit value the generator was given.
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

function uint32(): Validator<number> {
  return {
    validate(value, path = "$") {
      const result = json.integer.validate(value, path);
      if (!result.ok) return result;
      if (result.value < 0 || result.value > 0xffffffff) {
        return { ok: false, issues: [{ path, message: "expected an unsigned 32-bit integer" }] };
      }
      return result;
    },
  };
}

const artifact = json.object({
  name: nonEmpty(),
  text: json.string,
  baseTval: nonEmpty(),
  baseName: json.string,
  graphics: json.optional(json.object({
    character: nonEmpty(),
    attr: nonEmpty(),
  })),
  level: json.integer,
  weight: json.integer,
  cost: json.integer,
  allocProb: json.integer,
  allocMin: json.integer,
  allocMax: json.integer,
  attackDice: json.integer,
  attackSides: json.integer,
  toHit: json.integer,
  toDamage: json.integer,
  ac: json.integer,
  toArmor: json.integer,
  flags: json.optional(json.array(nonEmpty())),
  modifiers: json.optional(json.array(json.object({
    name: nonEmpty(),
    value: json.integer,
  }))),
  elements: json.optional(json.array(json.object({
    name: nonEmpty(),
    level: json.integer,
  }))),
  slays: json.optional(json.array(nonEmpty())),
  brands: json.optional(json.array(nonEmpty())),
  curses: json.optional(json.array(json.object({
    name: nonEmpty(),
    power: json.integer,
  }))),
  activation: json.optional(json.object({
    name: nonEmpty(),
    base: json.integer,
    dice: json.integer,
    sides: json.integer,
  })),
});

export const randartFormat = defineFormat({
  format: "neo-angband/object/randart",
  schemaVersion: 1,
  validator: json.object({
    seed: uint32(),
    artifacts: json.array(artifact),
  }),
  sample: {
    seed: 0x5eed,
    artifacts: [
      {
        name: "of Power",
        text: "It is a long sword of Power.",
        baseTval: "sword",
        baseName: "long sword",
        level: 20,
        weight: 30,
        cost: 1000,
        allocProb: 10,
        allocMin: 1,
        allocMax: 100,
        attackDice: 2,
        attackSides: 6,
        toHit: 5,
        toDamage: 5,
        ac: 0,
        toArmor: 0,
        flags: ["SUST_STR"],
        slays: ["ORC"],
      },
    ],
  },
});
