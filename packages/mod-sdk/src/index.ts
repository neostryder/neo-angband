/**
 * @neo-angband/mod-sdk - schemas and tooling for the mod ecosystem.
 *
 * Three pack shapes, one loading pipeline (see docs/MODS.md):
 * - content packs: schema-validated declarative JSON (safe by construction)
 * - tile packs: Linoleum-style manifests with individual images and
 *   exact named targets, honest glyph fallback for uncovered targets
 * - scripted plugins: capability-scoped sandboxed scripts (escape hatch)
 */

/** Pack identifiers are namespaced: "<pack>:<id>", e.g. "core:kobold". */
export type PackRef = `${string}:${string}`;
