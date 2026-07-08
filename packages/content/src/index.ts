/**
 * @neo-angband/content - the core content pack.
 *
 * Phase 1 builds a compiler that translates reference/lib/gamedata/*.txt
 * (Angband 4.2.6) into the schema-validated pack format defined by
 * @neo-angband/mod-sdk. The base game is itself "pack zero": it loads
 * through the same pipeline as any mod, which is what makes total
 * conversions possible by construction.
 */

/** Namespace prefix reserved for the base game's content. */
export const CORE_NAMESPACE = "core";
