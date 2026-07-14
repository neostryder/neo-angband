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
 * Capability: command:add - enforced per verb when an AgentCapabilities is
 * supplied (and still at controller install, controller.ts). With no caps (a
 * trusted in-process host) every verb is granted.
 */

import type { GameState } from "../game/context";
import { targetSetLocation, targetSetMonster } from "../game/target";
import { loc } from "../loc";
import { AgentCapabilityError } from "./types";
import type { AgentActions, AgentCapabilities, AgentCommand } from "./types";

/**
 * Wrap every act verb so it throws AgentCapabilityError unless the caller was
 * granted "command:add". With no AgentCapabilities (a trusted in-process host)
 * the facade is returned unchanged - every verb is granted.
 */
function gateActions(
  actions: AgentActions,
  caps: AgentCapabilities | undefined,
): AgentActions {
  if (!caps) return actions;
  const guard = (): void => {
    if (!caps.has("command:add")) {
      throw new AgentCapabilityError(
        `agent act: capability "command:add" is not granted`,
      );
    }
  };
  const out = {} as Record<string, (...args: unknown[]) => unknown>;
  for (const [key, fn] of Object.entries(actions) as [
    string,
    (...args: unknown[]) => unknown,
  ][]) {
    out[key] = (...args: unknown[]): unknown => {
      guard();
      return fn(...args);
    };
  }
  return out as unknown as AgentActions;
}

/** Build the act facade bound to a live state, gated by the given caps. */
export function createAgentActions(
  state: GameState,
  caps?: AgentCapabilities,
): AgentActions {
  const cmd = (code: string, args?: Record<string, unknown>): AgentCommand =>
    args ? { code, args } : { code };
  const dirCmd = (code: string, dir: number): AgentCommand => ({ code, dir });
  const itemCmd = (code: string, handle: number): AgentCommand =>
    cmd(code, { handle });

  const actions: AgentActions = {
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

  return gateActions(actions, caps);
}
