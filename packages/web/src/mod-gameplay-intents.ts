import { MOD_PERMISSION_TEXT } from "@rpgm-tools/neo-angband-mod-sdk";
import type { ModIntent, PlayerIntent } from "@rpgm-tools/neo-angband-core";

const GAMEPLAY_COMMANDS = new Set([
  "walk", "jump", "run", "hold", "rest", "ascend", "descend", "pathfind", "open", "close", "disarm", "lock", "tunnel", "alter", "steal",
  "quaff", "read", "eat", "wield", "takeoff", "drop", "pickup", "destroy", "aim-wand", "zap-rod", "use-staff", "activate", "fire", "throw",
  "refill", "inscribe", "uninscribe", "cast", "study", "look", "search", "shop-buy", "shop-sell", "shop-exit",
]);

export function gameplayIntent(intent: PlayerIntent): boolean {
  return intent !== null && typeof intent === "object" &&
    (intent.kind === "command" ? GAMEPLAY_COMMANDS.has(intent.command?.code) :
      ["target", "travel", "stop-resting", "ignore", "unignore", "item-rule"].includes(intent.kind));
}

export function gameplayIntents(gate: ModIntent): ModIntent {
  return {
    ...(gate.catalogue ? { catalogue: () => {
      const catalogue = gate.catalogue!();
      return { ...catalogue, commands: catalogue.commands.filter((command) => GAMEPLAY_COMMANDS.has(command.code)) };
    } } : {}),
    submit: (token, intent) => gameplayIntent(intent) ? gate.submit(token, intent) : { accepted: false, reason: MOD_PERMISSION_TEXT.gameplay },
  };
}
