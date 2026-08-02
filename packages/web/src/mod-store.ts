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

import type { PackManifest, SortPin } from "@rpgm-tools/neo-angband-mod-sdk";

const ENABLED_KEY = "neo:enabledMods";
/* Explicit per-mod decisions, distinct from the resulting enabled SET: an entry
 * here means the player said so, and outranks an external manager's deployment. */
const CHOICE_KEY = "neo:modChoices";
const CONSENT_KEY = "neo:modConsents";
const PROFILES_KEY = "neo:modProfiles";
const RULE_CHOICES_KEY = "neo:modRuleChoices";
/* The player's own placements, which outrank every author's ordering suggestion
 * and survive an auto-sort (see ModStore.getPins). */
const PINS_KEY = "neo:modPins";
/* Per-mod, per-section on/off - the general form of a rule choice, for the named
 * parts of a mod (PackSection). */
const SECTION_CHOICES_KEY = "neo:modSectionChoices";

/** A list of strings from untrusted JSON, dropping anything else. */
function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Mods enabled on a fresh install. EMPTY by parity mandate: the default
 * experience is the faithful no-mod Angband 4.2.6 base game, and every mod -
 * including the first-party bundled ones - is opt-in (audit 06 MOD-11; parity
 * runbook Phase 0). No mod may be enabled by default, because a default-on mod
 * that changes any rule (e.g. qol.autoDig) perturbs the base game and its RNG.
 * The bundled mods still ship with the app and appear in the manager; the user
 * turns them on deliberately. Only ids actually DISCOVERED at runtime take
 * effect, so the resolver intersects with the discovered set.
 */
export const DEFAULT_ENABLED_MODS: readonly string[] = [];

/**
 * The mods BUNDLED INTO THE BUILD, which is now none of them.
 *
 * WHAT THIS LIST MEANS, since it is empty and an empty list invites deletion. It is an
 * identity list, not a default-enable list: a mod on it gets IMPLICIT capability consent
 * when the player enables it, because shipping a mod inside the app IS the trust
 * decision. A mod that arrives any other way - the download catalogue, a folder on disk,
 * an external mod manager - is third-party as far as consent goes, and every capability
 * it declares has to be granted explicitly. That distinction is why the list survives
 * being empty: it is the definition of "we vouched for this by shipping it", and there is
 * currently nothing the game vouches for that way.
 *
 * IT WENT EMPTY DELIBERATELY. qol and bug-fixes were here; both now live in their own
 * repositories and arrive through RECOMMENDED_MODS like neo-linoleum already did. The
 * game bundles no mod at all, so a fresh install is Angband 4.2.6 and nothing else -
 * which is the parity mandate stated in code rather than in a document.
 *
 * AND EMPTYING THIS LIST IS NOT WHAT DE-BUNDLED THEM. "Bundled" is defined mechanically
 * by six `import.meta.glob` patterns over `../mods/*` (mod-hooks.ts, pack.ts,
 * tile-mods.ts): whatever those globs match is inlined into the payload at build time.
 * Removing an id from here without removing the folder would have left the code in the
 * bundle and merely stopped consenting to it - the same shape of mistake as a fix that
 * is "removed from core" by being put behind a flag.
 */
export const FIRST_PARTY_MOD_IDS: readonly string[] = [];

/**
 * Whether a mod id in the build is part of the SHIPPED set, i.e. offered to a player in
 * a release build.
 *
 * The only mods left under packages/web/mods/ are the `demo-*` framework proofs (a
 * content pack that patches a core monster, a sandboxed worker plugin, a trusted
 * in-process plugin). They exist so the SDK's three load paths stay exercised
 * end-to-end in dev and in tests. Shipping them would put three joke entries in the
 * player's mod manager, so every discovery surface (content packs, tile packs, sandbox
 * plugins, trusted plugins) routes through this predicate and drops them from a
 * production build.
 *
 * So in a release build this currently returns false for everything in the folder, and
 * that is correct rather than broken: a release ships no bundled mod. The predicate is
 * not written as `return false` because the folder is the mechanism, not the policy - a
 * mod added there tomorrow should ship, and a demo added there should not.
 *
 * `dev` defaults to Vite's import.meta.env.DEV so callers just call `isShippedMod(id)`;
 * it is a parameter only so the unit tests can assert both builds without faking the
 * module environment. Note this gates DISCOVERY, not bundling: the eager
 * import.meta.glob still inlines the demo manifests (glob patterns must be static),
 * they are simply never surfaced. They are a few hundred bytes, and keeping the globs
 * identical in both builds means dev and release load mods through the same code path.
 */
export function isShippedMod(id: string, dev = import.meta.env.DEV): boolean {
  return dev || !id.startsWith("demo-");
}

/**
 * Resolve the effective enabled-mod id list, in precedence order. Pure, so both
 * the content composer (pack.ts, at module load) and the plugin auto-installer
 * (main.ts boot) resolve identically.
 *
 * - `url` (?mods=a,b): a one-off testing override; when non-null it wins
 *   verbatim (even when empty, meaning "no mods").
 * - `stored` (localStorage neo:enabledMods): the user's saved set. null means
 *   the key is ABSENT (first run) - distinct from an empty array (user turned
 *   everything off). On a first run the DEFAULT_ENABLED_MODS apply instead,
 *   intersected with `discovered` so only mods that exist are enabled.
 * - `diskOrder` then ADDS anything an external mod manager deployed and the
 *   player has no recorded opinion on, appended so it loads last.
 * - `choices` is the player's explicit per-mod decision and outranks the disk
 *   order in both directions.
 */
/**
 * Mod ids that have been RENAMED, old -> new.
 *
 * A mod id is durable state: it is what the saved enabled set, the per-mod
 * choice map and an external manager's load-order.json all record. Renaming one
 * without this map would silently disable the mod for anyone who already had it
 * on, and the symptom - "the tile sets stopped appearing in Graphics" - points at
 * the tile code, not at a rename three commits back.
 *
 * `linoleum` -> `neo-linoleum` (2026-07-31): the mod always DISPLAYED as
 * neo-linoleum; the id, its folder and the docs had not caught up.
 */
export const RENAMED_MOD_IDS: Readonly<Record<string, string>> = {
  linoleum: "neo-linoleum",
};

/**
 * Apply RENAMED_MOD_IDS to a list of ids, dropping a duplicate if both the old
 * and the new id are present (a store written across the rename).
 */
export function migrateModIds(ids: readonly string[]): string[] {
  const out: string[] = [];
  for (const id of ids) {
    const to = RENAMED_MOD_IDS[id] ?? id;
    if (!out.includes(to)) out.push(to);
  }
  return out;
}

/** Apply RENAMED_MOD_IDS to the KEYS of a per-mod record (choices, consents). */
export function migrateModIdKeys<T>(
  rec: Readonly<Record<string, T>>,
): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [k, v] of Object.entries(rec)) {
    /* The new id wins if both are present: it is the one the player set last. */
    const to = RENAMED_MOD_IDS[k] ?? k;
    if (to === k || !(to in rec)) out[to] = v;
  }
  return out;
}

export function resolveEnabledIds(opts: {
  url: string[] | null;
  stored: string[] | null;
  discovered: readonly string[];
  /**
   * load-order.json's list, from the on-disk mods directory (disk-packs.ts).
   * An external mod manager deploying a folder and adding it here is how a mod
   * arrives without the player opening this game's own manager, which is the
   * recorded Vortex/MO2 division of labour.
   *
   * It does NOT override the player: an id the player has explicitly decided
   * about (`choices`) keeps their decision, so turning a deployed mod off in the
   * game does not have it reappear on the next launch. Absent from both, the
   * manager's list wins - deploying it IS a request to enable it.
   */
  diskOrder?: readonly string[];
  /** Explicit per-mod decisions the player made in the manager. */
  choices?: Readonly<Record<string, boolean>>;
}): string[] {
  /* Every id that came from OUTSIDE this build - the URL override, the saved set,
   * the choice map, an external manager's load order - goes through the rename map
   * first, so a store written before a rename still enables the same mod. */
  if (opts.url !== null) return migrateModIds(opts.url);
  const choices = migrateModIdKeys(opts.choices ?? {});
  const base =
    opts.stored !== null
      ? migrateModIds(opts.stored)
      : DEFAULT_ENABLED_MODS.filter((id) => new Set(opts.discovered).has(id));
  const out = base.filter((id) => choices[id] !== false);
  const seen = new Set(out);
  for (const id of migrateModIds(opts.diskOrder ?? [])) {
    /* Ordered AFTER the stored set, so a deployed pack loads last unless the
     * player has reordered it - which matches "the manager owns disk order" and
     * keeps the bundled mods where they were. */
    if (!seen.has(id) && choices[id] !== false) {
      out.push(id);
      seen.add(id);
    }
  }
  return out;
}

/**
 * The effective enabled-mod ids, over the LIVE browser inputs: ?mods=, the saved
 * set, the player's explicit per-mod decisions, and the mods directory's
 * load-order.json.
 *
 * One reader, because there were three. The content composer (pack.ts), the tile
 * discovery (tile-mods.ts) and this module each spelled out the same URL and
 * localStorage reads, and two of them hardcoded the key strings that are constants
 * ten lines above. They had already drifted: only pack.ts passed `diskOrder` and
 * `choices`, so a tiles mod an external manager deployed was COMPOSED as content
 * and contributed no Graphics row - enabled by one answer and disabled by the
 * other, in the same launch.
 *
 * Every read is guarded because a host may have no `location` (a non-browser test)
 * and no `localStorage` (private mode), and in both cases the honest answer is "no
 * recorded opinion", not a throw at boot.
 */
export function readEnabledModIds(input: {
  discovered: readonly string[];
  diskOrder?: readonly string[];
}): string[] {
  let url: string[] | null = null;
  try {
    const raw = new URLSearchParams(location.search).get("mods");
    if (raw !== null) url = raw.split(",").map((s) => s.trim()).filter(Boolean);
  } catch {
    /* no location (non-browser host) */
  }
  let stored: string[] | null = null;
  try {
    const raw = localStorage.getItem(ENABLED_KEY);
    if (raw !== null) {
      const arr = JSON.parse(raw) as unknown;
      if (Array.isArray(arr)) {
        stored = arr.filter((s): s is string => typeof s === "string");
      }
    }
  } catch {
    /* no localStorage, or a corrupt value: treat as no saved set */
  }
  const choices: Record<string, boolean> = {};
  try {
    const raw = localStorage.getItem(CHOICE_KEY);
    if (raw !== null) {
      const obj = JSON.parse(raw) as unknown;
      if (obj !== null && typeof obj === "object" && !Array.isArray(obj)) {
        for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
          if (typeof v === "boolean") choices[k] = v;
        }
      }
    }
  } catch {
    /* no localStorage */
  }
  return resolveEnabledIds({
    url,
    stored,
    discovered: input.discovered,
    ...(input.diskOrder === undefined ? {} : { diskOrder: input.diskOrder }),
    choices,
  });
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
  /** Whether enabling it permanently makes the current save non-scoring. */
  affectsGameplay: boolean;
  /**
   * Whether every requested capability has been consented to. Always true for a
   * mod that requests nothing (content/tiles), so only plugins gate on consent.
   */
  consented: boolean;
  /**
   * This mod is switched ON and is not installed - there is no manifest behind
   * this row, only the id in the enabled set.
   *
   * It gets a row rather than being skipped because the alternative was tested
   * and is awful: reinstalling the game over a profile that had mods enabled
   * printed three `enabled mod "x" not found` lines to a console the player does
   * not have, showed an EMPTY mod list, and offered no hint that the game was
   * still trying to load anything. A player who turned a mod on is owed the
   * sentence "it is gone" in the place they turned it on.
   */
  missing?: boolean;
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
    /* Record that the PLAYER decided, separately from the resulting set.
     * Removing a disk-deployed mod from the enabled list is not enough on its
     * own: an external manager's load-order.json still lists it, so next launch
     * would union it back in and the mod would look like it refused to turn off.
     * The explicit choice is what makes their decision stick. */
    this.setModChoice(id, on);
  }

  /* --- Explicit per-mod decisions (vs. a deployed default) ------------- */

  /**
   * What the player has explicitly decided about each mod, if anything.
   *
   * Only written by a deliberate toggle. An absent entry means "no opinion", and
   * that is the state in which an external mod manager's load-order.json gets to
   * decide - which is the whole point of the Vortex/MO2 division of labour.
   */
  getModChoices(): Record<string, boolean> {
    const obj = readJson<Record<string, unknown>>(this.storage, CHOICE_KEY, {});
    const out: Record<string, boolean> = {};
    for (const [id, v] of Object.entries(obj)) {
      if (typeof v === "boolean") out[id] = v;
    }
    return out;
  }

  setModChoice(id: string, on: boolean): void {
    writeJson(this.storage, CHOICE_KEY, { ...this.getModChoices(), [id]: on });
  }

  /** Forget the player's decision, handing the mod back to the disk order. */
  clearModChoice(id: string): void {
    const next = this.getModChoices();
    delete next[id];
    writeJson(this.storage, CHOICE_KEY, next);
  }

  /**
   * Move an enabled mod one step earlier (-1) or later (+1) in load order, and
   * PIN the swap so a later auto-sort does not silently undo it.
   *
   * The pin is what makes the sort button usable. Without one, a player nudges a
   * mod, presses Auto-sort, and watches it jump back to wherever the authors'
   * suggestions put it - which teaches them never to press it again. LOOT solved
   * this the same way: its user rules outrank its masterlist.
   *
   * The pin records the pair the player just reordered, not an absolute
   * position, because an absolute index stops meaning anything the moment
   * another mod is installed.
   */
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
    const neighbour = cur[j];
    if (neighbour !== undefined) this.pinAgainst(id, neighbour, delta > 0 ? "after" : "before");
  }

  /* --- Load-order pins ------------------------------------------------ */

  /**
   * The player's explicit placements, as SortPins (mod-sdk sort.ts).
   *
   * Stored as a map of id -> {after, before} so repeated nudges accumulate
   * rather than each one replacing the last: a player who moves a mod past three
   * others has made three decisions, and a sort should honour all of them.
   */
  getPins(): SortPin[] {
    const obj = readJson<Record<string, unknown>>(this.storage, PINS_KEY, {});
    const out: SortPin[] = [];
    for (const [id, raw] of Object.entries(obj)) {
      const v = raw as { after?: unknown; before?: unknown } | null;
      const after = strings(v?.after);
      const before = strings(v?.before);
      if (after.length === 0 && before.length === 0) continue;
      out.push({
        id,
        ...(after.length ? { after } : {}),
        ...(before.length ? { before } : {}),
      });
    }
    return out;
  }

  /** Record that the player put `id` before/after `other`. */
  pinAgainst(id: string, other: string, side: "before" | "after"): void {
    if (id === other) return;
    const obj = readJson<Record<string, { after?: string[]; before?: string[] }>>(
      this.storage,
      PINS_KEY,
      {},
    );
    const entry = obj[id] ?? {};
    const list = new Set(entry[side] ?? []);
    list.add(other);
    /* The opposite side for the same pair is now stale - the player has changed
     * their mind, and keeping both would be a pin that contradicts itself and
     * gets dropped as a cycle with the player's own name on it. */
    const opposite = side === "after" ? "before" : "after";
    entry[opposite] = (entry[opposite] ?? []).filter((x) => x !== other);
    entry[side] = [...list];
    /* And the mirror on the OTHER mod's entry, for the same reason. */
    const otherEntry = obj[other] ?? {};
    otherEntry[side] = (otherEntry[side] ?? []).filter((x) => x !== id);
    obj[id] = entry;
    obj[other] = otherEntry;
    writeJson(this.storage, PINS_KEY, obj);
  }

  /** Forget every pin, so the next sort is the authors' answer alone. */
  clearPins(): void {
    writeJson(this.storage, PINS_KEY, {});
  }

  /* --- Section choices ------------------------------------------------ */

  /**
   * The player's explicit on/off for each mod's named sections, as
   * modId -> sectionId -> on.
   *
   * Keyed by MOD as well as section, unlike rule flags: a section id is only
   * unique within its own mod (`tiles` is a perfectly good id for two different
   * mods to use), and the flat rule-flag namespace is exactly the collision the
   * conflict report now has to warn about.
   */
  getSectionChoices(): Record<string, Record<string, boolean>> {
    const obj = readJson<Record<string, unknown>>(this.storage, SECTION_CHOICES_KEY, {});
    const out: Record<string, Record<string, boolean>> = {};
    for (const [modId, raw] of Object.entries(obj)) {
      if (typeof raw !== "object" || raw === null) continue;
      const table: Record<string, boolean> = {};
      for (const [sectionId, v] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof v === "boolean") table[sectionId] = v;
      }
      if (Object.keys(table).length > 0) out[modId] = table;
    }
    return out;
  }

  /** Record the player's explicit choice for one of a mod's sections. */
  setSectionChoice(modId: string, sectionId: string, on: boolean): void {
    const all = this.getSectionChoices();
    all[modId] = { ...(all[modId] ?? {}), [sectionId]: on };
    writeJson(this.storage, SECTION_CHOICES_KEY, all);
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

  /* --- Rule choices (Fixes & tweaks menu) ---------------------------- */

  /**
   * The player's explicit per-flag overrides for mod rules ("qol.autoDig",
   * "bugfix.*"). A flag ABSENT here means "use the mod's declared default", so
   * this stores only deliberate deviations - a fresh install has none and every
   * rule sits at its manifest default.
   *
   * Per the mod default policy every bundled patch declares `default: true`,
   * which means exactly "on once its own mod is enabled" - never "on in a fresh
   * install". A choice recorded here for a flag whose mod is currently disabled
   * is inert, because only an ENABLED mod's rules are ever resolved
   * (loadEnabledModRuleDecls -> resolveModRules): a disabled mod's patches do not
   * exist rather than sitting off. It is kept, not deleted, so re-enabling the
   * mod restores the player's opt-outs. No mod is enabled on a fresh install at
   * all (see DEFAULT_ENABLED_MODS), so an untouched install applies no rules.
   */
  getRuleChoices(): Record<string, boolean> {
    const obj = readJson<Record<string, unknown>>(this.storage, RULE_CHOICES_KEY, {});
    const out: Record<string, boolean> = {};
    for (const [flag, v] of Object.entries(obj)) {
      if (typeof v === "boolean") out[flag] = v;
    }
    return out;
  }

  /** Record the player's explicit choice for one rule flag. */
  setRuleChoice(flag: string, on: boolean): void {
    const all = this.getRuleChoices();
    all[flag] = on;
    writeJson(this.storage, RULE_CHOICES_KEY, all);
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

/**
 * Resolve the effective GameState.modRules map from the enabled mods' declared
 * rules and the player's saved choices: for each declared rule, the effective
 * value is `choices[flag] ?? rule.default`. Later declarations with the same
 * flag win (enabled/load order). Pure, so the host and the unit tests resolve
 * identically. The result is what startGame / loadGame get as opts.modRules; an
 * empty result (no rule-declaring mod enabled) leaves core faithful.
 */
export function resolveModRules(
  decls: readonly { rule: { flag: string; default: boolean } }[],
  choices: Readonly<Record<string, boolean>>,
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const { rule } of decls) {
    out[rule.flag] = choices[rule.flag] ?? rule.default;
  }
  return out;
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
    affectsGameplay: manifest.affectsGameplay ?? false,
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
  /* An id that is enabled and has no manifest anywhere: the mod was uninstalled,
   * or the game was reinstalled over a profile that still lists it. The game
   * goes on trying to load it on every boot, so the manager has to be able to
   * show it - a row the player can select and switch off beats a console line
   * they will never see. */
  const found = new Set(all.map((m) => m.id));
  for (const id of input.enabled) {
    if (found.has(id)) continue;
    all.push({
      id,
      name: id,
      version: "-",
      shape: "content",
      kind: "content",
      manifest: { id, name: id, version: "-", shape: "content" } as PackManifest,
      enabled: true,
      capabilities: [],
      nondeterministic: false,
      affectsGameplay: false,
      consented: true,
      missing: true,
    });
  }
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
