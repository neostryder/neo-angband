import { declaredConflicts } from "./state-rules";
import { classicCatalog, classicManager } from "./classic-service";
import { type GridSurface, type GridPointerInput } from "../term";
import { type ModManagerDeps } from "./classic-types";
import { type CatalogMod } from "../mod-store";
import { confirmGameplayNoscore, gameplayNoscorePrompt, confirmUnreviewed, undecidedCapabilities, decidePermissions, saveDecisions, decidableCapabilities, regrantConsent } from "./classic-permissions";
import { selectFromMenu, type ScreenLine, showTextScreen, type MenuItem } from "../overlay";
import { t } from "@rpgm-tools/neo-angband-core";
import { C_ENABLED, C_FG, C_DIM, C_WARN, C_DANGER, C_DISABLED } from "./classic-colors";
import { manageModOptions } from "./classic-options";
import { enabledTileModIds } from "./classic-manager";
import { syncDelveOnApply } from "./delve-state";
import { wrapped, rowDetail, fullDescription } from "./classic-mod-views";
import { problemsFor } from "../mod-problems";
import { dropSessionMods } from "../mod-session";
import { type PackManifest, sortModOrder } from "@rpgm-tools/neo-angband-mod-sdk";
import { autoSortScreen } from "./classic-order-view";

/**
 * Enable a mod straight after the player selected "Install and enable".
 *
 * It re-reads the mod sources first, and that call is what makes the rest of this
 * possible. `listCatalog()` is built from a report latched at boot, so a mod
 * installed thirty seconds ago is not in it - the answer to "which mod is this"
 * would have been "no such mod", and enabling it by bare id would skip the
 * consent prompt and the non-scoring warning, which are exactly the things that
 * must not be skipped by a convenience. With the sources re-read the mod is a
 * real catalogue row and goes through the same enableMod every other path uses.
 *
 * There is intentionally no second yes/no screen for a content-only mod. The
 * action the player just chose already says "Install and enable", while the
 * browse pane they chose it from names the mod, version, author standing,
 * engine range, payload size, and source. Anything that changes the safety
 * decision (capabilities, a declared conflict, or a non-scoring game) still
 * stops here and asks in its own words before the mod is enabled.
 */
export async function enableAfterInstall(
  term: GridSurface & GridPointerInput,
  deps: ModManagerDeps,
  id: string,
): Promise<boolean> {
  await deps.rediscover?.();
  const m = classicCatalog(deps).find((x) => x.id === id);
  /* No row even after re-reading: the manifest did not validate, or this host has
   * no rediscover. Neither is a thing to ask a yes/no question about - the mod
   * list will show why - so say nothing and leave it off. */
  if (!m || m.missing) return false;
  if (m.enabled) return true;
  return enableMod(term, deps, m);
}

/** Enable a mod, gating plugins on capability consent. Returns true if enabled. */
export async function enableMod(
  term: GridSurface & GridPointerInput,
  deps: ModManagerDeps,
  m: CatalogMod,
): Promise<boolean> {
  if (!(await confirmGameplayNoscore(
    m,
    deps.isModNoscore?.() ?? false,
    () => gameplayNoscorePrompt(term, m),
  ))) return false;
  if (!(await confirmDeclaredConflicts(term, deps, m))) return false;
  if (!(await confirmUnreviewed(term, deps, [m]))) return false;
  const pending = undecidedCapabilities(m);
  if (pending.length > 0) {
    const decided = await decidePermissions(term, [{ mod: m, caps: pending }]);
    if (!decided) return false;
    saveDecisions(deps, [m], decided);
  }
  deps.advanceSaveRatchets?.(m);
  classicManager(deps).core.setEnabled(m.id, true);
  await offerFeatureOnboarding(term, deps, m);
  return true;
}

/**
 * A mod's own optional behaviour is opt-in-or-out at the moment it is
 * switched on, not just buried in an options screen the player may never
 * open. Skipped entirely when the manifest declares no rules - there is
 * nothing to choose. Runs AFTER `setModEnabled(m.id, true)`: the reused
 * "choose individually" screen refuses to show a disabled mod's rules
 * (`manageModOptions`'s own "enable this mod first" branch), so the store
 * has to already say the mod is on before this can open it.
 *
 * Fires every time a mod moves from off to on, including a re-enable after
 * being switched off, not just the first time ever - a player who turned
 * something off wants the same choice back when they turn it on again, not
 * to inherit whatever they picked previously with no way to revisit it here.
 *
 * Runs from inside the caller's own enable step, before the manager's single
 * end-of-loop reload - never after it - so enabling several mods in one
 * visit asks this once per mod, in order, rather than reloading once per
 * answer.
 */
export async function offerFeatureOnboarding(
  term: GridSurface & GridPointerInput,
  deps: ModManagerDeps,
  m: CatalogMod,
): Promise<void> {
  const rules = m.manifest.rules ?? [];
  if (rules.length === 0) return;

  const pick = await selectFromMenu(
    term,
    "core:mod-feature-onboarding",
    t("modsScreen.onboarding.title", "{name} is on. Which of its features?", { name: m.name }),
    [
      {
        label: t("modsScreen.onboarding.defaults", "Enable default features"),
        color: C_ENABLED,
        hint: t("modsScreen.onboarding.defaultsHint", "Use what this mod ships turned on."),
      },
      {
        label: t("modsScreen.onboarding.choose", "Choose features to enable"),
        color: C_FG,
        hint: t("modsScreen.onboarding.chooseHint", "Open its options and pick each one."),
      },
      {
        label: t("modsScreen.onboarding.none", "Do not enable any features"),
        color: C_DIM,
        hint: t("modsScreen.onboarding.noneHint", "The mod stays on but every feature starts off."),
      },
    ],
    t("modsScreen.common.footer.abcTapEsc", "[ a/b/c or tap; ESC = default features ]"),
  );

  if (pick === 1) {
    await manageModOptions(term, deps, [m], m.name);
    return;
  }
  if (pick === 2) {
    for (const rule of rules) {
      classicManager(deps).core.setRuleChoice(rule.flag, false);
      if (!rule.requiresReload) deps.applyRuleLive?.(rule.flag, false);
    }
  }
  /* pick === 0, or ESC: leave every choice unset, so resolveModRules falls
   * back to each rule's own manifest default. */
}

/**
 * Enable a recommended set after a bulk action, with one capability decision.
 *
 * The ordinary per-mod path deliberately remains as it is: its consent screen is
 * the right amount of ceremony for one mod. A bulk action has already collected a
 * set, so asking the same question several times would obscure the very capability
 * list the player needs to compare. Every other enable gate still runs before the
 * combined consent, then the grants and enables are committed together as a loop.
 */
export async function enableRecommendedMods(
  term: GridSurface & GridPointerInput,
  deps: ModManagerDeps,
  ids: readonly string[],
  enableAllOptions: boolean,
): Promise<boolean> {
  await deps.rediscover?.();
  const wanted = new Set(ids);
  const mods = classicCatalog(deps).filter((m) => wanted.has(m.id) && !m.missing);
  const toEnable = mods.filter((m) => !m.enabled);

  for (const m of toEnable) {
    if (!(await confirmGameplayNoscore(
      m,
      deps.isModNoscore?.() ?? false,
      () => gameplayNoscorePrompt(term, m),
    ))) return false;
    if (!(await confirmDeclaredConflicts(term, deps, m))) return false;
  }

  if (!(await confirmUnreviewed(term, deps, toEnable))) return false;
  const needingConsent = toEnable.filter((m) => undecidedCapabilities(m).length > 0);
  if (needingConsent.length > 0) {
    const decided = await decidePermissions(
      term,
      needingConsent.map((mod) => ({ mod, caps: undecidedCapabilities(mod) })),
      { core: classicManager(deps).core },
    );
    if (!decided) return false;
    saveDecisions(deps, needingConsent, decided);
  }
  for (const m of toEnable) {
    deps.advanceSaveRatchets?.(m);
    classicManager(deps).core.setEnabled(m.id, true);
  }

  if (!enableAllOptions) {
    /* Same per-mod choice as the ordinary enable path, one after another, so
     * a batch of recommended mods behaves the same as enabling that many
     * mods individually rather than silently taking raw manifest defaults. */
    for (const m of toEnable) await offerFeatureOnboarding(term, deps, m);
    return toEnable.length > 0;
  }
  /* The checkbox's own promise is "one approval screen covers them" - so it
   * skips the per-mod rule picker rather than answering it, and every rule
   * is left unset, which resolveModRules already reads as each rule's own
   * manifest default. Sections have no such picker yet, so they keep their
   * previous force-on behaviour here unchanged. */
  for (const m of mods) {
    for (const section of m.manifest.sections ?? []) {
      classicManager(deps).core.setSectionChoice(m.id, section.id, true);
    }
  }
  return toEnable.length > 0 || mods.some((m) => (m.manifest.sections?.length ?? 0) > 0);
}

/**
 * Apply a changed set when the manager closes. From play, offer the existing
 * reload decision; "Later" keeps the changes for a future reload. At the title,
 * reload at once so the next title and birth screens use the new mod set.
 */
export async function applyModChanges(
  term: GridSurface & GridPointerInput,
  deps: ModManagerDeps,
  tileModsAtEntry: ReadonlySet<string>,
  reloadNow = false,
): Promise<void> {
  /* A newly-enabled tiles mod contributes Graphics rows and nothing else, so
   * say so here and open that screen after the reload. Without this the player
   * enables a tile mod, reloads, sees an unchanged ASCII map, and concludes the
   * mod is broken - which is what happened. */
  const newTiles = [...enabledTileModIds(deps)].some((id) => !tileModsAtEntry.has(id));
  const pick = reloadNow ? 0 : await selectFromMenu(
    term,
    "core:mod-apply",
    newTiles
      ? t("modsScreen.applyPrompt.titleTiles", "Apply mod changes? (adds tile sets to Graphics)")
      : t("modsScreen.applyPrompt.title", "Apply mod changes?"),
    [
      {
        label: newTiles
          ? t("modsScreen.applyPrompt.reloadTiles", "Reload now, then pick a tile set")
          : t("modsScreen.applyPrompt.reload", "Reload now to apply"),
        color: C_ENABLED,
      },
      {
        label: t("modsScreen.applyPrompt.later", "Later (changes are saved; apply on next reload)"),
        color: C_FG,
      },
    ],
    t("modsScreen.applyPrompt.footer", "[ a/b or tap ]"),
  );
  if (pick === 0) {
    /* THE checkpoint (#158): once, here, never per-toggle - see syncDelveOnApply. */
    await syncDelveOnApply(deps);
    deps.requestReload(newTiles ? { showGraphics: true } : undefined);
  }
}

/**
 * Show any `conflicts` claim between this mod and one already enabled, and let
 * the player go ahead anyway.
 *
 * IT WARNS AND NEVER BLOCKS, which is the deliberate divergence from NeoForge
 * and Factorio - both refuse to launch an incompatible pair. Two reasons, and
 * they point the same way: ratified decision 18 says the engine labels rather
 * than forbids, and a claim is one author's opinion about somebody else's mod,
 * which must not become a veto over the player's own setup. A declaration also
 * goes stale - the other mod fixes the clash and the warning outlives it - and a
 * stale warning the player cannot walk past is a mod they cannot use.
 *
 * Both directions are checked: the claim may be written by the mod being enabled
 * or by one already on, and the player needs to see it either way.
 */
export async function confirmDeclaredConflicts(
  term: GridSurface & GridPointerInput,
  deps: ModManagerDeps,
  m: CatalogMod,
): Promise<boolean> {
  const catalog = classicCatalog(deps);
  const nameOf = (id: string): string => catalog.find((c) => c.id === id)?.name ?? id;
  const enabled = catalog.filter((c) => c.enabled && c.id !== m.id);
  const claims: { text: string; because: string }[] = [];

  const claimText = (a: string, b: string, scope: readonly string[] | undefined): string =>
    scope?.length
      ? t("modsScreen.conflicts.claimScoped", "{a} says it conflicts with {b} over {scope}.", {
          a,
          b,
          scope: scope.join(", "),
        })
      : t("modsScreen.conflicts.claim", "{a} says it conflicts with {b}.", { a, b });

  for (const c of declaredConflicts([m.manifest, ...enabled.map((other) => other.manifest)])) {
    if (c.packId !== m.id && c.with !== m.id) continue;
    claims.push({
      text: claimText(nameOf(c.packId), nameOf(c.with), c.scope),
      because: c.because,
    });
  }
  if (claims.length === 0) return true;

  const body: ScreenLine[] = [];
  for (const c of claims) {
    body.push({ text: c.text, color: C_WARN });
    body.push(...wrapped(c.because, term.size().cols - 1));
    body.push({ text: "", color: C_DIM });
  }
  body.push({
    text: t(
      "modsScreen.conflicts.authorWarning",
      "This is the author's own warning. Nothing stops you running both.",
    ),
    color: C_DIM,
  });
  /* LEFT AT `lines`, DELIBERATELY (see screen-view.ts's header for the rule).
   *
   * `claims` is a real array, but a claim does not render as a row: it is one
   * UNWRAPPED headline - the screen lets a long mod name run to the edge rather
   * than fold, which a `text` block would undo - followed by the author's own
   * `because`, wrapped to the live terminal, followed by a blank. That is one to
   * many rows per record, varying with the terminal's width and with what a
   * stranger typed into their manifest, and a table row is one row. Both halves
   * are also prose: the headline is a sentence this file generates and `because`
   * is free author text, which is the case the model calls finished at `lines`. */
  await showTextScreen(term, t("modsScreen.conflicts.enableTitle", "Enable {name}?", { name: m.name }), body);

  const pick = await selectFromMenu(
    term,
    "core:mod-enable-anyway",
    t("modsScreen.conflicts.enableAnyway", "Enable {name} anyway?", { name: m.name }),
    [
      { label: t("modsScreen.conflicts.enableItAnyway", "Enable it anyway"), color: C_WARN },
      { label: t("modsScreen.common.leaveItOff", "Leave it off"), color: C_DIM },
    ],
    t("modsScreen.common.footer.enterEscLeaveOff", "[ Enter to choose; ESC to leave it off ]"),
  );
  return pick === 0;
}

/**
 * Per-mod action submenu: toggle, reorder, THIS MOD'S patches, details. Returns
 * true if anything changed. The patch list hangs off the mod that provides it
 * rather than a pooled screen, because that is where a patch belongs: it is part
 * of a mod, arrives with it, and cannot exist without it.
 */
export async function manageMod(
  term: GridSurface & GridPointerInput,
  deps: ModManagerDeps,
  id: string,
  tileModsAtEntry: Set<string>,
): Promise<boolean> {
  let changed = false;
  let cursor = 0;
  for (;;) {
    const m = classicCatalog(deps).find((x) => x.id === id);
    if (!m) return changed;
    const trouble = deps.diskPackStatus?.();
    const myProblems = problemsFor(trouble?.problems ?? [], id);
    const mySkipped = problemsFor(trouble?.skipped ?? [], id);
    const items: MenuItem[] = [];
    const acts: string[] = [];
    /* A mod that is on and not installed has exactly one useful action, and
     * every other row on this screen would be about a manifest that is not
     * there. Offer the one thing, and say what it does. */
    if (m.missing) {
      const pick = await selectFromMenu(
        term,
        "core:mod-missing",
        m.name,
        [
          {
            label: t("modsScreen.missing.takeOff", "Take it off the list"),
            color: C_ENABLED,
            hint: t(
              "modsScreen.missing.takeOffHint",
              "The game stops trying to load it. Nothing else changes.",
            ),
          },
          {
            label: t("modsScreen.missing.leaveIt", "Leave it"),
            color: C_DIM,
            hint: t("modsScreen.missing.leaveItHint", "In case you mean to reinstall it."),
          },
        ],
        t("modsScreen.missing.footer", "[ Enter to choose; ESC to leave it ]"),
        {
          minListRows: 2,
          detail: () => rowDetail(m, term.size().cols, 99),
          detailToggleKey: "?",
          detailInitiallyShown: true,
        },
      );
      if (pick === 0) {
        classicManager(deps).core.setEnabled(m.id, false);
        tileModsAtEntry.delete(m.id);
        return true;
      }
      return changed;
    }
    const ruleCount = m.manifest.rules?.length ?? 0;
    /* This mod holds the one autoplayer slot right now: its Mod options screen
     * carries the speed row even on the unusual mod that ships a controller but
     * declares no rule of its own. */
    const autoplayerActive = deps.autoplayer?.activeId() === m.id;
    const sectionCount = m.manifest.sections?.length ?? 0;
    const optionCount = ruleCount + sectionCount + (autoplayerActive ? 1 : 0);
    const showOptionsRow = optionCount > 0;
    const optionsLabel = t("modsScreen.manageMod.optionsLabel", "Mod options ({count})...", {
      count: optionCount,
    });
    const optionsHint = t(
      "modsScreen.manageMod.optionsHint",
      "Fixes and structural parts together, so every setting for this mod is in one place.",
    );
    if (m.session) {
      /* NO DISABLE ROW FOR A SESSION MOD, and this is the reason rather than an
       * omission: it is on because it was staged, not because a stored choice says
       * so, and writing that choice would record a decision about a mod the player
       * does not have while the row stayed on anyway. Dropping the archive is the
       * control that means something, and it is the only honest way to stop a
       * staged plugin's code from running on the next reload. */
      items.push({
        label: t("modsScreen.manageMod.dropIt", "Drop it (this is how you stop it)"),
        color: C_DANGER,
        hint: t("modsScreen.manageMod.dropItHint", "Forgets the archive. Takes effect on the next reload."),
      });
      acts.push("drop");
      if (showOptionsRow) {
        items.push({ label: optionsLabel, color: C_ENABLED, hint: optionsHint });
        acts.push("options");
      }
    } else if (m.enabled) {
      /* FIRST, because it is the only row that changes whether this mod does
       * anything at all. Everything below it is a setting on a mod that is not
       * currently running. */
      if (!m.consented) {
        items.push({
          label: t("modsScreen.manageMod.regrant", "Allow what it now asks for (it is not running)"),
          color: C_DANGER,
          hint: t(
            "modsScreen.manageMod.regrantHint",
            "This version wants more than you allowed. Its code is off until you agree.",
          ),
        });
        acts.push("regrant");
      }
      items.push({ label: t("modsScreen.manageMod.disable", "Disable"), color: C_WARN });
      acts.push("disable");
      if (showOptionsRow) {
        items.push({ label: optionsLabel, color: C_ENABLED, hint: optionsHint });
        acts.push("options");
      }
      items.push({ label: t("modsScreen.manageMod.moveEarlier", "Move earlier (loads first)"), color: C_FG });
      acts.push("up");
      items.push({
        label: t("modsScreen.manageMod.moveLater", "Move later (loads last, wins conflicts)"),
        color: C_FG,
      });
      acts.push("down");
    } else {
      items.push({ label: t("modsScreen.manageMod.enable", "Enable"), color: C_ENABLED });
      acts.push("enable");
      if (showOptionsRow) {
        // Deliberately present and deliberately dead: it is the clearest way to
        // show that this mod HAS settings and that they do not exist yet.
        items.push({
          label: t(
            "modsScreen.manageMod.optionsLabelDisabled",
            "Mod options ({count} once enabled)",
            { count: optionCount },
          ),
          color: C_DISABLED,
          disabled: true,
          hint: t(
            "modsScreen.manageMod.optionsHintDisabled",
            "Enable this mod first - its fixes and parts do not exist until then.",
          ),
        });
        acts.push("options");
      }
    }
    /* Every decision can be changed later, one permission at a time. */
    if (!m.session && decidableCapabilities(m).length > 0 && undecidedCapabilities(m).length === 0) {
      items.push({
        label: t("modsScreen.manageMod.permissions", "Change permissions"),
        color: C_FG,
        hint: t(
          "modsScreen.manageMod.permissionsHint",
          "Switch each permission on or off. Changes apply after the game reloads.",
        ),
      });
      acts.push("permissions");
    }
    /* THE WAY TO READ A LONG BLURB.
     *
     * The pane below is capped so it can never squeeze this list (it did: a mod
     * with a thirty-line description left one action row on screen and no way to
     * scroll past it), and a cap means some descriptions are cut. This row is
     * where the rest of it lives, in the viewer that already scrolls. Offered
     * only when there IS a description, so it is never a row that opens nothing. */
    if (m.manifest.description) {
      items.push({
        label: t("modsScreen.manageMod.readFull", "Read the full description"),
        color: C_DIM,
        hint: t(
          "modsScreen.manageMod.readFullHint",
          "The whole thing, scrollable, with what it depends on.",
        ),
      });
      acts.push("read");
    }
    items.push({ label: t("modsScreen.common.back", "Back"), color: C_DIM });
    acts.push("back");

    const pick = await selectFromMenu(
      term,
      "core:mod-details",
      t("modsScreen.manageMod.title", "{name}  v{version}", { name: m.name, version: m.version }),
      items,
      t("modsScreen.manageMod.footer", "[ choose an action; ESC to go back ]"),
      {
        /* Every action row stays visible. This screen's list is short and fixed,
         * so there is no reason for the description to win any of it - and it is
         * the description that has somewhere else to be read in full. */
        minListRows: items.length,
        initialCursor: cursor,
        onHighlight: (i) => {
          cursor = i;
        },
        detail: () => rowDetail(m, term.size().cols, 99, myProblems, mySkipped),
        detailToggleKey: "?",
        detailInitiallyShown: true,
      },
    );
    const act = pick === null ? "back" : acts[pick];
    if (act === "back") return changed;
    if (act === "read") {
      await showTextScreen(
        term,
        t("modsScreen.manageMod.title", "{name}  v{version}", { name: m.name, version: m.version }),
        fullDescription(m, term.size().cols),
      );
      continue;
    }
    if (act === "enable") {
      if (await enableMod(term, deps, m)) changed = true;
    } else if (act === "regrant") {
      if (await regrantConsent(term, deps, m, tileModsAtEntry)) changed = true;
    } else if (act === "permissions") {
      const decided = await decidePermissions(term, [{ mod: m, caps: decidableCapabilities(m) }], {
        oneByOne: true,
        current: (id) => deps.store.getDecisions(id),
        core: classicManager(deps).core,
      });
      if (decided) {
        saveDecisions(deps, [m], decided);
        changed = true;
      }
    } else if (act === "disable") {
      classicManager(deps).core.setEnabled(m.id, false);
      /* Same reasoning as the space-toggle handler in runModManager (#208). */
      tileModsAtEntry.delete(m.id);
      changed = true;
    } else if (act === "drop") {
      if (await dropSession(term, deps, m)) changed = true;
    } else if (act === "options") {
      if (await manageModOptions(term, deps, [m], m.name)) changed = true;
    } else if (act === "up") {
      classicManager(deps).core.moveEnabled(m.id, -1);
      changed = true;
    } else if (act === "down") {
      classicManager(deps).core.moveEnabled(m.id, +1);
      changed = true;
    }
  }
}

/**
 * Drop a session-only mod: forget the archive, and say what that does and does not
 * undo.
 *
 * THE SECOND SENTENCE IS THE POINT. Dropping stops the pack composing and stops a
 * staged plugin's code running, from the next reload. It does not reach back into
 * a character the mod already touched, and it does not remove anything the code
 * wrote to storage or unsend anything it sent. A screen that said "dropped" and
 * stopped there would be describing a rollback, which this is not.
 */
export async function dropSession(
  term: GridSurface & GridPointerInput,
  deps: ModManagerDeps,
  m: CatalogMod,
): Promise<boolean> {
  const pick = await selectFromMenu(
    term,
    "core:mod-session-drop",
    t("modsScreen.dropSession.confirm", "Drop {name}?", { name: m.name }),
    [
      {
        label: t("modsScreen.dropSession.yes", "Yes, forget it"),
        color: C_DANGER,
        hint: t(
          "modsScreen.dropSession.yesHint",
          "It stops loading from the next reload. Nothing it already did is undone.",
        ),
      },
      {
        label: t("modsScreen.dropSession.keep", "Keep it for now"),
        color: C_DIM,
        hint: t("modsScreen.common.noChange", "No change."),
      },
    ],
    t("modsScreen.dropSession.footer", "[ Enter to choose; ESC to keep it ]"),
  );
  if (pick !== 0) return false;
  dropSessionMods(globalThis, m.id);
  await showTextScreen(term, m.name, [
    { text: t("modsScreen.dropSession.dropped", "{name} is dropped.", { name: m.name }), color: C_FG },
    { text: "", color: C_FG },
    { text: t("modsScreen.dropSession.stops", "It stops loading on the next reload."), color: C_FG },
    {
      text: t(
        "modsScreen.dropSession.stands1",
        "What it did while it was loaded stands: a character it changed is",
      ),
      color: C_DIM,
    },
    {
      text: t("modsScreen.dropSession.stands2", "still changed, and anything it stored is still stored."),
      color: C_DIM,
    },
  ]);
  void deps;
  return true;
}

/**
 * Auto-sort: propose a load order, show what it could not honour, and apply it
 * only if the player says so.
 *
 * A PROPOSAL, NOT AN ACTION. The order is shown before anything is written,
 * because a sort the player cannot review is one they cannot trust - and this
 * one is allowed to move mods for reasons no row in the list explains (a group,
 * a compat claim, an author's hint). Their own placements are pinned and survive
 * it (ModStore.moveEnabled records a pin), so pressing this does not throw away
 * the nudging they already did.
 *
 * It CANNOT FAIL. Where suggestions contradict each other the weakest is dropped
 * and named here; only a hard dependency cycle is left unresolved, and that is
 * an impossible mod set rather than a disagreement.
 *
 * This revises the 2026-07-27 ruling that load-order SORTING belongs to
 * Vortex/MO2 (MOD_LIFECYCLE section 3). The division of labour otherwise stands:
 * this is one button over the mods already installed, not staging, collections,
 * profiles-per-install or bulk management.
 */
export async function autoSortLoadOrder(term: GridSurface & GridPointerInput, deps: ModManagerDeps): Promise<boolean> {
  const current = deps.store.getEnabled();
  const byId = new Map(classicCatalog(deps).map((m) => [m.id, m]));
  const manifests = current
    .map((id) => byId.get(id)?.manifest)
    .filter((m): m is PackManifest => m !== undefined);

  if (manifests.length < 2) {
    await showTextScreen(term, t("modsScreen.autoSort.title", "Auto-sort"), [
      {
        text: t(
          "modsScreen.autoSort.nothingToSort",
          "There is nothing to sort - enable at least two mods first.",
        ),
        color: C_DIM,
      },
    ]);
    return false;
  }

  const result = sortModOrder(manifests, { pins: deps.store.getPins(), current });
  const nameOf = (id: string): string => byId.get(id)?.name ?? id;
  const unchanged = result.order.every((id, i) => current[i] === id);

  await showTextScreen(term, autoSortScreen(result, current, nameOf));
  if (unchanged) return false;

  const pick = await selectFromMenu(
    term,
    "core:mod-apply-order",
    t("modsScreen.autoSort.applyConfirm", "Apply this order?"),
    [
      { label: t("modsScreen.autoSort.applyIt", "Apply it"), color: C_ENABLED },
      { label: t("modsScreen.autoSort.leaveAlone", "Leave my order alone"), color: C_DIM },
    ],
    t("modsScreen.autoSort.applyFooter", "[ Enter to choose; ESC to leave it alone ]"),
  );
  if (pick !== 0) return false;
  classicManager(deps).core.setOrder(result.order);
  return true;
}
