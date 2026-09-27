/**
 * Player/testing profiles (neo-angband#163): named, isolated configurations
 * within one install. A profile bundles game options, mod loadout (enabled
 * set, consents, per-mod settings) and the save roster - everything
 * profile-scope.ts's `scopedStorage` namespaces. What is NOT bundled
 * (keybinds, accessibility, tileset, display settings, and the Hall of Fame)
 * never goes through that seam at all, so it needs no mention here.
 *
 * This module owns only the METADATA: which profiles exist, which is active,
 * and creating/renaming/removing one. It never touches game data directly -
 * `create`'s optional copy-from and `remove`'s wipe go through
 * profile-scope.ts's own copy/clear helpers, over a caller-supplied real
 * (unscoped) storage, kept separate from this class's own small storage
 * instance so the two can never be confused: this class's `storage` holds a
 * few metadata keys and must never itself be profile-scoped, or a profile
 * could not learn about its own siblings.
 *
 * THE DEFAULT PROFILE IS NOT A ROW HERE UNTIL IT IS NAMED. `list()` always
 * synthesizes it (id `null`, name "Default" until renamed) because its data
 * already exists unprefixed - nothing to create - but it carries no metadata
 * entry of its own until a name is set, matching "it isn't really a profile
 * until a second one exists."
 */

import { profilesFormat, type ProfileIndex } from "@rpgm-tools/neo-angband-mod-sdk";

import { fieldDocument, legacyJson } from "./field-document";
import { clearScopedStorage, copyScopedStorage, type ScopedStorage } from "./profile-scope";

/** The Storage subset this module needs; a real Storage satisfies it. */
export interface ProfileStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** One profile, named or (for `id: null`) the implicit default. */
export interface ProfileMeta {
  id: string | null;
  name: string;
  createdAt: number;
}

interface StoredProfile {
  name: string;
  createdAt: number;
}

/** Where the profile index is kept: one `neo-angband/web/profiles` document, never profile-scoped (#288). */
export const PROFILES_STORAGE_KEY = "neo-angband:profiles";

/** An older build's key holding a bare JSON string, or null for "none". */
function legacyString(key: string) {
  const raw = legacyJson<unknown>(key);
  return { key, parse: (text: string) => {
    const value = raw.parse(text);
    return typeof value === "string" ? value : undefined;
  } };
}

const profiles = fieldDocument<ProfileIndex>({
  format: profilesFormat,
  storageKey: PROFILES_STORAGE_KEY,
  empty: { named: {} },
  legacy: {
    named: {
      key: "neo:profiles",
      parse(text) {
        const value = legacyJson<unknown>("neo:profiles").parse(text);
        if (typeof value !== "object" || value === null || Array.isArray(value)) return undefined;
        const out: Record<string, StoredProfile> = {};
        for (const [id, entry] of Object.entries(value as Record<string, unknown>)) {
          const p = entry as Partial<StoredProfile> | null;
          if (typeof p?.name === "string" && typeof p.createdAt === "number" && Number.isFinite(p.createdAt)) {
            out[id] = { name: p.name, createdAt: p.createdAt };
          }
        }
        return out;
      },
    },
    defaultName: legacyString("neo:profiles:defaultName"),
    active: legacyString("neo:activeProfile"),
  },
});

/** Move the profile index out of its older keys, once, at boot. */
export function convertLegacyProfiles(storage: ProfileStorage): void {
  profiles.convert(storage);
}

/**
 * The durable profile-metadata store. Construct with localStorage in the
 * browser (defaultProfileStore) or a fake in tests. Every method tolerates a
 * null/failing storage - a host with no storage has exactly one profile, the
 * default, and can never leave it.
 */
export class ProfileStore {
  constructor(private readonly storage: ProfileStorage | null) {}

  private namedProfiles(): Record<string, StoredProfile> {
    return { ...profiles.read(this.storage, "named") };
  }

  /** Every profile, the default first, in creation order. */
  list(): ProfileMeta[] {
    const defaultName = (profiles.read(this.storage, "defaultName") ?? null);
    const named = Object.entries(this.namedProfiles())
      .map(([id, p]): ProfileMeta => ({ id, name: p.name, createdAt: p.createdAt }))
      .sort((a, b) => a.createdAt - b.createdAt);
    return [{ id: null, name: defaultName ?? "Default", createdAt: 0 }, ...named];
  }

  /** Whether the default profile has ever been given a name of its own. */
  isDefaultNamed(): boolean {
    return (profiles.read(this.storage, "defaultName") ?? null) !== null;
  }

  /** Whether any named (non-default) profile exists at all. */
  hasNamedProfiles(): boolean {
    return Object.keys(this.namedProfiles()).length > 0;
  }

  /** The active profile id, or `null` for the default. */
  activeId(): string | null {
    return profiles.read(this.storage, "active") ?? null;
  }

  isDefaultActive(): boolean {
    return this.activeId() === null;
  }

  /** Just the metadata switch - the caller reloads to actually apply the new scope. */
  switchTo(id: string | null): void {
    profiles.write(this.storage, "active", id ?? undefined);
  }

  /**
   * Create a new named profile and return its id. `copyFrom` is the id (or
   * `null` for the default) to copy every scoped key from into the new
   * profile; omit it for a full reset (the new profile starts empty).
   * `realStorage` is the actual, unscoped storage the game data lives in -
   * distinct from this class's own metadata storage, which may or may not be
   * the same underlying object.
   */
  create(
    name: string,
    opts?: { copyFrom?: string | null; realStorage?: ScopedStorage },
  ): string {
    const id = crypto.randomUUID();
    const all = this.namedProfiles();
    all[id] = { name, createdAt: Date.now() };
    profiles.write(this.storage, "named", all);
    if (opts?.copyFrom !== undefined && opts.realStorage) {
      copyScopedStorage(opts.realStorage, opts.copyFrom, id);
    }
    return id;
  }

  /** Rename a profile; `id: null` names the default. No-op for an unknown named id. */
  rename(id: string | null, name: string): void {
    if (id === null) {
      profiles.write(this.storage, "defaultName", name);
      return;
    }
    const all = this.namedProfiles();
    const existing = all[id];
    if (!existing) return;
    all[id] = { ...existing, name };
    profiles.write(this.storage, "named", all);
  }

  /**
   * Remove a named profile - never the default (a `null` id is refused). Its
   * scoped data is wiped from `realStorage`. Switches back to the default
   * first if the removed profile was active, so nothing is left pointed at a
   * profile that no longer exists.
   *
   * Whether to preserve the departing profile's saves elsewhere is a decision
   * for the caller to make BEFORE calling this (e.g. merging its roster into
   * the active profile's) - this method only ever deletes.
   */
  remove(id: string, realStorage: ScopedStorage): void {
    const all = this.namedProfiles();
    if (!(id in all)) return;
    delete all[id];
    profiles.write(this.storage, "named", all);
    clearScopedStorage(realStorage, id);
    if (this.activeId() === id) this.switchTo(null);
  }
}

/** A ProfileStore backed by the browser's localStorage (null-safe if unavailable). */
export function defaultProfileStore(): ProfileStore {
  let storage: ProfileStorage | null = null;
  try {
    storage = globalThis.localStorage ?? null;
  } catch {
    storage = null;
  }
  return new ProfileStore(storage);
}
