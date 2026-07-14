/**
 * Pack manifests: identity, versioning, and dependencies.
 *
 * Every pack - the base game included - carries a manifest. Load order,
 * record composition, and savefile provenance all key off it.
 */

/** Pack identifiers are namespaced: "<pack>:<id>", e.g. "core:kobold". */
export type PackRef = `${string}:${string}`;

/** The three pack shapes (docs/MODS.md). */
export type PackShape = "content" | "tiles" | "plugin";

/**
 * A capability a scripted plugin requests (MOD_LIFECYCLE section 4). The
 * runtime grants only what a `shape: plugin` pack declares and the user
 * approves; content and tile packs request none. The vocabulary
 * ("command:add", "event:turn-start", "state:*.read", "network:<host>", ...)
 * is enforced by the capability model (P7 phase 5); the manifest only records
 * the request, so any string is accepted here.
 */
export type Capability = string;

export interface PackManifest {
  /**
   * The pack's namespace: lowercase kebab-case, unique among loaded
   * packs. "core" is reserved for the base game.
   */
  id: string;
  /** Human-readable title. */
  name: string;
  /** Semantic version of the pack itself. */
  version: string;
  shape: PackShape;
  /**
   * Engine version range the pack requires (semver range, e.g. ">=0.5.0
   * <0.7.0"). A save refuses to load on an incompatible engine.
   */
  engine?: string;
  /**
   * Packs this one depends on, by id. A pack may only patch, replace,
   * or remove records owned by packs it declares here. Values are
   * version constraints; "*" accepts any version.
   */
  dependencies?: Record<string, string>;
  /**
   * Soft dependencies: if the named pack is present it loads first and may
   * be modified, but its absence is not an error (MOD_LIFECYCLE section 2).
   */
  optionalDependencies?: Record<string, string>;
  /** Load-order hints (MOD_LIFECYCLE section 3): follow / precede these ids. */
  loadAfter?: string[];
  loadBefore?: string[];
  /**
   * The pack's own save-block schema version. The engine hands a mod its
   * old `mod:<id>` bag and asks it to migrate from this number on update.
   */
  saveSchema?: number;
  /** Capabilities a `shape: plugin` pack requests (see Capability). */
  capabilities?: Capability[];
  /**
   * Declares the pack deliberately nondeterministic (a wall-clock event, an
   * external agent, live multiplayer). Trips the save's determinism ratchet
   * once, irreversibly (MOD_LIFECYCLE section 4, decision 4/18).
   */
  nondeterministic?: boolean;
  /** Free-form author credit. */
  author?: string;
  /** SPDX license expression for the pack's own content. */
  license?: string;
  /** Source repository URL (installer provenance). */
  repository?: string;
  /** Path to the changelog within the pack. */
  changelog?: string;
  /** Paths to screenshot assets within the pack (marketplace preview). */
  screenshots?: string[];
}

const ID_RE = /^[a-z][a-z0-9-]*$/;
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const SHAPES: readonly PackShape[] = ["content", "tiles", "plugin"];

export class ManifestError extends Error {}

/** Validate a parsed manifest object; throws ManifestError. */
export function validateManifest(value: unknown): PackManifest {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ManifestError("manifest must be an object");
  }
  const m = value as Record<string, unknown>;
  if (typeof m["id"] !== "string" || !ID_RE.test(m["id"])) {
    throw new ManifestError(
      `manifest id must be lowercase kebab-case: ${String(m["id"])}`,
    );
  }
  if (typeof m["name"] !== "string" || m["name"].length === 0) {
    throw new ManifestError(`manifest ${m["id"]}: name is required`);
  }
  if (typeof m["version"] !== "string" || !VERSION_RE.test(m["version"])) {
    throw new ManifestError(
      `manifest ${m["id"]}: version must be semver, got ${String(m["version"])}`,
    );
  }
  if (!SHAPES.includes(m["shape"] as PackShape)) {
    throw new ManifestError(
      `manifest ${m["id"]}: shape must be one of ${SHAPES.join(", ")}`,
    );
  }
  const id = m["id"] as string;
  validateDepMap(m["dependencies"], id, "dependencies");
  validateDepMap(m["optionalDependencies"], id, "optionalDependencies");
  validateIdList(m["loadAfter"], id, "loadAfter");
  validateIdList(m["loadBefore"], id, "loadBefore");
  if (m["saveSchema"] !== undefined) {
    const s = m["saveSchema"];
    if (typeof s !== "number" || !Number.isInteger(s) || s < 0) {
      throw new ManifestError(
        `manifest ${id}: saveSchema must be a non-negative integer`,
      );
    }
  }
  if (m["capabilities"] !== undefined) {
    if (
      !Array.isArray(m["capabilities"]) ||
      m["capabilities"].some((c) => typeof c !== "string")
    ) {
      throw new ManifestError(`manifest ${id}: capabilities must be strings`);
    }
  }
  if (
    m["nondeterministic"] !== undefined &&
    typeof m["nondeterministic"] !== "boolean"
  ) {
    throw new ManifestError(`manifest ${id}: nondeterministic must be a boolean`);
  }
  for (const key of ["engine", "repository", "changelog"] as const) {
    if (m[key] !== undefined && typeof m[key] !== "string") {
      throw new ManifestError(`manifest ${id}: ${key} must be a string`);
    }
  }
  return m as unknown as PackManifest;
}

/** Validate an optional id->constraint map field (dependencies-shaped). */
function validateDepMap(deps: unknown, id: string, field: string): void {
  if (deps === undefined) return;
  if (typeof deps !== "object" || deps === null || Array.isArray(deps)) {
    throw new ManifestError(`manifest ${id}: ${field} must be a map`);
  }
  for (const [dep, constraint] of Object.entries(deps)) {
    if (!ID_RE.test(dep)) {
      throw new ManifestError(`manifest ${id}: bad ${field} id ${dep}`);
    }
    if (typeof constraint !== "string") {
      throw new ManifestError(
        `manifest ${id}: ${field} ${dep} constraint must be a string`,
      );
    }
  }
}

/** Validate an optional array-of-pack-ids field (loadAfter/loadBefore). */
function validateIdList(value: unknown, id: string, field: string): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    throw new ManifestError(`manifest ${id}: ${field} must be an array`);
  }
  for (const entry of value) {
    if (typeof entry !== "string" || !ID_RE.test(entry)) {
      throw new ManifestError(`manifest ${id}: bad ${field} id ${String(entry)}`);
    }
  }
}

/**
 * Slug a record name into the id segment of a PackRef: lowercase, runs
 * of non-alphanumerics collapse to single hyphens ("Farmer Maggot" ->
 * "farmer-maggot"). Stable: this is a savefile-visible identity.
 */
export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Build a namespaced record reference. */
export function packRef(packId: string, name: string): PackRef {
  return `${packId}:${slugify(name)}`;
}
