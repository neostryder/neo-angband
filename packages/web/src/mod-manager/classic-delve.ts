import { classicCatalog, classicManager, classicBrowser } from "./classic-service";
import { type GridSurface, type GridPointerInput } from "../term";
import { type ModManagerDeps } from "./classic-types";
import { t, ENGINE_VERSION, DEFAULT_HITPOINT_WARN, DEFAULT_DELAY_FACTOR, DEFAULT_LAZYMOVE_DELAY, optionsSaveCustom, host } from "@rpgm-tools/neo-angband-core";
import { saveDelveCandidates, applyDelveFlags } from "./delve-state";
import { showTextScreen, promptText, type MenuItem, selectFromMenu, MENU_REFRESH, promptPastedText, type ScreenLine } from "../overlay";
import { C_DIM, C_ENABLED, C_FG, C_DANGER, C_WARN } from "./classic-colors";
import { selectDelveMods, buildDelveFile, encodeDelve, delveFilename, type DelvePlanRow, type DelveFile, DELVE_EXT, DELVE_MAX_TEXT_BYTES, decodeDelve, type DelveDiscover, resolveDelveImportPlan, resolveDelveEnabledIds } from "../mod-delve";
import { customPageDefaults } from "../options";
import { downloadUserFile, pickTextFile } from "../userdir";
import { type DiscoveredMod } from "../mod-discover";
import { type ListedRepos, listedRepos, registryUpdateWaitingText, confirmCommunityUpdate } from "../mod-browse";
import { type ModOrigin as ConsentOrigin } from "../mod-consent";
import { enableMod } from "./classic-actions";
import { delveSyncLastSeenRevision, loadDelveSyncArrival, delveSyncCanAutoApply, markDelveSyncSeen } from "../mod-delve-sync";
import { installedMods } from "../mod-install";
import { restoreModListScreen } from "./classic-mod-list";

/** "Save a Delve...": name/description, a pre-checked mod checklist, options, then save/copy. */
export async function runSaveDelve(term: GridSurface & GridPointerInput, deps: ModManagerDeps): Promise<void> {
  const TITLE = t("modsScreen.delve.save.title", "Save a Delve...");
  const candidates = await saveDelveCandidates(deps);
  if (candidates.length === 0) {
    await showTextScreen(term, TITLE, [
      {
        text: t(
          "modsScreen.delve.save.none",
          "None of your enabled mods came from a repository, so there is nothing to save yet.",
        ),
        color: C_DIM,
      },
    ]);
    return;
  }

  const name = await promptText(
    term,
    t("modsScreen.delve.save.namePrompt", "Name this Delve"),
    "",
    60,
    t("modsScreen.delve.save.nameFooter", "[ type a name, Enter to accept, ESC to cancel ]"),
  );
  if (name === null || name.trim() === "") return;
  const description = await promptText(
    term,
    t("modsScreen.delve.save.descPrompt", "Description (optional)"),
    "",
    200,
    t("modsScreen.delve.save.descFooter", "[ type a description, Enter to accept, ESC to skip ]"),
  );

  const checked = new Set(candidates.map((c) => c.entry.id));
  let includeGame = false;
  let includeBirth = false;
  for (;;) {
    const items: MenuItem[] = candidates.map((c) => ({
      label: `${checked.has(c.entry.id) ? "[x]" : "[ ]"} ${c.mod.name} v${c.mod.version}`,
      color: checked.has(c.entry.id) ? C_ENABLED : C_DIM,
    }));
    const gameIndex = items.length;
    items.push({
      label: `${includeGame ? "[x]" : "[ ]"} ${t("modsScreen.delve.save.includeGame", "Include my general game options")}`,
      color: includeGame ? C_ENABLED : C_DIM,
    });
    const birthIndex = items.length;
    items.push({
      label: `${includeBirth ? "[x]" : "[ ]"} ${t("modsScreen.delve.save.includeBirth", "Include my birth options")}`,
      color: includeBirth ? C_ENABLED : C_DIM,
    });
    const saveIndex = items.length;
    items.push({ label: t("modsScreen.delve.save.toFile", "Save to file"), color: C_ENABLED });
    const clipIndex = items.length;
    items.push({ label: t("modsScreen.delve.save.toClipboard", "Copy to clipboard"), color: C_FG });

    const pick = await selectFromMenu(
      term,
      "core:save-delve",
      TITLE,
      items,
      t("modsScreen.delve.common.checklistFooter", "[ Space or Enter toggles/opens a row, ESC cancels ]"),
    );
    if (pick === null) return;
    if (pick < candidates.length) {
      const id = candidates[pick]?.entry.id;
      if (id === undefined) continue;
      if (checked.has(id)) checked.delete(id);
      else checked.add(id);
      continue;
    }
    if (pick === gameIndex) {
      includeGame = !includeGame;
      continue;
    }
    if (pick === birthIndex) {
      includeBirth = !includeBirth;
      continue;
    }
    if (pick !== saveIndex && pick !== clipIndex) continue;

    const selected = selectDelveMods(
      candidates.map((c) => c.entry),
      checked,
    );
    const configuration = await classicManager(deps).service.captureModList(name.trim());
    const modList = { ...configuration, mods: configuration.mods.filter((m) => checked.has(m.id)), resolvedOrder: configuration.resolvedOrder.filter((id) => checked.has(id)) };
    deps.modLists?.save(modList);
    const file = buildDelveFile({
      modList,
      name: name.trim(),
      ...(description !== null && description.trim() !== "" ? { description: description.trim() } : {}),
      createdAt: new Date().toISOString(),
      createdWithEngine: ENGINE_VERSION,
      mods: selected,
      ...(includeGame || includeBirth
        ? {
            options: {
              ...(includeBirth ? { birth: customPageDefaults("BIRTH") } : {}),
              ...(includeGame
                ? {
                    game: {
                      values: customPageDefaults("INTERFACE"),
                      /* No live GameState is reachable from the mod manager's own
                       * dependency surface (it opens from the title screen too),
                       * and there is no customized-defaults persistence for these
                       * three scalars the way there is for the boolean options
                       * (options-file.ts only ever carries OptionOpts, a plain
                       * name->boolean map) - so they travel as the table
                       * defaults rather than a live character's actual values.
                       * Noted plainly rather than silently wired to a fake live
                       * read. */
                      hitpointWarn: DEFAULT_HITPOINT_WARN,
                      delayFactor: DEFAULT_DELAY_FACTOR,
                      lazymoveDelay: DEFAULT_LAZYMOVE_DELAY,
                    },
                  }
                : {}),
            },
          }
        : {}),
    });
    const text = encodeDelve(file);
    const outName = delveFilename(file.name);

    if (pick === saveIndex) {
      const ok = downloadUserFile(outName, text, "application/json");
      await showTextScreen(term, TITLE, [
        ok
          ? {
              text: t("modsScreen.delve.save.savedOk", "{name} written to {file}.", {
                name: file.name,
                file: outName,
              }),
              color: C_ENABLED,
            }
          : { text: t("modsScreen.delve.save.savedFail", "This browser refused the download."), color: C_DANGER },
      ]);
      return;
    }
    let copied = false;
    try {
      await navigator.clipboard.writeText(text);
      copied = true;
    } catch {
      copied = false;
    }
    await showTextScreen(term, TITLE, [
      copied
        ? {
            text: t("modsScreen.delve.save.copiedOk", "Copied to your clipboard - paste it wherever you like."),
            color: C_ENABLED,
          }
        : { text: t("modsScreen.delve.save.copiedFail", "Your browser refused clipboard access."), color: C_DANGER },
    ]);
    return;
  }
}

/** Whether a preview row can ever be part of the accepted set (see the row-state table, docs/MOD_PROFILES.md). */
export function delveRowIncludable(row: DelvePlanRow<DiscoveredMod>): boolean {
  return row.state === "same-version" || (row.resolution?.ok ?? false);
}

/** One preview-screen row's label and colour (docs/MOD_PROFILES.md's row-state table). */
export function delvePreviewRowLabel(
  row: DelvePlanRow<DiscoveredMod>,
  installedTag: string | null,
  checked: boolean,
  updateChoice: "update" | "keep",
): MenuItem {
  const label = `${row.entry.name} v${row.entry.version || row.entry.tag}`;
  const box = `[${checked ? "x" : " "}]`;
  if (row.state === "same-version") {
    return {
      label: `${box} ${label} - ${t("modsScreen.delve.load.rowSame", "already installed, unchanged")}`,
      color: checked ? C_ENABLED : C_DIM,
    };
  }
  if (!delveRowIncludable(row)) {
    const reason = row.resolution && !row.resolution.ok ? row.resolution.reason : "";
    return {
      label: t("modsScreen.delve.load.rowUnreachable", "{label} - unreachable: {reason}", { label, reason }),
      color: C_DANGER,
    };
  }
  if (row.state === "different-version") {
    const to = row.resolution?.ok ? row.resolution.mod.tag : row.entry.tag;
    return {
      label: `${box} ${label}: ${t("modsScreen.delve.load.rowDifferent", "installed {from} -> Delve wants {to} ({choice})", {
        from: installedTag ?? "?",
        to,
        choice:
          updateChoice === "update"
            ? t("modsScreen.delve.load.update", "update")
            : t("modsScreen.delve.load.keep", "keep installed"),
      })}`,
      color: checked ? C_ENABLED : C_DIM,
    };
  }
  const usedRequested = row.resolution?.ok ? row.resolution.usedRequestedTag : true;
  const to = row.resolution?.ok ? row.resolution.mod.tag : row.entry.tag;
  return {
    label: `${box} ${label}: ${
      usedRequested
        ? t("modsScreen.delve.load.rowFetch", "will be fetched at {tag}", { tag: to })
        : t("modsScreen.delve.load.rowFetchOther", "will be fetched at {tag} (newest this build can run)", {
            tag: to,
          })
    }`,
    color: checked ? C_ENABLED : C_DIM,
  };
}

/** The preview screen: one row per mod, togglable, with a per-row update-or-keep choice. */
export async function runDelvePreview(
  term: GridSurface & GridPointerInput,
  file: DelveFile,
  plan: readonly DelvePlanRow<DiscoveredMod>[],
  installed: ReadonlyMap<string, string>,
): Promise<{ readonly accepted: ReadonlySet<string>; readonly updateChoice: ReadonlyMap<string, "update" | "keep"> } | null> {
  const accepted = new Set<string>(plan.filter(delveRowIncludable).map((r) => r.entry.id));
  const updateChoice = new Map<string, "update" | "keep">();
  let cursor = 0;
  for (;;) {
    const items: MenuItem[] = plan.map((row) =>
      delvePreviewRowLabel(
        row,
        installed.get(row.entry.id) ?? null,
        accepted.has(row.entry.id),
        updateChoice.get(row.entry.id) ?? "update",
      ),
    );
    const continueIndex = items.length;
    items.push({ label: t("modsScreen.delve.load.previewContinue", "Continue..."), color: C_ENABLED });
    const pick = await selectFromMenu(
      term,
      "core:load-delve-preview",
      t("modsScreen.delve.load.previewTitle", "{name} - what would happen", {
        name: file.name || "this Delve",
      }),
      items,
      t(
        "modsScreen.delve.load.previewFooter",
        "[ Space includes/excludes a row, u = update or keep an installed version, Enter continues ]",
      ),
      {
        initialCursor: cursor,
        onHighlight: (i) => {
          cursor = i;
        },
        commands: {
          " ": (cur) => {
            const row = plan[cur];
            if (!row || !delveRowIncludable(row)) return null;
            const id = row.entry.id;
            if (accepted.has(id)) accepted.delete(id);
            else accepted.add(id);
            return MENU_REFRESH;
          },
          u: (cur) => {
            const row = plan[cur];
            if (!row || row.state !== "different-version") return null;
            const id = row.entry.id;
            updateChoice.set(id, (updateChoice.get(id) ?? "update") === "update" ? "keep" : "update");
            return MENU_REFRESH;
          },
        },
      },
    );
    if (pick === MENU_REFRESH) continue;
    if (pick === null) return null;
    if (pick === continueIndex) break;
  }
  return { accepted, updateChoice };
}

/**
 * "Load a Delve...": from a file or pasted text, gated on `magic` alone; a
 * preview per mod; a merge-or-replace choice asked once; options checkboxes
 * off by default even when the file carries them; confirm applies through
 * the same install/enable path "Install a mod..." already uses, then a
 * result screen. Returns whether anything changed (the caller's `dirty`).
 */
export async function runLoadDelve(
  term: GridSurface & GridPointerInput,
  deps: ModManagerDeps,
  /**
   * A Delve's text already in hand - the sync-arrival banner's "Review..."
   * (#158), which has already read the file from the remembered sync folder
   * and has nothing left to ask about ITS source. Skips straight past the
   * "From a file.../Paste text..." choice below; everything after that -
   * the preview, the merge choice, options, confirm - is unchanged, which is
   * what makes this "no new wizard" rather than a second one.
   */
  preloadedText?: string,
): Promise<boolean> {
  const TITLE = t("modsScreen.delve.load.title", "Load a Delve...");
  if (!deps.modBrowse) return false;
  const modBrowse = deps.modBrowse;

  let text: string;
  if (preloadedText !== undefined) {
    text = preloadedText;
  } else {
    const savedLists = Object.values(deps.modLists?.list() ?? {});
    const sourcePick = await selectFromMenu(
      term,
      "core:load-delve-source",
      TITLE,
      [
        { label: t("modsScreen.delve.load.fromFile", "From a file..."), color: C_FG },
        { label: t("modsScreen.delve.load.pasteText", "Paste text..."), color: C_FG },
        ...(savedLists.length ? [{ label: "My mod lists", color: C_FG }] : []),
      ],
      t("modsScreen.delve.common.footer.abcEsc", "[ a/b or tap, ESC to cancel ]"),
    );
    if (sourcePick === null) return false;
    if (sourcePick === 2) {
      const pick = await selectFromMenu(term, "core:load-mod-list", "My mod lists", savedLists.map((list) => ({ label: list.name })), "[ arrows or tap; Enter selects; ESC cancels ]");
      return pick !== null && savedLists[pick] !== undefined ? restoreModListScreen(term, deps, savedLists[pick]) : false;
    }

    if (sourcePick === 0) {
      const picked = await pickTextFile(`${DELVE_EXT},.json,application/json`, DELVE_MAX_TEXT_BYTES);
      if (picked === null) return false;
      if ("tooLarge" in picked) {
        await showTextScreen(term, TITLE, [
          {
            text: t("modsScreen.delve.load.tooLarge", "That file is too large to be a Delve."),
            color: C_DANGER,
          },
        ]);
        return false;
      }
      text = picked.text;
    } else {
      const pasted = await promptPastedText(
        term,
        t("modsScreen.delve.load.pastePrompt", "Paste a Delve"),
        DELVE_MAX_TEXT_BYTES,
      );
      if (pasted === null) return false;
      text = pasted;
    }
  }

  /* Gated on `magic` alone, never the file name or extension - the importer
   * reads content, not names (docs/MOD_PROFILES.md, "File extension"). */
  const decoded = decodeDelve(text);
  if (!decoded.ok) {
    await showTextScreen(term, TITLE, [{ text: decoded.why, color: C_DANGER }]);
    return false;
  }
  const file = decoded.file;
  if (file.modList) return restoreModListScreen(term, deps, file.modList);
  if (file.mods.length === 0) {
    await showTextScreen(term, TITLE, [
      { text: t("modsScreen.delve.load.empty", "That Delve names no mods to import."), color: C_DIM },
    ]);
    return false;
  }

  const installed = await modBrowse.installed();
  const discover: DelveDiscover<DiscoveredMod> = async (ref) => {
    const r = await modBrowse.discover(ref);
    return r.ok ? { ok: true, mod: r.mod } : { ok: false, problem: r.problem };
  };
  const plan = await resolveDelveImportPlan(file.mods, installed, discover);

  const preview = await runDelvePreview(term, file, plan, installed);
  if (preview === null) return false;
  const finalRows = plan.filter((r) => preview.accepted.has(r.entry.id));
  if (finalRows.length === 0) {
    await showTextScreen(term, TITLE, [
      { text: t("modsScreen.delve.load.nothingLeft", "Nothing left to import."), color: C_DIM },
    ]);
    return false;
  }

  const mergePick = await selectFromMenu(
    term,
    "core:load-delve-merge",
    t("modsScreen.delve.load.mergeTitle", "How should this apply?"),
    [
      {
        label: t("modsScreen.delve.load.mergeReplace", "Replace my mod set"),
        color: C_WARN,
        hint: t(
          "modsScreen.delve.load.mergeReplaceHint",
          "Every mod not named in the Delve is turned off, matching it exactly.",
        ),
      },
      {
        label: t("modsScreen.delve.load.mergeAdd", "Add to my current set"),
        color: C_FG,
        hint: t(
          "modsScreen.delve.load.mergeAddHint",
          "Only the named mods change; everything else you already run is left alone.",
        ),
      },
    ],
    t("modsScreen.delve.common.footer.abcEsc", "[ a/b or tap, ESC to cancel ]"),
  );
  if (mergePick === null) return false;
  const replace = mergePick === 0;

  let applyGame = false;
  let applyBirth = false;
  if (file.options?.game !== undefined || file.options?.birth !== undefined) {
    for (;;) {
      const items: MenuItem[] = [];
      const gameIndex = file.options.game !== undefined ? items.length : -1;
      if (file.options.game !== undefined) {
        items.push({
          label: `${applyGame ? "[x]" : "[ ]"} ${t(
            "modsScreen.delve.load.applyGame",
            "Also apply the general game options in this file",
          )}`,
          color: applyGame ? C_ENABLED : C_DIM,
        });
      }
      const birthIndex = file.options.birth !== undefined ? items.length : -1;
      if (file.options.birth !== undefined) {
        items.push({
          label: `${applyBirth ? "[x]" : "[ ]"} ${t(
            "modsScreen.delve.load.applyBirth",
            "Also apply the birth options to my next new character",
          )}`,
          color: applyBirth ? C_ENABLED : C_DIM,
        });
      }
      const continueIndex = items.length;
      items.push({ label: t("modsScreen.delve.load.optionsContinue", "Continue..."), color: C_ENABLED });
      const pick = await selectFromMenu(
        term,
        "core:load-delve-options",
        t("modsScreen.delve.load.optionsTitle", "This Delve also carries options"),
        items,
        t("modsScreen.delve.common.checklistFooter", "[ Space or Enter toggles/opens a row, ESC cancels ]"),
      );
      if (pick === null) return false;
      if (pick === gameIndex) {
        applyGame = !applyGame;
        continue;
      }
      if (pick === birthIndex) {
        applyBirth = !applyBirth;
        continue;
      }
      if (pick === continueIndex) break;
    }
  }

  /* CONFIRM: fetch/update through the same door "Install a mod..." uses -
   * `deps.modBrowse.install`, which enforces third-party consent itself
   * (mod-install.ts's `installBlocked`) - then enable through the ordinary
   * per-mod path (`enableMod`), which is where the PLAIN-LANGUAGE consent
   * prompt for a plugin's own capabilities lives. Consent is never inherited
   * from `entry.consents`: that field is read nowhere near a grant, only
   * carried as preview data on the row above. */
  const resultLines: ScreenLine[] = [];
  /* Read once, and only when a row would replace an installed release. */
  let listed: ListedRepos | undefined;
  for (const row of finalRows) {
    const entry = row.entry;
    if (row.state === "same-version") {
      resultLines.push({
        text: t("modsScreen.delve.load.resultUnchanged", "{name}: already installed, unchanged.", {
          name: entry.name,
        }),
        color: C_FG,
      });
      continue;
    }
    if (row.state === "different-version" && (preview.updateChoice.get(entry.id) ?? "update") === "keep") {
      resultLines.push({
        text: t("modsScreen.delve.load.resultKept", "{name}: kept your installed version.", {
          name: entry.name,
        }),
        color: C_FG,
      });
      continue;
    }
    if (!row.resolution || !row.resolution.ok) {
      /* Excluded from `finalRows` by delveRowIncludable unless the player
       * force-included it before it resolved - defensive, not reachable
       * through the ordinary preview flow. */
      resultLines.push({
        text: t("modsScreen.delve.load.resultUnreachable", "{name}: could not be installed.", {
          name: entry.name,
        }),
        color: C_DANGER,
      });
      continue;
    }
    /* A Delve that moves an installed community mod to another release asks
     * first, as every update path does (confirmCommunityUpdate). A no keeps the
     * installed release, reported the same as choosing "keep" on the preview. */
    const installedTag = installed.get(entry.id) ?? null;
    if (row.state === "different-version" && installedTag !== null && modBrowse.consent.read()) {
      listed ??= await listedRepos(modBrowse);
      if (!listed.readable) {
        resultLines.push({ text: `${entry.name}: ${registryUpdateWaitingText()}`, color: C_DANGER });
        continue;
      }
      const mod = row.resolution.mod;
      if (
        listed.community.has(mod.repo.toLowerCase()) &&
        !(await confirmCommunityUpdate(term, { name: mod.name, from: installedTag, to: mod.tag, repo: mod.repo }))
      ) {
        resultLines.push({
          text: t("modsScreen.delve.load.resultKept", "{name}: kept your installed version.", {
            name: entry.name,
          }),
          color: C_FG,
        });
        continue;
      }
    }
    const origin: ConsentOrigin = "third-party";
    const installResult = await classicBrowser(modBrowse).core.installConfirmed(row.resolution.mod, origin, () => {});
    if (!installResult.ok) {
      resultLines.push({ text: `${entry.name}: ${installResult.problem}`, color: C_DANGER });
      continue;
    }
    resultLines.push({
      text: row.resolution.usedRequestedTag
        ? t("modsScreen.delve.load.resultInstalled", "{name}: installed at {tag}.", {
            name: entry.name,
            tag: installResult.meta.tag,
          })
        : t(
            "modsScreen.delve.load.resultInstalledOther",
            "{name}: installed at {tag} (the version this build can run).",
            { name: entry.name, tag: installResult.meta.tag },
          ),
      color: C_ENABLED,
    });
  }

  await deps.rediscover?.();
  const currentEnabled = deps.store.getEnabled();
  const nextEnabled = resolveDelveEnabledIds({
    currentEnabled,
    entries: finalRows.map((r) => r.entry),
    replace,
  });
  if (replace) {
    for (const id of currentEnabled) {
      if (!nextEnabled.includes(id)) classicManager(deps).core.setEnabled(id, false);
    }
  }
  const catalogNow = classicCatalog(deps);
  for (const row of finalRows) {
    const entry = row.entry;
    const m = catalogNow.find((x) => x.id === entry.id);
    if (!m) continue; // could not be installed above; nothing to enable or flag
    if (!entry.enabled) {
      classicManager(deps).core.setEnabled(entry.id, false);
    } else if (!m.enabled) {
      await enableMod(term, deps, m);
    }
    applyDelveFlags(m.manifest, entry.id, entry.flags, deps.store);
  }

  if (applyBirth && file.options?.birth !== undefined) {
    optionsSaveCustom(host(), file.options.birth, "BIRTH");
  }
  if (applyGame && file.options?.game !== undefined) {
    optionsSaveCustom(host(), file.options.game.values, "INTERFACE");
  }

  await showTextScreen(
    term,
    TITLE,
    resultLines.length > 0
      ? resultLines
      : [{ text: t("modsScreen.delve.load.nothingReport", "Nothing to report."), color: C_DIM }],
  );
  return true;
}

/**
 * Checked once at Mods-menu-open (#158's "boot or Mods-menu-open" - this
 * front end has no reachable boot hook, so menu-open is the one this build
 * offers) against this device's remembered sync folder, if any. Never
 * throws: a folder that fails to read, or nothing there yet, both read as
 * "nothing to offer" the same way `loadDelveSyncArrival` already does.
 *
 * "Apply now" only ever appears when `delveSyncCanAutoApply` says every
 * named, enabled mod is ALREADY installed here at the exact tag named - the
 * same reason the write side would have labelled the file informational had
 * it not been authoritative - so applying it is a LOCAL, no-network
 * enable/flags write, never a fetch or a version choice. It merges into the
 * current set rather than replacing it: a one-click action from a banner is
 * not the place to silently turn other mods off, which is why the full
 * Load-a-Delve wizard (the "Review..." branch, preloaded with the same
 * text - no new wizard) is the only path that ever offers Replace.
 *
 * Returns whether the caller should return immediately (a reload was
 * already requested), or whether the ordinary session's own `dirty` flag
 * should start true (the reviewed Delve changed something but the player
 * chose "Later" rather than reloading right away).
 */
export async function offerDelveSyncArrival(
  term: GridSurface & GridPointerInput,
  deps: ModManagerDeps,
): Promise<"reloaded" | "dirty" | "unchanged"> {
  if (!deps.delveSync) return "unchanged";
  const lastSeen = delveSyncLastSeenRevision();
  const arrival = await loadDelveSyncArrival(deps.delveSync, lastSeen);
  if (arrival.kind !== "newer") return "unchanged";
  const { file, meta } = arrival;

  const installedTags = new Map(
    (await installedMods(globalThis)).map((m) => [m.id, m.tag] as const),
  );
  const canApply = delveSyncCanAutoApply(file, meta, installedTags);

  const TITLE = t("modsScreen.delve.sync.title", "A newer mod profile was found");
  const body: ScreenLine[] = [
    {
      text: t(
        "modsScreen.delve.sync.body",
        "\"{name}\" from {origin} is newer than what this device last saw.",
        { name: file.name, origin: meta.originDevice },
      ),
      color: C_FG,
    },
  ];
  if (meta.enabledSetInformational) {
    body.push({ text: "", color: C_DIM });
    body.push({
      text: t(
        "modsScreen.delve.sync.informational",
        "That device's enabled set is managed by an external mod manager there, so this one is for review only.",
      ),
      color: C_DIM,
    });
  }
  await showTextScreen(term, TITLE, body);

  const items: MenuItem[] = [
    ...(canApply ? [{ label: t("modsScreen.delve.sync.apply", "Apply now"), color: C_ENABLED }] : []),
    { label: t("modsScreen.delve.sync.review", "Review..."), color: C_FG },
    { label: t("modsScreen.delve.sync.skip", "Skip for now"), color: C_DIM },
  ];
  const reviewIndex = canApply ? 1 : 0;
  const pick = await selectFromMenu(
    term,
    "core:delve-sync-arrival",
    TITLE,
    items,
    t("modsScreen.delve.common.footer.abcEsc", "[ a/b or tap, ESC to cancel ]"),
  );

  if (pick === 0 && canApply) {
    const catalogById = new Map(classicCatalog(deps).map((m) => [m.id, m] as const));
    for (const entry of file.mods) {
      if (!entry.enabled) continue;
      classicManager(deps).core.setEnabled(entry.id, true);
      const catalogMod = catalogById.get(entry.id);
      if (catalogMod) applyDelveFlags(catalogMod.manifest, entry.id, entry.flags, deps.store);
    }
    markDelveSyncSeen(meta.revision);
    deps.requestReload();
    return "reloaded";
  }
  if (pick === reviewIndex) {
    /* Re-encoded rather than handed the folder's raw text: `arrival.file` is
     * already the DECODED, validated object (`loadDelveSyncArrival` went
     * through `decodeDelve` once already), and `encodeDelve` is the exact
     * inverse - so `runLoadDelve`'s own `decodeDelve` call sees the identical
     * Delve, just without the sync envelope's two extra fields riding along. */
    const changed = await runLoadDelve(term, deps, encodeDelve(file));
    markDelveSyncSeen(meta.revision);
    return changed ? "dirty" : "unchanged";
  }
  /* "Skip for now", or ESC (null): dismissed without acting. Marked seen
   * either way - a banner that reappears every single menu-open for a
   * revision the player already declined is exactly the nagging this
   * design's "lightweight banner" wording rules out. */
  markDelveSyncSeen(meta.revision);
  return "unchanged";
}
