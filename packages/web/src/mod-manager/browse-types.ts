import { type RepoRef } from "../mod-source";
import { type DiscoveredMod } from "../mod-discover";
import { type ModOrigin } from "../mod-consent";
import { type InstallProgress, type InstallResult } from "../mod-install";
import { type ModRegistry } from "../mod-curated";
import { type AuthorRegister } from "../mod-authors";
import { type ZipImportDeps } from "../mod-zip-source";
import { type PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import { type ModRefresh } from "../mod-refresh";
import type { ModManagerEnvironment } from "./types";

/** One mod, discovered or not, ready to be a row. */
export type BrowseEntry =
  | { readonly ok: true; readonly ref: RepoRef; readonly mod: DiscoveredMod }
  | { readonly ok: false; readonly ref: RepoRef; readonly problem: string };

/** Everything the screen needs, injected so the tests need no network and no IndexedDB. */
export interface ModBrowseDeps {
  readonly stagePlan?: ModManagerEnvironment["stagePlan"];
  readonly stageRollback?: ModManagerEnvironment["stageRollback"];
  readonly previousVersion?: ModManagerEnvironment["previousVersion"];
  readonly releasePreviousVersions?: ModManagerEnvironment["releasePreviousVersions"];
  readonly saveReferences?: ModManagerEnvironment["saveReferences"];
  readonly restart?: () => void;
  /** id -> installed tag, for every mod already installed from a repository. */
  readonly installed: () => Promise<ReadonlyMap<string, string>>;
  /** Discover one repository. Wired to discoverMod, with the player's channel. */
  readonly discover: (ref: RepoRef) => Promise<BrowseEntry>;
  /** Install a discovered mod. Enforces consent itself; see mod-install.ts. */
  readonly install: (
    mod: DiscoveredMod,
    origin: ModOrigin,
    onProgress: (p: InstallProgress) => void,
  ) => Promise<InstallResult>;
  readonly uninstall: (id: string) => Promise<boolean>;
  /** The curated list, or the problem reading it. */
  readonly curated: () => Promise<{ registry: ModRegistry | null; problem: string | null }>;
  /** Somebody else's list, by address. */
  readonly registryAt: (
    url: string,
  ) => Promise<{ registry: ModRegistry | null; problem: string | null }>;
  /** The author register, or null when it could not be read - which decides nothing. */
  readonly authors: () => Promise<AuthorRegister | null>;
  readonly consent: {
    readonly read: () => boolean;
    /** False when the answer could not be recorded, which must be reported. */
    readonly write: (allow: boolean) => boolean;
  };
  /**
   * Enable a freshly-installed mod when the player chose the combined action.
   * The owner still runs capability, conflict, and no-score gates before it can
   * return true; this is deliberately not a shortcut around those decisions.
   */
  readonly offerEnable?: (id: string) => Promise<boolean>;
  /**
   * The common first-install route returns to its owner once its outcome has
   * been read, so the owner can offer the one reload that makes the staged mod
   * run. Other routes leave this absent and keep browsing as before.
   */
  readonly leaveAfterEnabledInstall?: () => boolean;
  /**
   * The manager-owned bulk enable path. It owns live rules, sections, save
   * ratchets, and the one combined capability approval for recommended mods.
   */
  readonly applyRecommended?: (ids: readonly string[], enableAllOptions: boolean) => Promise<boolean>;
  /**
   * Importing a mod from an archive. Absent where no file can be read at all.
   *
   * The fourth door, and the only one that does not end in a repository - see
   * mod-zip-source.ts for why its two halves are not the same door.
   */
  readonly importZip?: ZipImportDeps;
  /**
   * The player's currently enabled content manifests, for the repository
   * door's pre-install summary (mod-preinstall.ts): what a candidate conflicts
   * with, and whether a record it patches belongs to something enabled.
   * Synchronous because the live implementation is a glob over already-loaded
   * data (pack.ts's discoverContentModManifests), not a fetch.
   */
  readonly enabledManifests: () => readonly PackManifest[];
  /**
   * Read one raw file from a mod's repository at its pinned tag - the
   * repository door's pre-install content scan. Rejects on anything that is
   * not a readable 2xx body; a per-file failure is caught by the caller and
   * reported as "could not be checked" rather than losing the whole summary.
   */
  readonly readRepoFile: (repo: string, tag: string, path: string) => Promise<string>;
}

/** ModBrowseDeps plus the one thing the update screen needs of its own. */
export interface ModUpgradeDeps extends ModBrowseDeps {
  /** Ask every installed mod's own repository where it stands (mod-refresh.ts). */
  readonly refresh: () => Promise<readonly ModRefresh[]>;
}
