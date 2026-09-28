/**
 * The payload of the `player-command` event (#300): a command the player issued,
 * as plain frozen data. The host builds it as the game loop takes the command.
 */

import type { PlayerCommand, PlayerCommandEventData } from "@rpgm-tools/neo-angband-core";

type CommandCopy = { code: string; dir?: number; args?: Readonly<Record<string, unknown>> };

function deepFreezeData<T>(value: T): T {
  if (value !== null && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) deepFreezeData(child);
    Object.freeze(value);
  }
  return value;
}

/** A copy of `cmd` with its arguments cloned. Arguments that are not plain data are left out. */
function commandCopy(cmd: PlayerCommand): CommandCopy {
  let args: Readonly<Record<string, unknown>> | undefined;
  if (cmd.args !== undefined) {
    try {
      args = deepFreezeData(structuredClone(cmd.args));
    } catch {
      /* a function or a live object in the arguments */
    }
  }
  return Object.freeze({
    code: cmd.code,
    ...(cmd.dir !== undefined ? { dir: cmd.dir } : {}),
    ...(args !== undefined ? { args } : {}),
  });
}

export function playerCommandEvent(
  cmd: PlayerCommand,
  phase: "play" | "store",
  repeats: PlayerCommand | null,
  token: { readonly epoch: number; readonly revision: number },
): PlayerCommandEventData {
  return Object.freeze({
    ...commandCopy(cmd),
    ...(repeats ? { repeats: commandCopy(repeats) } : {}),
    phase,
    token: Object.freeze({ epoch: token.epoch, revision: token.revision }),
  });
}
