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

import {
  listTags,
  MAX_VERSIONS_TRIED,
  pickRunnableVersion,
  type DiscoverEnv,
  type EngineHeld,
} from "./mod-discover";
import { isImported, type InstalledModMeta } from "./mod-install";
import { compareTags } from "./mod-registry";
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
export type ModStanding = ModTagStanding | "unavailable" | "no-repository";

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
  /**
   * The newest version that exists and that this build cannot run, or null.
   *
   * THE OTHER HALF OF THIS MODULE'S OWN DEFECT. The header explains why "up to
   * date" must never be said about a repository that was not asked; this is the
   * same mistake pointing the other way. A tags call alone can see that v0.15.0
   * exists but not that v0.15.0 refuses to load here, so the screen would offer it,
   * the player would take it, and the loader would then decline the mod they just
   * installed. `newest` is now the newest version that will actually RUN, and this
   * field carries the one that was passed over so the row can say why.
   */
  readonly engineHeld: EngineHeld | null;
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
  /*
   * A MOD WITH NO REPOSITORY IS NOT A MOD THAT COULD NOT BE CHECKED. An imported zip
   * has no address to ask, so asking one is not merely pointless - it would send a
   * request for "file:import" to GitHub, get a 404, and report the mod as unavailable,
   * which reads as "something is wrong with your mod" about the one kind of mod that
   * is working exactly as designed. A distinct standing, because the two facts are
   * distinct and the row has to say different words.
   */
  if (isImported(meta)) {
    return {
      id: meta.id,
      repo: meta.repo,
      installed: meta.tag,
      newest: null,
      standing: "no-repository",
      problem: null,
      channelHeld: null,
      engineHeld: null,
    };
  }
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
      engineHeld: null,
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
      engineHeld: null,
    };
  }

  /*
   * ONLY VERSIONS STRICTLY NEWER THAN THE ONE ON DISK are asked about, and only
   * when there are any. The installed copy is not a candidate to be judged - it is
   * already installed - and walking below it would spend requests to learn
   * something that could not change the answer. A mod that is already at its
   * newest therefore still costs exactly one tags call, which is what this whole
   * screen was built to afford.
   */
  const ahead: string[] = [];
  for (const t of tags) {
    const order = compareTags(t, meta.tag);
    if (order !== null && order > 0) ahead.push(t);
  }

  let engineHeld: EngineHeld | null = null;
  let offer = newest;
  if (ahead.length > 0) {
    const pick = await pickRunnableVersion(meta.repo, ahead.slice(0, MAX_VERSIONS_TRIED), env);
    if (pick.problem === null) {
      engineHeld = pick.engineHeld;
      /* Nothing newer RUNS here, so the copy on disk is already the newest usable
       * one and there is nothing to offer. Answered with the installed tag rather
       * than with "no newer version exists", because one does exist and
       * `engineHeld` is where it gets named. */
      offer = pick.chosen?.tag ?? meta.tag;
    }
    /*
     * A MANIFEST THAT COULD NOT BE READ TELLS NOTHING EITHER WAY, so the old answer
     * stands and the newer tag is still offered. That is the deliberate choice
     * between two imperfect options: withholding an update over one failed request
     * would reintroduce this module's original sin in miniature - a claim about a
     * mod, made without asking - whereas offering it means the install path runs
     * this same walk with a live connection and steps back to a runnable version
     * there. The optimistic answer fails safe; the pessimistic one fails silent.
     */
  }

  return {
    id: meta.id,
    repo: meta.repo,
    installed: meta.tag,
    newest: offer,
    standing: classifyModTag(meta.tag, offer),
    problem: null,
    channelHeld: held,
    engineHeld,
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

/**
 * The mods holding a newer version back because this build cannot run it.
 *
 * Its own function so that every sentence about "newest" can subtract them. A mod
 * sitting on v0.14.4 while v0.15.0 exists is at its newest USABLE version, and a
 * screen that says "at its repository's newest version" about it is saying
 * something false in a place the player has no way to check.
 */
export function engineHeldMods(refreshed: readonly ModRefresh[]): readonly ModRefresh[] {
  return refreshed.filter((r) => r.engineHeld !== null);
}

/**
 * The mods whose repositories could not be asked at all.
 *
 * An imported mod is NOT one of these. It has no repository to fail to reach, so
 * counting it here would turn a working import into a warning the player cannot act on.
 */
export function unavailableMods(refreshed: readonly ModRefresh[]): readonly ModRefresh[] {
  return refreshed.filter((r) => r.standing === "unavailable");
}

/** The mods that came from a file rather than an address, so nothing can be asked. */
export function importedMods(refreshed: readonly ModRefresh[]): readonly ModRefresh[] {
  return refreshed.filter((r) => r.standing === "no-repository");
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
  const imported = importedMods(refreshed).length;
  /* The claim has to shrink to fit what was checked. "Each mod is at its newest" is
   * false the moment one of them was never asked, however good the reason. */
  if (imported === refreshed.length) {
    return "Update installed mods...  (every mod was imported from a file)";
  }
  if (imported > 0) {
    return `Update installed mods...  (the rest are at their newest; ${String(imported)} imported from a file)`;
  }
  /* "Newest" has to mean newest RUNNABLE once a version can be held back by the
   * engine, and the count is shown rather than folded in, because "update the game
   * and there is more waiting" is a different action from "nothing to do". */
  const held = engineHeldMods(refreshed).length;
  if (held > 0) {
    return (
      `Update installed mods...  (each is at the newest version this game can run; ` +
      `${String(held)} need a newer game)`
    );
  }
  return "Update installed mods...  (each mod is at its repository's newest version)";
}

/**
 * The headline on "Update installed mods" when nothing is waiting.
 *
 * ITS OWN FUNCTION FOR THE SAME REASON modUpgradeRowLabel IS. This sentence is the
 * whole answer the player takes away, and the wrong version of it is the exact defect
 * this screen shipped: a claim about every mod, made after checking some of them. Two
 * different reasons a mod goes unchecked now exist - it could not be reached, or it
 * never had a repository - and both have to come off the total before the word "every"
 * is allowed. Pulled out of the screen so a table test can drive every combination;
 * the version that lived inline was verified by looking at one of them.
 */
export function upToDateHeadline(refreshed: readonly ModRefresh[]): string {
  const total = refreshed.length;
  if (total === 0) return "No mods are installed yet.";
  const blind = unavailableMods(refreshed).length;
  const imported = importedMods(refreshed).length;
  const asked = total - blind - imported;
  if (asked === 0) {
    if (blind === 0) {
      return imported === 1
        ? "The one installed mod came from a file, so there is nothing to check."
        : "Every installed mod came from a file, so there is nothing to check.";
    }
    if (imported === 0) return "None of the installed mods could be checked.";
    return (
      `No installed mod could be checked: ${String(imported)} came from a file and ` +
      `${String(blind)} could not be reached.`
    );
  }
  const held = engineHeldMods(refreshed).length;
  if (blind === 0 && imported === 0) {
    return held === 0
      ? "Every installed mod is at its repository's newest version."
      : `Every installed mod is at the newest version this game can run. ` +
          `${String(held)} of them has a newer version that needs a newer game.`;
  }
  return (
    `${String(asked)} of ${String(total)} are at their repository's newest version.`
  );
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
    case "no-repository":
      /* Not a failure. This mod came out of a file the player chose, so there is no
       * address to ask and never was - saying "could not check" about it would be an
       * alarm about the one mod that is behaving exactly as designed. */
      return `${head} (imported from a file - import a newer zip to update it)`;
    case "unorderable":
      return r.channelHeld === null
        ? `${head} (${r.repo} offers no version this can be compared with)`
        : `${head} (${r.channelHeld} is held back by your update channel)`;
    case "absent":
    case "same":
    default:
      /* The engine's hold is named FIRST when there is one, because it is the only
       * one of the three the player can act on: change channel, update the game, or
       * nothing. "(newest)" alone about a mod whose repository visibly shows a newer
       * tag is the sentence that makes a player distrust the whole screen. */
      if (r.engineHeld !== null) {
        const h = r.engineHeld;
        return h.newerGameHelps === true
          ? `${head} (newest that runs here; ${h.tag} needs a newer game)`
          : `${head} (newest that runs here; ${h.tag} will not run on this build)`;
      }
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
