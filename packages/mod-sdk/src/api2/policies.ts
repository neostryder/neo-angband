/**
 * API 2 policy tables: changes a mod declares as data, which the host applies
 * synchronously without calling the mod.
 *
 * A hook runs inside a turn, so it has to answer at once. A mod in a Worker
 * cannot: every call to it crosses a message channel. It declares a policy
 * table instead, and the host interprets the table on the hook's own call
 * site. Tables are a convenience for that, never a limit on what a mod may
 * change: an in-process mod may declare policies too, and a hook function it
 * also declares for the same hook takes precedence over the table.
 *
 * Every kind of table is one entry in `API2_POLICY_KINDS`. An entry names the
 * table, says where the host applies it (the hook it answers, or the game
 * registration it installs), checks a declared value, and turns a valid one
 * into what the host installs. `checkApi2Policies` and `api2PolicyEffects`
 * only walk that list, so a new kind of table is one new entry here and a
 * member of `Api2Policies`; the host needs no change unless the kind installs
 * a registration it has not met before.
 *
 * Tables are plain data with a small grammar: literal text rules (exact,
 * substring or prefix; no regular expressions, so no rule can stall a turn),
 * key lists, switches, and bounded numbers. Each kind bounds its own tables.
 */

import type {
  Api2EffectIntro,
  Api2HistoryAdd,
  Api2HistoryDecision,
  Api2HistoryDisplay,
  Api2HookName,
  Api2Hooks,
  Api2ListOffset,
  Api2ObjectInfoTextSite,
  Api2ScreenTextSite,
} from "./hooks.js";

/** How a rule's `find` text matches: the whole text, anywhere in it (every occurrence), or its start. */
export type Api2TextMatch = "exact" | "substring" | "prefix";

/** A value a rule's `where` filter compares a site field with. */
export type Api2PolicyScalar = string | number | boolean;

/**
 * One text rewrite. Rules apply in order, each to the text the one before it
 * produced. `where` limits a rule to the call sites whose named fields equal
 * the given values; a hook without a site (messageText, characterBackground)
 * takes no `where`.
 */
export interface Api2TextRule {
  readonly find: string;
  readonly replace: string;
  /** Defaults to "exact". */
  readonly match?: Api2TextMatch;
  readonly where?: Readonly<Record<string, Api2PolicyScalar>>;
}

/**
 * One history rule: a rewrite, as Api2TextRule, or `drop: true`, which keeps
 * the entry out of the history when its text matches.
 */
export interface Api2HistoryRule {
  readonly find: string;
  readonly replace?: string;
  readonly drop?: true;
  readonly match?: Api2TextMatch;
  readonly where?: Readonly<Record<string, Api2PolicyScalar>>;
}

/** A floor-list tiebreak key: an offset from the player, ascending, or descending with a minus sign. */
export type Api2ObjectListKey = "dy" | "-dy" | "dx" | "-dx";

/** One discount a store roll can give: `percent` off when a one-in-`oneIn` roll succeeds. */
export interface Api2DiscountTier {
  /** 1 to 1000000. */
  readonly oneIn: number;
  /** 1 to 99. */
  readonly percent: number;
}

/**
 * The store discount roll: when a store stocks an object, the tiers are tried
 * in order and the first roll that succeeds gives the stack its discount. An
 * object worth less than `minCost` is never discounted, and draws no roll.
 */
export interface Api2DiscountRollPolicy {
  /** Defaults to 0. */
  readonly minCost?: number;
  /** 1 to 16 tiers. */
  readonly tiers: readonly Api2DiscountTier[];
}

/**
 * One tile rule: a tile for a monster race or an object kind that the tile
 * pack does not draw, copied from another of the same sort. A rule only fills
 * a tile that nothing has assigned, so it never changes what a pack already
 * draws.
 */
export interface Api2TileRule {
  /** The monster race index to supply a tile for. Exactly one of `monster` and `object`. */
  readonly monster?: number;
  /** The object kind index to supply a tile for. */
  readonly object?: number;
  /** The index, of the same sort, whose current tile is copied. */
  readonly like: number;
  /** Degrees to rotate the copy's hue, 1 to 359. Absent copies it as it is; a pack that cannot recolour skips the rule. */
  readonly hue?: number;
  /** The ids of the packs the rule applies to. Absent means every pack. */
  readonly packs?: readonly string[];
}

export interface Api2WalkBlockedByDiggablePolicy {
  readonly kind: "walk-blocked-by-diggable";
  readonly attempt: "tunnel";
  readonly energy: "move";
  readonly step: false;
}

export interface Api2PrefErrorsPolicy {
  readonly kind: "pref-errors";
  readonly continueAfterError: boolean;
  readonly reportLimit: number;
}

export interface Api2StartingOptionsPolicy {
  readonly kind: "starting-options";
  readonly values: Readonly<Record<string, boolean>>;
  readonly hitpointWarn?: number;
  readonly delayFactor?: number;
  readonly lazymoveDelay?: number;
}

export interface Api2IgnorePolicyEntry {
  readonly tval: "light";
  readonly kindNameContains: "Torch" | "Lantern";
  readonly ignore: true;
}

/** The policy tables a mod may declare. Every member is optional. */
export interface Api2Policies {
  readonly prefErrors?: Api2PrefErrorsPolicy;
  readonly startingOptions?: Api2StartingOptionsPolicy;
  readonly ignore?: readonly Api2IgnorePolicyEntry[];
  readonly walkBlockedByDiggable?: Api2WalkBlockedByDiggablePolicy;
  readonly messageText?: readonly Api2TextRule[];
  /** `where` may name `screen`, `part` and `column`. */
  readonly screenText?: readonly Api2TextRule[];
  readonly characterBackground?: readonly Api2TextRule[];
  /** `where` may name `section`, `tval`, `kind` and `aware`. */
  readonly objectInfoText?: readonly Api2TextRule[];
  /** Rewrites the intro's text. `where` may name `effect`, `itemClass`, `aimed`, `activation` and `describedActivation`. */
  readonly effectIntro?: readonly Api2TextRule[];
  /** `where` may name `type` and `duplicate`. */
  readonly historyAdd?: readonly Api2HistoryRule[];
  /** `where` may name `type`. */
  readonly historyDisplay?: readonly Api2TextRule[];
  /** Keys tried in order; the first that differs orders the two entries. */
  readonly objectListOrder?: readonly Api2ObjectListKey[];
  /** True keeps monster noise and scent in the save. */
  readonly saveNoiseScent?: boolean;
  /** True lets a shapechange teach its obvious flags directly. */
  readonly shapeLearnObviousFlagsDirectly?: boolean;
  /** The discount a store gives on the stock it makes. */
  readonly storeDiscountRoll?: Api2DiscountRollPolicy;
  /** Tiles for monsters and objects the tile pack does not draw. */
  readonly tileMap?: readonly Api2TileRule[];
}

/** The name of one policy table. */
export type Api2PolicyName = keyof Api2Policies;

/**
 * What a store discount roll is handed: the object's value and the game's own
 * random roll. The answer is a percentage, 0 for none.
 */
export type Api2DiscountRoll = (roll: { readonly cost: number; oneIn(n: number): boolean }) => number;

/**
 * The tile door a tile rule fills through, the same one an in-process tile
 * filler gets: it reads the tiles assigned now and writes only where nothing
 * is assigned. `T` is the engine's tile, which a rule never looks inside.
 */
export interface Api2TileFill<T = unknown> {
  readonly pack: { readonly engine: string; readonly id: string; readonly menuname: string };
  monsterTile(ridx: number): T | null;
  objectTile(kidx: number): T | null;
  fillMonster(ridx: number, tile: T): boolean;
  fillObject(kidx: number, tile: T): boolean;
  derive(donor: T, hue: number): T | null;
}

/** A tile filler built from tile rules. */
export type Api2TileFiller = (fill: Api2TileFill) => void;

/** The game registrations a table can install, beside the hooks. */
export interface Api2PolicyRegistrations {
  prefErrors?: Api2PrefErrorsPolicy;
  startingOptions?: Api2StartingOptionsPolicy;
  ignore?: readonly Api2IgnorePolicyEntry[];
  walkBlockedByDiggable?: Api2WalkBlockedByDiggablePolicy;
  /** Installed as the stores' discount roll. */
  discountRoll?: Api2DiscountRoll;
  /** Installed as the mod's tile filler. */
  tileFiller?: Api2TileFiller;
}

/** What a mod's tables stand for: hooks the game folds in, and registrations the host installs. */
export interface Api2PolicyEffects {
  readonly hooks: Api2Hooks;
  readonly registrations: Api2PolicyRegistrations;
}

/** Where the host applies one kind of table. */
export type Api2PolicyTarget =
  | { readonly hook: Api2HookName }
  | { readonly registration: keyof Api2PolicyRegistrations };

/**
 * One kind of policy table. `check` sees any declared value; `apply` sees
 * only a value `check` accepted, and adds nothing for an empty table or a
 * false switch, so a mod only takes part in what it declared something for.
 */
export interface Api2PolicyKind {
  readonly name: Api2PolicyName;
  readonly capability: string;
  /** One line on what the table changes. */
  readonly summary: string;
  readonly target: Api2PolicyTarget;
  /** Why `value` is not a valid table of this kind, or null when it is. */
  check(value: unknown): string | null;
  /** Add what a valid table stands for to `out`. */
  apply(value: unknown, out: { hooks: Api2Hooks; registrations: Api2PolicyRegistrations }): void;
}

/** The bounds every kind holds its tables to. */
export const API2_POLICY_LIMITS = Object.freeze({
  /** Rules in one table. */
  rules: 256,
  /** Characters in one `find` or `replace`. */
  text: 4096,
  output: 16 * 1024,
  work: 1024 * 1024,
  /** Fields in one `where`. */
  where: 8,
  /** Tiers in a discount roll. */
  tiers: 16,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isInt = (value: unknown, min: number, max: number): value is number =>
  typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;

function unknownField(at: string, value: Record<string, unknown>, fields: readonly string[]): string | null {
  for (const key of Object.keys(value)) if (!fields.includes(key)) return `${at} has an unknown field "${key}"`;
  return null;
}

function listProblem(name: string, value: unknown): string | null {
  if (!Array.isArray(value)) return `${name} is a list`;
  if (value.length > API2_POLICY_LIMITS.rules) return `${name} holds at most ${String(API2_POLICY_LIMITS.rules)} rules`;
  return null;
}

function ruleProblem(table: string, index: number, value: unknown, history: boolean, allowed: readonly string[]): string | null {
  const at = `${table}[${String(index)}]`;
  if (!isRecord(value)) return `${at} is not an object`;
  const unknown = unknownField(at, value, ["find", "replace", "match", "where", ...(history ? ["drop"] : [])]);
  if (unknown) return unknown;
  const { find, replace, match, where, drop } = value;
  if (typeof find !== "string" || find.length === 0 || find.length > API2_POLICY_LIMITS.text) {
    return `${at}.find is text of 1 to ${String(API2_POLICY_LIMITS.text)} characters`;
  }
  if (history && drop !== undefined && drop !== true) return `${at}.drop is true or absent`;
  if (drop === true) {
    if (replace !== undefined) return `${at} either drops the entry or replaces its text, not both`;
  } else if (typeof replace !== "string" || replace.length > API2_POLICY_LIMITS.text) {
    return `${at}.replace is text of up to ${String(API2_POLICY_LIMITS.text)} characters`;
  }
  if (match !== undefined && match !== "exact" && match !== "substring" && match !== "prefix") {
    return `${at}.match is "exact", "substring" or "prefix"`;
  }
  if (where !== undefined) {
    if (!isRecord(where)) return `${at}.where is an object`;
    const keys = Object.keys(where);
    if (keys.length > API2_POLICY_LIMITS.where) return `${at}.where names at most ${String(API2_POLICY_LIMITS.where)} fields`;
    for (const key of keys) {
      if (!allowed.includes(key)) {
        return allowed.length === 0
          ? `${at}.where is not allowed: ${table} has no call site to filter`
          : `${at}.where may name ${allowed.join(", ")}, not "${key}"`;
      }
      const v = where[key];
      if (typeof v !== "string" && typeof v !== "boolean" && !(typeof v === "number" && Number.isFinite(v))) {
        return `${at}.where.${key} is a string, number or boolean`;
      }
    }
  }
  return null;
}

/** Whether a rule's `where` holds for a call site. */
function siteMatches(where: Api2TextRule["where"], site: object | undefined): boolean {
  if (where === undefined) return true;
  if (site === undefined) return false;
  const fields = site as Record<string, unknown>;
  for (const [key, value] of Object.entries(where)) {
    if (fields[key] !== value) return false;
  }
  return true;
}

function matches(text: string, find: string, match: Api2TextMatch): boolean {
  if (match === "substring") return text.includes(find);
  if (match === "prefix") return text.startsWith(find);
  return text === find;
}

function spend(budget: { remaining: number }, work: number): boolean {
  budget.remaining -= work;
  return budget.remaining >= 0;
}

function rewrite(text: string, find: string, replace: string, match: Api2TextMatch, budget: { remaining: number }): string | null {
  if (!spend(budget, text.length + find.length + replace.length)) return null;
  let count = 0;
  if (match === "substring") {
    for (let at = text.indexOf(find); at !== -1; at = text.indexOf(find, at + find.length)) {
      count += 1;
      if (text.length + count * (replace.length - find.length) > API2_POLICY_LIMITS.output) return null;
    }
  } else if (matches(text, find, match)) count = 1;
  if (count === 0) return text;
  const length = text.length + count * (replace.length - find.length);
  /* The host cannot interrupt a table, so allocation and total work need bounds before replacement. */
  if (length > API2_POLICY_LIMITS.output || !spend(budget, length)) return null;
  if (match === "substring") return text.split(find).join(replace);
  if (match === "prefix") return replace + text.slice(find.length);
  return replace;
}

function applyRules(rules: readonly Api2TextRule[], text: string, site?: object): string {
  if (text.length > API2_POLICY_LIMITS.output) return text;
  const budget = { remaining: API2_POLICY_LIMITS.work };
  let out = text;
  for (const rule of rules) {
    if (!siteMatches(rule.where, site)) continue;
    const next = rewrite(out, rule.find, rule.replace, rule.match ?? "exact", budget);
    if (next === null) return text;
    out = next;
  }
  return out;
}

/** A text-rewrite kind: a list of Api2TextRule for one hook, with the site fields its `where` may name. */
function textKind(
  name: Api2PolicyName,
  hook: Api2HookName,
  summary: string,
  capability: string,
  where: readonly string[],
  install: (rules: readonly Api2TextRule[], hooks: Api2Hooks) => void,
): Api2PolicyKind {
  return {
    name,
    summary,
    capability,
    target: { hook },
    check(value) {
      const problem = listProblem(name, value);
      if (problem) return problem;
      const rules = value as readonly unknown[];
      for (let i = 0; i < rules.length; i += 1) {
        const rule = ruleProblem(name, i, rules[i], false, where);
        if (rule) return rule;
      }
      return null;
    },
    apply(value, out) {
      const rules = value as readonly Api2TextRule[];
      if (rules.length > 0) install(rules, out.hooks);
    },
  };
}

/** A switch kind: true installs a hook that answers true. */
function switchKind(name: Api2PolicyName, hook: "saveNoiseScent" | "shapeLearnObviousFlagsDirectly", summary: string, capability: string): Api2PolicyKind {
  return {
    name,
    summary,
    capability,
    target: { hook },
    check: (value) => (typeof value === "boolean" ? null : `${name} is true or false`),
    apply(value, out) {
      if (value === true) out.hooks[hook] = () => true;
    },
  };
}

const LIST_KEYS: readonly string[] = ["dy", "-dy", "dx", "-dx"];

/**
 * Every kind of policy table, in the order the host applies them. Adding a
 * kind: add its member to `Api2Policies`, add an entry here, test it in
 * policies.test.ts, and list it under Policy tables in docs/modding/API2.md.
 */
export const API2_POLICY_KINDS: readonly Api2PolicyKind[] = Object.freeze([
  {
    name: "prefErrors",
    capability: "registry:ui-entry",
    summary: "Chooses whether preference loading continues after an error.",
    target: { registration: "prefErrors" },
    check(value) {
      if (!isRecord(value)) return "prefErrors is an object";
      const extra = unknownField("prefErrors", value, ["kind", "continueAfterError", "reportLimit"]);
      if (extra) return extra;
      if (value["kind"] !== "pref-errors") return "prefErrors.kind is \"pref-errors\"";
      if (typeof value["continueAfterError"] !== "boolean") return "prefErrors.continueAfterError is true or false";
      if (!isInt(value["reportLimit"], 0, 1000)) return "prefErrors.reportLimit is a whole number from 0 to 1000";
      return null;
    },
    apply(value, out) {
      out.registrations.prefErrors = value as Api2PrefErrorsPolicy;
    },
  },
  {
    name: "startingOptions",
    capability: "registry:ui-entry",
    summary: "Applies saved option choices to a new character.",
    target: { registration: "startingOptions" },
    check(value) {
      if (!isRecord(value)) return "startingOptions is an object";
      const extra = unknownField("startingOptions", value, ["kind", "values", "hitpointWarn", "delayFactor", "lazymoveDelay"]);
      if (extra) return extra;
      if (value["kind"] !== "starting-options") return "startingOptions.kind is \"starting-options\"";
      const values = value["values"];
      if (!isRecord(values)) return "startingOptions.values is an object";
      const entries = Object.entries(values);
      if (entries.length > 512) return "startingOptions.values has at most 512 options";
      for (const [name, enabled] of entries) {
        if (name.length === 0 || name.length > 128) return "startingOptions.values has option names of 1 to 128 characters";
        if (typeof enabled !== "boolean") return `startingOptions.values.${name} is true or false`;
      }
      for (const [field, max] of [["hitpointWarn", 9], ["delayFactor", 1000], ["lazymoveDelay", 255]] as const) {
        if (value[field] !== undefined && !isInt(value[field], 0, max)) return `startingOptions.${field} is a whole number from 0 to ${String(max)}`;
      }
      return null;
    },
    apply(value, out) {
      out.registrations.startingOptions = value as Api2StartingOptionsPolicy;
    },
  },
  {
    name: "ignore",
    capability: "registry:ui-entry",
    summary: "Ignores matching items while preserving prior ignore choices.",
    target: { registration: "ignore" },
    check(value) {
      if (!Array.isArray(value) || value.length === 0 || value.length > 16) return "ignore lists 1 to 16 entries";
      for (let index = 0; index < value.length; index += 1) {
        const entry: unknown = value[index];
        const at = `ignore[${String(index)}]`;
        if (!isRecord(entry)) return `${at} is an object`;
        const extra = unknownField(at, entry, ["tval", "kindNameContains", "ignore"]);
        if (extra) return extra;
        if (entry["tval"] !== "light") return `${at}.tval is \"light\"`;
        if (entry["kindNameContains"] !== "Torch" && entry["kindNameContains"] !== "Lantern") return `${at}.kindNameContains is \"Torch\" or \"Lantern\"`;
        if (entry["ignore"] !== true) return `${at}.ignore is true`;
      }
      return null;
    },
    apply(value, out) {
      out.registrations.ignore = value as readonly Api2IgnorePolicyEntry[];
    },
  },
  {
    name: "walkBlockedByDiggable",
    capability: "registry:command",
    summary: "Attempts one tunnel when a walk meets known diggable rock.",
    target: { registration: "walkBlockedByDiggable" },
    check(value) {
      if (!isRecord(value)) return "walkBlockedByDiggable is an object";
      const extra = unknownField("walkBlockedByDiggable", value, ["kind", "attempt", "energy", "step"]);
      if (extra) return extra;
      if (value["kind"] !== "walk-blocked-by-diggable") return "walkBlockedByDiggable.kind is \"walk-blocked-by-diggable\"";
      if (value["attempt"] !== "tunnel") return "walkBlockedByDiggable.attempt is \"tunnel\"";
      if (value["energy"] !== "move") return "walkBlockedByDiggable.energy is \"move\"";
      if (value["step"] !== false) return "walkBlockedByDiggable.step is false";
      return null;
    },
    apply(value, out) {
      out.registrations.walkBlockedByDiggable = value as Api2WalkBlockedByDiggablePolicy;
    },
  },
  textKind("messageText", "messageText", "Rewrites message-line text.", "registry:message", [], (rules, hooks) => {
    hooks.messageText = (raw: string) => applyRules(rules, raw);
  }),
  textKind("screenText", "screenText", "Rewrites text on the game's screens.", "registry:ui-entry", ["screen", "part", "column"], (rules, hooks) => {
    hooks.screenText = (raw: string, site: Api2ScreenTextSite) => applyRules(rules, raw, site);
  }),
  textKind("characterBackground", "characterBackground", "Rewrites a new character's background text.", "registry:message", [], (rules, hooks) => {
    hooks.characterBackground = (text: string) => applyRules(rules, text);
  }),
  textKind("objectInfoText", "objectInfoText", "Rewrites object description text.", "registry:effect-info", ["section", "tval", "kind", "aware"], (rules, hooks) => {
    hooks.objectInfoText = (text: string, site: Api2ObjectInfoTextSite) => applyRules(rules, text, site);
  }),
  textKind(
    "effectIntro",
    "effectIntro",
    "Rewrites the line that introduces an effect's description.",
    "registry:effect-info",
    ["effect", "itemClass", "aimed", "activation", "describedActivation"],
    (rules, hooks) => {
      hooks.effectIntro = (facts: Api2EffectIntro) => applyRules(rules, facts.text, facts);
    },
  ),
  {
    name: "historyAdd",
    capability: "registry:message",
    summary: "Rewrites or drops character history entries as they are added.",
    target: { hook: "historyAdd" },
    check(value) {
      const problem = listProblem("historyAdd", value);
      if (problem) return problem;
      const rules = value as readonly unknown[];
      for (let i = 0; i < rules.length; i += 1) {
        const rule = ruleProblem("historyAdd", i, rules[i], true, ["type", "duplicate"]);
        if (rule) return rule;
      }
      return null;
    },
    apply(value, out) {
      const rules = value as readonly Api2HistoryRule[];
      if (rules.length === 0) return;
      out.hooks.historyAdd = (entry: Api2HistoryAdd): Api2HistoryDecision => {
        if (entry.what.length > API2_POLICY_LIMITS.output) return { keep: true };
        const budget = { remaining: API2_POLICY_LIMITS.work };
        let what = entry.what;
        for (const rule of rules) {
          if (!siteMatches(rule.where, entry)) continue;
          const match = rule.match ?? "exact";
          if (rule.drop === true) {
            if (!spend(budget, what.length + rule.find.length)) return { keep: true };
            if (matches(what, rule.find, match)) return { keep: false };
            continue;
          }
          const next = rewrite(what, rule.find, rule.replace ?? "", match, budget);
          if (next === null) return { keep: true };
          what = next;
        }
        return what === entry.what ? { keep: true } : { keep: true, what };
      };
    },
  },
  textKind("historyDisplay", "historyDisplay", "Rewrites history entries where they are shown.", "registry:message", ["type"], (rules, hooks) => {
    hooks.historyDisplay = (entry: Api2HistoryDisplay) => applyRules(rules, entry.what, entry);
  }),
  {
    name: "objectListOrder",
    capability: "registry:tval",
    summary: "Orders floor-list entries that are otherwise level.",
    target: { hook: "objectListTiebreak" },
    check(value) {
      if (!Array.isArray(value)) return "objectListOrder is a list";
      if (value.length === 0 || value.length > LIST_KEYS.length) return `objectListOrder lists 1 to ${String(LIST_KEYS.length)} keys`;
      const seen = new Set<string>();
      for (const key of value) {
        if (typeof key !== "string" || !LIST_KEYS.includes(key)) return `objectListOrder keys are ${LIST_KEYS.join(", ")}`;
        const axis = key.replace("-", "");
        if (seen.has(axis)) return `objectListOrder names ${axis} twice`;
        seen.add(axis);
      }
      return null;
    },
    apply(value, out) {
      const order = value as readonly Api2ObjectListKey[];
      out.hooks.objectListTiebreak = (a: Api2ListOffset, b: Api2ListOffset): number => {
        for (const key of order) {
          const descending = key.startsWith("-");
          const axis = (descending ? key.slice(1) : key) as "dy" | "dx";
          const diff = a[axis] - b[axis];
          if (diff !== 0) return descending ? -diff : diff;
        }
        return 0;
      };
    },
  },
  switchKind("saveNoiseScent", "saveNoiseScent", "Keeps monster noise and scent in the save.", "registry:monster"),
  switchKind("shapeLearnObviousFlagsDirectly", "shapeLearnObviousFlagsDirectly", "Lets a shapechange teach its obvious flags directly.", "registry:rune"),
  {
    name: "storeDiscountRoll",
    capability: "registry:store",
    summary: "Gives store stock a rolled discount.",
    target: { registration: "discountRoll" },
    check(value) {
      if (!isRecord(value)) return "storeDiscountRoll is an object";
      const unknown = unknownField("storeDiscountRoll", value, ["minCost", "tiers"]);
      if (unknown) return unknown;
      if (value["minCost"] !== undefined && !isInt(value["minCost"], 0, 1_000_000_000)) return "storeDiscountRoll.minCost is a whole number of 0 or more";
      const tiers = value["tiers"];
      if (!Array.isArray(tiers) || tiers.length === 0 || tiers.length > API2_POLICY_LIMITS.tiers) {
        return `storeDiscountRoll.tiers lists 1 to ${String(API2_POLICY_LIMITS.tiers)} tiers`;
      }
      for (let i = 0; i < tiers.length; i += 1) {
        const at = `storeDiscountRoll.tiers[${String(i)}]`;
        const tier: unknown = tiers[i];
        if (!isRecord(tier)) return `${at} is not an object`;
        const extra = unknownField(at, tier, ["oneIn", "percent"]);
        if (extra) return extra;
        if (!isInt(tier["oneIn"], 1, 1_000_000)) return `${at}.oneIn is a whole number from 1 to 1000000`;
        if (!isInt(tier["percent"], 1, 99)) return `${at}.percent is a whole number from 1 to 99`;
      }
      return null;
    },
    apply(value, out) {
      const policy = value as Api2DiscountRollPolicy;
      const minCost = policy.minCost ?? 0;
      const tiers = policy.tiers;
      out.registrations.discountRoll = (roll) => {
        if (roll.cost < minCost) return 0;
        for (const tier of tiers) if (roll.oneIn(tier.oneIn)) return tier.percent;
        return 0;
      };
    },
  },
  {
    name: "tileMap",
    capability: "registry:tiles",
    summary: "Supplies tiles for monsters and objects the tile pack does not draw.",
    target: { registration: "tileFiller" },
    check(value) {
      const problem = listProblem("tileMap", value);
      if (problem) return problem;
      const rules = value as readonly unknown[];
      for (let i = 0; i < rules.length; i += 1) {
        const at = `tileMap[${String(i)}]`;
        const rule = rules[i];
        if (!isRecord(rule)) return `${at} is not an object`;
        const unknown = unknownField(at, rule, ["monster", "object", "like", "hue", "packs"]);
        if (unknown) return unknown;
        const sorts = ["monster", "object"].filter((key) => rule[key] !== undefined);
        if (sorts.length !== 1) return `${at} names exactly one of monster and object`;
        if (!isInt(rule[sorts[0] ?? ""], 0, 100_000)) return `${at}.${sorts[0] ?? ""} is an index of 0 or more`;
        if (!isInt(rule["like"], 0, 100_000)) return `${at}.like is an index of 0 or more`;
        if (rule["hue"] !== undefined && !isInt(rule["hue"], 1, 359)) return `${at}.hue is a whole number of degrees from 1 to 359`;
        const packs = rule["packs"];
        if (packs !== undefined) {
          if (!Array.isArray(packs) || packs.length === 0 || packs.length > 64) return `${at}.packs lists 1 to 64 pack ids`;
          if (!packs.every((id) => typeof id === "string" && id.length > 0 && id.length <= 256)) return `${at}.packs holds pack ids`;
        }
      }
      return null;
    },
    apply(value, out) {
      const rules = value as readonly Api2TileRule[];
      if (rules.length === 0) return;
      out.registrations.tileFiller = (fill) => {
        for (const rule of rules) {
          if (rule.packs !== undefined && !rule.packs.includes(fill.pack.id)) continue;
          const monster = rule.monster !== undefined;
          const donor = monster ? fill.monsterTile(rule.like) : fill.objectTile(rule.like);
          if (donor === null) continue;
          const tile = rule.hue === undefined ? donor : fill.derive(donor, rule.hue);
          if (tile === null) continue;
          if (monster) fill.fillMonster(rule.monster ?? 0, tile);
          else fill.fillObject(rule.object ?? 0, tile);
        }
      };
    },
  },
]);

/** Every policy table name, in `API2_POLICY_KINDS` order. */
export const API2_POLICY_NAMES: readonly Api2PolicyName[] = Object.freeze(API2_POLICY_KINDS.map((kind) => kind.name));

const KIND_BY_NAME: ReadonlyMap<string, Api2PolicyKind> = new Map(API2_POLICY_KINDS.map((kind) => [kind.name, kind]));

/**
 * Why `value` is not a valid policy declaration, or null when it is. Unknown
 * tables and fields are refused, so a misspelling is reported rather than
 * silently doing nothing.
 */
export function checkApi2Policies(value: unknown): string | null {
  if (!isRecord(value)) return "policies are an object of tables";
  for (const [name, table] of Object.entries(value)) {
    const kind = KIND_BY_NAME.get(name);
    if (!kind) return `there is no policy table "${name}"`;
    if (table === undefined) continue;
    const problem = kind.check(table);
    if (problem) return problem;
  }
  return null;
}

/**
 * The hooks and registrations a set of valid policy tables stands for. A
 * table that is absent or empty gives nothing, and a switch that is false
 * gives nothing either. The tables are copied, so a later change to the
 * object passed in changes nothing.
 */
export function api2PolicyEffects(policies: Api2Policies, granted: (capability: string) => boolean = () => true): Api2PolicyEffects {
  const p = JSON.parse(JSON.stringify(policies)) as Record<string, unknown>;
  const out = { hooks: {} as Api2Hooks, registrations: {} as Api2PolicyRegistrations };
  for (const kind of API2_POLICY_KINDS) {
    const table = p[kind.name];
    if (table !== undefined && granted(kind.capability)) kind.apply(table, out);
  }
  return out;
}

/** The hooks a set of valid policy tables stands for (`api2PolicyEffects`, less its registrations). */
export function api2PoliciesToHooks(policies: Api2Policies): Api2Hooks {
  return api2PolicyEffects(policies).hooks;
}
