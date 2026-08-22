/**
 * Which character THIS page may write to, and the hold that stops a second page
 * writing to the same one.
 *
 * THE FACT THAT WAS SHARED AND SHOULD NEVER HAVE BEEN. Every write to a save
 * used to read `neo-angband-active` out of `localStorage` to decide where the
 * bytes land. That key is shared by every tab on the origin, so it answers a
 * question no single tab is entitled to answer alone. Two tabs open on one
 * character both read it, both resumed, and both autosaved into the same slot
 * every three seconds with different games in memory. Last writer won and the
 * other player's session was gone, silently, with nothing anywhere saying so.
 *
 * So the key stops naming the save destination. It names which character to
 * OFFER on the next launch, which is a preference and is fine to share, and the
 * destination becomes `attachedId` below: this page's own memory, invisible to
 * every other page, set once when this page takes a character up.
 *
 * That alone makes the two tabs stop overwriting each other's IDEA of where to
 * write, but they would still be attached to the same slot, so the second half
 * is a real cross-page hold. `navigator.locks` is the only origin-wide mutual
 * exclusion a browser offers that is released automatically when the page that
 * took it goes away - which is the property that matters, because a lock a
 * crashed tab keeps forever would lock a player out of their own character with
 * no way back. One exclusive lock per slot, taken when the page attaches and
 * held for as long as the page lives.
 *
 * OPTIMISTIC, AND THAT IS DELIBERATE. `attachSlot` sets the page-local
 * attachment synchronously and asks for the lock in the background, rather than
 * waiting for the lock and attaching after. Boot runs synchronously at module
 * scope, so an attachment that had to await could not exist by the time the
 * first turn does; and a browser without `navigator.locks` would then never
 * attach at all, which turns a missing safety net into a game that cannot save.
 * Losing the race costs at most the one autosave a refused page manages before
 * `lost` fires, which the winner overwrites within three seconds. Winning it
 * wrongly - refusing to save a lone tab because the API was absent - costs the
 * character.
 *
 * WHAT IS NOT HERE. There is no way to take a slot from the page that holds it.
 * A second tab is refused (`slotHeldElsewhere`, consulted by the character
 * select) or backs off when its own probe comes back refused (`lost`). Stealing
 * would mean deciding which of two live games is the real one, and there is no
 * answer to that which does not throw somebody's play away.
 *
 * The one-way surrender latch in `roster.ts` is a different guarantee and stays:
 * this module says where a page may write, and that says a page may never write
 * again whatever it is attached to.
 */

/**
 * The lock name for a slot. Prefixed because `navigator.locks` is one flat
 * origin-wide namespace shared with anything else the origin ever locks.
 */
const LOCK_PREFIX = "neo-angband-slot:";

/** A held Web Lock, and the resolver whose call gives it back. */
interface Held {
  readonly id: string;
  readonly release: () => void;
}

/**
 * The slot this page may write to. Page-local by construction: it is a module
 * variable, so no other tab can read it, write it, or clear it.
 */
let attachedId: string | null = null;

/** The lock currently held, when one was granted and not yet given back. */
let held: Held | null = null;

/** Told when a slot this page had is confirmed to belong to another page. */
const lostListeners: ((id: string) => void)[] = [];

/** Registered once, and only when there is something to register it on. */
let bfcacheGuarded = false;

/**
 * The Web Locks manager, or null where there is not one.
 *
 * Absent in a `jsdom` test environment, in a worker without the API, and in
 * older browsers. Absence is answered by "no cross-page hold", never by "no
 * saving" - see the note on optimism above.
 */
function lockManager(): LockManager | null {
  try {
    const mgr = (globalThis as { navigator?: { locks?: LockManager } }).navigator?.locks;
    return typeof mgr?.request === "function" ? mgr : null;
  } catch {
    /* A `navigator` that throws on property access. */
    return null;
  }
}

/** The slot this page may write to, or null when it may write nowhere. */
export function attachedSlot(): string | null {
  return attachedId;
}

/**
 * Take a character up: this page, and only this page, may now write that slot.
 *
 * Synchronous on purpose (see the module note). The cross-page hold is asked for
 * in the background and answers one of three ways: granted, in which case it is
 * kept until this page goes away; refused, in which case `lost` detaches this
 * page again and tells whoever is listening; or unavailable, in which case the
 * page-local attachment stands on its own.
 */
export function attachSlot(id: string): void {
  if (attachedId === id) return; // already ours; asking twice is not a second claim
  detachSlot();
  attachedId = id;
  guardBfcache();
  takeHold(id);
}

/**
 * Give up this page's character. Not one way - a page legitimately moves between
 * characters (death, "Switch character", a save this build could not read) and
 * each of those ends with this page writing nowhere until it attaches again.
 *
 * Cannot fail, which is the property the sandbox depends on: it is memory, not
 * storage, so there is no browser state that can refuse it.
 */
export function detachSlot(): void {
  attachedId = null;
  releaseHold();
}

/**
 * Whether another page on this origin is playing that character right now.
 *
 * For the deliberate door - the character select - so a second tab is refused
 * with a sentence instead of being let in to fight over the file. `query()`
 * rather than a trial `request()`, because a trial request that succeeded would
 * take the very lock it was only asking about and then have to give it back,
 * which is a race against this page's own `takeHold`.
 *
 * FALSE WHEN IT CANNOT KNOW. A browser with no Web Locks, or a manager that
 * throws, answers "not held" - refusing a player access to their own character
 * on the strength of a missing API would be a worse failure than the collision
 * this is here to prevent, and the collision is still caught (badly, late) by
 * `lost`.
 */
export async function slotHeldElsewhere(id: string): Promise<boolean> {
  if (attachedId === id) return false; // held HERE is not held elsewhere
  const mgr = lockManager();
  if (!mgr || typeof mgr.query !== "function") return false;
  try {
    const snapshot = await mgr.query();
    return (snapshot.held ?? []).some((lock) => lock.name === LOCK_PREFIX + id);
  } catch {
    return false;
  }
}

/**
 * Be told when this page's character turns out to belong to another page.
 *
 * The listener is how the player finds out. It has to be told, and told in a way
 * that survives being missed once: a tab that has quietly stopped saving looks
 * exactly like a tab that is saving, right up until it is closed.
 */
export function onSlotLost(listener: (id: string) => void): void {
  lostListeners.push(listener);
}

/** Test seam: return this module to the state a freshly loaded page is in. */
export function resetSlotAttachment(): void {
  detachSlot();
  lostListeners.length = 0;
}

/* ------------------------------------------------------------------ *
 * The hold itself.
 * ------------------------------------------------------------------ */

function takeHold(id: string): void {
  const mgr = lockManager();
  if (!mgr) return; // no cross-page hold available; the attachment stands alone
  const name = LOCK_PREFIX + id;
  let release!: () => void;
  /* The lock is held for exactly as long as this promise is unresolved, which is
   * the Web Locks idiom for "keep it until I say so": the callback's promise IS
   * the critical section. Resolving it in `releaseHold` is the only way out. */
  const untilReleased = new Promise<void>((resolve) => {
    release = resolve;
  });
  void Promise.resolve(
    mgr.request(name, { mode: "exclusive", ifAvailable: true }, (lock) => {
      /* `ifAvailable` hands the callback null rather than waiting, which is the
       * whole reason it is used: waiting would mean this page silently queues
       * behind the other tab and attaches the moment that tab closes, hours
       * later, over whatever this page has been doing in the meantime. */
      if (!lock) {
        lost(id);
        return;
      }
      /* Stale by the time it was granted: the page detached while the request
       * was in flight. Give it straight back rather than sitting on a slot
       * nobody here is playing. */
      if (attachedId !== id) return;
      held = { id, release };
      return untilReleased;
    }),
  ).catch(() => {
    /* The manager rejected (a detached document, a browser that lists the API
     * but will not use it). No hold, and the page-local attachment stands. */
  });
}

function releaseHold(): void {
  if (!held) return;
  const done = held.release;
  held = null;
  try {
    done();
  } catch {
    /* Resolving a promise cannot throw, but a shimmed one might. */
  }
}

/**
 * This page's slot is somebody else's. Stop writing, and say so.
 *
 * Guarded on the id because a refusal that arrives after the page has already
 * moved on - a probe for the character the player just switched away from - is
 * stale news about a slot this page no longer wants.
 */
function lost(id: string): void {
  if (attachedId !== id) return;
  attachedId = null;
  releaseHold();
  for (const listener of lostListeners) {
    try {
      listener(id);
    } catch {
      /* One listener throwing must not stop the next being told. */
    }
  }
}

/**
 * Give the hold back before this page stops being here, whether or not it is
 * coming back.
 *
 * THE COMMON CASE IS A RELOAD, AND IT IS THE ONE THAT MUST NOT BREAK. Half of
 * this game's navigation is `location.assign` back to itself: `resumeSelected`,
 * `switchCharacter`, `newGame` and every mod-apply all reload. The outgoing
 * document and the incoming one briefly coexist, so a hold released only when the
 * browser tears the old document down would be a race against the new document's
 * boot - and losing it would refuse a player their own character on an ordinary
 * reload, which is a worse and far more frequent bug than the collision this
 * module is for. `pagehide` fires on the way out, before the new document runs a
 * line, so releasing there makes the ordering explicit rather than inherited.
 *
 * THE OTHER CASE IS THE BACK/FORWARD CACHE, where the page is frozen instead of
 * destroyed, so the browser does not release its locks at all and a player who
 * navigated away would keep their own character locked against the next window
 * they open. That is why the hold is asked for again on a `pageshow` that restored
 * the page, and why the release is not conditional on `persisted`.
 *
 * The page-local attachment is deliberately NOT dropped here: `pagehide` is also
 * where the game force-flushes its save (`flushSaveOnExit`), and detaching first
 * would throw that last save away.
 */
function guardBfcache(): void {
  if (bfcacheGuarded) return;
  const target = (globalThis as { addEventListener?: typeof addEventListener })
    .addEventListener;
  if (typeof target !== "function") return;
  bfcacheGuarded = true;
  globalThis.addEventListener("pagehide", () => {
    releaseHold();
  });
  globalThis.addEventListener("pageshow", (ev) => {
    if (!(ev as PageTransitionEvent).persisted) return;
    /* Restored from the bfcache with the attachment still in memory. Ask for the
     * hold again: another tab may have taken this character while this page was
     * frozen, and if it did, `lost` is how this page finds out. */
    if (attachedId !== null) takeHold(attachedId);
  });
}
