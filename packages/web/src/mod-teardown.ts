/**
 * The mod teardown pass: `ModPlugin.uninstall`, and the autoplayer slot, released
 * at the one moment the mod set changes.
 *
 * WHY THIS EXISTS. The ABI has declared `uninstall` since it was written, and
 * nothing called it - the header of mod-plugin.ts said so in as many words, which
 * is honest and is still a seam a mod author reads as a promise. The same was true
 * of the AgentSession the host keeps for an autoplayer: held so the command
 * provider could be handed back, never handed back. A teardown path described and
 * absent is worse than no teardown path, because a mod written against it does its
 * cleanup in a function that never runs.
 *
 * WHAT THE CONTRACT IS. Disabling a mod is a PAGE RE-COMPOSE: every route through
 * the mod manager that changes what is loaded ends at `requestReload` (mods.ts),
 * and a plugin that is not installed on the way back up is not installed. That is
 * the real removal, and this pass does not replace it.
 *
 * What this pass adds is ORDER. `requestReload` saves the live hero before it
 * reloads, so without a teardown the last bytes written for this character are
 * whatever the mods left in `state` mid-flight - including an autoplayer still
 * holding `state.nextCommand`. Running teardown FIRST is the plugin's one chance
 * to leave the state in a shape it is willing to have saved, and hands the
 * keyboard back to the human before the save is taken. That ordering is the claim
 * worth testing; it is not ceremony in front of a `location.reload()`.
 *
 * ORDER WITHIN THE PASS. Plugins first, then their panels, then the controller
 * slot. An autoplayer's own `uninstall` may want to read the game or issue a
 * final command, and pulling the command provider out from under it first would
 * be a teardown that breaks the thing it is tearing down. A mod's DOM panels
 * come down after its `uninstall` for the same reason in a milder form - that is
 * the mod's last chance to read what the player typed into one - and before the
 * save, so nobody is left looking at a mod's interface over a game that is
 * reloading (panel-runtime.ts).
 *
 * CONTAINMENT. Every call is wrapped: one mod's bad teardown must lose that mod's
 * teardown and nothing else, and must never be the reason the reload does not
 * happen. Same reasoning, and the same reporting channel, as the `register()` loop
 * in main.ts - a console.error is not a channel a player has.
 */

import { faultMessage, reportModFault } from "./mod-problems";
import { log } from "./logging";
import type { ModPlugin } from "./mod-plugin";

/** A loaded plugin, narrowed to what teardown needs (mod-code.ts's LoadedModPlugin fits). */
export interface ModTeardownTarget {
  readonly id: string;
  readonly plugin: Pick<ModPlugin, "uninstall">;
}

/**
 * The held autoplayer slot: the mod's id and the session `installController`
 * returned. Structural rather than the imported AgentSession so this module does
 * not pull core in for one method, and so a test can pass a spy.
 */
export interface ModTeardownController {
  readonly id: string;
  readonly session: { uninstall: () => void };
}

export interface ModTeardownDeps {
  /** Every plugin whose code the host ran, in load order. */
  readonly plugins: readonly ModTeardownTarget[];
  /** The one installed autoplayer, or null while the human has the keyboard. */
  readonly controller: ModTeardownController | null;
  /**
   * Stop accepting new DOM panels (`revokeModPanels`). Called FIRST, ahead of
   * every `uninstall()`, so a mod cannot open a panel on the way out and leave
   * the player looking at an interface belonging to a mod that is going away.
   */
  readonly revokePanels?: () => void;
  /**
   * Take down every mounted DOM panel and say how many there were
   * (`closeAllModPanels`). Called AFTER the `uninstall()` pass, because a
   * panel's contents are exactly the kind of thing a mod's last moment on a live
   * state is for reading.
   *
   * Both are passed rather than imported, for the reason the controller slot is
   * structural: this module must stay callable from a test with no document
   * behind it.
   */
  readonly closePanels?: () => number;
}

/** What the pass actually did, for the log and for the tests. */
export interface ModTeardownResult {
  /** Ids whose `uninstall()` was called and returned. */
  readonly torndown: readonly string[];
  /** Ids whose `uninstall()` threw; each is also on that mod's row. */
  readonly failed: readonly string[];
  /** The autoplayer whose slot was released, or null if there was none. */
  readonly released: string | null;
  /** How many mounted DOM panels were taken down. */
  readonly panelsClosed: number;
  /** False when the pass had already run for this page and did nothing. */
  readonly ran: boolean;
}

/* Once per page, latched here rather than at the call site so a second call site
 * added later cannot forget it. Not a correctness fig leaf: `session.uninstall`
 * restores the provider captured when it was installed, so running it twice around
 * anything that installed in between would restore a stale one. */
let done = false;

/** Let the page tear down again (tests only; a real page tears down once). */
export function resetModTeardown(): void {
  done = false;
}

/**
 * Run every loaded plugin's `uninstall()`, then release the autoplayer slot.
 *
 * Call it BEFORE the save and before the reload - the ordering is the point; see
 * the header. Never throws.
 */
export function teardownModPlugins(deps: ModTeardownDeps): ModTeardownResult {
  if (done) {
    return { torndown: [], failed: [], released: null, panelsClosed: 0, ran: false };
  }
  done = true;

  const torndown: string[] = [];
  const failed: string[] = [];

  /* BEFORE ANY MOD CODE RUNS. `uninstall()` is mod-authored and may do anything,
   * including open a panel; shutting the door first is cheaper than deciding
   * afterwards what to do about one that arrived during teardown. */
  try {
    deps.revokePanels?.();
  } catch (err) {
    log.error("mods", `revoking the mod panel layer failed:`, err);
  }

  for (const loaded of deps.plugins) {
    const uninstall = loaded.plugin.uninstall;
    if (!uninstall) continue;
    try {
      uninstall.call(loaded.plugin);
      torndown.push(loaded.id);
    } catch (err) {
      failed.push(loaded.id);
      /* Said in terms of what it costs the player: the mod is going away either
       * way, so the consequence is what its teardown did not get to write. */
      reportModFault(
        loaded.id,
        `uninstall() failed, so anything it meant to clean up or save was not: ${faultMessage(err)}`,
      );
      log.error(`mod:${loaded.id}`, `uninstall() failed:`, err);
    }
  }

  /* After every `uninstall()`, before the controller slot and before the save.
   * Never throws out of here: the panels are going away with the page whatever
   * happens, and a failure to tidy them must not be the reason the reload does
   * not happen. */
  let panelsClosed = 0;
  try {
    panelsClosed = deps.closePanels?.() ?? 0;
  } catch (err) {
    log.error("mods", `closing mod panels failed:`, err);
  }

  let released: string | null = null;
  const held = deps.controller;
  if (held) {
    try {
      held.session.uninstall();
      released = held.id;
    } catch (err) {
      /* The provider not coming back is not fatal here - the page is about to be
       * rebuilt from nothing - but the save taken next would keep an autoplayer's
       * fingerprints on a character the player is about to play by hand. */
      reportModFault(
        held.id,
        `its autoplayer could not be released before the reload: ${faultMessage(err)}`,
      );
      log.error(`mod:${held.id}`, `releasing the autoplayer failed:`, err);
    }
  }

  return { torndown, failed, released, panelsClosed, ran: true };
}
