import type { CapabilitySet, PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import { parseDocument, profileActionFormat, profileOwnerFormat, serializeDocument } from "@rpgm-tools/neo-angband-mod-sdk";
import type { ModProfile, ModProfileAction, ModProfiles, ProfileResult, SaveResult } from "./mod-plugin";
import { consentSatisfied, ModStore, MOD_SETTINGS_STORAGE_KEY, MOD_STATE_STORAGE_KEY } from "./mod-store";
import { copyScopedStorage, scopedStorage, type ScopedStorage } from "./profile-scope";
import type { ProfileStorage, ProfileStore } from "./profiles";

const OWNER_KEY = "neo-angband:profile-owner";
export const PROFILE_ACTION_KEY = "neo-angband:profile-action";

export interface PendingProfileAction {
  readonly profileId: string | null;
  readonly modId: string;
  readonly action: ModProfileAction;
}

export interface ProfileRuntimeDeps {
  readonly store: ProfileStore;
  readonly storage: ScopedStorage | null;
  readonly pendingStorage: ProfileStorage | null;
  readonly installed: () => readonly PackManifest[];
  readonly hasController: (id: string) => boolean;
  readonly reload: () => void;
  readonly canSwitch: () => SaveResult;
}

function configurationKey(key: string): boolean {
  return key === MOD_STATE_STORAGE_KEY || key === MOD_SETTINGS_STORAGE_KEY ||
    /^neo:mod(?:Prefs:|Choices$|Consents$|RuleChoices$|Pins$|SectionChoices$)/u.test(key) ||
    key === "neo:enabledMods" ||
    /^neo-angband-user:customized_[a-z_]+_options\.json$/u.test(key);
}

function refused(reason: string): { readonly ok: false; readonly reason: string } {
  return { ok: false, reason };
}

export function createModProfiles(id: string, caps: CapabilitySet, deps: ProfileRuntimeDeps): ModProfiles {
  const failStorage = "Profile storage is unavailable.";
  const list = (): ModProfile[] => deps.store.list().map((p) => ({
    id: p.id, name: p.name, active: p.id === deps.store.activeId(),
  }));
  const known = (profileId: string | null) => list().some((p) => p.id === profileId);
  const enable = (profileId: string, mods: readonly string[]): ProfileResult => {
    caps.check("profiles:manage");
    if (!deps.storage) return refused(failStorage);
    const target = scopedStorage(deps.storage, profileId);
    const owner = parseDocument(target.getItem(OWNER_KEY), profileOwnerFormat);
    if (!known(profileId) || !owner.ok || owner.data.profileId !== profileId || owner.data.modId !== id) return refused("This mod did not create that profile.");
    const enabled = [...new Set([id, ...mods])];
    const installed = new Map(deps.installed().map((m) => [m.id, m]));
    const source = new ModStore(scopedStorage(deps.storage, deps.store.activeId()));
    const store = new ModStore(target);
    for (const modId of enabled) {
      const manifest = installed.get(modId);
      if (!manifest) return refused(`Mod "${modId}" is not installed.`);
      const grants = source.getConsent(modId);
      if (!consentSatisfied(manifest.capabilities ?? [], grants) &&
          !consentSatisfied(manifest.capabilities ?? [], store.getConsent(modId))) {
        return refused(`Mod "${manifest.name}" needs your permission in the Mods screen first.`);
      }
    }
    for (const modId of enabled) {
      const manifest = installed.get(modId)!;
      if (consentSatisfied(manifest.capabilities ?? [], source.getConsent(modId))) {
        store.setConsent(modId, source.getConsent(modId));
      }
      store.setModChoice(modId, true);
    }
    for (const modId of new Set([...store.getEnabled(), ...installed.keys()])) {
      if (!enabled.includes(modId)) store.setModChoice(modId, false);
    }
    store.setEnabled(enabled);
    if (JSON.stringify(store.getEnabled()) !== JSON.stringify(enabled)) return refused(failStorage);
    return { ok: true, value: undefined };
  };
  return Object.freeze({
    list: () => {
      caps.check("profiles:manage");
      return { ok: true as const, value: list() };
    },
    create: (name: string, options?: { readonly copyFrom?: string | null }): ProfileResult<ModProfile> => {
      caps.check("profiles:manage");
      if (!deps.storage) return refused(failStorage);
      if (!name.trim()) return refused("A profile needs a name.");
      if (options?.copyFrom !== undefined && !known(options.copyFrom)) return refused("The source profile does not exist.");
      const profileId = deps.store.create(name.trim());
      try {
        if (!known(profileId)) return refused(failStorage);
        if (options?.copyFrom !== undefined) copyScopedStorage(deps.storage, options.copyFrom, profileId, configurationKey);
        const target = scopedStorage(deps.storage, profileId);
        target.setItem(OWNER_KEY, serializeDocument(profileOwnerFormat, { profileId, modId: id }, { compact: true }));
        const result = enable(profileId, new ModStore(target).getEnabled());
        if (!result.ok) {
          deps.store.remove(profileId, deps.storage);
          return result;
        }
        return { ok: true, value: list().find((p) => p.id === profileId)! };
      } catch {
        deps.store.remove(profileId, deps.storage);
        return refused(failStorage);
      }
    },
    setEnabledMods: (profileId: string, mods: readonly string[]) => {
      caps.check("profiles:manage");
      try { return enable(profileId, mods); } catch { return refused(failStorage); }
    },
    switchTo: (profileId: string | null, action?: ModProfileAction): ProfileResult => {
      caps.check("profiles:manage");
      if (!deps.storage) return refused(failStorage);
      if (!known(profileId)) return refused("The destination profile does not exist.");
      const ready = deps.canSwitch();
      if (!ready.ok) return ready;
      if (action) {
        if (action.kind !== "create-character") return refused("The profile action is not supported.");
        if (!caps.has("saves:manage")) return refused('Character creation needs capability "saves:manage".');
        if (!new ModStore(scopedStorage(deps.storage, profileId)).isEnabled(id)) return refused("This mod is disabled in the destination profile.");
        if (action.armController && !deps.hasController(id)) return refused("This mod has no controller to arm.");
      }
      const previous = deps.store.activeId();
      try {
        if (!deps.pendingStorage) return refused("Reload storage is unavailable.");
        deps.pendingStorage.removeItem(PROFILE_ACTION_KEY);
        if (action) {
          const text = serializeDocument(profileActionFormat, { profileId, modId: id, action }, { compact: true });
          deps.pendingStorage.setItem(PROFILE_ACTION_KEY, text);
          if (deps.pendingStorage.getItem(PROFILE_ACTION_KEY) !== text) return refused("The profile action could not be saved.");
        }
        deps.store.switchTo(profileId);
        if (deps.store.activeId() !== profileId) throw new Error(failStorage);
        deps.reload();
        return { ok: true, value: undefined };
      } catch {
        try {
          deps.store.switchTo(previous);
          deps.pendingStorage?.removeItem(PROFILE_ACTION_KEY);
        } catch {
          /* Storage can also refuse the cleanup after refusing the switch. */
        }
        return refused("The profile switch could not reload the game.");
      }
    },
  });
}

export function consumeProfileAction(
  storage: ProfileStorage,
  activeId: string | null,
  run: (pending: PendingProfileAction) => SaveResult,
): SaveResult | null {
  let text: string | null;
  try {
    text = storage.getItem(PROFILE_ACTION_KEY);
  } catch {
    return null;
  }
  if (text === null) return null;
  try {
    storage.removeItem(PROFILE_ACTION_KEY);
    if (storage.getItem(PROFILE_ACTION_KEY) !== null) return refused("The profile action could not be cleared.");
    const doc = parseDocument(text, profileActionFormat);
    if (!doc.ok) return refused("The saved profile action is unreadable.");
    const p = doc.data;
    if (p.profileId !== activeId) {
      return refused("The pending profile action does not match this profile.");
    }
    return run(p);
  } catch {
    return refused("The saved profile action is unreadable.");
  }
}
