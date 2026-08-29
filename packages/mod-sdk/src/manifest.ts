/**
 * Pack manifests: identity, versioning, and dependencies.
 *
 * Every pack - the base game included - carries a manifest. Load order,
 * record composition, and savefile provenance all key off it.
 */

import { FIELD_TYPES } from "./fields.js";
import type { FieldDecl, FieldType } from "./fields.js";
import { resourceComplaint } from "./resources.js";
import type { PackResource } from "./resources.js";

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
 * rules its own manifest declares, so one mod cannot read another's toggles -
 * with one deliberate exception: a SECTION named by a `patches` compat claim
 * also hands its resolved flag to the mod the claim names, since the claim
 * already means "this section only makes sense when that mod is present"
 * (neo-angband#32, packages/web/src/pack.ts's sectionFlagsByMod). A rule
 * cannot do this - only a section reached through a `patches` claim), and
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
 * ONE NAMED PART OF A MOD - the unit an author can prioritise, a player can
 * switch off, and a compatibility claim can point at.
 *
 * WHY THIS EXISTS. A mod used to be one atom in the load order. That made three
 * ordinary requests inexpressible, and they turned out to be the same request:
 *
 *  - "I clash with frost-realms, but only over the kobold changes" - there was
 *    nothing to name, so the only way to say it was a `loadAfter`, which is
 *    binding, unscoped, and silent about the reason.
 *  - "my tileset should win but my monsters should lose" - a mod has one
 *    position, so the only answer was to ship two mods.
 *  - "use this mod but not that part of it" - `rules` did this for BEHAVIOUR
 *    only (a flag the mod's own hooks.ts reads); a content patch could not be
 *    switched off at all.
 *
 * A section answers all three. Contributions are attributed to it
 * (FileContribution.sections), it carries its own priority band, and the player
 * gets one toggle per section.
 *
 * RELATION TO `rules`. A rule is exactly a section with a flag and no
 * contributions: same title/description/default, and its flag reaches the mod's
 * hooks.ts. `rules` is unchanged and every shipped manifest keeps working - a
 * section simply also exposes a flag (its `flag`, or its `id`), so one mod can
 * use one vocabulary for both the fixes it toggles and the content it ships.
 *
 * A DISABLED SECTION'S CONTRIBUTIONS DO NOT EXIST. They are dropped before
 * composition rather than composed and then overridden, for the same reason a
 * disabled mod contributes no hook: "off" has to mean absent, or core is holding
 * a mod's data and calling it faithful.
 */
export interface PackSection {
  /** Unique within the mod, lowercase kebab-case. Savefile-visible. */
  id: string;
  /** Short menu label ("Kobold rebalance"). */
  title: string;
  /** One or two lines under the toggle. */
  description?: string;
  /** Whether the section is on when the mod is enabled. Absent means on. */
  default?: boolean;
  /**
   * Where this section sits relative to the rest of the mod (see SectionBand).
   * Absent is "normal": the section takes its mod's own load-order position.
   */
  priority?: SectionBand;
  /**
   * The flag name handed to the mod's hooks.ts for this section, when it should
   * differ from `id` - e.g. a mod migrating from `rules` that wants to keep the
   * flag string its code already reads. Defaults to `id`.
   */
  flag?: string;
  /**
   * Flags this section used to be known by. The host moves the first matching
   * saved rule or section choice here when this section has no choice of its
   * own, so changing a rule into a content-carrying section does not reset the
   * player's deliberate on/off decision.
   */
  renamedSectionFlags?: string[];
}

/**
 * How far out of its mod's load-order position a section sits.
 *
 * BANDS RATHER THAN A NUMERIC OFFSET, and the reason is stability. An offset
 * added to a load index means something different the moment the player installs
 * another mod - "+1" is a different neighbour every time the list changes. A band
 * is absolute: every `last` section composes after every `normal` one, whatever
 * else is installed. This is Forge's event-priority scheme (HIGHEST..LOWEST) laid
 * over a Bethesda-style load order, and it also refuses the arms race an integer
 * invites, because there is no value above `last`.
 *
 * The band dominates the load order for that section only. An author may
 * therefore jump the queue with their own contributions and cannot touch anyone
 * else's - which is the authority line this whole model draws. The conflict
 * report names any section that won because of its band, so it is never silent.
 */
export type SectionBand = "first" | "early" | "normal" | "late" | "last";

/** Every band, earliest to latest; the index is the sort key. */
export const SECTION_BANDS: readonly SectionBand[] = [
  "first",
  "early",
  "normal",
  "late",
  "last",
];

/**
 * What an author claims about ANOTHER mod.
 *
 * None of these bind. A claim about your own mod (a section's band, what it
 * contributes) is authoritative; a claim about someone else's is evidence for the
 * sorter and text for the player, and the player's own order outranks all of it.
 * That asymmetry is the rule the whole compatibility model rests on, and it is
 * why even `conflicts` cannot refuse a launch.
 *
 *  - `prefer-mine` / `prefer-theirs`: a SOFT ordering preference, scoped to the
 *    sections named in `scope`. Feeds the auto-sort; dropped without ceremony if
 *    honouring it would contradict a hard edge or another, stronger preference.
 *  - `conflicts`: "these should not both run." Shown as a loud warning carrying
 *    the author's own reason, at enable time and in the conflict pane. NOT a
 *    refusal - NeoForge and Factorio both block here, and this engine
 *    deliberately does not (ratified decision 18: the engine labels, it does not
 *    forbid). A third-party author does not get a veto over the player's setup,
 *    and a stale declaration must stay something the player can walk past.
 *  - `patches`: "when that mod is present, my section X is the compatibility
 *    patch for it." The section is then enabled only when the named mod is, and
 *    ignored otherwise. This is the one claim that produces a FIX rather than a
 *    winner, which is why it is worth having early - it lets a compatibility
 *    patch ship inside the mod instead of as a third download.
 */
export type CompatClaim = "prefer-mine" | "prefer-theirs" | "conflicts" | "patches";

/** Every claim kind, for validation and for iterating the vocabulary. */
export const COMPAT_CLAIMS: readonly CompatClaim[] = [
  "prefer-mine",
  "prefer-theirs",
  "conflicts",
  "patches",
];

/** One claim this pack makes about another pack (see CompatClaim). */
export interface PackCompat {
  /** The other pack's id. Its absence is never an error - claims are about what IS installed. */
  with: string;
  /**
   * Semver range the claim is limited to, so a claim can name the versions that
   * actually clashed and expire itself when the other mod fixes them. Absent
   * means every version.
   */
  range?: string;
  /** What is being claimed. */
  claim: CompatClaim;
  /**
   * THIS pack's section ids the claim is about; every id must be one of this
   * pack's own `sections`. Absent means the whole pack.
   *
   * Deliberately scoped to the claimant's own sections and not the other mod's:
   * an author knows which of their own parts clashed, and naming a section
   * inside someone else's mod is a guess that goes stale on their next release.
   */
  scope?: string[];
  /**
   * Why, in the author's words. REQUIRED: this is the sentence the player reads
   * when deciding whether to care, and a claim with no reason is one they cannot
   * evaluate - it becomes a warning that is always there and never actionable,
   * which is how a conflict list turns into wallpaper.
   */
  because: string;
}

/**
 * The sorting groups, earliest to latest. A pack names one in `group`.
 *
 * WHY GROUPS AND NOT ONLY PAIRWISE HINTS. `loadAfter`/`loadBefore` require an
 * author to have heard of the other mod. That does not scale, and LOOT is the
 * proof: its pairwise rules need a hand-maintained community masterlist, while
 * its GROUPS let a plugin be sorted correctly against plugins that did not exist
 * when it was written. Declaring "I am a cosmetic pack" orders you against every
 * present and future overhaul for free.
 *
 * Kept a flat total order rather than LOOT's group-graph: the graph buys the
 * ability to insert a group between two others without renumbering, and costs a
 * second cycle-detection problem on top of the pack graph. A short fixed list
 * that the engine versions is easier to reason about and sufficient.
 *
 * Group edges are SOFT. When a group would contradict a hard dependency the group
 * edge loses - the same rule LOOT settled on, and for the same reason: the
 * alternative is a cyclic-interaction error that neither author can fix.
 */
export const PACK_GROUPS: readonly string[] = [
  "framework", // libraries other mods depend on
  "overhaul", // large changes to the base game
  "content", // new monsters, items, levels
  "gameplay", // rule and balance changes
  "tweaks", // small corrections and quality of life
  "interface", // display, input, menus
  "cosmetic", // tiles, colours, text
  "late", // anything that must see everyone else's result
];

/** The group a pack with no `group` is sorted as. */
export const DEFAULT_PACK_GROUP = "content";

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
/**
 * What a mod's repository contributes to its installed folder.
 *
 * Paths are relative to the repository root AND to the mod folder - the two are
 * the same shape, which is what lets a mod be a checkout, a zip, or an install
 * without changing anything about it.
 *
 * TWO KINDS BECAUSE THE SIZES DIFFER BY THREE ORDERS OF MAGNITUDE. A code mod is
 * a manifest and a script; listing them is clearer. A converted tile pack is
 * thousands of files, where listing them would mean thousands of requests, so it
 * travels as committed archives that are unpacked on arrival.
 *
 * Nothing here is trusted as a path. The installer re-checks every entry - and
 * every path that comes OUT of an archive, which is attacker-controlled in a way
 * a declared list is not - before anything is written.
 */
export interface PackPayload {
  /** Committed files, stored as they are. */
  files?: string[];
  /** Committed zips, UNPACKED into the mod folder. */
  archives?: string[];
}

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
  /**
   * Source material for a Linoleum pack generated locally the first time the
   * player selects it. `path` is the compact source directory; the generated
   * loose files live in the host's cache, never alongside the downloaded art.
   */
  tilesheet?: LinoleumTilesheetSource;
}

/** The compact input to Linoleum's on-demand tilesheet converter. */
export interface LinoleumTilesheetSource {
  /** Stable pack key, used to partition generated cache entries. */
  key: string;
  /** The id written into the generated loose pack's manifest.txt. */
  packId: string;
  /** The display name written into the generated loose pack's manifest.txt. */
  displayName: string;
  /** Bump whenever any compact source input changes, invalidating its cache. */
  cacheKey: string;
  /** PNG path relative to this tile pack's `path`. */
  image: string;
  /** The legacy .prf files, relative to this tile pack's `path`. */
  prefFiles: string[];
  /** Nominal output resolution and images/<resolution>/ directory name. */
  resolution: number;
  tileWidth?: number;
  tileHeight?: number;
  overdrawRow?: number;
  overdrawMax?: number;
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
   * Fields this pack introduces onto core's records - its own vocabulary.
   *
   * Declared BARE and written NAMESPACED: a pack `mymod` declaring `bleed` owns
   * the key `"mymod:bleed"`, and that is what appears in a patch and on the
   * bound record's `ext`. Anything namespaced that nothing declares is stripped
   * at composition and reported by name; see fields.ts for why the namespace is
   * the rule rather than a convention.
   */
  fields?: FieldDecl[];
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
   * A rule flag this pack used to declare -> its current `rules` flag. The host
   * consumes an old saved player choice when it loads the enabled pack, folding
   * several old choices that name one current rule with OR. A destination must
   * be one of this manifest's current rules; an old flag is deliberately not,
   * because it is the retired spelling this field replaces.
   */
  renamedRuleFlags?: Record<string, string>;
  /**
   * Named parts of this pack (see PackSection): what a player can switch off
   * individually, what a section band can reposition, and what a compatibility
   * claim can point at. Absent means the pack is one indivisible part.
   */
  sections?: PackSection[];
  /**
   * Which sorting group this pack belongs to (see PACK_GROUPS). Absent means
   * DEFAULT_PACK_GROUP, so a pack that says nothing still sorts sensibly against
   * packs that do.
   */
  group?: string;
  /**
   * What this pack claims about OTHER packs (see PackCompat). Never binding: the
   * sorter treats ordering claims as preferences it may drop, and `conflicts`
   * produces a warning the player can walk past.
   */
  compat?: PackCompat[];
  /**
   * Graphics modes this pack contributes (see PackTilePack). Only read for a pack
   * with the `tiles` facet; a content pack that declares them contributes none.
   */
  tilePacks?: PackTilePack[];
  /**
   * Sounds, fonts, pref files, help pages and art this pack supplies (see
   * PackResource and resources.ts).
   *
   * SEPARATE FROM `tilePacks` and staying that way. Tiles carry three fields no
   * other category has - the catalog serial they render as, which renderer draws
   * them, and their Graphics-menu label - so folding them in would widen every
   * entry with fields six kinds cannot use, and narrowing them into this shape
   * would break every tiles mod already published. One array with a `kind` is
   * the right shape for the six categories that had NO field at all; it is not
   * the right shape for the one that has a good one.
   */
  resources?: PackResource[];
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
  /**
   * Which of the repository's files ARE the mod (see PackPayload).
   *
   * The game learns a mod from its own repository - it ships no catalogue of what
   * mods exist or what they contain - so something has to say which committed
   * files belong in the installed mod folder and which are the scaffolding that
   * built them. A repository that says nothing still installs: the installer
   * falls back to the whole tree minus build scaffolding, which is right for a
   * mod that is a manifest and a script and knows nothing about this field.
   *
   * Declare it when that guess would be wrong or wasteful - and ALWAYS when the
   * payload includes archives, because nothing can infer that a committed .zip
   * wants unpacking rather than storing.
   */
  payload?: PackPayload;
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
  if (m["fields"] !== undefined) {
    if (!Array.isArray(m["fields"])) {
      throw new ManifestError(`manifest ${id}: fields must be an array`);
    }
    const seen = new Set<string>();
    for (const raw of m["fields"] as unknown[]) {
      if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
        throw new ManifestError(`manifest ${id}: each field must be an object`);
      }
      const f = raw as Record<string, unknown>;
      const name = f["name"];
      /* A COLON IN THE DECLARED NAME would produce "mymod:other:thing" and put
       * the field in a namespace the declaring pack does not own. Refused here
       * rather than silently accepted, because the resulting key would then
       * never resolve and the author would have no way to see why. */
      if (typeof name !== "string" || name === "" || name.includes(":")) {
        throw new ManifestError(
          `manifest ${id}: field name must be a non-empty string with no ":" ` +
            `(the namespace is added for you: "${id}:<name>")`,
        );
      }
      if (seen.has(name)) {
        throw new ManifestError(`manifest ${id}: field "${name}" declared twice`);
      }
      seen.add(name);
      const files = f["files"];
      if (
        !Array.isArray(files) ||
        files.length === 0 ||
        files.some((x) => typeof x !== "string" || x === "")
      ) {
        throw new ManifestError(
          `manifest ${id}: field "${name}" must list the record files it may ` +
            `appear on, e.g. "files": ["object", "ego_item"]`,
        );
      }
      const type = f["type"];
      if (type !== undefined && !FIELD_TYPES.includes(type as FieldType)) {
        throw new ManifestError(
          `manifest ${id}: field "${name}" has type "${String(type)}"; ` +
            `expected one of ${FIELD_TYPES.join(", ")}`,
        );
      }
      for (const key of ["label", "desc"] as const) {
        if (f[key] !== undefined && typeof f[key] !== "string") {
          throw new ManifestError(`manifest ${id}: field "${name}" ${key} must be a string`);
        }
      }
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
  const ruleFlags = validateRules(m["rules"], id);
  validateRenamedRuleFlags(m["renamedRuleFlags"], id, ruleFlags);
  const sectionIds = validateSections(m["sections"], id, ruleFlags);
  validateGroup(m["group"], id);
  validateCompat(m["compat"], id, sectionIds);
  validateTilePacks(m["tilePacks"], id);
  validateResources(m["resources"], id);
  validatePayload(m["payload"], id);
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

/**
 * Validate the optional `rules` array (PackRule[]); returns the flags it
 * declares so validateSections can refuse a section that reuses one.
 */
function validateRules(value: unknown, id: string): Set<string> {
  if (value === undefined) return new Set();
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
  return seen;
}

/**
 * Validate the optional old-rule-flag -> current-rule-flag map. The source is
 * intentionally not a current rule: if it still were, treating its stored
 * choice as retired would destroy the setting for a rule the manifest exposes.
 */
function validateRenamedRuleFlags(
  value: unknown,
  id: string,
  ruleFlags: ReadonlySet<string>,
): void {
  if (value === undefined) return;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ManifestError(`manifest ${id}: renamedRuleFlags must be a map`);
  }
  for (const [oldFlag, newFlag] of Object.entries(value)) {
    if (oldFlag === "") {
      throw new ManifestError(`manifest ${id}: renamedRuleFlags old flag must be non-empty`);
    }
    if (typeof newFlag !== "string" || newFlag === "") {
      throw new ManifestError(
        `manifest ${id}: renamedRuleFlags ${oldFlag} must name a non-empty current rule flag`,
      );
    }
    if (oldFlag === newFlag) {
      throw new ManifestError(
        `manifest ${id}: renamedRuleFlags ${oldFlag} cannot rename a flag to itself`,
      );
    }
    if (ruleFlags.has(oldFlag)) {
      throw new ManifestError(
        `manifest ${id}: renamedRuleFlags ${oldFlag} is still declared as a current rule`,
      );
    }
    if (!ruleFlags.has(newFlag)) {
      throw new ManifestError(
        `manifest ${id}: renamedRuleFlags ${oldFlag} targets ${newFlag}, which is not a declared rule`,
      );
    }
  }
}

/**
 * Validate the optional `sections` array (PackSection[]); returns the declared
 * section ids so validateCompat can check every `scope` against them.
 *
 * Rejects a duplicate FLAG as well as a duplicate id, and checks the flags a
 * section exposes against the ones `rules` already declares. Both vocabularies
 * reach the mod's hooks.ts through one flag map, so a collision between them
 * would silently give one name two meanings inside the mod's own code.
 */
function validateSections(
  value: unknown,
  id: string,
  ruleFlags: ReadonlySet<string>,
): Set<string> {
  const ids = new Set<string>();
  if (value === undefined) return ids;
  if (!Array.isArray(value)) {
    throw new ManifestError(`manifest ${id}: sections must be an array`);
  }
  const flags = new Set<string>(ruleFlags);
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new ManifestError(`manifest ${id}: each section must be an object`);
    }
    const s = entry as Record<string, unknown>;
    if (typeof s["id"] !== "string" || !ID_RE.test(s["id"])) {
      throw new ManifestError(
        `manifest ${id}: section id must be lowercase kebab-case, got ${String(s["id"])}`,
      );
    }
    const sid = s["id"];
    if (ids.has(sid)) {
      throw new ManifestError(`manifest ${id}: duplicate section id ${sid}`);
    }
    ids.add(sid);
    if (typeof s["title"] !== "string" || s["title"].length === 0) {
      throw new ManifestError(
        `manifest ${id}: section ${sid} title must be a non-empty string`,
      );
    }
    if (s["description"] !== undefined && typeof s["description"] !== "string") {
      throw new ManifestError(`manifest ${id}: section ${sid} description must be a string`);
    }
    if (s["default"] !== undefined && typeof s["default"] !== "boolean") {
      throw new ManifestError(`manifest ${id}: section ${sid} default must be a boolean`);
    }
    if (
      s["priority"] !== undefined &&
      !SECTION_BANDS.includes(s["priority"] as SectionBand)
    ) {
      throw new ManifestError(
        `manifest ${id}: section ${sid} priority must be one of ${SECTION_BANDS.join(", ")}, got ${String(s["priority"])}`,
      );
    }
    if (s["flag"] !== undefined && (typeof s["flag"] !== "string" || s["flag"].length === 0)) {
      throw new ManifestError(
        `manifest ${id}: section ${sid} flag must be a non-empty string`,
      );
    }
    validateRenamedSectionFlags(s["renamedSectionFlags"], id, sid);
    const flag = (s["flag"] as string | undefined) ?? sid;
    if (flags.has(flag)) {
      /* Names the OTHER declaration, because "duplicate flag" alone sends an
       * author looking through their sections when the clash is with a rule. */
      const clash = ruleFlags.has(flag) ? "a rule" : "another section";
      throw new ManifestError(
        `manifest ${id}: section ${sid} exposes the flag ${flag}, which ${clash} already declares`,
      );
    }
    flags.add(flag);
  }
  return ids;
}

/**
 * Validate the optional retired-flag list on one current section. Unlike
 * `renamedRuleFlags`, the destination is inherent in the containing section,
 * and every source may have been either a rule or a section (including this
 * section's current flag during a rule-to-section migration).
 */
function validateRenamedSectionFlags(value: unknown, id: string, sectionId: string): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    throw new ManifestError(`manifest ${id}: section ${sectionId} renamedSectionFlags must be an array`);
  }
  const seen = new Set<string>();
  for (const oldFlag of value) {
    if (typeof oldFlag !== "string" || oldFlag.length === 0) {
      throw new ManifestError(
        `manifest ${id}: section ${sectionId} renamedSectionFlags entries must be non-empty strings`,
      );
    }
    if (seen.has(oldFlag)) {
      throw new ManifestError(
        `manifest ${id}: section ${sectionId} renamedSectionFlags repeats ${oldFlag}`,
      );
    }
    seen.add(oldFlag);
  }
}

/** Validate the optional `group` field against PACK_GROUPS. */
function validateGroup(value: unknown, id: string): void {
  if (value === undefined) return;
  if (typeof value !== "string" || !PACK_GROUPS.includes(value)) {
    /* Refused rather than coerced to the default, for the reason tilePacks
     * records: a typo that silently becomes "content" is a mod that sorts wrong
     * with no error anywhere. A pack targeting a group a newer engine added
     * states that with `engine`, which is what that field is for. */
    throw new ManifestError(
      `manifest ${id}: group must be one of ${PACK_GROUPS.join(", ")}, got ${String(value)}`,
    );
  }
}

/** Validate the optional `compat` array (PackCompat[]); throws ManifestError. */
function validateCompat(value: unknown, id: string, sectionIds: ReadonlySet<string>): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    throw new ManifestError(`manifest ${id}: compat must be an array`);
  }
  for (const entry of value) {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new ManifestError(`manifest ${id}: each compat entry must be an object`);
    }
    const c = entry as Record<string, unknown>;
    if (typeof c["with"] !== "string" || !ID_RE.test(c["with"])) {
      throw new ManifestError(
        `manifest ${id}: compat "with" must be a pack id, got ${String(c["with"])}`,
      );
    }
    const other = c["with"];
    if (other === id) {
      throw new ManifestError(`manifest ${id}: compat entry claims against itself`);
    }
    if (!COMPAT_CLAIMS.includes(c["claim"] as CompatClaim)) {
      throw new ManifestError(
        `manifest ${id}: compat with ${other} claim must be one of ${COMPAT_CLAIMS.join(", ")}, got ${String(c["claim"])}`,
      );
    }
    if (typeof c["because"] !== "string" || c["because"].length === 0) {
      throw new ManifestError(
        `manifest ${id}: compat with ${other} needs a "because" - the reason the player reads`,
      );
    }
    if (c["range"] !== undefined && typeof c["range"] !== "string") {
      throw new ManifestError(`manifest ${id}: compat with ${other} range must be a string`);
    }
    if (c["scope"] === undefined) {
      if (c["claim"] === "patches") {
        /* A `patches` claim with nothing to enable is the whole mod becoming
         * conditional on another mod, which is what `dependencies` already says
         * properly - and says with a version check the sorter can act on. */
        throw new ManifestError(
          `manifest ${id}: compat with ${other} claims "patches" but names no scope; use dependencies to make the whole pack conditional`,
        );
      }
      continue;
    }
    const scope = c["scope"];
    if (!Array.isArray(scope) || scope.some((s) => typeof s !== "string")) {
      throw new ManifestError(
        `manifest ${id}: compat with ${other} scope must be an array of this pack's section ids`,
      );
    }
    for (const s of scope as string[]) {
      if (!sectionIds.has(s)) {
        throw new ManifestError(
          `manifest ${id}: compat with ${other} scopes "${s}", which is not one of this pack's sections`,
        );
      }
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
 * `mods/<id>/mods/<id>/...` and 404 into ASCII with nothing said. An absolute path, a
 * scheme, or a `..` escape is refused for the same reason a pack's code files are
 * read by pack-relative path: the host decides where a mod's bytes live.
 */
/**
 * `payload`: two optional string arrays, at least one of them non-empty.
 *
 * An empty or all-empty payload is rejected rather than treated as "fall back to
 * the tree", because those two mean opposite things and only one of them is what
 * an author who typed the field wanted. Absent means fall back; present means
 * "this, exactly", and a mod that declares exactly nothing has declared a mod
 * with no files in it.
 *
 * Path SAFETY is not checked here. The installer checks every path it is about to
 * write, and it has to anyway for archive contents, so a second half-check in the
 * schema would be the kind of duplicated rule where only one copy learns.
 */
function validatePayload(value: unknown, id: string): void {
  if (value === undefined) return;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ManifestError(`manifest ${id}: payload must be an object`);
  }
  const p = value as Record<string, unknown>;
  let count = 0;
  for (const key of ["files", "archives"] as const) {
    const list = p[key];
    if (list === undefined) continue;
    if (!Array.isArray(list)) {
      throw new ManifestError(`manifest ${id}: payload.${key} must be an array`);
    }
    for (const entry of list) {
      if (typeof entry !== "string" || entry === "") {
        throw new ManifestError(
          `manifest ${id}: payload.${key} entries must be non-empty strings`,
        );
      }
    }
    count += list.length;
  }
  if (count === 0) {
    throw new ManifestError(
      `manifest ${id}: payload names no files - omit it to install the whole ` +
        `repository minus build scaffolding`,
    );
  }
}

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
    if (p["path"] !== undefined) {
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
    validateLinoleumTilesheet(p["tilesheet"], id);
  }
}

/** Validate one optional on-demand Linoleum source declaration. */
function validateLinoleumTilesheet(value: unknown, id: string): void {
  if (value === undefined) return;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ManifestError(`manifest ${id}: tilePacks tilesheet must be an object`);
  }
  const source = value as Record<string, unknown>;
  for (const key of ["key", "packId", "displayName", "cacheKey", "image"] as const) {
    if (typeof source[key] !== "string" || source[key] === "") {
      throw new ManifestError(`manifest ${id}: tilePacks tilesheet.${key} must be a non-empty string`);
    }
  }
  if (!Array.isArray(source["prefFiles"]) || source["prefFiles"].length === 0 || source["prefFiles"].some((file) => typeof file !== "string" || file === "")) {
    throw new ManifestError(`manifest ${id}: tilePacks tilesheet.prefFiles must be an array of non-empty strings`);
  }
  if (typeof source["resolution"] !== "number" || !Number.isInteger(source["resolution"]) || source["resolution"] <= 0) {
    throw new ManifestError(`manifest ${id}: tilePacks tilesheet.resolution must be a positive integer`);
  }
  for (const key of ["tileWidth", "tileHeight", "overdrawRow", "overdrawMax"] as const) {
    const number = source[key];
    if (number !== undefined && (typeof number !== "number" || !Number.isInteger(number) || number < 0)) {
      throw new ManifestError(`manifest ${id}: tilePacks tilesheet.${key} must be a non-negative integer`);
    }
  }
  for (const path of [source["image"], ...(source["prefFiles"] as unknown[])]) {
    if (typeof path !== "string" || /^([a-z][a-z0-9+.-]*:)?\//iu.test(path) || path.startsWith("\\") || path.split(/[/\\]/u).includes("..")) {
      throw new ManifestError(`manifest ${id}: tilePacks tilesheet files must stay inside the tile pack`);
    }
  }
}

/**
 * Validate the optional `resources` array (PackResource[]); throws ManifestError.
 *
 * THE RULE ITSELF IS NOT HERE. `resourceComplaint` in resources.ts holds it, and
 * this only decides that a complaint is fatal at THIS door. The mod builder
 * calls the same function and prints; the game calls it and puts the sentence on
 * the mod's row. One rule, three audiences - which is the shape gap 12 arrived
 * at the hard way, after a checker that existed had exactly one caller.
 */
function validateResources(value: unknown, id: string): void {
  if (value === undefined) return;
  if (!Array.isArray(value)) {
    throw new ManifestError(`manifest ${id}: resources must be an array`);
  }
  for (const entry of value) {
    const complaint = resourceComplaint(entry, id);
    if (complaint !== null) throw new ManifestError(complaint);
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
