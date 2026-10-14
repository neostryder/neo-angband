import { classicBrowser } from "./classic-service";
import { CONSENT_DISCLAIMER } from "../mod-consent";
import { t } from "@rpgm-tools/neo-angband-core";
import { type WaitingZip, type ZipImportDeps } from "../mod-zip-source";
import { type ScreenLine, showTextScreen, type MenuItem, selectFromMenu } from "../overlay";
import { C_DIM, C_WARN, C_GOOD, C_FG, C_BAD } from "./browse-colors";
import { type GridSurface, type GridPointerInput } from "../term";
import { type ModBrowseDeps } from "./browse-types";
import { paintWhile } from "./classic-update-views";
import { zipImportFailureScreen } from "./browse-views";
import { askConsent } from "./classic-browse-install";
import { type SessionPreview, previewSessionArchive } from "../mod-session";
import { type ScreenView, type ScreenBlock, type ScreenRow, freezeView, SCREEN_FOOTER } from "../screen-view";
import { describeCapabilities } from "../capability-describe";
import { consentSessionMod } from "../mods";
import { type Finding } from "@rpgm-tools/neo-angband-mod-sdk";

/**
 * An exact byte count for a player-visible mod size.
 *
 * Measurements are exact, so the display keeps that count instead of reducing it to
 * an approximation a player cannot use for precise comparisons.
 */
export function formatBytes(bytes: number): string {
  return t("modBrowse.formatBytes", "{bytes, number} bytes", { bytes });
}

/* ------------------------------------------------------------------ *
 * The fourth door: a mod that arrived as a file.
 * ------------------------------------------------------------------ */

/** How one waiting archive reads on its row. */
export function waitingZipRow(z: WaitingZip): string {
  return `${z.name}  (${formatBytes(z.bytes)})`;
}

/**
 * What the screen says after an import, including the part about the file itself.
 *
 * A SEPARATE FUNCTION BECAUSE THE SENTENCE IS THE FEATURE. Three outcomes have to be
 * distinguishable: the archive was moved aside, the archive is still there because this
 * platform cannot move it, and the archive is still there because moving it FAILED.
 * Collapsing the last two into "installed" would leave a player with a duplicate they
 * do not know about; collapsing them into "could not be moved" would report a fault on a
 * browser that never had the ability in the first place.
 *
 * Nothing here says "deleted" any more, and nothing deletes: the successful case NAMES
 * the file's new home, because a player who wants their download back has to be able to
 * find it without being told to go hunting.
 */
export function importedLines(
  name: string,
  fileCount: number,
  source: string,
  archived: { readonly ok: boolean; readonly error?: string; readonly to?: string } | null,
  enabled: boolean,
): readonly ScreenLine[] {
  const tail: ScreenLine[] =
    archived === null
      ? [
          {
            text: t("modBrowse.imported.stillThere", "{source} is still where you left it.", { source }),
            color: C_DIM,
          },
          {
            text: t("modBrowse.imported.untouched", "The game has its own copy now; yours is untouched."),
            color: C_DIM,
          },
        ]
      : archived.ok
        ? [
            {
              text: t("modBrowse.imported.moved", "{source} has been moved to {to} in the mods folder.", {
                source,
                // "imported/" is the on-disk folder name the archiver writes to, not prose.
                to: archived.to ?? "imported/",
              }),
              color: C_DIM,
            },
            {
              text: t("modBrowse.imported.kept", "Kept, not deleted - it is your copy of the download."),
              color: C_DIM,
            },
          ]
        : [
            {
              text: t("modBrowse.imported.stillLoose", "{source} is still loose in the mods folder.", {
                source,
              }),
              color: C_WARN,
            },
            {
              text: t("modBrowse.imported.moveFailed", "It could not be moved aside: {error}", {
                error: archived.error ?? t("modBrowse.imported.noReasonGiven", "no reason given"),
              }),
              color: C_WARN,
            },
            {
              text: t(
                "modBrowse.imported.safeToMove",
                "The mod is installed. Moving the file yourself is safe.",
              ),
              color: C_DIM,
            },
          ];
  return [
    { text: t("modBrowse.imported.installed", "{name} installed.", { name }), color: C_GOOD },
    { text: "", color: C_FG },
    {
      text: t("modBrowse.imported.stored", "{count} file(s) stored, from {source}.", {
        count: fileCount,
        source,
      }),
      color: C_DIM,
    },
    ...tail,
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

/** Read, validate, store - then, only then, move the source aside. */
export async function importOne(
  term: GridSurface & GridPointerInput,
  bytes: Uint8Array,
  source: string,
  /** The leaf name to move afterwards, or null for a file the game does not own. */
  archivable: string | null,
  deps: ModBrowseDeps,
  zip: ZipImportDeps,
): Promise<boolean> {
  const result = await paintWhile(
    term,
    t("modBrowse.importing.title", "Importing"),
    t("modBrowse.importing.checking", "Checking {source}...", { source }),
    () => zip.install(bytes),
  );
  if (!result.ok) {
    await showTextScreen(term, zipImportFailureScreen(result.problem, result.unmet ?? []));
    return false;
  }

  /* STORE FIRST, MOVE SECOND, and never the other way round. The two cannot be made
   * one operation - IndexedDB and a filesystem have no shared transaction - so the
   * question is only which wreckage is survivable. Moving first and failing to store
   * hides the archive; storing first and failing to move leaves a file the player can
   * tidy up. Prefer the one that costs a tidy-up. */
  const archived =
    archivable !== null && zip.archive !== null ? await zip.archive(archivable) : null;

  const enabled = deps.offerEnable ? await deps.offerEnable(result.meta.id) : false;
  await showTextScreen(
    term,
    result.meta.name ?? source,
    importedLines(result.meta.name ?? source, result.meta.files.length, source, archived, enabled),
  );
  return true;
}

/**
 * "Import a mod from a file".
 *
 * Lists whatever is waiting in the game's own mods folder, and offers the file picker
 * underneath it. Both halves end in the same importOne, so an archive that came out of
 * the folder and one the player chose are validated, stored and reported identically -
 * the ONLY difference between them is whether the source file can be deleted, and that
 * difference is stated on the screen rather than hidden.
 */
export async function showZipImport(term: GridSurface & GridPointerInput, deps: ModBrowseDeps): Promise<boolean> {
  const zip = deps.importZip;
  if (!zip) return false;
  let changed = false;

  for (;;) {
    const waiting = await paintWhile(
      term,
      t("modBrowse.zipImport.title", "Import a mod"),
      t("modBrowse.zipImport.looking", "Looking in the mods folder..."),
      () => zip.waiting(),
    );
    const folder = zip.folder();

    const items: MenuItem[] = [
      ...waiting.map((z) => ({
        label: waitingZipRow(z),
        color: C_FG,
        hint:
          zip.archive === null
            ? t("modBrowse.zipImport.importThis", "Import this archive.")
            : t("modBrowse.zipImport.importThenMove", "Import it, then move the zip into mods/imported."),
      })),
      {
        label: t("modBrowse.zipImport.chooseFile", "Choose a .zip file..."),
        color: C_FG,
        hint: t("modBrowse.zipImport.chooseFileHint", "Any zip on your machine. Your copy of it is left alone."),
      },
      {
        label: t("modBrowse.zipImport.tryOnce", "Try a .zip for this session only..."),
        color: C_WARN,
        /* The hint says the true thing rather than the reassuring one. "Nothing is
         * installed" is what a player wants to hear here and is only half of it. */
        hint: t(
          "modBrowse.zipImport.tryOnceHint",
          "Not installed - loaded until you close the game. Code included, if it has any.",
        ),
      },
      {
        label: t("modBrowse.common.whatIsThis", "What is this?"),
        color: C_DIM,
        hint: t("modBrowse.zipImport.whatIsThisHint", "What a mod zip has to look like."),
      },
    ];

    const title =
      folder === null
        ? t("modBrowse.zipImport.title", "Import a mod")
        : t("modBrowse.zipImport.titleWithFolder", "Import a mod  -  {folder}", { folder });
    const pick = await classicBrowser(deps).core.drawConfirmation({ operation: "sideload", riskNotice: CONSENT_DISCLAIMER }, () => selectFromMenu(
      term,
      "core:mod-import",
      title,
      items,
      t("modBrowse.common.footer.escBack", "[ ESC to go back ]"),
    ));
    if (pick === null) return changed;

    if (pick === items.length - 1) {
      await showTextScreen(
        term,
        t("modBrowse.zipImport.title", "Import a mod"),
        aboutImport(folder, zip.archive !== null),
      );
      continue;
    }

    /* The consent check is repeated at the INSTALL (mod-install.ts); this one exists so
     * the player is offered the disclaimer instead of being refused after choosing a
     * file. An imported mod is third-party by definition - there is no curated zip. */
    if (!deps.consent.read()) {
      if (!(await askConsent(term, deps))) continue;
    }

    if (pick === items.length - 2) {
      const chosen = await zip.pick();
      if (chosen === null) continue;
      if (await tryOne(term, chosen.bytes, chosen.name, deps, zip)) changed = true;
      continue;
    }

    if (pick === items.length - 3) {
      const chosen = await zip.pick();
      if (chosen === null) continue;
      if (await importOne(term, chosen.bytes, chosen.name, null, deps, zip)) changed = true;
      continue;
    }

    const which = waiting[pick];
    if (!which) continue;
    const bytes = await paintWhile(
      term,
      t("modBrowse.zipImport.title", "Import a mod"),
      t("modBrowse.zipImport.readingFile", "Reading {name}...", { name: which.name }),
      () => zip.read(which.name),
    );
    if (bytes === null) {
      await showTextScreen(term, which.name, [
        {
          text: t("modBrowse.zipImport.couldNotRead", "{name} could not be read.", { name: which.name }),
          color: C_BAD,
        },
        { text: "", color: C_FG },
        {
          text: t(
            "modBrowse.zipImport.mayHaveMoved",
            "It may have been moved or deleted since this list was made.",
          ),
          color: C_DIM,
        },
      ]);
      continue;
    }
    if (await importOne(term, bytes, which.name, which.name, deps, zip)) changed = true;
  }
}

/** What the session screens call an archive: its manifest name, or else the file it came from. */
export function previewName(preview: { readonly name: string | null }, source: string): string {
  return preview.name ?? source;
}

/**
 * The screen that asks before a mod is run for one session.
 *
 * EVERY SENTENCE HERE IS DELIBERATE, because this is the one place a player is
 * asked to run somebody's code on a lower-friction gesture than a permanent
 * install, and the phrase "just for this session" does most of its damage by
 * sounding like a safety feature. Four things it therefore has to say:
 *
 *   - WHAT IS SHORT-LIVED IS THE MOD, NOT WHAT IT DOES. The archive is forgotten.
 *     A save it rewrote stays rewritten, a setting it changed stays changed, a
 *     request it sent has been sent. Stated first, because it is the thing the
 *     framing hides.
 *   - THE CAPABILITY LIST IS NOT THE LIMIT. It is shown in full, in the same
 *     words and the same order the install prompt uses - not shortened on the
 *     grounds that this is only a test, since shortening it is precisely how a
 *     temporary framing launders a consent. Above it, in plain terms, the reach
 *     that the list does not bound: a mod's code runs inside the game, so it can
 *     read and change anything the game can.
 *   - WHICH BYTES. The id, the version, the size and the digest, so a player who
 *     stages a draft twice can tell the two apart, and so "I tested this one" has
 *     a referent.
 *   - WHERE IT WILL BE AFTERWARDS. A browser that will not hold the archive across
 *     the reload cannot run this loop at all, and saying so beats sending somebody
 *     round it.
 *
 * A CONTENT-ONLY archive gets the same screen with the code paragraph absent. It
 * is not a different question with a softer answer; it is the same question with
 * one fewer thing to say.
 */
export function sessionLoadScreen(
  preview: Extract<SessionPreview, { ok: true }>,
  source: string,
  survivesReload: boolean,
): ScreenView {
  const caps = describeCapabilities(preview.capabilities ?? []);
  const runs = preview.code.length > 0;
  const blocks: ScreenBlock[] = [
    {
      kind: "lines",
      lines: [
        {
          text:
            preview.version === null
              ? t("modBrowse.sessionLoad.header", "{name}, from {source}", { name: previewName(preview, source), source })
              : t("modBrowse.sessionLoad.headerVersioned", "{name} {version}, from {source}", {
                  name: previewName(preview, source),
                  version: preview.version,
                  source,
                }),
          color: C_FG,
        },
        {
          text:
            preview.digest === ""
              ? formatBytes(preview.bytes)
              : t("modBrowse.sessionLoad.sizeDigest", "{size}  -  {digest}", {
                  size: formatBytes(preview.bytes),
                  digest: preview.digest.slice(0, 16),
                }),
          color: C_DIM,
        },
        { text: "", color: C_FG },
        {
          text: t(
            "modBrowse.sessionLoad.thisSession",
            "This loads it for THIS SESSION. It is not added to your mods.",
          ),
          color: C_FG,
        },
        {
          text: t(
            "modBrowse.sessionLoad.reloadsToPickUp",
            "The game reloads to pick it up, and forgets it when you close the game.",
          ),
          color: C_DIM,
        },
        { text: "", color: C_FG },
        {
          text: t("modBrowse.sessionLoad.whatIsTemporary", "What is temporary is the MOD. What it does is not."),
          color: C_WARN,
        },
        {
          text: t(
            "modBrowse.sessionLoad.characterChanged",
            "A character it changed stays changed. Settings it wrote stay written.",
          ),
          color: C_DIM,
        },
        {
          text: t("modBrowse.sessionLoad.networkSent", "Anything it sent over the network has been sent."),
          color: C_DIM,
        },
      ],
    },
  ];

  if (runs) {
    blocks.push({
      kind: "lines",
      lines: [
        { text: "", color: C_FG },
        { text: t("modBrowse.sessionLoad.runsCode", "THIS MOD RUNS CODE:"), color: C_BAD },
        ...preview.code.map((path) => ({ text: `  ${path}`, color: C_WARN })),
        { text: "", color: C_FG },
        {
          text: t(
            "modBrowse.sessionLoad.codeRunsInside",
            "Code in a mod runs inside the game, with everything the game has.",
          ),
          color: C_FG,
        },
        {
          text: t(
            "modBrowse.sessionLoad.canReadRewrite",
            "It can read and rewrite your characters and talk to the network,",
          ),
          color: C_FG,
        },
        {
          text: t(
            "modBrowse.sessionLoad.listDeclared",
            "whatever the list below says - that list is what the mod DECLARED.",
          ),
          color: C_FG,
        },
        {
          text: t(
            "modBrowse.sessionLoad.loadTrusted1",
            "Load code you wrote, or code from somebody you would trust with the",
          ),
          color: C_DIM,
        },
        {
          text: t("modBrowse.sessionLoad.loadTrusted2", "same file if it were permanent. This is the same decision."),
          color: C_DIM,
        },
      ],
    });
  }

  if (preview.capabilities === null) {
    blocks.push({
      kind: "lines",
      lines: [
        { text: "", color: C_FG },
        {
          text: t("modBrowse.sessionLoad.manifestUnreadable", "Its manifest.json could not be read as JSON."),
          color: C_BAD,
        },
        {
          text: t(
            "modBrowse.sessionLoad.manifestRefused",
            "So there is no list of what it asks for. It will be refused.",
          ),
          color: C_DIM,
        },
      ],
    });
  } else if (caps.length > 0) {
    blocks.push({
      kind: "lines",
      lines: [
        { text: "", color: C_FG },
        { text: t("modBrowse.sessionLoad.asksFor", "It asks for:"), color: C_FG },
      ],
    });
    /* THE SAME TABLE THE INSTALL CONSENT SCREEN DRAWS (mods.ts's
     * capabilityConsentScreen), column for column. A long blurb wraps in the
     * room left by the elevated flag, just as it does before installation. */
    blocks.push({
      kind: "table",
      key: "capabilities",
      tagged: false,
      columns: [
        { key: "bullet", width: 3, align: "right" },
        { key: "text", wrap: true },
        { key: "elevated", gap: 3, pad: false },
      ],
      rows: caps.map((d): ScreenRow => ({
        id: d.cap,
        semantic: { kind: "capability", ref: d.cap, data: { elevated: d.elevated } },
        color: d.elevated ? C_WARN : C_FG,
        cells: {
          bullet: { text: "-" },
          text: { text: d.text },
          elevated: { text: d.elevated ? t("modBrowse.sessionLoad.elevatedTag", "[elevated]") : "" },
        },
      })),
    });
  } else if (runs) {
    blocks.push({
      kind: "lines",
      lines: [
        { text: "", color: C_FG },
        {
          text: t("modBrowse.sessionLoad.noCapabilitiesNamed", "It asks for no capabilities by name."),
          color: C_DIM,
        },
        {
          text: t(
            "modBrowse.sessionLoad.boundsNothing",
            "That bounds nothing: the code is in the game either way.",
          ),
          color: C_DIM,
        },
      ],
    });
  }

  blocks.push({
    kind: "lines",
    lines: [
      { text: "", color: C_FG },
      ...(survivesReload
        ? [
            {
              text: t(
                "modBrowse.sessionLoad.survives",
                "It will still be here after the reload, and gone the time after.",
              ),
              color: C_DIM,
            },
          ]
        : [
            {
              text: t(
                "modBrowse.sessionLoad.doesNotSurvive",
                "This browser will not hold it across a reload, so it cannot load.",
              ),
              color: C_BAD,
            },
            {
              text: t(
                "modBrowse.sessionLoad.installInstead",
                "Install it instead, or save the file and import it.",
              ),
              color: C_FG,
            },
          ]),
    ],
  });

  return freezeView({
    id: "core:mod-session-load",
    title: runs
      ? t("modBrowse.sessionLoad.titleRuns", "Run this mod for one session?")
      : t("modBrowse.sessionLoad.titleLoads", "Load this mod for one session?"),
    footer: SCREEN_FOOTER,
    blocks,
  });
}

/** What the screen says once an archive is staged. */
export function sessionLoadedLines(
  name: string,
  source: string,
  runs: boolean,
): readonly ScreenLine[] {
  return [
    { text: t("modBrowse.sessionLoaded.loaded", "{name} is loaded for this session.", { name }), color: C_GOOD },
    { text: "", color: C_FG },
    {
      text: t("modBrowse.sessionLoaded.from", "From {source}. Nothing has been added to your mods.", {
        source,
      }),
      color: C_DIM,
    },
    { text: "", color: C_FG },
    {
      text: t(
        "modBrowse.sessionLoaded.reload",
        "Reload to start using it - you are offered that on the way out.",
      ),
      color: C_FG,
    },
    {
      text: t(
        "modBrowse.sessionLoaded.listedInList",
        "It is listed in the mod list, marked for this session, and can be dropped there.",
      ),
      color: C_DIM,
    },
    { text: "", color: C_FG },
    ...(runs
      ? [
          {
            text: t("modBrowse.sessionLoaded.codeRuns", "Its code will run every reload until you close the game."),
            color: C_WARN,
          },
          {
            text: t("modBrowse.sessionLoaded.dropToStop", "Dropping it and reloading is how you stop it."),
            color: C_DIM,
          },
        ]
      : [
          {
            text: t(
              "modBrowse.sessionLoaded.doNotCare",
              "Do not play a character you care about on session-only content:",
            ),
            color: C_WARN,
          },
          {
            text: t(
              "modBrowse.sessionLoaded.goesWithIt",
              "next time the pack is gone, and what it added goes with it.",
            ),
            color: C_DIM,
          },
        ]),
  ];
}

/** Look at an archive, ask, and stage it. True when something was staged. */
export async function tryOne(
  term: GridSurface & GridPointerInput,
  bytes: Uint8Array,
  source: string,
  deps: ModBrowseDeps,
  zip: ZipImportDeps,
): Promise<boolean> {
  const preview = await paintWhile(
    term,
    t("modBrowse.tryOne.title", "For this session"),
    t("modBrowse.tryOne.reading", "Reading {source}...", { source }),
    () => previewSessionArchive(bytes),
  );
  if (!preview.ok) {
    await showTextScreen(term, zipImportFailureScreen(preview.problem));
    return false;
  }

  const survives = zip.sessionSurvivesReload();
  await showTextScreen(term, sessionLoadScreen(preview, source, survives));
  /* ASKED AFTER THE SCREEN, NOT ON IT. The read-through comes first and the choice
   * second, which is the shape the install consent prompt uses - a player who
   * pressed a key to get past a wall of text has not answered a question. */
  const pick = await selectFromMenu(
    term,
    "core:mod-session-consent",
    preview.code.length > 0
      ? t("modBrowse.tryOne.runConfirm", "Run {name} for this session?", { name: previewName(preview, source) })
      : t("modBrowse.tryOne.loadConfirm", "Load {name} for this session?", { name: previewName(preview, source) }),
    [
      {
        label: survives
          ? t("modBrowse.tryOne.yesLoad", "Yes, load it for this session")
          : t("modBrowse.tryOne.cannotHold", "Cannot: this browser will not hold it"),
        color: survives ? C_WARN : C_DIM,
        hint: survives
          ? t("modBrowse.tryOne.yesLoadHint", "Applies on the next reload. Gone when you close the game.")
          : t("modBrowse.tryOne.cannotHoldHint", "Storage is off in this window, so a reload would lose it."),
      },
      {
        label: t("modBrowse.tryOne.no", "No, leave it alone"),
        color: C_FG,
        hint: t("modBrowse.tryOne.noHint", "Nothing is loaded or changed."),
      },
    ],
    t("modBrowse.common.footer.escBack", "[ ESC to go back ]"),
  );
  if (pick !== 0 || !survives) return false;

  let decisions = { granted: [] as readonly string[], refused: [] as readonly string[] };
  if (preview.code.length > 0) {
    if (!preview.manifest) return false;
    const consent = await consentSessionMod(term, preview.manifest);
    if (!consent) return false;
    decisions = consent;
  }

  const staged = await paintWhile(
    term,
    t("modBrowse.tryOne.title", "For this session"),
    t("modBrowse.tryOne.checking", "Checking {source}...", { source }),
    () =>
      zip.loadForSession(bytes, source, decisions.granted, preview.digest, decisions.refused, preview.code.length > 0),
  );
  if (!staged.ok) {
    await showTextScreen(
      term,
      zipImportFailureScreen(staged.problem, (staged.unmet ?? []) as readonly Finding[]),
    );
    return false;
  }
  await showTextScreen(
    term,
    previewName(preview, source),
    sessionLoadedLines(previewName(preview, source), source, staged.code),
  );
  void deps;
  return true;
}

/** What the "What is this?" row says, which depends on what this platform can do. */
export function aboutImport(folder: string | null, canArchive: boolean): readonly ScreenLine[] {
  const dim = (text: string): ScreenLine => ({ text, color: C_DIM });
  const fg = (text: string): ScreenLine => ({ text, color: C_FG });
  return [
    fg(t("modBrowse.aboutImport.body1", "A mod can be installed from a .zip file instead of from a repository.")),
    dim(t("modBrowse.aboutImport.body2", "This is the same install: the same requirements are checked, and the")),
    dim(t("modBrowse.aboutImport.body3", "mod is stored the same way. Only where the bytes came from differs.")),
    { text: "", color: C_FG },
    fg(t("modBrowse.aboutImport.body4", "The zip has to hold ONE mod, and its manifest.json has to be either:")),
    dim(t("modBrowse.aboutImport.body5", "  at the top of the zip, or")),
    dim(t("modBrowse.aboutImport.body6", "  inside a single folder at the top of the zip.")),
    dim(t("modBrowse.aboutImport.body7", 'That second shape is what GitHub\'s "Download ZIP" gives you.')),
    { text: "", color: C_FG },
    fg(t("modBrowse.aboutImport.body8", "Nothing deeper is looked at. A zip holding two mods is refused, and")),
    fg(t("modBrowse.aboutImport.body9", "says which two, rather than guessing which one you meant.")),
    { text: "", color: C_FG },
    ...(folder === null
      ? [dim(t("modBrowse.aboutImport.noFolder", "This front end has no mods folder, so only the file picker is offered."))]
      : [
          fg(t("modBrowse.aboutImport.folder1", "You can also drop a zip into the mods folder and import it here:")),
          dim(`  ${folder}`),
          ...(canArchive
            ? [
                dim(t("modBrowse.aboutImport.folder2", "A zip imported from there is moved into imported/ once the mod is")),
                dim(t("modBrowse.aboutImport.folder3", "installed - kept, not deleted, so your download is still yours.")),
              ]
            : []),
        ]),
    { text: "", color: C_FG },
    fg(t("modBrowse.aboutImport.body10", "A zip is never checked at startup and never unpacked on its own.")),
    dim(t("modBrowse.aboutImport.body11", "Importing is something you do, once, from this screen.")),
    { text: "", color: C_FG },
    fg(t("modBrowse.aboutImport.body12", "An imported mod keeps the repository its own manifest declares, so the")),
    fg(t("modBrowse.aboutImport.body13", "update check has somewhere to ask. You can also import a newer zip.")),
  ];
}
