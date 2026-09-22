/**
 * Telling a genuine key-repeat apart from a fresh press (neo-angband#35).
 *
 * The player-visible symptom investigated on that ticket - holding a key, or
 * pressing one repeatedly, keeps firing the action even after release, or
 * after a fast monster closes distance - was traced to the browser/OS's own
 * native key-repeat event dispatch (an `event.repeat: true` keydown fired at
 * the OS's own repeat rate while a key stays held), not to any queue this
 * codebase owns. `input-queue.ts`'s queue only ever holds keymap-macro
 * expansions; ordinary movement keys take a synchronous path straight to
 * `main.ts`'s own `commandBuffer`, one command per keydown task, with nothing
 * accumulating anywhere in this codebase's own arrays. That native dispatch is
 * below JS-array visibility, so nothing here could purge it the way upstream's
 * C-level type-ahead buffer purges a stale one (Term_flush).
 *
 * This module is the read-side primitive that closes that gap: given a
 * keydown, decide whether it is a continuation of a held key rather than a
 * fresh, deliberate one. Two independent signals feed that judgment:
 *
 *   - `event.repeat` - the browser's own flag, true on every auto-generated
 *     event a held key produces after the OS's initial repeat delay. This is
 *     the primary signal and, on every desktop browser this was checked
 *     against, a reliable one.
 *   - The gap since the last keydown of the SAME key. An OS auto-repeat
 *     cadence lands well under any human's fastest deliberate double-tap of
 *     one key, so a suspiciously tight gap is treated as a repeat even on a
 *     keydown that (a synthetic dispatch, or an unusual host) failed to set
 *     `repeat` at all.
 *
 * A third figure - how stale the event was BY THE TIME it was classified,
 * `now` minus `event.timeStamp` - is measured and exposed as `ageMs` but does
 * NOT by itself flip `isRepeat`. That figure is what the "fast monster closes
 * distance" half of the symptom actually is: a backlog of already-queued
 * events, still real repeats of a key already let go, sitting behind a main
 * thread too busy to reach them promptly. But a single fresh keypress can
 * legitimately arrive late for the same reason (a slow frame, not a held key),
 * so folding staleness into `isRepeat` on its own would misclassify a real,
 * once-only press as a repeat. A future consumer that wants to drop stale
 * events outright - the mod-side toggle this ticket defers - has the figure
 * to build that policy on; this primitive only reports it.
 *
 * PURE AND FRAMEWORK-FREE ON PURPOSE. Nothing here touches the DOM, `main.ts`,
 * or any module-scope shell state - it takes plain data in and returns plain
 * data out, so it is directly unit-testable (key-repeat.test.ts) without the
 * source-slicing `main.ts` needs for logic that closes over its own shell
 * state (see main-long-press.test.ts's header for why that slicing exists).
 * `main.ts` owns exactly one `KeyRepeatTracker`, fed from the top of its root
 * keydown listener, and exposes its `last()` verdict to mods through
 * `ctx.keyRepeat` (mod-plugin.ts / mod-context.ts) - a host/DOM-timing
 * primitive with no `GameState` involvement, so it lives in `packages/web`
 * only, the same reasoning docs/modding/CLOUD_BACKUP_DESIGN.md gives for why
 * `ctx.backupFolder` never touches `packages/core`.
 *
 * This is the HOST HALF of #35 only. Nothing here, or anywhere else in this
 * codebase yet, uses the verdict to suppress or alter a command - a mod's own
 * QoL toggle for that is a separate, later change in a different repository.
 */

/**
 * How closely two keydowns of the SAME key can land and still plausibly be two
 * separate, deliberate human presses.
 *
 * Chosen well below a fast typist's fastest measured intentional double-tap of
 * one key (rarely under 100ms even for a practiced player) and comfortably
 * above the tightest cadence an OS auto-repeat setting produces once repeating
 * (commonly 20-50ms at the fast end of a "key repeat rate" slider). A
 * synthetic or replayed burst tighter than this is treated as a repeat even
 * when it carries no `repeat: true` flag at all.
 */
export const MIN_HUMAN_KEYPRESS_INTERVAL_MS = 60;

/** The minimal shape `classify()` needs. A real `KeyboardEvent` satisfies this
 * structurally; a test can hand it a plain object with no DOM involved. */
export interface ClassifiableKeydown {
  readonly key: string;
  readonly repeat: boolean;
  readonly timeStamp: number;
}

/** What the tracker decided about one keydown. */
export interface KeyRepeatVerdict {
  /**
   * The host's own judgment: true if this keydown should be treated as a
   * continuation of a held key rather than a fresh, deliberate press.
   * `reportedRepeat || (intervalMs !== null && intervalMs < MIN_HUMAN_KEYPRESS_INTERVAL_MS)`.
   */
  readonly isRepeat: boolean;
  /** `event.repeat` exactly as the browser reported it. */
  readonly reportedRepeat: boolean;
  /**
   * Milliseconds since the previous keydown of this SAME key, or null when
   * there was none yet (a different key, or the first keydown this tracker
   * has ever classified).
   */
  readonly intervalMs: number | null;
  /**
   * Milliseconds between this event's own `timeStamp` and `now` (the moment it
   * was classified) - see the module header for why this is reported but does
   * not drive `isRepeat` on its own.
   */
  readonly ageMs: number;
}

/**
 * One tracker per keydown source. Stateful by necessity: telling a repeat from
 * a fresh press needs the PREVIOUS keydown of the same key, not only the one
 * in hand, so a fresh instance's `intervalMs` check has nothing to compare
 * against until it has classified that key at least once (its `reportedRepeat`
 * check has no such warm-up: a first event can still report `repeat: true`).
 */
export interface KeyRepeatTracker {
  /** Classify one keydown and remember it as "the last one" for the next call. */
  classify(event: ClassifiableKeydown, now?: number): KeyRepeatVerdict;
  /** The most recent verdict, or null before this tracker's first classify(). */
  last(): KeyRepeatVerdict | null;
}

export function createKeyRepeatTracker(): KeyRepeatTracker {
  let lastKey: string | null = null;
  let lastTimeStamp: number | null = null;
  let lastVerdict: KeyRepeatVerdict | null = null;

  return {
    classify(event, now = performance.now()) {
      const intervalMs =
        lastKey === event.key && lastTimeStamp !== null ? event.timeStamp - lastTimeStamp : null;
      const reportedRepeat = event.repeat === true;
      const isRepeat = reportedRepeat || (intervalMs !== null && intervalMs < MIN_HUMAN_KEYPRESS_INTERVAL_MS);
      const verdict: KeyRepeatVerdict = {
        isRepeat,
        reportedRepeat,
        intervalMs,
        ageMs: now - event.timeStamp,
      };
      lastKey = event.key;
      lastTimeStamp = event.timeStamp;
      lastVerdict = verdict;
      return verdict;
    },
    last() {
      return lastVerdict;
    },
  };
}
