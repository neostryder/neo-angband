import { classicBrowser } from "./classic-service";
import { linesScreen, SCREEN_FOOTER } from "../screen-view";
import { type GridSurface, type GridPointerInput } from "../term";
import { type ModBrowseDeps, type BrowseEntry } from "./browse-types";
import { selectFromMenu, showTextScreen, screenRegionSpec, type ScreenLine, type MenuItem } from "../overlay";
import { t } from "@rpgm-tools/neo-angband-core";
import { C_FG, C_WARN, C_BAD, C_DIM, C_GOOD } from "./browse-colors";
import { CONSENT_DISCLAIMER, type ModOrigin } from "../mod-consent";
import { pushRegion, regionSurface, popRegion } from "../ui-stack";
import { installFailureScreen } from "./browse-views";
import { repoPageUrl } from "../mod-source";
import { classifyModTag } from "../mod-updates";

/** Ask the consent question, showing the disclaimer. Returns the new setting. */
export async function askConsent(term: GridSurface & GridPointerInput, deps: ModBrowseDeps): Promise<boolean> {
  return classicBrowser(deps).core.drawConfirmation({ operation: "third-party", riskNotice: CONSENT_DISCLAIMER }, () => drawThirdPartyConsent(term, deps));
}

async function drawThirdPartyConsent(term: GridSurface & GridPointerInput, deps: ModBrowseDeps): Promise<boolean> {
  const on = deps.consent.read();
  if (on) {
    const off = await selectFromMenu(
      term,
      "core:mods-third-party-disable",
      t("modBrowse.consent.currentlyAllowed", "Third-party mods are allowed"),
      [
        {
          label: t("modBrowse.consent.leaveAllowed", "Leave them allowed"),
          color: C_FG,
          hint: t("modBrowse.common.noChange", "No change."),
        },
        {
          label: t("modBrowse.consent.stopAllowing", "Stop allowing them"),
          color: C_WARN,
          /* Stated on the row, because the fear that it deletes things is exactly
           * what stops people using a safety control. */
          hint: t(
            "modBrowse.consent.stopAllowingHint",
            "Does not uninstall or delete anything you already added.",
          ),
        },
      ],
      t("modBrowse.common.footer.escBack", "[ ESC to go back ]"),
    );
    if (off === 1 && !classicBrowser(deps).core.writeThirdPartyConsent(false)) {
      await showTextScreen(term, t("modBrowse.consent.couldNotSave", "Could not save that"), [
        {
          text: t(
            "modBrowse.consent.couldNotSaveBody1",
            "This browser would not let the game record the setting.",
          ),
          color: C_BAD,
        },
        {
          text: t("modBrowse.consent.couldNotSaveBody2", "It is off for now and may be back on next time."),
          color: C_FG,
        },
      ]);
    }
    return deps.consent.read();
  }

  await showTextScreen(term, { ...linesScreen(t("modBrowse.consent.beforeAllow", "Before you allow third-party mods"), [
    ...CONSENT_DISCLAIMER.map((text) => ({
      text,
      color: text.trimStart().startsWith("-") ? C_DIM : C_FG,
    })),
  ], SCREEN_FOOTER), id: "core:mods-third-party-consent" });
  const yes = await selectFromMenu(
    term,
    "core:mods-third-party-consent",
    t("modBrowse.consent.allowConfirm", "Allow third-party mods?"),
    [
      {
        label: t("modBrowse.consent.notForNow", "No, not for now"),
        color: C_FG,
        hint: t("modBrowse.consent.notForNowHint", "Only the recommended list stays available."),
      },
      {
        label: t("modBrowse.consent.iUnderstand", "Yes, I understand"),
        color: C_WARN,
        hint: t("modBrowse.consent.iUnderstandHint", "Lets you install from any registry or repository."),
      },
    ],
    t("modBrowse.consent.footer", "[ ESC to go back - the same as No ]"),
  );
  if (yes !== 1) return false;
  if (!classicBrowser(deps).core.writeThirdPartyConsent(true)) {
    await showTextScreen(term, t("modBrowse.consent.couldNotSave", "Could not save that"), [
      {
        text: t(
          "modBrowse.consent.couldNotSaveBody1",
          "This browser would not let the game record the setting.",
        ),
        color: C_BAD,
      },
      { text: "", color: C_FG },
      {
        text: t("modBrowse.consent.cannotInstall", "Third-party mods are still off, so nothing can be installed."),
        color: C_FG,
      },
    ]);
    /* Not honoured for this session. The installer re-reads the stored setting
     * (installBlocked), so a yes kept only here would be offered and then refused
     * at the install, and carrying it past that check would be a way round the
     * gate. The screen says what will actually happen instead. */
    return false;
  }
  return true;
}

/**
 * Install one mod, with progress, and say what happened.
 *
 * AN UPDATE IS NOT AN INSTALL, and this screen used to tell the player otherwise.
 * There was one message for both, and on an update of a mod the player had already
 * chosen and already switched on it read:
 *
 *     Quality of Life 0.14.0 installed.
 *     It is OFF until you turn it on in the mod list.
 *     Nothing is enabled by installing it.
 *
 * Every line of that is wrong for an update. The mod was not newly installed, it was
 * not switched off, and nothing about the player's choices changed - the second line
 * in particular tells someone whose mod is running that it is not, which is the kind
 * of message that sends a player to the mod list to fix something that is not broken.
 * It happened because "was it just turned on" was the only thing being asked, and an
 * already-enabled mod answers no to that.
 *
 * So the tag the player HAD is read before the install, and the outcome is one of
 * three sentences rather than a boolean: a first install, an upgrade, or a change to
 * a different version that is not newer (a deliberate rollback, or a tag nothing can
 * order). Each one says what became of the two things a player actually worries about
 * when replacing a mod that works: whether it is still on, and whether their settings
 * survived.
 */
export async function installOne(
  term: GridSurface & GridPointerInput,
  entry: Extract<BrowseEntry, { ok: true }>,
  origin: ModOrigin,
  deps: ModBrowseDeps,
  opts?: {
    readonly offerEnable?: boolean;
    /** A combined game update reports all failed mods together before restart. */
    readonly reportOutcome?: boolean;
    /** Lets that combined report retain the installer's exact refusal. */
    readonly onFailure?: (problem: string) => void;
  },
): Promise<boolean> {
  const m = entry.mod;
  /* BEFORE the install, because afterwards there is nothing left to compare - the
   * meta record has already been overwritten with the new tag. */
  const before = (await deps.installed()).get(m.id) ?? null;

  /* The progress screen is a REGION for exactly as long as the install runs
   * (#253). It repaints on every file, so without a rectangle it was a
   * full-screen erase arriving several times a second at a moment the player
   * cannot interrupt - the worst possible time for a front end to be wiped with
   * no way to learn it had happened. `screenRegionSpec` is core's own answer to
   * what rectangle a screen occupies; see overlay.ts. */
  const handle = pushRegion(screenRegionSpec(), term.size());
  const progress = regionSurface(term, handle.cells);
  const result = await classicBrowser(deps).core
    .installConfirmed(m, origin, (p) => {
      const { rows } = progress.size();
      progress.clear();
      progress.print(
        0,
        1,
        before === null
          ? t("modBrowse.progress.installing", "Installing {name} {version}", {
              name: m.name,
              version: m.version,
            })
          : t("modBrowse.progress.updating", "Updating {name} {version}", {
              name: m.name,
              version: m.version,
            }),
        C_FG,
      );
      progress.print(
        0,
        3,
        t("modBrowse.progress.fileOf", "{done} of {total}: {path}", {
          done: p.done,
          total: p.total,
          path: p.path,
        }),
        C_DIM,
      );
      progress.print(0, rows - 1, t("modBrowse.progress.pleaseWait", "[ please wait ]"), C_DIM);
      progress.flush?.();
    })
    /* Released before the outcome screen, which declares its own: a wait screen
     * left in the stack would keep telling a front end it is covered by
     * something that is no longer on screen. */
    .finally(() => {
      popRegion(handle);
    });

  if (!result.ok) {
    opts?.onFailure?.(result.problem);
    if (opts?.reportOutcome !== false) {
      await showTextScreen(term, installFailureScreen(m.name, result.problem, result.unmet));
    }
    return false;
  }

  /* Only a FIRST install asks. Re-offering on an update asks the player to re-make a
   * decision they already made, and answering "no" out of habit would switch off a
   * mod that was running - an update that can turn something off is an update nobody
   * should have to think about before accepting. */
  const enabled =
    before === null && opts?.offerEnable !== false && deps.offerEnable
      ? await deps.offerEnable(m.id)
      : false;

  if (opts?.reportOutcome !== false) {
    await showTextScreen(term, m.name, [
      ...installOutcomeLines(m.name, m.version, before, m.tag, enabled),
      { text: "", color: C_FG },
      {
        text: t("modBrowse.installOne.stored", "{count} file(s) stored, from {source}.", {
          count: result.meta.files.length,
          source: repoPageUrl(m.repo, m.tag),
        }),
        color: C_DIM,
      },
    ]);
  }
  return true;
}

/**
 * What to say after a successful install. Exported for the test that pins it, because
 * the wording IS the feature here - the bug this replaces was entirely in the words.
 *
 * `before` is the tag on disk beforehand, null for a first install. `enabled` is only
 * meaningful for a first install, and is ignored otherwise (see installOne).
 */
export function installOutcomeLines(
  name: string,
  version: string,
  before: string | null,
  after: string,
  enabled: boolean,
): ScreenLine[] {
  if (before === null) {
    return [
      { text: t("modBrowse.outcome.installed", "{name} {version} installed.", { name, version }), color: C_GOOD },
      { text: "", color: C_FG },
      ...(enabled
        ? [{ text: t("modBrowse.outcome.enabled", "It is enabled. Reload to start using it."), color: C_FG }]
        : [
            {
              text: t("modBrowse.outcome.off", "It is OFF until you turn it on in the mod list."),
              color: C_FG,
            },
            {
              text: t("modBrowse.outcome.nothingEnabled", "Nothing is enabled by installing it."),
              color: C_DIM,
            },
          ]),
    ];
  }

  /* Which DIRECTION, from the one classifier both this and the update screen use.
   * "Updated" is a claim about order, and a player who deliberately went back to an
   * older version should not be told they moved forward. */
  const standing = classifyModTag(before, after);
  const headline =
    standing === "behind"
      ? t("modBrowse.outcome.updated", "{name} updated: {before} -> {after}.", { name, before, after })
      : standing === "ahead"
        ? t("modBrowse.outcome.rolledBack", "{name} rolled back: {before} -> {after}.", {
            name,
            before,
            after,
          })
        : t("modBrowse.outcome.replaced", "{name} replaced: {before} -> {after}.", { name, before, after });

  return [
    { text: headline, color: C_GOOD },
    { text: "", color: C_FG },
    /* The two things a player worries about when replacing a mod that works. Both
     * are true by construction rather than by promise: the enabled set lives in the
     * player's own store keyed on the mod id, and a mod's preferences live in its
     * own bag - the installer replaces files and nothing else. */
    {
      text: t("modBrowse.outcome.settingsUnchanged", "Your on/off choice and this mod's settings are unchanged."),
      color: C_FG,
    },
    { text: t("modBrowse.outcome.reloadNewVersion", "Reload to start using the new version."), color: C_FG },
  ];
}

/**
 * The bulk shortcuts at the top of Recommended mods.
 *
 * Recommendation is a property of the curated registry, not of a manifest, so
 * this stays on the screen that has already read that registry. The toggles make
 * the install-all action explicit: replacement is normally wanted, enabling is
 * deliberately opt-in, and the two other actions remain separate jobs rather
 * than silently happening as side effects of install.
 */
export async function showRecommendedActions(
  term: GridSurface & GridPointerInput,
  entries: readonly BrowseEntry[],
  deps: ModBrowseDeps,
): Promise<boolean> {
  let updateExisting = true;
  let enableAfterInstall = false;
  let changed = false;
  const usable = (): Extract<BrowseEntry, { ok: true }>[] =>
    entries.filter((entry): entry is Extract<BrowseEntry, { ok: true }> => entry.ok && entry.mod.compatible);

  for (;;) {
    const items: MenuItem[] = [
      {
        label: t("modBrowse.recommended.bulkInstall", "Install all recommended mods..."),
        color: C_WARN,
        hint: t(
          "modBrowse.recommended.bulkInstallHint",
          "Install every recommended mod that is missing, with the choices below.",
        ),
      },
      {
        label: `${updateExisting ? "[x]" : "[ ]"} ${t("modBrowse.recommended.updateExisting", "Update mods already installed")}`,
        color: updateExisting ? C_GOOD : C_DIM,
        hint: t("modBrowse.recommended.updateExistingHint", "On by default. Never replaces a newer local copy."),
      },
      {
        label: `${enableAfterInstall ? "[x]" : "[ ]"} ${t("modBrowse.recommended.enableAfterInstall", "Enable after installing")}`,
        color: enableAfterInstall ? C_GOOD : C_DIM,
        hint: t(
          "modBrowse.recommended.enableAfterInstallHint",
          "Off by default. One approval screen covers every requested capability.",
        ),
      },
      {
        label: t("modBrowse.recommended.updateAll", "Update all recommended mods..."),
        color: C_FG,
        hint: t("modBrowse.recommended.updateAllHint", "Update installed recommended mods, without enabling anything."),
      },
      {
        label: t("modBrowse.recommended.enableAllOptions", "Enable all options from recommended mods..."),
        color: C_FG,
        hint: t(
          "modBrowse.recommended.enableAllOptionsHint",
          "Take each mod's own default features and every optional part, with no per-mod choice. Off asks once per mod instead.",
        ),
      },
    ];
    const pick = await selectFromMenu(
      term,
      "core:recommended-mod-actions",
      t("modBrowse.recommended.actionsTitle", "Recommended mod actions"),
      items,
      t("modBrowse.common.footer.escBack", "[ ESC to go back ]"),
    );
    if (pick === null) return changed;
    if (pick === 1) {
      updateExisting = !updateExisting;
      continue;
    }
    if (pick === 2) {
      enableAfterInstall = !enableAfterInstall;
      continue;
    }

    const installed = await deps.installed();
    const candidates = usable();
    if (pick === 0) {
      const todo = candidates.filter((entry) => {
        const at = installed.get(entry.mod.id) ?? null;
        return at === null || (updateExisting && classifyModTag(at, entry.mod.tag) === "behind");
      });
      for (const entry of todo) {
        if (await installOne(term, entry, "curated", deps, { offerEnable: false })) changed = true;
      }
      if (enableAfterInstall && deps.applyRecommended) {
        if (await deps.applyRecommended(candidates.map((entry) => entry.mod.id), false)) changed = true;
      }
      continue;
    }
    if (pick === 3) {
      const todo = candidates.filter((entry) => {
        const at = installed.get(entry.mod.id) ?? null;
        return at !== null && classifyModTag(at, entry.mod.tag) === "behind";
      });
      for (const entry of todo) {
        if (await installOne(term, entry, "curated", deps, { offerEnable: false })) changed = true;
      }
      continue;
    }
    if (pick === 4 && deps.applyRecommended) {
      if (await deps.applyRecommended(candidates.map((entry) => entry.mod.id), true)) changed = true;
    }
  }
}
