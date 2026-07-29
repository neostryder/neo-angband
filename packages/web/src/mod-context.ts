/**
 * Build the ModPluginContext a plugin is handed.
 *
 * Split out of mod-plugin.ts on purpose, and the split is load-bearing. A mod's
 * own source imports mod-plugin.ts for `defineModPlugin` and the context types,
 * and is then built into a single-file plugin.js. If the module holding those
 * types also imported core as a VALUE, every plugin's bundle would contain the
 * whole engine - the exact duplication that passing the engine in exists to
 * avoid. So mod-plugin.ts imports core for TYPES only, and the one function that
 * needs the live namespace lives here, where no plugin imports it.
 */

import * as neoCore from "@neo-angband/core";
import type { GameState } from "@neo-angband/core";
import {
  MOD_API_VERSION,
  type ModCoreApi,
  type ModPluginContext,
} from "./mod-plugin";

/**
 * `core` is the module namespace this host itself imported, so a plugin and the
 * game look at ONE set of registries and singletons. A plugin that resolved
 * "@neo-angband/core" for itself from a folder would get a second copy, register
 * its effect handler on a registry the interpreter never consults, and appear to
 * do nothing at all - a failure mode with no error message anywhere.
 *
 * Frozen, so one plugin cannot edit what the next is handed. Shallow on purpose:
 * `core` IS the live engine and freezing it would break the game. This stops
 * accidental cross-talk, not a determined adversary - the security boundary for
 * in-process code is the consent prompt, not this object.
 */
export function modPluginContext(
  id: string,
  flags: Readonly<Record<string, boolean>>,
  state?: GameState,
): ModPluginContext {
  return Object.freeze({
    id,
    api: MOD_API_VERSION,
    engine: neoCore.ENGINE_VERSION,
    flags: Object.freeze({ ...flags }),
    core: neoCore as unknown as ModCoreApi,
    ...(state ? { state } : {}),
    log: (msg: string) => {
      console.info(`[mod:${id}] ${msg}`);
    },
  });
}
