/**
 * The ONE place the Borg reaches into the engine for a runtime value.
 *
 * WHY THIS FILE EXISTS, and it is not tidiness. The Borg's destination is its own
 * mod repository, and the mod builder REFUSES a plugin that bundles a copy of the
 * engine: a second `@rpgm-tools/neo-angband-core` inside the plugin would give it
 * its own registries while the game ran on another set, and the two would agree
 * right up until they did not. A mod receives the live engine as `ctx.core`
 * instead.
 *
 * Which means every bare `import ... from "@rpgm-tools/neo-angband-core"` in this
 * package is a line that has to change on the way out. Measured 2026-08-01: 37
 * files mention the package and **28 of those are `import type`**, which compiles
 * to nothing and can stay exactly as it is. The runtime coupling was six symbols
 * across eight files.
 *
 * They now come through here, so the extraction replaces ONE file rather than
 * eight - this one, re-exporting from `ctx.core` instead of from a specifier.
 * `packages/borg/src/core-import-census.test.ts` is what keeps that true: it
 * fails if a second file grows a value import.
 *
 * Type-only imports are deliberately NOT funnelled. They are erased, they cost
 * the mod nothing, and routing them through here would hide which engine types
 * each module actually speaks in.
 */

export {
  FEAT,
  MON_RACE_FLAG_ENTRIES,
  MON_SPELL_ENTRIES,
  RSF,
  Rng,
  TV,
} from "@rpgm-tools/neo-angband-core";
