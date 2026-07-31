/**
 * A live headless game, driven one command at a time.
 *
 * This is the whole engine side of the MCP server, and it is deliberately thin:
 * every read goes through core's FROZEN agent view and every write through its
 * act facade (`packages/core/src/agent/`, AGENT_API_VERSION 1.0.0). The MCP
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
  LOOP_STATUS,
  TMD,
  installController,
  noteSpots,
  runGameLoop,
  startGame,
  updateView,
} from "@neo-angband/core";
import type {
  AgentActions,
  AgentCommand,
  AgentSession,
  AgentView,
  GamePack,
  StartedGame,
} from "@neo-angband/core";

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
  /**
   * updateView's two constants. `maxSight` is on `state.z`; `feelingNeed` is NOT
   * (GameConstants does not carry it), so it comes from the bound constants
   * registry - which is where the web shell reads both from (main.ts:5622).
   */
  private readonly viewConstants: { maxSight: number; feelingNeed: number };

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

    this.agent = installController(
      this.game.state,
      () => {
        const next = this.pending;
        this.pending = null;
        return next;
      },
      {
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

    const bound = this.game.booted.registries.constants;
    this.viewConstants = { maxSight: bound.maxSight, feelingNeed: bound.feelingNeed };
    this.lastTurn = this.game.state.turn;
    /* Last in the constructor, because it needs viewConstants. Before the first
     * perceive, or the agent's opening `map` shows nothing at all - see
     * refreshDerivedView. */
    this.refreshDerivedView();
  }

  /**
   * Recompute the field of view and the remembered map.
   *
   * A FOUND GAP, not a nicety. `runGameLoop` does not do this: it advances the
   * world and leaves the DERIVED view state alone, and the web shell calls
   * `updateView` + `noteSpots` itself on every render (main.ts:5641). Measured on
   * a fresh startGame boot before this existed: of 12740 cells, `known` was true
   * for 0 and `inView` for 0 - including the player's own square. An agent driving
   * the frozen facade could see monsters and its own statistics and had NO MAP.
   *
   * Nothing in the repository could have caught it. The Borg's tests run against
   * a hand-built fake view (`packages/borg/src/harness.ts` says so in its header),
   * so the live perceive path had never been driven by anything but the web shell,
   * which happens to refresh for its own drawing reasons.
   *
   * Doing it here is the RIGHT FIX FOR TODAY and the wrong home for it: two hosts
   * now duplicate a refresh that upstream does inside update_stuff/handle_stuff,
   * and a third host would forget. That belongs in core's loop, which is a parity
   * change and so a decision rather than a drive-by. See docs/MCP.md.
   */
  private refreshDerivedView(): void {
    const state = this.game.state;
    const actor = state.actor;
    updateView(
      state.chunk,
      {
        grid: actor.grid,
        curLight: actor.light,
        blind: (actor.player.timed[TMD.BLIND] ?? 0) > 0,
        hasUnlight: actor.unlight,
        level: state.chunk.depth,
      },
      this.viewConstants,
      [],
      state.events,
    );
    noteSpots(state);
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
    if (!this.dead) this.refreshDerivedView();
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
