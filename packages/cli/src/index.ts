/**
 * @rpgm-tools/neo-angband-cli - terminal front-end and developer harness.
 *
 * Serves the same role as upstream's main-gcu (play in a terminal) plus
 * main-test/main-stats (scripted golden scenarios and Monte-Carlo
 * statistics for parity verification). The stats harness lands early
 * (Phase 2) because it is load-bearing for parity checks.
 */

export { ENGINE_VERSION, PARITY_BASELINE } from "@rpgm-tools/neo-angband-core";

/** Content-pack loader shared by the harnesses. */
export { loadGamePack } from "./pack.js";

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
} from "./stats.js";
export type { DepthMetrics, StatsParams, StatsReport } from "./stats.js";

/**
 * In-game wizard collectors (wiz-stats.c via do_cmd_wiz_collect_*), reachable
 * from main-stats --wiz-objmon / --wiz-pits / --wiz-disconnect (W2-017…022).
 */
export {
  DEFAULT_DISCONNECT_PARAMS,
  DEFAULT_OBJ_MON_PARAMS,
  DEFAULT_PIT_PARAMS,
  disconnectStats,
  objMonStats,
  pitStats,
} from "./wiz-stats.js";
export type {
  DisconnectStatsParams,
  DisconnectStatsReport,
  ObjMonStatsParams,
  ObjMonStatsReport,
  PitStatsParams,
  PitStatsReport,
} from "./wiz-stats.js";
export { runWizStats } from "./main-stats.js";

/** Baseline capture + tolerance comparison (the CI regression guard). */
export {
  BASELINE_URL,
  EXACT_TOLERANCE,
  STATISTICAL_TOLERANCE,
  compareReports,
  formatCompareResult,
  loadBaseline,
  writeBaseline,
} from "./baseline.js";
export type {
  CompareOptions,
  CompareResult,
  Diff,
  Tolerance,
} from "./baseline.js";

/** Golden-scenario runner (main-test.c analog). */
export { formatScenarioResults, runScenarios } from "./scenarios.js";
export type { ScenarioResult } from "./scenarios.js";
