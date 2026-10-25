import { safeLaunch } from "../safe-launch";
import { t } from "@rpgm-tools/neo-angband-core";
import { C_FG, C_WARN, C_GOLD_TEXT, C_DANGER, C_ENABLED, C_DISABLED, C_TITLE, C_DIM } from "./classic-colors";
import { type ScreenLine, type MenuItem } from "../overlay";
import { type CatalogMod } from "../mod-store";
import { displayName } from "../mod-authors";
import { wrapCssRuns } from "../shop";
import { modDisplayName } from "../mod-problems";
import { describeCapabilities } from "../capability-describe";
import { undecidedCapabilities } from "./classic-permissions";

/**
 * The mods-folder row: label and colour for the three states it can be in.
 *
 * Exported and pure because the states are easy to get wrong in the direction that
 * hides a problem - a remembered folder the browser will not read must look
 * DIFFERENT from one it is reading, or the player sees a folder named on screen,
 * no mods from it, and no explanation.
 */
export function modFolderRow(
  savedName: string | null,
  attached: boolean,
): { label: string; color: string; lapsed: boolean } {
  if (savedName === null) {
    return {
      label: t("modsScreen.folder.choose", "Choose a mods folder..."),
      color: C_FG,
      lapsed: false,
    };
  }
  if (attached) {
    return {
      label: t("modsScreen.folder.row.attached", "Mods folder: {name}", { name: savedName }),
      color: C_FG,
      lapsed: false,
    };
  }
  return {
    label: t("modsScreen.folder.row.lapsed", "Mods folder: {name} - NEEDS RECONNECTING", {
      name: savedName,
    }),
    color: C_WARN,
    lapsed: true,
  };
}

/**
 * The "where these mods came from" line on the mods-folder screen.
 *
 * WHY THE BUNDLED CLAUSE IS DROPPED AT ZERO, rather than printed as "0". The game
 * bundles no mods at all now - FIRST_PARTY_MOD_IDS is empty, and a release build inlines
 * nothing - so "0 bundled with the game" would be a permanent fixture of this screen: a
 * number that can only ever be zero, sitting exactly where a player looks to find out
 * where their mods are. The clause exists to stop the other count reading as the whole
 * answer, and with nothing bundled there is nothing left for it to disambiguate.
 *
 * The other count is always printed, zero included. "0 from this folder" is the sentence
 * that tells a player the FOLDER is the empty part rather than the game.
 */
export function modSourceLine(bundledCount: number, count: number, theirs: string): string {
  const own = t("modsScreen.folder.source.own", "{count} {theirs}.", { count, theirs });
  if (bundledCount === 0) return own[0]!.toUpperCase() + own.slice(1);
  return t("modsScreen.folder.source.bundled", "{bundled} bundled with the game, {own}", {
    bundled: bundledCount,
    own,
  });
}

/**
 * What a browser with no directory picker is told.
 *
 * THIS TEXT WAS WRONG, in the way a screen can be wrong for a long time. It said "every
 * mod here is one bundled into the app - fully manageable, but a fixed set", and both
 * halves have since stopped being true: the game bundles no mods at all, and installing
 * one needs nothing this browser lacks - a network request and its own storage. So the
 * sentence told a Firefox or Safari player that their mod list was fixed, on a screen
 * they opened to find out how to change it. Telling someone not to look for the thing
 * that works is worse than saying nothing.
 *
 * Exported and pure so the words are testable. It is the words that are the behaviour
 * here, and the previous version was a template nothing asserted anything about.
 */
export function noFolderPickerLines(): ScreenLine[] {
  return [
    {
      text: t("modsScreen.noPicker.title", "This browser cannot be given a mods FOLDER."),
      color: C_FG,
    },
    { text: "", color: C_FG },
    {
      text: t(
        "modsScreen.noPicker.body1",
        "It has no way to hand a directory to a web page, so that one",
      ),
      color: C_FG,
    },
    {
      text: t(
        "modsScreen.noPicker.body2",
        "route is closed here. Downloading is not: Recommended mods... needs",
      ),
      color: C_FG,
    },
    {
      text: t(
        "modsScreen.noPicker.body3",
        "only a network request and this browser's own storage, and every",
      ),
      color: C_FG,
    },
    {
      text: t(
        "modsScreen.noPicker.body4",
        "mod on offer arrives that way - checked against a digest that",
      ),
      color: C_FG,
    },
    {
      text: t(
        "modsScreen.noPicker.body5",
        "ships inside the game, so a tampered download never runs.",
      ),
      color: C_FG,
    },
    { text: "", color: C_FG },
    {
      text: t(
        "modsScreen.noPicker.reassure",
        "Nothing is missing from your mod list because of your browser.",
      ),
      color: C_GOLD_TEXT,
    },
    { text: "", color: C_FG },
    {
      text: t(
        "modsScreen.noPicker.alt1",
        "Chrome and Edge can ALSO be given a folder, which is useful for",
      ),
      color: C_WARN,
    },
    {
      text: t(
        "modsScreen.noPicker.alt2",
        "a mod you are writing; the desktop build keeps its own, which an",
      ),
      color: C_WARN,
    },
    {
      text: t("modsScreen.noPicker.alt3", "external mod manager can deploy into."),
      color: C_WARN,
    },
  ];
}

/**
 * The one-line badge for a catalog row: enabled state, any warning, and whether
 * this mod is BROKEN.
 *
 * "NOT WORKING" outranks every other flag and takes the row's colour, because it is
 * the only one that answers the question a player opens this screen with. A row that
 * said `[x] Quality of Life v0.10.0 (plugin)` in the enabled colour was the whole
 * problem: the mod was on, consented, listed, and contributing nothing, and the
 * screen agreed with it.
 *
 * `problems` is the mod's OWN problems, already filtered by caller - pure so the
 * wording is assertable.
 */
export function rowLabel(m: CatalogMod, problems: readonly string[] = []): MenuItem {
  /* A mod that is switched on and is not there. No version, no kind, no flags -
   * none of them mean anything without a manifest, and printing "v-  (content)"
   * beside a mod that does not exist reads as a mod that does. */
  if (m.missing) {
    return {
      label: t("modsScreen.row.notInstalled.label", "[x] {name}  - NOT INSTALLED", {
        name: m.name,
      }),
      color: C_DANGER,
      hint: t(
        "modsScreen.row.notInstalled.hint",
        "Switched on, but the mod itself is gone. Enter to remove it.",
      ),
    };
  }
  const box = m.enabled ? "[x]" : "[ ]";
  const needsConsent = m.enabled && !m.consented;
  const broken = problems.length > 0;
  /* NOT WORKING IS EXCLUSIVE, not merely first.
   *
   * It already outranked the others and took the row's colour, and the reason
   * given was that it is the one flag that answers the question a player opens
   * this screen with. That reasoning finishes here: a mod that is not running
   * is not affecting this game's determinism or its score right now, so listing
   * "! NOT WORKING, non-deterministic, noscore" spends thirty columns saying
   * one useful thing and two hypothetical ones - and on a wide-enough row it
   * pushed the useful one toward the edge. The save ratchets are still stated,
   * in the detail pane, where there is room to say what they mean.
   *
   * The short words are deliberate too. These share one line with a name, a
   * version and a kind; "non-deterministic" is seventeen columns of a word the
   * pane below spells out in a sentence anyway. */
  const flags: string[] = [];
  if (broken) {
    flags.push(t("modsScreen.row.flag.notWorking", "NOT WORKING"));
  } else {
    /* FIRST AMONG THE NON-EXCLUSIVE FLAGS, because it changes what every other
     * word on the row means: a version, a kind and a permission list all read as
     * facts about something the player has, and this one does not persist. Short
     * for the reason the others are - it shares a line with a name. */
    if (m.session) flags.push(t("modsScreen.row.flag.sessionOnly", "SESSION ONLY"));
    if (m.unreviewed) flags.push(t("modsScreen.row.flag.unreviewed", "unreviewed"));
    if (m.nondeterministic) flags.push(t("modsScreen.row.flag.unseeded", "unseeded"));
    if (m.affectsGameplay) flags.push(t("modsScreen.row.flag.noscore", "noscore"));
    if (needsConsent) flags.push(t("modsScreen.row.flag.needsOk", "NEEDS OK"));
  }
  const suffix = flags.length ? `  ! ${flags.join(", ")}` : "";
  // Kind distinguishes the two PLUGIN load paths (sandbox vs trusted); for a
  // non-plugin it is just "content", which mislabels a tiles pack - so show the
  // shape there instead ("tiles" for a tile pack, not "content").
  const kindTag = m.kind === "content" ? m.shape : m.kind;
  /* THE NAME IS WHAT GIVES WAY, not the badges.
   *
   * selectFromMenu slices a row at the terminal's edge, so an over-long row
   * loses its END - and the end is where "! NOT WORKING, noscore" lives. A mod
   * called "Bug Fixes" with both save ratchets set built
   * an 85-column row, and what a player saw was the name, the version, the kind,
   * and none of the three warnings. Eliding the name instead keeps every badge
   * on screen and costs a few characters of something the row below spells out
   * in full. Measured in mod-viewport.test.ts against the real paint. */
  const fixed = `${box}   v${m.version}  (${kindTag})${suffix}`;
  const room = Math.max(MIN_NAME_COLS, LABEL_COLS - fixed.length);
  const name = displayName(m.name, m.manifest.author, room);
  const label = `${box} ${name}  v${m.version}  (${kindTag})${suffix}`;
  const color = broken
    ? C_DANGER
    : needsConsent
      ? C_WARN
      : m.enabled
        ? C_ENABLED
        : C_DISABLED;
  /* "Requests 2 capability(ies)" was the machine talking. Nobody says
   * "capability(ies)", and the count on its own tells a player nothing they can
   * act on - the detail pane below already lists what each one is for. */
  const capNote =
    m.capabilities.length === 0
      ? t("modsScreen.row.cap.none", "Asks for nothing beyond the game.")
      : t("modsScreen.row.cap.count", "Asks for {count, plural, one {one permission} other {# permissions}}.", {
          count: m.capabilities.length,
        });
  /* No "Enter to manage it." on the end. The footer of this very screen already
   * says so for every row, and repeating it cost four columns off the end of
   * the longest hint - which is the part that describes the mod. */
  return {
    label,
    color,
    hint: broken
      ? t(
          "modsScreen.row.hint.broken",
          "{count, plural, one {Something} other {# things}} stopped this working. Enter to see what.",
          { count: problems.length },
        )
      : m.session
        ? /* The hint says what is different about this row rather than what the
           * mod does, because the shape and the permissions are on the detail
           * screen and "it goes away when you close the game" is not. */
          t(
            "modsScreen.row.hint.sessionOnly",
            "Loaded for this session, not installed. Gone when you close the game.",
          )
        : `${describeShape(m.shape)} ${capNote}`,
  };
}

/**
 * The widest a row's label may be: 80 columns, less the one the slice reserves,
 * less the three `x) ` takes (display_menu_row, ui-menu.c:577-585).
 */
export const LABEL_COLS = 80 - 1 - 3;

/** Never elide a name below this - past it the row stops identifying anything. */
export const MIN_NAME_COLS = 14;

/** What a manifest's `shape` is, said the way a player would say it. */
export function describeShape(shape: string): string {
  switch (shape) {
    case "content":
      return t("modsScreen.shape.content", "Changes the game's contents.");
    case "tiles":
      return t("modsScreen.shape.tiles", "A set of graphics.");
    case "plugin":
      return t("modsScreen.shape.plugin", "Runs its own code.");
    default:
      /* `shape` here is whatever a manifest declares, so it is not a fixed set of
       * literals this file can enumerate - a stray custom shape falls through to
       * this line rather than to one of the three named cases above. */
      return t("modsScreen.shape.other", "A {shape} mod.", { shape });
  }
}

/**
 * Word-wrap plain text to `width` columns as ScreenLines. The menu's detail pane
 * hard-slices at the terminal edge, so anything long enough to be worth reading -
 * a mod's own description, a patch's - has to be wrapped before it gets there.
 */
export function wrapped(text: string, width: number, color = C_FG): ScreenLine[] {
  return wrapCssRuns([{ text, color }], Math.max(20, width)).map((runs) => ({
    text: runs.map((r) => r.text).join(""),
    color,
  }));
}

/**
 * The detail pane for a catalog row: the mod's own description (the thing a
 * player actually needs in order to decide, wrapped to fill the pane), then what
 * it is, what it depends on, what its patches do collectively, and the trust /
 * consent facts. `width` is the terminal's column count.
 *
 * `maxLines` is the pane's budget. selectFromMenu gives the detail pane whatever
 * it asks for and shrinks the LIST to fit, so an unbounded description on the
 * top-level Mods list would push the action rows off screen. Only the
 * description flexes: the identity and trust lines are never dropped, and the
 * mod's own screen (few rows, a big budget) shows the description in full.
 */
export function rowDetail(
  m: CatalogMod,
  width = 80,
  maxLines = 99,
  problems: readonly string[] = [],
  skipped: readonly string[] = [],
): ScreenLine[] {
  const w = width - 1;
  /* A mod that is on and not installed. Everything below this point describes a
   * manifest, and there is not one; what the player needs instead is the two
   * sentences that explain the state and end it. */
  if (m.missing) {
    return [
      ...wrapped(m.name, w, C_TITLE),
      ...wrapped(t("modsScreen.detail.missing.title", "Switched on, but not installed."), w, C_DANGER),
      { text: "", color: C_FG },
      ...wrapped(
        t(
          "modsScreen.detail.missing.why",
          "This mod is in your enabled list and the game cannot find it, so " +
            "every launch tries to load it and gives up. It was probably " +
            "uninstalled, or this is a fresh copy of the game over an old profile.",
        ),
        w,
      ),
      { text: "", color: C_FG },
      ...wrapped(
        t(
          "modsScreen.detail.missing.action",
          "Open it to take it off the list. If you want it back instead, " +
            "Recommended mods... will fetch it again.",
        ),
        w,
        C_WARN,
      ),
    ];
  }
  /* EVERY line here goes through wrapped(), not just the description. The
   * description was wrapped and its siblings were not, so on any terminal
   * narrower than the longest of them - "Non-deterministic: enabling this
   * permanently marks the save non-reproducible." is 76 columns, a capability
   * blurb can be longer - the pane sliced them mid-word at cols-1 while the
   * paragraph above wrapped cleanly. */
  const head: ScreenLine[] = [
    ...wrapped(
      t("modsScreen.detail.head.nameId", "{name}  (id: {id})", {
        name: displayName(m.name, m.manifest.author),
        id: m.id,
      }),
      w,
      C_TITLE,
    ),
    ...wrapped(
      m.kind === "content"
        ? t("modsScreen.detail.head.versionContent", "version {version}  -  {shape} pack", {
            version: m.version,
            shape: m.shape,
          })
        : t(
            "modsScreen.detail.head.versionPlugin",
            "version {version}  -  {shape} pack, {kind} plugin",
            { version: m.version, shape: m.shape, kind: m.kind },
          ),
      w,
    ),
  ];
  /* The author's name IN FULL, plus the licence. The line above carries the short
   * form beside the mod's name (displayName drops an organisation in parentheses to
   * keep a row inside 80 columns); this is the place that has room for whatever they
   * actually wrote, so this is where it is said. */
  const by = [m.manifest.author, m.manifest.license].filter(Boolean).join("  -  ");
  if (by) head.push(...wrapped(by, w, C_DIM));

  /* WHY THIS MOD IS NOT WORKING, directly under its name and above everything else
   * including its own description.
   *
   * It goes here rather than in the `below` block for the same reason it takes the
   * row's colour: the description is what a player reads to decide whether they WANT
   * the mod, and this is what they read when they already turned it on and nothing
   * happened. The description flexes to fit the pane; this never does - it is
   * subtracted from the description's budget instead, so a long blurb can be cut and
   * a fault cannot. Every one of these lines was previously reachable only from a
   * devtools console, and four of the five sources reached nothing at all. */
  const trouble: ScreenLine[] = [];
  if (problems.length > 0) {
    trouble.push({ text: "", color: C_FG });
    trouble.push(
      ...wrapped(
        t(
          "modsScreen.detail.trouble.heading",
          "{count, plural, one {NOT WORKING:} other {NOT WORKING - # problems:}}",
          { count: problems.length },
        ),
        w,
        C_DANGER,
      ),
    );
    for (const p of problems) {
      /* Hanging indent, so a wrapped problem stays visibly one problem. */
      trouble.push(
        ...wrapped(`  - ${p}`, w, C_DANGER).map((l, i) =>
          i === 0 ? l : { ...l, text: `    ${l.text}` },
        ),
      );
    }
  }
  /* Not a fault, and said differently: a mod that is enabled and waiting for consent
   * is not broken, but it is also not running, and "enabled" alone does not
   * distinguish those two for a player looking at a mod that does nothing. */
  for (const s of skipped) {
    trouble.push(
      { text: "", color: C_FG },
      ...wrapped(t("modsScreen.detail.trouble.notLoaded", "Not loaded: {reason}", { reason: s === "not enabled" && safeLaunch() ? t("modsScreen.detail.trouble.safeMode", "safe mode is on for this session") : s }), w, C_WARN),
    );
  }

  const below: ScreenLine[] = [];
  const ruleCount = m.manifest.rules?.length ?? 0;
  /* What turning the mod on does depends on each rule's own default, so the
   * line counts them rather than assuming every rule starts on. */
  const startOn = m.manifest.rules?.filter((rule) => rule.default).length ?? 0;
  if (ruleCount > 0) {
    below.push({ text: "", color: C_FG });
    below.push(
      ...wrapped(
        m.enabled
          ? t(
              "modsScreen.detail.rules.enabledAny",
              "Makes {count, plural, one {# separate change} other {# separate changes}}. Open the mod to switch any one on or off.",
              { count: ruleCount },
            )
          : startOn === ruleCount
            ? t(
                "modsScreen.detail.rules.disabledAllOn",
                "Makes {count, plural, one {# separate change} other {# separate changes}}, all on by default. Turning the mod on asks whether to use the defaults, pick your own, or use none.",
                { count: ruleCount },
              )
            : startOn === 0
              ? t(
                  "modsScreen.detail.rules.disabledAllOff",
                  "Makes {count, plural, one {# separate change} other {# separate changes}}, all off by default. Turning the mod on asks whether to pick the ones you want or use none.",
                  { count: ruleCount },
                )
              : t(
                  "modsScreen.detail.rules.disabledSome",
                  "Makes {count, plural, one {# separate change} other {# separate changes}}, {on} of them on by default. Turning the mod on asks whether to use the defaults, pick your own, or use none.",
                  { count: ruleCount, on: startOn },
                ),
        w,
        m.enabled ? C_ENABLED : C_DIM,
      ),
    );
  }
  const deps = m.manifest.dependencies
    ? Object.entries(m.manifest.dependencies).map(([d, v]) => `${d} ${v}`)
    : [];
  if (deps.length) {
    below.push(
      ...wrapped(t("modsScreen.detail.needs", "Needs: {deps}", { deps: deps.join(", ") }), w),
    );
  }
  /* WHO ASKED FOR THIS, not where it came from - that is `browseDetail`'s "From"
   * line, on a different screen entirely, and this pane has never shown it. A
   * mod-building tool can install a mod it generated through `ctx.installMod`,
   * and the player is owed the difference between that and a zip they picked
   * themselves - the same reason `session` gets its own row rather than being
   * folded into "enabled". */
  if (m.installedByModId !== undefined) {
    below.push(
      ...wrapped(
        t("modsScreen.detail.installedBy", "Installed by: {name}", {
          name: modDisplayName(m.installedByModId) ?? t("modsScreen.detail.installedByMod", "another mod"),
        }),
        w,
        C_DIM,
      ),
    );
  }
  /* THE TWO ONE-WAY DOORS, said as one-way doors.
   *
   * "Non-deterministic: enabling this permanently marks the save
   * non-reproducible" is three pieces of jargon in a row about a decision that
   * cannot be undone, on a screen where the next keypress makes it. What a
   * player needs to know is that turning it on is permanent for THIS character,
   * and what they give up. */
  /* Short on purpose, as well as plain. These are the two lines that must
   * survive the pane's budget on a narrow terminal (see the truncation rule
   * below), and a warning that takes three wrapped lines is a warning that can
   * lose its last one - which is where the consequence lives. */
  if (m.nondeterministic) {
    below.push(
      ...wrapped(
        t(
          "modsScreen.detail.nondeterministicWarning",
          "Permanent once on: the same seed stops giving the same game.",
        ),
        w,
        C_WARN,
      ),
    );
  }
  if (m.affectsGameplay) {
    below.push(
      ...wrapped(
        t(
          "modsScreen.detail.affectsGameplayWarning",
          "Permanent once on: changes play, so this character cannot score.",
        ),
        w,
        C_WARN,
      ),
    );
  }
  if (m.capabilities.length === 0) {
    /* "(content only)" was wrong for a plugin that requests nothing, and a folder
     * plugin is exactly that case: it runs code but asks for no registry domain,
     * so the row said "content only" about a mod whose whole substance is code.
     * The parenthetical now describes the mod in front of the player.
     *
     * AND IT SAYS THE CODE PART OUT LOUD, because "asks for no permissions" on
     * its own reads as "cannot do anything" and that is not what an empty
     * capability list means. A plugin is handed `ctx.core` (the live engine
     * namespace), `ctx.state` and `ctx.registries` with no capability check at
     * all, so a mod declaring nothing still reaches the registries the
     * capability-gated facades guard - see docs/modding/PLUGINS.md, "What a
     * capability gates". The list is what the mod DECLARED, and the code is what
     * the player is actually trusting. Warning colour rather than dim for the
     * same reason: it is the one row here that a player would otherwise read as
     * a reassurance. */
    below.push(
      ...wrapped(
        m.kind === "content"
          ? t(
              "modsScreen.detail.noPermissions.content",
              "Asks for no permissions - it only adds and changes game contents.",
            )
          : t(
              "modsScreen.detail.noPermissions.code",
              "Asks for no permissions, but it still runs its own code in the game.",
            ),
        w,
        m.kind === "content" ? C_DIM : C_WARN,
      ),
    );
  } else {
    below.push(...wrapped(t("modsScreen.detail.capabilitiesIntro", "It asks to be allowed to:"), w));
    const refusedHere = new Set(m.refused ?? []);
    const byTier = new Map((m.tierRefused ?? []).map((r) => [r.capability, r.why]));
    for (const d of describeCapabilities(m.capabilities)) {
      /* Hanging indent so a wrapped bullet stays visibly one bullet. */
      const elevatedTag = d.elevated ? `  ${t("modsScreen.detail.elevatedTag", "[powerful]")}` : "";
      const tierWhy = byTier.get(d.cap);
      const status =
        tierWhy !== undefined
          ? `  (${tierWhy})`
          : refusedHere.has(d.cap)
            ? `  ${t("modsScreen.detail.refusedTag", "[refused]")}`
            : "";
      const color = tierWhy !== undefined || refusedHere.has(d.cap) ? C_DIM : d.elevated ? C_WARN : C_FG;
      below.push(
        ...wrapped(`  - ${d.text}${elevatedTag}${status}`, w, color)
          .map((l, i) => (i === 0 ? l : { ...l, text: `    ${l.text}` })),
      );
    }
    if (refusedHere.size > 0) {
      below.push(
        ...wrapped(
          t("modsScreen.detail.refused", "You refused this. The parts of the mod that need it do not work."),
          w,
          C_DIM,
        ),
      );
    }
    /* THREE STATES, NOT TWO. An enabled mod that is short a capability used to
     * be told "you will be asked when you turn it on", which is the one case
     * where that sentence is false: it IS on, nothing is going to ask, and its
     * code is not running. That is the state a mod lands in when it adds a
     * capability in a later version and is then updated in place, and it is
     * exactly the state a player cannot diagnose from the outside, because the
     * rules all still render and click. Say what is true instead, and name the
     * capability that is holding it, since "some permission" is not something
     * anyone can act on. */
    if (m.consented) {
      below.push(...wrapped(t("modsScreen.detail.consented", "You have allowed this."), w, C_ENABLED));
    } else if (m.enabled) {
      const pending = undecidedCapabilities(m);
      below.push(
        ...wrapped(
          t(
            "modsScreen.detail.enabledNotConsented",
            "Its code is NOT running: this version asks for something new.",
          ),
          w,
          C_DANGER,
        ),
      );
      for (const d of describeCapabilities(pending)) {
        below.push(
          ...wrapped(`  - ${d.text}`, w, C_WARN)
            .map((l, i) => (i === 0 ? l : { ...l, text: `    ${l.text}` })),
        );
      }
    } else {
      below.push(
        ...wrapped(
          t(
            "modsScreen.detail.notConsented",
            "You have not allowed this yet - you will be asked when you turn it on.",
          ),
          w,
          C_WARN,
        ),
      );
    }
  }

  /* The description gets whatever the head and the below block leave. This used
   * to be a COUNT of how many lines each part was expected to occupy (rules ? 3
   * : 0, deps ? 1 : 0, ...), which is only right while every one of them is a
   * single line - and once they wrap, the guess under-reserves and the pane
   * overflows. Measuring the built lines cannot drift from what is drawn. */
  const lines = [...head, ...trouble];
  const MORE = {
    text: t("modsScreen.detail.more", "...  (open the mod to read the rest)"),
    color: C_DIM,
  };
  if (m.manifest.description) {
    const room = maxLines - head.length - trouble.length - below.length - 1;
    const desc = wrapped(m.manifest.description, w);
    if (desc.length <= room) {
      lines.push({ text: "", color: C_FG }, ...desc);
    } else if (room >= 2) {
      lines.push({ text: "", color: C_FG }, ...desc.slice(0, room - 1), MORE);
    } else {
      /* No room for even a line of it plus the pointer: the head and the block
       * below already fill the pane. Say so instead of showing a stub. */
      lines.push({ text: "", color: C_FG }, MORE);
    }
  }
  const all = [...lines, ...below];

  /* Even with no description at all the pane can outgrow a short terminal, and
   * overlay.ts's print loop just STOPS at the hint row - silently, from the
   * bottom, which is where the two save-ratchet warnings are. Truncating here
   * instead keeps the loss visible and keeps this function's length equal to
   * what gets drawn, which is the property the caller's budget depends on. */
  if (all.length <= maxLines) return all;
  return [...all.slice(0, Math.max(1, maxLines - 1)), MORE];
}

/**
 * A mod's description in full, for the scrolling viewer - the place the capped
 * detail pane sends a player who wants the rest of it.
 *
 * Paragraphs are kept: a blank line in a manifest's description is the author
 * separating two ideas, and `wrapped()` on the whole string runs them together
 * into the wall of text this row exists to stop being the only option.
 *
 * LEFT AT `lines`, DELIBERATELY. This page is the canonical finished-at-`lines`
 * case: it is one stranger's prose, already wrapped, and the three rows in front of
 * it are not a repeated record - a name-and-id line, a version-and-shape line and an
 * author-and-licence line, each a different shape and each present or not on its
 * own. A table of three one-off rows is a table with no second row to line up
 * against, and re-declaring the prose as a `text` block would hand the wrap from
 * `wrapCssRuns` to `textblock_calculate_lines` and move the page under the player.
 * The header's FIELDS are already reachable: every one of them comes off
 * `CatalogMod`, which a presenter has before it has this screen.
 */
export function fullDescription(m: CatalogMod, width = 80): ScreenLine[] {
  const w = width - 1;
  const out: ScreenLine[] = [
    ...wrapped(
      t("modsScreen.fullDesc.nameId", "{name}  (id: {id})", {
        name: displayName(m.name, m.manifest.author),
        id: m.id,
      }),
      w,
      C_TITLE,
    ),
    ...wrapped(
      t("modsScreen.fullDesc.version", "version {version}  -  {shape} pack", {
        version: m.version,
        shape: m.shape,
      }),
      w,
      C_DIM,
    ),
  ];
  const by = [m.manifest.author, m.manifest.license].filter(Boolean).join("  -  ");
  if (by) out.push(...wrapped(by, w, C_DIM));
  out.push({ text: "", color: C_FG });
  for (const para of (m.manifest.description ?? "").split(/\n\s*\n/u)) {
    const text = para.trim();
    if (!text) continue;
    out.push(...wrapped(text, w), { text: "", color: C_FG });
  }
  const deps = m.manifest.dependencies
    ? Object.entries(m.manifest.dependencies).map(([d, v]) => `${d} ${v}`)
    : [];
  if (deps.length) {
    out.push(
      ...wrapped(t("modsScreen.fullDesc.needs", "Needs: {deps}", { deps: deps.join(", ") }), w, C_DIM),
    );
  }
  if (m.manifest.engine) {
    out.push(
      ...wrapped(
        t("modsScreen.fullDesc.engine", "Written for game {engine}", { engine: m.manifest.engine }),
        w,
        C_DIM,
      ),
    );
  }
  return out;
}
