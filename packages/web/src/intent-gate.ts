/** Submit a mod's player intent through the host's ordinary input path. */
import {
  createAgentActions,
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
  | { readonly kind: "travel"; readonly x: number; readonly y: number }
  | { readonly kind: "target"; readonly midx: number }
  | { readonly kind: "target"; readonly x: number; readonly y: number };

export interface IntentResult {
  readonly accepted: boolean;
  readonly reason?: string;
  readonly code?: "controller-owned";
}

export interface ModIntent {
  submit(token: InputToken, intent: PlayerIntent): IntentResult;
}

export interface IntentGateDeps {
  readonly state: GameState;
  readonly registry: Pick<ActionRegistry, "has">;
  readonly push: (command: PlayerCommand) => void;
  readonly advance: () => void;
  readonly snapshotSource: Pick<InputSnapshotSource, "phase" | "prompt">;
}

const STORE_CODES = new Set(["shop-buy", "shop-sell", "shop-exit"]);
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
  "activate", "throw", "refill", "inscribe", "uninscribe",
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
  if (command.code === "shop-buy" && (!integer(args?.index) || args.index < 0)) return false;
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
    submit(token, intent): IntentResult {
      const { state, registry, snapshotSource } = deps;
      if (!tokenIsCurrent(state, token)) return reject("stale input token");
      if (snapshotSource.prompt?.() != null) return reject("a prompt is open");
      if (!record(intent)) return reject("malformed intent");
      const phase = snapshotSource.phase();
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
        if (Object.keys(intent).length !== 3 || !integer(intent.x) || !integer(intent.y) ||
            !state.chunk.inBounds({ x: intent.x, y: intent.y })) return reject("malformed travel destination");
        command = createAgentActions(state).raw("pathfind", { dest: { x: intent.x, y: intent.y } });
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
      if (command.code === "pathfind" &&
          !state.chunk.inBounds(command.args!.dest as { x: number; y: number })) {
        return reject("malformed travel destination");
      }
      deps.push(command);
      deps.advance();
      return { accepted: true };
    },
  };
}
