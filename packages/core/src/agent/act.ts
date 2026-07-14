/**
 * The act facade (P7.7): the BORG_AS_MOD section-3 semantic verbs as typed
 * command builders over the engine's PlayerCommand model, plus set-target as a
 * direct state action (target.c). The arg keys match what the ported actions
 * read (game/obj-cmd.ts, spell-cmd.ts, ranged-cmd.ts, cave-cmd.ts): item verbs
 * carry `handle`, drop adds `quantity`, cast carries `spell`, movement/terrain
 * verbs carry `dir`.
 *
 * Building a command is always legal; whether a code is fully wired in the
 * engine yet is orthogonal to the contract (several are stubs today and are
 * completed as the Borg port, P8, drives them). Store verbs emit semantic codes
 * that the store API binds in P8; they are here so the contract is complete.
 *
 * Capability: command:add (enforced at controller install, controller.ts).
 */

import type { GameState } from "../game/context";
import { targetSetLocation, targetSetMonster } from "../game/target";
import { loc } from "../loc";
import type { AgentActions, AgentCommand } from "./types";

/** Build the act facade bound to a live state. */
export function createAgentActions(state: GameState): AgentActions {
  const cmd = (code: string, args?: Record<string, unknown>): AgentCommand =>
    args ? { code, args } : { code };
  const dirCmd = (code: string, dir: number): AgentCommand => ({ code, dir });
  const itemCmd = (code: string, handle: number): AgentCommand =>
    cmd(code, { handle });

  return {
    move: (dir) => dirCmd("walk", dir),
    melee: (dir) => dirCmd("walk", dir),
    hold: () => cmd("hold"),
    rest: () => cmd("rest"),
    descend: () => cmd("descend"),
    ascend: () => cmd("ascend"),
    tunnel: (dir) => dirCmd("tunnel", dir),
    open: (dir) => dirCmd("open", dir),
    close: (dir) => dirCmd("close", dir),
    disarm: (dir) => dirCmd("disarm", dir),

    quaff: (handle) => itemCmd("quaff", handle),
    read: (handle) => itemCmd("read", handle),
    eat: (handle) => itemCmd("eat", handle),
    wear: (handle) => itemCmd("wield", handle),
    takeoff: (handle) => itemCmd("takeoff", handle),
    drop: (handle, number) =>
      cmd("drop", number !== undefined ? { handle, quantity: number } : { handle }),
    pickup: () => cmd("pickup"),
    destroy: (handle) => itemCmd("destroy", handle),
    aimWand: (handle) => itemCmd("aim-wand", handle),
    zapRod: (handle) => itemCmd("zap-rod", handle),
    useStaff: (handle) => itemCmd("use-staff", handle),
    activate: (handle) => itemCmd("activate", handle),

    fire: (handle) => itemCmd("fire", handle),
    throw: (handle) => itemCmd("throw", handle),
    cast: (spell) => cmd("cast", { spell }),

    setTargetMonster: (midx) => {
      const mon = state.monsters[midx] ?? null;
      return targetSetMonster(state, mon);
    },
    setTargetLocation: (x, y) => {
      targetSetLocation(state, loc(x, y));
    },

    shopBuy: (index, number) =>
      cmd("shop-buy", number !== undefined ? { index, quantity: number } : { index }),
    shopSell: (handle, number) =>
      cmd("shop-sell", number !== undefined ? { handle, quantity: number } : { handle }),
    shopExit: () => cmd("shop-exit"),

    raw: (code, args) => cmd(code, args),
  };
}
