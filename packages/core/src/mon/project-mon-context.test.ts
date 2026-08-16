/**
 * Gap row 7, the half the conversion did not cover: WHAT THE HANDLER IS HANDED.
 *
 * `project-mon-registry.test.ts` proves the rekey is faithful and
 * `session/projection-registry-wiring.test.ts` proves a mod's handler is
 * reached. Both were satisfied by #159's three sides too - and #159 still
 * shipped two dead seams, for the same reason twice:
 *
 *   (a) `project_o` consumed `env.projections` to resolve a code, and the
 *       producer never supplied it, so a mod's own projection burned nothing.
 *   (b) `PlayerSideDeps.msg` was optional, every harness supplied it, and
 *       `wireGame` did not - so all thirty of project_p's lines went nowhere
 *       while a different hook's "You are hit by sound!" made it look wired.
 *
 * Both are the same defect: the registry was present, gated, wired and
 * dispatched to, and the CONTEXT handed to the handler was incomplete. Neither
 * "the map contains the handler" nor "the handler ran" can see it. Only
 * enumerating the context a handler actually receives, at the real call site,
 * can - so that is what this file does.
 *
 * It captures the live `MonProjectContext` from inside a mod-registered handler
 * driven through `castProjection` -> `projectMonster` -> `runMonsterHandler`,
 * and asserts every declared field of it, and of its `hooks` sub-object, is
 * supplied. The `hooks` object is the one that matters: it is assembled by a
 * CONDITIONAL SPREAD at `game/project-monster.ts:200-207`, so a hook with no
 * producer is not a compile error, not a runtime error, and not visible in any
 * message - it is simply an arm of core that never runs.
 *
 * That enumeration found one. See "the fourth hook has no producer" below.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { startGame } from "../session/game.js";
import type { GamePack, StartedGame } from "../session/game.js";
import type { GameState } from "../game/context.js";
import { castProjection, playerCastSource } from "../game/project-cast.js";
import type { CastContext } from "../game/project-cast.js";
import { createModRegistryHost } from "../mod/registry-host.js";
import type { ModRegistryHost } from "../mod/registry-host.js";
import { PROJECT } from "../world/project.js";
import { MON_TMD } from "../generated/index.js";
import type { MonProjectContext, MonProjectHooks } from "./project-mon.js";
import type { Monster } from "./monster.js";
import { monsterIsShapeUnique } from "./predicate.js";

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

const pack: GamePack = {
  constants: loadJson("constants"),
  terrain: loadRecords("terrain"),
  roomTemplates: loadRecords("room_template"),
  vaults: loadRecords("vault"),
  dungeonProfiles: loadRecords("dungeon_profile"),
  projection: loadRecords("projection"),
  trap: loadRecords("trap"),
  names: loadRecords("names"),
  quest: loadRecords("quest"),
  store: loadRecords("store"),
  obj: {
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
  } as GamePack["obj"],
  mon: {
    pain: loadRecords("pain"),
    blowMethods: loadRecords("blow_methods"),
    blowEffects: loadRecords("blow_effects"),
    monsterSpells: loadRecords("monster_spell"),
    monsterBases: loadRecords("monster_base"),
    monsters: loadRecords("monster"),
    summons: loadRecords("summon"),
    pits: loadRecords("pit"),
  },
  player: {
    races: loadRecords("p_race"),
    classes: loadRecords("class"),
    properties: loadRecords("player_property"),
    timed: loadRecords("player_timed"),
    shapes: loadRecords("shape"),
    bodies: loadRecords("body"),
    history: loadRecords("history"),
    realms: loadRecords("realm"),
  },
};

interface Started {
  game: StartedGame;
  state: GameState;
  cast: CastContext;
  messages: string[];
  host: ModRegistryHost;
}

/** A live game, with the capability-gated facade a trusted plugin is handed. */
function started(seed: number): Started {
  const game = startGame(pack, { seed, depth: 3, className: "Warrior" });
  const state = game.state;
  const messages: string[] = [];
  state.msg = (t: string): void => {
    messages.push(t);
  };
  const effect = game.wizardBundles.effect;
  expect(effect, "a depth game should have the effect bundle").toBeTruthy();
  return {
    game,
    state,
    cast: effect!.cast,
    messages,
    host: createModRegistryHost({
      projections: state.projectionHandlers ?? null,
    }),
  };
}

/** The PROJ_ value a code sits at in the BOUND table (never a literal). */
function projOf(cast: CastContext, code: string): number {
  const typ = cast.projections.findIndex((p) => p.code === code);
  expect(typ, `the pack should define a "${code}" projection`).toBeGreaterThan(
    -1,
  );
  return typ;
}

function firstMonster(s: Started): Monster {
  const mon = s.state.monsters.find((m, i) => i > 0 && !!m);
  expect(mon, "the generated level should contain a monster").toBeTruthy();
  return mon!;
}

function liveMonsterCount(s: Started): number {
  return s.state.monsters.filter((m, i) => i > 0 && !!m).length;
}

/**
 * A monster that CAN multiply.
 *
 * `firstMonster` returns whatever the generator put down first, and at seed
 * 7702 that is "Fang, Farmer Maggot's Dog" - a UNIQUE. `multiplyMonster`
 * short-circuits on `monsterIsShapeUnique` before drawing any RNG
 * (game/mon-place.ts), so a clone test written against it reads exactly like a
 * dead hook: eight calls, eight falses, no effect. The easiest subject to reach
 * was the one special case that cannot exhibit the effect.
 *
 * The assertion below is deliberately loud rather than a silent `.find`: if a
 * future fixture change leaves only uniques, this fails naming the reason
 * instead of the clone test failing as though the wiring broke.
 */
function firstBreedableMonster(s: Started): Monster {
  const mon = s.state.monsters.find(
    (m, i) => i > 0 && !!m && !monsterIsShapeUnique(m),
  );
  expect(mon, "the level should contain a NON-UNIQUE monster").toBeTruthy();
  return mon!;
}

/** Fire a real player-sourced projection at a monster's own grid. */
function blastMonster(s: Started, typ: number, dam: number, mon: Monster): void {
  castProjection(
    s.state,
    s.cast,
    { ...playerCastSource(s.state), grid: mon.grid },
    mon.grid,
    dam,
    typ,
    PROJECT.KILL,
    0,
  );
}

/**
 * Every field `MonProjectContext` declares.
 *
 * The type guard below is the thing that keeps this honest: a hand-written list
 * of field names rots the moment someone adds a field, and a rotted list makes
 * this whole file quietly weaker while staying green. `_contextFieldsAreExact`
 * fails to COMPILE if the list and the interface ever part, in either
 * direction - which is why it is a type-level check and not an assertion.
 */
const CONTEXT_FIELDS = [
  "rng",
  "hooks",
  "originIsMonster",
  "r",
  "grid",
  "dam",
  "type",
  "mon",
  "charm",
  "healthTracked",
  "seen",
  "obvious",
  "skipped",
  "flag",
  "doPoly",
  "teleportDistance",
  "thrustGridsAway",
  "hurtMsg",
  "dieMsg",
  "monTimed",
] as const;

type Exact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : never) : never;

const _contextFieldsAreExact: Exact<
  (typeof CONTEXT_FIELDS)[number],
  keyof MonProjectContext
> = true;
void _contextFieldsAreExact;

/** Every field `MonProjectHooks` declares. Same guard, same reason. */
const HOOK_FIELDS = [
  "learnRaceFlag",
  "learnSpellFlag",
  "multiplyMonster",
  "onMessage",
] as const;

const _hookFieldsAreExact: Exact<
  (typeof HOOK_FIELDS)[number],
  keyof MonProjectHooks
> = true;
void _hookFieldsAreExact;

/**
 * Drive a real projection at a real monster with a mod-registered handler for
 * `code` installed through the capability-gated facade, and hand back the
 * context that handler was given. Core's own handler still runs, so the game's
 * behaviour is unchanged and the capture is an observation, not a substitution.
 */
function captureLiveContext(
  s: Started,
  code: string,
  dam: number,
  mon: Monster,
): MonProjectContext[] {
  const captured: MonProjectContext[] = [];
  const core = s.host.projections.mon.handlerFor(code);
  expect(core, `core should have a handler for ${code}`).toBeTruthy();
  s.host.projections.mon.set(code, (ctx) => {
    captured.push(ctx);
    core!(ctx);
  });
  blastMonster(s, projOf(s.cast, code), dam, mon);
  return captured;
}

describe("the context a mod's monster handler receives, at the real call site", () => {
  it("NEGATIVE CONTROL: with no registration nothing is captured and the monster is hit", () => {
    /* The mechanism REMOVED, not an inert input substituted: no handler is
     * registered at all. If this captured anything, the capture below would be
     * measuring something other than the registration. The monster still takes
     * damage, so the projection genuinely reached project_m either way - which
     * is what makes the capture's emptiness meaningful rather than a sign the
     * blast missed. */
    const s = started(7701);
    const captured: MonProjectContext[] = [];
    const mon = firstMonster(s);
    const hpBefore = mon.hp;
    blastMonster(s, projOf(s.cast, "ACID"), 40, mon);
    expect(captured).toEqual([]);
    expect(mon.hp).toBeLessThan(hpBefore);
  });

  it("supplies every declared field of MonProjectContext - none is undefined", () => {
    const s = started(7701);
    const mon = firstMonster(s);
    const captured = captureLiveContext(s, "ACID", 40, mon);
    expect(captured.length).toBe(1);
    const ctx = captured[0]!;

    /* The enumeration. `unsupplied` names the fields rather than counting them,
     * because a bare count tells the next reader nothing about which arm of
     * core just stopped working. */
    const unsupplied = CONTEXT_FIELDS.filter(
      (f) => ctx[f] === undefined,
    ) as string[];
    expect(unsupplied).toEqual([]);

    /* Present is not the same as LIVE. A context built from defaults would pass
     * the enumeration above with every field defined and every value a lie, so
     * each field is also checked against the game it claims to come from.
     * (`healthTracked`, `obvious`, `skipped` and the accumulators are booleans
     * and zeroes whose default IS the correct initial value, so they are
     * covered by the enumeration alone - there is nothing else to compare them
     * to at entry.) */
    expect({
      rngIsTheGames: ctx.rng === s.state.rng,
      monIsTheLevels: ctx.mon === mon,
      gridIsTheMonsters: ctx.grid.y === mon.grid.y && ctx.grid.x === mon.grid.x,
      typeIsTheBoundValue: ctx.type === projOf(s.cast, "ACID"),
      damIsTheBlast: ctx.dam,
      monTimedIsFullLength: ctx.monTimed.length === MON_TMD.MAX,
      originIsMonster: ctx.originIsMonster,
    }).toEqual({
      rngIsTheGames: true,
      monIsTheLevels: true,
      gridIsTheMonsters: true,
      typeIsTheBoundValue: true,
      damIsTheBlast: 40,
      monTimedIsFullLength: true,
      /* A player-sourced blast: SRC_PLAYER, so this is false and the driver
       * routes to project_m_player_attack. */
      originIsMonster: false,
    });
  });

  it("the hooks object is REAL - learnRaceFlag reaches the live lore", () => {
    /* `hooks` being non-undefined is the weakest possible claim about it: the
     * producer builds it with `?? {}`, so an empty object satisfies the
     * enumeration. This drives one hook end to end instead. ACID's handler
     * calls learnRaceFlag(mon, RF_IM_ACID) whenever the effect is seen, and the
     * only way to observe it is the lore the live game keeps. */
    const s = started(7701);
    const mon = firstMonster(s);
    const calls: number[] = [];
    const core = s.host.projections.mon.handlerFor("ACID")!;
    s.host.projections.mon.set("ACID", (ctx) => {
      ctx.seen = true; // force the seen branch; visibility is not the subject
      const inner = ctx.hooks.learnRaceFlag;
      expect(inner, "learnRaceFlag should have a producer").toBeTruthy();
      ctx.hooks = {
        ...ctx.hooks,
        learnRaceFlag: (m, flag): void => {
          calls.push(flag);
          inner!(m, flag);
        },
      };
      core(ctx);
    });
    blastMonster(s, projOf(s.cast, "ACID"), 40, mon);
    expect(calls.length).toBeGreaterThan(0);
  });
});

/**
 * THE FINDING. Failure mode (b) has recurred, on the monster side, and it is
 * live in the shipped game today.
 *
 * `MonProjectHooks` declares four hooks. `game/project-monster.ts:200-207`
 * spreads each into the context ONLY IF the corresponding `ProjectMonsterHooks`
 * field is set, and `session/game.ts:1464-1552` - the sole producer, inside
 * `wireGame`'s CastContext - supplies fifteen hooks and NOT `multiplyMonster`.
 *
 * So `ctx.hooks.multiplyMonster` is `undefined` in every real game, and
 * `hMonClone`'s `ctx.hooks.multiplyMonster?.(ctx.mon)` short-circuits to
 * undefined every single time. Upstream (`project-mon.c`
 * project_monster_handler_MON_CLONE) calls `multiply_monster(context->mon)`
 * unconditionally. PROJ_MON_CLONE therefore heals and hastes the monster and
 * NEVER CLONES IT, and MON_MSG_SPAWN can never be queued.
 *
 * The producer already exists - `state.monsterMultiply` is built at
 * `session/game.ts:2084` over the same `ambientPlaceDeps` this hook block
 * already uses for `polyRace` and `replaceMonster`. It is simply not connected
 * to this hook. The one-line patch is recorded in the stream-M report; it is
 * outside this file's ownership, so this test DOCUMENTS the gap rather than
 * hiding it, and goes red the moment somebody fixes it.
 */
describe("the fourth hook has no producer - a live PROJ_MON_CLONE defect", () => {
  it("POSITIVE CONTROL: MON_CLONE's other two arms do land, so the handler ran", () => {
    /* Without this pair the test below could not tell "the clone arm is dead"
     * from "the projection never reached the handler at all". */
    const s = started(7702);
    const mon = firstMonster(s);
    mon.hp = 1;
    mon.mTimed[MON_TMD.FAST] = 0;
    /* Without this the heal assertion is trivially true for any monster whose
     * maxhp is 1: hp would "already equal maxhp" with nothing having run. */
    expect(mon.maxhp).toBeGreaterThan(1);
    blastMonster(s, projOf(s.cast, "MON_CLONE"), 0, mon);
    expect(mon.hp).toBe(mon.maxhp);
    expect(mon.mTimed[MON_TMD.FAST]).toBeGreaterThan(0);
  });

  it("enumerates the hooks: all four supplied", () => {
    const s = started(7702);
    const mon = firstMonster(s);
    mon.hp = 1;
    const captured = captureLiveContext(s, "MON_CLONE", 0, mon);
    expect(captured.length).toBe(1);
    const hooks = captured[0]!.hooks;

    const supplied = HOOK_FIELDS.filter((f) => hooks[f] !== undefined);
    const unsupplied = HOOK_FIELDS.filter((f) => hooks[f] === undefined);

    /* The fix landed 2026-08-14 and this went red exactly as its previous note
     * predicted, which is why the note was written that way rather than as a
     * skip. `unsupplied` stays in the assertion as an EMPTY list on purpose: a
     * fifth hook added without a producer has to fail here, and asserting only
     * `supplied` would let it through. */
    expect({ supplied, unsupplied }).toEqual({
      supplied: [
        "learnRaceFlag",
        "learnSpellFlag",
        "multiplyMonster",
        "onMessage",
      ],
      unsupplied: [],
    });
  });

  it("and now the clone CAN happen: the supplied hook really multiplies", () => {
    /* The observable consequence, in the game's own terms rather than the
     * seam's. This replaces an assertion that the count CANNOT change, which
     * was deterministic only because the hook was missing.
     *
     * WHY THE LOOP, AND WHY IT IS NOT FLAKINESS-HIDING. multiply_monster
     * legitimately fails when the monster has no free adjacent grid, so a
     * single call proves nothing on a failure. What is being asserted is that
     * SOME call succeeds - i.e. that the hook reaches the real producer rather
     * than a stub. A hook wired to `() => false` passes every agreement check
     * you could write and fails this one, which is the whole point: the defect
     * this file exists to catch was a hook that was PRESENT and INERT. */
    const s = started(7702);
    const mon = firstBreedableMonster(s);
    mon.hp = 1;
    const captured = captureLiveContext(s, "MON_CLONE", 0, mon);
    const multiply = captured[0]!.hooks.multiplyMonster;
    expect(multiply).toBeTypeOf("function");

    const before = liveMonsterCount(s);
    let succeeded = 0;
    for (let i = 0; i < 8; i++) if (multiply!(mon)) succeeded++;
    expect(succeeded).toBeGreaterThan(0);
    expect(liveMonsterCount(s)).toBe(before + succeeded);
  });
});
