/**
 * Mod-manager persistence + catalog (W2.4).
 *
 * This owns the durable state the in-app mod manager reads and writes:
 * - the ENABLED set (which mods are on), keyed "neo:enabledMods" - the same
 *   localStorage key + JSON string[] schema pack.ts reads at composition time,
 *   so writing it here and reloading is what actually turns a content mod on.
 * - per-mod CONSENT (which capabilities the user approved), "neo:modConsents".
 * - named PROFILES (a saved enabled-set + consents), "neo:modProfiles".
 *
 * It is a thin, storage-error-tolerant wrapper (the roster.ts idiom: every
 * access swallows failures so private-mode / no-storage hosts degrade to "no
 * mods" rather than crashing). The pure catalog builder (buildCatalog) and the
 * consent check are separated out so they can be unit-tested without storage.
 *
 * Enablement is a single source of truth across surfaces: pack.ts reads the
 * enabled set for CONTENT composition, and main.ts's boot reads it (plus
 * consent) to auto-install enabled SANDBOX/TRUSTED plugins. The manager edits
 * this store; a reload re-composes and re-installs. (URL ?mods=/?plugin=/
 * ?trusted= still override for one-off testing, per pack.ts / main.ts.)
 */

import type { PackManifest } from "@neo-angband/mod-sdk";

const ENABLED_KEY = "neo:enabledMods";
const CONSENT_KEY = "neo:modConsents";
const PROFILES_KEY = "neo:modProfiles";

/**
 * The committed, first-party BUNDLED mods that ship enabled by default
 * (PORT_PLAN.md decisions 18, 23: the official mods are bundled and on by
 * default, each fully removable). Order is the default load order. Only ids
 * that are actually DISCOVERED at runtime take effect, so a host that ships
 * without one of these dirs stays byte-identical (the resolver intersects with
 * the discovered set). The demo mods (demo-*) are deliberately NOT here - they
 * stay opt-in.
 */
export const DEFAULT_ENABLED_MODS: readonly string[] = [
  "bug-fixes",
  "qol",
  "linoleum",
];

/**
 * First-party bundled mods whose capabilities are implicitly consented on first
 * run: they ship inside the app, so shipping them IS the trust decision (a
 * third-party plugin still requires explicit per-capability consent). The user
 * can still revoke consent afterwards in the manager - this only seeds the
 * initial state so a default-on trusted bundled mod actually installs at boot.
 */
export const FIRST_PARTY_MOD_IDS: readonly string[] = DEFAULT_ENABLED_MODS;

/**
 * Resolve the effective enabled-mod id list from the three input sources, in
 * precedence order. Pure, so both the content composer (pack.ts, at module
 * load) and the plugin auto-installer (main.ts boot) resolve identically.
 *
 * - `url` (?mods=a,b): a one-off testing override; when non-null it wins
 *   verbatim (even when empty, meaning "no mods").
 * - `stored` (localStorage neo:enabledMods): the user's saved set. null means
 *   the key is ABSENT (first run) - distinct from an empty array (user turned
 *   everything off). When present it is authoritative.
 * - else first run: the DEFAULT_ENABLED_MODS, intersected with `discovered` so
 *   only mods that exist are enabled.
 */
export function resolveEnabledIds(opts: {
  url: string[] | null;
  stored: string[] | null;
  discovered: readonly string[];
}): string[] {
  if (opts.url !== null) return opts.url;
  if (opts.stored !== null) return opts.stored;
  const have = new Set(opts.discovered);
  return DEFAULT_ENABLED_MODS.filter((id) => have.has(id));
}

/** The minimal Storage surface used here (localStorage in the browser). */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** How a mod is loaded, which decides the install path (not the manifest shape). */
export type ModKind = "content" | "sandbox" | "trusted";

/** One row in the manager's catalog: a mod plus its live enable/consent state. */
export interface CatalogMod {
  id: string;
  name: string;
  version: string;
  /** The manifest shape ("content" | "tiles" | "plugin"). */
  shape: string;
  /** How it loads: content-pack, untrusted sandbox worker, or trusted in-process. */
  kind: ModKind;
  manifest: PackManifest;
  /** Whether this mod is in the enabled set. */
  enabled: boolean;
  /** The capabilities it requests (empty for content/tiles). */
  capabilities: string[];
  /** Whether it trips the determinism ratchet. */
  nondeterministic: boolean;
  /**
   * Whether every requested capability has been consented to. Always true for a
   * mod that requests nothing (content/tiles), so only plugins gate on consent.
   */
  consented: boolean;
}

/** A named, restorable mod configuration. */
export interface ModProfile {
  name: string;
  enabledMods: string[];
  consents: Record<string, string[]>;
}

function readJson<T>(storage: StorageLike | null, key: string, fallback: T): T {
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function writeJson(storage: StorageLike | null, key: string, value: unknown): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable / full: degrade silently, like roster.ts */
  }
}

/**
 * The durable mod-manager state over a Storage. Construct with localStorage in
 * the browser (defaultModStore) or a fake in tests. Every method tolerates a
 * null/failing storage.
 */
export class ModStore {
  constructor(private readonly storage: StorageLike | null) {}

  /* --- Enabled set --------------------------------------------------- */

  getEnabled(): string[] {
    const arr = readJson<unknown>(this.storage, ENABLED_KEY, []);
    return Array.isArray(arr)
      ? arr.filter((s): s is string => typeof s === "string")
      : [];
  }

  /**
   * Whether the enabled-set key exists in storage. Distinguishes first run (no
   * key -> defaults apply) from "user turned everything off" (key present, empty
   * array). Tolerates a null/failing storage (treated as absent).
   */
  hasStoredEnabled(): boolean {
    if (!this.storage) return false;
    try {
      return this.storage.getItem(ENABLED_KEY) !== null;
    } catch {
      return false;
    }
  }

  setEnabled(ids: readonly string[]): void {
    // De-dupe preserving order; order IS the load order the resolver then sorts.
    const seen = new Set<string>();
    const out: string[] = [];
    for (const id of ids) {
      if (!seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
    writeJson(this.storage, ENABLED_KEY, out);
  }

  isEnabled(id: string): boolean {
    return this.getEnabled().includes(id);
  }

  /** Turn a mod on or off, preserving the order of the rest. */
  setModEnabled(id: string, on: boolean): void {
    const cur = this.getEnabled();
    if (on) {
      if (!cur.includes(id)) this.setEnabled([...cur, id]);
    } else {
      this.setEnabled(cur.filter((x) => x !== id));
    }
  }

  /** Move an enabled mod one step earlier (-1) or later (+1) in load order. */
  moveEnabled(id: string, delta: number): void {
    const cur = this.getEnabled();
    const i = cur.indexOf(id);
    if (i < 0) return;
    const j = i + delta;
    if (j < 0 || j >= cur.length) return;
    const next = [...cur];
    const [item] = next.splice(i, 1);
    next.splice(j, 0, item as string);
    this.setEnabled(next);
  }

  /* --- Consent ------------------------------------------------------- */

  getConsents(): Record<string, string[]> {
    const obj = readJson<Record<string, unknown>>(this.storage, CONSENT_KEY, {});
    const out: Record<string, string[]> = {};
    for (const [id, caps] of Object.entries(obj)) {
      if (Array.isArray(caps)) {
        out[id] = caps.filter((c): c is string => typeof c === "string");
      }
    }
    return out;
  }

  getConsent(id: string): string[] {
    return this.getConsents()[id] ?? [];
  }

  /** Record that the user approved exactly `caps` for `id` (replaces prior). */
  setConsent(id: string, caps: readonly string[]): void {
    const all = this.getConsents();
    all[id] = [...caps];
    writeJson(this.storage, CONSENT_KEY, all);
  }

  /** Drop a mod's consent entirely (e.g. on remove). */
  clearConsent(id: string): void {
    const all = this.getConsents();
    if (id in all) {
      delete all[id];
      writeJson(this.storage, CONSENT_KEY, all);
    }
  }

  /* --- Profiles ------------------------------------------------------ */

  getProfiles(): Record<string, ModProfile> {
    const obj = readJson<Record<string, unknown>>(this.storage, PROFILES_KEY, {});
    const out: Record<string, ModProfile> = {};
    for (const [name, p] of Object.entries(obj)) {
      const prof = p as Partial<ModProfile>;
      if (prof && Array.isArray(prof.enabledMods)) {
        out[name] = {
          name,
          enabledMods: prof.enabledMods.filter(
            (s): s is string => typeof s === "string",
          ),
          consents:
            prof.consents && typeof prof.consents === "object"
              ? (prof.consents as Record<string, string[]>)
              : {},
        };
      }
    }
    return out;
  }

  /** Save the CURRENT enabled-set + consents under a name (snapshot). */
  saveProfile(name: string): void {
    const all = this.getProfiles();
    all[name] = { name, enabledMods: this.getEnabled(), consents: this.getConsents() };
    writeJson(this.storage, PROFILES_KEY, all);
  }

  deleteProfile(name: string): void {
    const all = this.getProfiles();
    if (name in all) {
      delete all[name];
      writeJson(this.storage, PROFILES_KEY, all);
    }
  }

  /** Make a saved profile the live config (writes enabled + consents). Returns false if unknown. */
  applyProfile(name: string): boolean {
    const prof = this.getProfiles()[name];
    if (!prof) return false;
    this.setEnabled(prof.enabledMods);
    writeJson(this.storage, CONSENT_KEY, prof.consents);
    return true;
  }
}

/** True when every capability in `required` is present in `consented`. */
export function consentSatisfied(
  required: readonly string[],
  consented: readonly string[],
): boolean {
  const have = new Set(consented);
  return required.every((c) => have.has(c));
}

/** The inputs buildCatalog merges (each list is manifests of one load kind). */
export interface CatalogInput {
  content: readonly PackManifest[];
  sandbox: readonly PackManifest[];
  trusted: readonly PackManifest[];
  enabled: readonly string[];
  consents: Record<string, readonly string[]>;
}

function toCatalogMod(
  manifest: PackManifest,
  kind: ModKind,
  enabled: ReadonlySet<string>,
  consents: Record<string, readonly string[]>,
): CatalogMod {
  const capabilities = manifest.capabilities ?? [];
  const consented =
    capabilities.length === 0 ||
    consentSatisfied(capabilities, consents[manifest.id] ?? []);
  return {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    shape: manifest.shape,
    kind,
    manifest,
    enabled: enabled.has(manifest.id),
    capabilities,
    nondeterministic: manifest.nondeterministic ?? false,
    consented,
  };
}

/**
 * Build the manager catalog from the three discovered manifest lists plus the
 * live enabled-set and consent map. Pure (no storage/discovery), so it is unit-
 * testable. Sorted: enabled first (in enabled/load order), then the rest by name.
 */
export function buildCatalog(input: CatalogInput): CatalogMod[] {
  const enabledSet = new Set(input.enabled);
  const all: CatalogMod[] = [
    ...input.content.map((m) => toCatalogMod(m, "content", enabledSet, input.consents)),
    ...input.sandbox.map((m) => toCatalogMod(m, "sandbox", enabledSet, input.consents)),
    ...input.trusted.map((m) => toCatalogMod(m, "trusted", enabledSet, input.consents)),
  ];
  const orderOf = (id: string): number => {
    const i = input.enabled.indexOf(id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return all.sort((a, b) => {
    if (a.enabled !== b.enabled) return a.enabled ? -1 : 1;
    if (a.enabled && b.enabled) return orderOf(a.id) - orderOf(b.id);
    return a.name.localeCompare(b.name);
  });
}

/** A ModStore backed by the browser's localStorage (null-safe if unavailable). */
export function defaultModStore(): ModStore {
  let storage: StorageLike | null = null;
  try {
    storage = globalThis.localStorage ?? null;
  } catch {
    storage = null;
  }
  return new ModStore(storage);
}
