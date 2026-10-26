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
/** `--log=debug`: the logging level for this launch, as `?log=` is on the web; one of error, warn, info, debug. */
export const LOG_LEVEL_SWITCH = "--log=";
/** `--lab-seed=1234`: lab builds only; starts new games from that master seed so a failing run replays. */
export const LAB_SEED_SWITCH = "--lab-seed=";

declare const __NEO_LAB_BUILD__: boolean | undefined;

/** True only when this shell was bundled with `NEO_ANGBAND_LAB_BUILD=1`. */
export function labShell(): boolean {
  return typeof __NEO_LAB_BUILD__ === "boolean" && __NEO_LAB_BUILD__;
}

/** `?agent=<id>&safe=1&log=<level>&labtrust=<ids>&seed=<n>`, any part, or `""` for an ordinary launch. */
export function rendererQuery(argv: readonly string[], env: NodeJS.ProcessEnv = process.env, lab: boolean = labShell()): string {
  const params = new URLSearchParams(agentQuery(env));
  if (argv.includes(SAFE_MODE_SWITCH)) params.set("safe", "1");
  const level = argv.find((arg) => arg.startsWith(LOG_LEVEL_SWITCH))?.slice(LOG_LEVEL_SWITCH.length);
  if (level !== undefined && ["error", "warn", "info", "debug"].includes(level)) params.set("log", level);
  const trusted = argv.find((arg) => arg.startsWith(LAB_TRUST_SWITCH));
  if (lab && trusted !== undefined && trusted.length > LAB_TRUST_SWITCH.length) params.set("labtrust", trusted.slice(LAB_TRUST_SWITCH.length));
  const seeded = argv.find((arg) => arg.startsWith(LAB_SEED_SWITCH));
  const seedText = seeded?.slice(LAB_SEED_SWITCH.length) ?? "";
  if (lab && /^[0-9]{1,10}$/u.test(seedText) && Number(seedText) <= 0xffffffff) params.set("seed", seedText);
  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}
