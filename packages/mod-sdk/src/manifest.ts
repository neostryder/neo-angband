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

/** Every shape, for validation and for iterating the facet vocabulary. */
export const PACK_SHAPES: readonly PackShape[] = ["content", "tiles", "plugin"];

/**
 * WHAT A PACK CONTRIBUTES, as a SET rather than one exclusive kind.
 *
 * `shape` was exclusive, and the two halves of the loader gated on opposite
 * values: code loaded only for `shape: "plugin"` (web/src/mod-code.ts) and
 * records composed only for `shape: "content"` (web/src/pack.ts). So the folder
 * layout the plugin documentation promises -
 *
 *     my-mod/  manifest.json  plugin.js  monster.json  tiles/orc.png
 *
 * - could never work: declaring "plugin" dropped monster.json from composition,
 * and declaring "content" refused the code. Each half had tests and each half
 * passed; nothing asserted the two together. A mod that adds a monster AND gives
 * it behaviour is the ordinary case, not an exotic one.
 *
 * `facets` is that set. `shape` stays REQUIRED and remains the pack's primary
 * kind - it is what the manager displays and what every existing manifest
 * already carries - and when `facets` is present it must CONTAIN `shape`, so the
 * two fields cannot contradict each other. A hybrid declares:
 *
 *     { "shape": "content", "facets": ["content", "plugin"] }
 *
 * The consent property is unchanged and is why `facets` is a declaration rather
 * than something inferred from the folder's contents: shipping plugin.js without
 * naming the `plugin` facet is still a REFUSAL, because running code must be
 * something a mod states rather than something a file listing implies.
 */
export function packFacets(
  manifest: Pick<PackManifest, "shape" | "facets">,
): ReadonlySet<PackShape> {
  return new Set(manifest.facets ?? [manifest.shape]);
}

/** Whether a pack contributes `facet` (its shape, or any declared facet). */
export function hasFacet(
  manifest: Pick<PackManifest, "shape" | "facets">,
  facet: PackShape,
): boolean {
  return packFacets(manifest).has(facet);
}

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

/**
 * One graphics mode a `tiles`-facet pack contributes.
 *
 * This was read loosely off the raw JSON for a long time and was NOT in the
 * validated schema, which the moddability measurement recorded as a gap
 * (docs/modding/MOD_REACH.md). The consequence was specific rather than
 * theoretical: a typo in `grafID` or `path` produced no error anywhere - the entry
 * was silently skipped, and a mod author saw a Graphics row that simply never
 * appeared. Declaring it here means the manifest is refused at the edge, with the
 * mod's id and the offending field named.
 */
export interface PackTilePack {
  /**
   * The list.txt serial number this mode renders as. A `tilesheet` pack must claim
   * one the core catalog already knows (it borrows that row's cell size, atlas
   * filename and pref file); a `linoleum` pack carries its own metadata and may
   * claim a new id - use >= 100 to stay clear of upstream's numbering.
   */
  grafID: number;
  /**
   * The pack's directory INSIDE THE MOD FOLDER (`original-tiles`,
   * `tiles/my-set`), or absent for a pack that is the mod folder itself.
   *
   * Mod-relative, not a site path. A mod cannot know where a host serves it from,
   * and two of the three sources serve it from nowhere: a folder the player picked
   * has no URL for its files until their bytes are wrapped in a blob:, and a mod
   * installed from a repository lives in IndexedDB. The host composes this with
   * the mod's own asset resolver.
   */
  path?: string;
  /**
   * Which renderer draws it: `tilesheet` (or absent) for upstream's own scheme -
   * one atlas PNG addressed by row/column - and `linoleum` for a loose pack, a
   * directory of individually named PNGs. This is the PACK's renderer; the
   * manifest's top-level `engine` is the game version the mod targets.
   */
  engine?: "tilesheet" | "linoleum";
  /**
   * The Graphics row's label. Required in effect for a mode the core catalog does
   * not have, since there would be nothing to name the row; a pack re-skinning a
   * catalogued mode may omit it and borrow that row's name.
   */
  menuname?: string;
}

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
  /**
   * The pack's primary kind, and what the mod manager displays. When `facets` is
   * absent this is the pack's only facet.
   */
  shape: PackShape;
  /**
   * Everything this pack contributes, when it contributes more than one kind -
   * a mod shipping both `plugin.js` and record JSON declares
   * `["content", "plugin"]`. Must contain `shape`. See packFacets().
   */
  facets?: readonly PackShape[];
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
   * Graphics modes this pack contributes (see PackTilePack). Only read for a pack
   * with the `tiles` facet; a content pack that declares them contributes none.
   */
  tilePacks?: PackTilePack[];
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
  if (!PACK_SHAPES.includes(m["shape"] as PackShape)) {
    throw new ManifestError(
      `manifest ${m["id"]}: shape must be one of ${PACK_SHAPES.join(", ")}`,
    );
  }
  const id = m["id"] as string;
  validateFacets(m["facets"], id, m["shape"] as PackShape);
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
  validateTilePacks(m["tilePacks"], id);
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

/** The pack renderers a tilePacks entry may name. */
const TILE_ENGINES: readonly string[] = ["tilesheet", "linoleum"];

/**
 * Validate the optional `tilePacks` array (PackTilePack[]); throws ManifestError.
 *
 * `path` is checked for being MOD-RELATIVE, and that check is the point rather than
 * tidiness. It used to be a site-root-relative URL base, which only a bundled mod
 * could ever get right; a manifest carrying the old form would resolve to
 * `mods/<id>/mods/<id>/…` and 404 into ASCII with nothing said. An absolute path, a
 * scheme, or a `..` escape is refused for the same reason a pack's code files are
 * read by pack-relative path: the host decides where a mod's bytes live.
 */
function validateTilePacks(value: unknown, id: string): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    throw new ManifestError(`manifest ${id}: tilePacks must be an array`);
  }
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new ManifestError(`manifest ${id}: each tilePacks entry must be an object`);
    }
    const p = entry as Record<string, unknown>;
    const graf = p["grafID"];
    if (typeof graf !== "number" || !Number.isInteger(graf) || graf < 0) {
      throw new ManifestError(
        `manifest ${id}: tilePacks grafID must be a non-negative integer, got ${String(graf)}`,
      );
    }
    if (p["engine"] !== undefined && !TILE_ENGINES.includes(p["engine"] as string)) {
      throw new ManifestError(
        `manifest ${id}: tilePacks engine must be one of ${TILE_ENGINES.join(", ")}, got ${String(p["engine"])}`,
      );
    }
    if (p["menuname"] !== undefined && typeof p["menuname"] !== "string") {
      throw new ManifestError(`manifest ${id}: tilePacks menuname must be a string`);
    }
    if (p["path"] === undefined) continue;
    const path = p["path"];
    if (typeof path !== "string") {
      throw new ManifestError(`manifest ${id}: tilePacks path must be a string`);
    }
    if (/^([a-z][a-z0-9+.-]*:)?\//iu.test(path) || path.startsWith("\\")) {
      throw new ManifestError(
        `manifest ${id}: tilePacks path "${path}" must be relative to the mod folder, not a site or absolute path`,
      );
    }
    if (path.split(/[/\\]/u).includes("..")) {
      throw new ManifestError(
        `manifest ${id}: tilePacks path "${path}" must stay inside the mod folder`,
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
 * Validate the optional `facets` list against the pack's `shape`.
 *
 * `shape` must appear in `facets`. Without that rule the two fields could
 * disagree - `{shape: "content", facets: ["plugin"]}` - and every consumer would
 * have to decide which one it trusted, which is how the exclusive `shape`
 * produced a folder layout the documentation promised and the loader refused.
 * One source of truth, checked once, at the edge.
 */
function validateFacets(value: unknown, id: string, shape: PackShape): void {
  if (value === undefined) return;
  if (!Array.isArray(value) || value.length === 0) {
    throw new ManifestError(
      `manifest ${id}: facets must be a non-empty array of ${PACK_SHAPES.join(", ")}`,
    );
  }
  const seen = new Set<string>();
  for (const entry of value) {
    if (typeof entry !== "string" || !PACK_SHAPES.includes(entry as PackShape)) {
      throw new ManifestError(
        `manifest ${id}: facet must be one of ${PACK_SHAPES.join(", ")}, got ${String(entry)}`,
      );
    }
    if (seen.has(entry)) {
      throw new ManifestError(`manifest ${id}: facet "${entry}" is listed twice`);
    }
    seen.add(entry);
  }
  if (!seen.has(shape)) {
    throw new ManifestError(
      `manifest ${id}: facets ${JSON.stringify(value)} must include its shape "${shape}"`,
    );
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
