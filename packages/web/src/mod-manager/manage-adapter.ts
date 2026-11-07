import { modStartGrants } from "../mod-tier";
import type { RepoRef } from "../mod-source";
import type { ConsentRecord } from "../mod-store";
import type { ModManagerService } from "./service";
import { consentBinding } from "../mod-consent-binding";
import { immutable, refused } from "./confirmation";
import type { Immutable, InstallPlan, ManagerResult, ManagerState } from "./types";

export interface ManageAdapter {
  readonly snapshot: () => Immutable<ManagerState>;
  readonly subscribe: ModManagerService["subscribe"];
  readonly browse: ModManagerService["browse"];
  readonly search: ModManagerService["search"];
  readonly discover: ModManagerService["discover"];
  readonly refresh: ModManagerService["refresh"];
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

export async function workerManageOperation(
  service: ModManagerService,
  callerId: string,
  method: string,
  args: readonly import("../mod-worker/protocol").WorkerJson[],
  confirm: (plan: string) => Promise<boolean>,
  current: () => boolean,
): Promise<ManagerResult<unknown>> {
  const binding = consentBinding(callerId);
  if (typeof binding !== "string") return refused("unmeasured", "This mod has no measured permission binding.");
  if (!current()) return refused("revoked", "The management request is no longer authorized.");
  const own = service.state.installed.find((mod) => mod.id === callerId);
  if (!own) return refused("missing", "This mod is not installed.");
  if (method === "snapshot") return { status: "ok", value: immutable({ id: own.id, name: own.name }) };
  if (["disable", "setSettingValue", "setSectionChoice"].includes(method) && args[0] !== callerId) return refused("identity", "A Worker can only change its own mod configuration.");
  if (method === "setConflictOverride" && args[1] !== callerId) return refused("identity", "A Worker can only request its own conflict selection.");
  if (method === "setConflictOverride" && !Object.hasOwn(service.state.conflictOverrides, args[0] as string) && Object.keys(service.state.conflictOverrides).length >= 64) return refused("quota", "The conflict override limit has been reached.");
  if (method === "setThirdPartyConsent" && args[0] !== false) return refused("host-only", "Only the player can allow third-party code.");
  if (!["disable", "setSettingValue", "setSectionChoice", "setConflictOverride", "setThirdPartyConsent"].includes(method)) return refused("host-only", "This management operation has no Worker mechanism.");
  const configuration = service.workerConfiguration();
  const plan = JSON.stringify({ id: own.id, name: own.name, operation: method, args });
  if (!(await confirm(plan))) return refused("cancelled", "The mod operation was cancelled.");
  if (!current() || binding !== consentBinding(callerId) || configuration !== service.workerConfiguration()) return refused("changed", "The management plan changed. Review it again.");
  switch (method) {
    case "disable": return service.disable(callerId);
    case "setSettingValue": return service.setSettingValue(callerId, args[1] as string, args[2] as number);
    case "setSectionChoice": return service.setSectionChoice(callerId, args[1] as string, args[2] as boolean);
    case "setConflictOverride": return service.setConflictOverride(args[0] as string, callerId);
    case "setThirdPartyConsent": return service.setThirdPartyConsent(false);
    default: return refused("host-only", "This management operation has no Worker mechanism.");
  }
}

export function createManageAdapter(service: ModManagerService, callerId: string): ManagerResult<ManageAdapter> {
  const snapshot = (state: Immutable<ManagerState>): Immutable<ManagerState> => immutable({
    ...state,
    installed: state.installed.map((mod) => ({ ...mod, digests: null, settings: {}, sectionChoices: {}, pins: [], consent: { granted: [], refused: [] }, consentVersion: null,
      catalogMod: { ...mod.catalogMod, granted: [], refused: [], consented: false } })),
    orderPins: [], conflictOverrides: {}, ruleChoices: {}, pendingPlans: [], pendingConfirmation: null,
  });
  const allowed = (): boolean => {
    const grants = modStartGrants(callerId);
    return grants.firstParty?.manage === true && grants.granted.includes("mod:install");
  };
  if (!allowed()) return refused("first-party", "Only an allowlisted first-party mod can manage mods.");
  const check = <T>(body: () => ManagerResult<T>): ManagerResult<T> => allowed() ? body() : refused("first-party", "Only an allowlisted first-party mod can manage mods.");
  const checkAsync = async <T>(body: () => Promise<ManagerResult<T>>): Promise<ManagerResult<T>> => allowed() ? body() : refused("first-party", "Only an allowlisted first-party mod can manage mods.");
  return { status: "ok", value: Object.freeze<ManageAdapter>({
    snapshot: () => snapshot(service.state),
    subscribe: (listener) => service.subscribe((state) => { if (allowed()) listener(snapshot(state)); }),
    browse: service.browse.bind(service),
    search: service.search.bind(service),
    discover: (ref) => checkAsync(() => service.discover(ref)),
    refresh: () => checkAsync(async () => {
      const result = await service.refresh();
      return result.status === "ok" ? { status: "ok", value: snapshot(result.value) } : result;
    }),
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
    setThirdPartyConsent: () => refused("host-only", "Only the player can change third-party consent."),
  }) };
}
