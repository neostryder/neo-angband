/**
 * Which installed mods the catalogue has a newer copy of.
 *
 * WHERE A MOD UPDATE COMES FROM, because it is not where a player expects. The
 * catalogue - every repo, tag and SHA-256 - ships INSIDE the game build, and
 * that is the whole security model: the digest did not travel over the
 * connection that delivered the file (see mod-registry.ts). So "check for mod
 * updates" is not a network call and cannot be one. It is a comparison between
 * the tags this build knows and the tags on disk, and it can never offer
 * anything newer than the build itself. Updating the game is what brings new
 * mod versions within reach; this is what notices they have arrived.
 *
 * Two consequences worth stating rather than discovering:
 *
 *   - The check is instant and works offline. Only the download needs a network.
 *   - A player who updates the game and then updates their mods is doing two
 *     steps, and the second one is the one nothing used to tell them about.
 *
 * THE CLASSIFICATION LIVES HERE AND NOWHERE ELSE. mod-catalogue.ts already had
 * all of this reasoning inline, correctly, in the wording of a single row: what
 * "behind" is, why "ahead" is not a fault, and why two tags that cannot be
 * ordered must not be called an update. Adding a second place that decides
 * which mods to offer would have been two copies of one judgement, and only one
 * of them would have learned the next time it changed. So the row and the bulk
 * offer now read the same function, and a test asserts they agree.
 */

import { compareTags, type RecommendedMod } from "./mod-registry";

/**
 * How an installed tag stands against the one this build's catalogue pins.
 *
 *  - `absent`      not installed at all.
 *  - `same`        the tag on disk is the tag in the catalogue.
 *  - `behind`      the catalogue is newer. THE ONLY ONE THAT IS AN UPDATE.
 *  - `ahead`       the mod on disk is newer than the build knows about. This is
 *                  what a mod author testing their own release sees, and what
 *                  any player sees whose mod moved faster than the game did.
 *                  Installing the catalogue's copy is a DOWNGRADE, so it is
 *                  never offered as an update - only as an explicit replace.
 *  - `unorderable` two tags that are not both versions. A tag need not be one.
 *                  Nothing can be claimed about the direction, so nothing is.
 */
export type ModTagStanding = "absent" | "same" | "behind" | "ahead" | "unorderable";

export function classifyModTag(
  installedTag: string | null,
  catalogueTag: string,
): ModTagStanding {
  if (installedTag === null) return "absent";
  if (installedTag === catalogueTag) return "same";
  const order = compareTags(installedTag, catalogueTag);
  if (order === null) return "unorderable";
  return order > 0 ? "ahead" : "behind";
}

/** One mod the catalogue can move forward, and the two tags involved. */
export interface ModUpdate {
  readonly mod: RecommendedMod;
  /** The tag currently on disk. */
  readonly from: string;
  /** The tag this build's catalogue pins. */
  readonly to: string;
}

/**
 * Every installed mod the catalogue has a strictly newer tag for.
 *
 * `behind` ONLY. An `ahead` mod would be a downgrade and an `unorderable` one
 * is a guess; both are things a player may legitimately choose from the
 * catalogue screen, one row at a time, having read what it says. Neither
 * belongs in something called "update installed mods", and neither belongs in a
 * count that a player reads as "work waiting for me".
 *
 * Catalogue order is kept rather than sorted: it is the order the same mods
 * appear in on the catalogue screen, and two lists of the same things in
 * different orders is a small cruelty.
 */
export function pendingModUpdates(
  catalogue: readonly RecommendedMod[],
  installed: ReadonlyMap<string, string>,
): ModUpdate[] {
  const out: ModUpdate[] = [];
  for (const mod of catalogue) {
    const from = installed.get(mod.id);
    if (from === undefined) continue;
    if (classifyModTag(from, mod.tag) !== "behind") continue;
    out.push({ mod, from, to: mod.tag });
  }
  return out;
}

/**
 * The row's label on the mod manager, which doubles as the whole report.
 *
 * IT NO LONGER SAYS "all up to date", because it cannot know that. This check is a
 * comparison against the catalogue compiled into the build, so its silence means
 * "nothing NEWER SHIPPED WITH THIS GAME" - a much weaker claim than the one the old
 * wording made. Caught in the act: an install carrying neo-linoleum v0.12.0 read
 * "all up to date" on the same screen where "Install a mod" correctly offered
 * v0.12.1, because the mod had released and the build had not.
 *
 * The durable fix is to ask each installed mod's own repository for its tags, the
 * way the browse screen does; until that lands, the honest thing is to say what was
 * actually checked and point at the screen that knows better. A row that overclaims
 * is worse than one that admits its scope: a player who reads "up to date" stops
 * looking.
 */
export function modUpdateRowLabel(pending: readonly ModUpdate[], anyInstalled: boolean): string {
  if (!anyInstalled) return "Update installed mods...  (none installed)";
  if (pending.length === 0) {
    return "Update installed mods...  (none from this build - check Install a mod)";
  }
  return `Update installed mods...  (${String(pending.length)} available)`;
}

/**
 * The line the update screen shows about mods.
 *
 * Null when there is nothing to say. A screen that says "0 mods need updating"
 * every time teaches the player to stop reading it, and this screen has one
 * sentence that matters on it.
 */
export function modUpdateNotice(pending: readonly ModUpdate[]): string | null {
  if (pending.length === 0) return null;
  const n = pending.length;
  return n === 1
    ? `1 installed mod has a newer version in this build: ${pending[0]?.mod.name ?? ""} ${pending[0]?.from ?? ""} -> ${pending[0]?.to ?? ""}.`
    : `${String(n)} installed mods have newer versions in this build.`;
}
