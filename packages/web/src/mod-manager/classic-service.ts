import { validateManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import { archivedManifest, archivedMod, archivedSavedMod, archivedVersions, installedMods, restoreArchivedVersion, restoreInstallations } from "../mod-install";
import { installBlocked } from "../mod-consent";
import { originConflict } from "../mod-source";
import { buildCatalog, ModStore, type CatalogMod } from "../mod-store";
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

function browsingEnvironment(deps: ModBrowseDeps): Pick<ModManagerEnvironment, "discover" | "curated" | "readManifest" | "install" | "uninstall" | "consent" | "refreshUpdates"> {
  return {
    discover: async (ref) => {
      const cached = await archivedMod(ref);
      return cached ? { ok: true, ref, mod: cached.mod } : deps.discover(ref);
    },
    curated: deps.curated,
    readManifest: async (mod) => (await archivedMod({ repo: mod.repo, tag: mod.tag.startsWith("archive:") ? mod.tag : mod.sha ?? mod.tag }))?.manifest ?? validateManifest(JSON.parse(await deps.readRepoFile(mod.repo, mod.tag, "manifest.json"))),
    install: async (mod, origin, progress) => {
      const cached = await archivedMod({ repo: mod.repo, tag: mod.tag.startsWith("archive:") ? mod.tag : mod.sha ?? mod.tag });
      if (!cached) return deps.install(mod, origin, progress);
      const blocked = installBlocked(origin, deps.consent.read()) ?? originConflict((await installedMods()).find((m) => m.id === mod.id) ?? null, mod.repo);
      return blocked ? { ok: false, problem: blocked } : restoreArchivedVersion(cached.meta);
    },
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
      ...(deps.look ? { look: deps.look } : {}),
      saveReferences: deps.saveReferences ?? (() => false),
      restoreInstallations: (previous) => restoreInstallations(previous),
      discoverSavedVersion: async (saved) => {
        const cached = await archivedSavedMod(saved);
        return cached ? { ok: true, ref: { repo: cached.mod.repo, tag: cached.mod.tag }, mod: cached.mod } : null;
      },
      conflictOverrides: { read: () => deps.store.getConflictOverrides(), write: (slot, winner) => deps.store.setConflictOverride(slot, winner) },
      previousVersion: async (id) => {
        const current = (await installedMods()).find((m) => m.id === id);
        const previous = [...await archivedVersions()].reverse().find((m) => m.id === id && (m.sha !== current?.sha || m.tag !== current?.tag || JSON.stringify(m.digests) !== JSON.stringify(current?.digests)));
        if (!previous) return null;
        const manifest = await archivedManifest(previous);
        if (!manifest) return null;
        const cached = await archivedSavedMod({ id, name: manifest.name, version: manifest.version, repository: previous.repo, tag: previous.tag, commit: previous.sha ?? null, payloadDigest: previous.digests ? { ...previous.digests } : null, api: manifest.api ?? "*", settings: {}, sections: {} });
        return cached ? { ok: true, ref: { repo: cached.mod.repo, tag: cached.mod.tag }, mod: cached.mod } : null;
      },
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
    const store = new ModStore(null);
    manager = createModManagerService({
      store,
      listCatalog: () => buildCatalog({ content: [...deps.enabledManifests()], sandbox: [], trusted: [], enabled: store.getEnabled(), consents: store.getConsents() }),
      safeMode: safeLaunch,
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
