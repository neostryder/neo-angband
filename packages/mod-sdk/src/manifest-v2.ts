/**
 * Manifest schema 2: the `neo-angband/mod/manifest` document at schemaVersion 2,
 * its converter from schema 1, and the step that turns a schema 2 manifest into
 * the in-memory PackManifest the host reads.
 *
 * Three version numbers, each with one job. `schemaVersion` describes this JSON
 * shape. `api` is a semver range over the mod API, and is what decides whether a
 * mod can load. The Worker protocol version describes transport only and never
 * appears in a manifest.
 *
 * Schema 1 carried an integer `modApi` instead of `api`. It is never read as a
 * range: the converter maps the two values that exist, and nothing else.
 *
 *   schema 1                                  schema 2
 *   modApi 1 (runtime absent or in-process)   runtime "in-process", api MOD_API_1_RANGE
 *   modApi 2, runtime "worker", workerEntry   runtime "worker", api WORKER_PREVIEW_API, entry
 *   no modApi and no plugin facet             runtime "data", api "*"
 *
 * `WORKER_PREVIEW_API` is a prerelease of API 2, so a stable 2.x host does not
 * satisfy it: a mod written for the retired Worker preview ABI is not taken to
 * be an API 2 mod, and the loader tells its author to rebuild it. A data mod made no API claim in schema 1, and the converter does not
 * invent one. Any other `modApi` has no mapping and the converter refuses it.
 *
 * This module imports no runtime code from manifest.ts, so manifest.ts can use it
 * without a circular import.
 */

import { json, defineFormat, type ValidationIssue, type ValidationResult, type Validator } from "./json/index.js";
import { satisfies } from "./semver.js";
import { MOD_API2_VERSION } from "./api2/version.js";
import { unifiedCapabilities } from "./worker-capabilities.js";
import type {
  FieldDecl,
} from "./fields.js";
import type { PackResource } from "./resources.js";
import type {
  PackCompat,
  PackManifest,
  PackPayload,
  PackRule,
  PackSection,
  PackSetting,
  PackShape,
  PackTilePack,
  RestoredFlavorArt,
  RestoredItemArt,
  RestoredMonsterArt,
} from "./manifest.js";

/** The manifest document's format tag. */
export const MANIFEST_FORMAT = "neo-angband/mod/manifest";

/** The schema version every written manifest carries. */
export const MANIFEST_SCHEMA_VERSION = 2;

/** How a mod runs: no code at all, an isolated Worker, or in the game's own page. */
export type ModRuntime = "data" | "worker" | "in-process";

/** Every runtime, for validation. */
export const MOD_RUNTIMES: readonly ModRuntime[] = ["data", "worker", "in-process"];

/** The API range a schema 1 `modApi: 1` plugin converts to: API 1, in process. */
export const MOD_API_1_RANGE = ">=1.0.0 <2.0.0";

/** The API 1 version this build's in-process host implements. */
export const MOD_API_1_VERSION = "1.0.0";

/**
 * The API version of the retired Worker preview ABI that schema 1 called
 * `modApi: 2`. A prerelease of 2.0.0, so no range over the stable API 2
 * includes it, and no build runs it any more.
 */
export const WORKER_PREVIEW_API = "2.0.0-worker";

/** The in-process entry module. The in-process host loads no other. */
export const IN_PROCESS_ENTRY = "plugin.js";

/** A mod's time budget per game turn when its manifest names none, in milliseconds. */
export const DEFAULT_TURN_BUDGET_MS = 50;

/** The most a manifest may ask for, in milliseconds per game turn. */
export const MAX_TURN_BUDGET_MS = 500;

/** The `because` the converter writes for an engine range a schema 1 manifest gave no reason for. */
export const CONVERTED_ENGINE_REASON = "Carried over from a schema 1 manifest, which gave no reason.";

/** A required or optional dependency on another mod. */
export interface ManifestDependency {
  /** Semver range over the other mod's version. */
  readonly range: string;
  /** Why this mod needs it, shown when the player is asked to install it. */
  readonly because?: string;
}

/** A conflict with another mod: a loud warning with the author's reason, never a refusal. */
export interface ManifestConflict {
  /** The versions that conflict. Absent means every version. */
  readonly range?: string;
  readonly because: string;
}

/** Schema 2's dependency block. A mod id may appear in only one of the three maps. */
export interface ManifestDependencies {
  readonly required?: Readonly<Record<string, ManifestDependency>>;
  readonly optional?: Readonly<Record<string, ManifestDependency>>;
  readonly conflicts?: Readonly<Record<string, ManifestConflict>>;
}

/** The mod's text: a default locale and the file holding each locale's strings. */
export interface ManifestText {
  readonly default: string;
  readonly locales: Readonly<Record<string, string>>;
}

/** What a registry listing shows. */
export interface ManifestListing {
  readonly tags?: readonly string[];
  readonly screenshots?: readonly string[];
  readonly changelog?: string;
}

/** The time a mod may spend per game turn. */
export interface ManifestBudget {
  /** Milliseconds per game turn, above 0 and at most MAX_TURN_BUDGET_MS. */
  readonly msPerTurn: number;
}

/** An engine range with the reason the mod needs it. */
export interface ManifestEngine {
  readonly range: string;
  readonly because: string;
}

/** The `data` object of a schema 2 manifest document. */
export interface ManifestV2Data {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  /** Semver range over the mod API. */
  readonly api: string;
  readonly runtime: ModRuntime;
  /**
   * The module the host starts, for a mod that runs code. Required for
   * `worker`; for `in-process` it defaults to, and must be, IN_PROCESS_ENTRY.
   * A `data` mod has none.
   */
  readonly entry?: string;
  /** Allowed only for a named engine defect or content-format limit. */
  readonly engine?: ManifestEngine;
  readonly dependencies?: ManifestDependencies;
  readonly capabilities?: readonly string[];
  readonly text?: ManifestText;
  readonly listing?: ManifestListing;
  readonly budget?: ManifestBudget;
  readonly description?: string;
  readonly author?: string;
  readonly license?: string;
  readonly repository?: string;
  readonly payload?: PackPayload;
  /** The primary kind the mod manager shows. Defaults from `facets` and `runtime`. */
  readonly shape?: PackShape;
  /** What the mod contributes. Contains "plugin" exactly when `runtime` is not "data". */
  readonly facets?: readonly PackShape[];
  readonly loadAfter?: readonly string[];
  readonly loadBefore?: readonly string[];
  readonly group?: string;
  readonly compat?: readonly PackCompat[];
  readonly saveSchema?: number;
  readonly fields?: readonly FieldDecl[];
  readonly rules?: readonly PackRule[];
  readonly settings?: readonly PackSetting[];
  readonly publicFlags?: readonly string[];
  readonly renamedRuleFlags?: Readonly<Record<string, string>>;
  readonly sections?: readonly PackSection[];
  readonly tilePacks?: readonly PackTilePack[];
  readonly resources?: readonly PackResource[];
  readonly restoredItemArt?: readonly RestoredItemArt[];
  readonly restoredMonsterArt?: readonly RestoredMonsterArt[];
  readonly restoredFlavorArt?: readonly RestoredFlavorArt[];
  readonly nondeterministic?: boolean;
  readonly affectsGameplay?: boolean;
}

/* ------------------------------------------------------------------ */
/* Validation                                                          */
/* ------------------------------------------------------------------ */

const ID_RE = /^[a-z][a-z0-9-]*$/;
const LOCALE_RE = /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;

const good = <T>(value: T): ValidationResult<T> => ({ ok: true, value });
const bad = (path: string, message: string): ValidationResult<never> => ({ ok: false, issues: [{ path, message }] });

function check<T>(test: (value: unknown) => value is T, message: string): Validator<T> {
  return { validate: (value, path = "$") => test(value) ? good(value) : bad(path, message) };
}

const modId = check((v): v is string => typeof v === "string" && ID_RE.test(v), "expected a lowercase kebab-case mod id");
const nonEmpty = check((v): v is string => typeof v === "string" && v.length > 0, "expected a non-empty string");
const range = check((v): v is string => {
  if (typeof v !== "string") return false;
  try {
    satisfies("0.0.0", v);
    return true;
  } catch {
    return false;
  }
}, "expected a semver range");
const relativePath = check((v): v is string =>
  typeof v === "string" && v.length > 0 && !v.startsWith("/") && !v.includes("\\") &&
  !/^[a-z][a-z0-9+.-]*:/iu.test(v) &&
  v.split("/").every((part) => part !== "" && part !== "." && part !== ".."),
"expected a relative path inside the mod folder");
const locale = check((v): v is string => typeof v === "string" && LOCALE_RE.test(v), "expected a locale tag such as en or pt-BR");
const budgetMs = check((v): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 && v <= MAX_TURN_BUDGET_MS,
`expected milliseconds above 0 and at most ${MAX_TURN_BUDGET_MS}`);

/**
 * A field schema 2 shares with schema 1. It passes through here and is checked
 * by manifest.ts's shared field checks, so the two schemas cannot drift.
 */
function shared<T>(): Validator<T> {
  return { validate: (value, path = "$") => value === undefined ? bad(path, "expected a JSON value") : good(value as T) };
}

const dependency = json.object({ range, because: json.optional(nonEmpty) });
const conflict = json.object({ range: json.optional(range), because: nonEmpty });

const dataShape = json.object({
  id: modId,
  name: nonEmpty,
  version: nonEmpty,
  api: range,
  runtime: json.enum(MOD_RUNTIMES),
  entry: json.optional(relativePath),
  engine: json.optional(json.object({ range, because: nonEmpty })),
  dependencies: json.optional(json.object({
    required: json.optional(json.map(dependency, modId)),
    optional: json.optional(json.map(dependency, modId)),
    conflicts: json.optional(json.map(conflict, modId)),
  })),
  capabilities: json.optional(json.array(json.string)),
  text: json.optional(json.object({ default: locale, locales: json.map(relativePath, locale) })),
  listing: json.optional(json.object({
    tags: json.optional(json.array(json.stableId)),
    screenshots: json.optional(json.array(relativePath)),
    changelog: json.optional(relativePath),
  })),
  budget: json.optional(json.object({ msPerTurn: budgetMs })),
  description: json.optional(json.string),
  author: json.optional(json.string),
  license: json.optional(json.string),
  repository: json.optional(json.string),
  payload: json.optional(shared<PackPayload>()),
  shape: json.optional(shared<PackShape>()),
  facets: json.optional(shared<PackShape[]>()),
  loadAfter: json.optional(shared<string[]>()),
  loadBefore: json.optional(shared<string[]>()),
  group: json.optional(shared<string>()),
  compat: json.optional(shared<PackCompat[]>()),
  saveSchema: json.optional(shared<number>()),
  fields: json.optional(shared<FieldDecl[]>()),
  rules: json.optional(shared<PackRule[]>()),
  settings: json.optional(shared<PackSetting[]>()),
  publicFlags: json.optional(shared<string[]>()),
  renamedRuleFlags: json.optional(shared<Record<string, string>>()),
  sections: json.optional(shared<PackSection[]>()),
  tilePacks: json.optional(shared<PackTilePack[]>()),
  resources: json.optional(shared<PackResource[]>()),
  restoredItemArt: json.optional(shared<RestoredItemArt[]>()),
  restoredMonsterArt: json.optional(shared<RestoredMonsterArt[]>()),
  restoredFlavorArt: json.optional(shared<RestoredFlavorArt[]>()),
  nondeterministic: json.optional(json.boolean),
  affectsGameplay: json.optional(json.boolean),
});

/**
 * The rules that tie schema 2's own fields together, beyond each field's shape:
 * the runtime follows the payload, and a mod id sits in one dependency map.
 */
function crossFieldIssues(data: ManifestV2Data, path: string): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const at = (key: string): string => `${path}[${JSON.stringify(key)}]`;
  const facets = Array.isArray(data.facets) ? data.facets : undefined;
  if (data.runtime === "data") {
    if (data.entry !== undefined) issues.push({ path: at("entry"), message: "a data mod runs no code; remove entry or declare runtime \"in-process\" or \"worker\"" });
    if (facets?.includes("plugin") === true || data.shape === "plugin") {
      issues.push({ path: at("runtime"), message: "the plugin facet means the mod runs code, so runtime cannot be \"data\"" });
    }
    const files = Array.isArray(data.payload?.files) ? data.payload.files : [];
    const code = files.find((file) => typeof file === "string" && /\.(?:m?js)$/iu.test(file));
    if (code !== undefined) issues.push({ path: at("runtime"), message: `the payload ships ${code}, so runtime cannot be "data"` });
  } else {
    if (data.runtime === "worker" && data.entry === undefined) {
      issues.push({ path: at("entry"), message: "a worker mod names the module the host starts in entry" });
    }
    if (data.runtime === "in-process" && data.entry !== undefined && data.entry !== IN_PROCESS_ENTRY) {
      issues.push({ path: at("entry"), message: `an in-process mod's entry is ${IN_PROCESS_ENTRY}` });
    }
    if (facets !== undefined && !facets.includes("plugin")) {
      issues.push({ path: at("facets"), message: `runtime "${data.runtime}" runs code, so facets must include "plugin"` });
    }
  }
  const seen = new Map<string, string>();
  for (const kind of ["required", "optional", "conflicts"] as const) {
    for (const id of Object.keys(data.dependencies?.[kind] ?? {})) {
      const earlier = seen.get(id);
      if (earlier !== undefined) {
        issues.push({ path: `${at("dependencies")}[${JSON.stringify(kind)}][${JSON.stringify(id)}]`, message: `${id} is already listed under ${earlier}` });
      }
      seen.set(id, kind);
    }
    if (data.dependencies?.[kind]?.[data.id] !== undefined) {
      issues.push({ path: `${at("dependencies")}[${JSON.stringify(kind)}]`, message: "a mod cannot list itself" });
    }
  }
  return issues;
}

/** The schema 2 `data` validator: field shapes, then the cross-field rules. */
export const manifestV2Validator: Validator<ManifestV2Data> = {
  validate(value, path = "$") {
    const result = dataShape.validate(value, path);
    if (!result.ok) return result;
    const data = result.value as ManifestV2Data;
    const issues = crossFieldIssues(data, path);
    return issues.length > 0 ? { ok: false, issues } : good(data);
  },
};

/* ------------------------------------------------------------------ */
/* Schema 1 to schema 2                                                */
/* ------------------------------------------------------------------ */

/** Thrown by the converter for a schema 1 manifest it has no mapping for. */
export class ManifestConversionError extends Error {}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The runtime, API range and entry a schema 1 manifest's fields map to, or null when they map to none. */
export function schema1Runtime(m: Record<string, unknown>): { runtime: ModRuntime; api: string; entry?: string } | null {
  const facets = Array.isArray(m["facets"]) ? m["facets"] : [m["shape"]];
  const code = facets.includes("plugin") || m["shape"] === "plugin";
  const modApi = m["modApi"];
  if (modApi === 2 && m["runtime"] === "worker" && typeof m["workerEntry"] === "string") {
    return { runtime: "worker", api: WORKER_PREVIEW_API, entry: m["workerEntry"] };
  }
  if (modApi === 1 && (m["runtime"] === undefined || m["runtime"] === "in-process")) {
    return { runtime: "in-process", api: MOD_API_1_RANGE };
  }
  if (modApi === undefined && !code) return { runtime: "data", api: "*" };
  return null;
}

/** Schema 1 fields that schema 2 keeps under the same name and meaning. */
const KEPT_FIELDS = [
  "description", "author", "license", "repository", "payload", "shape", "facets",
  "loadAfter", "loadBefore", "group", "saveSchema", "fields", "rules", "settings",
  "publicFlags", "renamedRuleFlags", "sections", "tilePacks", "resources",
  "restoredItemArt", "restoredMonsterArt", "restoredFlavorArt", "nondeterministic",
  "affectsGameplay", "capabilities",
] as const;

/**
 * Convert schema 1 manifest fields to schema 2 `data`. The input is the schema 1
 * object itself (bare, or the `data` of a schemaVersion 1 document). Throws
 * ManifestConversionError for a `modApi` with no mapping, or for a plugin that
 * declares none.
 *
 * Every schema 1 field has a place: `modApi`, `runtime` and `workerEntry` become
 * `api`, `runtime` and `entry` by the table in the header; `dependencies` and
 * `optionalDependencies` become `dependencies.required` and `.optional`; a
 * whole-mod `conflicts` claim in `compat` (no `scope`, one per mod) becomes
 * `dependencies.conflicts`, and every other claim stays in `compat`; `changelog`
 * and `screenshots` move into `listing`; `engine` keeps its range with
 * CONVERTED_ENGINE_REASON as the reason. The rest keep their names.
 */
export function convertManifestV1(input: unknown): ManifestV2Data {
  if (!isRecord(input)) throw new ManifestConversionError("a schema 1 manifest is an object");
  const mapped = schema1Runtime(input);
  if (mapped === null) throw unmapped(input);
  return convertFields(input, mapped);
}

function unmapped(m: Record<string, unknown>): ManifestConversionError {
  const id = String(m["id"]);
  return new ManifestConversionError(
    m["modApi"] === undefined
      ? `manifest ${id}: ships code but declares no modApi, so there is no API to convert it to; add "modApi": 1 first`
      : `manifest ${id}: modApi ${String(m["modApi"])}${m["runtime"] === undefined ? "" : ` with runtime "${String(m["runtime"])}"`} has no schema 2 mapping`,
  );
}

/** Schema 1 fields to schema 2 data, once the runtime and API are settled. */
function convertFields(m: Record<string, unknown>, mapped: { runtime: ModRuntime; api: string; entry?: string }): ManifestV2Data {
  const out: Record<string, unknown> = {
    id: m["id"],
    name: m["name"],
    version: m["version"],
    api: mapped.api,
    runtime: mapped.runtime,
    ...(mapped.entry === undefined ? {} : { entry: mapped.entry }),
  };
  if (typeof m["engine"] === "string") out["engine"] = { range: m["engine"], because: CONVERTED_ENGINE_REASON };

  const toDeps = (value: unknown): Record<string, ManifestDependency> | undefined => {
    if (!isRecord(value)) return undefined;
    const deps: Record<string, ManifestDependency> = {};
    for (const [dep, constraint] of Object.entries(value)) deps[dep] = { range: String(constraint) };
    return deps;
  };
  const required = toDeps(m["dependencies"]);
  const optional = toDeps(m["optionalDependencies"]);
  const compat = Array.isArray(m["compat"]) ? (m["compat"] as PackCompat[]) : undefined;
  const conflicts: Record<string, ManifestConflict> = {};
  const keptCompat: PackCompat[] = [];
  if (compat !== undefined) {
    const wholeMod = compat.filter((c) => c.claim === "conflicts" && c.scope === undefined);
    for (const claim of compat) {
      const movable = claim.claim === "conflicts" && claim.scope === undefined &&
        wholeMod.filter((c) => c.with === claim.with).length === 1 &&
        required?.[claim.with] === undefined && optional?.[claim.with] === undefined;
      if (movable) {
        conflicts[claim.with] = { ...(claim.range === undefined ? {} : { range: claim.range }), because: claim.because };
      } else {
        keptCompat.push(claim);
      }
    }
  }
  const deps: Record<string, unknown> = {};
  if (required !== undefined) deps["required"] = required;
  if (optional !== undefined) deps["optional"] = optional;
  if (Object.keys(conflicts).length > 0) deps["conflicts"] = conflicts;
  if (Object.keys(deps).length > 0) out["dependencies"] = deps;

  for (const key of KEPT_FIELDS) {
    if (m[key] !== undefined) out[key] = m[key];
  }
  /* A Worker mod's capabilities take their names in the one vocabulary both
   * runtimes share (worker-capabilities.ts); a retired name with no API 2
   * permission is dropped rather than widened into another one. */
  if (mapped.runtime === "worker" && Array.isArray(m["capabilities"])) {
    out["capabilities"] = unifiedCapabilities((m["capabilities"] as unknown[]).filter((c): c is string => typeof c === "string"));
  }
  if (compat !== undefined && keptCompat.length > 0) out["compat"] = keptCompat;

  const listing: Record<string, unknown> = {};
  if (Array.isArray(m["screenshots"])) listing["screenshots"] = m["screenshots"];
  if (typeof m["changelog"] === "string") listing["changelog"] = m["changelog"];
  if (Object.keys(listing).length > 0) out["listing"] = listing;
  return out as unknown as ManifestV2Data;
}

/**
 * The schema 2 data for an in-memory manifest, which is what a manifest file is
 * written from: the inverse of normalizeManifestV2, and convertManifestV1 for a
 * manifest read from schema 1. Throws ManifestConversionError for a schema 1
 * plugin whose `modApi` has no mapping.
 */
export function manifestToV2(manifest: PackManifest): ManifestV2Data {
  const m = manifest as unknown as Record<string, unknown>;
  const runtime = manifest.runtime;
  const mapped = manifest.api !== undefined && runtime !== undefined
    ? { runtime, api: manifest.api, ...(runtime === "worker" && manifest.entry !== undefined ? { entry: manifest.entry } : {}) }
    : schema1Runtime(m);
  if (mapped === null) throw unmapped(m);
  const out = convertFields(m, mapped) as unknown as Record<string, unknown>;
  if (manifest.engine !== undefined && manifest.engineBecause !== undefined) {
    out["engine"] = { range: manifest.engine, because: manifest.engineBecause };
  }
  const deps = out["dependencies"] as Record<string, Record<string, ManifestDependency> | undefined> | undefined;
  for (const [dep, because] of Object.entries(manifest.dependencyReasons ?? {})) {
    for (const kind of ["required", "optional"] as const) {
      const entry = deps?.[kind]?.[dep];
      if (entry !== undefined) deps![kind]![dep] = { ...entry, because };
    }
  }
  if (manifest.listing !== undefined) out["listing"] = { ...manifest.listing, ...(out["listing"] as object | undefined) };
  if (manifest.text !== undefined) out["text"] = manifest.text;
  if (manifest.budget !== undefined) out["budget"] = manifest.budget;
  return out as unknown as ManifestV2Data;
}

/* ------------------------------------------------------------------ */
/* Schema 2 to the in-memory manifest                                  */
/* ------------------------------------------------------------------ */

/**
 * The ABI number the host's loader files a schema 2 manifest under, or
 * undefined when this build runs no API the range admits. In process that is
 * API 1; in a Worker it is API 2, the same API an in-process mod reaches.
 */
export function legacyModApi(runtime: ModRuntime, api: string): 1 | 2 | undefined {
  try {
    if (runtime === "in-process" && satisfies(MOD_API_1_VERSION, api)) return 1;
    if (runtime === "worker" && satisfies(MOD_API2_VERSION, api)) return 2;
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * Turn validated schema 2 data into the in-memory PackManifest: every field the
 * host already reads under its schema 1 name, plus the schema 2 fields.
 */
export function normalizeManifestV2(data: ManifestV2Data): PackManifest {
  const code = data.runtime !== "data";
  const declared = data.facets ?? [];
  const facets: PackShape[] = [...declared];
  if (code && !facets.includes("plugin")) facets.push("plugin");
  if (facets.length === 0) facets.push(data.shape ?? "content");
  const shape: PackShape = data.shape ?? (facets.find((f) => f !== "plugin") ?? "plugin");
  if (!facets.includes(shape)) facets.unshift(shape);

  const out: Record<string, unknown> = {
    id: data.id,
    name: data.name,
    version: data.version,
    shape,
  };
  if (data.facets !== undefined || facets.length > 1 || facets[0] !== shape) out["facets"] = facets;
  if (data.engine !== undefined) {
    out["engine"] = data.engine.range;
    out["engineBecause"] = data.engine.because;
  }
  const deps = data.dependencies;
  const ranges = (map: Readonly<Record<string, ManifestDependency>> | undefined): Record<string, string> | undefined =>
    map === undefined ? undefined : Object.fromEntries(Object.entries(map).map(([dep, d]) => [dep, d.range]));
  const required = ranges(deps?.required);
  const optional = ranges(deps?.optional);
  if (required !== undefined) out["dependencies"] = required;
  if (optional !== undefined) out["optionalDependencies"] = optional;
  const reasons: Record<string, string> = {};
  for (const map of [deps?.required, deps?.optional]) {
    for (const [dep, d] of Object.entries(map ?? {})) if (d.because !== undefined) reasons[dep] = d.because;
  }
  if (Object.keys(reasons).length > 0) out["dependencyReasons"] = reasons;

  for (const key of KEPT_FIELDS) {
    if (key === "shape" || key === "facets") continue;
    const value = (data as unknown as Record<string, unknown>)[key];
    if (value !== undefined) out[key] = value;
  }
  const conflicts = Object.entries(deps?.conflicts ?? {}).map(([withId, c]): PackCompat => ({
    with: withId,
    ...(c.range === undefined ? {} : { range: c.range }),
    claim: "conflicts",
    because: c.because,
  }));
  if (data.compat !== undefined || conflicts.length > 0) out["compat"] = [...(data.compat ?? []), ...conflicts];

  if (data.listing?.changelog !== undefined) out["changelog"] = data.listing.changelog;
  if (data.listing?.screenshots !== undefined) out["screenshots"] = [...data.listing.screenshots];
  if (data.listing !== undefined) out["listing"] = data.listing;
  if (data.text !== undefined) out["text"] = data.text;
  if (data.budget !== undefined) out["budget"] = data.budget;

  out["api"] = data.api;
  out["runtime"] = data.runtime;
  if (code) out["entry"] = data.entry ?? IN_PROCESS_ENTRY;
  const abi = legacyModApi(data.runtime, data.api);
  if (abi !== undefined) out["modApi"] = abi;
  if (data.runtime === "worker" && data.entry !== undefined) out["workerEntry"] = data.entry;
  out["manifestSchema"] = 2;
  return out as unknown as PackManifest;
}

/**
 * The runtime-follows-payload check against the files a mod folder really
 * holds. `code` lists the folder's script modules (`.js`, `.mjs`). Null when the
 * manifest and the files agree.
 */
export function runtimePayloadComplaint(manifest: Pick<PackManifest, "id" | "runtime" | "entry">, code: readonly string[]): string | null {
  const runtime = manifest.runtime ?? "data";
  if (runtime === "data") {
    const shipped = code[0];
    return shipped === undefined
      ? null
      : `manifest ${manifest.id}: declares runtime "data" but ships ${shipped}; declare runtime "in-process" or "worker", or remove the code`;
  }
  const entry = manifest.entry ?? IN_PROCESS_ENTRY;
  return code.some((file) => file.toLowerCase() === entry.toLowerCase())
    ? null
    : `manifest ${manifest.id}: runtime "${runtime}" starts ${entry}, which is not in the mod`;
}

/** The milliseconds per game turn a mod may use: its declared budget, or the default. */
export function turnBudgetMs(manifest: Pick<PackManifest, "budget">): number {
  return manifest.budget?.msPerTurn ?? DEFAULT_TURN_BUDGET_MS;
}

/* ------------------------------------------------------------------ */
/* The registered format                                               */
/* ------------------------------------------------------------------ */

const SAMPLE_V1 = {
  id: "example",
  name: "Example",
  version: "1.0.0",
  shape: "content",
  facets: ["content", "plugin"],
  modApi: 1,
  engine: ">=1.21.1",
  dependencies: { core: "*", "other-mod": "^1.2.0" },
  optionalDependencies: { linoleum: "*" },
  compat: [{ with: "rival", claim: "conflicts", because: "Both rewrite the shops." }],
  capabilities: ["command:add"],
  changelog: "CHANGELOG.md",
  screenshots: ["shots/town.png"],
};

/**
 * The manifest document format. Schema 1 documents migrate through
 * convertManifestV1; bare schema 1 manifests (no envelope) are read by
 * manifest.ts and converted the same way.
 */
export const modManifestFormat = defineFormat<ManifestV2Data>({
  format: MANIFEST_FORMAT,
  schemaVersion: MANIFEST_SCHEMA_VERSION,
  validator: manifestV2Validator,
  migrations: { 1: convertManifestV1 },
  sampleV1: SAMPLE_V1,
  sample: convertManifestV1(SAMPLE_V1),
});
