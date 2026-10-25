/**
 * The query string the desktop shell puts on the renderer's address.
 *
 * Two things travel this way. `NEO_ANGBAND_AGENT` becomes `agent=<id>`
 * (agent-mode.ts), and the `--safe-mode` switch becomes `safe=1`, which starts
 * the game with every mod off for that session (the web package's
 * safe-launch.ts). A `--` switch never reaches the game's own option parser,
 * since commandLine() in main.ts strips them, so this is the only reader.
 *
 * In its own module rather than in main.ts because main.ts imports `electron`
 * and cannot be loaded by a test.
 */

import { agentQuery } from "./agent-mode.js";

export const SAFE_MODE_SWITCH = "--safe-mode";
/** `--lab-trust=qol,squire`: lab builds only, see the web package's lab-trust.ts. */
export const LAB_TRUST_SWITCH = "--lab-trust=";

declare const __NEO_LAB_BUILD__: boolean | undefined;

/** True only when this shell was bundled with `NEO_ANGBAND_LAB_BUILD=1`. */
export function labShell(): boolean {
  return typeof __NEO_LAB_BUILD__ === "boolean" && __NEO_LAB_BUILD__;
}

/** `?agent=<id>&safe=1&labtrust=<ids>`, any part, or `""` for an ordinary launch. */
export function rendererQuery(argv: readonly string[], env: NodeJS.ProcessEnv = process.env, lab: boolean = labShell()): string {
  const params = new URLSearchParams(agentQuery(env));
  if (argv.includes(SAFE_MODE_SWITCH)) params.set("safe", "1");
  const trusted = argv.find((arg) => arg.startsWith(LAB_TRUST_SWITCH));
  if (lab && trusted !== undefined && trusted.length > LAB_TRUST_SWITCH.length) params.set("labtrust", trusted.slice(LAB_TRUST_SWITCH.length));
  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}
