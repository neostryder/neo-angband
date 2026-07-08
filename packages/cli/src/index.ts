/**
 * @neo-angband/cli - terminal front-end and developer harness.
 *
 * Serves the same role as upstream's main-gcu (play in a terminal) plus
 * main-test/main-stats (scripted golden scenarios and Monte-Carlo
 * statistics for parity verification). The stats harness lands early
 * (Phase 2) because it is load-bearing for parity checks.
 */

export { ENGINE_VERSION, PARITY_BASELINE } from "@neo-angband/core";
