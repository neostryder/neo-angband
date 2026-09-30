/** `ctx.settings`, the door a mod reads its Mods screen numbers through. */

import { resolveSettingValue, type PackSetting } from "@rpgm-tools/neo-angband-mod-sdk";
import type { ModSettingsRead } from "@rpgm-tools/neo-angband-core";
export type { ModSettingsRead } from "@rpgm-tools/neo-angband-core";

export interface ModSettingSource {
  /** From the enabled mod's manifest. */
  declared(modId: string): readonly PackSetting[];
  /** Raw values from the store; they may be out of range. */
  stored(modId: string): Readonly<Record<string, unknown>>;
}

type Listener = (id: string, value: number) => void;
type ReportFault = (modId: string, message: string, error: unknown) => void;

let source: ModSettingSource | null = null;
let reportFault: ReportFault = () => {};
const listeners = new Map<string, Set<Listener>>();
/* An effect may read its strength every frame, and each uncached read parses
 * localStorage. notifyModSettingChanged drops a mod's entry. A reload-only
 * setting never notifies, so its old value holds until the page reloads. */
const cache = new Map<string, Readonly<Record<string, number>>>();

/** main.ts calls this once the enabled mod set is known. */
export function setModSettingSource(next: ModSettingSource | null, fault?: ReportFault): void {
  source = next;
  cache.clear();
  if (fault) reportFault = fault;
}

/** What `all()` returns for `modId`. */
export function resolvedModSettings(modId: string): Readonly<Record<string, number>> {
  const cached = cache.get(modId);
  if (cached) return cached;
  const stored = source?.stored(modId) ?? {};
  const out: Record<string, number> = {};
  for (const setting of source?.declared(modId) ?? []) out[setting.id] = resolveSettingValue(setting, stored[setting.id]);
  const resolved = Object.freeze(out);
  cache.set(modId, resolved);
  return resolved;
}

/** Undefined for a mod with no settings, so `ctx.settings` is absent for it. */
export function modSettingsFor(modId: string): ModSettingsRead | undefined {
  if ((source?.declared(modId) ?? []).length === 0) return undefined;
  return Object.freeze({
    get: (id: string) => resolvedModSettings(modId)[id],
    all: () => resolvedModSettings(modId),
    onChange: (listener: Listener) => {
      if (typeof listener !== "function") return () => {};
      let set = listeners.get(modId);
      if (!set) listeners.set(modId, (set = new Set()));
      set.add(listener);
      return () => { set!.delete(listener); };
    },
  });
}

/** Called by the Mods screen after a live change. One listener throwing does not stop the others. */
export function notifyModSettingChanged(modId: string, settingId: string): void {
  cache.delete(modId);
  const value = resolvedModSettings(modId)[settingId];
  if (value === undefined) return;
  for (const listener of [...(listeners.get(modId) ?? [])]) {
    try {
      listener(settingId, value);
    } catch (error) {
      reportFault(modId, `its settings listener failed for ${settingId}`, error);
    }
  }
}

/** Used by tests. */
export function clearModSettingListeners(): void {
  listeners.clear();
}
