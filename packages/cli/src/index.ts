/**
 * @neo-angband/cli - terminal front-end and developer harness.
 *
 * Serves the same role as upstream's main-gcu (play in a terminal) plus
 * main-test/main-stats (scripted golden scenarios and Monte-Carlo
 * statistics for parity verification). The stats harness lands early
 * (Phase 2) because it is load-bearing for parity checks.
 */

export { ENGINE_VERSION, PARITY_BASELINE } from "@neo-angband/core";

/** Content-pack loader shared by the harnesses. */
export { loadGamePack } from "./pack";

/** Monte-Carlo statistics harness (main-stats.c analog). */
export {
  BASELINE_PARAMS,
  DEFAULT_STATS_PARAMS,
  deriveSeed,
  originName,
  runStatsBatch,
  serializeReport,
  summarizeReport,
  tvalName,
} from "./stats";
export type { DepthMetrics, StatsParams, StatsReport } from "./stats";

/** Baseline capture + tolerance comparison (the CI regression guard). */
export {
  BASELINE_URL,
  EXACT_TOLERANCE,
  STATISTICAL_TOLERANCE,
  compareReports,
  formatCompareResult,
  loadBaseline,
  writeBaseline,
} from "./baseline";
export type {
  CompareOptions,
  CompareResult,
  Diff,
  Tolerance,
} from "./baseline";

/** Golden-scenario runner (main-test.c analog). */
export { formatScenarioResults, runScenarios } from "./scenarios";
export type { ScenarioResult } from "./scenarios";
