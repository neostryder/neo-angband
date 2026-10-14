/**
 * `ctx.options`: the game's own options (the '=' menu), for a mod that draws its
 * own options screen. Reading needs `state:options.read`; changing them needs
 * `options:write` as well.
 *
 * Only the user interface options and the three number settings can be changed.
 * Birth options lock when the character is created, and a cheat option costs
 * the character its place on the score table for good, so both stay in the
 * game's own menu where the player sets them directly.
 */

import { OPTION_ENTRIES, type GameState } from "@rpgm-tools/neo-angband-core";
import { notifyOptionsChanged, optionsFingerprint } from "./options";
import type { ModOptionsView, ModOptionsChange, ModOptionsResult, ModOptions } from "@rpgm-tools/neo-angband-core";
export type { ModOptionEntry, ModOptionsView, ModOptionsChange, ModOptionsResult, ModOptions } from "@rpgm-tools/neo-angband-core";

const PAGES = new Set(["INTERFACE", "BIRTH", "CHEAT", "SCORE"]);

function wholeIn(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

export function createModOptions(
  state: GameState,
  opts: { writable: boolean; afterChange?: () => void },
): ModOptions {
  const store = () => state.options;
  const get = (): ModOptionsView => {
    const options = store();
    const entries = OPTION_ENTRIES.filter((e) => PAGES.has(e.type)).map((e) => Object.freeze({
      name: e.name,
      description: e.description,
      page: e.type.toLowerCase(),
      value: options?.get(e.name) ?? e.normal,
      writable: opts.writable && e.type === "INTERFACE",
    }));
    return Object.freeze({
      entries: Object.freeze(entries),
      hitpointWarn: options?.hitpointWarn ?? 3,
      delayFactor: options?.delayFactor ?? 40,
      lazymoveDelay: options?.lazymoveDelay ?? 0,
    });
  };
  if (!opts.writable) return Object.freeze({ get });
  const set = (change: ModOptionsChange): ModOptionsResult => {
    const options = store();
    if (!options) return { ok: false, reason: "No game is running." };
    const values = Object.entries(change.values ?? {});
    for (const [name, value] of values) {
      const entry = OPTION_ENTRIES.find((e) => e.name === name);
      if (!entry) return { ok: false, reason: `There is no option named "${name}".` };
      if (entry.type !== "INTERFACE") return { ok: false, reason: `"${name}" can only be changed in the game's own options menu.` };
      if (typeof value !== "boolean") return { ok: false, reason: `"${name}" takes true or false.` };
    }
    if (change.hitpointWarn !== undefined && !wholeIn(change.hitpointWarn, 0, 9)) return { ok: false, reason: "The hit point warning is a whole number from 0 to 9." };
    if (change.delayFactor !== undefined && !wholeIn(change.delayFactor, 0, 255)) return { ok: false, reason: "The delay factor is a whole number from 0 to 255." };
    if (change.lazymoveDelay !== undefined && !wholeIn(change.lazymoveDelay, 0, 255)) return { ok: false, reason: "The movement delay is a whole number from 0 to 255." };
    const before = optionsFingerprint(state);
    const changed: string[] = [];
    for (const [name, value] of values) {
      if (options.get(name) !== value && options.set(name, value)) changed.push(name);
    }
    if (change.hitpointWarn !== undefined && options.hitpointWarn !== change.hitpointWarn) { options.hitpointWarn = change.hitpointWarn; changed.push("hitpointWarn"); }
    if (change.delayFactor !== undefined && options.delayFactor !== change.delayFactor) { options.delayFactor = change.delayFactor; changed.push("delayFactor"); }
    if (change.lazymoveDelay !== undefined && options.lazymoveDelay !== change.lazymoveDelay) { options.lazymoveDelay = change.lazymoveDelay; changed.push("lazymoveDelay"); }
    if (changed.length > 0) {
      notifyOptionsChanged(state, before);
      opts.afterChange?.();
    }
    return { ok: true, changed: Object.freeze(changed) };
  };
  return Object.freeze({ get, set });
}
