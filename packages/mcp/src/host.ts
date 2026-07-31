/**
 * The thing that owns the game: one session at a time, replaceable.
 *
 * Separate from the session because a session IS a game - a level, a registry and
 * an RNG that are only coherent together - so "start a new one" cannot be a method
 * on it. The host is also where the content pack is loaded ONCE and reused: the
 * pack is ~40 JSON files and several MB, and re-reading it per game would make
 * `new_game` slow for no reason.
 *
 * No save/load. Deliberately, for now: `docs/MCP.md` says so out loud rather than
 * leaving an agent to discover it. The save format is real and core owns it, but
 * an MCP tool that wrote savefiles would be the first thing in this package to
 * touch the filesystem, and the save-scum policy makes "load an earlier state" a
 * decision rather than a feature.
 */

import { loadGamePack } from "@rpgm-tools/neo-angband-cli";
import type { GamePack } from "@rpgm-tools/neo-angband-core";
import { GameSession, type NewGameOptions } from "./session.js";

export class GameHost {
  private pack: GamePack | null = null;
  private current: GameSession | null = null;
  private readonly now: () => number;
  /** How many games this process has started, so a log can say which one. */
  private started = 0;

  constructor(opts: { now?: () => number } = {}) {
    this.now = opts.now ?? ((): number => Date.now());
  }

  session(): GameSession | null {
    return this.current;
  }

  newGame(opts: NewGameOptions): GameSession {
    this.pack ??= loadGamePack();
    /* The old session's controller is uninstalled first. It is bound into the old
     * GameState's nextCommand seam, so leaving it would leak a live binding into a
     * game nothing can reach - harmless today and exactly the kind of thing that
     * stops being harmless when something else starts iterating sessions. */
    this.current?.close();
    this.current = new GameSession(this.pack, opts, this.now);
    this.started++;
    return this.current;
  }

  get gamesStarted(): number {
    return this.started;
  }

  close(): void {
    this.current?.close();
    this.current = null;
  }
}
