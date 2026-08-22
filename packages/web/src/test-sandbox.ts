/**
 * Cutting a session loose from its save slot, so it can be cheated on safely.
 *
 * THE PROBLEM THIS SOLVES IS NOT THE ONE `NOSCORE` SOLVES. A character that has
 * used the debug commands carries `NOSCORE.DEBUG` for the rest of its life and is
 * barred from the high score list, which is upstream's answer and a good one. It
 * is also only a SCORING answer. It says nothing about the fifty potions of speed
 * now sitting in a serious character's pack, or about the character standing on
 * dungeon level 90 because somebody wanted to see whether a monster they had just
 * written would render. The mark records that the character was cheated; it does
 * not stop the cheating from being written to disk.
 *
 * WHAT IS ALREADY TRUE, AND IS THE WHOLE MECHANISM. Every write to a character's
 * save goes through one funnel, and that funnel reads one thing to decide where
 * the bytes land: the active slot id. The turn-tail autosave, the level-change
 * save, `S`, the options screen, `pagehide` and the death save all end up there.
 * A session with no active slot id therefore writes nowhere at all - and the game
 * already relies on exactly that in two places, both documented as such: a save
 * this build could not read keeps its bytes because the active id is dropped
 * (`keepSaveUntouched`), and a throwaway game booted behind the character select
 * claims no slot for the same reason.
 *
 * SO THE SANDBOX IS NOT NEW MACHINERY. It is that same one-line mechanism, named,
 * made one-way, and offered to a mod that is about to do something a player would
 * not want written down. Nothing is copied, no second slot is minted, no roster
 * row appears, and there is nothing left over afterwards to clean up, purge or
 * explain - because the sandbox is the absence of a destination rather than a new
 * one.
 *
 * WHY NOT FORK THE SAVE INTO A BRANDED COPY, which is the other obvious shape.
 * A fork is a real, resumable, second character sitting in the roster, and that
 * is precisely what this game does not have and deliberately does not have. Death
 * is terminal here: a slot's bytes are destroyed when its character dies, and the
 * death ledger outlives even the tombstone so that deleting a memorial cannot
 * launder a resurrection. A branded fork made at dungeon level 40 and left in the
 * roster is a restore point, whatever the brand says, and the brand is the part a
 * player can ignore. A fork also has to be swept up later, which means a purge at
 * boot, which means a way for the purge to be missed. The sandbox has none of
 * these properties because it never writes anything.
 *
 * WHAT IT COSTS, stated because it is the only real cost and a caller has to say
 * it out loud. The character keeps whatever the last save left, and every turn
 * from the sandbox onwards is discarded. During play the autosave runs at the tail
 * of a turn and throttles to three seconds, so what is lost is at most three
 * seconds of TURNS - not three seconds of sitting in a menu, which takes none.
 * The session then plays on in memory until the page is closed or reloaded, and
 * boot with no active id lands on the character select, where the character is
 * waiting exactly as it was.
 *
 * ONE WAY, AND THIS IS NOT AN OVERSIGHT. There is no re-attach. Re-attaching
 * would mean writing a cheated character over the save it was protected from,
 * which is the one outcome this whole module exists to make unreachable.
 */

import { getActiveId, getMeta, setActiveId } from "./roster";

/** What the session was attached to before it was cut loose. */
export interface SandboxedSave {
  /** The slot that will no longer be written to. */
  readonly id: string;
  /** Who is in it, for a sentence naming what has been left safe. */
  readonly name: string;
}

/** Why a session could not be sandboxed, or what it was cut loose from. */
export type SandboxOutcome =
  | { readonly ok: true; readonly left: SandboxedSave | null }
  | { readonly ok: false; readonly problem: string };

/**
 * Whether this page has already been cut loose.
 *
 * DERIVED, NOT REMEMBERED. A flag of this module's own could disagree with the
 * thing that actually decides where a save goes; reading the active id cannot.
 * The one thing it cannot tell apart is a session that was never attached (a
 * throwaway behind the character select), and for every caller's purposes those
 * are the same session: neither one writes anywhere.
 */
export function sessionIsSandboxed(): boolean {
  return getActiveId() === null;
}

/**
 * The character this session would write to, or null when it would write nowhere.
 *
 * For a caller that has to name what is about to be left behind before asking the
 * player whether to leave it.
 */
export function attachedSave(): SandboxedSave | null {
  const id = getActiveId();
  if (id === null) return null;
  const meta = getMeta(id);
  /* An active id with no roster row is a slot mid-birth: it has been allocated so
   * the first autosave lands, and nothing has written a row yet. Naming it as the
   * empty string rather than refusing keeps "is there something to protect" and
   * "what is it called" as two separate questions. */
  return { id, name: meta?.name ?? "" };
}

/**
 * Cut this session loose from its save slot. Idempotent, and one way.
 *
 * SYNCHRONOUS, WHICH IS WHAT CLOSES THE RACE a reader will look for here. The
 * obvious worry about any such mechanism is that the game advances a turn - and
 * autosaves - between reading the slot and detaching from it. It cannot: this runs
 * to completion in one turn of the event loop, `localStorage` is synchronous, and
 * the game's own turn loop and its `pagehide` handler are both callbacks that
 * cannot interleave with it. There is no `await` in this function and there must
 * not be one.
 *
 * Reported as `ok` when the session was already loose, with `left: null`, because
 * a caller asking for a session that writes nowhere has got one.
 */
export function sandboxSession(): SandboxOutcome {
  const left = attachedSave();
  if (left === null) return { ok: true, left: null };
  setActiveId(null);
  /* Read back rather than trust the write. `setActiveId` swallows a storage
   * failure, and a failure here is the one that matters: a caller told the
   * session was safe would go on to cheat a character that is still being saved. */
  if (getActiveId() !== null) {
    return {
      ok: false,
      problem:
        "this browser would not let go of the save slot, so the character is still being written to and " +
        "nothing here is safe to use",
    };
  }
  return { ok: true, left };
}
