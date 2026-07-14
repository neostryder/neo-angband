/**
 * @neo-angband/mod-sdk - schemas and tooling for the mod ecosystem.
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

export { ManifestError, packRef, slugify, validateManifest } from "./manifest.js";
export type { Capability, PackManifest, PackRef, PackShape } from "./manifest.js";
export { ResolveError, resolveLoadOrder } from "./resolve.js";
export { ComposeError, composePacks, mergePatch } from "./compose.js";
export type {
  ComposedRecord,
  FileContribution,
  JsonRecord,
  JsonValue,
  PackContent,
} from "./compose.js";
