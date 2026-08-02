/**
 * A mod's preferences: its own data, kept OUTSIDE any character's save.
 *
 * WHY THIS EXISTS, AND WHY THE SAVE BAG IS NOT IT.
 *
 * A mod already has somewhere to keep data: its save bag, `game.mods[id]`, which
 * core round-trips verbatim and never reads. That bag belongs to a CHARACTER. It
 * is written into the save file, it travels with that save to another machine,
 * and it dies with the character - which is right for "what this mod did to this
 * game" and exactly wrong for "what this player likes".
 *
 * There was no second place, so a mod that wanted to remember anything past a
 * death had two options and both were bad: reach for `localStorage` itself,
 * which hard-codes a browser and quietly breaks on any front end that has no
 * such thing; or keep it in the bag and lose it with the character. This is the
 * second place, and the host owns it, so a mod asks for storage rather than for
 * a browser.
 *
 * SHAPE: one JSON value per mod, replaced whole. Not a key/value map, because a
 * map invites a mod to grow keys it never cleans up and gives the host no moment
 * at which it holds the whole picture; one blob is the same thing the bag is, so
 * a mod author has one model for both and the only difference is the lifetime.
 *
 * SCOPED BY MOD ID, fixed by the host at construction exactly like `assetUrl`:
 * the id a mod gets is the id it was loaded under, so no mod can read or write
 * another's preferences by passing a different one.
 *
 * NOT A SECURITY BOUNDARY. In-process plugin code can reach `localStorage`
 * regardless; the boundary for trusted code is the consent prompt. This is here
 * so the honest path is also the portable one.
 */

import { log } from "./logging";

/** The per-mod storage key. One key per mod, so removing a mod is one delete. */
export function modPrefsKey(id: string): string {
  return `neo:modPrefs:${id}`;
}

/** What a plugin is handed as `ctx.prefs`. */
export interface ModPrefs {
  /**
   * This mod's stored value, or null when it has never stored one. Parsed fresh
   * on every call rather than cached: the game and the mod manager both run in
   * this tab, and a cached copy would go stale the moment a profile is applied.
   */
  get(): unknown;
  /**
   * Replace this mod's stored value. Passing null or undefined REMOVES it, so a
   * mod can forget what it knows without leaving an empty husk behind.
   */
  set(value: unknown): void;
}

/** The storage a ModPrefs reads and writes. `localStorage`, in both front ends. */
export type PrefsStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/**
 * The default backing store, or null where there is none.
 *
 * Null is a real answer, not a failure: a front end without storage (a private
 * window with it disabled, a future terminal shell) gets preferences that do not
 * persist, and a mod written against this seam still runs. The alternative -
 * throwing - would take down a mod for a facility it may only use at shutdown.
 */
export function defaultPrefsStorage(): PrefsStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    /* Access itself throws in some embedded contexts, before any get/set. */
    return null;
  }
}

/**
 * Build the ModPrefs for one mod.
 *
 * Every failure is swallowed and logged rather than thrown. A quota error on
 * `set`, or a value some other tool corrupted on `get`, must not travel back
 * into plugin code that called this from inside a hook - the mod would take the
 * blame, and the guard would latch a hook that is not broken.
 */
export function modPrefs(
  id: string,
  storage: PrefsStorage | null = defaultPrefsStorage(),
): ModPrefs {
  const key = modPrefsKey(id);
  return {
    get(): unknown {
      if (!storage) return null;
      try {
        const raw = storage.getItem(key);
        return raw === null ? null : (JSON.parse(raw) as unknown);
      } catch (err) {
        log.warn(`mod:${id}`, "stored preferences could not be read", err);
        return null;
      }
    },
    set(value: unknown): void {
      if (!storage) return;
      try {
        if (value === null || value === undefined) storage.removeItem(key);
        else storage.setItem(key, JSON.stringify(value));
      } catch (err) {
        log.warn(`mod:${id}`, "preferences could not be saved", err);
      }
    },
  };
}
