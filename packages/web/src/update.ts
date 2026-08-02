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
 * The check is one request with a short timeout and every failure is silent:
 * no shimmer, no message. A game that cannot reach GitHub is not broken, and a
 * player who is offline did not ask a question.
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
): AvailableUpdate | null {
  const newest = newestRelease(releases);
  if (!newest) return null;
  const cmp = compareSemver(newest.version, current);
  if (cmp === null || cmp <= 0) return null;
  const asset = pickAsset(newest.assets, machine);
  if (!asset) return null;
  return { version: newest.version, tag: newest.tag, url: newest.url, asset };
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
  readonly timeoutMs?: number;
  readonly repo?: string;
}

/**
 * Ask GitHub, once. Resolves null on ANY failure - offline, rate-limited,
 * malformed, timed out, or simply up to date.
 *
 * `per_page=20` because the answer is "the highest version among recent
 * releases" and the list is newest-first: twenty covers any plausible run of
 * hotfixes without paging, and paging to be sure would turn one silent request
 * into several.
 */
export async function checkForUpdate(deps: UpdateCheckDeps): Promise<AvailableUpdate | null> {
  const repo = deps.repo ?? UPDATE_REPO;
  const ctl = new AbortController();
  const timer = setTimeout(() => {
    ctl.abort();
  }, deps.timeoutMs ?? UPDATE_TIMEOUT_MS);
  try {
    const res = await deps.fetch(`https://api.github.com/repos/${repo}/releases?per_page=20`, {
      signal: ctl.signal,
      headers: { Accept: "application/vnd.github+json" },
    });
    if (!res.ok) return null;
    return decideUpdate(deps.current, parseReleases(await res.json()), deps.machine);
  } catch {
    /* A failed update check is not an error the player asked about. */
    return null;
  } finally {
    clearTimeout(timer);
  }
}
