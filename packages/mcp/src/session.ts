/**
 * A live headless game, driven one command at a time.
 *
 * This is the whole engine side of the MCP server, and it is deliberately thin:
 * every read goes through core's FROZEN agent view and every write through its
 * act facade (`packages/core/src/agent/`, AGENT_API_VERSION 1.1.0). The MCP
 * server therefore has exactly the reach a third-party agent mod has - no
 * privileged path, no test hook - which is the property that makes it worth
 * having. If a tool here needs something the facade cannot express, the facade is
 * what should grow.
 *
 * HOW A TURN WORKS. `runGameLoop` asks `state.nextCommand()` whenever the game
 * needs input and returns LOOP_STATUS.INPUT when it gets null (game/loop.ts).
 * `installController` binds a controller into exactly that seam. So `act()` here
 * arms a ONE-SHOT command, runs the loop, and returns when the loop asks for the
 * next one - which is the same boundary a human keypress sits at. Several game
 * turns can pass inside one `act()` (resting, a monster's turn, level feelings);
 * that is upstream's behaviour, and the drained messages are how you see it.
 *
 * NONDETERMINISM IS DECLARED, not hidden. An AI on the other end of a socket is
 * not a seeded RNG, so the controller installs with `nondeterministic: true`,
 * which trips core's one-way save ratchet. A character an agent touched is marked
 * as such for as long as it exists. That is the same rule the mod system applies
 * to gameplay mods, and there is no flag here to turn it off.
 */

import {
  AGENT_API_VERSION,
  ContentIdResolver,
  GlyphTable,
  LOOP_STATUS,
  installController,
  runGameLoop,
  startGame,
} from "@rpgm-tools/neo-angband-core";
import type {
  AgentActions,
  AgentCommand,
  AgentSession,
  AgentView,
  GamePack,
  StartedGame,
} from "@rpgm-tools/neo-angband-core";

/** What `new_game` accepts. Every field has an upstream-faithful default. */
export interface NewGameOptions {
  /**
   * The RNG seed. Omitted means a random one, which is reported back - the
   * engine is a function of its seed (decision 22), so a seed an agent was told
   * is a game it can replay exactly.
   */
  seed?: number;
  /** Starting depth in feet/50 (1 = 50 ft). 0 is the town. */
  depth?: number;
  raceName?: string;
  className?: string;
}

/** Why a command was refused, or what it did. */
export interface ActResult {
  /** The command as the engine received it. */
  command: AgentCommand;
  /** Messages the engine emitted while running it, oldest first. */
  messages: string[];
  /**
   * The loop status when control came back - one of LOOP_STATUS's string values
   * ("input", "dead", "level-change", ...). A STRING, not an enum ordinal: the
   * engine's statuses are named, and reporting an integer would make a tool
   * result say less than the engine does.
   */
  status: string;
  /** True when the player died during this command. */
  died: boolean;
  /** Game turns elapsed. Often more than one; see the header. */
  turnsElapsed: number;
}

export class SessionError extends Error {}

/**
 * One game. Create it, then `act` and read `view` until the player dies.
 *
 * Not reusable across games: `newGame` on the owning server replaces the whole
 * object, because a GameState carries a level, a registry and an RNG that are
 * only coherent together.
 */
export class GameSession {
  readonly seed: number;
  readonly startedAt: number;
  private readonly game: StartedGame;
  private readonly agent: AgentSession;
  /** Armed by `act`, consumed by the controller, then cleared. */
  private pending: AgentCommand | null = null;
  private lastTurn: number;
  private nondeterministicTripped = false;

  constructor(pack: GamePack, opts: NewGameOptions, now: () => number) {
    /* A seed the caller did not pick is still REPORTED, so a session is always
     * reproducible after the fact. Math.random is fine for choosing one: it
     * picks which deterministic game to play, it is not played with. */
    this.seed = opts.seed ?? Math.floor(Math.random() * 0x7fffffff);
    this.startedAt = now();

    try {
      this.game = startGame(pack, {
        seed: this.seed,
        depth: opts.depth ?? 1,
        ...(opts.raceName === undefined ? {} : { raceName: opts.raceName }),
        ...(opts.className === undefined ? {} : { className: opts.className }),
      });
    } catch (e) {
      /* A bad race or class name is the common case and the message core throws
       * names it, so pass it through rather than flattening to "could not start". */
      throw new SessionError(`could not start a game: ${message(e)}`);
    }

    /*
     * THE VIEW DEPS, and this server ran without them for its whole life.
     *
     * AgentViewDeps is what unlocks the second breadth of the perceive facade -
     * namespaced ids (featCode / kindId / raceId), item values and store prices,
     * and (1.1.0) the glyph layer. Absent deps degrade to omission rather than
     * throwing, which is the right contract and also why nothing complained:
     * measured before this was wired, every `inspect` reported its square as
     * "feat 27" because renderCell's featCode was never present, and every
     * ItemView came back with no `value`. An agent was being handed the poorer
     * of two views by accident.
     *
     * The glyph table is built from the SAME gamedata registries the shell
     * builds its own from, so `render` draws the characters the player would
     * see rather than a second, hand-written idea of them.
     */
    const registries = this.game.booted.registries;
    const glyphs = new GlyphTable({
      features: registries.features.allFeatures(),
      kinds: registries.objects.kinds,
      races: registries.monsters.races,
      traps: registries.traps,
      flavors: registries.objects.flavors,
    });
    const resolver = new ContentIdResolver({
      objects: registries.objects,
      playerRaces: this.game.players.races,
      playerClasses: this.game.players.classes,
    });

    this.agent = installController(
      this.game.state,
      () => {
        const next = this.pending;
        this.pending = null;
        return next;
      },
      {
        viewDeps: {
          resolver,
          reg: registries.objects,
          glyphs: glyphs.agentGlyphs(),
        },
        nondeterministic: true,
        onNondeterministic: () => {
          this.nondeterministicTripped = true;
        },
      },
    );
    /* startGame does NOT reject an unknown race or class name - measured: a request
     * for "Balrog" produced a Human with no error anywhere. An agent given a
     * silently different character than it asked for has no way to notice, so the
     * check is a comparison of what was ASKED against what was BORN. */
    const born = this.game.state.actor.player;
    const asked = { race: opts.raceName, cls: opts.className };
    const wrong: string[] = [];
    if (asked.race !== undefined && !sameName(asked.race, born.race?.name)) {
      wrong.push(`race "${asked.race}" (got ${born.race?.name ?? "none"})`);
    }
    if (asked.cls !== undefined && !sameName(asked.cls, born.cls?.name)) {
      wrong.push(`class "${asked.cls}" (got ${born.cls?.name ?? "none"})`);
    }
    if (wrong.length > 0) {
      this.agent.uninstall();
      throw new SessionError(
        `no such ${wrong.join(" and no such ")} - the engine silently defaults rather than ` +
          `refusing, so this is checked here`,
      );
    }

    this.lastTurn = this.game.state.turn;
    /* NO FOV REFRESH HERE, and that is the fix rather than an omission.
     *
     * This class used to carry a refreshDerivedView() that called updateView +
     * noteSpots itself, because building this server found that an agent had no map
     * at all: measured on a fresh startGame boot, of 12740 cells `known` was true
     * for 0 and `inView` for 0, including the player's own square. The cause was
     * not a missing refresh in the loop - core calls `state.updateFov` from ~25
     * sites, including the level-entry flood - it was that `updateFov` is a host
     * seam with no DEFAULT, so every one of those calls was a no-op for a host that
     * had not wired one, and this host had not.
     *
     * core now installs a default in wireGame (session/game.ts), so startGame,
     * loadGame and every acting path refresh with no host cooperation. Measured
     * again at the same seed: 19 known, 59 in view, the player's own square known.
     * Nothing to do here.
     */
  }

  get view(): AgentView {
    return this.agent.view;
  }

  get act_(): AgentActions {
    return this.agent.act;
  }

  /** The frozen contract version this session speaks. */
  get apiVersion(): string {
    return AGENT_API_VERSION;
  }

  /**
   * True once core's determinism ratchet has been tripped for this game.
   *
   * Surfaced rather than assumed: the whole point of the ratchet is that a save
   * an agent touched says so, and a tool that claimed it without checking would
   * be exactly the kind of unverified assertion the ratchet exists to replace.
   */
  get nondeterministic(): boolean {
    return this.nondeterministicTripped;
  }

  /**
   * True when the engine's command registry knows this code.
   *
   * Exposed because the loop DOES NOT COMPLAIN about a code it has no action for:
   * measured, `act {"code":"ascend_to_heaven"}` returned cleanly, cost zero turns
   * and emitted no message, which to an agent is indistinguishable from a command
   * that was tried and refused. A mod may add codes, so this asks the live
   * registry rather than a fixed list.
   */
  knowsCommand(code: string): boolean {
    return this.game.registry.has(code);
  }

  get dead(): boolean {
    return this.game.state.isDead || this.view.player().dead;
  }

  /** Run one command through the real loop and report what happened. */
  perform(command: AgentCommand): ActResult {
    if (this.dead) {
      throw new SessionError(
        "the character is dead; start a new game (no save-scumming - the death is terminal)",
      );
    }
    const before = this.game.state.turn;
    this.pending = command;
    const status = runGameLoop(this.game.state, this.game.registry);
    /* Drained through the VIEW, not from a private buffer, so an agent reading
     * messages here sees exactly what messages() would report. */
    const messages = this.view.messages();
    this.lastTurn = this.game.state.turn;
    return {
      command,
      messages,
      status,
      died: this.dead,
      turnsElapsed: this.game.state.turn - before,
    };
  }

  /**
   * True when the loop is waiting for a command, which is the only state a
   * caller can act from. Anything else means the engine wants something the
   * agent facade does not model, and saying so beats hanging.
   */
  awaitingInput(): boolean {
    return !this.dead;
  }

  get turn(): number {
    return this.lastTurn;
  }

  close(): void {
    this.agent.uninstall();
  }
}

/** True for a status the loop yields when it simply wants the next command. */
export function isAwaitingInput(status: string): boolean {
  return status === LOOP_STATUS.INPUT;
}

/** Case-insensitive name comparison, as startGame's own lookup is. */
function sameName(asked: string, got: string | undefined): boolean {
  return got !== undefined && asked.trim().toLowerCase() === got.trim().toLowerCase();
}

export function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
