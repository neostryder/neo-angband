/**
 * Save migration: an older savefile is converted forward, never rejected.
 *
 * THE PROMISE THIS FILE KEEPS. A character is the most expensive thing a player
 * owns in a permadeath game, and until this file existed a `SAVE_VERSION` bump
 * was indistinguishable from corruption: `loadGame` threw, the web host caught
 * the throw with a bare `catch`, and the player was told "Could not read the
 * save; starting a new game." Nothing was actually wrong with those bytes. So:
 *
 *   **Every SAVE_VERSION bump ships the step that converts the version below
 *   it.** `saveMigrationsAreComplete()` proves the chain has no gap, and
 *   save-migrate.test.ts fails the build if a bump arrives without its step.
 *   That is the mechanism; a promise in a comment is not one.
 *
 * WHY A CHAIN AND NOT N CONVERTERS. Each step moves a document exactly one
 * version, so version 1 reaches version 6 by running five steps that were each
 * written (and tested) against the format immediately before it. Nobody has to
 * remember what version 1 looked like when version 7 is designed - only what
 * version 6 looked like.
 *
 * WHAT A STEP MAY NOT DO. Throw. A step that meets a content id or index the
 * running pack cannot resolve DROPS that entity and records a line in `notes`;
 * losing one object out of a save is recoverable, and refusing the save is not.
 * The one thing that legitimately stops a load is a save from the FUTURE
 * (`SaveFromFutureError`), because this build cannot know what the fields mean.
 *
 * The numeric indices in versions 1 and 2 are indices into the core content
 * pack, which is generated from Angband 4.2.6's fixed gamedata and therefore
 * has a stable order. That is the assumption every step below rests on, and it
 * is the same assumption those saves were written under.
 */

import type { ContentIdResolver } from "../mod/ids.js";
import { FlagSet } from "../bitflag.js";
import {
  SAVE_VERSION,
  serializeElementLevels,
  serializeIgnore,
  serializeLoreFlags,
  serializeLoreSpells,
  serializeObjectElements,
  serializeObjectFlags,
  serializeObjectModifiers,
} from "./save.js";
import type { IgnoreSettingsData } from "../obj/ignore.js";
import type { ElementInfo } from "../obj/types.js";
import type { SavedGame } from "./save.js";

/**
 * A save document at some version, before this build's types apply to it. The
 * fields a step rewrites are exactly the fields whose SHAPE changed, so they
 * cannot be typed as `SavedGame` on the way in - `unknown` is the honest type
 * and every read below is guarded.
 */
export type VersionedSave = { version: number } & Record<string, unknown>;

/** A save written by a build newer than this one. The only unrecoverable case. */
export class SaveFromFutureError extends Error {
  constructor(
    readonly saveVersion: number,
    readonly supported: number = SAVE_VERSION,
  ) {
    super(
      `This character was saved by a newer version of Neo Angband ` +
        `(save format ${saveVersion}; this build reads up to ${supported}). ` +
        `Update the game and it will load - the save is not damaged.`,
    );
    this.name = "SaveFromFutureError";
  }
}

/** One version's worth of conversion. `to` is always `from + 1`. */
export interface SaveMigration {
  readonly from: number;
  readonly to: number;
  /** One line, present tense, for the changelog and the migration note. */
  readonly summary: string;
  step(save: VersionedSave, ids: ContentIdResolver, notes: string[]): VersionedSave;
}

/* ------------------------------------------------------------------ *
 * Shape-directed rewriting.
 *
 * A step does not walk a list of containers ("objects live in gear.store, and
 * floor[].objs, and monsters[].heldObj, and stores[].stock..."), because that
 * list is exactly the kind of thing that grows a new entry nobody updates -
 * and the failure mode is a silently unmigrated object. It walks the whole
 * document and rewrites every node that HAS the old shape, wherever it is.
 * ------------------------------------------------------------------ */

type Json = Record<string, unknown>;

function isObj(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Depth-first rewrite. `fn` is called on every plain-object node bottom-up and
 * returns a replacement, or the node unchanged. Returning `null` deletes the
 * node from its parent array (an object whose kind no longer resolves).
 */
function rewriteNodes(value: unknown, fn: (node: Json) => Json | null): unknown {
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (const item of value) {
      const next = rewriteNodes(item, fn);
      /* An array slot the rewriter deleted: monsters[] and gear.pack index into
       * their arrays positionally, so a hole must stay a hole. Only a node the
       * rewriter itself removed becomes null; a null that was already there
       * survives untouched, which is the same thing. */
      out.push(next);
    }
    return out;
  }
  if (!isObj(value)) return value;
  const walked: Json = {};
  for (const [k, v] of Object.entries(value)) walked[k] = rewriteNodes(v, fn);
  return fn(walked);
}

/* ------------------------------------------------------------------ *
 * 1 -> 2: every content cross-reference becomes a namespaced string id.
 * ------------------------------------------------------------------ */

/** Indices where the dense boolean array is set, as ids. Index 0 is the sentinel. */
function setBitsToIds(
  dense: unknown,
  id: (index: number) => string | null,
): string[] | null {
  if (!Array.isArray(dense)) return null;
  const out: string[] = [];
  for (let i = 1; i < dense.length; i++) {
    if (!dense[i]) continue;
    const resolved = id(i);
    if (resolved !== null) out.push(resolved);
  }
  return out;
}

const V1_TO_V2: SaveMigration = {
  from: 1,
  to: 2,
  summary:
    "content references become namespaced ids, so re-ordered game data can no " +
    "longer re-target an object, a monster or a learned rune onto something else",
  step(save, ids, notes) {
    let droppedObjects = 0;
    let droppedMonsters = 0;

    const brandId = (i: number): string | null => safe(() => ids.brandId(i));
    const slayId = (i: number): string | null => safe(() => ids.slayId(i));
    const curseId = (i: number): string | null => safe(() => ids.curseId(i));

    const migrated = rewriteNodes(save, (node) => {
      /* An object: v1 keyed it by kidx, with positional brand/slay/curse arrays. */
      if (typeof node.kidx === "number") {
        const kindId = ids.kindIdOrNull(node.kidx);
        if (kindId === null) {
          droppedObjects++;
          return null;
        }
        const { kidx, ego, artifact, originRace, ...rest } = node;
        void kidx;
        return {
          ...rest,
          kindId,
          /* v1 wrote null for "no ego"; index 0 is the sentinel either way. */
          egoId: typeof ego === "number" && ego > 0 ? ids.egoIdOrNull(ego) : null,
          artifactId:
            typeof artifact === "number" && artifact > 0
              ? safe(() => ids.artifactId(artifact))
              : null,
          brands: setBitsToIds(node.brands, brandId),
          slays: setBitsToIds(node.slays, slayId),
          curses: v1Curses(node.curses, curseId),
          originRaceId:
            typeof originRace === "number" && originRace > 0
              ? ids.raceIdOrNull(originRace)
              : null,
        };
      }

      /* A monster: v1 keyed it by ridx. */
      if (typeof node.ridx === "number") {
        const raceId = ids.raceIdOrNull(node.ridx);
        if (raceId === null) {
          droppedMonsters++;
          return null;
        }
        const { ridx, originalRidx, ...rest } = node;
        void ridx;
        return {
          ...rest,
          raceId,
          originalRaceId:
            typeof originalRidx === "number" && originalRidx > 0
              ? ids.raceIdOrNull(originalRidx)
              : null,
        };
      }

      /* A trap: v1 keyed it by tidx. */
      if (typeof node.tidx === "number") {
        const { tidx, ...rest } = node;
        const trapId = safe(() => ids.trapId(tidx));
        if (trapId === null) return null;
        return { ...rest, trapId };
      }

      /* A history entry: v1 wrote the artifact's index, v2 its stable name. */
      if (typeof node.aIdx === "number" && node.artifactName === undefined) {
        const { aIdx, ...rest } = node;
        return { ...rest, artifactName: ids.artifactName(aIdx) ?? "" };
      }

      return node;
    }) as VersionedSave;

    /* The learned-rune sets on the player: dense arrays keyed by index, not
     * nodes of their own, so the walk above cannot see them. */
    const player = migrated.player;
    if (isObj(player) && isObj(player.objKnown)) {
      const k = player.objKnown;
      k.brands = setBitsToIds(k.brands, brandId) ?? [];
      k.slays = setBitsToIds(k.slays, slayId) ?? [];
      k.curses = setBitsToIds(k.curses, curseId) ?? [];
    }

    /* aup_info: a dense boolean[] by aidx becomes the ids of what was created. */
    if (Array.isArray(migrated.artifactsCreated)) {
      migrated.artifactsCreated =
        setBitsToIds(migrated.artifactsCreated, (i) =>
          safe(() => ids.artifactId(i)),
        ) ?? [];
    }

    /* Monster memory: v1 keyed the map by ridx. */
    if (Array.isArray(migrated.lore)) {
      const out: Array<[string, unknown]> = [];
      for (const entry of migrated.lore) {
        if (!Array.isArray(entry) || entry.length !== 2) continue;
        const [key, value] = entry as [unknown, unknown];
        if (typeof key !== "number") continue;
        const raceId = ids.raceIdOrNull(key);
        if (raceId === null) continue; // race gone: its memory goes with it
        out.push([raceId, value]);
      }
      migrated.lore = out;
    }

    /* The terrain legend. v1 wrote raw feature indices with nothing to remap
     * them through, so the legend it never had is built here from the pack the
     * save was written against - which is this one, since v1 predates mods
     * contributing terrain at all. */
    if (migrated.featLegend === undefined) {
      const present = new Set<number>();
      const collect = (arr: unknown): void => {
        if (!Array.isArray(arr)) return;
        for (const f of arr) if (typeof f === "number") present.add(f);
      };
      const chunk = migrated.chunk;
      if (isObj(chunk)) collect(chunk.feats);
      const known = migrated.known;
      if (isObj(known)) collect(known.feat);
      const legend: Array<[number, string]> = [];
      for (const f of present) {
        const id = ids.featIdOrNull(f);
        if (id !== null) legend.push([f, id]);
      }
      if (legend.length > 0) migrated.featLegend = legend;
    }

    if (droppedObjects > 0) {
      notes.push(
        `${droppedObjects} item${droppedObjects === 1 ? "" : "s"} referred to ` +
          `game data this build does not have, and could not be restored.`,
      );
    }
    if (droppedMonsters > 0) {
      notes.push(
        `${droppedMonsters} monster${droppedMonsters === 1 ? "" : "s"} referred ` +
          `to game data this build does not have, and could not be restored.`,
      );
    }
    migrated.version = 2;
    return migrated;
  },
};

/** v1 curses: positional, one slot per curse, only powered ones survive. */
function v1Curses(
  curses: unknown,
  curseId: (i: number) => string | null,
): Array<{ id: string; power: number; timeout: number }> | null {
  if (!Array.isArray(curses)) return null;
  const out: Array<{ id: string; power: number; timeout: number }> = [];
  for (let i = 1; i < curses.length; i++) {
    const c: unknown = curses[i];
    if (!isObj(c) || typeof c.power !== "number" || c.power <= 0) continue;
    const id = curseId(i);
    if (id === null) continue;
    out.push({
      id,
      power: c.power,
      timeout: typeof c.timeout === "number" ? c.timeout : 0,
    });
  }
  return out.length > 0 ? out : null;
}

/* ------------------------------------------------------------------ *
 * 2 -> 3: the last three positionally-keyed blocks.
 * ------------------------------------------------------------------ */

const V2_TO_V3: SaveMigration = {
  from: 2,
  to: 3,
  summary:
    "flavour knowledge, ever-seen tracking and ignore settings become " +
    "id-keyed, finishing what version 2 started",
  step(save, ids, notes) {
    const kindIds = (v: unknown): string[] => {
      if (!Array.isArray(v)) return [];
      const out: string[] = [];
      for (const k of v) {
        if (typeof k !== "number") continue;
        const id = ids.kindIdOrNull(k);
        if (id !== null) out.push(id);
      }
      return out;
    };
    const egoIds = (v: unknown): string[] => {
      if (!Array.isArray(v)) return [];
      const out: string[] = [];
      for (const e of v) {
        if (typeof e !== "number") continue;
        const id = ids.egoIdOrNull(e);
        if (id !== null) out.push(id);
      }
      return out;
    };

    const flavor = save.flavor;
    if (isObj(flavor)) {
      save.flavor = { aware: kindIds(flavor.aware), tried: kindIds(flavor.tried) };
    }

    const everseen = save.everseen;
    if (isObj(everseen)) {
      save.everseen = { kinds: kindIds(everseen.kinds), egos: egoIds(everseen.egos) };
    }

    /* serializeIgnore is the very function that produced the version-3 shape,
     * so the migration calls it rather than re-deriving the conversion - the
     * two cannot drift apart if there is only one of them. */
    const ignore = save.ignore;
    if (isObj(ignore)) {
      const raw: IgnoreSettingsData = {
        level: Array.isArray(ignore.level) ? (ignore.level as number[]) : [],
        ego: Array.isArray(ignore.ego) ? (ignore.ego as string[]) : [],
        kindAware: Array.isArray(ignore.kindAware)
          ? (ignore.kindAware as number[])
          : [],
        kindUnaware: Array.isArray(ignore.kindUnaware)
          ? (ignore.kindUnaware as number[])
          : [],
        unignoring: ignore.unignoring === true,
      };
      save.ignore = serializeIgnore(raw, ids);
    }

    void notes;
    save.version = 3;
    return save;
  },
};

/* ------------------------------------------------------------------ *
 * 3 -> 4: the remembered pile becomes a pile.
 * ------------------------------------------------------------------ */

/**
 * Widen one grid's memory from a single record to the list version 4 stores.
 *
 * A version-3 record says "this grid remembers kind K" and carries no link to
 * the object it came from, so it converts to a one-element list with no `at`
 * locator. deserializeKnownObject rebuilds that as a DETACHED memory: it draws
 * exactly the glyph version 3 drew, and the first square_know_pile of the grid
 * excises it in favour of real entries - which is what upstream's
 * forget_remembered_objects does to a shadow whose original has moved on.
 *
 * A record with neither `kindId` nor `money` is the pre-0.18 glyph shape, whose
 * `ch`/`attr` cannot be turned back into a kind. It is dropped rather than
 * guessed at, and the grid heals the next time the player sees it. Returns
 * null so the caller can count what was dropped.
 */
function v3KnownEntry(m: unknown): Record<string, unknown> | null {
  if (!isObj(m)) return null;
  if (typeof m.kindId === "string") {
    return { kindId: m.kindId, ...(m.money === true ? { money: true } : {}) };
  }
  if (m.money === true) return { money: true, sensed: true };
  return null;
}

/** Rewrite one `known` block in place; returns how many memories were dropped. */
function v3KnownBlock(known: unknown): number {
  if (!isObj(known) || !Array.isArray(known.objects)) return 0;
  let dropped = 0;
  const widened: Array<[number, Record<string, unknown>[]]> = [];
  for (const pair of known.objects) {
    if (!Array.isArray(pair) || typeof pair[0] !== "number") continue;
    const entry = v3KnownEntry(pair[1]);
    if (entry === null) {
      dropped++;
      continue;
    }
    widened.push([pair[0], [entry]]);
  }
  known.objects = widened;
  return dropped;
}

const V3_TO_V4: SaveMigration = {
  from: 3,
  to: 4,
  summary:
    "the remembered floor memory becomes a remembered PILE, so a grid can " +
    "hold more than one known object",
  step(save, ids, notes) {
    void ids;
    let dropped = v3KnownBlock(save.known);

    /* The frozen-level cache carries the same block per stored level. */
    if (Array.isArray(save.levelCache)) {
      for (const level of save.levelCache) {
        if (isObj(level)) dropped += v3KnownBlock(level.known);
      }
    }

    if (dropped > 0) {
      notes.push(
        `${dropped} remembered floor ${dropped === 1 ? "object" : "objects"} ` +
          "could not be identified and were forgotten; they reappear as soon " +
          "as you see those grids again.",
      );
    }

    save.version = 4;
    return save;
  },
};

/* ------------------------------------------------------------------ *
 * 4 -> 5: monster lore stops persisting RSF bit positions.
 * ------------------------------------------------------------------ */

/**
 * Is this node a lore record in the version-4 shape?
 *
 * `spellFlags: number[]` is NOT enough on its own - `player.spellFlags` is also
 * a number array (the per-spell PY_SPELL bits, an entirely different thing) and
 * rewriting it would corrupt the player's spellbook. `blowKnown` and `tkills`
 * belong to the lore record and to nothing else in the document, so the three
 * together name it exactly.
 */
function isV4Lore(node: Json): boolean {
  return (
    Array.isArray(node.spellFlags) &&
    Array.isArray(node.blowKnown) &&
    typeof node.tkills === "number"
  );
}

/**
 * A saved `number[]` of FlagSet bytes, read back as a FlagSet. The bit
 * numbering used here is THIS build's, which is the numbering the older save
 * was written under: none of RSF / RF / OF has ever been appended to or
 * reordered (that is the very thing these migrations unblock), and a save at
 * the older version by definition predates any build that could have.
 */
function savedFlagSet(bytes: readonly unknown[]): FlagSet {
  const raw = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i];
    raw[i] = typeof b === "number" ? b & 0xff : 0;
  }
  return new FlagSet(raw);
}

/** Version 4's raw FlagSet bytes -> the RSF names version 5 stores. */
function v4SpellNames(bytes: readonly unknown[]): string[] {
  return serializeLoreSpells(savedFlagSet(bytes));
}

const V4_TO_V5: SaveMigration = {
  from: 4,
  to: 5,
  summary:
    "monster memory records the spells you have seen BY NAME instead of by bit " +
    "position, so game data that adds a monster spell can no longer renumber " +
    "what you already know",
  step(save, ids, notes) {
    void ids;
    void notes;

    const migrated = rewriteNodes(save, (node) => {
      if (!isV4Lore(node)) return node;
      const { spellFlags, ...rest } = node;
      return { ...rest, spellsKnown: v4SpellNames(spellFlags as unknown[]) };
    }) as VersionedSave;

    migrated.version = 5;
    return migrated;
  },
};

/* ------------------------------------------------------------------ *
 * 5 -> 6: the last four persisted POSITIONS become names.
 * ------------------------------------------------------------------ */

/**
 * THE DISCRIMINATOR PROBLEM, AND WHY NO SINGLE FIELD SOLVES IT.
 *
 * Version 5 wrote SIX `number[]` fields that this step must not confuse with
 * each other, and three more it must not touch at all:
 *
 *   convert  object / objKnown  `flags`      OF FlagSet bytes
 *   convert  object / objKnown  `modifiers`  dense, by OBJ_MOD index
 *   convert  object / objKnown  `elInfo`     dense, by ELEM index (objects)
 *   convert  lore               `flags`      RF FlagSet bytes
 *   convert  monster            `knownPstateFlags` / `knownPstateElInfo`
 *   LEAVE    player             `spellFlags` PY_SPELL bits - the spellbook
 *   LEAVE    trap               `flags`      TRF FlagSet bytes (out of scope)
 *   LEAVE    monster            `mflag`      MFLAG FlagSet bytes (out of scope)
 *
 * `flags: number[]` therefore names FOUR different things and is worthless as a
 * test on its own - the same trap V4_TO_V5 hit, where `spellFlags` alone would
 * have rewritten the player's spellbook. Each predicate below is a CONJUNCTION
 * of fields that co-occur on exactly one kind of node.
 */

/**
 * An object-property carrier: `SavedObject` or `SavedPlayer.objKnown`, which
 * are the only two nodes in the document that hold all three of an OF flag set,
 * an OBJ_MOD array and an ELEM array - and which convert identically, so one
 * predicate serves both. (`SavedObject` also has `kindId`; requiring it would
 * exclude `objKnown` and leave the player's learned runes on bit positions.)
 *
 * Nothing else comes close: a lore record has `flags` and no `modifiers`, a
 * trap has `flags` and a `trapId`, and `player.spellFlags` is not named
 * `flags` at all.
 */
function isV5ObjectProps(node: Json): boolean {
  return (
    Array.isArray(node.flags) &&
    Array.isArray(node.modifiers) &&
    Array.isArray(node.elInfo)
  );
}

/**
 * A lore record in the version-5 shape. `spellsKnown` arrived with version 5
 * and belongs to the lore record and to nothing else; `blowKnown` and `tkills`
 * were already the pair that named it for V4_TO_V5. Four fields together, and
 * `flags` is the one being rewritten rather than the one doing the naming.
 */
function isV5Lore(node: Json): boolean {
  return (
    Array.isArray(node.flags) &&
    Array.isArray(node.spellsKnown) &&
    Array.isArray(node.blowKnown) &&
    typeof node.tkills === "number"
  );
}

/** Coerce a saved dense array to numbers; a non-number slot reads as 0. */
function savedNumbers(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => (typeof v === "number" ? v : 0));
}

/** Coerce a saved dense el_info array; a malformed slot reads as untouched. */
function savedElements(value: unknown): ElementInfo[] {
  if (!Array.isArray(value)) return [];
  return value.map((v) => ({
    resLevel: isObj(v) && typeof v.resLevel === "number" ? v.resLevel : 0,
    flags: isObj(v) && typeof v.flags === "number" ? v.flags : 0,
  }));
}

const V5_TO_V6: SaveMigration = {
  from: 5,
  to: 6,
  summary:
    "items, learned runes and monster memory record their properties BY NAME " +
    "instead of by bit position, so game data that adds an object flag, a " +
    "modifier, an element or a monster flag can no longer renumber what you " +
    "already own or already know",
  step(save, ids, notes) {
    void ids;
    void notes;

    const migrated = rewriteNodes(save, (node) => {
      if (isV5ObjectProps(node)) {
        const { flags, modifiers, elInfo, ...rest } = node;
        return {
          ...rest,
          flagNames: serializeObjectFlags(savedFlagSet(flags as unknown[])),
          modifierValues: serializeObjectModifiers(savedNumbers(modifiers)),
          elementInfo: serializeObjectElements(savedElements(elInfo)),
        };
      }
      if (isV5Lore(node)) {
        const { flags, ...rest } = node;
        return {
          ...rest,
          flagsKnown: serializeLoreFlags(savedFlagSet(flags as unknown[])),
        };
      }
      /* A monster's remembered view of the player. Both fields are optional and
       * their NAMES appear on no other node, so presence is the whole test. */
      if (
        Array.isArray(node.knownPstateFlags) ||
        Array.isArray(node.knownPstateElInfo)
      ) {
        const { knownPstateFlags, knownPstateElInfo, ...rest } = node;
        return {
          ...rest,
          ...(Array.isArray(knownPstateFlags)
            ? {
                knownPstateFlagNames: serializeObjectFlags(
                  savedFlagSet(knownPstateFlags),
                ),
              }
            : {}),
          ...(Array.isArray(knownPstateElInfo)
            ? {
                knownPstateElementRes: serializeElementLevels(
                  savedNumbers(knownPstateElInfo),
                ),
              }
            : {}),
        };
      }
      return node;
    }) as VersionedSave;

    migrated.version = 6;
    return migrated;
  },
};

/* ------------------------------------------------------------------ *
 * The chain.
 * ------------------------------------------------------------------ */

/**
 * Every step, in order. ADD A STEP HERE IN THE SAME COMMIT THAT BUMPS
 * SAVE_VERSION - save-migrate.test.ts fails otherwise, on purpose.
 */
export const SAVE_MIGRATIONS: readonly SaveMigration[] = [
  V1_TO_V2,
  V2_TO_V3,
  V3_TO_V4,
  V4_TO_V5,
  V5_TO_V6,
];

/** The oldest save version this build can read. */
export const OLDEST_READABLE_SAVE = SAVE_MIGRATIONS[0]?.from ?? SAVE_VERSION;

/**
 * Is the chain complete - one step for every version from the oldest readable
 * up to the current one, in order, with no gap and no duplicate? The test calls
 * this; so does `migrateSave`, because a chain with a hole is a bug that must
 * surface at the top of a load rather than halfway through one.
 */
export function saveMigrationsAreComplete(): { ok: true } | { ok: false; why: string } {
  let expected = OLDEST_READABLE_SAVE;
  for (const m of SAVE_MIGRATIONS) {
    if (m.from !== expected) {
      return {
        ok: false,
        why: `expected a step from save version ${expected}, found one from ${m.from}`,
      };
    }
    if (m.to !== m.from + 1) {
      return {
        ok: false,
        why: `the step from ${m.from} claims to reach ${m.to}; a step moves exactly one version`,
      };
    }
    expected = m.to;
  }
  if (expected !== SAVE_VERSION) {
    return {
      ok: false,
      why:
        `SAVE_VERSION is ${SAVE_VERSION} but the migration chain stops at ${expected}. ` +
        `Add the step from ${expected} to ${expected + 1} in save-migrate.ts - ` +
        `a version bump without one turns every existing character into "could not read the save".`,
    };
  }
  return { ok: true };
}

export interface MigrationResult {
  /** The document at the current SAVE_VERSION. */
  save: SavedGame;
  /** One summary per step applied; empty when the save was already current. */
  applied: string[];
  /** Anything lost on the way, in words a player can act on. */
  notes: string[];
}

/**
 * Bring a save document up to `SAVE_VERSION`.
 *
 * Throws only `SaveFromFutureError`. Every other problem is absorbed: an
 * unresolvable reference costs that one entity and a line in `notes`.
 */
export function migrateSave(
  save: SavedGame | VersionedSave,
  ids: ContentIdResolver,
): MigrationResult {
  const complete = saveMigrationsAreComplete();
  if (!complete.ok) throw new Error(`save migration chain is broken: ${complete.why}`);

  const doc = save as VersionedSave;
  const from = typeof doc.version === "number" ? doc.version : 1;
  if (from > SAVE_VERSION) throw new SaveFromFutureError(from);
  if (from === SAVE_VERSION) {
    return { save: save as SavedGame, applied: [], notes: [] };
  }

  const applied: string[] = [];
  const notes: string[] = [];
  /* Work on a copy: a failed load must leave the caller's document untouched,
   * so the bytes on disk stay exactly as written and a later build can try
   * again. */
  let current = structuredClone(doc);
  for (const m of SAVE_MIGRATIONS) {
    if (m.from < from) continue;
    current = m.step(current, ids, notes);
    applied.push(m.summary);
  }

  if (current.version !== SAVE_VERSION) {
    /* Unreachable while saveMigrationsAreComplete() holds; asserted rather than
     * assumed, because the cost of being wrong is a half-converted character. */
    throw new Error(
      `save migration ended at version ${String(current.version)}, expected ${SAVE_VERSION}`,
    );
  }
  return { save: current as unknown as SavedGame, applied, notes };
}

/** Run `fn`, and treat a throw as "this index does not resolve". */
function safe(fn: () => string): string | null {
  try {
    return fn();
  } catch {
    return null;
  }
}
