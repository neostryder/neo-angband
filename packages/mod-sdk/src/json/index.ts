/** Strict, dependency-free JSON documents shared by hosts and mods. */

export interface ValidationIssue {
  readonly path: string;
  readonly message: string;
}

export type ValidationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

export interface Validator<T> {
  validate(value: unknown, path?: string): ValidationResult<T>;
}

export type Infer<V> = V extends Validator<infer T> ? T : never;
export interface OptionalValidator<T> extends Validator<T | undefined> {
  readonly optional: true;
}
type ObjectData<S extends Record<string, Validator<unknown>>> =
  { [K in keyof S as S[K] extends OptionalValidator<unknown> ? never : K]: Infer<S[K]> } &
  { [K in keyof S as S[K] extends OptionalValidator<unknown> ? K : never]?: Exclude<Infer<S[K]>, undefined> };

const good = <T>(value: T): ValidationResult<T> => ({ ok: true, value });
const bad = (path: string, message: string): { readonly ok: false; readonly issues: readonly ValidationIssue[] } => ({
  ok: false,
  issues: [{ path, message }],
});
const segment = (path: string, key: string): string => `${path}[${JSON.stringify(key)}]`;
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value) &&
  (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
const kebab = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u;
const camel = /^[a-z][a-zA-Z0-9]*$/u;
const stableIdValidator = scalar((v): v is string => typeof v === "string" && kebab.test(v), "expected a kebab-case id");

function scalar<T>(check: (value: unknown) => value is T, message: string): Validator<T> {
  return { validate: (value, path = "$") => check(value) ? good(value) : bad(path, message) };
}

export const json = {
  string: scalar((v): v is string => typeof v === "string", "expected a string"),
  boolean: scalar((v): v is boolean => typeof v === "boolean", "expected a JSON boolean"),
  finiteNumber: scalar((v): v is number => typeof v === "number" && Number.isFinite(v), "expected a finite number"),
  integer: scalar((v): v is number => typeof v === "number" && Number.isSafeInteger(v), "expected a safe integer"),
  stableId: stableIdValidator,
  enum<const T extends readonly string[]>(values: T): Validator<T[number]> {
    if (values.length === 0 || values.some((v) => !kebab.test(v)) || new Set(values).size !== values.length) {
      throw new Error("enum declarations need unique kebab-case values");
    }
    return scalar((v): v is T[number] => typeof v === "string" && values.includes(v), `expected one of ${values.join(", ")}`);
  },
  nullable<T>(inner: Validator<T>): Validator<T | null> {
    return { validate: (v, path = "$") => v === null ? good(null) : inner.validate(v, path) };
  },
  optional<T>(inner: Validator<T>): OptionalValidator<T> {
    return { optional: true, validate: (v, path = "$") => v === undefined ? good(undefined) : inner.validate(v, path) };
  },
  array<T>(inner: Validator<T>): Validator<T[]> {
    return {
      validate(value, path = "$") {
        if (!Array.isArray(value)) return bad(path, "expected an array");
        const output: T[] = [];
        const issues: ValidationIssue[] = [];
        for (let index = 0; index < value.length; index++) {
          if (!Object.hasOwn(value, index) || value[index] === undefined) {
            issues.push({ path: `${path}[${index}]`, message: "array entries must be present JSON values" });
            continue;
          }
          const result = inner.validate(value[index], `${path}[${index}]`);
          if (result.ok) output.push(result.value);
          else issues.push(...result.issues);
        }
        return issues.length ? { ok: false, issues } : good(output);
      },
    };
  },
  object<const S extends Record<string, Validator<unknown>>>(shape: S): Validator<ObjectData<S>> {
    for (const key of Object.keys(shape)) {
      if (!camel.test(key)) throw new Error(`property ${key} is not camelCase`);
    }
    return {
      validate(value, path = "$") {
        if (!isObject(value)) return bad(path, "expected an object");
        const output: Record<string, unknown> = {};
        const issues: ValidationIssue[] = [];
        for (const key of Reflect.ownKeys(value)) {
          if (typeof key !== "string" || !Object.hasOwn(shape, key)) {
            issues.push({ path: typeof key === "string" ? segment(path, key) : path, message: "unknown field" });
          }
        }
        for (const [key, validator] of Object.entries(shape)) {
          if (!Object.hasOwn(value, key)) {
            if (validator.validate(undefined, segment(path, key)).ok) continue;
            issues.push({ path: segment(path, key), message: "missing required field" });
            continue;
          }
          const result = validator.validate(value[key], segment(path, key));
          if (result.ok) {
            if (result.value !== undefined) output[key] = result.value;
            else issues.push({ path: segment(path, key), message: "omit optional fields instead of writing undefined" });
          } else issues.push(...result.issues);
        }
        return issues.length ? { ok: false, issues } : good(output as ObjectData<S>);
      },
    };
  },
  map<T>(inner: Validator<T>, keyValidator: Validator<string> = stableIdValidator): Validator<Record<string, T>> {
    return {
      validate(value, path = "$") {
        if (!isObject(value)) return bad(path, "expected an object map");
        const output: Record<string, T> = {};
        const issues: ValidationIssue[] = [];
        for (const key of Reflect.ownKeys(value)) {
          if (typeof key !== "string") issues.push({ path, message: "unknown map key" });
        }
        for (const key of Object.keys(value).sort()) {
          const keyPath = segment(path, key);
          const name = keyValidator.validate(key, keyPath);
          const result = inner.validate(value[key], keyPath);
          if (!name.ok) issues.push(...name.issues);
          if (!result.ok) issues.push(...result.issues);
          if (value[key] === undefined) issues.push({ path: keyPath, message: "map entries must be JSON values" });
          if (name.ok && result.ok) output[key] = result.value;
        }
        return issues.length ? { ok: false, issues } : good(output);
      },
    };
  },
};

const channel = scalar((v): v is number => typeof v === "number" && Number.isInteger(v) && v >= 0 && v <= 255, "expected an integer channel from 0 to 255");
export const color = json.object({
  red: channel,
  green: channel,
  blue: channel,
  alpha: channel,
});

const keyShape = json.object({
  key: json.string,
  code: json.string,
  modifiers: json.array(json.enum(["alt", "control", "meta", "shift"] as const)),
});
export const keyInput: Validator<Infer<typeof keyShape>> = {
  validate(value, path = "$") {
    const result = keyShape.validate(value, path);
    if (!result.ok) return result;
    if (!result.value.key || !result.value.code) return bad(path, "key and code must be nonempty");
    const modifiers = result.value.modifiers;
    if (new Set(modifiers).size !== modifiers.length) return bad(segment(path, "modifiers"), "duplicate modifier");
    return result;
  },
};

export const utcTimestamp: Validator<string> = {
  validate(value, path = "$") {
    if (typeof value !== "string") return bad(path, "expected a UTC RFC 3339 timestamp");
    const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?Z$/u.exec(value);
    if (!match) return bad(path, "expected a UTC RFC 3339 timestamp ending in Z");
    const [, year, month, day, hour, minute, second] = match.map(Number);
    const date = new Date(0);
    date.setUTCFullYear(year!, month! - 1, day!);
    if (date.getUTCFullYear() !== year || date.getUTCMonth() + 1 !== month || date.getUTCDate() !== day || hour! > 23 || minute! > 59 || second! > 59) {
      return bad(path, "invalid UTC date or time");
    }
    return good(value);
  },
};

export type FormatTag = `neo-angband/${string}/${string}`;
export type Migration = (data: unknown) => unknown;
export interface FormatDefinition<T> {
  readonly format: FormatTag;
  readonly schemaVersion: number;
  readonly validator: Validator<T>;
  readonly migrations?: Readonly<Record<number, Migration>>;
  readonly sample?: T;
  readonly sampleV1?: unknown;
}

const registry = new Map<string, FormatDefinition<unknown>>();
export function listFormats(): readonly FormatDefinition<unknown>[] {
  return [...registry.values()];
}

export function defineFormat<T>(definition: FormatDefinition<T>): FormatDefinition<T> {
  if (!/^neo-angband\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(definition.format)) {
    throw new Error(`invalid format tag: ${definition.format}`);
  }
  if (!Number.isSafeInteger(definition.schemaVersion) || definition.schemaVersion < 1) {
    throw new Error("schemaVersion must be a positive safe integer");
  }
  if (registry.has(definition.format)) throw new Error(`duplicate format: ${definition.format}`);
  for (let version = 1; version < definition.schemaVersion; version++) {
    if (typeof definition.migrations?.[version] !== "function") throw new Error(`missing migration from v${version}: ${definition.format}`);
  }
  for (const version of Object.keys(definition.migrations ?? {})) {
    if (!Number.isInteger(Number(version)) || Number(version) < 1 || Number(version) >= definition.schemaVersion) {
      throw new Error(`invalid migration version ${version}: ${definition.format}`);
    }
  }
  registry.set(definition.format, definition);
  return definition;
}

export type DocumentResult<T> =
  | { readonly ok: true; readonly data: T; readonly schemaVersion: number; readonly migrated: boolean }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

function resolve<T>(format: FormatDefinition<T> | string): FormatDefinition<T> | undefined {
  return registry.get(typeof format === "string" ? format : format.format) as FormatDefinition<T> | undefined;
}

export function parseDocument<T>(input: string | unknown, format: FormatDefinition<T>): DocumentResult<T>;
export function parseDocument(input: string | unknown, format: string): DocumentResult<unknown>;
export function parseDocument<T>(input: string | unknown, format: FormatDefinition<T> | string): DocumentResult<T> {
  const definition = resolve(format);
  if (!definition) return bad("$.format", "unknown format");
  try {
    const value: unknown = typeof input === "string" ? JSON.parse(input) : input;
    if (!isObject(value)) return bad("$", "expected a document object");
    const issues: ValidationIssue[] = [];
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string" || !["format", "schemaVersion", "data"].includes(key)) {
        issues.push({ path: typeof key === "string" ? segment("$", key) : "$", message: "unknown envelope field" });
      }
    }
    if (value.format !== definition.format) issues.push({ path: "$.format", message: "wrong format tag" });
    if (!Number.isSafeInteger(value.schemaVersion) || (value.schemaVersion as number) < 1) {
      issues.push({ path: "$.schemaVersion", message: "expected a positive integer" });
    } else if ((value.schemaVersion as number) > definition.schemaVersion) {
      issues.push({ path: "$.schemaVersion", message: "future schema version" });
    }
    if (!Object.hasOwn(value, "data")) issues.push({ path: "$.data", message: "missing data" });
    if (issues.length) return { ok: false, issues };
    const sourceVersion = value.schemaVersion as number;
    let data: unknown = value.data;
    for (let version = sourceVersion; version < definition.schemaVersion; version++) {
      data = definition.migrations![version]!(data);
    }
    const result = definition.validator.validate(data, "$.data");
    return result.ok
      ? { ok: true, data: result.value, schemaVersion: definition.schemaVersion, migrated: sourceVersion !== definition.schemaVersion }
      : result;
  } catch (error) {
    return bad("$", `invalid document: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export class DocumentValidationError extends Error {
  constructor(readonly issues: readonly ValidationIssue[]) {
    super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
  }
}

export function serializeDocument<T>(format: FormatDefinition<T>, data: T, options?: { readonly compact?: boolean }): string;
export function serializeDocument(format: string, data: unknown, options?: { readonly compact?: boolean }): string;
export function serializeDocument<T>(format: FormatDefinition<T> | string, data: T, options?: { readonly compact?: boolean }): string {
  const definition = resolve(format);
  if (!definition) throw new DocumentValidationError([{ path: "$.format", message: "unknown format" }]);
  const result = definition.validator.validate(data, "$.data");
  if (!result.ok) throw new DocumentValidationError(result.issues);
  const document = { format: definition.format, schemaVersion: definition.schemaVersion, data: result.value };
  return options?.compact ? JSON.stringify(document) : `${JSON.stringify(document, null, 2)}\n`;
}
