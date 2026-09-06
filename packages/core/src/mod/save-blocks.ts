/**
 * Namespaced save blocks: the mod-lifecycle tiers layered over the flat JSON
 * save (MOD_LIFECYCLE.md section 1, P7 phase 2).
 *
 * Phase 1 (mod/ids.ts) made every content cross-reference a namespaced string
 * id. Phase 2 adds the three tiers the lifecycle design calls for on top of
 * that:
 *
 * - The MANIFEST block (SaveManifest): the exact pack set that produced the
 *   save - each pack's id/version (+ optional hash/source) and the resolved
 *   load order - plus the core-owned determinism mode. This is the save's
 *   profile fingerprint, and it travels WITH the save so a load can tell which
 *   content is missing and whether the run is still reproducible.
 * - Per-mod BAGS (mod:<id>): one opaque JSON bag per mod, versioned by the
 *   mod's saveSchema. The engine never interprets a bag; a scripted plugin
 *   persists whatever it likes and is the only thing that reads it back. A mod
 *   update migrates its OWN bag (migrateModBag); core never participates.
 * - The ORPHANS store (orphans:<id>@<version>): entities whose defining pack is
 *   missing or shadowed are QUARANTINED here - frozen, inert, removed from
 *   active play, but preserved verbatim - instead of being deleted or crashing
 *   the load. Reinstall the pack (same major) and rehydrateSave puts them back.
 *
 * The determinism mode is a core-owned one-way ratchet (MOD_LIFECYCLE section
 * 4, PORT_PLAN decision 22): a save starts "deterministic"; the first time a
 * nondeterministic mod is enabled on it, core flips it to "nondeterministic"
 * IRREVERSIBLY. Removing the mod never restores deterministic mode. Mods can
 * trip the flip but can never reverse or prevent it.
 *
 * Everything here is pure and deterministic over the plain-JSON save: quarantine
 * and rehydrate are read-time transforms of the SavedGame, so the on-disk
 * FORMAT (the optional blocks below) is the load-bearing part that lands now,
 * while the quarantine ALGORITHM can be refined later without a format change.
 *
 * SCOPE (documented, not silent): quarantine operates at whole-entity
 * granularity keyed on each entity's PRIMARY definition id - a monster's race,
 * an object's kind, a trap's kind, a lore record's race, a created-artifact id -
 * which is the "a whole frost:frost-wyrm on the level" / "an item whose
 * definition came from the missing mod" case the design centres on. This sweep
 * covers every id-bearing collection a real SavedGame can carry that entity in:
 * the live level (monsters + held objects, gear store / pack / equipment, floor
 * piles, traps, lore, created artifacts) AND the birth_levels_persist
 * frozen-level cache (save.levelCache), whose stored levels carry the same
 * monster / held-object / floor / trap collections - a mod entity frozen there
 * would otherwise reach deserializeLevelCache on load and throw (D1). A
 * quarantined monster's GROUP relationship and a quarantined item's EQUIPMENT
 * SLOT are also carried as their own orphans (kinds "group"/"groupMembership",
 * restored via the reinsert() cases of the same name) rather than dropped, so
 * reinstalling the mod restores the group as a group and the item to the slot
 * it was worn in, not a pack of strangers and a naked equipment array. Terrain
 * features (the chunk feat grid / legend) are deliberately NOT quarantined:
 * removing a terrain cell would tear a hole in the map, so a mod feature is a
 * separate hard-incompatibility concern, not a quarantine case. Finer
 * sub-property granularity (a mod ego or brand on an otherwise-core object, a
 * mod origin-race on a core object) degrades to the base entity and is a
 * documented follow-up. The player-facing recoveries built ON TOP of this store
 * (stranded characters returning to town, mod items surfaced in the home, the
 * stash view) are P-UI work per MOD_LIFECYCLE section 6 step 2.
 */

import { parseId } from "./ids.js";
import { ENGINE_VERSION } from "../version.js";
import type { SavedGame } from "../session/save.js";

/* ------------------------------------------------------------------ *
 * Value shapes.
 * ------------------------------------------------------------------ */

/** A plain JSON value - the shape of an opaque mod bag and an orphan payload. */
export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | { [key: string]: JsonValue };

/**
 * The core-owned determinism mode carried by every save. A one-way ratchet:
 * "deterministic" -> "nondeterministic" only, never back (see advanceDeterminism).
 */
export type DeterminismMode = "deterministic" | "nondeterministic";

/** One pack in the manifest: its identity and where it came from. */
export interface SavePackRef {
  /** Namespace / pack id, e.g. "core", "frost". */
  id: string;
  /** Semver version string, e.g. "1.2.0". */
  version: string;
  /**
   * Content hash of the pack that produced the save (optional).
   *
   * ABSENT MEANS UNMEASURED, NEVER "UNCHANGED" - the same convention
   * `InstalledModMeta.digests` and `SessionMod.digest` already use on the web
   * side. Compared by `mismatchedNamespaces` (below) against the SAME
   * namespace's current hash, when a caller has one: this is what lets a load
   * tell "this pack patched a record instead of only adding one, and the
   * patch is now different or gone" apart from an ordinary reload, which
   * `orphanedNamespaces` alone cannot (issue #20) - a PATCHED core record
   * still resolves under core's own, still-present namespace, so no entity is
   * ever orphaned by the patch going away.
   */
  hash?: string;
  /** Source (git URL + ref, or marketplace id) the pack was installed from. */
  source?: string;
}

/**
 * The manifest block: the exact pack set + resolved load order + determinism
 * mode that produced the save. The save's profile fingerprint.
 */
export interface SaveManifest {
  /** Every pack that contributed, keyed by id (order not significant here). */
  packs: SavePackRef[];
  /** The resolved load order (last-in-wins), pack ids in application order. */
  loadOrder: string[];
  /** The core-owned determinism mode (one-way ratchet). */
  determinism: DeterminismMode;
  /** True once a gameplay-affecting mod has made this save permanently non-scoring. */
  modNoscore: boolean;
}

/**
 * One mod's private save bag: opaque data the engine never interprets, tagged
 * with the saveSchema version that wrote it so the mod can migrate its own bag.
 */
export interface ModBag {
  /** The mod's saveSchema number when this bag was written. */
  schema: number;
  /** Whatever the mod chose to persist. Never read by core. */
  data: JsonValue;
}

/** The kind of entity an orphan payload holds (drives rehydration placement). */
export type OrphanKind =
  | "monster"
  | "heldObject"
  | "gearObject"
  | "floorObject"
  | "trap"
  | "lore"
  | "artifactCreated"
  /* A group whose LEADER was quarantined: the whole entry is frozen (not just
   * dropped), so a mod's monster pack comes back as a pack, not loose singles.
   * Keyed to the leader's own namespace/version - see the group-repair pass. */
  | "group"
  /* A plain MEMBER quarantined out of a group whose leader survived: the
   * group entry itself is kept live and edited in place, so this just
   * remembers "re-add this midx to that group" for when the member returns. */
  | "groupMembership"
  /* The birth_levels_persist frozen-level cache mirrors the live level's
   * id-bearing collections (a mod entity can hide there too), so it gets its
   * own quarantine/rehydrate. These carry the cache DEPTH in their locus. */
  | "cacheMonster"
  | "cacheHeldObject"
  | "cacheFloorObject"
  | "cacheTrap"
  | "cacheGroup"
  | "cacheGroupMembership";

/** One quarantined entity: frozen verbatim, tagged for the stash view + rehydrate. */
export interface OrphanEntry {
  /** Which collection it came from (drives where rehydrateSave puts it back). */
  kind: OrphanKind;
  /** The content id that could not resolve ("what it is" in the stash view). */
  ref: string;
  /** The original serialized payload, verbatim, for exact rehydration. */
  data: JsonValue;
  /** Where it lived, so rehydrate can restore its position. */
  locus: JsonValue;
}

/**
 * The orphans store, keyed "<namespace>@<version>" - the pack (at the version
 * that produced the save) whose absence quarantined these entities. Reinstalling
 * that pack (same major) is what rehydrates them.
 */
export type OrphanStore = Record<string, OrphanEntry[]>;

/* ------------------------------------------------------------------ *
 * The base game as pack zero.
 * ------------------------------------------------------------------ */

/**
 * The base game's pack version: pack zero's version in the save manifest.
 *
 * It used to be its own string literal, "kept in sync with
 * packages/core/package.json" by hand, and was not - core moved to 0.9.0 while
 * every new save went on recording core as 0.1.0. Core DOES have a runtime
 * version constant (version.ts, deliberately outside the barrel so citing it
 * makes no cycle), so it cites that instead.
 *
 * Changing it does not invalidate an older save: orphanedNamespaces skips the
 * core pack outright, and versionMap's versions are only ever used to key
 * quarantined MOD entities. An existing save keeps whatever it recorded.
 */
export const CORE_PACK_VERSION = ENGINE_VERSION;

/** A core-only manifest: the base game with no mods, deterministic. */
export function coreOnlyManifest(): SaveManifest {
  return {
    packs: [{ id: "core", version: CORE_PACK_VERSION }],
    loadOrder: ["core"],
    determinism: "deterministic",
    modNoscore: false,
  };
}

/* ------------------------------------------------------------------ *
 * Determinism ratchet (core-owned, one-way).
 * ------------------------------------------------------------------ */

/**
 * Advance the determinism mode (MOD_LIFECYCLE section 4). The flip to
 * "nondeterministic" is irreversible: once a save is nondeterministic it stays
 * so regardless of the argument, so removing a mod can never "cleanse" a save
 * back to deterministic. Enabling a nondeterministic mod on a still-deterministic
 * save flips it once, seamlessly.
 */
export function advanceDeterminism(
  current: DeterminismMode,
  enablingNondeterministicMod: boolean,
): DeterminismMode {
  if (current === "nondeterministic") return "nondeterministic";
  return enablingNondeterministicMod ? "nondeterministic" : "deterministic";
}

/** Advance the permanent scoring ratchet for gameplay-affecting mods. */
export function advanceModNoscore(
  current: boolean,
  enablingGameplayMod: boolean,
): boolean {
  return current || enablingGameplayMod;
}

/* ------------------------------------------------------------------ *
 * Mod-bag migration seam.
 * ------------------------------------------------------------------ */

/** A mod's own bag migrator: old data + the schema it was written at -> new data. */
export type BagMigrator = (data: JsonValue, fromSchema: number) => JsonValue;

/**
 * Migrate one mod bag to a target saveSchema (called at mod-load time when the
 * mod's schema has advanced past the bag's). A no-op when the bag is already at
 * or beyond the target; otherwise the mod's migrator rewrites its own data and
 * the schema is stamped forward. Core never inspects `data`.
 */
export function migrateModBag(
  bag: ModBag,
  targetSchema: number,
  migrate: BagMigrator,
): ModBag {
  if (bag.schema >= targetSchema) return bag;
  return { schema: targetSchema, data: migrate(bag.data, bag.schema) };
}

/* ------------------------------------------------------------------ *
 * Compatibility assessment (which namespaces are orphaned).
 * ------------------------------------------------------------------ */

/**
 * Compare the pack set that produced a save against the packs present now, and
 * return the namespaces whose content is orphaned (present in the save's
 * manifest but not currently loaded). "core" is never orphaned - a save whose
 * core is absent is an engine-incompatibility that the load rejects outright,
 * not a quarantine case.
 *
 * The harder REFUSE-to-load gate (a still-enabled mod's REQUIRED dependency is
 * missing) is the load-order resolver's job (mod-sdk resolveLoadOrder, phase 4);
 * this function is only the save-side "what did this save use that is gone now".
 */
export function orphanedNamespaces(
  manifest: SaveManifest,
  present: ReadonlySet<string>,
): string[] {
  const out: string[] = [];
  for (const pack of manifest.packs) {
    if (pack.id === "core") continue;
    if (!present.has(pack.id)) out.push(pack.id);
  }
  return out;
}

/**
 * Compare the pack set that produced a save against the packs present NOW,
 * for the namespaces on BOTH sides - the sibling case `orphanedNamespaces`
 * cannot see (issue #20). A pack that ADDS content and later goes away leaves
 * an orphan behind (its own ids no longer resolve, so quarantine catches it);
 * a pack that only PATCHES an existing record - a session mod re-pricing a
 * core sword's damage, say - leaves nothing behind to orphan, because the
 * record it touched still resolves under its own, still-present namespace.
 * The composed value from save time is simply gone, silently, on the next
 * load. This is that load's chance to notice: it returns the namespaces whose
 * recorded hash and current hash are both known and disagree.
 *
 * "core" is never reported: core's own content changing between builds is an
 * engine-version question (ENGINE_VERSION / SAVE_VERSION), not a mod-patch one.
 *
 * A namespace missing a hash on EITHER side is never reported - not measured
 * is not the same claim as changed, and a false "this mod changed" alarm off
 * a gap in the data would be worse than the silent gap this function exists
 * to close. `currentPacks` need not cover every present namespace: a caller
 * that cannot measure a pack's current content simply omits it, and that
 * pack's own comparison is skipped rather than guessed at.
 */
export function mismatchedNamespaces(
  manifest: SaveManifest,
  currentPacks: readonly SavePackRef[],
): string[] {
  const current = new Map(currentPacks.map((p) => [p.id, p]));
  const out: string[] = [];
  for (const recorded of manifest.packs) {
    if (recorded.id === "core") continue;
    if (!recorded.hash) continue;
    const now = current.get(recorded.id);
    if (!now?.hash) continue;
    if (now.hash !== recorded.hash) out.push(recorded.id);
  }
  return out;
}

/**
 * Fold the packs present now into a manifest's pack list, for the NEXT save to
 * carry forward: a namespace `currentPacks` supplies replaces whatever was
 * recorded for it (so a changed hash/version is what the next
 * `mismatchedNamespaces`/`orphanedNamespaces` call compares against); a
 * namespace it does NOT supply keeps its old recorded entry untouched, rather
 * than being dropped, so a pack this host cannot currently measure - or one
 * that has gone away entirely - is still there for `orphanedNamespaces` to
 * find missing later. Pure: neither argument is mutated.
 */
export function reconcilePackManifest(
  manifest: SaveManifest,
  currentPacks: readonly SavePackRef[],
): SaveManifest {
  const current = new Map(currentPacks.map((p) => [p.id, p]));
  const seen = new Set<string>();
  const packs: SavePackRef[] = [];
  for (const recorded of manifest.packs) {
    packs.push(current.get(recorded.id) ?? recorded);
    seen.add(recorded.id);
  }
  for (const pack of currentPacks) {
    if (!seen.has(pack.id)) packs.push(pack);
  }
  return { ...manifest, packs };
}

/** The version each pack was at when the save was written (for orphan keys). */
function versionMap(manifest: SaveManifest): Map<string, string> {
  const m = new Map<string, string>();
  for (const pack of manifest.packs) m.set(pack.id, pack.version);
  return m;
}

/* ------------------------------------------------------------------ *
 * Orphan store helpers.
 * ------------------------------------------------------------------ */

/** The total number of quarantined entities across the store (decision-8 count). */
export function orphanCount(store: OrphanStore | undefined): number {
  if (!store) return 0;
  let n = 0;
  for (const entries of Object.values(store)) n += entries.length;
  return n;
}

function orphanKey(namespace: string, version: string): string {
  return `${namespace}@${version}`;
}

function stash(
  store: OrphanStore,
  namespace: string,
  version: string,
  entry: OrphanEntry,
): void {
  const key = orphanKey(namespace, version);
  (store[key] ??= []).push(entry);
}

/** Merge two orphan stores (append, preserving order), returning a new store. */
function mergeOrphans(a: OrphanStore, b: OrphanStore): OrphanStore {
  const out: OrphanStore = {};
  for (const [k, v] of Object.entries(a)) out[k] = [...v];
  for (const [k, v] of Object.entries(b)) out[k] = [...(out[k] ?? []), ...v];
  return out;
}

/** The namespace of a content id, or null when it has none (malformed / bare). */
export function namespaceOf(id: string): string | null {
  const parsed = parseId(id);
  return parsed ? parsed.namespace : null;
}

function jsonClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/* ------------------------------------------------------------------ *
 * Quarantine (prune a save's mod-owned entities into the orphans store).
 * ------------------------------------------------------------------ */

/** The outcome of a quarantine pass. */
export interface QuarantineResult {
  /** The save with orphaned entities removed and folded into `orphans`. */
  save: SavedGame;
  /** The merged orphan store (any pre-existing orphans + the newly quarantined). */
  orphans: OrphanStore;
  /** How many entities were newly quarantined THIS pass. */
  quarantined: number;
}

/** Split an object list by whether each object's kind namespace is present. */
function partitionObjects<T extends { kindId: string }>(
  objs: readonly T[],
  present: (namespace: string) => boolean,
): { kept: T[]; orphaned: Array<{ obj: T; ns: string }> } {
  const kept: T[] = [];
  const orphaned: Array<{ obj: T; ns: string }> = [];
  for (const o of objs) {
    const ns = namespaceOf(o.kindId);
    if (ns !== null && !present(ns)) orphaned.push({ obj: o, ns });
    else kept.push(o);
  }
  return { kept, orphaned };
}

/**
 * Move every entity whose defining pack is absent into the orphans store,
 * returning a pruned save whose remaining content all resolves against the
 * present packs (so the normal deserializers never see a missing-mod id). Pure:
 * the input save is not mutated. Any orphans already carried by the save are
 * preserved and merged with the newly quarantined set.
 *
 * `present(namespace)` decides membership; `orphanedNamespaces` computes the
 * missing set from the manifest, and the manifest supplies each pack's version
 * for the orphan-store key.
 */
export function quarantineSave(
  save: SavedGame,
  manifest: SaveManifest,
  present: (namespace: string) => boolean,
): QuarantineResult {
  const out = jsonClone(save);
  const versions = versionMap(manifest);
  const versionOf = (ns: string): string => versions.get(ns) ?? "0.0.0";
  const orphans: OrphanStore = {};
  let quarantined = 0;

  /* --- Monsters (whole instances) + their held objects + group repair. --- */
  const removedMidx = new Set<number>();
  /* Which namespace/version quarantined each midx, so the group-repair pass
   * below can key a group/groupMembership orphan to the same mod that owns
   * the monster it's tracking - see OrphanKind's "group"/"groupMembership". */
  const removedMidxNs = new Map<number, { ns: string; version: string }>();
  const monsters = out.monsters;
  for (const [i, m] of (monsters ?? []).entries()) {
    if (!m) continue;
    const rns = namespaceOf(m.raceId);
    const ons = m.originalRaceId ? namespaceOf(m.originalRaceId) : null;
    const missing =
      rns !== null && !present(rns)
        ? rns
        : ons !== null && !present(ons)
          ? ons
          : null;
    if (missing !== null) {
      stash(orphans, missing, versionOf(missing), {
        kind: "monster",
        ref: m.raceId,
        data: m as unknown as JsonValue,
        locus: i,
      });
      monsters![i] = null;
      removedMidx.add(m.midx);
      removedMidxNs.set(m.midx, { ns: missing, version: versionOf(missing) });
      quarantined++;
      continue;
    }
    /* Kept monster (core race): prune any mod-owned held objects so a later
     * deserialize does not hit a missing-mod kind. */
    const { kept, orphaned } = partitionObjects(m.heldObj, present);
    if (orphaned.length > 0) {
      m.heldObj = kept;
      for (const { obj, ns } of orphaned) {
        stash(orphans, ns, versionOf(ns), {
          kind: "heldObject",
          ref: obj.kindId,
          data: obj as unknown as JsonValue,
          locus: { midx: m.midx },
        });
        quarantined++;
      }
    }
  }
  /* Repair groups: a quarantined LEADER takes the whole group with it (frozen
   * as one "group" orphan, not silently discarded, so a mod's monster pack
   * comes back as a pack); a quarantined plain MEMBER is dropped from the
   * live members list but remembered as a "groupMembership" orphan, since the
   * group itself stays live and just needs that midx pushed back on return. */
  if (removedMidx.size > 0 && out.groups) {
    out.groups = out.groups.map((g, gi) => {
      if (!g) return g;
      if (removedMidx.has(g.leader)) {
        const ns = removedMidxNs.get(g.leader);
        if (ns) {
          stash(orphans, ns.ns, ns.version, {
            kind: "group",
            ref: String(g.leader),
            data: g as unknown as JsonValue,
            locus: gi,
          });
          quarantined++;
        }
        return null;
      }
      for (const mi of g.members) {
        if (!removedMidx.has(mi)) continue;
        const ns = removedMidxNs.get(mi);
        if (!ns) continue;
        stash(orphans, ns.ns, ns.version, {
          kind: "groupMembership",
          ref: String(mi),
          data: mi,
          locus: gi,
        });
        quarantined++;
      }
      return { ...g, members: g.members.filter((mi) => !removedMidx.has(mi)) };
    });
  }

  /* --- Gear objects (+ handle cleanup in pack and equipment). --- */
  const removedHandles = new Set<number>();
  const keptStore: SavedGame["gear"]["store"] = [];
  for (const [h, o] of out.gear.store) {
    const ns = namespaceOf(o.kindId);
    if (ns !== null && !present(ns)) {
      /* Read BEFORE player.equipment is zeroed below, so an equipped item
       * can be put back in its own slot on return rather than only in pack. */
      const equipSlots: number[] = [];
      out.player.equipment.forEach((eh, si) => {
        if (eh === h) equipSlots.push(si);
      });
      stash(orphans, ns, versionOf(ns), {
        kind: "gearObject",
        ref: o.kindId,
        data: o as unknown as JsonValue,
        locus: { handle: h, equipSlots },
      });
      removedHandles.add(h);
      quarantined++;
    } else {
      keptStore.push([h, o]);
    }
  }
  if (removedHandles.size > 0) {
    out.gear = {
      ...out.gear,
      store: keptStore,
      pack: out.gear.pack.filter((h) => !removedHandles.has(h)),
    };
    out.player = {
      ...out.player,
      equipment: out.player.equipment.map((h) =>
        removedHandles.has(h) ? 0 : h,
      ),
    };
  }

  /* --- Floor piles (prune mod objects; drop emptied piles). --- */
  if (out.floor) {
    out.floor = out.floor
      .map((pile) => {
        const { kept, orphaned } = partitionObjects(pile.objs, present);
        for (const { obj, ns } of orphaned) {
          stash(orphans, ns, versionOf(ns), {
            kind: "floorObject",
            ref: obj.kindId,
            data: obj as unknown as JsonValue,
            locus: { x: pile.x, y: pile.y },
          });
          quarantined++;
        }
        return { ...pile, objs: kept };
      })
      .filter((pile) => pile.objs.length > 0);
  }

  /* --- Traps (prune mod trap kinds; drop emptied cells). --- */
  if (out.traps) {
    out.traps = out.traps
      .map((cell) => {
        const keptTraps: typeof cell.traps = [];
        for (const t of cell.traps) {
          const ns = namespaceOf(t.trapId);
          if (ns !== null && !present(ns)) {
            stash(orphans, ns, versionOf(ns), {
              kind: "trap",
              ref: t.trapId,
              data: t as unknown as JsonValue,
              locus: { x: cell.x, y: cell.y },
            });
            quarantined++;
          } else {
            keptTraps.push(t);
          }
        }
        return { ...cell, traps: keptTraps };
      })
      .filter((cell) => cell.traps.length > 0);
  }

  /* --- Lore (keyed by race id). --- */
  if (out.lore) {
    const keptLore: NonNullable<SavedGame["lore"]> = [];
    for (const [raceId, l] of out.lore) {
      const ns = namespaceOf(raceId);
      if (ns !== null && !present(ns)) {
        stash(orphans, ns, versionOf(ns), {
          kind: "lore",
          ref: raceId,
          data: l as unknown as JsonValue,
          locus: raceId,
        });
        quarantined++;
      } else {
        keptLore.push([raceId, l]);
      }
    }
    out.lore = keptLore;
  }

  /* --- Created-artifact ids. --- */
  if (out.artifactsCreated) {
    const keptArts: string[] = [];
    for (const aid of out.artifactsCreated) {
      const ns = namespaceOf(aid);
      if (ns !== null && !present(ns)) {
        stash(orphans, ns, versionOf(ns), {
          kind: "artifactCreated",
          ref: aid,
          data: aid,
          locus: aid,
        });
        quarantined++;
      } else {
        keptArts.push(aid);
      }
    }
    out.artifactsCreated = keptArts;
  }

  /* --- Frozen-level cache (birth_levels_persist, #30). Each cached level
   * carries the same id-bearing collections as the live level, so a mod entity
   * can hide there exactly as on the live level. Quarantine each cached level
   * the same way, tagging every orphan's locus with the cache DEPTH so rehydrate
   * restores it to the right frozen level. Without this pass a mod monster /
   * held object / floor object / trap frozen in the cache would survive
   * quarantine and reach deserializeLevelCache on load, throwing on its
   * unresolvable id (PORT_PLAN decision 19, MOD_LIFECYCLE section 6). --- */
  if (out.levelCache) {
    for (const level of out.levelCache) {
      const depth = level.depth;
      const cacheRemovedMidx = new Set<number>();
      const cacheRemovedMidxNs = new Map<number, { ns: string; version: string }>();
      for (let i = 0; i < level.monsters.length; i++) {
        const m = level.monsters[i];
        if (!m) continue;
        const rns = namespaceOf(m.raceId);
        const ons = m.originalRaceId ? namespaceOf(m.originalRaceId) : null;
        const missing =
          rns !== null && !present(rns)
            ? rns
            : ons !== null && !present(ons)
              ? ons
              : null;
        if (missing !== null) {
          stash(orphans, missing, versionOf(missing), {
            kind: "cacheMonster",
            ref: m.raceId,
            data: m as unknown as JsonValue,
            locus: { depth, index: i },
          });
          level.monsters[i] = null;
          cacheRemovedMidx.add(m.midx);
          cacheRemovedMidxNs.set(m.midx, { ns: missing, version: versionOf(missing) });
          quarantined++;
          continue;
        }
        const { kept, orphaned } = partitionObjects(m.heldObj, present);
        if (orphaned.length > 0) {
          m.heldObj = kept;
          for (const { obj, ns } of orphaned) {
            stash(orphans, ns, versionOf(ns), {
              kind: "cacheHeldObject",
              ref: obj.kindId,
              data: obj as unknown as JsonValue,
              locus: { depth, midx: m.midx },
            });
            quarantined++;
          }
        }
      }
      /* Same group repair as the live level (a quarantined leader's group is
       * frozen whole as a "cacheGroup" orphan; a quarantined plain member is
       * remembered as a "cacheGroupMembership" orphan for that live group). */
      if (cacheRemovedMidx.size > 0) {
        level.groups = level.groups.map((g, gi) => {
          if (!g) return g;
          if (cacheRemovedMidx.has(g.leader)) {
            const ns = cacheRemovedMidxNs.get(g.leader);
            if (ns) {
              stash(orphans, ns.ns, ns.version, {
                kind: "cacheGroup",
                ref: String(g.leader),
                data: g as unknown as JsonValue,
                locus: { depth, groupIndex: gi },
              });
              quarantined++;
            }
            return null;
          }
          for (const mi of g.members) {
            if (!cacheRemovedMidx.has(mi)) continue;
            const ns = cacheRemovedMidxNs.get(mi);
            if (!ns) continue;
            stash(orphans, ns.ns, ns.version, {
              kind: "cacheGroupMembership",
              ref: String(mi),
              data: mi,
              locus: { depth, groupIndex: gi },
            });
            quarantined++;
          }
          return {
            ...g,
            members: g.members.filter((mi) => !cacheRemovedMidx.has(mi)),
          };
        });
      }
      level.floor = level.floor
        .map((pile) => {
          const { kept, orphaned } = partitionObjects(pile.objs, present);
          for (const { obj, ns } of orphaned) {
            stash(orphans, ns, versionOf(ns), {
              kind: "cacheFloorObject",
              ref: obj.kindId,
              data: obj as unknown as JsonValue,
              locus: { depth, x: pile.x, y: pile.y },
            });
            quarantined++;
          }
          return { ...pile, objs: kept };
        })
        .filter((pile) => pile.objs.length > 0);
      level.traps = level.traps
        .map((cell) => {
          const keptTraps: typeof cell.traps = [];
          for (const t of cell.traps) {
            const ns = namespaceOf(t.trapId);
            if (ns !== null && !present(ns)) {
              stash(orphans, ns, versionOf(ns), {
                kind: "cacheTrap",
                ref: t.trapId,
                data: t as unknown as JsonValue,
                locus: { depth, x: cell.x, y: cell.y },
              });
              quarantined++;
            } else {
              keptTraps.push(t);
            }
          }
          return { ...cell, traps: keptTraps };
        })
        .filter((cell) => cell.traps.length > 0);
    }
  }

  const merged = mergeOrphans(out.orphans ?? {}, orphans);
  if (orphanCount(merged) > 0) out.orphans = merged;
  return { save: out, orphans: merged, quarantined };
}

/* ------------------------------------------------------------------ *
 * Rehydrate (restore orphans whose pack is present again).
 * ------------------------------------------------------------------ */

function reinsert(save: SavedGame, entry: OrphanEntry): boolean {
  switch (entry.kind) {
    case "monster": {
      if (!save.monsters) return false;
      const mon = entry.data as unknown as NonNullable<
        NonNullable<SavedGame["monsters"]>[number]
      >;
      const idx = entry.locus as number;
      /* Restore to its old slot when free, else append (a fresh slot). */
      if (idx >= 0 && idx < save.monsters.length && save.monsters[idx] === null) {
        save.monsters[idx] = mon;
      } else {
        save.monsters.push(mon);
      }
      return true;
    }
    case "heldObject": {
      if (!save.monsters) return false;
      const midx = (entry.locus as { midx: number }).midx;
      const host = save.monsters.find((m) => m !== null && m.midx === midx);
      if (!host) return false;
      host.heldObj.push(entry.data as unknown as (typeof host.heldObj)[number]);
      return true;
    }
    case "group": {
      if (!save.groups) return false;
      const gi = entry.locus as number;
      const group = entry.data as unknown as NonNullable<SavedGame["groups"]>[number];
      if (gi >= 0 && gi < save.groups.length && save.groups[gi] === null) {
        save.groups[gi] = group;
      } else {
        save.groups.push(group);
      }
      return true;
    }
    case "groupMembership": {
      if (!save.groups) return false;
      const groupIndex = entry.locus as number;
      const midx = entry.data as unknown as number;
      const group = save.groups[groupIndex];
      if (!group) return false;
      if (!group.members.includes(midx)) group.members.push(midx);
      return true;
    }
    case "gearObject": {
      const { handle, equipSlots } = entry.locus as {
        handle: number;
        equipSlots: number[];
      };
      const obj = entry.data as unknown as SavedGame["gear"]["store"][number][1];
      save.gear.store.push([handle, obj]);
      /* Re-equip into the exact slot(s) it was quarantined out of, but only if
       * nothing else has since taken that slot (still 0) - a best-effort exact
       * restore, never displacing whatever the player equipped in the
       * meantime. Pack and equipment are exclusive (an owned handle lives in
       * one or the other, never both - see buildModdedSave in
       * dehydrate-roundtrip.test.ts), so only fall back to "carried in pack"
       * when the item was never equipped, or its slot is no longer free. */
      let reequipped = false;
      for (const slot of equipSlots) {
        if (save.player.equipment[slot] === 0) {
          save.player.equipment[slot] = handle;
          reequipped = true;
        }
      }
      if (!reequipped && !save.gear.pack.includes(handle)) save.gear.pack.push(handle);
      return true;
    }
    case "floorObject": {
      if (!save.floor) return false;
      const { x, y } = entry.locus as { x: number; y: number };
      const obj = entry.data as unknown as NonNullable<
        SavedGame["floor"]
      >[number]["objs"][number];
      const pile = save.floor.find((p) => p.x === x && p.y === y);
      if (pile) pile.objs.push(obj);
      else save.floor.push({ x, y, objs: [obj] });
      return true;
    }
    case "trap": {
      if (!save.traps) return false;
      const { x, y } = entry.locus as { x: number; y: number };
      const trap = entry.data as unknown as NonNullable<
        SavedGame["traps"]
      >[number]["traps"][number];
      const cell = save.traps.find((c) => c.x === x && c.y === y);
      if (cell) cell.traps.push(trap);
      else save.traps.push({ x, y, traps: [trap] });
      return true;
    }
    case "lore": {
      const raceId = entry.locus as string;
      const rec = entry.data as unknown as NonNullable<SavedGame["lore"]>[number][1];
      (save.lore ??= []).push([raceId, rec]);
      return true;
    }
    case "artifactCreated": {
      const id = entry.locus as string;
      (save.artifactsCreated ??= []).push(id);
      return true;
    }
    case "cacheMonster": {
      const { depth, index } = entry.locus as { depth: number; index: number };
      const level = save.levelCache?.find((l) => l.depth === depth);
      if (!level) return false;
      const mon = entry.data as unknown as NonNullable<
        NonNullable<SavedGame["levelCache"]>[number]["monsters"][number]
      >;
      if (
        index >= 0 &&
        index < level.monsters.length &&
        level.monsters[index] === null
      ) {
        level.monsters[index] = mon;
      } else {
        level.monsters.push(mon);
      }
      return true;
    }
    case "cacheHeldObject": {
      const { depth, midx } = entry.locus as { depth: number; midx: number };
      const level = save.levelCache?.find((l) => l.depth === depth);
      if (!level) return false;
      const host = level.monsters.find((m) => m !== null && m.midx === midx);
      if (!host) return false;
      host.heldObj.push(entry.data as unknown as (typeof host.heldObj)[number]);
      return true;
    }
    case "cacheGroup": {
      const { depth, groupIndex } = entry.locus as {
        depth: number;
        groupIndex: number;
      };
      const level = save.levelCache?.find((l) => l.depth === depth);
      if (!level) return false;
      const group = entry.data as unknown as (typeof level.groups)[number];
      if (
        groupIndex >= 0 &&
        groupIndex < level.groups.length &&
        level.groups[groupIndex] === null
      ) {
        level.groups[groupIndex] = group;
      } else {
        level.groups.push(group);
      }
      return true;
    }
    case "cacheGroupMembership": {
      const { depth, groupIndex } = entry.locus as {
        depth: number;
        groupIndex: number;
      };
      const midx = entry.data as unknown as number;
      const level = save.levelCache?.find((l) => l.depth === depth);
      if (!level) return false;
      const group = level.groups[groupIndex];
      if (!group) return false;
      if (!group.members.includes(midx)) group.members.push(midx);
      return true;
    }
    case "cacheFloorObject": {
      const { depth, x, y } = entry.locus as {
        depth: number;
        x: number;
        y: number;
      };
      const level = save.levelCache?.find((l) => l.depth === depth);
      if (!level) return false;
      const obj = entry.data as unknown as (typeof level.floor)[number]["objs"][number];
      const pile = level.floor.find((p) => p.x === x && p.y === y);
      if (pile) pile.objs.push(obj);
      else level.floor.push({ x, y, objs: [obj] });
      return true;
    }
    case "cacheTrap": {
      const { depth, x, y } = entry.locus as {
        depth: number;
        x: number;
        y: number;
      };
      const level = save.levelCache?.find((l) => l.depth === depth);
      if (!level) return false;
      const trap = entry.data as unknown as (typeof level.traps)[number]["traps"][number];
      const cell = level.traps.find((c) => c.x === x && c.y === y);
      if (cell) cell.traps.push(trap);
      else level.traps.push({ x, y, traps: [trap] });
      return true;
    }
  }
}

/**
 * Restore quarantined entities whose pack is present again, returning a save
 * with those orphans reinserted and dropped from the store; orphans whose pack
 * is still absent stay quarantined. Pure: the input save is not mutated.
 *
 * The inverse of quarantineSave for the common "reinstall the mod" path. Two
 * documented, deliberate degradations: a rehydrated monster does not rebuild its
 * old group cohesion (its group entry may have been dissolved on quarantine),
 * and a rehydrated equipped item returns to the pack rather than auto-re-equipping.
 */
export function rehydrateSave(
  save: SavedGame,
  present: (namespace: string) => boolean,
): SavedGame {
  if (!save.orphans) return save;
  const out = jsonClone(save);
  const remaining: OrphanStore = {};
  for (const [key, entries] of Object.entries(out.orphans!)) {
    const ns = key.split("@")[0] ?? key;
    if (!present(ns)) {
      remaining[key] = entries;
      continue;
    }
    for (const entry of entries) {
      if (!reinsert(out, entry)) (remaining[key] ??= []).push(entry);
    }
  }
  if (orphanCount(remaining) > 0) out.orphans = remaining;
  else delete out.orphans;
  return out;
}
