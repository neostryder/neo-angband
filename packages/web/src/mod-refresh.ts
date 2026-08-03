/**
 * Asking each installed mod's OWN repository whether there is a newer version.
 *
 * WHAT THIS REPLACED, AND WHY. Mod updates used to be a comparison against a
 * catalogue compiled into the game build: every repo, tag and per-file SHA-256
 * shipped inside `mod-registry.ts`. That was a coherent design - the digest had not
 * travelled over the connection that delivered the file, which is what made a
 * download safe - but it forced two things the maintainer rejected. The build had
 * to know a mod's name and version in advance, and a mod could not release without
 * the game releasing. Trust moved to origin-on-first-use (see mod-source.ts), which
 * survives a version bump in a way a shipped digest never can, and this module is
 * what the update check became once it was allowed to ask.
 *
 * THE THING THIS MODULE EXISTS TO NOT DO. The old row read
 * `Update installed mods...  (all up to date)` while, on the same screen, "Install
 * a mod" correctly offered a newer version - because its silence only ever meant
 * "nothing newer shipped HERE". Both halves were working as written; the wording
 * turned a weak fact into the claim a player acts on. So `unavailable` is a
 * first-class standing here, distinct from `current`, and nothing in this file may
 * say "up to date" about a repository it could not reach. A network failure, a rate
 * limit, a deleted repo and a renamed repo are all *unknown*, not *fine*, and a
 * player who reads "fine" stops looking.
 */

import { listTags, type DiscoverEnv } from "./mod-discover";
import type { InstalledModMeta } from "./mod-install";
import { tagsInChannel } from "./mod-source";
import { classifyModTag, type ModTagStanding } from "./mod-updates";


/**
 * Where one installed mod stands against its own repository.
 *
 * The five orderable standings are `classifyModTag`'s, unchanged and deliberately
 * shared: the browse screen's row and this screen's bulk action must not disagree
 * about what an update is. `unavailable` is the one this module adds, and it is the
 * whole point - see the header.
 */
export type ModStanding = ModTagStanding | "unavailable";

export interface ModRefresh {
  readonly id: string;
  readonly repo: string;
  /** The tag on disk. */
  readonly installed: string;
  /**
   * The newest tag the repository offers within the player's channel, or null when
   * the repository could not be asked or offers nothing orderable.
   */
  readonly newest: string | null;
  readonly standing: ModStanding;
  /**
   * Why the repository could not be asked, in words a player can act on. Only ever
   * set when `standing` is "unavailable", and always set when it is.
   */
  readonly problem: string | null;
  /**
   * The newest tag the CHANNEL declined, or null. A player on stable looking at a
   * mod whose front page shows 0.14.0-beta.1 is not out of date, and "your channel
   * held it back" is the only answer that is both true and actionable.
   */
  readonly channelHeld: string | null;
}

/** One mod the player can move forward, and the two tags involved. */
export interface ModUpgrade {
  readonly id: string;
  readonly repo: string;
  readonly from: string;
  readonly to: string;
}

/**
 * Ask every installed mod's repository where it stands.
 *
 * One tags call per mod and nothing else: the manifest, the tree and the bytes are
 * only needed by an install the player has actually asked for, and a screen that
 * fetched them would spend four requests per mod to render a row.
 *
 * Never throws and never lets one mod cost another its answer - a deleted
 * repository must not stop the other three being checked. Results come back in the
 * order given, so the list reads the same way round as the manager's own.
 */
export async function refreshInstalledMods(
  installed: readonly InstalledModMeta[],
  env: DiscoverEnv,
): Promise<readonly ModRefresh[]> {
  return await Promise.all(installed.map((meta) => refreshOne(meta, env)));
}

async function refreshOne(meta: InstalledModMeta, env: DiscoverEnv): Promise<ModRefresh> {
  let all: readonly string[];
  try {
    all = await listTags(meta.repo, env);
  } catch (e) {
    /*
     * A 404 IS NOT PROOF THE MOD IS GONE. Deleted, renamed, made private, a typo
     * in a hand-entered repo, a proxy, a captive portal and an offline laptop all
     * arrive here. The installed bytes stay exactly where they are and the row says
     * it could not ask - the one thing it must not do is decide on the player's
     * behalf that a mod they are using no longer exists.
     */
    return {
      id: meta.id,
      repo: meta.repo,
      installed: meta.tag,
      newest: null,
      standing: "unavailable",
      problem: e instanceof Error ? e.message : String(e),
      channelHeld: null,
    };
  }

  /* The player's game channel is their mod channel - one setting, through the
   * updater's own rule (see mod-source.tagsInChannel). */
  const { tags, held } = env.channel
    ? tagsInChannel(env.channel, all)
    : { tags: all, held: null };
  const newest = tags[0] ?? null;

  if (newest === null) {
    /*
     * Reached the repository, and it offers nothing this player may have. That is
     * NOT "unavailable" - the question was answered - and it is not an update
     * either. `channelHeld` carries the reason when the channel is the reason,
     * which is the common case for a stable player and a mod mid-beta.
     */
    return {
      id: meta.id,
      repo: meta.repo,
      installed: meta.tag,
      newest: null,
      standing: "unorderable",
      problem: null,
      channelHeld: held,
    };
  }

  return {
    id: meta.id,
    repo: meta.repo,
    installed: meta.tag,
    newest,
    standing: classifyModTag(meta.tag, newest),
    problem: null,
    channelHeld: held,
  };
}

/**
 * Every mod with a strictly newer version waiting, and only those.
 *
 * `behind` ONLY, exactly as the old catalogue rule was. `ahead` is a mod author on
 * their own newer tag and installing the repository's is a DOWNGRADE;
 * `unorderable` is a guess; `unavailable` is a question that got no answer. None of
 * the three belongs in something called "update installed mods", and none belongs
 * in a count a player reads as "work waiting for me".
 */
export function pendingUpgrades(refreshed: readonly ModRefresh[]): readonly ModUpgrade[] {
  const out: ModUpgrade[] = [];
  for (const r of refreshed) {
    if (r.standing !== "behind" || r.newest === null) continue;
    out.push({ id: r.id, repo: r.repo, from: r.installed, to: r.newest });
  }
  return out;
}

/** The mods whose repositories could not be asked at all. */
export function unavailableMods(refreshed: readonly ModRefresh[]): readonly ModRefresh[] {
  return refreshed.filter((r) => r.standing === "unavailable");
}

/**
 * The one line the manager's row shows, which doubles as the whole report.
 *
 * EVERY BRANCH NAMES WHAT WAS ACTUALLY LOOKED AT. There is no wording here that
 * claims more than the check measured, because that is the defect this screen
 * shipped with: a true local computation wearing the label of a live one. A count
 * of mods that could not be reached is always shown when there is one - a player
 * with two mods current and one unreachable has not been told "current".
 */
export function modUpgradeRowLabel(
  /** Null when no check has been made yet, which is not the same as "nothing found". */
  refreshed: readonly ModRefresh[] | null,
  installedCount: number,
): string {
  if (installedCount === 0) return "Update installed mods...  (none installed)";
  if (refreshed === null) return "Update installed mods...  (checks each mod's own repository)";
  if (refreshed.length === 0) return "Update installed mods...  (none installed)";
  const pending = pendingUpgrades(refreshed).length;
  const blind = unavailableMods(refreshed).length;
  if (pending > 0) {
    return blind > 0
      ? `Update installed mods...  (${String(pending)} available, ${String(blind)} could not be checked)`
      : `Update installed mods...  (${String(pending)} available)`;
  }
  if (blind > 0) {
    return blind === refreshed.length
      ? "Update installed mods...  (could not reach GitHub)"
      : `Update installed mods...  (${String(blind)} could not be checked)`;
  }
  return "Update installed mods...  (each mod is at its repository's newest version)";
}

/** The line the (U)pdate screen shows about mods, or null when there is nothing. */
export function modUpgradeNotice(refreshed: readonly ModRefresh[]): string | null {
  return upgradeNotice(pendingUpgrades(refreshed));
}

/**
 * The same sentence, from the upgrades themselves.
 *
 * Two entry points and ONE wording, because the (U)pdate screen holds the pending
 * list rather than the refresh it came from, and a second copy of this sentence is
 * a second thing to keep in step.
 */
export function upgradeNotice(pending: readonly ModUpgrade[]): string | null {
  if (pending.length === 0) return null;
  const first = pending[0];
  return pending.length === 1 && first
    ? `1 installed mod has a newer version: ${first.id} ${first.from} -> ${first.to}.`
    : `${String(pending.length)} installed mods have newer versions.`;
}

/** How one refreshed mod reads on its own row. */
export function refreshRow(r: ModRefresh): string {
  const head = `${r.id} ${r.installed}`;
  switch (r.standing) {
    case "behind":
      return `${head} -> ${r.newest ?? ""}`;
    case "ahead":
      /* Not a fault and not an update: the copy on disk is newer than anything the
       * repository offers this player, which is what a mod author testing their own
       * build sees, and what any player sees whose channel just narrowed. */
      return `${head} (newer than ${r.repo}'s ${r.newest ?? "newest"})`;
    case "unavailable":
      return `${head} (could not check: ${r.problem ?? "no reason given"})`;
    case "unorderable":
      return r.channelHeld === null
        ? `${head} (${r.repo} offers no version this can be compared with)`
        : `${head} (${r.channelHeld} is held back by your update channel)`;
    case "absent":
    case "same":
    default:
      return r.channelHeld === null
        ? `${head} (newest)`
        : `${head} (newest on your channel; ${r.channelHeld} is beyond it)`;
  }
}

/**
 * The MODS_URL a player is told to visit for a mod that could not be reached.
 *
 * Its own function because the row must not build a URL out of a repo string that
 * may be the very thing that is wrong.
 */
export function repoPage(r: ModRefresh): string {
  return `https://github.com/${r.repo}`;
}
