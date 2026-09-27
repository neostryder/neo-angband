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
  color,
  defineFormat,
  DocumentValidationError,
  json,
  keyInput,
  listFormats,
  parseDocument,
  serializeDocument,
  utcTimestamp,
} from "./json/index.js";
export type {
  DocumentResult,
  FormatDefinition,
  FormatTag,
  Infer,
  Migration,
  OptionalValidator,
  ValidationIssue,
  ValidationResult,
  Validator,
} from "./json/index.js";
export { customOptionsFormat } from "./json/custom-options.js";
export { loreFormat } from "./json/lore.js";
export {
  linoleumInventoryFormat,
  linoleumPackFormat,
  linoleumTileMapFormat,
} from "./json/linoleum.js";
export { randartFormat } from "./json/randart.js";
export { windowStateFormat } from "./json/window-state.js";
export { keymapFormat } from "./json/keymaps.js";
export { GAMEPAD_ROLE_IDS, gamepadBindingsFormat, gamepadTarget } from "./json/gamepad-bindings.js";
export { COLOR_PREF_IDS, colorTableFormat } from "./json/color-table.js";
export { layoutNode, SUBWINDOW_LAYOUT_IDS, subwindowLayoutFormat } from "./json/subwindow-layout.js";
export type { LayoutNodeData, LayoutTileId } from "./json/subwindow-layout.js";
export { visualOverrideFormat } from "./json/visual-overrides.js";
export { soundMappingFormat } from "./json/sound-mappings.js";
export { autoinscriptionFormat } from "./json/autoinscriptions.js";
export { entryRendererFormat } from "./json/entry-renderers.js";
export {
  ACTIVE_STORAGE_KEY,
  activeSlotFormat,
  activeSlotFromLegacy,
  LEGACY_ACTIVE_STORAGE_KEY,
} from "./json/active-slot.js";
export type { ActiveSlot } from "./json/active-slot.js";
export { characterExportFormat } from "./json/character-export.js";
export type { CharacterExport, CharacterExportMeta } from "./json/character-export.js";
export { characterFromLegacy, epochFromTimestamp, timestampFromEpoch } from "./json/character-record.js";
export type { CharacterRecord } from "./json/character-record.js";
export {
  LEGACY_ROSTER_STORAGE_KEY,
  ROSTER_STORAGE_KEY,
  rosterFormat,
  rosterFromLegacy,
} from "./json/character-roster.js";
export type { CharacterRoster } from "./json/character-roster.js";
export {
  DEATHS_STORAGE_KEY,
  deathRecordsFormat,
  deathsFromLegacy,
  LEGACY_DEATHS_STORAGE_KEY,
} from "./json/death-records.js";
export type { DeathRecordDocument, DeathRecords } from "./json/death-records.js";
export {
  LEGACY_ORPHAN_STORAGE_KEY,
  ORPHAN_STORAGE_KEY,
  orphanSavesFormat,
  orphansFromLegacy,
} from "./json/orphan-saves.js";
export type { OrphanRecord, OrphanRecords } from "./json/orphan-saves.js";
export { isSavedGameHeader, savedGameFormat } from "./json/saved-game.js";
export { windowManagerFormat } from "./json/window-manager.js";

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
  localeFileComplaint,
  localeFileTag,
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
  LinoleumTilesheetSource,
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
export { engineVerdict, newerGameCouldRun } from "./engine.js";
export type { EngineVerdict } from "./engine.js";
export { ComposeError, composePacks, mergePatch, RENAMED_HINT } from "./compose.js";
export { composeContentPacks, composeDroppingBroken } from "./loader.js";
export type { ComposedContent, ComposeFault, DroppedPack, LoadedPack } from "./loader.js";
export { PROVENANCE_KEY, provenanceOf, stampProvenance } from "./provenance.js";
export type { RecordProvenance } from "./provenance.js";
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
/* Named rather than `export *`, and applyFieldPolicy is the name left out. Its
 * provenance and manifest maps are built by composition and reachable no other
 * way, so a public signature could only ever be called without them - which
 * strips undeclared keys, judges no trespass, and returns as if it had. The
 * gate's door is composeContentPacks. See fields.ts. */
export {
  checkUnqualified,
  declaredFields,
  FIELD_TYPES,
  fieldOwner,
  isExtensionKey,
} from "./fields.js";
export type { FieldDecl, FieldFault, FieldType, ResolvedField } from "./fields.js";
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
export type {
  LiveRegion,
  ModRegionLayer,
  RegionCells,
  RegionDeclaration,
  RegionLayer,
  RegionPointer,
  RegionPixels,
  RegionSurface,
  ScreenRegion,
  ScreenRegionName,
  ScreenRegions,
  WorldCell,
  WorldFrame,
  WorldFrameSink,
  WorldGrid,
  WorldLayer,
  WorldLayerKind,
  WorldPlayer,
  WorldRenderAssetRef,
  WorldVisibility,
  WorldVisual,
} from "./frontend.js";
export type {
  HudEntry,
  HudFrame,
  HudOwnership,
  HudPlacement,
  HudRegionName,
  HudRun,
  HudSection,
  HudSectionSink,
  HudValues,
} from "./hud.js";
export type {
  MenuAnswer,
  MenuChoice,
  MenuCommandKey,
  MenuDetailLine,
  MenuPresenter,
  MenuQuestion,
  MenuSemantics,
} from "./menu.js";
export type {
  PromptExtent,
  PromptRequest,
  ScreenAction,
  ScreenArtBlock,
  ScreenBlock,
  ScreenCell,
  ScreenColumn,
  ScreenHost,
  ScreenLinesBlock,
  ScreenPresenter,
  ScreenRow,
  ScreenRun,
  ScreenShown,
  ScreenTableBlock,
  ScreenTextBlock,
  ScreenValues,
  ScreenView,
} from "./screen.js";
