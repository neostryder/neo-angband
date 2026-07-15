/**
 * The trusted in-process plugin author API (W2.2).
 *
 * A trusted plugin overrides game SYSTEMS - effect handlers, room builders,
 * player-command actions, monster AI - through the capability-gated
 * ModRegistryHost (core, mod/registry-host.ts). Unlike a scripted plugin (W2.1)
 * it runs IN the host, synchronously, with the same live access to rng / chunk /
 * player the core code has, because deep system override cannot cross the async,
 * isolated Worker boundary (see the ModRegistryHost header). It is therefore
 * trusted code: the user consents to its declared registry:* capabilities at
 * install, exactly as they would for any desktop game's mods.
 *
 * A plugin lives at packages/web/mods/<id>/trusted.ts and default-exports a
 * TrustedPlugin. It imports whatever core symbols it needs (EF codes, Dice,
 * FEAT, ...) directly from @neo-angband/core - it is in-process, so there is no
 * serialization boundary.
 */

import type { ModRegistryHost, GameState } from "@neo-angband/core";

/** What the host hands a trusted plugin alongside the registry facade. */
export interface TrustedContext {
  /** The live game state (the same object core mutates). */
  state: GameState;
  /** The plugin's own id, for diagnostics. */
  id: string;
  /** Emit a diagnostic line (host decides where it goes). */
  log: (msg: string) => void;
}

/** A trusted in-process plugin. */
export interface TrustedPlugin {
  /**
   * Called once after the game is booted. Register overrides on `host`; each
   * facade throws if the plugin did not declare the matching registry:*
   * capability. Any exception aborts install and is surfaced to the host.
   */
  register(host: ModRegistryHost, ctx: TrustedContext): void;
  /** Optional teardown, called when the plugin is uninstalled. */
  uninstall?: () => void;
}

/** Identity helper: gives a trusted.ts default export its type. */
export function defineTrustedPlugin(plugin: TrustedPlugin): TrustedPlugin {
  return plugin;
}
