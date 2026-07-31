/**
 * ONE answer to "why is this mod not doing anything?".
 *
 * WHAT THIS FIXES. Every layer of the mod system computed that answer and none of
 * them showed it in a place a player would find, and two of them showed it nowhere
 * at all (2026-07-31):
 *
 *   - `readModDir` collected `problems` (disk-packs.ts): rendered, buried two
 *     screens down under "Where mods come from", capped at 8 and silently truncated.
 *   - `composeContentPacks` collected `problems` (mod-sdk): same list, same burial.
 *   - `loadModCode` collected `problems` on EVERY failure path (mod-code.ts) -
 *     an unimportable plugin, an ABI mismatch, a missing "plugin" facet - and
 *     `activeModCode()` was read at exactly two places, both for `.plugins`. Not
 *     one of those lines ever reached a screen.
 *   - `hooks()` and `register()` throwing went to `console.error`, which is a
 *     channel a player does not have.
 *
 * So the whole class of "the mod is installed, enabled, and doing nothing" - the
 * failure a mod author gets a bug report about and cannot reproduce - was
 * diagnosable only from a devtools console. This module is the channel those five
 * sources agree on, and the mod manager reads it per mod.
 *
 * ATTRIBUTED, NOT PREFIXED. A problem carries its mod's `id` beside the sentence
 * rather than inside it, because the manager has to be able to ask "what is wrong
 * with THIS mod" and get an answer without parsing punctuation. `id: null` is a
 * real case, not a fallback: "the mods folder could not be read" and
 * "load-order.json lists a mod that is not installed" belong to the SOURCE, and
 * hanging them off some arbitrary mod would be worse than leaving them unattached.
 *
 * TWO LISTS, KEPT APART. A `problem` means something is broken and the player
 * should see it. `skipped` means the mod is not loaded ON PURPOSE - it is disabled,
 * or waiting for consent - and a manager that showed those as faults would cry
 * wolf on the ordinary state of every mod a player has turned off.
 */

/** One thing that went wrong, attributed to a mod when it can be. */
export interface ModProblem {
  /** The mod it belongs to, or null when it is about the SOURCE rather than a mod. */
  readonly id: string | null;
  /** What went wrong, in the player's terms, with no id prefix. */
  readonly why: string;
}

/** A problem as one line, with the id put back on when there is one. */
export function problemLine(p: ModProblem): string {
  return p.id === null ? p.why : `${p.id}: ${p.why}`;
}

/**
 * Every problem as one line each.
 *
 * The inverse of the attribution, and it exists because attribution is for the UI
 * while a LINE is what a log, a diff and a test assertion want. Reports used to carry
 * these lines directly, and the tests that pin their wording - which is behaviour
 * here, not decoration - read them straight off the report.
 */
export function problemLines(problems: readonly ModProblem[]): string[] {
  return problems.map(problemLine);
}

/**
 * Split a list into the problems belonging to one mod and the rest.
 *
 * The manager needs both halves of that split in the same pass: a mod's own
 * problems go on its row, and the ones that belong to nobody have to still be
 * shown somewhere or this whole module would have moved the silence rather than
 * ended it.
 */
export function problemsFor(
  problems: readonly ModProblem[],
  id: string,
): readonly string[] {
  return problems.filter((p) => p.id === id).map((p) => p.why);
}

/** The problems that belong to no mod in `ids` - the source's own, and any orphan. */
export function unattributedProblems(
  problems: readonly ModProblem[],
  ids: ReadonlySet<string>,
): readonly string[] {
  return problems.filter((p) => p.id === null || !ids.has(p.id)).map(problemLine);
}

/* --- Faults found after the readers have run ---------------------------------
 *
 * disk-packs, the composer and mod-code all finish before the game exists, so each
 * hands its report back as a return value. The rest cannot: a plugin's `hooks()`
 * runs when the game starts AND again on every live rule toggle, and `register()`
 * runs once the registries exist. Those had nowhere to report to, so they used
 * console.error - and a console message is not a channel a player has.
 *
 * A module-level list, for the same reason mod-code.ts and disk-packs.ts latch
 * theirs: the mod manager is opened long after, from synchronous UI code, and
 * threading a collector from boot through the game object to a menu would put this
 * plumbing in twenty signatures that have no other reason to know about it.
 */

const faults: ModProblem[] = [];

/**
 * Record that a mod's code failed at runtime.
 *
 * DEDUPED on (id, why), which is not tidiness: `activeModHooks()` re-runs on every
 * Fixes & tweaks toggle, so a plugin whose `hooks()` throws would otherwise add the
 * same line each time the player pressed a key on that screen, and the manager
 * would show a growing pile of one problem.
 */
export function reportModFault(id: string, why: string): void {
  if (faults.some((f) => f.id === id && f.why === why)) return;
  faults.push({ id, why });
}

/** Everything reportModFault has been told, in the order it was told. */
export function modFaults(): readonly ModProblem[] {
  return faults;
}

/** Forget them all, for tests (a fresh boot starts with none). */
export function resetModFaults(): void {
  faults.length = 0;
}

/** An error's message, however it was thrown. */
export function faultMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
