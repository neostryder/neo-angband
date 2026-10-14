import type { DeclaredConflict } from "../contested.js";
import type { SortPin } from "../sort.js";
import type { PackCompat, PackManifest } from "../manifest.js";
import type { CapabilityTier } from "../capability-vocabulary.js";
import type { JsonValue } from "../compose.js";
import type { Api2Call } from "./result.js";

type ModConflict = Omit<DeclaredConflict, "scope"> & { readonly scope?: readonly string[] };
type ReadonlyData<T> = T extends object ? { readonly [K in keyof T]: ReadonlyData<T[K]> } : T;

export interface Api2KeyValueStore {
  get(key: string): Api2Call<JsonValue | null>;
  set(key: string, value: JsonValue | null): Api2Call<null>;
  keys(): Api2Call<readonly string[]>;
}

export interface Api2SaveEntry {
  readonly id: string;
  readonly name: string;
  readonly race: string;
  readonly cls: string;
  readonly level: number;
  readonly depth: number;
  readonly dead: boolean;
  readonly lastPlayed: number;
}

export interface Api2CreateCharacter {
  readonly like?: {
    readonly race: string;
    readonly cls: string;
    readonly name?: string;
    readonly stats?: readonly number[];
  };
  readonly resumeAutoplayer?: boolean;
}

export interface Api2ProfileAction {
  readonly kind: "create-character";
  readonly armController?: boolean;
}

export interface Api2Saves {
  list(): Api2Call<readonly Api2SaveEntry[]>;
  create(options?: Api2CreateCharacter): Api2Call<null>;
  load(id: string): Api2Call<null>;
  rename(id: string, name: string): Api2Call<null>;
  delete(id: string): Api2Call<null>;
}

export interface Api2OptionsView {
  readonly entries: readonly {
    readonly name: string;
    readonly description: string;
    readonly page: string;
    readonly value: boolean;
    readonly writable: boolean;
  }[];
  readonly hitpointWarn: number;
  readonly delayFactor: number;
  readonly lazymoveDelay: number;
}

export interface Api2OptionsChange {
  readonly values?: Readonly<Record<string, boolean>>;
  readonly hitpointWarn?: number;
  readonly delayFactor?: number;
  readonly lazymoveDelay?: number;
}

export interface Api2ManagedOptions {
  get(): Api2Call<Api2OptionsView>;
  set(change: Api2OptionsChange): Api2Call<readonly string[]>;
}

export type Api2Keyset = "original" | "roguelike";

export interface Api2KeymapEntry {
  readonly trigger: string;
  readonly action: string;
  readonly owner: string | null;
}

export interface Api2GameCommand {
  readonly id: string;
  readonly name: string;
  readonly group: string;
  readonly keys: Readonly<Record<Api2Keyset, string | null>>;
  readonly control: string | null;
}

export interface Api2ManagedKeys {
  keyset(): Api2Call<Api2Keyset>;
  list(keyset?: Api2Keyset): Api2Call<readonly Api2KeymapEntry[]>;
  set(trigger: string, action: string, keyset?: Api2Keyset, replace?: boolean): Api2Call<null>;
  remove(trigger: string, keyset?: Api2Keyset): Api2Call<null>;
  commands(): Api2Call<readonly Api2GameCommand[]>;
  capture(): Api2Call<string | null>;
  cancelCapture(): Api2Call<boolean>;
}

export interface Api2ManagerConfirmation {
  readonly id: number;
  readonly operation: string;
  readonly requestedBy: string | null;
  readonly mods: readonly {
    readonly id: string;
    readonly name: string;
    readonly version: string;
    readonly repository: string | null;
    readonly commit: string | null;
    readonly digests: Readonly<Record<string, string>> | null;
  }[];
  readonly permissions: readonly {
    readonly modId: string;
    readonly capability: string;
    readonly consentText: string;
    readonly withoutIt: string | null;
    readonly canRunWithout: boolean;
  }[];
  readonly riskNotice: readonly string[];
  readonly conflicts: readonly ModConflict[];
}

export interface Api2ModReference {
  readonly repo: string;
  readonly tag?: string;
}

export type Api2BrowseEntry =
  | { readonly ok: false; readonly ref: Api2ModReference; readonly problem: string }
  | { readonly ok: true; readonly ref: Api2ModReference; readonly mod: Api2DiscoveredMod };

export interface Api2EngineHeld {
  readonly tag: string;
  readonly version: string | null;
  readonly engine: string | null;
  readonly why: string;
  readonly newerGameHelps: boolean | null;
}

export interface Api2DiscoveredMod {
  readonly repo: string;
  readonly tag: string;
  readonly tags: readonly string[];
  readonly id: string;
  readonly name: string;
  readonly author: string | null;
  readonly version: string;
  readonly description: string | null;
  readonly engine: string | null;
  readonly screenshots: readonly string[];
  readonly license?: string | null;
  readonly capabilities?: readonly string[];
  readonly compat?: readonly ReadonlyData<PackCompat>[];
  readonly compatible: boolean;
  readonly engineNote: string | null;
  readonly channelHeld: string | null;
  readonly engineHeld: Api2EngineHeld | null;
  readonly versionsChecked?: number;
  readonly payload: readonly { readonly kind: "file" | "archive"; readonly path: string }[];
  readonly bytes: number | null;
  readonly guessedPayload: boolean;
  readonly sha?: string | null;
}

export interface Api2ManagerCatalog {
  readonly curated: readonly Api2BrowseEntry[];
  readonly community: readonly Api2BrowseEntry[];
  readonly sideloads: readonly Api2BrowseEntry[];
  readonly problems: readonly string[];
}

export interface Api2InstallPlan {
  readonly id: number;
  readonly operation: "install" | "update" | "rollback" | "restore";
  readonly downloads: readonly {
    readonly mod: Api2DiscoveredMod;
    readonly manifest: ReadonlyData<PackManifest>;
    readonly origin: "curated" | "third-party";
    readonly bytes: number | null;
    readonly files: readonly string[];
  }[];
  readonly newGrants: Api2ManagerConfirmation["permissions"];
  readonly conflicts: readonly ModConflict[];
}

export interface Api2ManagerState {
  readonly revision: number;
  readonly installed: readonly {
    readonly id: string;
    readonly name: string;
    readonly version: string;
    readonly repository: string | null;
    readonly commit: string | null;
    readonly digests: Readonly<Record<string, string>> | null;
    readonly enabled: boolean;
    readonly loadOrder: number | null;
    readonly pins: readonly SortPin[];
    readonly sectionChoices: Readonly<Record<string, boolean>>;
    readonly settings: Readonly<Record<string, number>>;
    readonly consent: Api2Consent;
    readonly consentVersion: string | null;
    readonly tier: Api2ModTier | null;
    readonly catalogMod: Api2CatalogMod;
  }[];
  readonly loadOrder: readonly string[];
  readonly orderPins: readonly SortPin[];
  readonly conflictOverrides: Readonly<Record<string, string>>;
  readonly ruleChoices: Readonly<Record<string, boolean>>;
  readonly catalog: Api2ManagerCatalog;
  readonly pendingPlans: readonly Api2InstallPlan[];
  readonly pendingConfirmation: Api2ManagerConfirmation | null;
  readonly thirdPartyAllowed: boolean;
  readonly safeMode: boolean;
  readonly profile: { readonly id: string | null; readonly name: string; readonly createdAt: number } | null;
  readonly modList: readonly { readonly id: string; readonly version: string; readonly enabled: boolean }[];
  readonly updates: readonly {
    readonly id: string;
    readonly name?: string;
    readonly repo: string;
    readonly installed: string;
    readonly newest: string | null;
    readonly standing: string;
    readonly problem: string | null;
    readonly channelHeld: string | null;
    readonly engineHeld: Api2EngineHeld | null;
  }[];
}

export interface Api2ModTier {
  readonly trust: "first-party" | "reviewed" | "listed" | "sideloaded";
  readonly execution: "data" | "worker" | "in-process";
  readonly capabilityTier: CapabilityTier;
  readonly seams: readonly string[];
  readonly marksSave: readonly string[];
  readonly why: string;
}

export interface Api2CatalogMod {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly shape: string;
  readonly kind: "content" | "sandbox" | "trusted";
  readonly manifest: ReadonlyData<PackManifest>;
  readonly enabled: boolean;
  readonly capabilities: readonly string[];
  readonly nondeterministic: boolean;
  readonly affectsGameplay: boolean;
  readonly consented: boolean;
  readonly granted: readonly string[];
  readonly missing?: boolean;
  readonly session?: boolean;
  readonly installedByModId?: string;
  readonly refused?: readonly string[];
  readonly tierRefused?: readonly { readonly capability: string; readonly why: string }[];
  readonly tier?: Api2ModTier;
  readonly unreviewed?: boolean;
}

export interface Api2Consent {
  readonly granted: readonly string[];
  readonly refused: readonly string[];
}

export interface Api2ManagedMods {
  snapshot(): Api2Call<Api2ManagerState>;
  subscribe(listener: (state: Api2ManagerState) => void): Api2Call<{ readonly id: string }>;
  unsubscribe(subscription: { readonly id: string }): Api2Call<null>;
  browse(): Api2Call<Api2ManagerCatalog>;
  search(query: string): Api2Call<readonly Api2BrowseEntry[]>;
  discover(ref: Api2ModReference): Api2Call<Api2BrowseEntry>;
  refresh(): Api2Call<Api2ManagerState>;
  planInstall(refs: readonly Api2ModReference[]): Api2Call<Api2InstallPlan>;
  applyPlan(id: number): Api2Call<Api2ManagerConfirmation | null>;
  recordConsent(id: string, decisions: Api2Consent): Api2Call<Api2ManagerConfirmation | null>;
  enable(id: string): Api2Call<Api2ManagerConfirmation | null>;
  disable(id: string): Api2Call<Api2ManagerConfirmation | null>;
  update(id: string): Api2Call<Api2ManagerConfirmation | null>;
  updateAll(): Api2Call<Api2ManagerConfirmation | null>;
  remove(id: string): Api2Call<Api2ManagerConfirmation | null>;
  rollback(id: string): Api2Call<Api2ManagerConfirmation | null>;
  restoreModList(entries: readonly { readonly id: string; readonly enabled: boolean; readonly flags?: Readonly<Record<string, boolean>> }[], replace: boolean): Api2Call<Api2ManagerConfirmation | null>;
  reorder(ids: readonly string[]): Api2Call<Api2ManagerConfirmation | null>;
  moveEnabled(id: string, delta: -1 | 1): Api2Call<Api2ManagerConfirmation | null>;
  setConflictOverride(slot: string, winner: string | null): Api2Call<Api2ManagerConfirmation | null>;
  setSectionChoice(id: string, section: string, on: boolean): Api2Call<Api2ManagerConfirmation | null>;
  setSettingValue(id: string, setting: string, value: number): Api2Call<Api2ManagerConfirmation | null>;
  setThirdPartyConsent(allow: boolean): Api2Call<Api2ManagerConfirmation | null>;
}

export type Api2WizardOutcome = { readonly ok: true; readonly did: string } | { readonly ok: false; readonly problem: string };

export interface Api2WizardEntry {
  readonly name: string;
  readonly index: number;
  readonly level: number;
  readonly from?: string;
}

export interface Api2Wizard {
  sandboxed(): boolean;
  attached(): { readonly name: string } | null;
  sandbox(): Api2WizardOutcome;
  catalogue(): {
    readonly items: readonly Api2WizardEntry[];
    readonly creatures: readonly Api2WizardEntry[];
    readonly artifacts: readonly Api2WizardEntry[];
  };
  where(): {
    readonly depth: number;
    readonly maxDepth: number;
    readonly level: number;
    readonly experience: number;
    readonly gold: number;
    readonly stats: readonly { readonly name: string; readonly value: number }[];
  } | null;
  spawnItem(which: number | string, quantity?: number): Api2WizardOutcome;
  spawnCreature(which: number | string, quantity?: number): Api2WizardOutcome;
  spawnArtifact(which: number | string): Api2WizardOutcome;
  goToDepth(depth: number): Api2WizardOutcome;
  grantExperience(amount: number): Api2WizardOutcome;
  setExperience(value: number): Api2WizardOutcome;
  setGold(value: number): Api2WizardOutcome;
  setStat(stat: string, value: number): Api2WizardOutcome;
  maxOut(): Api2WizardOutcome;
  heal(): Api2WizardOutcome;
  rerollLife(): Api2WizardOutcome;
  acquire(quantity: number, great?: boolean): Api2WizardOutcome;
  summonRandom(quantity: number): Api2WizardOutcome;
  banish(range?: number): Api2WizardOutcome;
  killVisible(): Api2WizardOutcome;
  teleport(range: number): Api2WizardOutcome;
  mapLevel(): Api2WizardOutcome;
  lightLevel(): Api2WizardOutcome;
  findCreatures(): Api2WizardOutcome;
  learnItems(upTo?: number): Api2WizardOutcome;
  learnCreatures(): Api2WizardOutcome;
}
