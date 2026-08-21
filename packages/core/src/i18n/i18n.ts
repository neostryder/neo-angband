/**
 * Localization: message catalogues, plural-correct formatting, and the seam for
 * the text a translation cannot reach by substituting strings.
 *
 * ENGLISH IS THE DEFAULT AND SHIPS IN CORE. A locale is a MOD - it arrives as a
 * `locale` resource in a mod folder (MOD_REACH gap 7's seam), and the game runs
 * in English with none installed. Nothing here makes the port less faithful,
 * because the English a message id resolves to is the same literal that used to
 * be written at the call site.
 *
 * ## Why a string table alone is not enough, in this game specifically
 *
 * Angband does not store the words it prints. It ASSEMBLES them. An object's
 * name comes out of `obj-desc.c` as a pattern - `"& Scroll~ titled #"` - with a
 * slot for the article, a pluralizer, a slot for a flavour, and a count glued to
 * the front. The rules that turn that into "3 Scrolls titled xyzzy" are English:
 * `~` appends `s` (or `es` after s/h/x), `&` becomes `a` or `an` by the vowel
 * that follows, and the count goes first.
 *
 * Almost none of that survives translation. German inflects the adjective for
 * the noun's gender and case. Japanese has no plural `s` and puts a COUNTER
 * after the number that depends on what is being counted - 3 scrolls is 巻物三巻,
 * not 三巻物. Polish has three plural forms where English has one. A translator
 * handed `"& Scroll~ titled #"` and asked to replace the words cannot express
 * any of it, and a translator handed the finished English sentence has already
 * lost the count.
 *
 * So this module has two halves, and the second is the point:
 *
 *   MESSAGES - `t(id, args)`. An id, a default written by whoever wrote the call
 *   site, and an ICU-shaped pattern in between. Plural category comes from
 *   `Intl.PluralRules`, so a Polish catalogue can write `few` and `many` without
 *   core ever having heard of Polish, and an Arabic one gets all six.
 *
 *   FORMS - `forms()`. Named FUNCTIONS a locale replaces outright, for the text
 *   that is composed rather than written. Core registers English; a locale
 *   registers its own, and `coreForms()` hands back core's so a locale can wrap
 *   rather than reimplement - the same shape `registry:blow`'s `handlerFor` and
 *   `registry:store`'s wildcard already have.
 *
 * ## Fallback, and why it is never empty
 *
 * A lookup walks: the active locale (`pt-BR`), then its base language (`pt`),
 * then the DEFAULT written at the call site. Never a blank and never the raw id.
 * A half-finished translation shows the untranslated line in English, which is
 * readable; the alternatives are a screen of `object.name.prefix` or a screen of
 * nothing, and a player can act on neither.
 *
 * ## What this module is not
 *
 * Not a bulk conversion of the port's UI text. The call sites move id by id, and
 * an unconverted literal is simply a string that is not translatable yet -
 * visible, greppable, and no worse than it was. What is NOT acceptable is a
 * catalogue with no reader, so every id here has a call site in the same commit
 * that introduced it.
 */

/**
 * A BCP 47 language tag, as a locale names itself: `de`, `pt-BR`, `zh-Hans`.
 *
 * Not validated beyond its shape. Tag validity is `Intl`'s to judge and it
 * judges leniently, and refusing a tag this build's ICU data does not know would
 * refuse a translation that is perfectly readable - the formatting would fall
 * back to English conventions, which is a degradation and not a failure.
 */
export type LocaleTag = string;

/** The tag the game runs in when nothing has been chosen, and always ships. */
export const SOURCE_LOCALE: LocaleTag = "en";

/** One locale's messages: id -> ICU-shaped pattern. */
export type MessageCatalog = Readonly<Record<string, string>>;

/** Values a pattern's placeholders are filled from. */
export type MessageArgs = Readonly<Record<string, string | number>>;

/**
 * The text a locale replaces with CODE rather than with strings.
 *
 * A closed interface rather than an open `Record<string, Function>`, so a
 * translator's mistake is a type error and so the set is enumerable - "what can
 * a locale actually override" has to have an answer an authoring tool can print.
 * Every member is optional: a locale supplies the ones its language needs and
 * inherits English for the rest.
 */
export interface TextForms {
  /**
   * `obj_desc_name_format` (obj-desc.c L231): turn a base-name pattern into
   * words. `fmt` carries `&` (article slot), `~` (pluralizer), `|sing|plur|`
   * (irregular plural) and `#` (the flavour or material slot).
   *
   * THE MOST STRUCTURAL THING IN THE GAME'S TEXT. A locale that overrides this
   * is deciding what a plural IS, which is the thing a string table cannot say.
   */
  objectNameFormat?(fmt: string, modstr: string | null, plural: boolean): string;
  /**
   * `obj_desc_name_prefix` (obj-desc.c L268): what goes in front - the count,
   * `a`/`an` by the following vowel, `the` for a known artifact, `no more` for
   * none. A language with no articles returns "" here; one with a counter word
   * returns the counter; one that puts the number after the noun returns ""
   * and does its counting in `objectNameFormat`.
   */
  objectNamePrefix?(
    basename: string,
    modstr: string,
    terse: boolean,
    number: number,
    knownArtifact: boolean,
  ): string;
}

/** Everything one locale supplies. */
export interface LocaleBundle {
  readonly tag: LocaleTag;
  /** The name of the language IN that language, for the menu row. */
  readonly name?: string;
  /** Right-to-left script, for a front end that can honour it. */
  readonly rtl?: boolean;
  readonly messages?: MessageCatalog;
  readonly forms?: TextForms;
}

/* --- The registry ---------------------------------------------------------
 *
 * Module-level, like the other mod registries, and sound for the same reason:
 * enabling or disabling a mod takes effect on RELOAD, so the set of installed
 * locales cannot change under a running game. The ACTIVE tag can change - a
 * player switching language mid-session is an ordinary thing to want - which is
 * why the active tag is a separate variable rather than a second registry.
 */

const bundles = new Map<LocaleTag, LocaleBundle>();
let active: LocaleTag = SOURCE_LOCALE;
/**
 * CORE's own English forms - the rules the game has always used.
 *
 * A SEPARATE cell from the bundle map, and not merely tidiness. `resetLocales`
 * has to put a test back where a fresh boot starts, and a fresh boot has
 * English's grammar in place: core registers it at module scope, once, and a
 * test cannot make that happen a second time. Clearing this along with the mods
 * would leave every test after the first one unable to pluralise a sword, and
 * the failure would look like a bug in the seam rather than in the reset.
 */
let builtinForms: TextForms = {};

/**
 * Install a locale. Called by core for English at boot, and by the host for
 * each locale a mod supplies.
 *
 * Last writer wins, matching every other composition layer in this project (the
 * mod manager's "loads last, wins conflicts" row means it), so a mod later in
 * the load order may improve on an earlier one's translation.
 */
export function registerLocale(bundle: LocaleBundle): void {
  const existing = bundles.get(bundle.tag);
  bundles.set(bundle.tag, {
    ...bundle,
    /* MERGED, not replaced, when two mods supply the same tag: a locale pack
     * that only fixes the messages must not silently drop the forms an earlier
     * one registered, which is a whole language's grammar disappearing over a
     * spelling correction. */
    messages: { ...existing?.messages, ...bundle.messages },
    forms: { ...existing?.forms, ...bundle.forms },
  });
}

/**
 * Install CORE's own English forms. Called once, from the module that owns the
 * rules - not by mods, which use `registerLocale`.
 *
 * The distinction is what makes `resetLocales` safe: this survives it, mod
 * locales do not. A mod may still register `en` forms through `registerLocale`
 * and they will win, because a first-party wording or grammar fix should be
 * able to ship as a mod like anything else.
 */
export function registerSourceForms(supplied: TextForms): void {
  builtinForms = { ...builtinForms, ...supplied };
}

/** Every installed tag, in registration order. */
export function installedLocales(): LocaleBundle[] {
  return [...bundles.values()];
}

/** The tag the game is running in. */
export function activeLocale(): LocaleTag {
  return active;
}

/**
 * Switch language. Accepts any tag; an unknown one simply resolves everything
 * through the fallback chain to English, which is the same outcome as a
 * catalogue that translates nothing and is better than refusing.
 */
export function setLocale(tag: LocaleTag): void {
  active = tag || SOURCE_LOCALE;
}

/** Forget everything and go back to English - for tests, and for a fresh boot. */
export function resetLocales(): void {
  bundles.clear();
  active = SOURCE_LOCALE;
  /* `builtinForms` deliberately survives - see its declaration. */
}

/**
 * The base language of a tag: `pt-BR` -> `pt`. Null when there is no shorter
 * form, which stops the fallback walk.
 */
function baseOf(tag: LocaleTag): LocaleTag | null {
  const dash = tag.indexOf("-");
  return dash > 0 ? tag.slice(0, dash) : null;
}

/** The tags a lookup walks, most specific first. */
function chain(tag: LocaleTag = active): LocaleTag[] {
  const out = [tag];
  const base = baseOf(tag);
  if (base !== null) out.push(base);
  if (!out.includes(SOURCE_LOCALE)) out.push(SOURCE_LOCALE);
  return out;
}

/**
 * The composed forms for the active locale: its own where it has them, core's
 * English everywhere else.
 *
 * Composed per call rather than cached, because caching would need invalidating
 * on `setLocale` and on every `registerLocale`, and this is a two-key object
 * lookup on a path that is already building a string.
 */
export function forms(): TextForms {
  const out: TextForms = { ...builtinForms };
  /* Least specific first, so the active tag's own entries land last and win. */
  for (const tag of chain().reverse()) {
    const bundle = bundles.get(tag);
    if (bundle?.forms) Object.assign(out, bundle.forms);
  }
  return out;
}

/**
 * English's forms, so a locale can WRAP core rather than only replace it.
 *
 * The same affordance `registry:blow`'s `handlerFor` gives, and for the same
 * reason: a language whose plurals are English's except for a handful of nouns
 * should be able to special-case those and delegate the rest, not reimplement
 * `obj_desc_name_format` and inherit its bugs.
 */
export function coreForms(): TextForms {
  return { ...builtinForms, ...bundles.get(SOURCE_LOCALE)?.forms };
}

/**
 * The localized text for `id`, filling `args` into it.
 *
 * `fallback` is REQUIRED and is the English written at the call site. Making it
 * an argument rather than a lookup into an English catalogue is deliberate: it
 * keeps the words next to the code that prints them, so a reader of the call
 * site still sees the sentence, and it makes a missing catalogue entry
 * impossible rather than merely unlikely. The English catalogue may still
 * override it - that is how a first-party wording fix ships without touching
 * code - but nothing depends on its existing.
 */
export function t(id: string, fallback: string, args: MessageArgs = {}): string {
  return formatMessage(patternFor(id, fallback), args, active);
}

/** The pattern `id` resolves to under the active locale, walking the chain. */
export function patternFor(id: string, fallback: string): string {
  for (const tag of chain()) {
    const found = bundles.get(tag)?.messages?.[id];
    if (typeof found === "string") return found;
  }
  return fallback;
}

/* --- The formatter -------------------------------------------------------- */

/**
 * Fill an ICU-shaped pattern.
 *
 * A SUBSET of ICU MessageFormat, chosen rather than invented: it is what every
 * translator already knows and what every translation tool already edits, so a
 * catalogue for this game is a catalogue in the ordinary sense rather than a
 * file only this project can read. What is supported:
 *
 *   {name}                        the value, as text
 *   {name, number}                Intl.NumberFormat for the locale
 *   {name, plural, one {..} other {..}}      Intl.PluralRules picks the arm
 *   {name, selectordinal, ...}    Intl.PluralRules in ordinal mode
 *   {name, select, a {..} other {..}}        exact match on the value
 *
 * `#` inside a plural arm is the number, formatted for the locale. `'{'` escapes
 * a literal brace, as ICU spells it.
 *
 * THE PLURAL CATEGORIES ARE NOT CORE'S TO KNOW. `Intl.PluralRules` answers
 * `one`/`few`/`many`/`other` per language, so a Polish catalogue writes the arms
 * Polish needs and this code never learns what they are. Hard-coding
 * `n === 1 ? singular : plural` - the obvious shortcut - is wrong in most of the
 * world's languages and is the single most common way a localization is broken
 * from the inside.
 */
export function formatMessage(
  pattern: string,
  args: MessageArgs,
  locale: LocaleTag = active,
): string {
  return renderParts(parsePattern(pattern), args, locale, null);
}

/** A literal run, or one `{...}` placeholder. */
type Part =
  | { kind: "text"; text: string }
  | {
      kind: "arg";
      name: string;
      /** Absent for a plain `{name}`. */
      type?: "number" | "plural" | "selectordinal" | "select";
      /** Arm name -> its own parsed body. */
      arms?: Record<string, Part[]>;
    };

/**
 * Split a pattern into literals and placeholders.
 *
 * Hand-written rather than pulled in, because `packages/core` has zero package
 * dependencies on purpose and that is worth more than the hundred lines below.
 * A pattern nothing can parse is returned as LITERAL TEXT rather than throwing:
 * a malformed entry in a translation is a translator's typo, and showing them
 * their own broken pattern is a better outcome than an exception thrown out of
 * the middle of a draw call.
 */
function parsePattern(pattern: string): Part[] {
  const parts: Part[] = [];
  let text = "";
  let i = 0;
  while (i < pattern.length) {
    const c = pattern[i] as string;
    if (c === "'" && (pattern[i + 1] === "{" || pattern[i + 1] === "}")) {
      /* ICU's quoting: '{ is a literal brace. */
      text += pattern[i + 1];
      i += 2;
      continue;
    }
    if (c !== "{") {
      text += c;
      i++;
      continue;
    }
    const end = matchBrace(pattern, i);
    if (end < 0) {
      /* Unbalanced: the rest is literal, and the translator sees their typo. */
      text += pattern.slice(i);
      break;
    }
    if (text !== "") {
      parts.push({ kind: "text", text });
      text = "";
    }
    const arg = parseArg(pattern.slice(i + 1, end));
    parts.push(arg ?? { kind: "text", text: pattern.slice(i, end + 1) });
    i = end + 1;
  }
  if (text !== "") parts.push({ kind: "text", text });
  return parts;
}

/** The index of the `}` closing the `{` at `open`, or -1 when unbalanced. */
function matchBrace(s: string, open: number): number {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "'" && (s[i + 1] === "{" || s[i + 1] === "}")) {
      i++;
      continue;
    }
    if (s[i] === "{") depth++;
    else if (s[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

/** Parse the inside of a placeholder, or null when it is not one. */
function parseArg(body: string): Part | null {
  const firstComma = body.indexOf(",");
  if (firstComma < 0) {
    const name = body.trim();
    return name === "" ? null : { kind: "arg", name };
  }
  const name = body.slice(0, firstComma).trim();
  const rest = body.slice(firstComma + 1).trim();
  const secondComma = rest.indexOf(",");
  const type = (secondComma < 0 ? rest : rest.slice(0, secondComma)).trim();
  if (name === "") return null;
  if (type === "number") return { kind: "arg", name, type: "number" };
  if (type !== "plural" && type !== "selectordinal" && type !== "select") return null;
  if (secondComma < 0) return null;
  const arms = parseArms(rest.slice(secondComma + 1));
  return arms === null ? null : { kind: "arg", name, type, arms };
}

/** `one {...} other {...}` -> a map of arm name to parsed body. */
function parseArms(s: string): Record<string, Part[]> | null {
  const arms: Record<string, Part[]> = {};
  let i = 0;
  while (i < s.length) {
    while (i < s.length && /\s/u.test(s[i] as string)) i++;
    if (i >= s.length) break;
    const brace = s.indexOf("{", i);
    if (brace < 0) return null;
    const label = s.slice(i, brace).trim();
    const end = matchBrace(s, brace);
    if (end < 0 || label === "") return null;
    arms[label] = parsePattern(s.slice(brace + 1, end));
    i = end + 1;
  }
  return Object.keys(arms).length > 0 ? arms : null;
}

/** Render parsed parts; `hash` is the number `#` stands for, inside an arm. */
function renderParts(
  parts: readonly Part[],
  args: MessageArgs,
  locale: LocaleTag,
  hash: number | null,
): string {
  let out = "";
  for (const part of parts) {
    if (part.kind === "text") {
      out += hash === null ? part.text : part.text.split("#").join(num(hash, locale));
      continue;
    }
    out += renderArg(part, args, locale);
  }
  return out;
}

function renderArg(part: Part & { kind: "arg" }, args: MessageArgs, locale: LocaleTag): string {
  const value = args[part.name];
  if (value === undefined) {
    /* A placeholder with no value is shown as itself. The call site is wrong, or
     * the translation invented a slot; either way the reader sees which one, and
     * a blank would be a sentence with a hole in it that nobody can diagnose. */
    return `{${part.name}}`;
  }
  if (part.type === undefined) return String(value);
  if (part.type === "number") {
    return typeof value === "number" ? num(value, locale) : String(value);
  }
  const arms = part.arms ?? {};
  if (part.type === "select") {
    const arm = arms[String(value)] ?? arms["other"];
    return arm === undefined ? String(value) : renderParts(arm, args, locale, null);
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  /* An EXACT arm beats the category: ICU lets `=0 {no more}` short-circuit the
   * plural rules, and Angband wants exactly that - "no more Scrolls" is not the
   * zero form of anything, it is its own sentence. */
  const exact = arms[`=${n}`];
  if (exact !== undefined) return renderParts(exact, args, locale, n);
  const category = pluralCategory(n, locale, part.type === "selectordinal");
  const arm = arms[category] ?? arms["other"];
  return arm === undefined ? num(n, locale) : renderParts(arm, args, locale, n);
}

/**
 * The plural category for `n` in `locale`, from the platform.
 *
 * Wrapped in a try because `Intl.PluralRules` throws on a tag it cannot parse,
 * and a translator's typo in a tag must not become an exception inside a draw
 * call. Falling back to `other` gives the arm every catalogue is required to
 * have, so the sentence still renders.
 */
export function pluralCategory(n: number, locale: LocaleTag, ordinal = false): string {
  try {
    return new Intl.PluralRules(locale, {
      type: ordinal ? "ordinal" : "cardinal",
    }).select(n);
  } catch {
    return "other";
  }
}

/** A number in the locale's own digits and grouping. */
function num(n: number, locale: LocaleTag): string {
  try {
    return new Intl.NumberFormat(locale).format(n);
  } catch {
    return String(n);
  }
}
