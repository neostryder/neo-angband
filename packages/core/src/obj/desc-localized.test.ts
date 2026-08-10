/**
 * A locale changing how an object's name is ASSEMBLED - the claim that
 * localization here is more than a string table.
 *
 * Two things have to be true at once and they pull in opposite directions:
 *
 *   1. With no locale installed, every name is byte-identical to what the port
 *      produced before this seam existed. That is what `desc-vectors.test.ts`
 *      measures, over the whole shipped pack, and it is the parity guard.
 *   2. With a locale installed, a language whose grammar is not English's can
 *      actually be expressed - not "Scroll" replaced by "Rolle", which a string
 *      table does, but the RULES: no plural inflection, a counter word, a number
 *      that goes somewhere else.
 *
 * So the locale here is deliberately shaped like Japanese rather than like
 * German. A test that only swapped nouns would pass against a plain lookup table
 * and would prove nothing about this file.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  coreForms,
  registerLocale,
  resetLocales,
  setLocale,
} from "../i18n/i18n.js";
import { englishObjectNameFormat, objDescNameFormat } from "./desc.js";

afterEach(() => {
  resetLocales();
});

describe("with no locale, the English rules are what run", () => {
  it("pluralises the regular way", () => {
    expect(objDescNameFormat("& Scroll~", null, true)).toBe("Scroll s".replace(" ", ""));
    expect(objDescNameFormat("& Scroll~", null, false)).toBe("Scroll");
  });

  it("pluralises with -es after s, h and x", () => {
    expect(objDescNameFormat("& Torch~", null, true)).toBe("Torches");
  });

  it("takes the irregular arm of |singular|plural|", () => {
    expect(objDescNameFormat("& Kni|fe|ves|", null, true)).toBe("Knives");
    expect(objDescNameFormat("& Kni|fe|ves|", null, false)).toBe("Knife");
  });

  it("substitutes the flavour at #", () => {
    expect(objDescNameFormat("& Scroll~ titled #", "xyzzy", true)).toBe(
      "Scrolls titled xyzzy",
    );
  });

  it("SURVIVES a locale reset with no English registered", () => {
    /* The dispatcher falls back to englishObjectNameFormat directly rather than
     * only through the registry, so a test that cleared the locales cannot leave
     * the game unable to name a sword. */
    resetLocales();
    expect(objDescNameFormat("& Long Sword~", null, true)).toBe("Long Swords");
  });
});

describe("a locale replaces the RULES, not the words", () => {
  /** No inflection, and the markup dropped - Japanese's shape, not English's. */
  function installUninflected(): void {
    registerLocale({
      tag: "ja",
      name: "日本語",
      forms: {
        objectNameFormat: (fmt, modstr) => {
          const stripped = fmt
            .replace(/\|([^|]*)\|[^|]*\|/gu, "$1") // always the singular arm
            .replace(/[&~]/gu, "")
            .replace(/#/gu, modstr ?? "")
            .replace(/\s+/gu, " ")
            .trim();
          return stripped;
        },
      },
    });
    setLocale("ja");
  }

  it("makes a plural and a singular identical, which English cannot", () => {
    installUninflected();
    expect(objDescNameFormat("& Scroll~", null, true)).toBe("Scroll");
    expect(objDescNameFormat("& Scroll~", null, false)).toBe("Scroll");
    /* The control: English disagrees with itself between those two calls, so the
     * agreement above is the locale doing something and not the two arguments
     * being ignored. */
    expect(englishObjectNameFormat("& Scroll~", null, true)).toBe("Scrolls");
  });

  it("takes the irregular pair somewhere English's grammar cannot go", () => {
    installUninflected();
    expect(objDescNameFormat("& Kni|fe|ves|", null, true)).toBe("Knife");
  });

  it("goes back to English the moment the locale is switched off", () => {
    installUninflected();
    expect(objDescNameFormat("& Scroll~", null, true)).toBe("Scroll");
    setLocale("en");
    expect(objDescNameFormat("& Scroll~", null, true)).toBe("Scrolls");
  });

  it("lets a locale WRAP English for the words it does not need to change", () => {
    /* The layered case, which is what most European translations actually want:
     * English's machinery with a handful of nouns special-cased. */
    const core = coreForms();
    registerLocale({
      tag: "de",
      forms: {
        objectNameFormat: (fmt, modstr, plural) =>
          fmt.includes("Scroll")
            ? (plural ? "Rollen" : "Rolle")
            : (core.objectNameFormat?.(fmt, modstr, plural) ?? fmt),
      },
    });
    setLocale("de");
    expect(objDescNameFormat("& Scroll~", null, true)).toBe("Rollen");
    /* Delegated: the irregular-plural machinery still runs, and the locale never
     * had to reimplement it. */
    expect(objDescNameFormat("& Kni|fe|ves|", null, true)).toBe("Knives");
  });
});
