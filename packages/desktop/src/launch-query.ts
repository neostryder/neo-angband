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

/** `?agent=<id>&safe=1`, either half, or `""` for an ordinary launch. */
export function rendererQuery(argv: readonly string[], env: NodeJS.ProcessEnv = process.env): string {
  const params = new URLSearchParams(agentQuery(env));
  if (argv.includes(SAFE_MODE_SWITCH)) params.set("safe", "1");
  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}
