import { lookFormat, parseDocument, serializeDocument, type LookState, type PackManifest } from "@rpgm-tools/neo-angband-mod-sdk";
import type { ModStore, StorageLike } from "./mod-store";

export const LOOK_STORAGE_KEY = "neo-angband:look";
export const NEO_PENDING_TEXT = "Neo Angband is waiting for AnybandUI to download";

export function vanillaLook(): LookState {
  return { chosen: false, desired: "Vanilla", active: "Vanilla", pending: null, snapshot: null, neoSettings: {}, playerChanges: {} };
}

export class LookStore {
  constructor(private readonly storage: StorageLike | null, private readonly mods: ModStore) {}

  read(): LookState {
    try {
      const text = this.storage?.getItem(LOOK_STORAGE_KEY);
      const result = text ? parseDocument(text, lookFormat) : null;
      return result?.ok ? result.data : vanillaLook();
    } catch { return vanillaLook(); }
  }

  choose(look: "Vanilla" | "Neo", enabled = this.mods.isEnabled("anybandui")): LookState {
    let state = this.read();
    if (look === "Vanilla") {
      if (state.snapshot && (state.active === "Neo" || state.snapshot.presetKeys.length > 0)) {
        const snapshot = state.snapshot;
        state = { ...state, neoSettings: this.mods.getSettingValues()["anybandui"] ?? {} };
        const restored = { ...state.neoSettings };
        for (const key of snapshot.presetKeys) {
          if (Object.hasOwn(snapshot.settings, key)) restored[key] = snapshot.settings[key]!;
          else delete restored[key];
        }
        this.mods.replaceSettingValues("anybandui", restored);
        this.mods.setModEnabled("anybandui", false);
      }
      return this.#write({ ...state, chosen: true, desired: look, active: look, pending: null, snapshot: null });
    }
    if (state.active === "Neo") return state;
    return this.#write({ ...state, chosen: true, desired: look, pending: { look, modId: "anybandui" }, snapshot: state.snapshot ?? { enabled, settings: this.mods.getSettingValues()["anybandui"] ?? {}, presetKeys: [] } });
  }

  complete(manifest: Pick<PackManifest, "id" | "lookPreset"> | undefined, enabled = this.mods.isEnabled("anybandui")): LookState {
    const state = this.read();
    const ready = manifest?.id === "anybandui" && manifest.lookPreset !== undefined && enabled;
    if (state.active === "Neo" && !ready) return this.#write({ ...state, active: "Vanilla", pending: { look: "Neo", modId: "anybandui" }, neoSettings: this.mods.getSettingValues()["anybandui"] ?? state.neoSettings });
    if (!state.pending || !ready || !manifest?.lookPreset) return state;
    const settings = this.mods.getSettingValues()[manifest.id] ?? {};
    const snapshot = { ...(state.snapshot ?? { enabled: this.mods.isEnabled(manifest.id), settings }), settings: state.snapshot && state.snapshot.presetKeys.length > 0 ? state.snapshot.settings : settings, presetKeys: Object.keys(manifest.lookPreset.settings) };
    const neoSettings = { ...settings, ...manifest.lookPreset.settings, ...state.neoSettings, ...state.playerChanges };
    this.mods.replaceSettingValues(manifest.id, neoSettings);
    return this.#write({ ...state, active: "Neo", pending: null, snapshot, neoSettings });
  }

  snapshot(): void {
    const state = this.read();
    if (!state.pending || state.snapshot) return;
    this.#write({ ...state, snapshot: { enabled: this.mods.isEnabled("anybandui"), settings: this.mods.getSettingValues()["anybandui"] ?? {}, presetKeys: [] } });
  }

  recordSetting(modId: string, id: string, value: number): void {
    const state = this.read();
    if (modId !== "anybandui" || state.active !== "Neo") return;
    this.#write({ ...state, playerChanges: { ...state.playerChanges, [id]: value } });
  }

  #write(state: LookState): LookState {
    this.storage?.setItem(LOOK_STORAGE_KEY, serializeDocument(lookFormat, state, { compact: true }));
    return state;
  }
}
