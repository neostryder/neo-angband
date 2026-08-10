/**
 * The localization layer: the fallback chain, ICU formatting, and the FORMS
 * seam - the one that exists because a string table cannot express a grammar.
 *
 * The forms half is the half worth being careful about. Its whole claim is that
 * a language whose plurals are not English's can be made to work, so the tests
 * below use a locale that changes plurality STRUCTURALLY (a counter word, a noun
 * that never inflects) rather than one that swaps words - a test that only
 * proves you can replace "Scroll" with "Rolle" would pass against a plain string
 * table and prove nothing about this file.
 */

import { afterEach, describe, expect, it } from "vitest";
import {
  activeLocale,
  coreForms,
  formatMessage,
  forms,
  installedLocales,
  patternFor,
  pluralCategory,
  registerLocale,
  registerSourceForms,
  resetLocales,
  setLocale,
  SOURCE_LOCALE,
  t,
} from "./i18n.js";
import { charCells, padToCells, textCells, truncateToCells } from "./text.js";

afterEach(() => {
  resetLocales();
});

describe("the fallback chain never leaves a hole", () => {
  it("returns the call site's English when nothing is installed", () => {
    expect(t("ui.quit", "Quit")).toBe("Quit");
  });

  it("prefers the active locale", () => {
    registerLocale({ tag: "de", messages: { "ui.quit": "Beenden" } });
    setLocale("de");
    expect(t("ui.quit", "Quit")).toBe("Beenden");
  });

  it("falls back from a REGION to its language", () => {
    registerLocale({ tag: "pt", messages: { "ui.quit": "Sair" } });
    setLocale("pt-BR");
    expect(t("ui.quit", "Quit")).toBe("Sair");
  });

  it("prefers the region's own entry over the language's", () => {
    registerLocale({ tag: "pt", messages: { "ui.quit": "Sair" } });
    registerLocale({ tag: "pt-BR", messages: { "ui.quit": "Sair (BR)" } });
    setLocale("pt-BR");
    expect(t("ui.quit", "Quit")).toBe("Sair (BR)");
  });

  it("shows ENGLISH for an id a half-finished translation has not reached", () => {
    /* The alternative designs both fail a player: showing the raw id gives them
     * `ui.quit`, and showing a blank gives them nothing. A partial translation
     * is the normal state of every translation there has ever been. */
    registerLocale({ tag: "de", messages: { "ui.save": "Speichern" } });
    setLocale("de");
    expect(t("ui.quit", "Quit")).toBe("Quit");
    expect(t("ui.save", "Save")).toBe("Speichern");
  });

  it("treats an unknown language as untranslated rather than as an error", () => {
    setLocale("xx-YY");
    expect(t("ui.quit", "Quit")).toBe("Quit");
    expect(activeLocale()).toBe("xx-YY");
  });

  it("starts and resets to English", () => {
    expect(activeLocale()).toBe(SOURCE_LOCALE);
    setLocale("de");
    resetLocales();
    expect(activeLocale()).toBe(SOURCE_LOCALE);
  });

  it("MERGES two mods translating the same language rather than replacing", () => {
    /* A pack that only corrects the messages must not silently drop the forms an
     * earlier one registered - that is a whole language's grammar disappearing
     * over a spelling fix. */
    registerLocale({
      tag: "de",
      messages: { a: "A" },
      forms: { objectNamePrefix: () => "DE:" },
    });
    registerLocale({ tag: "de", messages: { b: "B" } });
    setLocale("de");
    expect(t("a", "a")).toBe("A");
    expect(t("b", "b")).toBe("B");
    expect(forms().objectNamePrefix?.("", "", false, 1, false)).toBe("DE:");
  });

  it("lists what is installed", () => {
    registerLocale({ tag: "de", name: "Deutsch" });
    expect(installedLocales().map((l) => l.tag)).toContain("de");
  });
});

describe("ICU formatting, with the plural rules coming from the platform", () => {
  it("substitutes a named value", () => {
    expect(formatMessage("You have {n} gold.", { n: 12 })).toBe("You have 12 gold.");
  });

  it("groups a number the locale's own way", () => {
    expect(formatMessage("{n, number}", { n: 1234567 }, "en")).toBe("1,234,567");
    expect(formatMessage("{n, number}", { n: 1234567 }, "de")).toBe("1.234.567");
  });

  it("picks the plural arm, with # as the number", () => {
    const p = "{n, plural, one {# scroll} other {# scrolls}}";
    expect(formatMessage(p, { n: 1 }, "en")).toBe("1 scroll");
    expect(formatMessage(p, { n: 3 }, "en")).toBe("3 scrolls");
  });

  it("USES THE LANGUAGE'S OWN CATEGORIES, not English's two", () => {
    /* The point of routing through Intl.PluralRules. Polish has `one`, `few` and
     * `many`, and `n === 1 ? a : b` - the obvious shortcut - is wrong for every
     * Polish noun above one. Core never learns what `few` is; the catalogue
     * writes the arm and the platform selects it. */
    const p = "{n, plural, one {# zwój} few {# zwoje} many {# zwojów} other {# zwoju}}";
    expect(formatMessage(p, { n: 1 }, "pl")).toContain("zwój");
    expect(formatMessage(p, { n: 3 }, "pl")).toContain("zwoje");
    expect(formatMessage(p, { n: 5 }, "pl")).toContain("zwojów");
    /* And the control: the same categories are NOT what English selects, so the
     * test above is measuring the locale rather than the arm order. */
    expect(pluralCategory(3, "en")).toBe("other");
    expect(pluralCategory(3, "pl")).toBe("few");
  });

  it("lets an EXACT arm short-circuit the categories", () => {
    /* Angband wants this: "no more Scrolls" is not the zero form of anything,
     * it is its own sentence (obj_desc_name_prefix's `number == 0` arm). */
    const p = "{n, plural, =0 {no more scrolls} one {# scroll} other {# scrolls}}";
    expect(formatMessage(p, { n: 0 }, "en")).toBe("no more scrolls");
    expect(formatMessage(p, { n: 2 }, "en")).toBe("2 scrolls");
  });

  it("selects on an exact value, for gender and any other closed set", () => {
    const p = "{g, select, male {He} female {She} other {They}} hits you.";
    expect(formatMessage(p, { g: "female" })).toBe("She hits you.");
    expect(formatMessage(p, { g: "wolf" })).toBe("They hits you.");
  });

  it("does ordinals through the same rules", () => {
    const p = "{n, selectordinal, one {#st} two {#nd} few {#rd} other {#th}}";
    expect(formatMessage(p, { n: 1 }, "en")).toBe("1st");
    expect(formatMessage(p, { n: 2 }, "en")).toBe("2nd");
    expect(formatMessage(p, { n: 11 }, "en")).toBe("11th");
  });

  it("nests a placeholder inside a plural arm", () => {
    const p = "{n, plural, one {a {what}} other {# {what}s}}";
    expect(formatMessage(p, { n: 1, what: "ring" })).toBe("a ring");
    expect(formatMessage(p, { n: 4, what: "ring" })).toBe("4 rings");
  });

  it("takes a literal brace through ICU's quoting", () => {
    expect(formatMessage("a '{literal'} brace", {})).toBe("a {literal} brace");
  });

  it("shows a placeholder with no value AS ITSELF, so the fault is visible", () => {
    /* A blank would be a sentence with a hole nobody can diagnose - and this
     * fires when the translation invented a slot, which is the translator's
     * mistake to see. */
    expect(formatMessage("You have {n} gold.", {})).toBe("You have {n} gold.");
  });

  it("shows a MALFORMED pattern as text instead of throwing mid-draw", () => {
    /* A broken pattern is a typo in somebody's translation file. Throwing out of
     * the middle of a draw call would turn it into a blank screen. */
    expect(formatMessage("unbalanced {n, plural, one {x", { n: 1 })).toContain(
      "unbalanced",
    );
    expect(() => formatMessage("{}{{{", {})).not.toThrow();
  });

  it("does not throw on a language tag Intl cannot parse", () => {
    expect(pluralCategory(2, "not a tag!!")).toBe("other");
    expect(formatMessage("{n, number}", { n: 5 }, "not a tag!!")).toBe("5");
  });
});

describe("forms: the seam a string table cannot replace", () => {
  it("resolves to nothing when neither core nor a locale supplies one", () => {
    /* This file never imports obj/desc.ts, so core's English forms are not
     * registered in this process - which is what makes the assertion legible.
     * The game itself always has them; desc-localized.test.ts is where that is
     * measured. */
    expect(forms().objectNameFormat).toBeUndefined();
  });

  it("lets a locale replace how a name is ASSEMBLED, not just its words", () => {
    /* A Japanese-shaped rule, deliberately: no plural inflection at all, and the
     * count carried by a counter word after the number. A translator armed only
     * with string replacement cannot express either. */
    registerLocale({
      tag: "ja",
      forms: {
        objectNameFormat: (fmt) => fmt.replace(/[&~#]|\|[^|]*\|[^|]*\|/gu, "").trim(),
        objectNamePrefix: (_b, _m, _t, n) => (n === 1 ? "" : `${n}巻の`),
      },
    });
    setLocale("ja");
    const f = forms();
    expect(f.objectNameFormat?.("& Scroll~ titled #", "xyzzy", true)).toBe("Scroll titled");
    expect(f.objectNamePrefix?.("& Scroll~", "", false, 3, false)).toBe("3巻の");
    expect(f.objectNamePrefix?.("& Scroll~", "", false, 1, false)).toBe("");
  });

  it("hands back core's own forms, so a locale can WRAP instead of reimplement", () => {
    /* The affordance registry:blow's handlerFor gives, for the same reason: a
     * language whose plurals are English's bar a handful of nouns should
     * special-case those and delegate the rest. */
    registerSourceForms({ objectNameFormat: (fmt) => `EN(${fmt})` });
    const core = coreForms();
    expect(core.objectNameFormat?.("x", null, false)).toBe("EN(x)");
    registerLocale({
      tag: "de",
      forms: {
        objectNameFormat: (fmt, mod, plural) =>
          fmt === "special" ? "besonders" : (core.objectNameFormat?.(fmt, mod, plural) ?? fmt),
      },
    });
    setLocale("de");
    expect(forms().objectNameFormat?.("special", null, false)).toBe("besonders");
    expect(forms().objectNameFormat?.("ordinary", null, false)).toBe("EN(ordinary)");
  });

  it("takes only the members the locale supplies and inherits the rest", () => {
    registerSourceForms({ objectNamePrefix: () => "the " });
    registerLocale({ tag: "de", forms: { objectNameFormat: () => "DE" } });
    setLocale("de");
    expect(forms().objectNameFormat?.("x", null, false)).toBe("DE");
    expect(forms().objectNamePrefix?.("", "", false, 1, false)).toBe("the ");
  });

  it("reports the pattern a lookup resolved to, for an authoring tool", () => {
    registerLocale({ tag: "de", messages: { greet: "Hallo" } });
    setLocale("de");
    expect(patternFor("greet", "Hello")).toBe("Hallo");
    expect(patternFor("absent", "Hello")).toBe("Hello");
  });
});

describe("how wide a string is on a GRID", () => {
  it("counts an ideograph as two cells, because a terminal draws it that way", () => {
    expect(textCells("ab")).toBe(2);
    expect(textCells("巻物")).toBe(4);
    expect(textCells("a巻")).toBe(3);
  });

  it("counts a combining mark as nothing", () => {
    /* `e` + U+0301 is one cell showing é. Counting it as two pushes every column
     * after it along by one for the rest of the row - and Latin languages with
     * decomposed accents hit this long before anyone reaches CJK. */
    expect(textCells("é")).toBe(1);
    expect(charCells(0x0301)).toBe(0);
  });

  it("counts an astral character once, where .length counts two", () => {
    const emoji = "\u{1F600}";
    expect(emoji.length).toBe(2);
    expect(textCells(emoji)).toBe(2); // wide, but ONE character not two units
    expect(textCells("\u{20000}")).toBe(2);
  });

  it("truncates without splitting a wide character across the boundary", () => {
    expect(truncateToCells("巻物x", 3)).toBe("巻");
    expect(truncateToCells("巻物x", 4)).toBe("巻物");
    expect(truncateToCells("abcd", 3)).toBe("abc");
    expect(truncateToCells("abcd", 0)).toBe("");
  });

  it("pads to a cell budget rather than to a character count", () => {
    expect(padToCells("巻", 4)).toBe("巻  ");
    expect(padToCells("abcd", 2)).toBe("abcd");
  });
});
