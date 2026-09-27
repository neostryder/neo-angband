import type { ValidationResult, Validator } from "./index.js";

const good = <T>(value: T): ValidationResult<T> => ({ ok: true, value });
const bad = (path: string, message: string): ValidationResult<never> => ({
  ok: false,
  issues: [{ path, message }],
});

/** An integer channel from 0 to 255. */
export const uint8: Validator<number> = {
  validate(value, path = "$") {
    if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > 255) {
      return bad(path, "expected an integer from 0 to 255");
    }
    return good(value);
  },
};

/** A non-negative safe integer. */
export const nonNegativeInt: Validator<number> = {
  validate(value, path = "$") {
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
      return bad(path, "expected a non-negative integer");
    }
    return good(value);
  },
};

/** Empty, or exactly one Unicode scalar. A stored glyph is never a string of text. */
export const glyph: Validator<string> = {
  validate(value, path = "$") {
    if (typeof value !== "string") return bad(path, "expected a string");
    if (value !== "" && [...value].length !== 1) return bad(path, "expected one Unicode scalar");
    return good(value);
  },
};

/** A string with at least one character. */
export const nonempty: Validator<string> = {
  validate(value, path = "$") {
    if (typeof value !== "string" || value.length === 0) return bad(path, "expected a nonempty string");
    return good(value);
  },
};
