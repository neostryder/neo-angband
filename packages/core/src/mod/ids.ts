/**
 * Content ids: the load-bearing rule of the mod substrate (MOD_LIFECYCLE.md
 * section 1, decision 19/1). Saves reference content by a stable namespaced
 * string id - `core:kobold`, `frost:frost-wyrm` - never by a numeric array
 * index. Upstream Angband serializes an r_idx / k_idx (an array position);
 * add or remove one record and every later index shifts, silently corrupting
 * older saves. Ids never move: adding, removing, or reordering content leaves
 * every existing id pointing at the same thing.
 *
 * An id is `<namespace>:<localid>`. The namespace is the owning pack (`core`
 * for the base game, pack zero). The localid is derived from the entity's own
 * stable fields (its name/code, and for object kinds its tval) - so for the
 * overwhelming majority of content it is identical no matter what else is
 * loaded; only genuine duplicate names take an order-dependent suffix (see
 * below). The localid is only required to be unique WITHIN its registry and
 * namespace: an id's entity TYPE is implied by where it appears in the save (a
 * kind reference is always a kind id), so a kind and a race may share a
 * localid without ambiguity.
 *
 * This module is the one place ids are minted and resolved. The
 * ContentIdResolver builds both directions (index <-> id) once from the bound
 * registries.
 *
 * Duplicate names are real. Angband content is not name-unique: some egos
 * ship twice under one name (e.g. "of Slay Animal" for both melee and
 * launchers), several traps share a name with different effects ("dart trap"
 * appears three times), and the "greater" variants ("*Healing*" vs "Healing")
 * slug to the same token. A raw name therefore cannot be the key. When two
 * entities in one registry would mint the same localid, the later one (in the
 * registry's own binding order) gets a numeric suffix - `of-slay-animal`,
 * `of-slay-animal-2`. This is deterministic and applied identically when
 * writing and when reading a save, so the round-trip is exact. It is stable
 * as long as content is APPENDED (mods live in their own namespace; core's
 * frozen datafiles and cross-version additions append), which is the same
 * append-only assumption every mod ecosystem relies on - and strictly less
 * fragile than upstream's bare-index scheme, which breaks on ANY reorder.
 *
 * "MODS LIVE IN THEIR OWN NAMESPACE" WAS A DESCRIPTION OF THE DESIGN AND NOT OF
 * THE CODE until 0.19.0. Every resolver was built with the default namespace, so
 * everything - core's kobold and a mod's alike - was minted under `core:`, and
 * the sentence above quietly became its own opposite: a mod's records did NOT
 * append into a space of their own, they collided with core's and took the
 * suffix. Which suffix depended on which mods were enabled and in what order,
 * in a string embedded in the player's save. The namespace now comes from the
 * record's own provenance (mod/extension.ts), which is what this paragraph has
 * claimed all along. IdTable.index carries the compatibility half.
 *
 * "IDS NEVER MOVE" HAD ONE MORE HOLE IN IT, and it was a PATCH rather than a
 * reorder (task #233, measured 2026-08-10). A localid is derived from the
 * record's own name or code, so a mod that patched the NAME of a record it does
 * not own moved that record's id: install a mod that renames Grip and
 * `core:grip-farmer-maggot-s-dog` - the string in every save written before the
 * mod - resolved to nothing, while turning the mod off left the newly minted id
 * dangling instead. The rule now is that a record's id is fixed by the pack that
 * DEFINED it and a patch cannot move it, in whatever namespace: it protects a
 * mod's records from a LATER mod's rename exactly as it protects core's, because
 * nothing in the mechanism mentions `core`. See `definedAt` below for how the
 * definer's spelling survives composition.
 */

import { TVAL_ENTRIES } from "../generated/index.js";
import type { ObjRegistry } from "../obj/bind.js";
import type { MonsterRace } from "../mon/types.js";
import type { PlayerClass, PlayerRace } from "../player/types.js";
import type { FeatureRegistry } from "../world/feature.js";
import type { TrapKind } from "../world/trap.js";
import type { ModExtensible } from "./extension.js";

/** The base game's namespace (pack zero). */
export const CORE_NS = "core";

/** The namespace / localid separator (localids may contain further colons). */
export const ID_SEP = ":";

/**
 * Kebab-slug a display name or code into an id-safe token: lowercase, every
 * run of non-alphanumerics collapsed to a single hyphen, leading/trailing
 * hyphens trimmed. Deterministic and pure, so the same name always yields the
 * same token. "Ring of Barahir" -> "ring-of-barahir", "FIRE_3" -> "fire-3".
 */
export function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Compose a namespaced id from a namespace and a localid. */
export function makeId(namespace: string, localid: string): string {
  return namespace + ID_SEP + localid;
}

/** A core-namespaced id from a localid. */
export function coreId(localid: string): string {
  return makeId(CORE_NS, localid);
}

/**
 * Split an id into its namespace and localid on the FIRST separator only, so
 * a localid may itself contain the separator (object kinds use `tval:name`).
 * Returns null when the string carries no separator.
 */
export function parseId(id: string): { namespace: string; localid: string } | null {
  const at = id.indexOf(ID_SEP);
  if (at < 0) return null;
  return { namespace: id.slice(0, at), localid: id.slice(at + 1) };
}

/* ------------------------------------------------------------------ *
 * Localid minting (pure functions of a single entity).
 * ------------------------------------------------------------------ */

/**
 * An object kind's localid is `<tval>:<name>`, both slugged: the kind name
 * alone is not unique across tvals (a base "Dagger" and a hypothetical potion
 * of the same name would collide), but tval+name is the natural key upstream
 * lookup_kind uses. The sval is deliberately NOT part of the id: svals are
 * assigned in file order and shift when kinds are inserted, exactly the
 * fragility ids exist to avoid.
 */
export function kindLocalId(tval: number, name: string): string {
  const tv = TVAL_ENTRIES[tval];
  return slug(tv ? tv.textName : String(tval)) + ID_SEP + slug(name);
}

/* ------------------------------------------------------------------ *
 * The resolver.
 * ------------------------------------------------------------------ */

/**
 * The registries the resolver needs; a subset of CoreRegistries. Only
 * `objects` is required: the monster / feature / trap registries are optional
 * so a caller that only serializes object references (a focused test) can build
 * a partial resolver. Production (loadGame/saveGame) always passes the full set.
 */
export interface ContentIdRegistries {
  objects: ObjRegistry;
  monsters?: { races: readonly MonsterRace[] };
  features?: FeatureRegistry;
  traps?: readonly TrapKind[] | null;
  /**
   * Player races/classes are optional: the save format does not reference them
   * by id (a character carries its own race/class record), but the agent
   * perceive facade exposes namespaced player race/class ids when they are
   * supplied here, so every entity in the agent contract has a stable id.
   */
  playerRaces?: readonly PlayerRace[];
  playerClasses?: readonly PlayerClass[];
}

/**
 * The pack a bound record came from, or undefined when it carries no provenance.
 *
 * Undefined rather than `CORE_NS` so the resolver's own `namespace` argument
 * stays the fallback: a caller that deliberately built a resolver in some other
 * namespace still gets it for every unstamped record, and would not if this
 * substituted "core" on its behalf.
 *
 * The composer only stamps a record a mod added or changed
 * (mod-sdk/provenance.ts), so this is undefined for the whole base game and the
 * ids of an unmodded run are byte-identical to what every earlier engine wrote.
 */
function packOf(entity: ModExtensible): string | undefined {
  return entity.from?.owner;
}

/* ------------------------------------------------------------------ *
 * The definer's spelling (task #233).
 *
 * A LOCALID IS DERIVED FROM A NAME, so before this a mod that patched the name
 * of a record it does not own MOVED that record's id: install a mod that
 * renames Grip and `core:grip-farmer-maggot-s-dog` - a string sitting in every
 * save written before the mod - resolved to nothing. The rule is that a
 * record's id is fixed by the pack that DEFINED it and a patch cannot move it,
 * which needs the definer's value to still be reachable after composition.
 *
 * `from.was` is where it is reachable: the composer records the definer's value
 * for every top-level field a patch changed (mod-sdk/provenance.ts), keyed by
 * the pack JSON's own field names. So the minters below ask for the definer's
 * `name` / `code` / `type` and fall back to the record in front of them, which
 * is what an unpatched record - and the entire base game - takes.
 *
 * THE MOVED ID STILL RESOLVES, as an alias. A save written by 0.19.x WITH a
 * renaming mod installed holds the moved spelling, and a fix that made those
 * saves unresolvable would be the same defect pointed the other way. See
 * IdTable.movedToIndex.
 * ------------------------------------------------------------------ */

/** The definer's value at a dot path within `was`, or undefined. */
function definedAt(entity: ModExtensible, path: string): unknown {
  let cur: unknown = entity.from?.was;
  for (const part of path.split(".")) {
    if (typeof cur !== "object" || cur === null || Array.isArray(cur)) return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

/**
 * The definer's string at `path`, or `live` when no pack changed that field -
 * which is every record of an unmodded game, so this is a no-op for the whole
 * base game.
 */
function asDefined(entity: ModExtensible, path: string, live: string): string {
  const was = definedAt(entity, path);
  return typeof was === "string" ? was : live;
}

/**
 * The tval a pack's `type` string names, or undefined when it names none.
 *
 * TVAL_ENTRIES is indexed BY tval, and an object record's `type` is exactly the
 * `textName` of its entry - both asserted over the shipped pack in ids.test.ts,
 * because this is a lookup by a string in a data file and a silent miss would
 * simply leave the id where the patch put it.
 */
function tvalOfTypeName(type: string): number | undefined {
  const at = TVAL_ENTRIES.findIndex((e) => e.textName === type);
  return at < 0 ? undefined : at;
}

/** One bidirectional index<->id table for a single entity kind. */
class IdTable {
  private readonly toId: (string | null)[] = [];
  private readonly toIndex = new Map<string, number>();
  /**
   * The id an engine before 0.19.0 would have minted for each index: every
   * record in the default namespace, suffixed against every other record rather
   * than only its pack-mates. Consulted only when the exact id misses. See
   * `index` for why this is a reproduction rather than a heuristic.
   */
  private readonly legacyToIndex = new Map<string, number>();
  /**
   * The id an engine between 0.19.0 and the task #233 fix would have minted for
   * each PATCHED record: the same namespace, but the localid derived from the
   * patched name rather than the definer's. Only populated where a patch
   * actually moved the spelling, so it is empty for an unmodded game and for
   * every mod that does not rename.
   *
   * A SEPARATE MAP FROM `legacyToIndex`, not extra entries in it, because that
   * one is a REPRODUCTION of the pre-0.19.0 algorithm including its suffix
   * sequence - inserting a second family of keys into it would let a moved id
   * take a suffix out from under a record whose legacy id has been in savefiles
   * since before any of this existed.
   */
  private readonly movedToIndex = new Map<string, number>();

  constructor(private readonly namespace: string) {}

  /**
   * Register an index's base localid under the pack that owns it. If that id is
   * already taken (a genuine duplicate-name entity WITHIN one pack), append the
   * first free numeric suffix so every id is unique. Called in registry-binding
   * order, so the suffix a given entity receives is deterministic and identical
   * across a save round-trip.
   *
   * THE NAMESPACE IS PER RECORD, not per table, and that is what makes the
   * suffix stop depending on load order. Before this, every record in the game
   * shared one namespace, so a mod that added a monster called "kobold" got
   * `core:kobold-2` - a number decided by which mods happened to be enabled and
   * in what order, embedded in the player's save. It is now `frost:kobold`,
   * which says who supplied it and is the same string whatever else is loaded.
   */
  add(
    index: number,
    base: string,
    namespace: string = this.namespace,
    moved?: string,
  ): void {
    let id = makeId(namespace, base);
    if (this.toIndex.has(id)) {
      let n = 2;
      while (this.toIndex.has(makeId(namespace, `${base}-${n}`))) n++;
      id = makeId(namespace, `${base}-${n}`);
    }
    this.toIndex.set(id, index);
    this.toId[index] = id;

    let legacy = makeId(this.namespace, base);
    if (this.legacyToIndex.has(legacy)) {
      let n = 2;
      while (this.legacyToIndex.has(makeId(this.namespace, `${base}-${n}`))) n++;
      legacy = makeId(this.namespace, `${base}-${n}`);
    }
    this.legacyToIndex.set(legacy, index);

    if (moved !== undefined && moved !== base) {
      let at = makeId(namespace, moved);
      if (this.movedToIndex.has(at)) {
        let n = 2;
        while (this.movedToIndex.has(makeId(namespace, `${moved}-${n}`))) n++;
        at = makeId(namespace, `${moved}-${n}`);
      }
      this.movedToIndex.set(at, index);
    }
  }

  /** The id for an index, or null when the index is unbound (e.g. slot 0). */
  id(index: number): string | null {
    return this.toId[index] ?? null;
  }

  /**
   * The index for an id, or undefined when no such id is bound.
   *
   * A MISS FALLS BACK TO THE PRE-0.19.0 SPELLING, because the change that gave
   * mod content its own namespace also changed what an existing savefile means:
   * a character who was carrying a mod's sword saved it as `core:frost-brand`,
   * and that string is now minted as `frost:frost-brand`. Without this the item
   * would come back unresolvable on the next load - a save silently losing
   * content because the engine got MORE correct, which is the one thing the
   * whole id scheme exists to prevent. No SAVE_VERSION bump: the format did not
   * change, only which of two spellings the writer chooses.
   *
   * It is a REPRODUCTION of the old algorithm rather than a search for a near
   * match. A "try the same localid in any namespace" rule would be a guess, and
   * would silently hand back the wrong record whenever two packs use one name -
   * which is exactly the collision case the old suffix existed for. Running the
   * old rule forwards gives the id the old engine actually wrote, or nothing.
   *
   * Exact first, always: a save written by this engine never consults the
   * fallback, so a legacy id that happens to collide with a live one cannot
   * shadow it.
   */
  index(id: string): number | undefined {
    return (
      this.toIndex.get(id) ?? this.legacyToIndex.get(id) ?? this.movedToIndex.get(id)
    );
  }
}

/**
 * Builds and holds the index<->id tables for every content type a save
 * references. Constructed once per bound pack (both when writing and when
 * reading a save); the two directions are symmetric so a save written on one
 * registry ordering reloads correctly on any other ordering of the same ids.
 */
export class ContentIdResolver {
  private readonly kinds: IdTable;
  private readonly egos: IdTable;
  private readonly artifacts: IdTable;
  private readonly curses: IdTable;
  private readonly brands: IdTable;
  private readonly slays: IdTable;
  private readonly races: IdTable;
  private readonly traps: IdTable;
  private readonly feats: IdTable;
  private readonly playerRaces: IdTable;
  private readonly playerClasses: IdTable;
  private readonly artifactNames = new Map<number, string>();

  constructor(reg: ContentIdRegistries, namespace: string = CORE_NS) {
    const { objects } = reg;

    /* Every `add` below passes the localid the DEFINER's fields mint and, as the
     * fourth argument, the one the record's CURRENT fields mint. They are the
     * same string for every record no pack patched, which is the whole base game
     * and every mod record nobody else touched. */
    this.kinds = new IdTable(namespace);
    for (const kind of objects.kinds) {
      /* An object kind's id is tval + name, so BOTH halves have to come from the
       * definer: `type` is a top-level field a patch can overwrite exactly like
       * `name`, and moving a dagger to a different tval would move its id even
       * with the name held still. */
      const wasType = definedAt(kind, "type");
      const tval =
        (typeof wasType === "string" ? tvalOfTypeName(wasType) : undefined) ?? kind.tval;
      this.kinds.add(
        kind.kidx,
        kindLocalId(tval, asDefined(kind, "name", kind.name)),
        packOf(kind),
        kindLocalId(kind.tval, kind.name),
      );
    }

    this.egos = new IdTable(namespace);
    for (const ego of objects.egos) {
      this.egos.add(ego.eidx, slug(asDefined(ego, "name", ego.name)), packOf(ego), slug(ego.name));
    }

    /* Artifacts, curses, brands, slays are 1-based with a null at slot 0. */
    this.artifacts = new IdTable(namespace);
    for (let i = 1; i < objects.artifacts.length; i++) {
      const a = objects.artifacts[i];
      if (a) {
        this.artifacts.add(i, slug(asDefined(a, "name", a.name)), packOf(a), slug(a.name));
        /* The artifact NAME, unlike its id, is the one a player's history line
         * prints and the save round-trips - so it stays the live name a mod
         * chose, not the definer's. */
        this.artifactNames.set(i, a.name);
      }
    }

    this.curses = new IdTable(namespace);
    for (let i = 1; i < objects.curses.length; i++) {
      const c = objects.curses[i];
      if (c) this.curses.add(i, slug(asDefined(c, "name", c.name)), packOf(c), slug(c.name));
    }

    this.brands = new IdTable(namespace);
    for (let i = 1; i < objects.brands.length; i++) {
      const b = objects.brands[i];
      if (b) this.brands.add(i, slug(asDefined(b, "code", b.code)), packOf(b), slug(b.code));
    }

    this.slays = new IdTable(namespace);
    for (let i = 1; i < objects.slays.length; i++) {
      const s = objects.slays[i];
      if (s) this.slays.add(i, slug(asDefined(s, "code", s.code)), packOf(s), slug(s.code));
    }

    this.races = new IdTable(namespace);
    for (const race of reg.monsters?.races ?? []) {
      this.races.add(
        race.ridx,
        slug(asDefined(race, "name", race.name)),
        packOf(race),
        slug(race.name),
      );
    }

    this.traps = new IdTable(namespace);
    for (const trap of reg.traps ?? []) {
      /* `name.name`, not `name`: a trap's pack record spells its identity as the
       * composite `{name, desc}` upstream's `name:<name>:<desc>` line carries,
       * and the binder takes the display half. */
      this.traps.add(
        trap.tidx,
        slug(asDefined(trap, "name.name", trap.name)),
        packOf(trap),
        slug(trap.name),
      );
    }

    this.feats = new IdTable(namespace);
    for (const feat of reg.features?.allFeatures() ?? []) {
      this.feats.add(
        feat.fidx,
        slug(asDefined(feat, "code", feat.code)),
        packOf(feat),
        slug(feat.code),
      );
    }

    this.playerRaces = new IdTable(namespace);
    for (const race of reg.playerRaces ?? []) {
      this.playerRaces.add(
        race.ridx,
        slug(asDefined(race, "name", race.name)),
        packOf(race),
        slug(race.name),
      );
    }

    this.playerClasses = new IdTable(namespace);
    for (const cls of reg.playerClasses ?? []) {
      this.playerClasses.add(
        cls.cidx,
        slug(asDefined(cls, "name", cls.name)),
        packOf(cls),
        slug(cls.name),
      );
    }
  }

  /* Object kinds. */
  kindId(kidx: number): string {
    const id = this.kinds.id(kidx);
    if (id === null) throw new Error(`mod/ids: unbound kind index ${kidx}`);
    return id;
  }
  /** The kind id for an index, or null when unbound (a partial resolver). */
  kindIdOrNull(kidx: number): string | null {
    return this.kinds.id(kidx);
  }
  kindIndex(id: string): number | undefined {
    return this.kinds.index(id);
  }

  /* Egos (nullable reference). */
  egoId(eidx: number): string {
    const id = this.egos.id(eidx);
    if (id === null) throw new Error(`mod/ids: unbound ego index ${eidx}`);
    return id;
  }
  /** The ego id for an index, or null when unbound (a partial resolver). */
  egoIdOrNull(eidx: number): string | null {
    return this.egos.id(eidx);
  }
  egoIndex(id: string): number | undefined {
    return this.egos.index(id);
  }

  /* Artifacts (nullable reference; 1-based). */
  artifactId(aidx: number): string {
    const id = this.artifacts.id(aidx);
    if (id === null) throw new Error(`mod/ids: unbound artifact index ${aidx}`);
    return id;
  }
  artifactIndex(id: string): number | undefined {
    return this.artifacts.index(id);
  }
  /** The upstream artifact NAME used by player history save/load. */
  artifactName(aidx: number): string | null {
    return this.artifactNames.get(aidx) ?? null;
  }

  /* Curses (positional on objects; 1-based). */
  curseId(index: number): string {
    const id = this.curses.id(index);
    if (id === null) throw new Error(`mod/ids: unbound curse index ${index}`);
    return id;
  }
  curseIndex(id: string): number | undefined {
    return this.curses.index(id);
  }

  /* Brands (positional on objects; 1-based). */
  brandId(index: number): string {
    const id = this.brands.id(index);
    if (id === null) throw new Error(`mod/ids: unbound brand index ${index}`);
    return id;
  }
  brandIndex(id: string): number | undefined {
    return this.brands.index(id);
  }

  /* Slays (positional on objects; 1-based). */
  slayId(index: number): string {
    const id = this.slays.id(index);
    if (id === null) throw new Error(`mod/ids: unbound slay index ${index}`);
    return id;
  }
  slayIndex(id: string): number | undefined {
    return this.slays.index(id);
  }

  /* Monster races. */
  raceId(ridx: number): string {
    const id = this.races.id(ridx);
    if (id === null) throw new Error(`mod/ids: unbound race index ${ridx}`);
    return id;
  }
  /** The race id for an index, or null when unbound (a partial resolver). */
  raceIdOrNull(ridx: number): string | null {
    return this.races.id(ridx);
  }
  raceIndex(id: string): number | undefined {
    return this.races.index(id);
  }

  /* Trap kinds. */
  trapId(tidx: number): string {
    const id = this.traps.id(tidx);
    if (id === null) throw new Error(`mod/ids: unbound trap index ${tidx}`);
    return id;
  }
  trapIndex(id: string): number | undefined {
    return this.traps.index(id);
  }

  /* Terrain features. */
  featId(fidx: number): string {
    const id = this.feats.id(fidx);
    if (id === null) throw new Error(`mod/ids: unbound feature index ${fidx}`);
    return id;
  }
  /**
   * The feature id for an index, or null when the index is not a bound feature
   * (an unset terrain cell carries a sentinel like -1 that has no id). Used to
   * build the terrain legend, which skips sentinels: they mean "no feature"
   * and are pack-independent, so they never need remapping.
   */
  featIdOrNull(fidx: number): string | null {
    return this.feats.id(fidx);
  }
  featIndex(id: string): number | undefined {
    return this.feats.index(id);
  }

  /* Player races (only bound when playerRaces was supplied). */
  playerRaceId(ridx: number): string {
    const id = this.playerRaces.id(ridx);
    if (id === null) throw new Error(`mod/ids: unbound player race index ${ridx}`);
    return id;
  }
  /** The player-race id for an index, or null when player races were not supplied. */
  playerRaceIdOrNull(ridx: number): string | null {
    return this.playerRaces.id(ridx);
  }
  playerRaceIndex(id: string): number | undefined {
    return this.playerRaces.index(id);
  }

  /* Player classes (only bound when playerClasses was supplied). */
  playerClassId(cidx: number): string {
    const id = this.playerClasses.id(cidx);
    if (id === null) throw new Error(`mod/ids: unbound player class index ${cidx}`);
    return id;
  }
  /** The player-class id for an index, or null when player classes were not supplied. */
  playerClassIdOrNull(cidx: number): string | null {
    return this.playerClasses.id(cidx);
  }
  playerClassIndex(id: string): number | undefined {
    return this.playerClasses.index(id);
  }
}
