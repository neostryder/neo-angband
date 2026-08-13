/**
 * Is there a newer Neo Angband than this one?
 *
 * The whole of the question, and none of the answering: this module decides
 * WHETHER an update exists and WHICH file this machine would need. Downloading
 * it, verifying it and swapping it into place is the desktop main process's job
 * (packages/desktop/src/updater.ts), because a renderer cannot write to the
 * folder it is running out of and should not be able to.
 *
 * THREE THINGS ABOUT THE GITHUB API THAT ARE EASY TO GET WRONG, and each of
 * them turns the feature off silently rather than loudly:
 *
 * 1. `/releases/latest` EXCLUDES pre-releases. Every 0.x tag is published with
 *    `--prerelease` (see docs/RELEASING.md), so that endpoint answers 404 for
 *    this project today and would answer with a stale 1.x release later. The
 *    list endpoint is the only one that can see our releases at all.
 * 2. DRAFTS ARE INVISIBLE to an unauthenticated caller and must stay that way -
 *    a draft is a release nobody has approved. `draft: true` is filtered anyway,
 *    so an authenticated run (a maintainer's token in the environment) behaves
 *    the same as a player's.
 * 3. The newest release is the one with the highest VERSION, not the newest
 *    `created_at`. Re-uploading an asset to an old release moves its timestamp,
 *    and a hand-cut hotfix can be published after a later tag. Sorting by date
 *    would offer a downgrade, and the updater would then loop between two
 *    versions forever.
 *
 * The check is one request with a short timeout, and a failure is silent ON THE
 * TITLE SCREEN - no shimmer, no message. A game that cannot reach GitHub is not
 * broken, and a player who is offline did not ask a question.
 *
 * IT IS NOT SILENT ON THE UPDATE SCREEN, and that distinction is the whole
 * reason this function returns a result type instead of `AvailableUpdate | null`.
 * A player who presses (U) HAS asked the question, and "null" answered four
 * different things at once: there is nothing newer, GitHub could not be reached,
 * GitHub refused, GitHub did not answer in time. The screen printed "This is the
 * newest build on your channel" for all four - a claim it could not stand behind
 * - and the check ran once at boot, so there was no way to ask again short of
 * restarting the game.
 *
 * This project has already paid for that exact shape once, on the other side of
 * the same screen: mod-registry.ts's comment records a silence that "meant
 * nothing newer shipped HERE and it said you are up to date", and
 * mod-refresh.test.ts asserts the phrase is never used. The lesson was applied
 * to mod updates and not to the game's own, which is how one screen came to
 * carry both the fixed version and the bug.
 */

import { compareSemver } from "@rpgm-tools/neo-angband-mod-sdk";

/** The repository releases are cut from. */
export const UPDATE_REPO = "neostryder/neo-angband";

/** How long the check is allowed to take before it is abandoned. */
export const UPDATE_TIMEOUT_MS = 6000;

/** One downloadable file on a release. */
export interface ReleaseAsset {
  readonly name: string;
  readonly url: string;
  readonly size: number;
  /**
   * `sha256:...` as GitHub reports it, or null on an older asset that predates
   * the field. Null is not fatal but it IS load-bearing: the desktop side
   * refuses to swap in an archive it could not verify, so a release whose assets
   * have no digest simply offers no update.
   */
  readonly sha256: string | null;
}

/** A release, reduced to what the updater needs. */
export interface Release {
  readonly tag: string;
  readonly version: string;
  readonly draft: boolean;
  readonly prerelease: boolean;
  readonly url: string;
  readonly assets: readonly ReleaseAsset[];
}

/** What the title screen needs to know. */
export interface AvailableUpdate {
  readonly version: string;
  readonly tag: string;
  /** The release page, for the player who would rather do it by hand. */
  readonly url: string;
  /** The archive for THIS machine, or null if this release has none. */
  readonly asset: ReleaseAsset | null;
  /**
   * True when this channel's newest build is BEHIND what is installed, which
   * happens after moving from a faster channel to a slower one. It is still
   * offered, because the alternative is a player who picked `stable` sitting on
   * an `early` build forever while the game says there is nothing to do - but
   * it must never shimmer, and the screen has to call it what it is.
   */
  readonly older: boolean;
}

/**
 * What one check found, with "could not ask" kept apart from "nothing to offer".
 *
 * `ok: true, update: null` is the good answer nobody notices: GitHub was asked,
 * it answered, and this channel holds nothing newer. `ok: false` is a question
 * that never got answered, and the screen must say so rather than reporting the
 * absence of an update as the presence of currency.
 *
 * `reason` is a SENTENCE, not a code. It is printed straight onto the update
 * screen, where the reader is a player deciding whether to worry - "GitHub did
 * not answer in time." tells them to press the key again; a 403 tells them to
 * wait an hour; "could not be reached" tells them to check their connection.
 */
export type UpdateCheck =
  | { readonly ok: true; readonly update: AvailableUpdate | null }
  | { readonly ok: false; readonly reason: string };

/**
 * How fresh a build the player is willing to run.
 *
 * INCLUSIVE DOWNWARD: `beta` sees stable releases too, and `early` sees
 * everything. A player on beta must still be offered 1.0.0 when it ships, and a
 * channel that hid its own stable releases would strand people on the last
 * pre-release.
 *
 * WHY THERE IS NO `draft` CHANNEL, though it was the obvious third name: GitHub
 * hides draft releases from unauthenticated callers. It is not a visibility
 * preference, it is the API - a player's game cannot see a draft at all, and the
 * only way to change that is to ship a credential inside the game. A draft is
 * the maintainer's staging area, and the published-but-not-final state GitHub
 * actually offers for this is the PRE-RELEASE flag, which every 0.x release here
 * already carries. So `beta` is pre-releases, and drafts remain invisible to
 * everyone including the person who made them.
 */
export type UpdateChannel = "stable" | "beta" | "early";

/** In order, slowest first. The cycle order on the update screen. */
export const UPDATE_CHANNELS: readonly UpdateChannel[] = ["stable", "beta", "early"];

/**
 * What an `early` build's version looks like: `0.16.1-edge.42`.
 *
 * The marker is in the VERSION rather than the release title or a label,
 * because the version is the only part of a release that both CI writes and
 * the comparator reads. A title is prose and can be edited on the website.
 */
export const EDGE_MARKER = "-edge.";

/** Is this a per-commit build off master rather than a tagged release? */
export function isEdgeRelease(r: Release): boolean {
  return r.version.includes(EDGE_MARKER);
}

/**
 * Whether a channel accepts a build - the whole channel rule, in one place.
 *
 * Split out from releasesIn because MODS need the same question answered, and a
 * mod is not a GitHub release: it is a tag in its own repository, chosen so the
 * lookup is CORS-open and cheap (mod-source.ts). Two copies of a rule is one copy
 * that learns, and this project has paid for that lesson more than once - so the
 * mod side calls this rather than re-deriving "what does early mean".
 *
 * `prerelease` is passed in rather than sniffed out of the version because the two
 * callers know it differently: a release carries GitHub's own flag, while a tag has
 * only its semver prerelease suffix. That difference is real and must not be
 * flattened - every 0.x RELEASE here is flagged pre-release while being versioned
 * `0.18.0` (docs/RELEASING.md), so deriving the flag from the version would quietly
 * promote the entire alpha to stable.
 */
export function channelAccepts(
  channel: UpdateChannel,
  version: string,
  prerelease: boolean,
): boolean {
  if (version.includes(EDGE_MARKER)) return channel === "early";
  if (prerelease) return channel !== "stable";
  return true;
}

/** The releases a channel is willing to look at. */
export function releasesIn(channel: UpdateChannel, releases: readonly Release[]): Release[] {
  return releases.filter((r) => channelAccepts(channel, r.version, r.prerelease));
}

/**
 * The channel a player starts on, which depends on whether anything has ever
 * shipped on the stable one.
 *
 * While the engine is 0.x EVERY release is flagged pre-release by definition
 * (docs/RELEASING.md), so `stable` is empty - and a default of "stable" would
 * mean a freshly installed alpha never offers an update and never says why.
 * That is the silent-off failure this project keeps finding. So 0.x defaults to
 * `beta`, and the day 1.0.0 ships the same expression starts answering
 * `stable` without anyone remembering to change it.
 */
export function defaultChannel(current: string): UpdateChannel {
  const major = /^(\d+)\./u.exec(current)?.[1];
  return major === "0" ? "beta" : "stable";
}

/** Where the player's choice is kept. */
export const CHANNEL_KEY = "neo-angband:update-channel";

function isChannel(v: unknown): v is UpdateChannel {
  return typeof v === "string" && (UPDATE_CHANNELS as readonly string[]).includes(v);
}

/** The stored channel, or the default for this version. Never throws. */
export function readChannel(store: Pick<Storage, "getItem"> | null, current: string): UpdateChannel {
  try {
    const raw = store?.getItem(CHANNEL_KEY);
    if (isChannel(raw)) return raw;
  } catch {
    /* Storage can throw outright in a locked-down browser. */
  }
  return defaultChannel(current);
}

/** Remember the player's choice. A failure here costs the preference, nothing else. */
export function writeChannel(store: Pick<Storage, "setItem"> | null, channel: UpdateChannel): void {
  try {
    store?.setItem(CHANNEL_KEY, channel);
  } catch {
    /* ignored */
  }
}

/** Which build a machine needs. Mirrors process.platform / process.arch. */
export interface Machine {
  readonly platform: string;
  readonly arch: string;
}

/**
 * The start of every desktop artifact's name, from electron-builder's
 * `${productName}` with its spaces replaced by dots: `Neo.Angband-0.16.0-win.zip`.
 *
 * THIS IS A SECOND, INDEPENDENT ANSWER TO "IS THIS OUR FILE". The first is
 * UPDATE_REPO, and for a while it was the only one - which came to light from a
 * screenshot of a verification run, and the question of whether the upstream
 * version visible on it was going to reach players. It was not, because the
 * pointer had already been reverted. But upstream Angband names its Windows
 * archive `Angband-4.2.6-166-gf0f6bd223-win.zip`, and the platform test below
 * used to be a bare `endsWith("-win.zip")` - so the ONLY thing that made a
 * foreign release unusable was the repository constant being right. One
 * mis-set string away from unpacking another project over this one.
 *
 * A release cut under a different product name stops offering updates rather
 * than installing something unrecognised, and packaging.test.ts ties this
 * constant to the productName that actually produces the files.
 */
export const ASSET_PREFIX = "neo.angband-";

/**
 * Which asset is the in-place-updatable archive for this machine.
 *
 * ZIP AND TAR.GZ, NEVER THE INSTALLERS. The updater swaps a folder, so it wants
 * the archive that IS the folder - not the .dmg (a disk image), not the NSIS
 * .exe (an installer that would raise UAC and ask questions), not the .deb (dpkg
 * and root). Those stay on the release page for a first install; this is the
 * path for a machine that already has the game.
 *
 * The macOS names carry `-${arch}-mac` since 0.17.0. Before that the x64 build
 * was the UNLABELLED one, so an older release's `-mac.zip` is x64 - matched
 * explicitly rather than by omission, because "the one with no arch in it" is
 * exactly the reading that shipped the wrong file to an M4.
 */
export function pickAsset(
  all: readonly ReleaseAsset[],
  machine: Machine,
): ReleaseAsset | null {
  const arch = machine.arch === "arm64" ? "arm64" : "x64";
  const named = (n: string): string => n.toLowerCase();
  /* Anything not named for this product is not a candidate on any platform. */
  const assets = all.filter((a) => named(a.name).startsWith(ASSET_PREFIX));
  if (machine.platform === "win32") {
    return assets.find((a) => named(a.name).endsWith("-win.zip")) ?? null;
  }
  if (machine.platform === "darwin") {
    const labelled = assets.find((a) => named(a.name).endsWith(`-${arch}-mac.zip`));
    if (labelled) return labelled;
    /* Pre-0.17.0 naming: arm64 was labelled and x64 was NOT, so the Intel
     * archive is the one ending `-mac.zip` with no arch before it. Written as an
     * exclusion because `-arm64-mac.zip` also ends with `-mac.zip`, and the
     * naive suffix test hands an Intel Mac the Apple Silicon build - the same
     * unlabelled-default trap that put the wrong dmg on the release page. */
    if (arch === "x64") {
      return (
        assets.find(
          (a) => named(a.name).endsWith("-mac.zip") && !/-(?:arm64|x64)-mac\.zip$/u.test(named(a.name)),
        ) ?? null
      );
    }
    return null;
  }
  if (machine.platform === "linux") {
    return assets.find((a) => named(a.name).endsWith(`-${arch}.tar.gz`)) ?? null;
  }
  return null;
}

/**
 * The highest published version among these releases, or null.
 *
 * `compareSemver` returns null for a version it cannot parse; such a release is
 * skipped rather than treated as 0.0.0, because an unparseable tag is a tag we
 * do not understand and offering it as an upgrade is a guess.
 */
export function newestRelease(releases: readonly Release[]): Release | null {
  /* compareSemver answers null for anything it cannot parse, so comparing a
   * version with itself is the parse check - it is 0 for every real version. */
  const parseable = (v: string): boolean => compareSemver(v, v) !== null;
  let best: Release | null = null;
  for (const r of releases) {
    if (r.draft || !parseable(r.version)) continue;
    if (!best) {
      best = r;
      continue;
    }
    const cmp = compareSemver(r.version, best.version);
    if (cmp !== null && cmp > 0) best = r;
  }
  return best;
}

/**
 * Decide what to offer, given the current version and everything published.
 *
 * Returns null when there is nothing newer - including when the newest release
 * has no archive this machine can use, because an (U)pdate row that leads to
 * "there is no download for you" is worse than no row.
 */
export function decideUpdate(
  current: string,
  releases: readonly Release[],
  machine: Machine,
  channel: UpdateChannel,
): AvailableUpdate | null {
  const newest = newestRelease(releasesIn(channel, releases));
  if (!newest) return null;
  const cmp = compareSemver(newest.version, current);
  if (cmp === null || cmp === 0) return null;
  if (cmp < 0) {
    /*
     * Going BACKWARDS, which is refused by default and always has been: a
     * development build running against the released feed must not be offered
     * the last release as though it were an upgrade.
     *
     * Channels add exactly one case that rule did not contemplate. Someone on
     * `early` is deliberately ahead of every published release, so moving them
     * to `stable` or `beta` can only ever be a step back - and refusing it would
     * mean the channel they just chose reports "nothing to install" forever
     * while the game stays on a build that channel does not contain. Narrowed
     * to that: the installed build must be an edge build, and the chosen channel
     * must be one that excludes edge builds. A plain 0.18.0 dev version is still
     * never offered 0.17.0.
     */
    const leavingEarly = current.includes(EDGE_MARKER) && channel !== "early";
    if (!leavingEarly) return null;
  }
  const asset = pickAsset(newest.assets, machine);
  if (!asset) return null;
  return {
    version: newest.version,
    tag: newest.tag,
    url: newest.url,
    asset,
    older: cmp < 0,
  };
}

/** The shape of one release in GitHub's JSON, as far as we read it. */
interface ApiRelease {
  tag_name?: unknown;
  draft?: unknown;
  prerelease?: unknown;
  html_url?: unknown;
  assets?: unknown;
}

/** Normalise GitHub's JSON, dropping anything malformed rather than throwing. */
export function parseReleases(body: unknown): Release[] {
  if (!Array.isArray(body)) return [];
  const out: Release[] = [];
  for (const raw of body as ApiRelease[]) {
    if (raw === null || typeof raw !== "object") continue;
    const tag = typeof raw.tag_name === "string" ? raw.tag_name : "";
    if (!tag) continue;
    const assets: ReleaseAsset[] = [];
    if (Array.isArray(raw.assets)) {
      for (const a of raw.assets as Record<string, unknown>[]) {
        if (a === null || typeof a !== "object") continue;
        const name = typeof a["name"] === "string" ? a["name"] : "";
        const url = typeof a["browser_download_url"] === "string" ? a["browser_download_url"] : "";
        if (!name || !url) continue;
        const digest = typeof a["digest"] === "string" ? a["digest"] : null;
        assets.push({
          name,
          url,
          size: typeof a["size"] === "number" ? a["size"] : 0,
          sha256: digest !== null && digest.startsWith("sha256:") ? digest.slice(7) : null,
        });
      }
    }
    out.push({
      tag,
      /* `v0.16.0` -> `0.16.0`. Nothing else is stripped: a tag that is not a
       * version with an optional v is left alone and fails to parse later, which
       * is the honest outcome. */
      version: tag.startsWith("v") ? tag.slice(1) : tag,
      draft: raw.draft === true,
      prerelease: raw.prerelease === true,
      url: typeof raw.html_url === "string" ? raw.html_url : `https://github.com/${UPDATE_REPO}/releases/tag/${tag}`,
      assets,
    });
  }
  return out;
}

/** The updater half of the desktop preload bridge. */
export interface UpdaterBridge {
  update(op: string, arg?: unknown): Promise<unknown>;
  onUpdateProgress?(fn: (received: number, total: number) => void): () => void;
}

/**
 * Find the updater on the window, and DO NOT confuse it with the host bridge.
 *
 * THE BUG THIS FUNCTION EXISTS FOR. The preload exposes two globals: `neoHostFs`
 * is z-file.c and `neoDesktop` is "you are running under Electron", and the
 * updater is on the second. The first version of this feature read it off
 * `detectDesktopBridge()`, which returns `neoHostFs` - through an optional
 * property, so `bridge?.update` was simply `undefined`, the check returned null
 * every time, and the (U)pdate row could never appear.
 *
 * Nothing caught it. Sixty-odd unit tests passed, the typecheck passed, the
 * build passed; the feature was wired to an object that has never had the method
 * on it. It took launching the real app and photographing a title screen with no
 * row on it. So the lookup is a named function over a scope now, and the test
 * hands it the shape the preload really produces.
 */
export function updaterBridge(scope: unknown = globalThis): UpdaterBridge | null {
  if (scope === null || typeof scope !== "object") return null;
  const desktop = (scope as Record<string, unknown>)["neoDesktop"];
  if (desktop === null || typeof desktop !== "object") return null;
  const update = (desktop as Record<string, unknown>)["update"];
  if (typeof update !== "function") return null;
  return desktop as UpdaterBridge;
}

/** Everything the check needs from the outside world. */
export interface UpdateCheckDeps {
  readonly fetch: typeof globalThis.fetch;
  readonly machine: Machine;
  readonly current: string;
  readonly channel: UpdateChannel;
  readonly timeoutMs?: number;
  readonly repo?: string;
}

/**
 * Ask GitHub, once. Never throws; reports WHICH of the four outcomes happened.
 *
 * `per_page=20` because the answer is "the highest version among recent
 * releases" and the list is newest-first: twenty covers any plausible run of
 * hotfixes without paging, and paging to be sure would turn one request into
 * several.
 *
 * THE TIMEOUT IS A REAL FAILURE MODE, not a formality, and it is the one most
 * likely to be mistaken for currency. The check is started while the page is
 * still booting - loading mods, decoding tile packs - and the abort timer fires
 * on wall-clock time whether or not the main thread was free to read the
 * response. A heavy install can therefore lose a check that GitHub answered
 * perfectly well. Answering "timed out" rather than "you are up to date" is what
 * makes that visible, and pressing the key again after boot is what fixes it.
 */
export async function checkForUpdate(deps: UpdateCheckDeps): Promise<UpdateCheck> {
  const repo = deps.repo ?? UPDATE_REPO;
  const ctl = new AbortController();
  /* Recorded rather than sniffed out of the error: an abort and a dropped
   * connection both arrive here as a rejected fetch, and only this flag knows
   * which clock ran out. */
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctl.abort();
  }, deps.timeoutMs ?? UPDATE_TIMEOUT_MS);
  try {
    const res = await deps.fetch(`https://api.github.com/repos/${repo}/releases?per_page=20`, {
      signal: ctl.signal,
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) {
      const status = typeof res.status === "number" ? res.status : 0;
      /* 403 and 429 are both how GitHub says "too many requests from this
       * address this hour" to a caller with no credentials, and the game has
       * none on purpose. Named, because "GitHub answered 403" reads as a
       * permissions problem the player cannot fix, and an hour's wait is not
       * that. */
      return {
        ok: false,
        reason:
          status === 403 || status === 429
            ? `GitHub answered ${String(status)}, which is how it says too many requests have come from this network in the last hour. It clears on its own.`
            : `GitHub answered ${status === 0 ? "an error" : String(status)}.`,
      };
    }
    let body: unknown;
    try {
      body = await res.json();
    } catch {
      return { ok: false, reason: "GitHub's answer could not be read." };
    }
    return {
      ok: true,
      update: decideUpdate(deps.current, parseReleases(body), deps.machine, deps.channel),
    };
  } catch {
    return {
      ok: false,
      reason: timedOut
        ? "GitHub did not answer in time."
        : "GitHub could not be reached.",
    };
  } finally {
    clearTimeout(timer);
  }
}
