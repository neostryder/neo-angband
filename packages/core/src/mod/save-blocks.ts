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
 * would otherwise reach deserializeLevelCache on load and throw (D1). Terrain
 * features (the chunk feat grid / legend) are deliberately NOT quarantined:
 * removing a terrain cell would tear a hole in the map, so a mod feature is a
 * separate hard-incompatibility concern, not a quarantine case. Finer
 * sub-property granularity (a mod ego or brand on an otherwise-core object, a
 * mod origin-race on a core object) degrades to the base entity and is a
 * documented follow-up. The player-facing recoveries built ON TOP of this store
 * (stranded characters returning to town, mod items surfaced in the home, the
 * stash view) are P-UI work per MOD_LIFECYCLE section 6 step 2.
 */

import { parseId } from "./ids";
import type { SavedGame } from "../session/save";

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
  /** Content hash of the pack that produced the save (optional). */
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
  /* The birth_levels_persist frozen-level cache mirrors the live level's
   * id-bearing collections (a mod entity can hide there too), so it gets its
   * own quarantine/rehydrate. These carry the cache DEPTH in their locus. */
  | "cacheMonster"
  | "cacheHeldObject"
  | "cacheFloorObject"
  | "cacheTrap";

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
 * The base game's pack version (kept in sync with packages/core/package.json).
 * Core has no runtime version constant, so it is stated here; the manifest
 * records it as pack zero's version for the compatibility gate.
 */
export const CORE_PACK_VERSION = "0.1.0";

/** A core-only manifest: the base game with no mods, deterministic. */
export function coreOnlyManifest(): SaveManifest {
  return {
    packs: [{ id: "core", version: CORE_PACK_VERSION }],
    loadOrder: ["core"],
    determinism: "deterministic",
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
  for (let i = 0; i < out.monsters.length; i++) {
    const m = out.monsters[i];
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
      out.monsters[i] = null;
      removedMidx.add(m.midx);
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
  /* Repair groups: drop quarantined members; null a group whose leader left. */
  if (removedMidx.size > 0) {
    out.groups = out.groups.map((g) => {
      if (!g) return g;
      if (removedMidx.has(g.leader)) return null;
      return { ...g, members: g.members.filter((mi) => !removedMidx.has(mi)) };
    });
  }

  /* --- Gear objects (+ handle cleanup in pack and equipment). --- */
  const removedHandles = new Set<number>();
  const keptStore: SavedGame["gear"]["store"] = [];
  for (const [h, o] of out.gear.store) {
    const ns = namespaceOf(o.kindId);
    if (ns !== null && !present(ns)) {
      stash(orphans, ns, versionOf(ns), {
        kind: "gearObject",
        ref: o.kindId,
        data: o as unknown as JsonValue,
        locus: h,
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

  /* --- Traps (prune mod trap kinds; drop emptied cells). --- */
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
      /* Same group repair as the live level: drop quarantined members, null a
       * group whose leader left. (The rehydrate degradation - a restored cache
       * monster does not rebuild its group - is the documented live-level one.) */
      if (cacheRemovedMidx.size > 0) {
        level.groups = level.groups.map((g) => {
          if (!g) return g;
          if (cacheRemovedMidx.has(g.leader)) return null;
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

function reinsert(save: SavedGame, entry: OrphanEntry): void {
  switch (entry.kind) {
    case "monster": {
      const mon = entry.data as unknown as NonNullable<SavedGame["monsters"][number]>;
      const idx = entry.locus as number;
      /* Restore to its old slot when free, else append (a fresh slot). */
      if (idx >= 0 && idx < save.monsters.length && save.monsters[idx] === null) {
        save.monsters[idx] = mon;
      } else {
        save.monsters.push(mon);
      }
      return;
    }
    case "heldObject": {
      const midx = (entry.locus as { midx: number }).midx;
      const host = save.monsters.find((m) => m !== null && m.midx === midx);
      if (host) host.heldObj.push(entry.data as unknown as (typeof host.heldObj)[number]);
      return;
    }
    case "gearObject": {
      const handle = entry.locus as number;
      const obj = entry.data as unknown as SavedGame["gear"]["store"][number][1];
      save.gear.store.push([handle, obj]);
      /* Return to the pack: an inert re-equip is not attempted (the slot was
       * cleared on quarantine), so a reinstalled item comes back carried. */
      if (!save.gear.pack.includes(handle)) save.gear.pack.push(handle);
      return;
    }
    case "floorObject": {
      const { x, y } = entry.locus as { x: number; y: number };
      const obj = entry.data as unknown as SavedGame["floor"][number]["objs"][number];
      const pile = save.floor.find((p) => p.x === x && p.y === y);
      if (pile) pile.objs.push(obj);
      else save.floor.push({ x, y, objs: [obj] });
      return;
    }
    case "trap": {
      const { x, y } = entry.locus as { x: number; y: number };
      const trap = entry.data as unknown as SavedGame["traps"][number]["traps"][number];
      const cell = save.traps.find((c) => c.x === x && c.y === y);
      if (cell) cell.traps.push(trap);
      else save.traps.push({ x, y, traps: [trap] });
      return;
    }
    case "lore": {
      const raceId = entry.locus as string;
      const rec = entry.data as unknown as NonNullable<SavedGame["lore"]>[number][1];
      (save.lore ??= []).push([raceId, rec]);
      return;
    }
    case "artifactCreated": {
      const id = entry.locus as string;
      (save.artifactsCreated ??= []).push(id);
      return;
    }
    case "cacheMonster": {
      const { depth, index } = entry.locus as { depth: number; index: number };
      const level = save.levelCache?.find((l) => l.depth === depth);
      if (!level) return;
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
      return;
    }
    case "cacheHeldObject": {
      const { depth, midx } = entry.locus as { depth: number; midx: number };
      const level = save.levelCache?.find((l) => l.depth === depth);
      if (!level) return;
      const host = level.monsters.find((m) => m !== null && m.midx === midx);
      if (host) {
        host.heldObj.push(entry.data as unknown as (typeof host.heldObj)[number]);
      }
      return;
    }
    case "cacheFloorObject": {
      const { depth, x, y } = entry.locus as {
        depth: number;
        x: number;
        y: number;
      };
      const level = save.levelCache?.find((l) => l.depth === depth);
      if (!level) return;
      const obj = entry.data as unknown as (typeof level.floor)[number]["objs"][number];
      const pile = level.floor.find((p) => p.x === x && p.y === y);
      if (pile) pile.objs.push(obj);
      else level.floor.push({ x, y, objs: [obj] });
      return;
    }
    case "cacheTrap": {
      const { depth, x, y } = entry.locus as {
        depth: number;
        x: number;
        y: number;
      };
      const level = save.levelCache?.find((l) => l.depth === depth);
      if (!level) return;
      const trap = entry.data as unknown as (typeof level.traps)[number]["traps"][number];
      const cell = level.traps.find((c) => c.x === x && c.y === y);
      if (cell) cell.traps.push(trap);
      else level.traps.push({ x, y, traps: [trap] });
      return;
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
    for (const entry of entries) reinsert(out, entry);
  }
  if (orphanCount(remaining) > 0) out.orphans = remaining;
  else delete out.orphans;
  return out;
}
