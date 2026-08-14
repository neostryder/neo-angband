/**
 * The three projection registries have a PRODUCER, and it is the live game.
 *
 * WHAT THIS EXISTS TO CATCH. project_f, project_o and project_p were converted
 * from switches to keyed registries on 2026-08-08/09, each with an override
 * field - `env.featHandlers`, `env.objHandlers`, `deps.playerHandlers`. Nothing
 * wrote any of them. The conversions passed 13,000-odd golden vectors, the
 * census row disappeared, MOD_REACH recorded two of the three as reachable, and
 * a mod could not change one projection: `wireGame` built its env as
 * `{ makeDeps }` and the compiled-in table won every time. That is the
 * shipped-is-not-reachable failure, and reading the source is exactly how it
 * survived - the field was there, typed, documented and consumed.
 *
 * So this file does not read the wiring. It starts a REAL game, installs a
 * handler the way a mod does - through the capability-gated facade, over
 * `state.projectionHandlers`, AFTER the game is wired, because that is when a
 * plugin's register() runs - and then fires a REAL projection and looks at what
 * came out. If wireGame stops handing its tables to the engine, or hands over a
 * snapshot instead of the live Map, every assertion below fails.
 *
 * The controls are the first test in each pair: core's own handler, observed
 * doing core's own thing, so "the mod's handler ran" is a statement that had a
 * way to be false.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { startGame } from "./game.js";
import type { GamePack, StartedGame } from "./game.js";
import type { GameState } from "../game/context.js";
import type { ProjectFeatHandler } from "../game/project-feat.js";
import { PROJECT_FEAT_HANDLERS } from "../game/project-feat.js";
import { PROJECT_OBJ_HANDLERS } from "../game/project-obj.js";
import { PLAYER_SIDE_HANDLERS } from "../game/player-side.js";
import { ProjectionHandlerRegistry } from "../game/projection-handlers.js";
import { castProjection, monsterCastSource, playerCastSource } from "../game/project-cast.js";
import type { CastContext } from "../game/project-cast.js";
import { createModRegistryHost } from "../mod/registry-host.js";
import type { ModRegistryHost } from "../mod/registry-host.js";
import { AgentCapabilityError } from "../agent/types.js";
import { PROJECT } from "../world/project.js";
import { MONSTER_HANDLERS_BY_CODE } from "../mon/project-mon.js";
import type { Monster } from "../mon/monster.js";
import { MON_MSG } from "../generated/index.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(new URL(`../../../content/pack/${name}.json`, import.meta.url), "utf8"),
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
  /** The capability-gated facade, built exactly as the web host builds it. */
  host: ModRegistryHost;
}

/**
 * A live game with its message sink captured, plus the registry facade a
 * trusted plugin is handed. `wizardBundles.effect.cast` is the CastContext
 * wireGame built - the same object every spell, wand, trap and monster breath
 * projects through - so a projection fired with it is the game's own path, not
 * a re-derived one.
 */
function started(seed: number, depth: number): Started {
  const game = startGame(pack, { seed, depth, className: "Warrior" });
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
  expect(typ, `the pack should define a "${code}" projection`).toBeGreaterThan(-1);
  return typ;
}

/**
 * Fire a real monster-sourced projection at the player's own grid, with the
 * flags that reach terrain and the player. A monster source, because project_p
 * is what a breath does to you.
 */
function breatheAtPlayer(s: Started, typ: number, dam: number): void {
  const midx = s.state.monsters.findIndex((m, i) => i > 0 && !!m);
  expect(midx, "the generated level should contain a monster").toBeGreaterThan(0);
  const p = s.state.actor.player;
  p.chp = 5000; // survive the hit; death would end the projection's story early
  /* The blast starts ON the player, so no wall between a randomly-placed
   * monster and the player can truncate project_path and move the centre - the
   * subject here is the handler table, not the geometry. The monster is still
   * the SOURCE, which is what makes this project_p's monster path (the killer
   * string, the spell power, project_p's own gate on a player source). */
  castProjection(
    s.state,
    s.cast,
    { ...monsterCastSource(s.state, midx), grid: s.state.actor.grid },
    s.state.actor.grid,
    dam,
    typ,
    PROJECT.GRID | PROJECT.ITEM | PROJECT.PLAY,
    1,
  );
}

describe("wireGame publishes the projection registry", () => {
  it("seeds it with core's three tables and leaves the originals alone", () => {
    const s = started(9001, 3);
    const reg = s.state.projectionHandlers;
    expect(reg).toBeInstanceOf(ProjectionHandlerRegistry);
    expect(reg!.feat.codes()).toEqual([...PROJECT_FEAT_HANDLERS.keys()]);
    expect(reg!.obj.codes()).toEqual([...PROJECT_OBJ_HANDLERS.keys()]);
    expect(reg!.player.codes()).toEqual([...PLAYER_SIDE_HANDLERS.keys()]);

    /* A COPY, not the module table. Mutating core's own map would carry one
     * character's mod into every game in the process - the reason the blow and
     * store registries are built per game too. */
    const before = PROJECT_FEAT_HANDLERS.size;
    reg!.feat.set("leak-check", (() => false) as ProjectFeatHandler);
    expect(PROJECT_FEAT_HANDLERS.size).toBe(before);
    expect(PROJECT_FEAT_HANDLERS.has("leak-check")).toBe(false);

    /* And two games do not share one. */
    const other = started(9002, 3);
    expect(other.state.projectionHandlers).not.toBe(reg);
    expect(other.state.projectionHandlers!.feat.has("leak-check")).toBe(false);
  });
});

describe("a handler installed after the game is wired reaches project_f", () => {
  it("CONTROL: with no mod, core's FIRE handler runs and nothing else does", () => {
    const s = started(9101, 3);
    const seen: string[] = [];
    /* Wrap every core feat handler to watch, without changing any behaviour -
     * this is the observation, not the subject. */
    for (const code of s.state.projectionHandlers!.feat.codes()) {
      const core = s.state.projectionHandlers!.feat.handlerFor(code)!;
      s.state.projectionHandlers!.feat.set(code, (ctx) => {
        seen.push(code);
        return core(ctx);
      });
    }
    breatheAtPlayer(s, projOf(s.cast, "FIRE"), 20);
    expect(seen.length).toBeGreaterThan(0);
    expect(new Set(seen)).toEqual(new Set(["FIRE"]));
  });

  it("a mod's handler replaces core's, and gets the real grid and damage", () => {
    const s = started(9101, 3);
    const hits: { dam: number; typ: number }[] = [];
    s.host.projections.feat.set("ACID", (ctx) => {
      hits.push({ dam: ctx.dam, typ: ctx.typ });
      ctx.state.msg?.("The stone drinks the acid.");
      return true;
    });
    const typ = projOf(s.cast, "ACID");
    breatheAtPlayer(s, typ, 20);

    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]?.typ).toBe(typ);
    expect(hits[0]?.dam).toBe(20);
    expect(s.messages).toContain("The stone drinks the acid.");
  });
});

describe("a handler installed after the game is wired reaches project_p", () => {
  it("CONTROL: with no mod, core's FIRE handler burns the pack", () => {
    const s = started(9201, 3);
    const seen: string[] = [];
    for (const code of s.state.projectionHandlers!.player.codes()) {
      const core = s.state.projectionHandlers!.player.handlerFor(code)!;
      s.state.projectionHandlers!.player.set(code, (ctx) => {
        seen.push(code);
        core(ctx);
      });
    }
    breatheAtPlayer(s, projOf(s.cast, "FIRE"), 30);
    expect(seen).toEqual(["FIRE"]);
  });

  it("core's OWN messages reach the player - they were being dropped", () => {
    /* Not a mod test: the control above proved core's arm RUNS, and this proves
     * what it says arrives. `PlayerSideDeps.msg` is optional, every harness
     * that exercised the arms supplied it, and wireGame did not - so all thirty
     * of project_p's lines, and every timed effect's message with them, went
     * nowhere in the live game while "You are hit by sound!" (a different hook)
     * came through and made it look wired. Found by a mod handler calling
     * ctx.msg into silence. */
    const s = started(9202, 3);
    breatheAtPlayer(s, projOf(s.cast, "SOUND"), 900);
    expect(s.messages).toContain("The noise disorients you.");
  });

  it("a mod's handler replaces core's, with the live player toolkit in hand", () => {
    const s = started(9201, 3);
    const hits: number[] = [];
    s.host.projections.player.set("FIRE", (ctx) => {
      hits.push(ctx.dam);
      /* The ctx is the real one: these read the LIVE derived state, not a stub. */
      expect(typeof ctx.resists(0)).toBe("boolean");
      ctx.msg("The fire passes through you.");
    });
    breatheAtPlayer(s, projOf(s.cast, "FIRE"), 30);

    expect(hits.length).toBe(1);
    expect(s.messages).toContain("The fire passes through you.");
    /* Core's arm would have said this instead. */
    expect(s.messages.join(" ")).not.toContain("burns up");
  });
});

describe("one mod extends another mod's handler", () => {
  it("the second wraps the first, and the first is still in the chain", () => {
    const s = started(9301, 3);
    const order: string[] = [];

    /* Mod A replaces core's. */
    s.host.projections.feat.set("ACID", (ctx) => {
      order.push("A");
      ctx.state.msg?.("A: the acid pools.");
      return true;
    });

    /* Mod B - loaded later, and knowing nothing about A - wraps whatever is
     * installed. This is the whole reason the facade is keyed per CODE: if a
     * mod handed over a whole table, B would replace A's map wholesale and A's
     * work would vanish with no error anywhere. */
    const previous = s.host.projections.feat.handlerFor("ACID");
    expect(previous).toBeTruthy();
    s.host.projections.feat.set("ACID", (ctx) => {
      order.push("B-before");
      const seen = previous!(ctx);
      order.push("B-after");
      return seen;
    });

    breatheAtPlayer(s, projOf(s.cast, "ACID"), 20);

    expect(order.slice(0, 3)).toEqual(["B-before", "A", "B-after"]);
    expect(s.messages).toContain("A: the acid pools.");
  });
});

describe("the projection facade is gated and target-checked", () => {
  it("refuses without registry:projection, on every method", () => {
    const s = started(9401, 3);
    const gated = createModRegistryHost(
      { projections: s.state.projectionHandlers ?? null },
      { has: (c: string) => c === "registry:effect" },
    );
    for (const call of [
      (): void => {
        gated.projections.feat.set("ACID", () => false);
      },
      (): void => void gated.projections.obj.handlerFor("ACID"),
      (): void => void gated.projections.player.has("FIRE"),
      (): void => void gated.projections.feat.codes(),
    ]) {
      expect(call).toThrow(AgentCapabilityError);
      expect(call).toThrow(/registry:projection/);
    }
    /* And nothing was installed on the way to the throw. */
    expect(s.state.projectionHandlers!.feat.handlerFor("FIRE")).toBe(
      PROJECT_FEAT_HANDLERS.get("FIRE"),
    );
  });

  it("says so when the host wired no projection registry at all", () => {
    const host = createModRegistryHost({ projections: null });
    expect(() => {
      host.projections.player.set("FIRE", () => {});
    }).toThrow(/host did not wire it/);
  });
});

describe("the tables the engine holds are the registry's own", () => {
  it("a handler set on a fresh registry is seen through the table it handed out", () => {
    /* The identity claim in one line, independent of the game: `table` is the
     * live Map, so a set() after the engine took a reference is dispatched to.
     * A `new Map(...)` snapshot at wiring time would pass every other test in
     * this file that does not fire a projection - and would ship a dead seam. */
    const reg = new ProjectionHandlerRegistry();
    const handed = reg.feat.table;
    const mine: ProjectFeatHandler = () => true;
    reg.feat.set("late", mine);
    expect(handed.get("late")).toBe(mine);
  });
});

/**
 * THE FOURTH SIDE (gap row 7, 2026-08-14).
 *
 * project_m was the one #159 left out: terrain, floor objects and the player
 * were all reachable, and a mod's own projection did nothing at all to a
 * MONSTER - the target a combat mod is actually aimed at. The table was a
 * frozen 56-slot ARRAY indexed by PROJ value, and a mod's projection is
 * appended at index 56, so the lookup fell off the end and `if (handler)` ate
 * it silently. Same tests as the other three sides, for the same reason: a
 * table that has been converted is not a table a mod can reach.
 */

/** Fire a real player-sourced projection at a monster's own grid. */
function blastMonster(s: Started, typ: number, dam: number): Monster {
  const midx = s.state.monsters.findIndex((m, i) => i > 0 && !!m);
  expect(midx, "the generated level should contain a monster").toBeGreaterThan(0);
  const mon = s.state.monsters[midx]!;
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
  return mon;
}

describe("a handler installed after the game is wired reaches project_m", () => {
  it("seeds the fourth table with core's 56, and leaves the original alone", () => {
    const s = started(9501, 3);
    const reg = s.state.projectionHandlers!;
    expect(reg.mon.codes()).toEqual([...MONSTER_HANDLERS_BY_CODE.keys()]);
    const before = MONSTER_HANDLERS_BY_CODE.size;
    reg.mon.set("leak-check", () => {});
    expect(MONSTER_HANDLERS_BY_CODE.size).toBe(before);
    expect(started(9502, 3).state.projectionHandlers!.mon.has("leak-check")).toBe(
      false,
    );
  });

  it("CONTROL: with no mod, core's own ACID handler runs and does core's job", () => {
    const s = started(9503, 3);
    const seen: { code: string; dam: number }[] = [];
    for (const code of s.state.projectionHandlers!.mon.codes()) {
      const core = s.state.projectionHandlers!.mon.handlerFor(code)!;
      s.state.projectionHandlers!.mon.set(code, (ctx) => {
        seen.push({ code, dam: ctx.dam });
        core(ctx);
      });
    }
    const mon = blastMonster(s, projOf(s.cast, "ACID"), 40);
    expect(seen.map((e) => e.code)).toEqual(["ACID"]);
    expect(seen[0]!.dam).toBeGreaterThan(0);
    expect(mon).toBeTruthy();
  });

  it("a mod's handler replaces core's for a CORE code, and mutates the context", () => {
    const s = started(9503, 3);
    const calls: { hp: number; dam: number }[] = [];
    s.host.projections.mon.set("ACID", (ctx) => {
      calls.push({ hp: ctx.mon.hp, dam: ctx.dam });
      /* What a mod's handler is FOR: change the outcome. Skipping the effect
       * entirely is the most visible thing it can do, and it is observable
       * from outside as the monster taking no damage at all. */
      ctx.dam = 0;
      ctx.skipped = true;
    });
    const mon = s.state.monsters.find((m, i) => i > 0 && !!m)!;
    const hpBefore = mon.hp;
    blastMonster(s, projOf(s.cast, "ACID"), 40);
    expect(calls.length).toBe(1);
    expect(calls[0]!.dam).toBeGreaterThan(0);
    expect(mon.hp).toBe(hpBefore);
  });

  it("mod B wraps mod A's monster handler, per code", () => {
    const s = started(9504, 3);
    const order: string[] = [];
    s.host.projections.mon.set("ACID", (ctx) => {
      order.push("A");
      ctx.skipped = true;
    });
    const previous = s.host.projections.mon.handlerFor("ACID");
    expect(previous).toBeTruthy();
    s.host.projections.mon.set("ACID", (ctx) => {
      order.push("B-before");
      previous!(ctx);
      order.push("B-after");
    });
    blastMonster(s, projOf(s.cast, "ACID"), 40);
    expect(order).toEqual(["B-before", "A", "B-after"]);
  });

  it("is gated by registry:projection like the other three sides", () => {
    const s = started(9505, 3);
    const gated = createModRegistryHost(
      { projections: s.state.projectionHandlers ?? null },
      { has: (c: string) => c === "registry:effect" },
    );
    for (const call of [
      (): void => {
        gated.projections.mon.set("ACID", () => {});
      },
      (): void => void gated.projections.mon.handlerFor("ACID"),
      (): void => void gated.projections.mon.codes(),
    ]) {
      expect(call).toThrow(AgentCapabilityError);
      expect(call).toThrow(/registry:projection/);
    }
    expect(s.state.projectionHandlers!.mon.handlerFor("ACID")).toBe(
      MONSTER_HANDLERS_BY_CODE.get("ACID"),
    );
  });
});

describe("a MOD'S OWN projection finally does something to a monster", () => {
  /* THE POINT OF ROW 7. Everything above could be satisfied by a table keyed
   * on core's 56 codes. This is the case that could not work at all before:
   * a projection.json record with a code the enum never heard of binds at
   * index 56, and the old dispatch was `MONSTER_HANDLERS[56]` - undefined,
   * guarded, silent. Terrain, objects and the player all handled it. */
  const moddedPack: GamePack = {
    ...pack,
    projection: [
      ...(pack.projection ?? []),
      {
        code: "SOULFIRE",
        name: "soulfire",
        type: "environs",
        desc: "soulfire",
        "player-desc": "soulfire",
        "blind-desc": "something",
        "lash-desc": "soulfire",
        color: "r",
        obvious: 1,
      },
    ],
  };

  function startedModded(seed: number): Started {
    const game = startGame(moddedPack, { seed, depth: 3, className: "Warrior" });
    const state = game.state;
    const messages: string[] = [];
    state.msg = (t: string): void => {
      messages.push(t);
    };
    const effect = game.wizardBundles.effect;
    expect(effect).toBeTruthy();
    return {
      game,
      state,
      cast: effect!.cast,
      messages,
      host: createModRegistryHost({ projections: state.projectionHandlers ?? null }),
    };
  }

  it("binds past the 56 compiled slots and has no core monster handler", () => {
    const s = startedModded(9601);
    expect(projOf(s.cast, "SOULFIRE")).toBe(56);
    expect(s.state.projectionHandlers!.mon.has("SOULFIRE")).toBe(false);
  });

  /* WHAT "does nothing to a monster" ACTUALLY MEANT, measured rather than
   * assumed. A mod's projection with no monster handler is NOT inert: project_m
   * still runs its driver, so the raw damage lands through mon_take_hit. What
   * has no way to happen is everything TYPE-SPECIFIC - resistance, immunity,
   * the damage the type would have been scaled to, fear / stun / confusion,
   * polymorph, teleport, the "it is unaffected" line, obviousness. The handler
   * is the only thing that computes any of it, so a mod's projection could only
   * ever be an untyped hit for exactly its dice. This pair measures that: the
   * control takes the raw damage and cannot be stopped, and the registered
   * handler stops it. */
  it("NEGATIVE CONTROL: with no handler, the damage lands raw and unmodifiable", () => {
    const s = startedModded(9602);
    const mon = s.state.monsters.find((m, i) => i > 0 && !!m)!;
    const hpBefore = mon.hp;
    blastMonster(s, projOf(s.cast, "SOULFIRE"), 40);
    /* Damaged - so the projection is not silently dropped - and the amount is
     * the undiminished blast, because nothing resisted, scaled or capped it. */
    expect(mon.hp).toBeLessThan(hpBefore);
    expect(s.state.projectionHandlers!.mon.has("SOULFIRE")).toBe(false);
  });

  it("a registered handler for the mod's own code RUNS and decides the outcome", () => {
    const s = startedModded(9602);
    const calls: number[] = [];
    s.host.projections.mon.set("SOULFIRE", (ctx) => {
      calls.push(ctx.dam);
      /* The thing the negative control had no way to do: this monster is
       * IMMUNE to soulfire. Nothing but a project_m handler can express it. */
      ctx.dam = 0;
      ctx.skipped = true;
      ctx.hurtMsg = MON_MSG.UNAFFECTED;
    });
    const mon = s.state.monsters.find((m, i) => i > 0 && !!m)!;
    const hpBefore = mon.hp;
    blastMonster(s, projOf(s.cast, "SOULFIRE"), 40);
    expect(calls.length).toBe(1);
    expect(calls[0]).toBeGreaterThan(0);
    /* Same seed, same level, same monster, same grid as the control above -
     * the ONLY difference is the registration, and the monster now survives
     * untouched where the control lost hit points. */
    expect(mon.hp).toBe(hpBefore);
  });
});
