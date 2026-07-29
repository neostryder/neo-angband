/**
 * Keeping the browser from evicting a character.
 *
 * parity/PLATFORM.md's fourth cost was "everything shares one evictable bucket",
 * and it named two halves. The quota half was fixed by compressing savefiles. This
 * is the other half - and it was recorded as answerable only by "the desktop
 * build's real files", which is not quite true and the difference is a character:
 *
 *   By default a browser origin's storage is BEST-EFFORT. Under storage pressure
 *   the browser may delete the whole bucket, without warning and without asking,
 *   and under decision 16 (no save-scumming, death is terminal) that is permanent
 *   character loss from a mechanism the player never sees. `navigator.storage
 *   .persist()` moves the origin to PERSISTENT, which is exempt from that eviction.
 *
 * So this is not a nicety. It is the difference between "your saves may vanish" and
 * "your saves are only removed if you remove them", and by the ratified rule
 * (necessary goes in core, nice is a mod) that makes it part of the port's job on
 * this platform. It applies to the desktop shell too, whose renderer is a Chromium
 * origin with exactly the same bucket.
 *
 * What it does NOT fix, so it is not mistaken for done:
 *
 *   - "Clear browsing data" still erases everything. Persistence is protection from
 *     the BROWSER's own housekeeping, not from the player's.
 *   - The grant is not guaranteed. Chromium decides by site engagement (installed
 *     as a PWA counts, which is the strongest reason to offer the install); Firefox
 *     asks the user. A refusal is reported, never assumed away.
 *   - Only real files answer it completely, which is still Phase 5.
 *
 * The request is made ONCE, when the first character save of the session lands -
 * not at boot. At boot there is nothing to protect, and on an engine that shows a
 * permission prompt, asking before the player has anything to lose is a dialogue
 * about nothing. Whether it has been asked is remembered, so a refusal is not
 * re-asked on every launch.
 */

/** navigator.storage, structurally: every field is optional in some engine. */
interface StorageManagerLike {
  persist?(): Promise<boolean>;
  persisted?(): Promise<boolean>;
  estimate?(): Promise<{ usage?: number; quota?: number }>;
}

interface DurabilityScope {
  navigator?: { storage?: StorageManagerLike };
  localStorage?: Pick<Storage, "getItem" | "setItem">;
}

/** Set once the request has been made, so it is not repeated every launch. */
export const ASKED_KEY = "neo:storageAsked";

/** What the game knows about the durability of its own storage. */
export interface StorageDurability {
  /** Whether this engine can be asked at all. */
  supported: boolean;
  /** True when the origin is exempt from the browser's own eviction. */
  persisted: boolean;
  /** Bytes in use, when the engine will say. */
  usage: number | null;
  /** The origin's byte budget, when the engine will say. */
  quota: number | null;
}

function manager(scope: unknown): StorageManagerLike | null {
  const s = (scope ?? {}) as DurabilityScope;
  const mgr = s.navigator?.storage;
  return mgr && typeof mgr === "object" ? mgr : null;
}

/**
 * Report durability WITHOUT asking for it.
 *
 * Separate from the request on purpose: this one is safe to call from a screen that
 * wants to tell the player where they stand, and it can never raise a prompt.
 */
export async function storageDurability(
  scope: unknown = globalThis,
): Promise<StorageDurability> {
  const mgr = manager(scope);
  const out: StorageDurability = {
    supported: typeof mgr?.persist === "function",
    persisted: false,
    usage: null,
    quota: null,
  };
  if (!mgr) return out;
  try {
    if (typeof mgr.persisted === "function") out.persisted = await mgr.persisted();
  } catch {
    /* An engine that throws here is one that cannot tell us; false is the safe
     * reading, because it only ever makes the game MORE careful. */
  }
  try {
    if (typeof mgr.estimate === "function") {
      const est = await mgr.estimate();
      if (typeof est.usage === "number") out.usage = est.usage;
      if (typeof est.quota === "number") out.quota = est.quota;
    }
  } catch {
    /* Estimates are for reporting only; nothing depends on them. */
  }
  return out;
}

function wasAsked(scope: unknown): boolean {
  try {
    return (scope as DurabilityScope).localStorage?.getItem(ASKED_KEY) === "1";
  } catch {
    return false;
  }
}

function markAsked(scope: unknown): void {
  try {
    (scope as DurabilityScope).localStorage?.setItem(ASKED_KEY, "1");
  } catch {
    /* Storage that cannot record the attempt will re-ask next launch, which is a
     * worse experience but not a lost character. */
  }
}

/**
 * Ask the browser to stop evicting this origin's data.
 *
 * Returns the resulting state, whether or not this call is what produced it: an
 * origin that is already persistent reports true without asking, which is what
 * makes this safe to call on every launch.
 *
 * `force` skips the once-only latch, for a player who asks for it deliberately
 * from a menu after an earlier refusal.
 */
export async function requestDurableStorage(
  scope: unknown = globalThis,
  opts: { force?: boolean } = {},
): Promise<boolean> {
  const mgr = manager(scope);
  if (!mgr || typeof mgr.persist !== "function") return false;
  try {
    /* Already persistent: never ask again, and never report a refusal for an
     * origin that is in fact protected. */
    if (typeof mgr.persisted === "function" && (await mgr.persisted())) return true;
    if (!opts.force && wasAsked(scope)) return false;
    markAsked(scope);
    return await mgr.persist();
  } catch {
    return false;
  }
}

/** Latched so one session asks at most once, however many saves it writes. */
let askedThisSession = false;

/**
 * The hook the save path calls: ask once, in the background, and never block or
 * throw into the caller.
 *
 * Deliberately fire-and-forget. persistSave() is synchronous because z-file.c is,
 * and a save must not wait on a permission decision - the request protects FUTURE
 * saves, not the one in flight.
 */
export function ensureDurableStorage(scope: unknown = globalThis): void {
  if (askedThisSession) return;
  askedThisSession = true;
  void requestDurableStorage(scope).then(
    () => undefined,
    () => undefined,
  );
}

/** Reset the session latch (tests only). */
export function resetDurabilityLatch(): void {
  askedThisSession = false;
}

/**
 * The one-line warning for the character-select screen, or null when there is
 * nothing to warn about.
 *
 * Only shown when there is something to lose. A player with no characters does not
 * need to be told about eviction, and a warning shown to everyone all the time is
 * one nobody reads.
 */
export function durabilityNotice(
  d: StorageDurability,
  characters: number,
): string | null {
  if (characters === 0 || d.persisted) return null;
  if (!d.supported) {
    return "This browser may delete saved characters to reclaim space. Install the app to keep them.";
  }
  return "Saves are not protected from browser cleanup yet. Installing the app makes them persistent.";
}
