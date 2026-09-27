/**
 * Which language the player chose, and where that choice lives.
 *
 * ENGLISH IS THE DEFAULT AND IS NOT STORED. An absent key means "English",
 * which is also what a first run means, so there is no migration and no way for
 * a corrupted value to leave a player unable to read their game: anything that
 * is not a plausible language tag is treated as absent.
 *
 * DELIBERATELY NOT `navigator.language`. Defaulting to the browser's locale is
 * the usual advice and it is wrong here: this game ships in English, most
 * languages will have no translation installed, and a player whose browser is
 * set to French would get a game that is mostly English with a scattering of
 * French - having asked for nothing. Worse, they would have to find a menu, in a
 * game they may not be able to read, to undo it. The browser's preference is
 * available to a locale mod that wants to suggest itself; it is not the game's
 * to act on unasked.
 */

const KEY = "neo:locale";

/**
 * A language tag's SHAPE, not its validity. `Intl` is the judge of what a tag
 * means, and it is lenient on purpose; this only keeps a corrupted or injected
 * value from being handed on.
 */
const TAG = /^[A-Za-z]{2,8}(-[A-Za-z0-9]{2,8})*$/u;

/** The player's saved language, or null for English. */
export function readStoredLocale(): string | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw !== null && TAG.test(raw) ? raw : null;
  } catch {
    /* Storage can be denied outright (a locked-down browser, private mode in
     * some builds). English is a working game; a thrown exception at boot is
     * not. */
    return null;
  }
}

/** Remember the player's language. `null` or "en" clears it back to English. */
export function writeStoredLocale(tag: string | null): void {
  try {
    if (tag === null || tag === "en" || !TAG.test(tag)) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, tag);
  } catch {
    /* The choice applies to this session either way - setLocale has already
     * happened - it simply will not survive a reload. Losing a preference is
     * not worth failing the action the player just took. */
  }
}
