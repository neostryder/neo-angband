import { modStartGrants } from "../mod-tier";
import type { RepoRef } from "../mod-source";
import type { ConsentRecord } from "../mod-store";
import type { ModManagerService } from "./service";
import { refused } from "./confirmation";
import type { Immutable, InstallPlan, ManagerResult, ManagerState } from "./types";

export interface ManageAdapter {
  readonly snapshot: () => Immutable<ManagerState>;
  readonly subscribe: ModManagerService["subscribe"];
  readonly browse: ModManagerService["browse"];
  readonly search: ModManagerService["search"];
  readonly planInstall: (refs: readonly RepoRef[]) => Promise<ManagerResult<InstallPlan>>;
  readonly applyPlan: (id: number) => ManagerResult<unknown>;
  readonly recordConsent: (id: string, decisions: ConsentRecord) => ManagerResult<unknown>;
  readonly enable: (id: string) => ManagerResult<unknown>;
  readonly disable: ModManagerService["disable"];
  readonly update: (id: string) => Promise<ManagerResult<unknown>>;
  readonly updateAll: () => Promise<ManagerResult<unknown>>;
  readonly remove: (id: string) => Promise<ManagerResult<unknown>>;
  readonly rollback: (id: string) => Promise<ManagerResult<unknown>>;
  readonly restoreModList: (entries: Parameters<ModManagerService["restoreModList"]>[0], replace: boolean) => ManagerResult<unknown>;
  readonly reorder: ModManagerService["reorder"];
  readonly moveEnabled: ModManagerService["moveEnabled"];
  readonly setConflictOverride: ModManagerService["setConflictOverride"];
  readonly setSectionChoice: ModManagerService["setSectionChoice"];
  readonly setSettingValue: ModManagerService["setSettingValue"];
  readonly setThirdPartyConsent: (allow: boolean) => ManagerResult<unknown>;
}

export function createManageAdapter(service: ModManagerService, callerId: string): ManagerResult<ManageAdapter> {
  const allowed = (): boolean => {
    const grants = modStartGrants(callerId);
    return grants.firstParty?.manage === true && grants.granted.includes("mod:install");
  };
  if (!allowed()) return refused("first-party", "Only an allowlisted first-party mod can manage mods.");
  const check = <T>(body: () => ManagerResult<T>): ManagerResult<T> => allowed() ? body() : refused("first-party", "Only an allowlisted first-party mod can manage mods.");
  const checkAsync = async <T>(body: () => Promise<ManagerResult<T>>): Promise<ManagerResult<T>> => allowed() ? body() : refused("first-party", "Only an allowlisted first-party mod can manage mods.");
  return { status: "ok", value: Object.freeze<ManageAdapter>({
    snapshot: () => service.state,
    subscribe: service.subscribe.bind(service),
    browse: service.browse.bind(service),
    search: service.search.bind(service),
    planInstall: (refs) => checkAsync(() => service.planCatalogInstall(refs)),
    applyPlan: (id) => check(() => service.applyPlan(id, callerId)),
    recordConsent: (id, decisions) => check(() => service.recordConsent(id, decisions, callerId)),
    enable: (id) => check(() => service.enable(id, callerId)),
    disable: (id) => check(() => service.disable(id)),
    update: (id) => checkAsync(() => service.update(id, callerId)),
    updateAll: () => checkAsync(() => service.updateAll(callerId)),
    remove: (id) => checkAsync(() => service.remove(id, callerId)),
    rollback: (id) => checkAsync(() => service.rollback(id, callerId)),
    restoreModList: (entries, replace) => check(() => service.restoreModList(entries, replace, callerId)),
    reorder: (ids) => check(() => service.reorder(ids)),
    moveEnabled: (id, delta) => check(() => service.moveEnabled(id, delta)),
    setConflictOverride: (slot, winner) => check(() => service.setConflictOverride(slot, winner)),
    setSectionChoice: (id, section, on) => check(() => service.setSectionChoice(id, section, on)),
    setSettingValue: (id, setting, value) => check(() => service.setSettingValue(id, setting, value)),
    setThirdPartyConsent: (allow) => check(() => service.setThirdPartyConsent(allow, callerId)),
  }) };
}
