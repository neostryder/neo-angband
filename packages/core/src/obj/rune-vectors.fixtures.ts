/**
 * The world the rune vectors are recorded against, built from the real shipped
 * content pack.
 *
 * SEPARATE FILE, and it reads the disk: keeping `node:fs` out of
 * `rune-vectors.ts` means the row producer stays importable from anywhere. ONE
 * copy, shared by `rune-vectors.test.ts` and by `scripts/gen-rune-vectors.mjs`,
 * so the test and the generator cannot disagree about what they are measuring.
 *
 * THE REAL PACK rather than synthetic tables, on purpose. `buildRuneList`
 * de-duplicates brands by name and slays by same-monsters group, and skips five
 * flag subtypes - a hand-built table would be an assertion about what the pack
 * producer emits, and an unchecked one. `elementNames` is derived the way
 * `session/game.ts:741` derives it (projections, sliced to ELEM_MAX), not
 * hand-listed: two nearby test fixtures hard-code four element names, which is
 * enough for a targeted test and would silently shorten this grid by ten.
 */

import { readFileSync } from "node:fs";

import { ELEM_MAX } from "./types.js";
import { ObjRegistry } from "./bind.js";
import { bindPlayer } from "../player/bind.js";
import { blankPlayer } from "../player/player.js";
import { makeRuneEnv } from "./knowledge.js";
import { bindConstants } from "../constants.js";
import { objectNew } from "./object.js";
import { objectPrep } from "./make.js";
import { Rng } from "../rng.js";
import type { ObjectKind, ObjPackJson } from "./types.js";
import type { Player } from "../player/player.js";
import type { GameObject } from "./object.js";
import type { RuneEnv } from "./knowledge.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as T;
}

function loadRecords<T>(name: string): T[] {
  return loadJson<{ records: T[] }>(name).records;
}

/** Everything one rune vector run needs. */
export interface RuneVectorWorld {
  /** A fresh player with empty rune knowledge, marked as playing. */
  player(): Player;
  /** The env every rune call is made against; `msg` pushes into `messages`. */
  env: RuneEnv;
  /** Messages emitted since the last `drain()`. */
  drain(): string[];
  /** A freshly prepared object of the first ordinary kind of a given tval. */
  object(tval: number): GameObject;
  /** object_new: the same kind, zeroed, carrying nothing of its own. */
  blankObject(tval: number): GameObject;
}

/**
 * Build the fixture world. The registry binds every object table plus the
 * projections `elementNames` is derived from; nothing here needs an RNG stream,
 * so the one `Rng` exists only because `makeRuneEnv` wants a `randcalcVaries`
 * and is seeded fixed.
 */
export function runeVectorWorld(): RuneVectorWorld & { reg: ObjRegistry } {
  const reg = new ObjRegistry({
    objectBase: loadJson("object_base"),
    object: loadJson("object"),
    egoItem: loadJson("ego_item"),
    artifact: loadJson("artifact"),
    curse: loadJson("curse"),
    brand: loadJson("brand"),
    slay: loadJson("slay"),
    activation: loadJson("activation"),
    objectProperty: loadJson("object_property"),
    flavor: loadJson("flavor"),
  } as ObjPackJson);

  const players = bindPlayer({
    races: loadRecords("p_race"),
    classes: loadRecords("class"),
    properties: loadRecords("player_property"),
    timed: loadRecords("player_timed"),
    shapes: loadRecords("shape"),
    bodies: loadRecords("body"),
    history: loadRecords("history"),
    realms: loadRecords("realm"),
  });

  /* session/game.ts:741 - projections sliced to ELEM_MAX, by name. */
  const elementNames = loadRecords<{ name: string }>("projection")
    .slice(0, ELEM_MAX)
    .map((p) => p.name);

  const constants = bindConstants(loadJson("constants"));
  const messages: string[] = [];
  const rng = new Rng(7);
  const equipment: (GameObject | null)[] = [];

  const env = makeRuneEnv(
    (slot) => equipment[slot] ?? null,
    (v) => rng.randcalcVaries(v),
    {
      brands: reg.brands,
      slays: reg.slays,
      curses: reg.curses,
      properties: reg.properties,
      elementNames,
      msg: (t) => messages.push(t),
    },
  );

  const race = players.raceByName("Human")!;
  const cls = players.classByName("Warrior")!;
  const body = players.bodies[race.body]!;

  return {
    reg,
    env,
    player(): Player {
      const p = blankPlayer(race, cls, body);
      /* modMessage is guarded by upkeep.playing (knowledge.ts:646): a wield
       * during birth or level-feeling prints nothing. Recording with it off
       * would produce a grid of empty message lists that could not disagree
       * with a broken dispatch table. */
      p.upkeep.playing = true;
      return p;
    },
    drain(): string[] {
      const out = [...messages];
      messages.length = 0;
      return out;
    },
    object(tval: number): GameObject {
      /* object_prep, not object_new: object_new is a zeroed allocation whose
       * tval is still 0, and the point of asking `objectHasRune` about a REAL
       * item is that the item's own fields are filled in. The "maximise" aspect
       * draws no entropy (randcalc takes the bound rather than a roll), so the
       * grid stays RNG-free. */
      return objectPrep(rng, reg, constants, kindOf(tval), 0, "maximise");
    },
    blankObject(tval: number): GameObject {
      /* object_new, and the modifier-message rows need exactly this. A prepared
       * ring of the first ordinary sval is a Ring of STRENGTH: it carries +STR
       * and SUST_STR of its own, so wielding it learns those too and every one
       * of the sixteen rows would carry the same four-line prefix. Four lines of
       * constant noise in a six-line row is a grid that mostly measures the
       * fixture. A zeroed object has exactly one modifier set - the one under
       * test. */
      return objectNew(kindOf(tval));
    },
  };

  function kindOf(tval: number): ObjectKind {
    const kind = reg.kinds.find(
      (k) => k.tval === tval && k.kidx < reg.ordinaryKindCount,
    );
    if (!kind) throw new Error(`no ordinary kind for tval ${tval}`);
    return kind;
  }
}
