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
 * One player-toggleable "rule" a pack contributes: a flag name the pack owns,
 * plus the human-facing label / description / default the in-app "Fixes &
 * tweaks" menu renders.
 *
 * WHAT THIS USED TO BE, AND WHY IT IS NOT THAT ANY MORE. The first design made
 * this a registry of CORE flags: the corrected behaviour lived in ported core as
 * an off-by-default branch guarded by `if (modRuleEnabled(state, flag))`, the
 * host applied the resolved choices to GameState.modRules, and no mod code ran.
 * That design was deleted on 2026-07-29 because a flag-gated fix is not excluded
 * from core - core shipped the fix body AND the mod's flag name, so deleting the
 * mod folder would not have deleted a line of it. `modRuleEnabled` is GONE
 * (packages/core/src/game/context.ts, where its removal is recorded), and
 * `GameState.modRules` still exists but is OPAQUE to core: core stores it because
 * a save has to record which patches a character was played with, and never
 * branches on it (`context.ts`, the modRules doc comment).
 *
 * WHAT A RULE IS NOW: an input to the MOD's own code. Mods do run code. A mod
 * that changes behaviour ships `hooks.ts` next to its manifest, default-exporting
 * `(flags: Readonly<Record<string, boolean>>) => ModHooks`. The host discovers it
 * (packages/web/src/mod-hooks.ts), calls it once per ENABLED mod in load order
 * with only THAT mod's resolved flags (`choices[flag] ?? rule.default` for the
 * rules its own manifest declares, so one mod cannot read another's toggles), and
 * folds the results into the single ModHooks core holds via `composeModHooks`
 * (packages/core/src/mod/hooks.ts). Each fix body lives in its mod's folder; what
 * core contains is the generic seam, not any mod's name.
 *
 * A disabled mod's patches DO NOT EXIST rather than existing and reading false:
 * its entry point is never called, it contributes no hook, composeModHooks
 * returns undefined, and GameState.modHooks stays absent - so core runs the
 * faithful 4.2.6 path, which is the only path compiled into the branch.
 *
 * A rules-only pack is still a plain `content` pack requesting no capabilities;
 * `rules` remains pure declaration, and this manifest still holds no behaviour.
 */
export interface PackRule {
  /**
   * The flag this rule toggles (e.g. "qol.autoDig"). Namespaced by convention to
   * the owning pack, because the pack's own hooks.ts is what reads it; the host
   * also records the resolved value on GameState.modRules as save state.
   */
  flag: string;
  /** Short menu label (e.g. "Auto-dig"). */
  title: string;
  /** One- or two-line description shown under the toggle in the menu. */
  description: string;
  /** Whether the rule is ON by default when the mod is enabled. */
  default: boolean;
}

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
   * The mod-plugin ABI version this pack's `plugin.js` was written against, and
   * REQUIRED of any pack that ships one. Separate from `engine` on purpose: the
   * engine version and the ABI a mod's code compiles against diverge immediately
   * - a patch release changes the former and not the latter.
   *
   * Declared here, in the MANIFEST, rather than only inside plugin.js, so the
   * host can refuse an incompatible plugin BEFORE importing it. A version check
   * that lives inside the module can only run after the module's top-level code
   * has already executed, which is the wrong order for player-supplied code.
   *
   * An exact integer, matched exactly, because the ABI is explicitly unstable
   * until 1.0: every change to it bumps this number and every mod must
   * republish. A semver range would imply a compatibility promise that does not
   * exist yet.
   */
  modApi?: number;
  /**
   * Player-toggleable flags this pack owns (see PackRule). The bundled qol /
   * bug-fixes mods use this to declare their fixes/tweaks for the in-app "Fixes
   * & tweaks" menu; the host resolves (choice ?? default), hands each mod its own
   * slice when it calls that mod's hooks.ts, and records the result on
   * GameState.modRules as save state. Absent for a pack with nothing to toggle.
   */
  rules?: PackRule[];
  /**
   * Declares the pack deliberately nondeterministic (a wall-clock event, an
   * external agent, live multiplayer). Trips the save's determinism ratchet
   * once, irreversibly (MOD_LIFECYCLE section 4, decision 4/18).
   */
  nondeterministic?: boolean;
  /** Declares a gameplay change that permanently makes an enabled save non-scoring. */
  affectsGameplay?: boolean;
  /**
   * What the pack does, in the author's own words, for a human deciding whether
   * to enable it. Prose, not a tagline: the in-app mod manager wraps it to fill
   * the detail pane of the highlighted row, and a marketplace listing would show
   * the same text. Absent is allowed but leaves a player with only the id/shape
   * to go on.
   */
  description?: string;
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
  if (m["modApi"] !== undefined) {
    const a = m["modApi"];
    if (typeof a !== "number" || !Number.isInteger(a) || a < 1) {
      throw new ManifestError(
        `manifest ${id}: modApi must be a positive integer (the mod-plugin ABI version)`,
      );
    }
  }
  if (
    m["nondeterministic"] !== undefined &&
    typeof m["nondeterministic"] !== "boolean"
  ) {
    throw new ManifestError(`manifest ${id}: nondeterministic must be a boolean`);
  }
  if (
    m["affectsGameplay"] !== undefined &&
    typeof m["affectsGameplay"] !== "boolean"
  ) {
    throw new ManifestError(`manifest ${id}: affectsGameplay must be a boolean`);
  }
  validateRules(m["rules"], id);
  for (const key of [
    "engine",
    "repository",
    "changelog",
    "description",
    "author",
    "license",
  ] as const) {
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

/** Validate the optional `rules` array (PackRule[]); throws ManifestError. */
function validateRules(value: unknown, id: string): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    throw new ManifestError(`manifest ${id}: rules must be an array`);
  }
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new ManifestError(`manifest ${id}: each rule must be an object`);
    }
    const r = entry as Record<string, unknown>;
    if (typeof r["flag"] !== "string" || r["flag"].length === 0) {
      throw new ManifestError(`manifest ${id}: rule flag must be a non-empty string`);
    }
    if (seen.has(r["flag"])) {
      throw new ManifestError(`manifest ${id}: duplicate rule flag ${r["flag"]}`);
    }
    seen.add(r["flag"]);
    if (typeof r["title"] !== "string" || r["title"].length === 0) {
      throw new ManifestError(`manifest ${id}: rule ${r["flag"]} title must be a non-empty string`);
    }
    if (typeof r["description"] !== "string") {
      throw new ManifestError(`manifest ${id}: rule ${r["flag"]} description must be a string`);
    }
    if (typeof r["default"] !== "boolean") {
      throw new ManifestError(`manifest ${id}: rule ${r["flag"]} default must be a boolean`);
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
