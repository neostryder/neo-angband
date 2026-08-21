/**
 * A mod broke the session, so nothing more gets written to the save.
 *
 * WHY THIS IS NOT JUST ANOTHER MOD PROBLEM. mod-problems.ts answers "why is this
 * mod not doing anything?" - a diagnosis the player reads later, in the mod
 * manager, about a mod that failed to load. This answers a different and worse
 * question: a mod's code ran INSIDE a turn, against live game state, and stopped
 * partway. Whatever it had already done to the state stands; whatever it was
 * going to do next did not happen. The state is not corrupt in any way this host
 * can detect, and it is not trustworthy either.
 *
 * WHAT THE PORT DID BEFORE, AND WHY IT LOOKED LIKE IT WAS COPING. The autosave
 * sits at the TAIL of the turn (main.ts, after render), so an uncaught throw
 * mid-turn skipped it. The last good save survived - by accident, because the
 * exception unwound past the save call. That accident is the ONLY thing that was
 * protecting the file, and it came with the game frozen mid-turn, no repaint, no
 * message, and no name of the mod that did it. Guarding the hooks (core's
 * guardModHooks) removes the accident: the turn now finishes, and the turn's
 * tail autosave would happily write the half-updated state over the good one.
 * So the protection has to become deliberate, which is this module.
 *
 * REFUSE, DO NOT FAIL. persistSave short-circuits on a taint and reports success.
 * That is not a lie about the write - it is the distinction between "the storage
 * would not take it" (retry, and tell the player the save is failing) and "it was
 * deliberately not offered" (retrying changes nothing, and a "Saving failed."
 * message on top of the modal below would point at the wrong culprit).
 *
 * ONE TAINT PER SESSION. The first fault is the one that names the mod, because
 * the first fault is the one that happened while the state was still good. Later
 * faults - including a second mod's - still reach the mod manager through
 * reportModFault; they just do not get to relabel the wound.
 */

/** The fault that ended this session's right to save. */
export interface SessionTaint {
  /**
   * The mod whose hook threw, or **null when the game itself threw**.
   *
   * The engine is not exempt from the reasoning above - a port bug that throws
   * halfway through a turn leaves exactly the same half-updated state a mod's
   * hook does, and for a while the only thing standing between that state and
   * the player's save was the same accident: the exception unwinding past the
   * tail autosave. Except that 'S', a level change and pagehide all save too,
   * so a player who hit a mid-turn bug and pressed S wrote it over their
   * character. Core faults come through here now for that reason.
   */
  readonly id: string | null;
  /**
   * Which extension point it threw from, by its ModHooks member name; for a
   * core fault, what the game was doing ("taking a turn").
   */
  readonly hook: string;
  /** The thrown error's message, as the mod - or the engine - worded it. */
  readonly why: string;
}

let taint: SessionTaint | null = null;
const listeners: ((t: SessionTaint) => void)[] = [];

/**
 * Record that a mod's hook threw mid-turn. Idempotent after the first call.
 *
 * Listeners are notified synchronously, from inside the turn, so a listener that
 * wants to put something on screen must defer - see main.ts, which does.
 */
export function taintSession(t: SessionTaint): void {
  if (taint) return;
  taint = t;
  for (const listener of listeners) listener(t);
}

/** The fault that ended this session, or null while it is still trustworthy. */
export function sessionTaint(): SessionTaint | null {
  return taint;
}

/**
 * Be told when the session is first tainted.
 *
 * A callback rather than a flag the shell polls, because the fault surfaces
 * wherever core happened to call the hook - inside a move, inside generation,
 * inside the message sink - and there is no one place the shell passes through
 * afterwards that is guaranteed to be reached.
 *
 * Registering after a taint has already happened calls back at once, so boot
 * order cannot lose the notice.
 */
export function onSessionTaint(cb: (t: SessionTaint) => void): void {
  listeners.push(cb);
  if (taint) cb(taint);
}

/** Forget it, for tests. A fresh page starts untainted. */
export function resetSessionTaint(): void {
  taint = null;
  listeners.length = 0;
}

/**
 * What the player is told, as lines.
 *
 * Plain strings and a pure function so the wording is pinned by a test rather
 * than by whoever next edits the modal. Three things have to be in it, and the
 * order is the order the player needs them: which mod, what it did to their
 * save, and what to do now.
 */
export function taintNotice(t: SessionTaint): string[] {
  /* The game's own fault. Same consequence for the save, different thing to do
   * about it: there is no mod to switch off, and the person who needs to hear
   * about it is the game itself. */
  if (t.id === null) {
    return [
      "The game hit a bug while it was in the middle of a turn.",
      "",
      `While ${t.hook}: ${t.why}`,
      "",
      "It has STOPPED SAVING. Your last save is untouched and still good - it",
      "just will not be updated again, because this turn may have finished",
      "half-done and writing that over your character would be worse.",
      "",
      "Reload to carry on from that save. Please report this one: what you were",
      "doing, and the line above.",
      "github.com/neostryder/neo-angband/issues  -  discord.gg/YegtwbHTBQ",
    ];
  }
  return [
    `The mod "${t.id}" failed while the game was in the middle of a turn.`,
    "",
    `Its ${t.hook} hook threw: ${t.why}`,
    "",
    "That hook has been switched off for the rest of this session, and the game",
    "has STOPPED SAVING. Your last save is untouched and still good - it just",
    "will not be updated again, because this turn may have finished half-done.",
    "",
    "Reload to start again from that save. Turn the mod off first, or leave it",
    "on and report the fault to its author - the mod manager lists it too.",
  ];
}
