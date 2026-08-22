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
 * the bytes land: the slot this PAGE is attached to (`slot-attach.ts`). The
 * turn-tail autosave, the level-change save, `S`, the options screen, `pagehide`
 * and the death save all end up there. A session attached to nothing therefore
 * writes nowhere at all - and the game already relies on exactly that in two
 * places, both documented as such: a save this build could not read keeps its
 * bytes because the page never attaches (`keepSaveUntouched`), and a throwaway
 * game booted behind the character select claims no slot for the same reason.
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
 *
 * WHY IT DOES NOT REST ON SHARED STORAGE. `neo-angband-active` lives in
 * `localStorage`, which every tab on the origin shares, so it was never this
 * page's to hold: a second tab resuming a character wrote a real slot id into the
 * key the save path read, and a page that had given up its save - and has since
 * been cheated freely - was silently pointed back at somebody's real character.
 * The DEATH path is the worse half of that: it does not write over the slot, it
 * DESTROYS the slot's bytes and records a death in a ledger that outlives the
 * tombstone, so a monster killing the cheated character would delete a real one.
 *
 * That key no longer decides anything. The destination is `attachedSlot()`, which
 * is this page's own memory and which nothing outside this page can set - so
 * detaching is final by construction rather than by patch. It cannot fail either,
 * which is the second thing shared storage cost: a browser refusing to write is
 * no longer a browser refusing to sandbox.
 *
 * The one-way latch (`surrenderSlotWrites`) stays, and guards a different door.
 * Detaching says this page writes nowhere for now; the latch says `writeSlot` and
 * `markDead` refuse this page for the rest of its life, whatever it later attaches
 * to. The sandbox wants both, because the sandbox is the one caller for whom
 * "for now" is not good enough.
 */

import { getMeta, slotWritesSurrendered, surrenderSlotWrites } from "./roster";
import { attachedSlot, detachSlot } from "./slot-attach";

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
 * TWO SOURCES, AND BOTH ARE NEEDED. The attachment is the mechanism, so reading it
 * catches every session that writes nowhere - including one that was never
 * attached, like a throwaway behind the character select, which for every caller's
 * purposes is the same thing. The latch is the second source because it outranks a
 * later attach: a page that has surrendered is sandboxed even if something
 * attaches it to a slot afterwards, and reading the attachment alone would answer
 * `false` for a page that can no longer write a byte.
 */
export function sessionIsSandboxed(): boolean {
  return slotWritesSurrendered() || attachedSlot() === null;
}

/**
 * The character this session would write to, or null when it would write nowhere.
 *
 * For a caller that has to name what is about to be left behind before asking the
 * player whether to leave it.
 */
export function attachedSave(): SandboxedSave | null {
  const id = attachedSlot();
  if (id === null) return null;
  const meta = getMeta(id);
  /* An attachment with no roster row is a slot mid-birth: it has been allocated so
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
 * to completion in one turn of the event loop, both writes below are to memory,
 * and the game's own turn loop and its `pagehide` handler are both callbacks that
 * cannot interleave with it. There is no `await` in this function and there must
 * not be one.
 *
 * AND IT CANNOT FAIL ANY MORE, which is a change worth stating rather than
 * quietly enjoying. It used to detach by clearing a `localStorage` key, so a
 * browser with storage switched off could refuse the detach and the honest answer
 * was `ok: false` - a mod asking for a safe session had to be told it had not got
 * one. The destination now lives in this page's memory, so there is nothing left
 * to refuse it. `SandboxOutcome` keeps its refusal arm: it is the return type mods
 * already handle, and a future reason to refuse is likelier than a caller
 * benefiting from being told this one can no longer happen.
 *
 * Reported as `ok` when the session was already loose, with `left: null`, because
 * a caller asking for a session that writes nowhere has got one.
 */
export function sandboxSession(): SandboxOutcome {
  const left = attachedSave();
  /* BOTH, and in this order. Detaching is what stops the save path finding a
   * destination, and it also hands back the cross-page hold so the character is
   * free for a window that will actually play them. The latch is what stops this
   * page ever writing again, whatever it attaches to later - without it a mod
   * could sandbox, then reach a code path that attaches a slot, and the cheated
   * character would start being written down as if nothing had happened. */
  detachSlot();
  surrenderSlotWrites();
  /* AND THE SHARED KEY IS LEFT ALONE, which is the opposite of what this used to
   * do and is the point. `neo-angband-active` now names only which character to
   * OFFER on the next launch, and that character is untouched, real, and worth
   * offering - sandboxing a page says nothing about them. Clearing it was a
   * cross-tab side effect with no upside: every other window on the origin reads
   * the same key, so one mod cutting one page loose emptied the launch offer for
   * all of them. */
  return { ok: true, left };
}
