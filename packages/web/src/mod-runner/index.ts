/**
 * The headless mod runner's entry: run a set of mods under Node and get the
 * report as a document. The command-line script imports this through Vite's
 * module runner, because the loader it drives uses `import.meta.glob`.
 */

import { headlessRunFormat, serializeDocument } from "@rpgm-tools/neo-angband-mod-sdk";
import type { HeadlessRunReport } from "@rpgm-tools/neo-angband-mod-sdk";

export { DEFAULT_RUN_SEED, HEADLESS_RUNNER_TOOL, runHeadless } from "./runner";
export type { HeadlessRunOptions, HeadlessWorkerHost } from "./runner";
export { nodeModsSource } from "./node-source";
export type { NodeModsSource } from "./node-source";

/** The report as a `neo-angband/mod/headless-run` document. */
export function headlessRunDocument(report: HeadlessRunReport): string {
  return serializeDocument(headlessRunFormat, report);
}
