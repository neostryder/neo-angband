import { type ModRefresh, refreshRow, unavailableMods, upToDateHeadline } from "../mod-refresh";
import { type ScreenView, freezeView, SCREEN_FOOTER } from "../screen-view";
import { t } from "@rpgm-tools/neo-angband-core";
import { wrapMessage, MESSAGE_WIDTH } from "./browse-views";
import { C_WARN, C_FG, C_DIM } from "./browse-colors";
import { type ModBrowseDeps } from "./browse-types";
import { type RepoRef } from "../mod-source";
import { type GridSurface, type GridPointerInput } from "../term";
import { selectFromMenu, type ScreenLine, screenRegionSpec } from "../overlay";
import { pushRegion, regionSurface, popRegion } from "../ui-stack";

/**
 * `refreshRow`'s sentence with the two fields it opens with taken back off it.
 *
 * DERIVED RATHER THAN RE-WORDED. Six standings' wording lives in mod-refresh.ts and
 * a second copy of it here would be two transcriptions of the same sentence, with
 * the one nobody looks at rotting - the lesson screen-view.ts's header is built on.
 * Every branch of `refreshRow` opens `${id} ${installed}` and then says one thing
 * about the repository, so the head is the shape of that function rather than a
 * guess; the test asserts the three cells rejoin into exactly `refreshRow(r)`, which
 * is what fails the day it stops being true.
 */
export function refreshStatus(r: ModRefresh): string {
  const head = `${r.name ?? r.id} ${r.installed}`;
  const row = refreshRow(r);
  return row.startsWith(`${head} `) ? row.slice(head.length + 1) : row;
}

/**
 * The "nothing is waiting" report as a document: prose, then the per-mod list as a
 * TABLE, then prose.
 *
 * THE LIST IS THE PART THAT WAS BEING LOST. `ModRefresh` already carries the six
 * facts a row is made of - id, repo, installed tag, newest tag, standing, and why
 * the repository could not be asked - and `refreshRow` glued them into one sentence
 * before anything could see them. A presenter that wanted to sort by standing, or
 * colour the status, or act on the mod this row is about, had to find an arrow in
 * English first. Cells carry the fields and `semantic.data` carries the record.
 *
 * THE PROSE AROUND IT STAYS `lines`, by the rule rather than for convenience: the
 * headline is prose this screen has already laid out (`wrapMessage` at
 * MESSAGE_WIDTH) and the closing paragraphs are hand-broken constants. Re-declaring
 * them as `text` blocks would hand the wrap to `textblock_calculate_lines`, which
 * agrees with `wrapMessage` on every headline `upToDateHeadline` can produce today
 * but not by construction - a moved line on the player's screen for no gain.
 *
 * NO `latest` COLUMN, which is where this parts company with the obvious four-column
 * shape. Only a `behind` row writes a newest tag at all, so a column for it is empty
 * on the other five standings and puts a stray space into every one of their rows.
 * The tag rides on `semantic.data.newest` instead, unformatted and without the arrow
 * - which is what a presenter wanted from that column in the first place.
 */
export function modUpdateReportScreen(refreshed: readonly ModRefresh[]): ScreenView {
  const blind = unavailableMods(refreshed);
  return freezeView({
    id: "core:mod-updates",
    title: t("modBrowse.upgrades.title", "Update installed mods"),
    footer: SCREEN_FOOTER,
    blocks: [
      {
        kind: "lines",
        lines: [
          /* One sentence, from one place, that has to fit what was actually asked -
           * see upToDateHeadline. Composing it here is how it came to say "every"
           * about a set that included mods nothing had asked about. */
          ...wrapMessage(upToDateHeadline(refreshed), MESSAGE_WIDTH).map((text) => ({
            text,
            color: blind.length > 0 && blind.length === refreshed.length ? C_WARN : C_FG,
          })),
          { text: "", color: C_FG },
        ],
      },
      {
        kind: "table",
        key: "installed",
        tagged: false,
        columns: [
          /* The listing's two columns of margin, as a column of their own. The
           * alternative was to bake them into the mod cell, which would put the
           * terminal's indent back inside the one field a mod is addressed by. */
          { key: "indent", width: 2 },
          /* The identifying fields stay unpadded; status uses their remaining
           * space and continues below them when a repository returns a long reason. */
          { key: "mod", gap: 0, pad: false },
          { key: "installed", pad: false },
          { key: "status", wrap: true },
        ],
        rows: refreshed.map((r) => ({
          id: r.id,
          semantic: {
            kind: "mod",
            ref: r.id,
            data: {
              repo: r.repo,
              installed: r.installed,
              newest: r.newest,
              standing: r.standing,
              problem: r.problem,
              channelHeld: r.channelHeld,
            },
          },
          /* The whole row in one colour, exactly as the line was. Colouring the
           * status CELL would emit a `runs` array where a plain coloured line used
           * to go: the same pixels down a different path in showTextScreen, and a
           * different object for anything that measures. A presenter with its own
           * palette reads `semantic.data.standing` and colours what it likes. */
          color: r.standing === "unavailable" ? C_WARN : C_DIM,
          cells: {
            mod: { text: r.name ?? r.id },
            installed: { text: r.installed },
            status: { text: refreshStatus(r) },
          },
        })),
        /* No `empty` state: with nothing installed the old screen printed nothing
         * between the headline and the closing prose, and the headline is already
         * "No mods are installed yet." */
      },
      {
        kind: "lines",
        lines: [
          ...(blind.length > 0
            ? [
                { text: "", color: C_FG },
                {
                  text: t(
                    "modBrowse.upgrades.blind1",
                    "A mod that could not be checked has NOT been removed and has not",
                  ),
                  color: C_DIM,
                },
                {
                  text: t(
                    "modBrowse.upgrades.blind2",
                    "changed. Its repository may be renamed, private, or simply not",
                  ),
                  color: C_DIM,
                },
                { text: t("modBrowse.upgrades.blind3", "reachable from here right now."), color: C_DIM },
              ]
            : []),
          { text: "", color: C_FG },
          ...aboutModUpgradesLines(),
        ],
      },
    ],
  });
}

/** The curated list's two kinds of repository, lower-cased. */
export interface ListedRepos {
  readonly readable: boolean;
  /** Its "mods": vouched for, so installs and updates skip the consent gate. */
  readonly vouched: ReadonlySet<string>;
  /** Its "community" mods: third-party, and every new release is asked about. */
  readonly community: ReadonlySet<string>;
}

/**
 * Which repositories the curated list vouches for, and which it lists as community mods.
 *
 * WHY AN UPDATE STILL HAS AN ORIGIN. The origin decides one thing: whether the
 * consent gate applies (mod-install.ts checks it before any fetch). A recommended
 * mod is exempt from the prompt, so its update must be too, or a player who never
 * turned third-party mods on would find the recommended mods they already have
 * frozen at the version they installed. Everything else is third-party - which is
 * what it was when it went in - and the switch that let it in is the switch that
 * lets it be replaced. A player who has since turned the switch off has said they
 * do not want that code, and an update is more of that code.
 *
 * Its "community" mods are not vouched for. Listing one is not a vouch, so an update
 * to one is third-party, the same as the install that brought it in, and it is also
 * one the player confirms first (confirmCommunityUpdate). A repository on both
 * lists is treated as vouched.
 *
 * Updates wait when the list cannot be read, because community status is unknown.
 */
export async function listedRepos(deps: Pick<ModBrowseDeps, "curated">): Promise<ListedRepos> {
  const { registry } = await deps.curated().catch(() => ({ registry: null }));
  const lower = (refs: readonly RepoRef[] | undefined): Set<string> =>
    new Set((refs ?? []).map((r) => r.repo.toLowerCase()));
  const vouched = lower(registry?.mods);
  const community = lower(registry?.community);
  for (const repo of vouched) community.delete(repo);
  return { readable: registry !== null, vouched, community };
}

export function registryUpdateWaitingText(): string {
  return t("modBrowse.upgrades.registryUnavailable", "The recommended mod list could not be read. Updates are waiting until it is available.");
}

/** What the community-update question names. */
export interface CommunityUpdate {
  readonly name: string;
  /** The installed tag. */
  readonly from: string;
  /** The tag that would replace it. */
  readonly to: string;
  /** owner/repo, as the curated list names it. */
  readonly repo: string;
}

/**
 * Ask before a release of a community mod replaces the installed one.
 *
 * A community listing records that one release passed the listing checks and says
 * nothing about the next, which the author can publish at any time. So the switch
 * that let the mod in does not stand for every later release: each one is named to
 * the player, with both versions and the repository's owner, and is installed only
 * on a yes. No, or ESC, keeps the installed release and is not a failure.
 *
 * First-party mods are vouched for and never ask. Mods added by address are not on
 * the community list and do not ask either.
 */
export async function confirmCommunityUpdate(
  term: GridSurface & GridPointerInput,
  update: CommunityUpdate,
): Promise<boolean> {
  const owner = update.repo.split("/")[0] ?? update.repo;
  const vars = { name: update.name, from: update.from, to: update.to, owner };
  const pick = await selectFromMenu(
    term,
    "core:mod-community-update",
    t("modBrowse.communityUpdate.title", "Install {name} {to}?", vars),
    [
      {
        label: t("modBrowse.communityUpdate.keep", "No, keep {from}", vars),
        color: C_FG,
        hint: t("modBrowse.communityUpdate.keepHint", "Nothing changes. You can update it later."),
      },
      {
        label: t("modBrowse.communityUpdate.install", "Yes, install {to}", vars),
        color: C_WARN,
        hint: t("modBrowse.communityUpdate.installHint", "Replaces {from} with {to} from {owner}'s repository.", vars),
      },
    ],
    t("modBrowse.consent.footer", "[ ESC to go back - the same as No ]"),
    {
      detail: () => [
        { text: t("modBrowse.communityUpdate.byOwner", "{name} is a community mod by {owner}.", vars), color: C_FG },
        {
          text: t("modBrowse.communityUpdate.versions", "Installed: {from}   New: {to}", vars),
          color: C_FG,
        },
        {
          text: t(
            "modBrowse.communityUpdate.notReviewed",
            "Being listed does not mean anybody reviewed this release.",
          ),
          color: C_DIM,
        },
      ],
    },
  );
  return pick === 1;
}

/**
 * Why a community update was left alone by a pass with nobody there to answer.
 * Said as waiting, not failing: the release is fine, it only needs a yes.
 */
export function communityUpdateWaitingText(): string {
  return t(
    "modBrowse.communityUpdate.waiting",
    "Waiting for your confirmation, as a community mod. Update it from Mods -> Update installed mods.",
  );
}

/**
 * Where a mod update comes from, said once.
 *
 * A FUNCTION, not a constant: see gameMenuFooter's comment in game-menu.ts - a
 * locale can change mid-session, so nothing translatable may be frozen at
 * import time.
 */
export function aboutModUpgradesLines(): readonly ScreenLine[] {
  return [
    {
      text: t(
        "modBrowse.aboutUpgrades.body1",
        "Each mod lives in its own repository and releases on its own schedule,",
      ),
      color: C_DIM,
    },
    {
      text: t(
        "modBrowse.aboutUpgrades.body2",
        "so this asks every installed mod where it came from and compares the",
      ),
      color: C_DIM,
    },
    {
      text: t(
        "modBrowse.aboutUpgrades.body3",
        "version you have with the newest one your update channel allows.",
      ),
      color: C_DIM,
    },
    {
      text: t(
        "modBrowse.aboutUpgrades.body4",
        "Game and mod updates can be installed together from Update, or separately here.",
      ),
      color: C_DIM,
    },
  ];
}

/** Draw one line, let it paint, then run `job`. For a wait a player can read. */
export async function paintWhile<T>(
  term: GridSurface & GridPointerInput,
  title: string,
  line: string,
  job: () => Promise<T>,
): Promise<T> {
  /* A REGION for the length of the job (#253). This is the shared wait screen,
   * so converting it converts every caller of it at once. */
  const handle = pushRegion(screenRegionSpec(), term.size());
  const waiting = regionSurface(term, handle.cells);
  const { cols } = waiting.size();
  waiting.clear();
  waiting.print(0, 1, title.slice(0, cols - 1), C_FG);
  waiting.print(0, 3, line.slice(0, cols - 1), C_DIM);
  waiting.flush?.();
  try {
    return await job();
  } finally {
    popRegion(handle);
  }
}
