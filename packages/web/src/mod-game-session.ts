/**
 * `ctx.session`: the game menu's Save, Save and exit, and Quit, for a mod that
 * draws its own save dialog. Present with `session:control`.
 *
 * Every call saves first and stops there if the save is refused or fails, so a
 * mod never sends the player out of a game that was not written down. None of
 * them confirm: the menu rows ask "Save and exit to the title screen?" because a
 * stray tap could reach them, and a mod's dialog is where its own question goes.
 */

import type { ModGameSession, SaveResult } from "@rpgm-tools/neo-angband-core";
export type { ModGameSession } from "@rpgm-tools/neo-angband-core";

/** What the page supplies: its save, its message line and its two ways out. */
export interface ModSessionHost {
  /** Why nothing can be saved right now, or null when a save may go ahead. */
  refusal(): string | null;
  /** Write the save; false when the write failed. */
  save(): boolean;
  /** Show the game's own "Saving game... done." line. */
  announceSaved(): void;
  /** Leave play for the title screen (the menu's Save and exit). */
  exitToTitle(): Promise<void>;
  /** Start the game's quit: its pause, then the desktop quit or the title. */
  quit(): void;
}

const SAVE_FAILED = "Saving failed.";

export function createModSession(host: ModSessionHost): ModGameSession {
  const write = (): SaveResult => {
    const reason = host.refusal();
    if (reason) return { ok: false, reason };
    return host.save() ? { ok: true } : { ok: false, reason: SAVE_FAILED };
  };
  return Object.freeze({
    save(): SaveResult {
      const result = write();
      if (result.ok) host.announceSaved();
      return result;
    },
    async exitToTitle(): Promise<SaveResult> {
      const result = write();
      if (result.ok) await host.exitToTitle();
      return result;
    },
    async quit(): Promise<SaveResult> {
      const result = write();
      if (result.ok) host.quit();
      return result;
    },
  });
}
