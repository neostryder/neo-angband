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
   * Packs this one depends on, by id. A pack may only patch, replace,
   * or remove records owned by packs it declares here. Values are
   * version constraints; "*" accepts any version.
   */
  dependencies?: Record<string, string>;
  /** Free-form author credit. */
  author?: string;
  /** SPDX license expression for the pack's own content. */
  license?: string;
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
  const deps = m["dependencies"];
  if (deps !== undefined) {
    if (typeof deps !== "object" || deps === null || Array.isArray(deps)) {
      throw new ManifestError(`manifest ${m["id"]}: dependencies must be a map`);
    }
    for (const [dep, constraint] of Object.entries(deps)) {
      if (!ID_RE.test(dep)) {
        throw new ManifestError(`manifest ${m["id"]}: bad dependency id ${dep}`);
      }
      if (typeof constraint !== "string") {
        throw new ManifestError(
          `manifest ${m["id"]}: dependency ${dep} constraint must be a string`,
        );
      }
    }
  }
  return m as unknown as PackManifest;
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
