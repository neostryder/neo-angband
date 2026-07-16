/**
 * @neo-angband/linoleum
 *
 * Tools for building Linoleum loose-pack tile sets from the bundled legacy
 * tilesheets. Ported from the original PowerShell implementation
 * (build-linoleum-packs.ps1) so users can convert the bundled graphics for
 * themselves; converted packs are not redistributed with the port.
 */

export { LINOLEUM_TOOLS_VERSION } from "./version.js";
export {
  parseLegacySelectorLine,
  readLegacySelectors,
  removeLegacyInlineComment,
} from "./prf.js";
export type { LegacySelector, PrefSource } from "./prf.js";
export { deterministicAssetName, selectorKey, stableHashHex } from "./naming.js";
export { ALL_PACKS, selectPacks } from "./packs.js";
export type { PackConfig } from "./packs.js";
export {
  buildPackExport,
  compatibilityVariantRank,
  convertPacks,
  effectProfileFor,
  selectCompatibilityEntry,
  sourceTileRectangle,
  writeInventoryMarkdown,
} from "./convert.js";
export type {
  ConvertOptions,
  ConvertSummary,
  EffectProfile,
  ExportEntry,
  PackAuthoring,
  PackResult,
} from "./convert.js";
export {
  formatPoolLines,
  formatTargetRule,
  parsePoolsFile,
  parseTargetLine,
  parseTargetsFile,
  selectPoolMember,
} from "./targets.js";
export type {
  PoolDefinition,
  PoolGridContext,
  PoolSelection,
  TargetKind,
  TargetRule,
} from "./targets.js";
