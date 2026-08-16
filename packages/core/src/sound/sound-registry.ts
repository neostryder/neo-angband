/**
 * The PRODUCER for `sound:` prefs - the half `SOUND_PREF_ENTRIES` never had.
 *
 * `SoundEngine.loadPrefs` (engine.ts) has always taken `readonly {type, sounds}[]`
 * and always skipped a name `message_lookup_by_name` does not know, so the
 * CONSUMER was open from the day it was ported. Its only caller handed it the
 * compiled-in `SOUND_PREF_ENTRIES` constant and nothing else, which made a
 * 149-entry table that a mod could read and never add to - the exact shape of
 * the #159 failure mode ("the registry and the consumer already exist; what is
 * missing is a producer a mod can reach", MOD_REACH.md:440-460).
 *
 * APPEND AFTER THE COMPILED SLOTS, never instead of them. `allSoundPrefEntries`
 * returns the 149 compiled entries first, in file order, then whatever mods
 * registered, in registration order. The compiled prefix is byte-identical with
 * and without a mod - `sound-registry.test.ts` asserts that directly - which is
 * the same invariant `bindProjections` keeps for its 56 compiled PROJ slots.
 *
 * LAST WRITER WINS, PER MESSAGE, and that is deliberate. `message_sound_define`
 * (sound-core.c:179) CLEARS a message's sample list before assigning, so a later
 * entry for `type: "HIT"` replaces core's samples rather than adding to them.
 * That is upstream's own behaviour for a second `sound:HIT:` line in a prf file,
 * and it is what lets a sound-pack mod re-point a core message at its own
 * samples. A mod that wants to ADD to core's list repeats core's names.
 *
 * MODULE-LEVEL, NOT PER GAME, because the sound engine is per FRONT END and not
 * per character: `installWebSound` is called once at boot and the engine
 * outlives every game. This matches `effectInfoRegistry` / `randartRegistry` /
 * `runeRegistry` / `tvalRegistry` rather than the per-game
 * `ProjectionHandlerRegistry`, and `clear()` is the session-teardown seam that
 * keeps a test (or a disabled mod, after the reload the mod manager forces)
 * from leaking into the next boot.
 */

import { SOUND_PREF_ENTRIES } from "./sound-prefs-data.js";
import type { SoundPrefEntry } from "./sound-prefs-data.js";

/** One mod's registration, kept whole so a conflict report can name the owner. */
export interface SoundPrefContribution {
  /** The mod id that registered these, or null for an unattributed host call. */
  readonly owner: string | null;
  /** The entries, in the order the mod supplied them. */
  readonly entries: readonly SoundPrefEntry[];
}

/** The structural target `RegistryTargets.sounds` accepts. */
export interface SoundPrefRegistryTarget {
  /** Append entries, played after every compiled-in `sound:` directive. */
  add(entries: readonly SoundPrefEntry[], owner?: string): void;
  /** Everything registered so far, in registration order. Core's are NOT included. */
  added(): readonly SoundPrefEntry[];
}

/** Notified with just the batch a mod added; returns nothing. */
export type SoundPrefListener = (entries: readonly SoundPrefEntry[]) => void;

/**
 * Mod-supplied `sound:` directives, appended after the compiled-in table.
 *
 * An entry whose `type` names no MSG_ - core's or a mod's, since
 * `messageLookupByName` consults the message-type registry too - is dropped by
 * `loadPrefs`, exactly as upstream drops such a prf line. Registration is
 * therefore never the place a typo'd message name crashes.
 */
export class SoundPrefRegistry implements SoundPrefRegistryTarget {
  readonly #contributions: SoundPrefContribution[] = [];
  readonly #listeners = new Set<SoundPrefListener>();

  add(entries: readonly SoundPrefEntry[], owner?: string): void {
    if (!Array.isArray(entries)) {
      throw new TypeError("sound prefs: entries must be an array");
    }
    for (const e of entries) {
      if (e === null || typeof e !== "object") {
        throw new TypeError("sound prefs: each entry must be an object");
      }
      if (typeof e.type !== "string" || e.type.length === 0) {
        throw new TypeError("sound prefs: entry.type must be a non-empty MSG_ name");
      }
      if (typeof e.sounds !== "string") {
        throw new TypeError(
          `sound prefs: ${e.type}: entry.sounds must be a space-separated string`,
        );
      }
    }
    const copied = entries.map((e) => ({ type: e.type, sounds: e.sounds }));
    this.#contributions.push({ owner: owner ?? null, entries: copied });
    for (const listener of [...this.#listeners]) listener(copied);
  }

  /**
   * Subscribe to later registrations, and the reason this seam exists at all.
   *
   * ORDERING WAS THE TRAP, and it is the #159 failure mode in its second form -
   * installed but never consulted. `installWebSound` runs at module scope in
   * main.ts (:8821); a plugin's `register()` runs ~2,100 lines later (:10985).
   * A registry read once at install time would therefore have been read BEFORE
   * every mod that could write to it, and the seam would have looked correct in
   * every review and worked for nobody. So the front end reads the registry at
   * install AND subscribes: a batch registered afterwards is applied to the
   * live engine immediately, and the order of the two stops mattering.
   *
   * Returns the unsubscribe, which `SoundEngine`'s owner calls on teardown.
   */
  onAdd(listener: SoundPrefListener): () => void {
    this.#listeners.add(listener);
    return (): void => {
      this.#listeners.delete(listener);
    };
  }

  added(): readonly SoundPrefEntry[] {
    return this.#contributions.flatMap((c) => c.entries);
  }

  /** Every registration with its owner, for the conflict report. */
  contributions(): readonly SoundPrefContribution[] {
    return [...this.#contributions];
  }

  /** Bind attribution to one mod, the way `MenuRegistry.forOwner` does. */
  forOwner(owner: string): SoundPrefRegistryTarget {
    return {
      add: (entries): void => this.add(entries, owner),
      added: (): readonly SoundPrefEntry[] => this.added(),
    };
  }

  /** Test / session teardown: no installed mod means no entry survives. */
  clear(): void {
    this.#contributions.length = 0;
    this.#listeners.clear();
  }
}

/** The live sound-pref door. `installWebSound` reads it at boot. */
export const soundPrefRegistry = new SoundPrefRegistry();

/**
 * The compiled-in 149 followed by every mod-supplied entry - what a front end
 * hands to `SoundEngine.loadPrefs`. Keeping this in core means the ONE call
 * site a front end has to get right is a single expression, and the append
 * order is asserted in core rather than per front end.
 */
export function allSoundPrefEntries(
  registry: SoundPrefRegistryTarget = soundPrefRegistry,
): readonly SoundPrefEntry[] {
  const added = registry.added();
  return added.length === 0 ? SOUND_PREF_ENTRIES : [...SOUND_PREF_ENTRIES, ...added];
}
