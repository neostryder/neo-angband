/**
 * The game's own screens a first-party mod can draw instead (`manage.screens.take`).
 *
 * A mod holding `screens:manage` names the screens it draws; the game opens the
 * mod's handler where it would have opened its own. A handler that rejects, or a
 * screen nobody took, falls back to the game's screen, so a mod that fails to open
 * never leaves the player without a way to manage mods.
 */
import type { Api2ScreenHandler, Api2ScreenKey } from "@rpgm-tools/neo-angband-mod-sdk";
import { log } from "./logging";

const SCREEN_KEYS: readonly Api2ScreenKey[] = ["mods"];

interface Taken {
  readonly modId: string;
  readonly handler: Api2ScreenHandler;
}

const taken = new Map<Api2ScreenKey, Taken>();

export function isScreenKey(key: string): key is Api2ScreenKey {
  return (SCREEN_KEYS as readonly string[]).includes(key);
}

/** The screen a mod already holds that blocks this request, or null. */
export function screenHeldByOther(modId: string, keys: readonly Api2ScreenKey[]): Api2ScreenKey | null {
  for (const key of keys) {
    const held = taken.get(key);
    if (held && held.modId !== modId) return key;
  }
  return null;
}

/** Hold these screens for the mod; the returned function lets them go. */
export function takeScreens(modId: string, handlers: Partial<Record<Api2ScreenKey, Api2ScreenHandler>>): () => void {
  const mine: Api2ScreenKey[] = [];
  for (const key of SCREEN_KEYS) {
    const handler = handlers[key];
    if (typeof handler !== "function") continue;
    taken.set(key, { modId, handler });
    mine.push(key);
  }
  return () => {
    for (const key of mine) if (taken.get(key)?.modId === modId) taken.delete(key);
  };
}

/** Run the mod's screen if one is held; answers whether the player was shown it. */
export async function openTakenScreen(key: Api2ScreenKey): Promise<boolean> {
  const held = taken.get(key);
  if (!held) return false;
  try {
    await held.handler();
    return true;
  } catch (err) {
    log.error("mods", `${held.modId} could not open the ${key} screen; the game's own screen opens instead:`, err);
    return false;
  }
}

/** Forget every hold (tests and a full reload). */
export function resetTakenScreens(): void {
  taken.clear();
}
