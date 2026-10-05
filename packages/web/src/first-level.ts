/**
 * The shell's half of the `dungeonlevel` event: where a listener's exception
 * goes, and when the session's first level is announced.
 */
import type { GameEventType } from "@rpgm-tools/neo-angband-core";
import { log } from "./logging";

/**
 * GameState.onEventFault for the shell: a throwing listener is logged on the
 * `mods` channel, as a throwing player-command listener is, and the arrival that
 * sent the event carries on.
 */
export function reportEventFault(type: GameEventType, error: unknown): void {
  log.error("mods", `a ${type} listener failed:`, error);
}

/**
 * The session's first `dungeonlevel` (start_game's on_new_level, ui-game.c:743)
 * waits for two things that the shell's boot finishes in either order: the game
 * on screen, and every folder plugin's register() run, so a mod that subscribes
 * in register() hears the level it starts on. `announce` runs once both have
 * been signalled, on a later microtask, never synchronously inside either call.
 */
export interface FirstLevelGate {
  /** The game screen is live. */
  screenLive(): void;
  /** Every folder plugin's register() has run. */
  modsRegistered(): void;
}

export function firstLevelGate(announce: () => void): FirstLevelGate {
  let markRegistered = (): void => {};
  const registered = new Promise<void>((resolve) => {
    markRegistered = resolve;
  });
  let live = false;
  return {
    screenLive: (): void => {
      if (live) return;
      live = true;
      void registered.then(announce);
    },
    modsRegistered: (): void => {
      markRegistered();
    },
  };
}
