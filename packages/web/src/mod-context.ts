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

import * as neoCore from "@rpgm-tools/neo-angband-core";
import { log } from "./logging";
import type { GameState } from "@rpgm-tools/neo-angband-core";
import {
  MOD_API_VERSION,
  type ModCoreApi,
  type ModPluginContext,
} from "./mod-plugin";
import { diskPacks } from "./disk-packs";
import { modPrefs, type ModPrefs } from "./mod-prefs";

/**
 * `core` is the module namespace this host itself imported, so a plugin and the
 * game look at ONE set of registries and singletons. A plugin that resolved
 * "@rpgm-tools/neo-angband-core" for itself from a folder would get a second copy, register
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
  own: ModOwnFiles = {},
  session: ModSessionFacts = {},
): ModPluginContext {
  /* The mod's OWN files only. `assetUrl` is called with the mod's id fixed here
   * rather than taken as an argument, so a plugin cannot read another mod's assets
   * by passing a different one - the id it gets is the id it was loaded under. */
  const assets = own.assetUrl;
  return Object.freeze({
    id,
    api: MOD_API_VERSION,
    engine: neoCore.ENGINE_VERSION,
    flags: Object.freeze({ ...flags }),
    core: neoCore as unknown as ModCoreApi,
    ...(state ? { state } : {}),
    assetUrl: (path: string): Promise<string | null> =>
      assets ? assets(id, path) : Promise.resolve(null),
    data: Object.freeze({ ...(own.data ?? {}) }),
    /* Scoped by the id fixed above, for the same reason assetUrl is: the id a
     * mod gets is the id it was loaded under, so no mod can read another's. */
    prefs: session.prefs ?? modPrefs(id),
    /* Defaults FALSE, which is the safe way round: a mod that seeds something
     * for a new life must not seed it over a character who already lived one,
     * so a caller that forgets to say gets the answer that changes nothing. */
    newCharacter: session.newCharacter ?? false,
    log: (msg: string) => {
      log.info(`mod:${id}`, `${msg}`);
    },
  });
}

/** What the host knows about THIS session, as opposed to this mod's folder. */
export interface ModSessionFacts {
  /** Whether the character was created this session rather than loaded. */
  readonly newCharacter?: boolean;
  /** Override the preference store (tests, and a front end with its own). */
  readonly prefs?: ModPrefs;
}

/**
 * A mod's own files for its context: its parsed record JSON plus the live asset
 * resolver.
 *
 * The resolver is read off the CURRENT disk-pack report rather than captured when
 * the plugin loaded, because the browser's is stateful - it caches the URLs it has
 * minted, and a stale copy would hand out a second blob URL for the same image.
 */
export function modOwnFiles(data: Readonly<Record<string, unknown>>): ModOwnFiles {
  const assetUrl = diskPacks().assetUrl;
  return { data, ...(assetUrl ? { assetUrl } : {}) };
}

/** What the host knows about this mod's own folder, when it came from one. */
export interface ModOwnFiles {
  /** The report's asset resolver (DiskPackReport.assetUrl), if the source has one. */
  readonly assetUrl?: (id: string, path: string) => Promise<string | null>;
  /** The pack's parsed record files, keyed without `.json` (DiskPack.files). */
  readonly data?: Readonly<Record<string, unknown>>;
}
