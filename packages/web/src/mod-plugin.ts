/**
 * The mod plugin ABI: the one contract a mod's CODE is written against.
 *
 * Until this existed, every path by which a mod could supply code was a build-time
 * Vite `import.meta.glob` over `mods/<id>/hooks.ts` for behaviour and the same for
 * `trusted.ts` for system overrides. Both resolve when the app is BUILT, so a folder
 * on disk could contribute records and never a line of code, for first- or
 * third-party mods alike. Everything else the SDK does - add/replace/remove/merge/
 * field patches, provenance-aware conflicts, five capability-gated registry facades -
 * was already built and sitting behind that one gate. This module is the gate's
 * replacement.
 *
 * And it is now the ONLY shape. The bundled mods were rewritten onto it (their
 * source is `mods/<id>/plugin.ts`, still resolved by a Vite glob, but the same
 * ModPlugin a folder ships), so there is one contract rather than a first-party one
 * and a third-party one. That is what lets one source produce both the bundled mod
 * and the plugin.js in the mod's own repository - scripts/build-mod-plugins.mjs -
 * and it is why the hooks.ts signature is gone rather than kept as a second option.
 *
 * A mod that runs code ships `plugin.js`, an ES module beside its manifest.json,
 * default-exporting a ModPlugin. That is the ENTRY POINT, not the whole mod: a mod
 * is a folder, and it may hold as many scripts, images and data files as it likes.
 *
 *   mods/my-mod/
 *     manifest.json
 *     plugin.js        <- the entry point, default-exporting a ModPlugin
 *     lib/dice.js      <- more code; `import "./lib/dice.js"` from plugin.js
 *     monster.json     <- a record contribution, as before
 *     tiles/orc.png    <- an asset: `await ctx.assetUrl("tiles/orc.png")`
 *     data/spawns.json <- nested data, also an asset (ctx.assetUrl + fetch)
 *
 * Relative imports resolve on both front ends. On desktop that is free - the pack
 * is served from the shell's loopback origin. In a browser tab the folder has no
 * location at all, so the dependency graph is resolved and rewritten before the
 * import (mod-modules.ts); read that file's header for the two things it cannot do
 * (a cycle, and an extensionless specifier).
 *
 * WHY NO IMPORTS. The obvious design is to let plugin.js `import` from
 * "@rpgm-tools/neo-angband-core" the way a bundled mod's TypeScript does. It cannot: a bare
 * specifier does not resolve in a module fetched from a folder, and bundling core
 * into each plugin would give every plugin its own copy of the engine's
 * registries and singletons - two effect registries, two action registries,
 * mutations landing on objects the game is not looking at. An import map plus a
 * generated re-export shim would work, but it makes the ABI a list that has to be
 * kept in sync with itself, and it puts a CSP and browser-support question in the
 * middle of the critical path.
 *
 * So the host PASSES the engine in, and `ctx.core` is the live core namespace -
 * the same module instance the game itself is running on. That makes the ABI one
 * object rather than a list, gives a plugin the whole public API rather than a
 * curated slice of it, and works identically for a loopback URL on desktop, a
 * blob: URL from a browser directory picker, and a bundled module in dev.
 *
 * WHY THE SAME SHAPE FOR BOTH KINDS. hooks.ts and trusted.ts were two entry
 * points with two signatures for two halves of the same job: `hooks` folds
 * behaviour into core's ModHooks, `register` reaches the capability-gated
 * registries. A mod that wants both had to ship two files. One ModPlugin carries
 * both, either optional. (trusted.ts still exists for the AGENT system, which is a
 * different thing wearing a similar name; the sandboxed agent entry is sandbox.ts.)
 *
 * WHY THE VERSION IS DECLARED AND CHECKED. The API is explicitly unstable until
 * 1.0. That is a reason to fail LOUDLY, not a reason to skip the check: a plugin
 * written against api 1 and loaded by a host that has moved to 2 must be refused
 * with both numbers named, because the alternative is a mod that half-works and a
 * player who reports a game bug.
 */

/* TYPE-ONLY import of core, deliberately. A mod's own source imports this module
 * for defineModPlugin and the context types, and gets built into a single-file
 * plugin.js; if this file pulled core in as a VALUE, the whole engine would be
 * bundled into every plugin - which is the exact duplication the host-passes-the-
 * engine design exists to avoid. The one function that needs the live namespace
 * lives in mod-context.ts, which no plugin imports. */
import type {
  AgentController,
  ModHooks,
  ModRegistryHost,
  GameState,
} from "@rpgm-tools/neo-angband-core";

/**
 * The ABI version this host implements. Bump ONLY when an existing plugin would
 * misbehave under the new host - adding an optional field is not a bump; changing
 * what an existing call does, or removing anything, is.
 *
 * While the API is unstable (pre-1.0) a bump means every mod stops loading until
 * its author republishes. That is the intended cost: see the header.
 */
export const MOD_API_VERSION = 1;

/** What the host hands a plugin. Frozen before it is passed. */
export interface ModPluginContext {
  /** The mod's own id, which is also its folder name. */
  readonly id: string;
  /** The ABI version the HOST implements (MOD_API_VERSION). */
  readonly api: number;
  /** The engine version, for a plugin that wants to adapt rather than refuse. */
  readonly engine: string;
  /**
   * THIS mod's resolved rule flags (`choices[flag] ?? rule.default` for every
   * rule its own manifest declares) - sliced per mod, never the whole map, so a
   * mod cannot read or act on another mod's toggles.
   */
  readonly flags: Readonly<Record<string, boolean>>;
  /**
   * The live core namespace: the same module instance the game runs on. This is
   * the engine API, entire - not a curated subset. See the header.
   */
  readonly core: ModCoreApi;
  /** The live game state, when there is one (absent during content composition). */
  readonly state?: GameState;
  /**
   * A URL for one of the mod's OWN files, by path relative to its folder -
   * `"tiles/orc.png"`, `"data/spawns.json"`, `"sound/hit.ogg"`. Null when the pack
   * has no such file, or when this front end cannot serve one.
   *
   * A function rather than a map of paths to URLs because the browser case has to
   * read the file to mint a URL for it, and building one for every asset of every
   * installed mod at boot would read the whole mods folder into memory to satisfy
   * the mods that ask for nothing. The URL stays valid for the session, and asking
   * twice returns the same one.
   *
   * Use it, rather than composing a path yourself: on desktop this is an http URL
   * under the shell's own server, in a browser tab it is a blob:, and a mod that
   * hard-codes either is a mod that runs on one of the two front ends.
   */
  readonly assetUrl: (path: string) => Promise<string | null>;
  /**
   * The mod's own record files, parsed, keyed WITHOUT the `.json` - so
   * `data["monster"]` for `monster.json`. The same objects the content composer
   * was handed.
   *
   * Here because a plugin frequently wants to read what its own pack declares (to
   * index it, to validate it, to drive behaviour from it) and the alternative was
   * fetching its own file back through assetUrl and re-parsing bytes the game had
   * already parsed. Empty for a plugin whose folder holds no record files.
   */
  readonly data: Readonly<Record<string, unknown>>;
  /** Emit a diagnostic line; the host decides where it goes. */
  readonly log: (msg: string) => void;
}

/**
 * The engine surface, typed as core's own public module. Declared as an import
 * type rather than a hand-written list so it can never drift from what core
 * actually exports - the drift is the whole failure mode a curated list has.
 */
export type ModCoreApi = typeof import("@rpgm-tools/neo-angband-core");

/** A mod's code. Both members optional: a plugin may do either job, or both. */
export interface ModPlugin {
  /**
   * The ABI version this plugin was WRITTEN against. Required, and checked: a
   * mismatch refuses the plugin rather than running it hopefully.
   */
  readonly api: number;
  /**
   * Behaviour, folded into the single ModHooks core consults (core/mod/hooks.ts).
   * Called once per enabled mod, in load order. Return undefined to contribute
   * nothing - a mod whose every rule is switched off must leave core on its
   * faithful path, not on a path that happens to agree.
   */
  hooks?(ctx: ModPluginContext): ModHooks | undefined;
  /**
   * System overrides, through the capability-gated registry facade. Each facade
   * throws AgentCapabilityError unless the manifest declared the matching
   * `registry:<domain>` capability AND the player consented to it. Called once
   * after the game is booted; throwing aborts this plugin's install and is
   * surfaced, without taking the game or the other mods down.
   */
  register?(host: ModRegistryHost, ctx: ModPluginContext): void;
  /**
   * Rewrite this mod's OWN save bag when the mod's `saveSchema` has moved past
   * the schema the bag was written at.
   *
   * A bag is whatever JSON the mod chose to keep in the player's save
   * (`ctx.state.mods[id]`); core round-trips it verbatim and never reads it, so
   * core cannot migrate it and neither can the host - only the mod knows what its
   * own data means. `fromSchema` is what the bag was written at; return the same
   * data in the shape this version expects, and the host stamps the schema
   * forward (core's migrateModBag).
   *
   * Called at mod-load time, before `register()`, so a plugin can rely on its bag
   * being current by the time any of its other code runs. Optional: a mod that
   * never changes its data shape, or would rather branch on `bag.schema` itself,
   * simply omits it. Omitting it while HAVING bumped saveSchema is reported to
   * the player - the old data is kept exactly as it was rather than being
   * relabelled as current.
   *
   * Throwing leaves the old bag untouched and reports; a half-applied migration
   * written back over the only copy is worse than no migration at all.
   */
  migrateBag?(data: unknown, fromSchema: number, ctx: ModPluginContext): unknown;
  /**
   * An AUTOPLAYER: return a controller and the host binds it as the game's
   * command provider, so the mod plays the game. Return undefined to decline -
   * a mod whose own autoplay toggle is off must leave the human at the keyboard.
   *
   * A first-class member rather than a `ctx.core.installController(...)` call
   * from register(), for one reason that is not style: installController
   * REPLACES state.nextCommand and hands back an uninstall that restores
   * whatever was there before (core/agent/controller.ts). Two mods doing that
   * from register() both succeed, the second one silently wins, and unwinding
   * them out of order restores the wrong provider. Going through the host means
   * exactly one controller exists, the host knows whose it is, and it can refuse
   * the second by name instead of losing the first.
   *
   * Turning the autoplayer off is turning the MOD off: a mod toggle re-composes
   * the page (requestReload), and a controller that is not installed on the way
   * back up is not installed. The host still keeps the AgentSession so it can
   * release the seam in-process, but nothing calls that yet - said plainly
   * because ModPlugin.uninstall has no caller either, and a teardown path
   * described but not wired is how a seam ends up trusted and absent.
   *
   * Called once, AFTER register(), so a mod can register the commands its own
   * controller will then drive.
   *
   * Requires the `command:add` capability in the manifest (a controller that
   * cannot act is not a controller); installController throws
   * AgentCapabilityError without it, which is reported as this mod's fault and
   * leaves the game playable by hand. Determinism is NOT declared here - the
   * manifest's `nondeterministic` flag already advances the save's determinism
   * ratchet when the mod is enabled, and a second place to say it is a second
   * place for it to disagree.
   */
  controller?(ctx: ModPluginContext): AgentController | undefined;
  /** Optional teardown, called if the plugin is uninstalled in-session. */
  uninstall?(): void;
}

/** Identity helper, so a plugin's default export gets checked at author time. */
export function defineModPlugin(plugin: ModPlugin): ModPlugin {
  return plugin;
}


/**
 * What is wrong with a candidate default export, or null when it is usable.
 *
 * Returns a message rather than throwing, because this runs over PLAYER-SUPPLIED
 * files: a hand-edited or half-downloaded plugin must become one line the mod
 * manager can show, never a boot failure. Same reasoning as z-file.c returning
 * NULL instead of dying.
 */
export function validateModPlugin(
  candidate: unknown,
  hostApi = MOD_API_VERSION,
): string | null {
  if (candidate === null || candidate === undefined) {
    return "plugin.js has no default export";
  }
  if (typeof candidate !== "object" && typeof candidate !== "function") {
    return `plugin.js default-exports a ${typeof candidate}, not a plugin object`;
  }
  const p = candidate as Partial<ModPlugin>;
  if (typeof p.api !== "number" || !Number.isInteger(p.api)) {
    return `plugin.js does not declare an integer "api" version (this host implements ${hostApi})`;
  }
  if (p.api !== hostApi) {
    /* Both numbers, and which way round: "incompatible" alone sends the player to
     * the wrong place - a too-NEW mod needs a game update, a too-OLD one needs a
     * mod update, and only the pair of numbers says which. */
    return p.api > hostApi
      ? `plugin.js targets mod API ${p.api}; this build implements ${hostApi} - the mod needs a newer game`
      : `plugin.js targets mod API ${p.api}; this build implements ${hostApi} - the mod needs updating for this game`;
  }
  if (p.hooks !== undefined && typeof p.hooks !== "function") return "plugin.js: hooks is not a function";
  if (p.register !== undefined && typeof p.register !== "function") {
    return "plugin.js: register is not a function";
  }
  if (p.migrateBag !== undefined && typeof p.migrateBag !== "function") {
    return "plugin.js: migrateBag is not a function";
  }
  if (p.controller !== undefined && typeof p.controller !== "function") {
    return "plugin.js: controller is not a function";
  }
  if (p.uninstall !== undefined && typeof p.uninstall !== "function") {
    return "plugin.js: uninstall is not a function";
  }
  if (p.hooks === undefined && p.register === undefined && p.controller === undefined) {
    /* A plugin that does none of these is almost certainly a mistake - a mod
     * with no code at all simply ships no plugin.js - and saying so beats
     * loading it and having nothing happen. `controller` counts because an
     * autoplayer is a mod whose entire contribution is playing the game: the
     * Borg registers nothing and hooks nothing. Deliberately still NOT widened
     * to include migrateBag: a plugin whose only member is a bag migrator
     * changes nothing about the game and would silently do nothing on a fresh
     * save, which is the same mistake wearing a newer field name. */
    return "plugin.js declares no hooks, register or controller, so it would do nothing";
  }
  return null;
}
