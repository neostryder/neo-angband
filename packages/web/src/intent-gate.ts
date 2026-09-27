/** Submit a mod's player intent through the host's ordinary input path. */
import {
  cmdVerb,
  createAgentActions,
  bumpInputRevision,
  disturb,
  floorPile,
  inputToken,
  targetAble,
  tokenIsCurrent,
  type ActionRegistry,
  type AgentCommand,
  type GameState,
  type InputToken,
  type PlayerCommand,
} from "@rpgm-tools/neo-angband-core";
import type { InputSnapshotSource } from "./input-snapshot";

export const INTENT_CAPABILITY = "input:intent";

export type PlayerIntent =
  | { readonly kind: "command"; readonly command: AgentCommand }
  | { readonly kind: "travel"; readonly x: number; readonly y: number; readonly modifiers?: Readonly<{ shift?: boolean; ctrl?: boolean }> }
  | { readonly kind: "target"; readonly midx: number }
  | { readonly kind: "target"; readonly x: number; readonly y: number }
  | { readonly kind: "stop-resting" }
  | { readonly kind: "ignore" | "unignore"; readonly handle: number }
  | { readonly kind: "item-rule"; readonly rule: "kind-aware" | "kind-unaware" | "ego" | "quality" | "note-aware" | "note-unaware"; readonly index: number; readonly itype?: number; readonly value: boolean | number | string };

export interface IntentResult {
  readonly accepted: boolean;
  readonly reason?: string;
  readonly code?: "controller-owned";
}

export interface ModIntent {
  submit(token: InputToken, intent: PlayerIntent): IntentResult;
  catalogue?(): Readonly<{ token: InputToken; commands: readonly Readonly<{ code: string; verb: string | null; args: string; phase: "play" | "store" }>[]; intents: readonly Readonly<{ kind: string; args: string }>[] }>;
}

export interface IntentGateDeps {
  readonly state: GameState;
  readonly registry: Pick<ActionRegistry, "has" | "codes">;
  readonly push: (command: PlayerCommand) => void;
  readonly advance: () => void;
  readonly snapshotSource: Pick<InputSnapshotSource, "phase" | "prompt">;
  /** The live store screen's own purchase and sale flow. */
  readonly storeCommand?: (command: AgentCommand) => boolean;
  readonly lookAt?: (at?: Readonly<{ x: number; y: number }>) => void;
  /**
   * The game's own cast flow for a chosen spell, for a cast intent that names
   * no direction: the low-mana question, the aim prompt and any item target,
   * then the cast. Without it such a cast aims at the current target.
   */
  readonly castSpell?: (spell: number) => boolean;
  /**
   * The game's own flow for using a chosen item, for a use intent that names
   * no direction: the aim prompt when the item needs one and any item its
   * effect targets, then the command. Without it such a use aims at the
   * current target.
   */
  readonly useItem?: (code: string, ref: Readonly<{ handle: number } | { floor: number }>) => boolean;
  readonly itemAction?: (intent: Extract<PlayerIntent, { kind: "ignore" | "unignore" | "item-rule" }>) => boolean;
}

const STORE_CODES = new Set(["shop-buy", "shop-sell", "shop-exit"]);
/** Item uses whose effect may ask for a direction or a target item first. */
const USE_CODES = new Set(["read", "quaff", "eat", "use-staff", "aim-wand", "zap-rod", "activate"]);
/** Action codes whose command in cmd_verb's table is spelled differently. */
const VERB_CODES: Readonly<Record<string, string>> = {
  "aim-wand": "use-wand",
  "zap-rod": "use-rod",
  read: "read-scroll",
  "shop-buy": "buy",
  "shop-sell": "sell",
};
const DIRECTION_CODES = new Set([
  "walk", "jump", "run", "open", "close", "disarm", "lock", "tunnel",
  "alter", "steal",
]);
const HANDLE_CODES = new Set([
  "quaff", "read", "eat", "wield", "takeoff", "drop", "destroy",
  "aim-wand", "zap-rod", "use-staff", "activate", "fire", "throw",
  "refill", "inscribe", "uninscribe", "shop-sell",
]);
const FLOOR_ITEM_CODES = new Set([
  "quaff", "read", "eat", "wield", "aim-wand", "zap-rod", "use-staff",
  "activate", "throw", "refill", "inscribe", "uninscribe", "pickup",
]);

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function integer(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function direction(value: unknown): boolean {
  return integer(value) && value >= 1 && value <= 9;
}

/** Keep malformed data out of both built-in and mod-registered handlers. */
function plainValue(value: unknown, seen = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (typeof value !== "object" || seen.has(value)) return false;
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype) return false;
  seen.add(value);
  const valid = Object.values(value).every((part) => plainValue(part, seen));
  seen.delete(value);
  return valid;
}

function validCommand(command: unknown): command is AgentCommand {
  if (!record(command) || typeof command.code !== "string" || !command.code) return false;
  if (Object.keys(command).some((key) => !["code", "dir", "args"].includes(key))) return false;
  if (command.dir !== undefined && !direction(command.dir)) return false;
  if (command.args !== undefined && (!record(command.args) || !plainValue(command.args))) return false;
  const args = command.args as Record<string, unknown> | undefined;
  if (DIRECTION_CODES.has(command.code) && !direction(command.dir)) return false;
  if (HANDLE_CODES.has(command.code) && !integer(args?.handle) &&
      !(FLOOR_ITEM_CODES.has(command.code) && integer(args?.floor))) return false;
  if (command.code === "pathfind") {
    if (!record(args?.dest) || Object.keys(args.dest).length !== 2 ||
        !integer(args.dest.x) || !integer(args.dest.y)) return false;
  }
  if (command.code === "cast" && (!integer(args?.spell) || args.spell < 0)) return false;
  if (command.code === "study" && !integer(args?.handle)) return false;
  if (args?.floor !== undefined && (!FLOOR_ITEM_CODES.has(command.code) || !integer(args.floor) || args.floor < 0)) return false;
  if (command.code === "shop-buy" && (!integer(args?.index) || args.index < 0)) return false;
  if (command.code === "look" && args !== undefined &&
      (Object.keys(args).length !== 2 || !integer(args.x) || !integer(args.y))) return false;
  if (command.code === "rest" && args?.count !== undefined && !integer(args.count)) return false;
  if (command.code === "inscribe" && typeof args?.inscription !== "string") return false;
  if (args?.quantity !== undefined && (!integer(args.quantity) || args.quantity < 1)) return false;
  if (args?.dir !== undefined && !direction(args.dir)) return false;
  return true;
}

const reject = (reason: string): IntentResult => ({ accepted: false, reason });

/** No state is written until every check has passed. */
export function createIntentGate(deps: IntentGateDeps): ModIntent {
  return {
    catalogue() {
      const commands = deps.registry.codes().map((code) => Object.freeze({ code,
        /* cmd_verb: the game's own name for the command, lower case, as it says
         * it mid-sentence. A mod's command has the verb it set with setVerb. */
        verb: cmdVerb(VERB_CODES[code] ?? code, deps.state.commandVerbs) ?? cmdVerb(code, deps.state.commandVerbs),
        phase: (STORE_CODES.has(code) ? "store" : "play") as "store" | "play",
        args: DIRECTION_CODES.has(code) ? "dir: 1..9" :
          code === "shop-sell" ? "args: {handle: integer, quantity?: positive integer (ignored)}" :
            FLOOR_ITEM_CODES.has(code) && HANDLE_CODES.has(code)
              ? "args: {handle: integer OR floor: nonnegative integer, quantity?: positive integer}" :
            HANDLE_CODES.has(code) ? "args: {handle: integer, quantity?: positive integer}" :
              code === "pickup" ? "args?: {floor: nonnegative integer}" :
              code === "shop-buy" ? "args: {index: nonnegative integer, quantity?: positive integer (ignored)}" :
              code === "cast" ? "args: {spell: nonnegative integer}" :
                code === "rest" ? "args?: {count: integer}" :
                  code === "pathfind" ? "args: {dest: {x: integer, y: integer}}" :
                  code === "study" ? "args: {handle: integer, spell?: nonnegative integer}" :
                    code === "look" ? "args?: {x: integer, y: integer}" :
                      "args?: plain object",
      }));
      const intents = [
        { kind: "travel", args: "x, y: integer; modifiers?: {shift?: boolean, ctrl?: boolean}" },
        { kind: "target", args: "midx: positive integer OR x, y: integer" },
        { kind: "stop-resting", args: "none" },
        { kind: "ignore", args: "handle: integer" },
        { kind: "unignore", args: "handle: integer" },
        { kind: "item-rule", args: "rule, index, value; itype?: integer" },
      ].map((entry) => Object.freeze(entry));
      return Object.freeze({ token: inputToken(deps.state), commands: Object.freeze(commands), intents: Object.freeze(intents) });
    },
    submit(token, intent): IntentResult {
      const { state, registry, snapshotSource } = deps;
      if (!tokenIsCurrent(state, token)) return reject("stale input token");
      if (record(intent) && intent.kind === "stop-resting") {
        if (Object.keys(intent).length !== 1 || !state.resting) return reject("not resting");
        disturb(state);
        bumpInputRevision(state);
        return { accepted: true };
      }
      if (snapshotSource.prompt?.() != null) return reject("a prompt is open");
      if (!record(intent)) return reject("malformed intent");
      const phase = snapshotSource.phase();
      if (intent.kind === "ignore" || intent.kind === "unignore" || intent.kind === "item-rule") {
        if (phase !== "play") return reject("input is not in play phase");
        if (intent.kind === "item-rule") {
          if (Object.keys(intent).some((key) => !["kind", "rule", "index", "itype", "value"].includes(key)) ||
              !integer(intent.index) || (intent.itype !== undefined && !integer(intent.itype))) {
            return reject("malformed item rule");
          }
        } else if (Object.keys(intent).length !== 2 || !integer(intent.handle)) {
          return reject("malformed item action");
        }
        return deps.itemAction?.(intent) ? { accepted: true } : reject("invalid item action");
      }
      if (intent.kind === "target") {
        if (phase !== "play") return reject("input is not in play phase");
        const keys = Object.keys(intent);
        const actions = createAgentActions(state);
        if (keys.length === 2 && "midx" in intent && integer(intent.midx) &&
            intent.midx > 0 && targetAble(state, state.monsters[intent.midx] ?? null)) {
          actions.setTargetMonster(intent.midx);
          return { accepted: true };
        }
        if (keys.length === 3 && "x" in intent && "y" in intent && integer(intent.x) && integer(intent.y)) {
          if (!state.chunk.inBoundsFully({ x: intent.x, y: intent.y })) return reject("malformed target location");
          actions.setTargetLocation(intent.x, intent.y);
          return { accepted: true };
        }
        return reject("malformed target");
      }
      let command: AgentCommand;
      if (intent.kind === "travel") {
        if (Object.keys(intent).some((key) => !["kind", "x", "y", "modifiers"].includes(key)) ||
            !integer(intent.x) || !integer(intent.y) ||
            !state.chunk.inBounds({ x: intent.x, y: intent.y })) return reject("malformed travel destination");
        const modifiers = intent.modifiers;
        if (modifiers !== undefined && (!record(modifiers) ||
            Object.keys(modifiers).some((key) => !["shift", "ctrl"].includes(key)) ||
            Object.values(modifiers).some((value) => typeof value !== "boolean"))) return reject("malformed modifiers");
        if (modifiers?.ctrl) {
          if (phase !== "play") return reject("input is not in play phase");
          if (!state.chunk.inBoundsFully({ x: intent.x, y: intent.y })) return reject("malformed target location");
          createAgentActions(state).setTargetLocation(intent.x, intent.y);
          return { accepted: true };
        }
        if (modifiers?.shift) {
          const dx = intent.x - state.actor.grid.x;
          const dy = intent.y - state.actor.grid.y;
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== 1) return reject("run needs an adjacent grid");
          command = createAgentActions(state).raw("run");
          command = { ...command, dir: (1 - dy) * 3 + (dx + 2) };
        } else command = createAgentActions(state).raw("pathfind", { dest: { x: intent.x, y: intent.y } });
      } else if (intent.kind === "command") {
        if (Object.keys(intent).length !== 2 || !validCommand(intent.command)) return reject("malformed command arguments");
        command = intent.command;
      } else {
        return reject("malformed intent");
      }
      if (phase !== "play" && !(phase === "store" && STORE_CODES.has(command.code))) {
        return reject("input is not in play phase");
      }
      if (phase === "play" && STORE_CODES.has(command.code)) return reject("store is not open");
      if (!registry.has(command.code)) return reject("unknown command code");
      if (!validCommand(command)) return reject("malformed command arguments");
      const floor = command.args?.floor;
      if (typeof floor === "number" && floor >= floorPile(state, state.actor.grid).length) {
        return reject("no object at that floor index");
      }
      if (command.code === "pathfind" &&
          !state.chunk.inBounds(command.args!.dest as { x: number; y: number })) {
        return reject("malformed travel destination");
      }
      if (command.code === "look" && deps.lookAt) {
        const at = command.args as { x: number; y: number } | undefined;
        if (at && !state.chunk.inBoundsFully(at)) return reject("malformed look location");
        deps.lookAt(at);
        return { accepted: true };
      }
      if (command.code === "cast" && command.args?.dir === undefined && deps.castSpell) {
        return deps.castSpell(command.args!.spell as number)
          ? { accepted: true }
          : reject("cannot cast right now");
      }
      if (USE_CODES.has(command.code) && command.args?.dir === undefined && deps.useItem) {
        const args = command.args!;
        const ref = typeof args.floor === "number" ? { floor: args.floor } : { handle: args.handle as number };
        return deps.useItem(command.code, ref) ? { accepted: true } : reject("cannot use that item right now");
      }
      if (command.code === "shop-buy" || command.code === "shop-sell") {
        return deps.storeCommand?.(command)
          ? { accepted: true }
          : reject("store is not ready");
      }
      deps.push(command);
      deps.advance();
      return { accepted: true };
    },
  };
}
