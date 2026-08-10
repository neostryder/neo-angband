/**
 * @rpgm-tools/neo-angband-mod-sdk - schemas and tooling for the mod ecosystem.
 *
 * Three pack shapes, one loading pipeline (see docs/MODS.md):
 * - content packs: declarative JSON, checked against core's own record shapes
 *   at load AND at build (validate.ts). Safe by construction in the sense that
 *   matters - it is data, so it cannot execute - and CHECKED rather than
 *   trusted for the rest. The check reports and never refuses: the shapes are
 *   measured from core's data, and a mod coining a new value is doing something
 *   legal. This line used to say "schema-validated" flatly, and MOD_REACH gap 12
 *   recorded that as a claim with no code behind it. Half true: the checker
 *   existed and only the BUILDER called it, so nothing checked a mod a player
 *   installed. Do not weaken this wording without moving the caller.
 * - tile packs: Linoleum-style manifests with individual images and
 *   exact named targets, honest glyph fallback for uncovered targets
 * - scripted plugins: capability-scoped sandboxed scripts (escape hatch)
 *
 * This package holds the pack-agnostic machinery: manifests, the
 * deterministic load-order resolver, and the record composition engine
 * (add/patch/replace/remove with ownership rules and provenance). The
 * base game composes through this exact pipeline as pack zero.
 */

export {
  COMPAT_CLAIMS,
  DEFAULT_PACK_GROUP,
  hasFacet,
  PACK_GROUPS,
  PACK_SHAPES,
  ManifestError,
  packFacets,
  packRef,
  SECTION_BANDS,
  slugify,
  validateManifest,
} from "./manifest.js";
export {
  ART_SLOTS,
  chooseResources,
  extensionOf,
  RESOURCE_KIND_NAMES,
  RESOURCE_KINDS,
  resourceComplaint,
  resourcesOfKind,
} from "./resources.js";
export type {
  ContributedResource,
  PackResource,
  ResourceKind,
  ResourceKindSpec,
  ResourceMerge,
} from "./resources.js";
export type {
  Capability,
  CompatClaim,
  PackCompat,
  PackManifest,
  PackPayload,
  PackRef,
  PackRule,
  PackSection,
  PackShape,
  PackTilePack,
  SectionBand,
} from "./manifest.js";
export { ResolveError, resolveLoadOrder } from "./resolve.js";
export {
  expandedPackContents,
  expandSections,
  resolveSectionState,
  sectionFlag,
} from "./sections.js";
export type { SectionUnit } from "./sections.js";
export { collectSortEdges, SORT_TIERS, sortModOrder } from "./sort.js";
export type { DroppedEdge, SortEdge, SortPin, SortResult, SortTier } from "./sort.js";
export {
  contestedSlots,
  describeContested,
  describeDeclaredConflict,
  foldDiscards,
} from "./contested.js";
export type {
  Claim,
  ContestedLayer,
  ContestedSlot,
  DeclaredConflict,
  Fold,
  NameOf,
} from "./contested.js";
export { compareSemver, satisfies, SemverError } from "./semver.js";
export { engineVerdict } from "./engine.js";
export type { EngineVerdict } from "./engine.js";
export { ComposeError, composePacks, mergePatch, RENAMED_HINT } from "./compose.js";
export { composeContentPacks, composeDroppingBroken } from "./loader.js";
export type { ComposedContent, ComposeFault, DroppedPack, LoadedPack } from "./loader.js";
export {
  KEYED_RECORD_FILES,
  keyDescription,
  keySpecFor,
  legacyRecordKey,
  RECORD_KEY_SPECS,
  recordKey,
  recordRefKeys,
} from "./record-key.js";
export type { RecordKeySpec } from "./record-key.js";
export type {
  ComposedRecord,
  ComposePacksOptions,
  FileContribution,
  JsonRecord,
  JsonValue,
  PackContent,
} from "./compose.js";
export {
  applyFieldPatch,
  composeFieldPatches,
  PatchError,
  touchedFields,
} from "./patch.js";
export type {
  ComposedPatch,
  FieldConflict,
  FieldOp,
  FieldPatch,
} from "./patch.js";
export { computeConflictReport } from "./conflicts.js";
export type {
  ConflictReport,
  FieldTouch,
  RecordConflict,
  RecordOverride,
} from "./conflicts.js";
export { CapabilityError, CapabilitySet, parseCapability } from "./capabilities.js";
export type { ParsedCapability } from "./capabilities.js";
export {
  MANIFEST_FILE,
  MOD_REQUIREMENTS,
  PLUGIN_FILE,
  checkMod,
  githubRepo,
  requirementsMarkdown,
} from "./standards.js";
export type {
  CheckReport,
  Finding,
  ModUnderTest,
  Requirement,
  RequirementLevel,
} from "./standards.js";
export * from "./fields.js";
export { RECORD_BLUEPRINTS } from "./blueprints.js";
export type { FieldShape, RecordBlueprint } from "./blueprints.js";
export {
  danglingReferences,
  normalizeRef,
  REFERENCE_EDGES,
  valuesAtPath,
} from "./references.js";
export type { DanglingReference, ReferenceEdge, RefNormalize } from "./references.js";
export {
  BLUEPRINT_FILES,
  blueprintFor,
  checkRecords,
  COMPANION_RULES,
  describeFile,
  draftRecord,
  fieldUsage,
  peersFor,
  requiredFields,
  suggestFields,
  templateRecord,
} from "./authoring.js";
export type {
  AuthoringFinding,
  CheckOptions,
  CompanionRule,
  DraftedRecord,
  FieldUsage,
  FindingLevel,
  PeerSet,
  Suggestion,
  TemplateScope,
} from "./authoring.js";
export { checkPacks, composedObjects, packSubject } from "./validate.js";
export type {
  CheckablePack,
  CheckPacksOptions,
  ComposedRecords,
  PackFinding,
} from "./validate.js";
export { ModProject, modProject } from "./project.js";
export type { EmittedFile, ProjectBuild } from "./project.js";
