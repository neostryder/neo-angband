import type { DeclaredConflict, PackManifest, SortPin, SaveModList } from "@rpgm-tools/neo-angband-mod-sdk";
import type { CatalogMod, ConsentRecord, ModStore } from "../mod-store";
import type { ModTier } from "../mod-tier";
import type { DiscoveredMod } from "../mod-discover";
import type { InstalledModMeta, InstallProgress, InstallResult } from "../mod-install";
import type { ModOrigin } from "../mod-consent";
import type { RepoRef } from "../mod-source";
import type { ModRegistry } from "../mod-curated";
import type { ModRefresh } from "../mod-refresh";
import type { ProfileMeta } from "../profiles";
import type { BrowseEntry } from "./browse-types";
import type { StageResult } from "../mod-transactions";
import type { LookStore } from "../look-state";

export type Immutable<T> = T extends object ? { readonly [K in keyof T]: Immutable<T[K]> } : T;

export type ManagerResult<T = null> =
  | { readonly status: "ok"; readonly value: T }
  | { readonly status: "refused"; readonly code: string; readonly reason: string }
  | { readonly status: "confirmation"; readonly confirmation: PendingConfirmation };

export type ManagementOperation = "install" | "enable" | "disable" | "update" | "remove" | "restore" | "rollback" | "permissions" | "third-party" | "sideload";

export interface PermissionConfirmation {
  readonly modId: string;
  readonly capability: string;
  readonly consentText: string;
  readonly withoutIt: string | null;
  readonly canRunWithout: boolean;
}

export interface ConfirmationMod {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly repository: string | null;
  readonly commit: string | null;
  readonly digests: Readonly<Record<string, string>> | null;
}

export interface PendingConfirmation {
  readonly planId?: number;
  readonly downloads?: readonly { readonly name: string; readonly version: string; readonly bytes: number | null }[];
  readonly id: number;
  readonly operation: ManagementOperation;
  readonly requestedBy: string | null;
  readonly mods: readonly ConfirmationMod[];
  readonly permissions: readonly PermissionConfirmation[];
  readonly riskNotice: readonly string[];
  readonly conflicts: readonly DeclaredConflict[];
}

export interface PlannedDownload {
  readonly mod: DiscoveredMod;
  readonly manifest: PackManifest;
  readonly origin: ModOrigin;
  readonly bytes: number | null;
  readonly files: readonly string[];
}

export interface InstallPlan {
  readonly id: number;
  readonly operation: "install" | "update" | "rollback" | "restore";
  readonly downloads: readonly PlannedDownload[];
  readonly newGrants: readonly PermissionConfirmation[];
  readonly conflicts: readonly DeclaredConflict[];
  readonly enableIds?: readonly string[];
  readonly installedSet?: readonly InstalledModMeta[];
}

export interface ModListRestorePlan extends InstallPlan {
  readonly modList: SaveModList;
  readonly unavailable: readonly { readonly id: string; readonly name: string }[];
  readonly revision: string;
}

export interface ManagedMod {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly repository: string | null;
  readonly commit: string | null;
  readonly digests: Readonly<Record<string, string>> | null;
  readonly tier: ModTier | null;
  readonly enabled: boolean;
  readonly loadOrder: number | null;
  readonly pins: readonly SortPin[];
  readonly sectionChoices: Readonly<Record<string, boolean>>;
  readonly settings: Readonly<Record<string, number>>;
  readonly consent: ConsentRecord;
  readonly consentVersion: string | null;
  readonly catalogMod: CatalogMod;
}

export interface ManagerState {
  readonly revision: number;
  readonly installed: readonly ManagedMod[];
  readonly loadOrder: readonly string[];
  readonly orderPins: readonly SortPin[];
  readonly conflictOverrides: Readonly<Record<string, string>>;
  readonly ruleChoices: Readonly<Record<string, boolean>>;
  readonly catalog: {
    readonly curated: readonly BrowseEntry[];
    readonly community: readonly BrowseEntry[];
    readonly sideloads: readonly BrowseEntry[];
    readonly problems: readonly string[];
  };
  readonly pendingPlans: readonly InstallPlan[];
  readonly staged: boolean;
  readonly installStatus: string | null;
  readonly canRestart: boolean;
  readonly pendingConfirmation: PendingConfirmation | null;
  readonly updates: readonly ModRefresh[];
  readonly thirdPartyAllowed: boolean;
  readonly safeMode: boolean;
  readonly profile: ProfileMeta | null;
  readonly modList: readonly { readonly id: string; readonly version: string; readonly enabled: boolean }[];
}

export interface ModManagerEnvironment {
  readonly store: ModStore;
  readonly look?: LookStore;
  readonly listCatalog: () => readonly CatalogMod[];
  readonly rediscover?: () => Promise<void>;
  readonly installedMetadata?: () => Promise<readonly InstalledModMeta[]>;
  readonly discover?: (ref: RepoRef) => Promise<BrowseEntry>;
  readonly discoverSavedVersion?: (mod: SaveModList["mods"][number]) => Promise<BrowseEntry | null>;
  readonly curated?: () => Promise<{ readonly registry: ModRegistry | null; readonly problem: string | null }>;
  readonly readManifest?: (mod: DiscoveredMod) => Promise<PackManifest>;
  readonly resolveDependency?: (id: string, range: string) => Promise<BrowseEntry>;
  readonly install?: (mod: DiscoveredMod, origin: ModOrigin, onProgress: (progress: InstallProgress) => void) => Promise<InstallResult>;
  readonly stagePlan?: (plan: InstallPlan, permissions: Readonly<Record<string, ConsentRecord>>, progress?: (progress: InstallProgress) => void) => Promise<StageResult>;
  readonly stageRollback?: (id: string) => Promise<StageResult>;
  readonly releasePreviousVersions?: (id: string, saveReferences: (id: string, tag: string) => boolean) => Promise<boolean>;
  readonly restart?: () => void;
  readonly uninstall?: (id: string) => Promise<boolean>;
  readonly refreshUpdates?: () => Promise<readonly ModRefresh[]>;
  readonly consent?: { readonly read: () => boolean; readonly write: (allow: boolean) => boolean };
  readonly safeMode?: () => boolean;
  readonly profile?: () => ProfileMeta | null;
  readonly saveReferences?: (id: string, tag?: string) => boolean;
  readonly isModNoscore?: () => boolean;
  readonly advanceSaveRatchets?: (mod: CatalogMod) => void;
  readonly applyRuleLive?: (flag: string, on: boolean) => void;
  readonly applySettingLive?: (modId: string, settingId: string) => void;
  readonly conflictOverrides?: {
    readonly read: () => Readonly<Record<string, string>>;
    readonly write: (slot: string, winner: string | null) => boolean;
  };
  readonly previousVersion?: (id: string) => Promise<BrowseEntry | null>;
  readonly restoreInstallations?: (previous: readonly { readonly id: string; readonly meta: InstalledModMeta | null }[]) => Promise<boolean>;
}

export interface ConfirmationDecision {
  readonly accepted: boolean;
  readonly permissions?: Readonly<Record<string, ConsentRecord>>;
}
