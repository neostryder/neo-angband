import { validateManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import { installedMods } from "../mod-install";
import { buildCatalog, defaultModStore, ModStore, type CatalogMod } from "../mod-store";
import { safeLaunch } from "../safe-launch";
import { defaultProfileStore } from "../profiles";
import type { DiscoveredMod } from "../mod-discover";
import type { ModManagerDeps } from "./classic-types";
import type { ModBrowseDeps, ModUpgradeDeps } from "./browse-types";
import { createModManagerService, type CoreModManager, type ModManagerService } from "./service";
import type { ConfirmationMod, ModManagerEnvironment } from "./types";

interface ClassicService {
  readonly service: ModManagerService;
  readonly core: CoreModManager;
}

const managers = new WeakMap<ModManagerDeps, ClassicService>();
const browsers = new WeakMap<ModBrowseDeps, ClassicService>();
const catalogCores = new WeakMap<CatalogMod, CoreModManager>();

function browsingEnvironment(deps: ModBrowseDeps): Pick<ModManagerEnvironment, "discover" | "curated" | "readManifest" | "install" | "stagePlan" | "stageRollback" | "previousVersion" | "releasePreviousVersions" | "restart" | "uninstall" | "consent" | "refreshUpdates"> {
  return {
    discover: deps.discover,
    curated: deps.curated,
    readManifest: async (mod) => validateManifest(JSON.parse(await deps.readRepoFile(mod.repo, mod.tag, "manifest.json"))),
    install: deps.install,
    ...(deps.stagePlan ? { stagePlan: deps.stagePlan } : {}),
    ...(deps.stageRollback ? { stageRollback: deps.stageRollback } : {}),
    ...(deps.previousVersion ? { previousVersion: deps.previousVersion } : {}),
    ...(deps.releasePreviousVersions ? { releasePreviousVersions: deps.releasePreviousVersions } : {}),
    ...(deps.restart ? { restart: deps.restart } : {}),
    uninstall: deps.uninstall,
    consent: deps.consent,
    ...("refresh" in deps ? { refreshUpdates: (deps as ModUpgradeDeps).refresh } : {}),
  };
}

export function classicManager(deps: ModManagerDeps): ClassicService {
  let manager = managers.get(deps);
  if (!manager) {
    manager = createModManagerService({
      store: deps.store,
      listCatalog: deps.listCatalog,
      installedMetadata: () => installedMods(globalThis),
      safeMode: safeLaunch,
      profile: () => {
        const profiles = defaultProfileStore();
        return profiles.list().find((p) => p.id === profiles.activeId()) ?? null;
      },
      ...(deps.rediscover ? { rediscover: deps.rediscover } : {}),
      ...(deps.isModNoscore ? { isModNoscore: deps.isModNoscore } : {}),
      ...(deps.advanceSaveRatchets ? { advanceSaveRatchets: deps.advanceSaveRatchets } : {}),
      ...(deps.applyRuleLive ? { applyRuleLive: deps.applyRuleLive } : {}),
      ...(deps.applySettingLive ? { applySettingLive: deps.applySettingLive } : {}),
      ...(deps.modBrowse ? browsingEnvironment(deps.modBrowse) : {}),
    });
    managers.set(deps, manager);
    if (deps.modBrowse) browsers.set(deps.modBrowse, manager);
  }
  return manager;
}

export function classicBrowser(deps: ModBrowseDeps): ClassicService {
  let manager = browsers.get(deps);
  if (!manager) {
    const store = deps.stagePlan ? defaultModStore() : new ModStore(null);
    manager = createModManagerService({
      store,
      listCatalog: () => buildCatalog({ content: [...deps.enabledManifests()], sandbox: [], trusted: [], enabled: store.getEnabled(), consents: store.getConsents() }),
      safeMode: safeLaunch,
      ...(deps.stagePlan ? { installedMetadata: () => installedMods(globalThis) } : {}),
      ...browsingEnvironment(deps),
    });
    browsers.set(deps, manager);
  }
  return manager;
}

export function classicCatalog(deps: ModManagerDeps): CatalogMod[] {
  const { service } = classicManager(deps);
  service.refreshState();
  const catalog = structuredClone(service.state.installed.map((m) => m.catalogMod)) as CatalogMod[];
  for (const mod of catalog) catalogCores.set(mod, classicManager(deps).core);
  return catalog;
}

export function catalogCore(mod: CatalogMod): CoreModManager | undefined {
  return catalogCores.get(mod);
}

export function confirmationMod(mod: Pick<CatalogMod, "id" | "name" | "version"> | DiscoveredMod): ConfirmationMod {
  return {
    id: mod.id, name: mod.name, version: mod.version,
    repository: "repo" in mod ? mod.repo : null,
    commit: "sha" in mod ? mod.sha ?? null : null,
    digests: null,
  };
}

export function permissionCore(deps: Pick<ModManagerDeps, "store">, mods: readonly CatalogMod[]): CoreModManager {
  if ("listCatalog" in deps) return classicManager(deps as ModManagerDeps).core;
  return createModManagerService({ store: deps.store, listCatalog: () => mods }).core;
}
