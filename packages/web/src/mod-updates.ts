/**
 * Where an installed tag stands against another one. One rule, one place.
 *
 * THIS FILE USED TO BE THE UPDATE CHECK ITSELF, and what is left of it is the only
 * part that was ever right. The check compared the tags on disk against a catalogue
 * compiled into the game build, so it could not offer anything newer than the build:
 * its silence meant "nothing newer shipped HERE" while it said "all up to date". That
 * was caught in the act - an install carrying Linoleum v0.12.0 read "all up to
 * date" on the same screen where "Install a mod" correctly offered v0.12.1, because
 * the mod had released and the game had not.
 *
 * The answer now comes from each installed mod's OWN repository (mod-refresh.ts), so
 * a mod can move without the game moving. What that costs is honesty about latency: a
 * request per mod, and no cached answer, because a cached freshness check is a stale
 * answer wearing a fresh answer's wording - the same defect one layer down.
 *
 * The classifier stays because the judgement is shared. A row that says "update" and
 * a bulk "update everything" must reach the same verdict, and two copies of one rule
 * is one copy that learns.
 *
 * A SECOND RULE JOINED IT: `classifyModPin`. A tag is a name its owner can move, so
 * "the tag on disk equals the tag on offer" and "the code has not changed under this
 * player" are different claims - `classifyModTag` only ever answered the first. See
 * that function's own comment for what closes the gap.
 */

import { compareTags } from "./mod-registry";

/**
 * How an installed tag stands against the one on offer.
 *
 *  - `absent`      not installed at all.
 *  - `same`        the tag on disk is the tag on offer.
 *  - `behind`      the offered tag is newer. THE ONLY ONE THAT IS AN UPDATE.
 *  - `ahead`       the mod on disk is newer than the one on offer. This is what a
 *                  mod author testing their own unreleased build sees, and what any
 *                  player sees whose channel has moved on. Installing the offered
 *                  copy is a DOWNGRADE, so it is never offered as an update - only
 *                  as an explicit replace.
 *  - `unorderable` two tags that are not both versions. A tag need not be one.
 *                  Nothing can be claimed about the direction, so nothing is.
 */
export type ModTagStanding = "absent" | "same" | "behind" | "ahead" | "unorderable";

export function classifyModTag(
  installedTag: string | null,
  offeredTag: string,
): ModTagStanding {
  if (installedTag === null) return "absent";
  if (installedTag === offeredTag) return "same";
  const order = compareTags(installedTag, offeredTag);
  if (order === null) return "unorderable";
  return order > 0 ? "ahead" : "behind";
}

/**
 * The second axis `classifyModTag` cannot see: whether the tag ITSELF still
 * names the commit it named when this mod was installed.
 *
 * A tag is mutable - its owner can retarget it at the repository without the
 * name changing at all - so `classifyModTag("v1.2.0", "v1.2.0")` correctly says
 * "same" for an installed copy and a moved one alike; the tag string is
 * identical in both cases and was never going to be the thing that told them
 * apart. The SHA a tag resolves to is that thing (see mod-discover.ts's
 * DiscoveredMod.sha and mod-install.ts's InstalledModMeta.sha, which is where
 * the two values this compares come from).
 *
 *  - `confirmed`  both SHAs are known and agree. The tag names the same commit
 *                 it did at install.
 *  - `moved`      both SHAs are known and differ. Same tag, different bytes -
 *                 the thing this exists to catch.
 *  - `unknown`    either SHA is missing - an install from before this field
 *                 existed, or a tags call that could not be read. NEVER treated
 *                 as `moved`: a gap in what was recorded is not evidence that
 *                 anything changed, and reporting it as tampering would be a
 *                 false alarm manufactured from missing data rather than a
 *                 measurement. NEVER treated as `confirmed` either, for the
 *                 mirror reason - "cannot tell" is not "checked and fine".
 */
export type ModPinStanding = "confirmed" | "moved" | "unknown";

export function classifyModPin(
  recordedSha: string | null | undefined,
  currentSha: string | null | undefined,
): ModPinStanding {
  if (!recordedSha || !currentSha) return "unknown";
  return recordedSha === currentSha ? "confirmed" : "moved";
}
