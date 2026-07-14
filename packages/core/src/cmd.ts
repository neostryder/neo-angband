/**
 * The game command system, ported from reference/src/cmd-core.h and
 * cmd-core.c (Angband 4.2.6).
 *
 * This is the UI-to-core seam: front ends push typed commands onto a
 * queue; the engine pops and executes them. Command codes map 1:1 to the
 * upstream enum (CMD_WALK -> "walk", CMD_WIZ_CREATE_OBJ ->
 * "wiz-create-obj", ...).
 *
 * Divergences from C, by design:
 * - Handlers live in a runtime registry on the queue instead of the
 *   compiled game_cmds[] function pointers (the closed dispatch table was
 *   an extensibility chokepoint; the code list itself stays closed for
 *   parity).
 * - Arguments are a name-keyed map of tagged values instead of a fixed
 *   4-slot union array with 20-char names; the accepted argument names
 *   and types are unchanged.
 * - The player-coupled execution details (bloodlust command coercion,
 *   TMD_COMMAND redirecting to CMD_COMMAND_MONSTER) are injected via an
 *   optional CommandCoercion hook so the queue itself stays
 *   player-agnostic; the game loop wires it once the player exists.
 */

import type { Loc } from "./loc";

/** cmd_code, kebab-cased. "null" is the CMD_NULL no-command sentinel. */
export type CommandCode =
  | "null"
  | "load-file"
  | "new-game"
  | "birth-init"
  | "birth-reset"
  | "choose-race"
  | "choose-class"
  | "buy-stat"
  | "sell-stat"
  | "reset-stats"
  | "refresh-stats"
  | "roll-stats"
  | "prev-stats"
  | "name-choice"
  | "history-choice"
  | "accept-character"
  | "go-up"
  | "go-down"
  | "walk"
  | "jump"
  | "pathfind"
  | "inscribe"
  | "uninscribe"
  | "autoinscribe"
  | "takeoff"
  | "wield"
  | "drop"
  | "browse-spell"
  | "study"
  | "cast"
  | "use-staff"
  | "use-wand"
  | "use-rod"
  | "activate"
  | "eat"
  | "quaff"
  | "read-scroll"
  | "refill"
  | "use"
  | "fire"
  | "throw"
  | "pickup"
  | "autopickup"
  | "ignore"
  | "disarm"
  | "lock"
  | "rest"
  | "tunnel"
  | "open"
  | "close"
  | "run"
  | "explore"
  | "navigate-up"
  | "navigate-down"
  | "hold"
  | "alter"
  | "steal"
  | "sleep"
  | "sell"
  | "buy"
  | "stash"
  | "retrieve"
  | "spoil-artifact"
  | "spoil-mon"
  | "spoil-mon-brief"
  | "spoil-obj"
  | "wiz-acquire"
  | "wiz-advance"
  | "wiz-banish"
  | "wiz-change-item-quantity"
  | "wiz-collect-disconnect-stats"
  | "wiz-collect-obj-mon-stats"
  | "wiz-collect-pit-stats"
  | "wiz-create-all-artifact"
  | "wiz-create-all-artifact-from-tval"
  | "wiz-create-all-obj"
  | "wiz-create-all-obj-from-tval"
  | "wiz-create-artifact"
  | "wiz-create-obj"
  | "wiz-create-trap"
  | "wiz-cure-all"
  | "wiz-curse-item"
  | "wiz-detect-all-local"
  | "wiz-detect-all-monsters"
  | "wiz-dump-level-map"
  | "wiz-edit-player-exp"
  | "wiz-edit-player-gold"
  | "wiz-edit-player-start"
  | "wiz-edit-player-stat"
  | "wiz-hit-all-los"
  | "wiz-increase-exp"
  | "wiz-jump-level"
  | "wiz-learn-object-kinds"
  | "wiz-magic-map"
  | "wiz-peek-noise-scent"
  | "wiz-perform-effect"
  | "wiz-play-item"
  | "wiz-push-object"
  | "wiz-query-feature"
  | "wiz-query-square-flag"
  | "wiz-quit-no-save"
  | "wiz-recall-monster"
  | "wiz-rerate"
  | "wiz-reroll-item"
  | "wiz-stat-item"
  | "wiz-summon-named"
  | "wiz-summon-random"
  | "wiz-teleport-random"
  | "wiz-teleport-to"
  | "wiz-tweak-item"
  | "wiz-wipe-recall"
  | "wiz-wizard-light"
  | "retire"
  | "help"
  | "repeat"
  | "command-monster";

/** cmd_context. */
export type CommandContext = "init" | "birth" | "game" | "store" | "death";

/** Static per-command metadata from the upstream game_cmds[] table. */
export interface CommandInfo {
  verb: string;
  repeatAllowed: boolean;
  canUseEnergy: boolean;
  autoRepeatN: number;
}

/**
 * The upstream game_cmds[] table (verb, repeat_allowed, can_use_energy,
 * auto_repeat_n). Codes absent here (null, browse-spell, ignore, lock) are
 * UI-side only and cannot be queued, exactly as upstream cmd_idx()
 * returning -1. "lock" has no upstream game_cmd - do_cmd_lock_door is reached
 * from do_cmd_disarm on a closed unlocked door - so the port keeps it off this
 * closed-for-parity table and exposes it as an action-registry code instead
 * (game/cave-cmd.ts), reachable both directly and via the disarm dispatch.
 */
export const COMMAND_INFO: ReadonlyMap<CommandCode, CommandInfo> = new Map<
  CommandCode,
  CommandInfo
>([
  ["load-file", { verb: "load a savefile", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["new-game", { verb: "start a new game", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["birth-init", { verb: "start the character birth process", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["birth-reset", { verb: "go back to the beginning", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["choose-race", { verb: "select race", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["choose-class", { verb: "select class", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["buy-stat", { verb: "buy points in a stat", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["sell-stat", { verb: "sell points in a stat", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["reset-stats", { verb: "reset stats", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["refresh-stats", { verb: "refresh stats", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["roll-stats", { verb: "roll new stats", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["prev-stats", { verb: "use previously rolled stats", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["name-choice", { verb: "choose name", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["history-choice", { verb: "write history", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["accept-character", { verb: "accept character", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["go-up", { verb: "go up stairs", repeatAllowed: false, canUseEnergy: true, autoRepeatN: 0 }],
  ["go-down", { verb: "go down stairs", repeatAllowed: false, canUseEnergy: true, autoRepeatN: 0 }],
  ["walk", { verb: "walk", repeatAllowed: true, canUseEnergy: true, autoRepeatN: 0 }],
  ["run", { verb: "run", repeatAllowed: true, canUseEnergy: true, autoRepeatN: 0 }],
  ["explore", { verb: "explore", repeatAllowed: false, canUseEnergy: true, autoRepeatN: 0 }],
  ["navigate-up", { verb: "navigate up", repeatAllowed: false, canUseEnergy: true, autoRepeatN: 0 }],
  ["navigate-down", { verb: "navigate down", repeatAllowed: false, canUseEnergy: true, autoRepeatN: 0 }],
  ["jump", { verb: "jump", repeatAllowed: false, canUseEnergy: true, autoRepeatN: 0 }],
  ["open", { verb: "open", repeatAllowed: true, canUseEnergy: true, autoRepeatN: 99 }],
  ["close", { verb: "close", repeatAllowed: true, canUseEnergy: true, autoRepeatN: 99 }],
  ["tunnel", { verb: "tunnel", repeatAllowed: true, canUseEnergy: true, autoRepeatN: 99 }],
  ["hold", { verb: "stay still", repeatAllowed: true, canUseEnergy: true, autoRepeatN: 0 }],
  ["disarm", { verb: "disarm", repeatAllowed: true, canUseEnergy: true, autoRepeatN: 99 }],
  ["alter", { verb: "alter", repeatAllowed: true, canUseEnergy: true, autoRepeatN: 99 }],
  ["steal", { verb: "steal", repeatAllowed: false, canUseEnergy: true, autoRepeatN: 0 }],
  ["rest", { verb: "rest", repeatAllowed: false, canUseEnergy: true, autoRepeatN: 0 }],
  ["sleep", { verb: "sleep", repeatAllowed: false, canUseEnergy: true, autoRepeatN: 0 }],
  ["pathfind", { verb: "walk", repeatAllowed: false, canUseEnergy: true, autoRepeatN: 0 }],
  ["pickup", { verb: "pickup", repeatAllowed: false, canUseEnergy: true, autoRepeatN: 0 }],
  ["autopickup", { verb: "autopickup", repeatAllowed: false, canUseEnergy: true, autoRepeatN: 0 }],
  ["wield", { verb: "wear or wield", repeatAllowed: false, canUseEnergy: true, autoRepeatN: 0 }],
  ["takeoff", { verb: "take off", repeatAllowed: false, canUseEnergy: true, autoRepeatN: 0 }],
  ["drop", { verb: "drop", repeatAllowed: false, canUseEnergy: true, autoRepeatN: 0 }],
  ["uninscribe", { verb: "un-inscribe", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["autoinscribe", { verb: "autoinscribe", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["eat", { verb: "eat", repeatAllowed: false, canUseEnergy: true, autoRepeatN: 0 }],
  ["quaff", { verb: "quaff", repeatAllowed: false, canUseEnergy: true, autoRepeatN: 0 }],
  ["use-rod", { verb: "zap", repeatAllowed: true, canUseEnergy: true, autoRepeatN: 99 }],
  ["use-staff", { verb: "use", repeatAllowed: true, canUseEnergy: true, autoRepeatN: 99 }],
  ["use-wand", { verb: "aim", repeatAllowed: true, canUseEnergy: true, autoRepeatN: 99 }],
  ["read-scroll", { verb: "read", repeatAllowed: false, canUseEnergy: true, autoRepeatN: 0 }],
  ["activate", { verb: "activate", repeatAllowed: true, canUseEnergy: true, autoRepeatN: 99 }],
  ["refill", { verb: "refuel with", repeatAllowed: false, canUseEnergy: true, autoRepeatN: 0 }],
  ["fire", { verb: "fire", repeatAllowed: false, canUseEnergy: true, autoRepeatN: 0 }],
  ["throw", { verb: "throw", repeatAllowed: false, canUseEnergy: true, autoRepeatN: 0 }],
  ["inscribe", { verb: "inscribe", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["study", { verb: "study", repeatAllowed: false, canUseEnergy: true, autoRepeatN: 0 }],
  ["cast", { verb: "cast", repeatAllowed: false, canUseEnergy: true, autoRepeatN: 0 }],
  ["sell", { verb: "sell", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["stash", { verb: "stash", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["buy", { verb: "buy", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["retrieve", { verb: "retrieve", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["use", { verb: "use", repeatAllowed: true, canUseEnergy: true, autoRepeatN: 0 }],
  ["retire", { verb: "retire character", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["help", { verb: "help", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["repeat", { verb: "repeat", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["command-monster", { verb: "make a monster act", repeatAllowed: false, canUseEnergy: true, autoRepeatN: 0 }],
  ["spoil-artifact", { verb: "generate spoiler file for artifacts", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["spoil-mon", { verb: "generate spoiler file for monsters", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["spoil-mon-brief", { verb: "generate brief spoiler file for monsters", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["spoil-obj", { verb: "generate spoiler file for objects", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["wiz-acquire", { verb: "acquire objects", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["wiz-advance", { verb: "make character powerful", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["wiz-banish", { verb: "banish nearby monsters", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["wiz-change-item-quantity", { verb: "change number of an item", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["wiz-collect-disconnect-stats", { verb: "collect statistics about disconnected levels", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["wiz-collect-obj-mon-stats", { verb: "collect object/monster statistics", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["wiz-collect-pit-stats", { verb: "collect pit statistics", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["wiz-create-all-artifact", { verb: "create all artifacts", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["wiz-create-all-artifact-from-tval", { verb: "create all artifacts of a tval", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["wiz-create-all-obj", { verb: "create all objects", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["wiz-create-all-obj-from-tval", { verb: "create all objects of a tval", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["wiz-create-artifact", { verb: "create artifact", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["wiz-create-obj", { verb: "create object", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["wiz-create-trap", { verb: "create trap", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["wiz-cure-all", { verb: "cure everything", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["wiz-curse-item", { verb: "change a curse on an item", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["wiz-detect-all-local", { verb: "detect everything nearby", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["wiz-detect-all-monsters", { verb: "detect all monsters", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["wiz-dump-level-map", { verb: "write map of level", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["wiz-edit-player-exp", { verb: "change the player's experience", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["wiz-edit-player-gold", { verb: "change the player's gold", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["wiz-edit-player-start", { verb: "start editing the player", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["wiz-edit-player-stat", { verb: "edit one of the player's stats", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["wiz-hit-all-los", { verb: "hit all monsters in LOS", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["wiz-increase-exp", { verb: "increase experience", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["wiz-jump-level", { verb: "jump to a level", repeatAllowed: false, canUseEnergy: true, autoRepeatN: 0 }],
  ["wiz-learn-object-kinds", { verb: "learn about kinds of objects", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["wiz-magic-map", { verb: "map local area", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["wiz-peek-noise-scent", { verb: "peek at noise and scent", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["wiz-perform-effect", { verb: "perform an effect", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["wiz-play-item", { verb: "play with item", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["wiz-push-object", { verb: "push objects from square", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["wiz-query-feature", { verb: "highlight specific feature", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["wiz-query-square-flag", { verb: "query square flag", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["wiz-quit-no-save", { verb: "quit without saving", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["wiz-recall-monster", { verb: "recall monster", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["wiz-rerate", { verb: "rerate hitpoints", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["wiz-reroll-item", { verb: "reroll an item", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["wiz-stat-item", { verb: "get statistics for an item", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["wiz-summon-named", { verb: "summon specific monster", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["wiz-summon-random", { verb: "summon random monsters", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["wiz-teleport-random", { verb: "teleport", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["wiz-teleport-to", { verb: "teleport to location", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["wiz-tweak-item", { verb: "modify item attributes", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["wiz-wipe-recall", { verb: "erase monster recall", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
  ["wiz-wizard-light", { verb: "wizard light the level", repeatAllowed: false, canUseEnergy: false, autoRepeatN: 0 }],
]);

/** cmd_verb: the verb for a command, or null when unknown (as upstream). */
export function cmdVerb(code: CommandCode): string | null {
  return COMMAND_INFO.get(code)?.verb ?? null;
}

/** A typed command argument (the cmd_arg union, tagged). */
export type CommandArg =
  | { type: "string"; value: string }
  | { type: "choice"; value: number }
  | { type: "item"; value: unknown }
  | { type: "number"; value: number }
  | { type: "direction"; value: number }
  | { type: "target"; value: number }
  | { type: "point"; value: Loc };

export type CommandArgType = CommandArg["type"];

/** struct command. */
export interface Command {
  context: CommandContext;
  code: CommandCode;
  /** Number of times to attempt to repeat the command. */
  nrepeats: number;
  /**
   * 0: can be target for "repeat" and can trigger bloodlust coercion.
   * 1: cannot be repeat target, can trigger bloodlust.
   * >1: cannot be repeat target, cannot trigger bloodlust.
   */
  backgroundCommand: number;
  args: Map<string, CommandArg>;
}

/** Create an empty command with the given code. */
export function makeCommand(
  code: CommandCode,
  context: CommandContext = "init",
): Command {
  return { context, code, nrepeats: 0, backgroundCommand: 0, args: new Map() };
}

/** cmd_copy: deep copy (args map is cloned). */
export function cmdCopy(src: Command): Command {
  return {
    context: src.context,
    code: src.code,
    nrepeats: src.nrepeats,
    backgroundCommand: src.backgroundCommand,
    args: new Map(src.args),
  };
}

/** cmd_set_arg_*, unified: attach a typed argument by name. */
export function cmdSetArg(cmd: Command, name: string, arg: CommandArg): void {
  cmd.args.set(name, arg);
}

/**
 * cmd_get_arg_*, unified: fetch an argument, or null when absent or of the
 * wrong type (upstream CMD_ARG_NOT_PRESENT / CMD_ARG_WRONG_TYPE).
 */
export function cmdGetArg<T extends CommandArgType>(
  cmd: Command,
  name: string,
  type: T,
): Extract<CommandArg, { type: T }> | null {
  const arg = cmd.args.get(name);
  if (!arg || arg.type !== type) return null;
  return arg as Extract<CommandArg, { type: T }>;
}

export type CommandHandler = (cmd: Command) => void;

/**
 * Player-coupled pre-execution hook: upstream process_command redirects to
 * CMD_COMMAND_MONSTER while TMD_COMMAND is active and may substitute a
 * random attack under bloodlust. The game loop provides this once the
 * player exists; return "handled" to consume the command, or a
 * (possibly substituted) code to execute.
 */
export type CommandCoercion = (
  cmd: Command,
  info: CommandInfo,
) => CommandCode | "handled";

/** CMD_QUEUE_SIZE. */
export const CMD_QUEUE_SIZE = 20;

/**
 * The command queue: a bounded FIFO with repeat support, mirroring
 * cmd-core.c's ring buffer semantics (including the capacity of
 * CMD_QUEUE_SIZE - 1 pending commands and last-command tracking for the
 * "repeat" command).
 */
export class CommandQueue {
  private queue: Command[] = [];
  private lastCommand: Command | null = null;
  private currentCommand: Command | null = null;
  private repeatPrevAllowed = false;
  private repeating = false;
  private handlers = new Map<CommandCode, CommandHandler>();
  private coercion: CommandCoercion | null = null;
  /** Called when nrepeats changes (upstream: player redraw PR_STATE). */
  onRepeatChange: (() => void) | null = null;

  /** Register the handler for a command code (replaces game_cmds[].fn). */
  register(code: CommandCode, fn: CommandHandler): void {
    this.handlers.set(code, fn);
  }

  /** Install the player-coupled coercion hook (bloodlust, TMD_COMMAND). */
  setCoercion(fn: CommandCoercion | null): void {
    this.coercion = fn;
  }

  /** cmdq_peek: the most recently pushed command, if any. */
  peek(): Command | null {
    return this.queue.length > 0
      ? (this.queue[this.queue.length - 1] as Command)
      : null;
  }

  /**
   * cmdq_push_copy. Returns false on failure (queue full, or "repeat"
   * with nothing to repeat / repeat disabled), true on success.
   */
  pushCopy(cmd: Command): boolean {
    if (this.queue.length >= CMD_QUEUE_SIZE - 1) return false;
    if (cmd.code !== "repeat") {
      this.queue.push(cmd);
      return true;
    }
    if (!this.repeatPrevAllowed) return false;
    if (this.lastCommand && this.lastCommand.code !== "null") {
      this.queue.push(cmdCopy(this.lastCommand));
      return true;
    }
    return false;
  }

  /** cmdq_push_repeat: fails for codes not in the game_cmds table. */
  pushRepeat(code: CommandCode, nrepeats: number): boolean {
    if (!COMMAND_INFO.has(code)) return false;
    const cmd = makeCommand(code);
    cmd.nrepeats = nrepeats;
    return this.pushCopy(cmd);
  }

  /** cmdq_push. */
  push(code: CommandCode): boolean {
    return this.pushRepeat(code, 0);
  }

  /**
   * cmdq_pop: take the next command (or the current one again while
   * repeating) and process it. Returns false when there is nothing to do.
   */
  pop(ctx: CommandContext): boolean {
    let cmd: Command;
    if (this.repeating && this.currentCommand) {
      cmd = this.currentCommand;
    } else {
      const next = this.queue.shift();
      if (!next) return false;
      cmd = next;
      this.currentCommand = cmd;
    }
    if (!cmd.backgroundCommand) this.lastCommand = cmd;
    this.processCommand(ctx, cmd);
    return true;
  }

  /** cmdq_execute: drain the queue (and any repeats) synchronously. */
  execute(ctx: CommandContext): void {
    let guard = 100000;
    while (this.pop(ctx)) {
      if (--guard <= 0) {
        throw new Error("CommandQueue.execute: runaway repeat loop");
      }
    }
  }

  /** cmdq_flush: drop all pending commands. */
  flush(): void {
    this.queue.length = 0;
  }

  /** cmdq_release: flush and clear repeat bookkeeping. */
  release(): void {
    this.flush();
    this.lastCommand = null;
    this.currentCommand = null;
    this.repeating = false;
  }

  /** process_command. */
  private processCommand(ctx: CommandContext, cmd: Command): void {
    let info = COMMAND_INFO.get(cmd.code);
    if (!info) return;

    let handlerCode = cmd.code;
    if (this.coercion) {
      const coerced = this.coercion(cmd, info);
      if (coerced === "handled") return;
      if (coerced !== handlerCode) {
        const coercedInfo = COMMAND_INFO.get(coerced);
        if (!coercedInfo) return;
        handlerCode = coerced;
        info = coercedInfo;
      }
    }

    const oldRepeats = cmd.nrepeats;
    if (info.repeatAllowed) {
      if (info.autoRepeatN > 0 && cmd.nrepeats === 0) {
        this.setRepeat(info.autoRepeatN);
      }
    } else {
      cmd.nrepeats = 0;
      this.repeating = false;
    }

    this.repeatPrevAllowed = true;
    cmd.context = ctx;

    const fn = this.handlers.get(handlerCode);
    if (fn) fn(cmd);

    if (cmd.nrepeats > 0 && oldRepeats === this.getNRepeats()) {
      this.setRepeat(oldRepeats - 1);
    }
  }

  /** cmd_cancel_repeat. */
  cancelRepeat(): void {
    const cmd = this.currentCommand;
    if ((cmd && cmd.nrepeats) || this.repeating) {
      if (cmd) cmd.nrepeats = 0;
      this.repeating = false;
      this.onRepeatChange?.();
    }
  }

  /** cmd_set_repeat. */
  setRepeat(nrepeats: number): void {
    const cmd = this.currentCommand;
    if (cmd) cmd.nrepeats = nrepeats;
    this.repeating = nrepeats !== 0;
    this.onRepeatChange?.();
  }

  /** cmd_get_nrepeats. */
  getNRepeats(): number {
    return this.currentCommand?.nrepeats ?? 0;
  }

  /** cmd_disable_repeat. */
  disableRepeat(): void {
    this.repeatPrevAllowed = false;
  }

  /** Whether the queue is mid-repeat (upstream `repeating`). */
  isRepeating(): boolean {
    return this.repeating;
  }
}
