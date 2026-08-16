/**
 * Golden vectors for the rune layer: what every rune in the shipped pack is
 * CALLED, what it READS as, whether an object carries it, whether the player
 * knows it, what learning it PRINTS, and the "You feel stronger!" line every
 * modifier prints on wield.
 *
 * RECORDED BEFORE `RuneRegistry` EXISTED, which is the only reason they are
 * evidence. A determinism test that runs the same function twice in one process
 * cannot fail across a refactor - agreement is symmetric. These rows were
 * produced by the six closed switches (`runeDesc`, `playerKnowsRune`,
 * `objectHasRune`, `playerLearnRune`, `runeName`, `modMessage`) and replayed
 * against whatever answers those questions afterwards.
 *
 * NO RNG ANYWHERE, measured rather than assumed: every value below is a string
 * or a boolean derived from a pack record and a knowledge store. So the
 * 2026-08-09 relaxation to gameplay parity buys this conversion nothing - there
 * is no stream to move - and the grid can be exhaustive instead of sampled.
 *
 * WHAT THE GRID DELIBERATELY COVERS, because a rune grid has an easy way to
 * look complete and measure nothing:
 *
 *   - EVERY rune `buildRuneList` produces, not a sample. The list de-duplicates
 *     brands by name and slays by same-monsters group and skips five flag
 *     subtypes, so its length is a fact about the pack that a hand-written list
 *     would freeze wrongly.
 *   - Learning each rune TWICE. The second call must return false; a dispatch
 *     table that learned unconditionally would pass a once-only grid.
 *   - `objectHasRune` against an object carrying EVERY rune and against a bare
 *     one. One object answering `true` everywhere is not a test - the bare
 *     object is what makes each `true` mean something.
 *   - Both SIGNS of every modifier. `modMessage`'s arms differ by sign
 *     ("stronger" / "weaker") and two of the eleven ignore sign entirely
 *     (INFRA, LIGHT), which a positive-only grid could not tell apart.
 */

import { OBJ_MOD_MAX } from "./types.js";
import {
  buildRuneList,
  objectHasRune,
  objectLearnOnWield,
  playerKnowsRune,
  playerLearnRune,
  runeDesc,
  runeKey,
  runeName,
} from "./knowledge.js";
import type { Rune } from "./knowledge.js";
import type { GameObject } from "./object.js";
import type { Player } from "../player/player.js";
import type { RuneEnv } from "./knowledge.js";

/** One rune's recorded answers. */
export interface RuneVectorRow {
  /** `runeKey` - the save-stable identity, `variety:name`. */
  key: string;
  variety: string;
  index: number;
  name: string;
  /** `runeName` - the decorated display name. */
  display: string;
  /** `runeDesc` - the recall line. */
  desc: string;
  /** `playerKnowsRune` on a fresh character. */
  knowsBefore: boolean;
  /** `playerLearnRune(..., message: true)` - did it learn anything. */
  learned: boolean;
  /** What that learn printed. */
  messages: string[];
  /** `playerKnowsRune` after. */
  knowsAfter: boolean;
  /** Learning it a second time. False for every rune upstream. */
  learnedAgain: boolean;
  /** `objectHasRune` against an object carrying every rune in the list. */
  hasOnLoaded: boolean;
  /** `objectHasRune` against an untouched object of the same kind. */
  hasOnBare: boolean;
}

/** One modifier's wield messages, by sign. */
export interface ModMessageRow {
  /** The OBJ_MOD index. */
  mod: number;
  /** The modifier's rune name in the pack, or "" when it has none. */
  name: string;
  /** What `objectLearnOnWield` printed for a +2 of this modifier. */
  positive: string[];
  /** ... and for a -2. */
  negative: string[];
}

/** The whole recorded grid. */
export interface RuneVectors {
  runes: RuneVectorRow[];
  modMessages: ModMessageRow[];
}

/** The fixture surface the producer needs (see `rune-vectors.fixtures.ts`). */
export interface RuneVectorWorldLike {
  env: RuneEnv;
  player(): Player;
  drain(): string[];
  object(tval: number): GameObject;
  blankObject(tval: number): GameObject;
}

/**
 * Write one rune onto an object, so `objectHasRune` has something to find.
 *
 * This is the one place the grid encodes per-variety knowledge, and it is
 * deliberately the WRITE side rather than the read side: `objectHasRune` is
 * what is being measured, so the fixture must reach the object's fields
 * directly instead of asking the function under test to describe itself.
 */
function applyRune(env: RuneEnv, obj: GameObject, rune: Rune): void {
  switch (rune.variety) {
    case "combat":
      if (rune.index === 0) obj.toA = 1;
      else if (rune.index === 1) obj.toH = 1;
      else obj.toD = 1;
      return;
    case "mod":
      obj.modifiers[rune.index] = 1;
      return;
    case "resist": {
      const info = obj.elInfo[rune.index];
      if (info) info.resLevel = 1;
      return;
    }
    case "brand": {
      obj.brands ??= new Array<boolean>(env.brands.length).fill(false);
      obj.brands[rune.index] = true;
      return;
    }
    case "slay": {
      obj.slays ??= new Array<boolean>(env.slays.length).fill(false);
      obj.slays[rune.index] = true;
      return;
    }
    case "curse": {
      obj.curses ??= Array.from({ length: env.curses.length }, () => ({
        power: 0,
        timeout: 0,
      }));
      const c = obj.curses[rune.index];
      if (c) c.power = 1;
      return;
    }
    case "flag":
      obj.flags.on(rune.index);
      return;
    default:
      return;
  }
}

/**
 * Produce the grid. ONE implementation, called by both the generator and the
 * test, so the recorded file and the replay cannot drift into measuring
 * different things.
 *
 * `tval` picks the object every `objectHasRune` question is asked against. A
 * RING is used because it is jewellery (so `objectHasStandardToH` has nothing
 * to say about it) and carries no base plusses of its own, which keeps the bare
 * row honestly negative.
 */
export function recordRuneVectors(
  world: RuneVectorWorldLike,
  tval: number,
): RuneVectors {
  const { env } = world;
  const runes = buildRuneList(env);

  const loaded = world.object(tval);
  for (const rune of runes) applyRune(env, loaded, rune);
  const bare = world.object(tval);

  const rows: RuneVectorRow[] = runes.map((rune) => {
    const p = world.player();
    world.drain();
    const knowsBefore = playerKnowsRune(p, rune);
    const learned = playerLearnRune(p, env, rune, true);
    const messages = world.drain();
    const knowsAfter = playerKnowsRune(p, rune);
    const learnedAgain = playerLearnRune(p, env, rune, true);
    world.drain();
    return {
      key: runeKey(rune),
      variety: rune.variety,
      index: rune.index,
      name: rune.name,
      display: runeName(rune),
      desc: runeDesc(env, rune),
      knowsBefore,
      learned,
      messages,
      knowsAfter,
      learnedAgain,
      hasOnLoaded: objectHasRune(env, loaded, rune),
      hasOnBare: objectHasRune(env, bare, rune),
    };
  });

  /* The modifier names, taken from the rune list rather than looked up a
   * second way: two producers of the same string is two chances to disagree. */
  const modNames = new Map<number, string>();
  for (const rune of runes) {
    if (rune.variety === "mod") modNames.set(rune.index, rune.name);
  }

  const modMessages: ModMessageRow[] = [];
  for (let mod = 0; mod < OBJ_MOD_MAX; mod++) {
    const sign = (value: number): string[] => {
      const p = world.player();
      const obj = world.blankObject(tval);
      obj.modifiers[mod] = value;
      world.drain();
      objectLearnOnWield(p, obj, env);
      return world.drain();
    };
    modMessages.push({
      mod,
      name: modNames.get(mod) ?? "",
      positive: sign(2),
      negative: sign(-2),
    });
  }

  return { runes: rows, modMessages };
}
