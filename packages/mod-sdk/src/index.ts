/**
 * @rpgm-tools/neo-angband-mod-sdk - schemas and tooling for the mod ecosystem.
 *
 * Three pack shapes, one loading pipeline (see docs/MODS.md):
 * - content packs: schema-validated declarative JSON (safe by construction)
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
export type {
  Capability,
  CompatClaim,
  PackCompat,
  PackManifest,
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
export { ComposeError, composePacks, mergePatch } from "./compose.js";
export { composeContentPacks, composeDroppingBroken } from "./loader.js";
export type { ComposedContent, ComposeFault, DroppedPack, LoadedPack } from "./loader.js";
export {
  KEYED_RECORD_FILES,
  keyDescription,
  keySpecFor,
  RECORD_KEY_SPECS,
  recordKey,
} from "./record-key.js";
export type { RecordKeySpec } from "./record-key.js";
export type {
  ComposedRecord,
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
