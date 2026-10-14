import { classicBrowser, confirmationMod } from "./classic-service";
import { type RecordTouch, type PreInstallSummary, buildPreInstallSummary } from "../mod-preinstall";
import { type ScreenBlock, type ScreenRow, type ScreenView, freezeView, SCREEN_FOOTER, screenBodyLines } from "../screen-view";
import { C_FG, C_WARN, C_DIM, C_BAD } from "./browse-colors";
import { t } from "@rpgm-tools/neo-angband-core";
import { type DiscoveredMod } from "../mod-discover";
import { displayName } from "../mod-authors";
import { formatBytes } from "./classic-browse-archive";
import { describeDeclaredConflict, type PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import { type ScreenLine, screenRegionSpec, showTextScreen, type MenuItem, selectFromMenu } from "../overlay";
import { type GridSurface, type GridPointerInput } from "../term";
import { type RepoRef } from "../mod-source";
import { type ModBrowseDeps } from "./browse-types";
import { pushRegion, regionSurface, popRegion } from "../ui-stack";
import { browseDetail } from "./browse-views";
import { nameFromManifests } from "../mod-conflicts";
import { installOne } from "./classic-browse-install";

/* ------------------------------------------------------------------ *
 * The paste-a-URL pre-install summary (door 3, docs/modding/MOD_LIFECYCLE.md).
 * ------------------------------------------------------------------ */

/** One block of RecordTouch rows, or nothing when there is nothing to say. */
export function touchBlocks(label: string, touches: readonly RecordTouch[]): ScreenBlock[] {
  if (touches.length === 0) return [];
  return [
    { kind: "lines", lines: [{ text: "", color: C_FG }, { text: label, color: C_FG }] },
    {
      kind: "table",
      key: label,
      tagged: false,
      columns: [
        { key: "bullet", width: 3, align: "right" },
        { key: "ref", wrap: true },
        { key: "flag", gap: 3, pad: false },
      ],
      rows: touches.map(
        (touch): ScreenRow => ({
          id: `${touch.file}:${touch.ref}`,
          color: touch.ownerEnabled ? C_FG : C_WARN,
          cells: {
            bullet: { text: "-" },
            ref: { text: t("modBrowse.preinstall.touchRow", "{ref}  (in {file})", { ref: touch.ref, file: touch.file }) },
            flag: {
              text: touch.ownerEnabled
                ? ""
                : t("modBrowse.preinstall.ownerNotEnabled", "[{owner} is not enabled]", { owner: touch.owner }),
            },
          },
        }),
      ),
    },
  ];
}

/**
 * The pre-install summary screen: what installing `mod` would actually do,
 * beyond what a browse row already says (name, version, size, engine).
 *
 * `nameOf` resolves an id to a display name for the conflict sentences
 * (nameFromManifests, mod-conflicts.ts) - built from the player's enabled
 * manifests plus this candidate, so either side of a claim can be named.
 */
export function preInstallSummaryScreen(
  mod: DiscoveredMod,
  summary: PreInstallSummary,
  nameOf: (id: string) => string,
): ScreenView {
  const who = displayName(mod.name, mod.author);
  const blocks: ScreenBlock[] = [
    {
      kind: "lines",
      lines: [
        {
          text: mod.description?.split("\n")[0] ?? t("modBrowse.detail.noDescription", "No description."),
          color: C_FG,
        },
        { text: "", color: C_FG },
        {
          text: t("modBrowse.preinstall.license", "License    {license}", {
            license: summary.license ?? t("modBrowse.preinstall.licenseNotStated", "not stated"),
          }),
          color: C_DIM,
        },
        ...(mod.bytes === null
          ? []
          : [
              {
                text: t("modBrowse.detail.download", "Download   {bytes} in {count} file(s)", {
                  bytes: formatBytes(mod.bytes),
                  count: mod.payload.length,
                }),
                color: C_DIM,
              },
            ]),
      ],
    },
  ];

  const addCount = summary.content.adds.reduce((n, a) => n + a.count, 0);
  if (addCount > 0) {
    blocks.push({
      kind: "lines",
      lines: [
        { text: "", color: C_FG },
        {
          text: t(
            "modBrowse.preinstall.adds",
            "Adds {count} new record(s), across {files} file(s):",
            { count: addCount, files: summary.content.adds.length },
          ),
          color: C_FG,
        },
        ...summary.content.adds.map((a) => ({
          text: t("modBrowse.preinstall.addsRow", "  {file}  ({count})", { file: a.file, count: a.count }),
          color: C_DIM,
        })),
      ],
    });
  }

  blocks.push(
    ...touchBlocks(t("modBrowse.preinstall.patches", "Patches these records:"), summary.content.patches),
    ...touchBlocks(
      t("modBrowse.preinstall.replaces", "Replaces these records outright:"),
      summary.content.replaces,
    ),
    ...touchBlocks(t("modBrowse.preinstall.removes", "Removes these records:"), summary.content.removes),
  );

  if (summary.content.unreadable.length > 0) {
    blocks.push({
      kind: "lines",
      lines: [
        { text: "", color: C_FG },
        {
          text: t(
            "modBrowse.preinstall.unreadable",
            "{count} content file(s) could not be checked:",
            { count: summary.content.unreadable.length },
          ),
          color: C_WARN,
        },
        ...summary.content.unreadable.map((u) => ({
          text: t("modBrowse.preinstall.unreadableRow", "  {file}: {problem}", u),
          color: C_DIM,
        })),
      ],
    });
  }

  if (summary.capabilities.length > 0) {
    blocks.push({
      kind: "lines",
      lines: [
        { text: "", color: C_FG },
        { text: t("modBrowse.preinstall.capabilities", "Capabilities requested:"), color: C_FG },
      ],
    });
    /* THE SAME TABLE sessionLoadScreen's own capability list draws, column for
     * column - the wording is capability-describe.ts's, shared with it and with
     * the enable-time consent screen (mods.ts's capabilityConsentScreen); this
     * is a third use of the same layout, not a second copy of the words. */
    blocks.push({
      kind: "table",
      key: "capabilities",
      tagged: false,
      columns: [
        { key: "bullet", width: 3, align: "right" },
        { key: "text", wrap: true },
        { key: "elevated", gap: 3, pad: false },
      ],
      rows: summary.capabilities.map(
        (d): ScreenRow => ({
          id: d.cap,
          semantic: { kind: "capability", ref: d.cap, data: { elevated: d.elevated } },
          color: d.elevated ? C_WARN : C_FG,
          cells: {
            bullet: { text: "-" },
            text: { text: d.text },
            elevated: { text: d.elevated ? t("modBrowse.sessionLoad.elevatedTag", "[elevated]") : "" },
          },
        }),
      ),
    });
  }

  if (summary.conflicts.length > 0) {
    blocks.push({
      kind: "lines",
      lines: [
        { text: "", color: C_FG },
        {
          text: t("modBrowse.preinstall.conflicts", "Conflicts declared against your enabled mods:"),
          color: C_WARN,
        },
        ...summary.conflicts.map((c) => ({
          text: `  ${describeDeclaredConflict(c, nameOf)}`,
          color: C_WARN,
        })),
      ],
    });
  }

  return freezeView({
    id: "core:mod-preinstall-summary",
    title: t("modBrowse.preinstall.title", "{who} {version} - review before installing", {
      who,
      version: mod.version,
    }),
    footer: SCREEN_FOOTER,
    blocks,
  });
}

/**
 * `preInstallSummaryScreen`'s body, flattened to `ScreenLine[]` for tests - the
 * same relationship `installFailureLines` has to `installFailureScreen`.
 */
export function preInstallSummaryLines(
  mod: DiscoveredMod,
  summary: PreInstallSummary,
  nameOf: (id: string) => string,
  width = 80,
): ScreenLine[] {
  return screenBodyLines(preInstallSummaryScreen(mod, summary, nameOf), width);
}

/**
 * The repository door's install: discover the one pasted repository, show the
 * pre-install summary, then let the player confirm or cancel before anything
 * is stored.
 *
 * NOT `showSource`, deliberately. `showSource` is shared by all three list-
 * shaped doors (recommended, registry, and this one used to be a fourth
 * caller of it) and none of its other callers need a content-touch fetch few
 * mods have more than a handful of files, but a curated list can be dozens of
 * repositories deep and must not pay for a scan nobody asked to see yet. This
 * function is reached only once discovery has already narrowed the world to
 * the ONE repository a player just pasted, which is exactly when the design
 * (MOD_LIFECYCLE.md) says the summary belongs.
 *
 * Returns true when anything was installed, same contract as `showSource`.
 */
export async function showRepoInstallSummary(
  term: GridSurface & GridPointerInput,
  ref: RepoRef,
  deps: ModBrowseDeps,
): Promise<boolean> {
  const authors = await deps.authors();

  const handle = pushRegion(screenRegionSpec(), term.size());
  const waiting = regionSurface(term, handle.cells);
  waiting.clear();
  waiting.print(0, 1, ref.repo, C_FG);
  waiting.print(0, 3, t("modBrowse.source.askingOne", "Asking the repository what it holds..."), C_DIM);
  waiting.flush?.();
  const entry = await deps.discover(ref).finally(() => {
    popRegion(handle);
  });

  if (!entry.ok) {
    await showTextScreen(term, ref.repo, browseDetail(entry, null, authors));
    return false;
  }
  if (!entry.mod.compatible) {
    const checked = entry.mod.versionsChecked ?? 1;
    await showTextScreen(term, entry.mod.name, [
      {
        text: t("modBrowse.incompatible.wontRun", "{name} will not run on this version of the game.", {
          name: entry.mod.name,
        }),
        color: C_BAD,
      },
      { text: "", color: C_FG },
      {
        text:
          entry.mod.engineNote ??
          t("modBrowse.incompatible.needsEngine", "It needs engine {engine}.", {
            engine: entry.mod.engine ?? "?",
          }),
        color: C_WARN,
      },
      { text: "", color: C_FG },
      {
        text:
          checked > 1
            ? t(
                "modBrowse.incompatible.checkedNone",
                "The last {count} versions of it were checked, and none of them runs here.",
                { count: checked },
              )
            : t("modBrowse.incompatible.noOlder", "No older version of it was available to try."),
        color: C_DIM,
      },
      { text: "", color: C_FG },
      {
        text: t("modBrowse.incompatible.updateGame", "Updating the game may be all it needs."),
        color: C_DIM,
      },
    ]);
    return false;
  }

  const installed = await deps.installed();
  const at = installed.get(entry.mod.id) ?? null;

  const enabledManifests = deps.enabledManifests();
  const summary = await buildPreInstallSummary(entry.mod, enabledManifests, deps.readRepoFile);
  const nameOf = nameFromManifests([
    ...enabledManifests,
    { id: entry.mod.id, name: entry.mod.name } as PackManifest,
  ]);

  await showTextScreen(term, preInstallSummaryScreen(entry.mod, summary, nameOf));

  /* The SAME action set showSource offers for a single row, so choosing to
   * install here is not a different decision from choosing it there. */
  const actions: MenuItem[] =
    at === null
      ? [
          {
            label: t("modBrowse.actions.installEnable", "Install and enable {version}", {
              version: entry.mod.version,
            }),
            color: C_FG,
            hint: t(
              "modBrowse.actions.installEnableHint",
              "Download, check, and turn it on for the next reload. Permissions are still asked separately.",
            ),
          },
          {
            label: t("modBrowse.actions.installOnly", "Install only {version}", { version: entry.mod.version }),
            color: C_DIM,
            hint: t("modBrowse.actions.installOnlyHint", "Download and check it, but leave it off."),
          },
        ]
      : at === entry.mod.tag
        ? [
            {
              label: t("modBrowse.actions.reinstall", "Reinstall"),
              color: C_FG,
              hint: t("modBrowse.actions.reinstallHint", "Download it again."),
            },
            {
              label: t("modBrowse.actions.remove", "Remove"),
              color: C_BAD,
              hint: t("modBrowse.actions.removeHint", "Delete its files."),
            },
          ]
        : [
            {
              label: t("modBrowse.actions.changeTo", "Change to {version}", { version: entry.mod.version }),
              color: C_WARN,
              hint: t("modBrowse.actions.youHave", "You have {tag}.", { tag: at }),
            },
            {
              label: t("modBrowse.actions.remove", "Remove"),
              color: C_BAD,
              hint: t("modBrowse.actions.removeHint", "Delete its files."),
            },
          ];

  const pick = await classicBrowser(deps).core.drawConfirmation({ operation: at === null ? "install" : "update", mods: [confirmationMod(entry.mod)] }, () => selectFromMenu(
    term,
    "core:mod-preinstall-actions",
    entry.mod.name,
    actions,
    t("modBrowse.preinstall.footer", "[ ESC to cancel - nothing is installed ]"),
  ));
  if (pick === null) return false;

  if (at !== null && pick === 1) {
    const gone = await classicBrowser(deps).core.removeConfirmed(entry.mod.id);
    await showTextScreen(term, entry.mod.name, [
      gone
        ? { text: t("modBrowse.actions.removed", "{name} removed.", { name: entry.mod.name }), color: C_FG }
        : {
            text: t("modBrowse.actions.removeFailed", "{name} could not be removed.", { name: entry.mod.name }),
            color: C_BAD,
          },
      { text: "", color: C_FG },
      { text: t("modBrowse.actions.reloadToStop", "Reload to stop loading it."), color: C_FG },
    ]);
    return gone;
  }

  return await installOne(term, entry, "third-party", deps, {
    offerEnable: at === null && pick === 0,
  });
}
