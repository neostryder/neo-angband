import { type GridSurface, type GridPointerInput } from "../term";
import { type ModBrowseDeps, type ModUpgradeDeps } from "./browse-types";
import { openRegistry } from "./classic-browse-source";
import { type MenuItem, selectFromMenu, showTextScreen, promptText } from "../overlay";
import { t } from "@rpgm-tools/neo-angband-core";
import { C_FG, C_DIM, C_WARN, C_BAD } from "./browse-colors";
import { showZipImport } from "./classic-browse-archive";
import { askConsent, installOne } from "./classic-browse-install";
import { aboutLines, installFailureScreen } from "./browse-views";
import { DEFAULT_REGISTRY_URL } from "../mod-curated";
import { parseRepoRef } from "../mod-source";
import { showRepoInstallSummary } from "./classic-browse-summary";
import { type ModUpgrade, pendingUpgrades, unavailableMods, repoPage } from "../mod-refresh";
import { listedRepos, registryUpdateWaitingText, communityUpdateWaitingText, confirmCommunityUpdate, paintWhile, modUpdateReportScreen } from "./classic-update-views";
import { type ModOrigin } from "../mod-consent";

/**
 * The common entry point: the curated list, without making a player cross the
 * general-purpose source chooser first. The chooser remains available from
 * Recommended mods' "Get a mod another way..." row for registries,
 * repositories, and archives.
 */
export async function showRecommendedMods(
  term: GridSurface & GridPointerInput,
  deps: ModBrowseDeps,
): Promise<boolean> {
  return openRegistry(term, "curated", deps.curated, deps);
}

/**
 * The door chooser.
 *
 * Returns true when anything was installed or removed, so the caller can offer the
 * reload that makes it take effect.
 */
export async function showModBrowse(term: GridSurface & GridPointerInput, deps: ModBrowseDeps): Promise<boolean> {
  let changed = false;

  for (;;) {
    const allowed = deps.consent.read();
    const items: MenuItem[] = [
      {
        label: t("modBrowse.doorChooser.recommended", "Recommended mods"),
        color: C_FG,
        hint: t("modBrowse.doorChooser.recommendedHint", "A curated list of repositories, kept with the game."),
      },
      {
        label: t("modBrowse.doorChooser.registry", "Add from a registry address"),
        color: allowed ? C_FG : C_DIM,
        hint: allowed
          ? t("modBrowse.doorChooser.registryHint", "Somebody else's list of mods.")
          : t("modBrowse.doorChooser.needsConsent", 'Needs "Allow third-party mods" below.'),
      },
      {
        label: t("modBrowse.doorChooser.repository", "Add from a repository address"),
        color: allowed ? C_FG : C_DIM,
        hint: allowed
          ? t("modBrowse.doorChooser.repositoryHint", "One mod, by owner/repo.")
          : t("modBrowse.doorChooser.needsConsent", 'Needs "Allow third-party mods" below.'),
      },
      {
        label: t("modBrowse.doorChooser.importFile", "Import a mod from a file"),
        color: !deps.importZip ? C_DIM : allowed ? C_FG : C_DIM,
        hint: !deps.importZip
          ? t("modBrowse.doorChooser.cannotReadFile", "This front end cannot read a file.")
          : allowed
            ? t("modBrowse.doorChooser.importFileHint", "A .zip you have, or one waiting in the mods folder.")
            : t("modBrowse.doorChooser.needsConsent", 'Needs "Allow third-party mods" below.'),
      },
      {
        label: t("modBrowse.doorChooser.allowThirdParty", "Allow third-party mods: {state}", {
          state: allowed ? t("modBrowse.common.yes", "yes") : t("modBrowse.common.no", "no"),
        }),
        color: allowed ? C_WARN : C_FG,
        hint: allowed
          ? t(
              "modBrowse.doorChooser.acceptedRisks",
              "You have accepted the risks of installing other people's code.",
            )
          : t(
              "modBrowse.doorChooser.readFirst",
              "A mod can run code. Read what this means before choosing.",
            ),
      },
      {
        label: t("modBrowse.common.whatIsThis", "What is this?"),
        color: C_DIM,
        hint: t("modBrowse.doorChooser.whatIsThisHint", "Where mods come from."),
      },
    ];

    const pick = await selectFromMenu(
      term,
      "core:mod-get",
      t("modBrowse.doorChooser.title", "Get mods"),
      items,
      t("modBrowse.common.footer.escBack", "[ ESC to go back ]"),
    );
    if (pick === null) return changed;

    if (pick === 0) {
      if (await openRegistry(term, "curated", deps.curated, deps)) changed = true;
      continue;
    }
    if (pick === 3) {
      /* Its own consent handling lives inside the screen, because the disclaimer has
       * to be offered when a file is chosen rather than when the row is. */
      if (deps.importZip && (await showZipImport(term, deps))) changed = true;
      continue;
    }
    if (pick === 4) {
      await askConsent(term, deps);
      continue;
    }
    if (pick === 5) {
      await showTextScreen(term, t("modBrowse.doorChooser.title", "Get mods"), aboutLines());
      continue;
    }

    /* Doors 2 and 3. The consent check is repeated at the INSTALL as well
     * (mod-install.ts); this one exists so the player is offered the disclaimer
     * instead of being refused after typing an address. */
    if (!allowed) {
      const now = await askConsent(term, deps);
      if (!now) continue;
    }

    if (pick === 1) {
      const url = await promptText(
        term,
        t("modBrowse.doorChooser.registryPrompt", "Registry address"),
        DEFAULT_REGISTRY_URL,
        200,
        t("modBrowse.doorChooser.registryPromptFooter", "[ type or paste an address, Enter to read it, ESC to cancel ]"),
      );
      if (url === null || url.trim() === "") continue;
      if (await openRegistry(term, "third-party", () => deps.registryAt(url.trim()), deps)) {
        changed = true;
      }
      continue;
    }

    const typed = await promptText(
      term,
      t("modBrowse.doorChooser.repositoryPrompt", "Repository"),
      "",
      200,
      t(
        "modBrowse.doorChooser.repositoryPromptFooter",
        "[ owner/repo or a GitHub address, Enter to look it up, ESC to cancel ]",
      ),
    );
    if (typed === null || typed.trim() === "") continue;
    const ref = parseRepoRef(typed.trim());
    if (!ref.ok) {
      await showTextScreen(term, t("modBrowse.notARepo.title", "That is not a repository"), [
        { text: ref.problem, color: C_BAD },
        { text: "", color: C_FG },
        { text: t("modBrowse.notARepo.examples", "Examples:"), color: C_DIM },
        { text: "  neostryder/neo-angband-mod-qol", color: C_DIM },
        { text: "  https://github.com/neostryder/neo-angband-mod-qol", color: C_DIM },
        { text: "  https://github.com/neostryder/neo-angband-mod-qol/tree/v0.13.0", color: C_DIM },
      ]);
      continue;
    }
    /* The pre-install summary, not showSource: a pasted address is exactly ONE
     * repository, and the design (MOD_LIFECYCLE.md) is to show what installing
     * it would do and let the player confirm or cancel, rather than opening
     * the general list-and-detail screen every other door still uses. */
    if (await showRepoInstallSummary(term, ref.ref, deps)) {
      changed = true;
    }
  }
}

/* ------------------------------------------------------------------ *
 * Updating what is already installed.
 * ------------------------------------------------------------------ */

/**
 * Prepare the existing single-mod installer for a game-update pass.
 *
 * The pending tags still come from `pendingUpgrades`; this only turns one of
 * those already-shown, pinned tags into the same install operation the mod
 * manager normally performs.  One curated-list read covers the entire pass.
 *
 * A community mod's update is asked about first (confirmCommunityUpdate). The
 * Update screen's pass always has a player there: it starts from their ENTER and
 * their answer to "Update game and mods?". A caller with nobody to answer passes
 * `unattended`, and a community update then comes back as waiting for the
 * player's confirmation without being fetched or installed. A no, like a waiting
 * update, leaves the installed release in place.
 */
export async function gameUpdateModInstaller(
  term: GridSurface & GridPointerInput,
  deps: ModUpgradeDeps,
  opts?: { readonly unattended?: boolean },
): Promise<(upgrade: ModUpgrade) => Promise<string | null>> {
  const listed = await listedRepos(deps);
  return async (upgrade) => {
    if (!listed.readable) return registryUpdateWaitingText();
    const key = upgrade.repo.toLowerCase();
    const origin: ModOrigin = listed.vouched.has(key) ? "curated" : "third-party";
    const community = listed.community.has(key);
    if (community && opts?.unattended === true) return communityUpdateWaitingText();
    const entry = await deps.discover({ repo: upgrade.repo, tag: upgrade.to });
    if (!entry.ok) return entry.problem;
    /* Only asked while the switch is on. With it off the installer refuses anyway,
     * and asking "install this?" just to refuse the yes would be a question with
     * no right answer. */
    if (
      community &&
      deps.consent.read() &&
      !(await confirmCommunityUpdate(term, {
        name: entry.mod.name,
        from: upgrade.from,
        to: entry.mod.tag,
        repo: upgrade.repo,
      }))
    ) {
      return null;
    }
    let problem: string | null = null;
    const installed = await installOne(term, entry, origin, deps, {
      offerEnable: false,
      reportOutcome: false,
      onFailure: (reason) => {
        problem = reason;
      },
    });
    return installed ? null : (problem ?? "The mod was not installed.");
  };
}

/**
 * "Update installed mods": ask each installed mod's OWN repository, then offer.
 *
 * WHAT THIS SCREEN USED TO SAY. It compared the installed tags against the catalogue
 * compiled into the build and, finding nothing newer THERE, told the player
 * "Every installed mod is at the version this build knows about" over a paragraph
 * explaining that mod versions travel with the game and a newer mod arrives when you
 * update. All of that was true of the old design and none of it is true now: a mod
 * releases when its author releases it, and this screen asks.
 *
 * THREE ANSWERS, NOT TWO. A mod is behind, or it is at its repository's newest, or
 * THE REPOSITORY COULD NOT BE ASKED - and the third is not a quiet version of the
 * second. A 404 is deleted, renamed, made private, a typo, or an office proxy; a 403
 * is a rate limit that clears by itself. Every one of them leaves the installed bytes
 * exactly where they are and says what happened, on the row it happened to.
 *
 * The install path is `installOne`'s, the same one the browse screen uses, so the
 * consent gate, the requirements inspection, the origin check and the progress line
 * are not reimplemented here.
 */
export async function showModUpgrades(term: GridSurface & GridPointerInput, deps: ModUpgradeDeps): Promise<boolean> {
  let changed = false;

  for (;;) {
    /* Re-asked each time round, because an install just changed the answer. It is
     * one request per mod, and the alternative is a list that disagrees with what
     * the player just did. */
    const refreshed = await paintWhile(
      term,
      t("modBrowse.upgrades.title", "Update installed mods"),
      t("modBrowse.upgrades.asking", "Asking each mod's repository..."),
      () => deps.refresh(),
    );
    const pending = pendingUpgrades(refreshed);
    const blind = unavailableMods(refreshed);

    if (pending.length === 0) {
      await showTextScreen(term, modUpdateReportScreen(refreshed));
      return changed;
    }

    const items: MenuItem[] = [
      {
        label:
          pending.length === 1
            ? t("modBrowse.upgrades.updateIt", "Update it")
            : t("modBrowse.upgrades.updateAll", "Update all {count}", { count: pending.length }),
        color: C_WARN,
        hint: t(
          "modBrowse.upgrades.updateAllHint",
          "Download and store each one in turn. Nothing is enabled or disabled.",
        ),
      },
      ...pending.map((u) => ({
        label: `${u.name ?? u.id}  ${u.from} -> ${u.to}`,
        color: C_FG,
        hint: t("modBrowse.upgrades.updateOneHint", "Update only this one, from {repo}.", { repo: u.repo }),
      })),
      ...blind.map((r) => ({
        label: t("modBrowse.upgrades.couldNotCheck", "{name}  could not be checked", { name: r.name ?? r.id }),
        color: C_WARN,
        enabled: false,
        /* The address as well as the reason: a player told "HTTP 404" can do
         * nothing, and a player given the page can look at it themselves. */
        hint: `${r.problem ?? t("modBrowse.upgrades.noReasonGiven", "no reason given")} - ${repoPage(r)}`,
      })),
    ];

    const pick = await selectFromMenu(
      term,
      "core:mod-update",
      t("modBrowse.upgrades.title", "Update installed mods"),
      items,
      t("modBrowse.common.footer.escBack", "[ ESC to go back ]"),
    );
    if (pick === null) return changed;

    /* Snapshotted before the first install: `refresh()` is re-read at the top of the
     * loop, and a list that shrinks under an in-progress "update all" would skip
     * whatever moved up into the index just used. */
    const todo = pick === 0 ? pending : [pending[pick - 1]];
    const listed = await listedRepos(deps);
    if (!listed.readable) {
      await showTextScreen(term, installFailureScreen("", registryUpdateWaitingText()));
      return changed;
    }
    const resolved = await Promise.all(todo.filter((u): u is ModUpgrade => u !== undefined).map(async (u) => ({
      update: u,
      entry: await deps.discover({ repo: u.repo, tag: u.to }),
    })));
    for (const { update: u, entry } of resolved) {
      if (!u) continue;
      /* Pinned to the tag the check found, not to "newest": between the check and
       * this line the repository may have released again, and installing something
       * the player was never shown is exactly the surprise a notify-don't-auto-update
       * design exists to avoid. */
      if (!entry.ok) {
        await showTextScreen(term, installFailureScreen(u.id, entry.problem));
        continue;
      }
      const key = u.repo.toLowerCase();
      const origin: ModOrigin = listed.vouched.has(key) ? "curated" : "third-party";
      /* "Update all" included: each community mod is its own question, and a no
       * skips that one and moves on to the next. */
      if (
        listed.community.has(key) &&
        deps.consent.read() &&
        !(await confirmCommunityUpdate(term, { name: entry.mod.name, from: u.from, to: entry.mod.tag, repo: u.repo }))
      ) {
        continue;
      }
      if (await installOne(term, entry, origin, deps)) changed = true;
    }
  }
}
