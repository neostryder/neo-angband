import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants.js";
import { FlagSet } from "../bitflag.js";
import { EF, FEAT, MFLAG, MON_TMD, RF, SQUARE, TMD, TV } from "../generated/index.js";
import { ObjRegistry } from "../obj/bind.js";
import type { ObjPackJson } from "../obj/types.js";
import { objectPrep } from "../obj/make.js";
import type { GameObject } from "../obj/object.js";
import { monsterCarry } from "../mon/make.js";
import { floorPile } from "./floor.js";
import { distance, loc, locEq } from "../loc.js";
import { messageSound } from "../msg.js";
import type { MessageType } from "../msg.js";
import { Rng } from "../rng.js";
import { RSF_SIZE } from "../mon/types.js";
import { EffectRegistry, sourcePlayer } from "../effects/interpreter.js";
import type { EffectContext } from "../effects/interpreter.js";
import { registerCoreHandlers } from "../effects/handlers.js";
import { bindProjections } from "../world/projection.js";
import type { ProjectionRecordJson } from "../world/projection.js";
import { addMon, makeBlow, makeRace, makeState, plReg, GRANITE, monReg } from "./harness.js";
import type { GameState } from "./context.js";
import { deleteMonster } from "./context.js";
import { basicPlayerActor } from "./project-cast.js";
import { attachGameEnv } from "./effect-game-env.js";
import { registerGeneralHandlers } from "./effect-general.js";
import { registerTerrainHandlers } from "./effect-terrain.js";
import { targetSetMonster } from "./target.js";
import { decreaseTimeouts } from "./loop.js";
import { getLore } from "../mon/lore.js";
import type { DoMonSpellDeps } from "./mon-cast.js";
import {
  doCmdMonCommand,
  getCommandedMonster,
  monsterAttackMonster,
} from "./mon-cmd.js";

const projections = bindProjections(
  (
    JSON.parse(
      readFileSync(
        new URL("../../../content/pack/projection.json", import.meta.url),
        "utf8",
      ),
    ) as { records: ProjectionRecordJson[] }
  ).records,
);

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as T;
}

const objReg = new ObjRegistry({
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
const objConstants = bindConstants(loadJson("constants"));

/** A plain object of the first ordinary kind of a tval (steal.test.ts pattern). */
function makeObj(tval: number): GameObject {
  const kind = objReg.kinds.find(
    (k) => k.tval === tval && k.kidx < objReg.ordinaryKindCount,
  );
  if (!kind) throw new Error(`no ordinary kind for tval ${tval}`);
  return objectPrep(new Rng(9), objReg, objConstants, kind, 0, "average");
}

function registry(): EffectRegistry {
  const r = new EffectRegistry();
  registerCoreHandlers(r);
  registerGeneralHandlers(r);
  /* EF_EARTHQUAKE for mon-vs-mon SHATTER (mon-blows.c L1098-1101). */
  registerTerrainHandlers(r);
  return r;
}

function deps(state: GameState): DoMonSpellDeps {
  return {
    registry: registry(),
    cast: { projections, maxRange: 20, playerActor: basicPlayerActor(state) },
    spells: monReg.spells,
    envDeps: { timedTable: plReg.timed },
    saveSkill: 0,
  };
}

function env(state: GameState, msgs?: string[]): EffectContext {
  return attachGameEnv(
    {
      rng: state.rng,
      ...(msgs ? { messages: { msg: (t: string) => msgs.push(t) } } : {}),
    },
    {
      state,
      cast: { projections, maxRange: 20, playerActor: basicPlayerActor(state) },
    },
  );
}

/** A visible monster the level-50 player always overpowers. */
function commandable(state: GameState, at = loc(14, 10)) {
  state.actor.player.lev = 50;
  const mon = addMon(state, makeRace({ level: 1 }), at, { hp: 100 });
  mon.mflag.on(MFLAG.VISIBLE);
  targetSetMonster(state, mon);
  return mon;
}

describe("EF_COMMAND (effect-handler-general.c L3479)", () => {
  it("binds the targeted monster with paired timers", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const mon = commandable(state);
    const used = registry().effectSimple(EF.COMMAND, env(state), {
      origin: sourcePlayer(),
      diceString: "10",
    });
    expect(used).toBe(true);
    expect(state.actor.player.timed[TMD.COMMAND]).toBe(10);
    expect(mon.mTimed[MON_TMD.COMMAND]).toBe(10);
    expect(getCommandedMonster(state)).toBe(mon);
  });

  it("a mighty monster resists a novice's command", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    state.actor.player.lev = 1;
    const mon = addMon(state, makeRace({ level: 50 }), loc(14, 10), { hp: 100 });
    mon.mflag.on(MFLAG.VISIBLE);
    targetSetMonster(state, mon);
    /* Sweep seeds: at level 1 vs 50 nearly every roll resists. */
    let resisted = false;
    for (let seed = 1; seed <= 5 && !resisted; seed++) {
      state.rng = new Rng(seed);
      const msgs: string[] = [];
      registry().effectSimple(EF.COMMAND, env(state, msgs), {
        origin: sourcePlayer(),
        diceString: "10",
      });
      resisted = msgs.some((m) => m.endsWith("resists your command!"));
    }
    expect(resisted).toBe(true);
  });

  it("names an UNSEEN resister without naming its race", () => {
    /*
     * effect-handler-general.c L3498 is monster_desc(MDESC_STANDARD). The port
     * hand-capitalised `mon.race.name`, which is right for a monster in plain
     * sight and wrong for one the player cannot see: it told the player exactly
     * what had just resisted them in the dark.
     *
     * The assertion is "the race name does not appear" rather than a literal
     * expected word. MDESC_STANDARD carries both PRO_HID and IND_HID, and which
     * of "It" / "Something" / "Someone" comes out depends on the race's own
     * flags - declaring one of them here would be asserting a guess about
     * monsterDesc instead of the property that separates the two
     * implementations.
     */
    const state = makeState({ playerGrid: loc(10, 10) });
    state.actor.player.lev = 1;
    const mon = addMon(state, makeRace({ level: 50 }), loc(14, 10), { hp: 100 });
    /* Deliberately NOT visible - that is the whole point. The target is set
     * directly rather than through targetSetMonster, which (like upstream's
     * target_able) refuses an unseen monster: this is the state a monster
     * reaches by going unseen BETWEEN being targeted and the effect resolving,
     * and the handler re-reads state.target.midx at resolution time. */
    mon.mflag.on(MFLAG.VISIBLE);
    targetSetMonster(state, mon);
    mon.mflag.off(MFLAG.VISIBLE);

    let resist: string | undefined;
    for (let seed = 1; seed <= 5 && !resist; seed++) {
      state.rng = new Rng(seed);
      const msgs: string[] = [];
      registry().effectSimple(EF.COMMAND, env(state, msgs), {
        origin: sourcePlayer(),
        diceString: "10",
      });
      resist = msgs.find((m) => m.endsWith("resists your command!"));
    }
    expect(resist).toBeDefined();
    expect(resist).not.toContain(mon.race.name);
  });

  it("refuses without a monster target", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const msgs: string[] = [];
    const used = registry().effectSimple(EF.COMMAND, env(state, msgs), {
      origin: sourcePlayer(),
      diceString: "10",
    });
    expect(used).toBe(false);
    expect(msgs).toContain("No monster selected!");
  });
});

describe("do_cmd_mon_command (cmd-cave.c L1755)", () => {
  it("walks the commanded monster across open floor", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const mon = commandable(state);
    mon.mTimed[MON_TMD.COMMAND] = 10;
    const energy = doCmdMonCommand(state, { code: "walk", dir: 6 }, deps(state));
    expect(energy).toBe(state.z.moveEnergy);
    expect(locEq(mon.grid, loc(15, 10))).toBe(true);
    expect(state.chunk.mon(loc(15, 10))).toBe(mon.midx);
  });

  it("refuses to move an immobile monster", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const msgs: string[] = [];
    state.msg = (t) => msgs.push(t);
    const mon = commandable(state);
    mon.race.flags.on(RF.NEVER_MOVE);
    mon.mTimed[MON_TMD.COMMAND] = 10;
    const energy = doCmdMonCommand(state, { code: "walk", dir: 6 }, deps(state));
    expect(energy).toBe(0);
    expect(msgs).toContain("The monster can not move.");
  });

  it("a wall blocks a normal monster with a message", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const msgs: string[] = [];
    state.msg = (t) => msgs.push(t);
    const mon = commandable(state, loc(14, 10));
    mon.mTimed[MON_TMD.COMMAND] = 10;
    state.chunk.setFeat(loc(15, 10), GRANITE);
    const energy = doCmdMonCommand(state, { code: "walk", dir: 6 }, deps(state));
    expect(energy).toBe(state.z.moveEnergy); /* still a turn */
    expect(msgs).toContain("The way is blocked.");
    expect(locEq(mon.grid, loc(14, 10))).toBe(true);
  });

  it("walking into a monster attacks it", () => {
    const state = makeState({ playerGrid: loc(10, 10), seed: 3 });
    const mon = commandable(state);
    mon.mTimed[MON_TMD.COMMAND] = 10;
    /* A strong attacker guarantees observable damage across blows. */
    const brute = makeRace({
      level: 30,
      blows: [makeBlow("HIT", "HURT", "10d10")],
    });
    state.monsters[mon.midx]!.race = brute;
    const victim = addMon(state, makeRace({ level: 1, ac: 0 }), loc(15, 10), {
      hp: 500,
    });
    victim.mflag.on(MFLAG.VISIBLE);

    let hurt = false;
    for (let seed = 1; seed <= 8 && !hurt; seed++) {
      state.rng = new Rng(seed);
      victim.hp = 500;
      doCmdMonCommand(state, { code: "walk", dir: 6 }, deps(state));
      hurt = victim.hp < 500;
    }
    expect(hurt).toBe(true);
    /* The attacker did not move into the victim's grid. */
    expect(locEq(state.monsters[mon.midx]!.grid, loc(14, 10))).toBe(true);
  });

  it("'read' releases the monster and both timers", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const mon = commandable(state);
    mon.mTimed[MON_TMD.COMMAND] = 10;
    state.actor.player.timed[TMD.COMMAND] = 10;
    const energy = doCmdMonCommand(state, { code: "read" }, deps(state));
    expect(energy).toBe(state.z.moveEnergy);
    expect(mon.mTimed[MON_TMD.COMMAND]).toBe(0);
    expect(state.actor.player.timed[TMD.COMMAND]).toBe(0);
    expect(getCommandedMonster(state)).toBeNull();
  });

  it("a spell-less monster cannot cast", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const msgs: string[] = [];
    state.msg = (t) => msgs.push(t);
    const mon = commandable(state);
    /* A fresh, empty spell set (the harness race shares the registry's). */
    mon.race = { ...mon.race, spellFlags: new FlagSet(RSF_SIZE) };
    mon.mTimed[MON_TMD.COMMAND] = 10;
    /* Another monster to target with the cast. */
    const other = addMon(state, makeRace(), loc(16, 10), { hp: 30 });
    other.mflag.on(MFLAG.VISIBLE);
    targetSetMonster(state, other);
    const energy = doCmdMonCommand(state, { code: "cast" }, deps(state));
    expect(energy).toBe(0);
    expect(msgs).toContain("This monster has no spells!");
  });
});

describe("the TMD_COMMAND lifecycle", () => {
  it("the world tick keeps the timers aligned in sight", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const mon = commandable(state);
    mon.mTimed[MON_TMD.COMMAND] = 10;
    state.actor.player.timed[TMD.COMMAND] = 10;
    decreaseTimeouts(state);
    expect(state.actor.player.timed[TMD.COMMAND]).toBe(9);
    expect(mon.mTimed[MON_TMD.COMMAND]).toBe(9);
  });

  it("out of sight is out of mind", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const mon = commandable(state, loc(16, 10));
    mon.mTimed[MON_TMD.COMMAND] = 10;
    state.actor.player.timed[TMD.COMMAND] = 10;
    /* Wall off the line of sight. */
    for (let y = 1; y < state.chunk.height - 1; y++) {
      state.chunk.setFeat(loc(15, y), GRANITE);
    }
    decreaseTimeouts(state);
    expect(state.actor.player.timed[TMD.COMMAND]).toBe(0);
    expect(mon.mTimed[MON_TMD.COMMAND]).toBe(0);
  });

  it("a commanded monster dying releases the player", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const mon = commandable(state);
    mon.mTimed[MON_TMD.COMMAND] = 10;
    state.actor.player.timed[TMD.COMMAND] = 10;
    deleteMonster(state, mon.midx);
    expect(state.actor.player.timed[TMD.COMMAND]).toBe(0);
  });
});

describe("monster_attack_monster (mon-attack.c L765)", () => {
  it("NEVER_BLOW monsters cannot attack", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const mon = addMon(state, makeRace({ flags: [RF.NEVER_BLOW] }), loc(5, 5), {
      hp: 50,
    });
    const target = addMon(state, makeRace(), loc(6, 5), { hp: 50 });
    expect(monsterAttackMonster(state, mon, target)).toBe(false);
    expect(target.hp).toBe(50);
  });

  it("lands HURT damage through mon_take_nonplayer_hit (armour, no becomeAware)", () => {
    /* mon_take_nonplayer_hit (mon-util.c L1193) does NOT call become_aware;
     * only mon_take_hit does. Camouflaged mon-vs-mon targets stay camouflaged
     * but still take armour-reduced damage. */
    const state = makeState({ playerGrid: loc(10, 10) });
    const blow = makeBlow("HIT", "HURT", "5d5");
    const mon = addMon(
      state,
      makeRace({ level: 20, blows: [blow, blow, blow] }),
      loc(5, 5),
      { hp: 50 },
    );
    const target = addMon(state, makeRace({ ac: 0 }), loc(6, 5), { hp: 200 });
    target.mflag.on(MFLAG.CAMOUFLAGE);

    let revealed: number | null = null;
    state.becomeAware = (m) => {
      revealed = m.midx;
    };

    monsterAttackMonster(state, mon, target);

    expect(revealed).toBeNull();
    expect(target.hp).toBeLessThan(200);
    expect(target.mflag.has(MFLAG.CAMOUFLAGE)).toBe(true);
  });

  it("emits the blow method msgt type on the typed-message seam (mon-blows.c L236)", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const blow = makeBlow("HIT", "HURT", "2d2");
    const mon = addMon(
      state,
      makeRace({ level: 20, blows: [blow] }),
      loc(5, 5),
      { hp: 50 },
    );
    mon.mflag.on(MFLAG.VISIBLE);
    const target = addMon(state, makeRace({ ac: 0 }), loc(6, 5), { hp: 200 });
    target.mflag.on(MFLAG.VISIBLE);

    const typed: Array<{ text: string; type?: string | number }> = [];
    const sounds: number[] = [];
    /* The host's sink IS msgt (#239): carrying the type is what asks for the
     * sound, and core's `messageSound` is that rule - run it rather than
     * restating it, so this stays a test of the blow site and not of a copy. */
    state.msg = (text, type?: MessageType) => {
      typed.push(type === undefined ? { text } : { text, type });
      const cue = messageSound(type);
      if (cue !== null) state.sound?.(cue);
    };
    state.sound = (t) => {
      sounds.push(t);
    };

    monsterAttackMonster(state, mon, target);

    const blowLine = typed.find((m) => m.text.includes("hits") || m.text.includes("HIT") || /hits|claws|bites|crushes|touches|kicks/.test(m.text) || m.type);
    /* method.msgt for HIT is MON_HIT in blow_methods.txt. */
    expect(typed.some((m) => m.type === "MON_HIT" || m.type === blow.method?.msgt)).toBe(true);
    expect(sounds.length).toBeGreaterThan(0);
    expect(blowLine).toBeDefined();
  });

  it("reduces mon-vs-mon HURT damage by racial armour (mon-blows.c L661)", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    /* Fixed 10 damage, high AC so adjust_dam_armor cuts it. */
    const blow = makeBlow("HIT", "HURT", "10");
    const mon = addMon(
      state,
      makeRace({ level: 1, blows: [blow] }),
      loc(5, 5),
      { hp: 50 },
    );
    const soft = addMon(state, makeRace({ ac: 0 }), loc(6, 5), { hp: 100 });
    const hard = addMon(state, makeRace({ ac: 100 }), loc(7, 5), { hp: 100 });

    state.rng = new Rng(1);
    monsterAttackMonster(state, mon, soft);
    const softLost = 100 - soft.hp;

    state.rng = new Rng(1);
    mon.race.blows = [blow];
    monsterAttackMonster(state, mon, hard);
    const hardLost = 100 - hard.hp;

    expect(softLost).toBeGreaterThan(0);
    expect(hardLost).toBeLessThan(softLost);
  });

  it("records blow lore times_seen for a visible attacker (mon-attack.c L872-898)", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const blow = makeBlow("HIT", "HURT", "1d1");
    const mon = addMon(
      state,
      makeRace({ level: 5, blows: [blow] }),
      loc(5, 5),
      { hp: 50 },
    );
    mon.mflag.on(MFLAG.VISIBLE);
    const target = addMon(state, makeRace({ ac: 0 }), loc(6, 5), { hp: 50 });
    const lore = getLore(state.lore, mon.race);
    expect(lore.blowTimesSeen[0] ?? 0).toBe(0);

    monsterAttackMonster(state, mon, target);

    expect(lore.blowTimesSeen[0]).toBe(1);
  });

  it("SHATTER earthquake RNG is identical with or without deps (mon-blows.c L1098-1101)", () => {
    /* Decision 6.2: EF_EARTHQUAKE draws must not depend on caller wiring.
     * Same seed + game state with deps vs without must leave the same RNG. */
    const blow = makeBlow("HIT", "SHATTER", "50");
    const setup = (seed: number) => {
      const state = makeState({ playerGrid: loc(20, 10), seed, w: 60, h: 40 });
      /* depth > 0 so handleEARTHQUAKE runs the grid/monster draw loop. */
      state.chunk.depth = 5;
      const mon = addMon(
        state,
        makeRace({ level: 50, blows: [blow] }),
        loc(10, 10),
        { hp: 200 },
      );
      /* High HP so mon_take_nonplayer_hit does not kill before the quake. */
      const target = addMon(state, makeRace({ ac: 0 }), loc(11, 10), {
        hp: 500,
      });
      return { state, mon, target };
    };

    const withDeps = setup(42);
    monsterAttackMonster(
      withDeps.state,
      withDeps.mon,
      withDeps.target,
      deps(withDeps.state),
    );
    const rngWith = withDeps.state.rng.getState();

    const withoutDeps = setup(42);
    monsterAttackMonster(
      withoutDeps.state,
      withoutDeps.mon,
      withoutDeps.target,
      null,
    );
    const rngWithout = withoutDeps.state.rng.getState();

    expect(rngWithout).toEqual(rngWith);
    /* Sanity: the blow landed and reduced HP (quake may also harm). */
    expect(withDeps.target.hp).toBeLessThan(500);
    expect(withoutDeps.target.hp).toBeLessThan(500);
  });
});

/**
 * SHATTER's two gates and their boundaries (mon-blows.c L1086-1115).
 *
 * The M-1 deps-parity proof above holds only for the one config it ran: damage
 * 50, target surviving, radius 4. Codex flagged the untested sub-paths when it
 * approved that proof -- thrust_away firing vs not firing, the target dying
 * mid-blow, and radius variation -- and warned against letting the approval read
 * as exhaustive. This closes that debt.
 *
 * The C, in order, after adjust_dam_armor:
 *
 *     if (monster_damage_target(context, false)) return;      // L1095
 *     if (context->damage > 23) { radius = damage / 12; ... }  // L1097-1101
 *     if (context->damage > 100) {                             // L1105
 *         int value = context->damage - 100;
 *         if (randint1(value) > 40) { dist = 1 + value / 40; thrust_away(...) }
 *     }
 *
 * Two boundaries are worth pinning exactly because a plausible mistake changes
 * them by one:
 *
 * - `damage > 23` with `radius = damage / 12` is INTEGER division, so 47 gives
 *   radius 3 and 48 gives 4. Rounding instead of truncating would give 4 for both.
 * - `randint1(value) > 40` can never fire when `value <= 40`, i.e. never below
 *   damage 141. Writing `>= 40` would make damage 140 knock back one time in 40.
 *
 * The observable for the quake is terrain memory, not damage: the handler clears
 * SQUARE_ROOM / VAULT / GLOW / SEEN for EVERY grid within the radius before the
 * 85% per-grid skip (effect-terrain.ts:552-557, effect-handler-attack.c
 * L1337-1352), so the cleared set is exactly {g : distance(centre, g) <= r} and
 * reads the radius off directly with no sampling.
 */
describe("SHATTER sub-paths (mon-blows.c L1086-1115)", () => {
  /* Big field: radius reaches 15, and the player sits far enough out that the
   * quake never crushes or relocates them. */
  const CENTRE = loc(25, 20);
  const TARGET = loc(26, 20);
  const PLAYER = loc(55, 35);

  interface Shatter {
    readonly state: GameState;
    readonly mon: ReturnType<typeof addMon>;
    readonly target: ReturnType<typeof addMon>;
    /** Max distance from the epicentre at which a grid lost SQUARE_SEEN. */
    readonly quakeExtent: number;
    readonly targetAlive: boolean;
    readonly rngAfter: ReturnType<Rng["getState"]>;
  }

  /**
   * One blow, one observation. `effect` is a parameter so a HURT control can be
   * run through the identical draw sequence up to the point where the C returns.
   */
  function shatter(opts: {
    damage: number;
    seed: number;
    depth: number;
    targetHp: number;
    effect?: string;
  }): Shatter {
    const { damage, seed, depth, targetHp } = opts;
    const state = makeState({ playerGrid: PLAYER, seed, w: 60, h: 40 });
    state.chunk.depth = depth;
    const blow = makeBlow("HIT", opts.effect ?? "SHATTER", String(damage));
    const mon = addMon(state, makeRace({ level: 50, blows: [blow] }), CENTRE, {
      hp: 500,
    });
    const target = addMon(state, makeRace({ ac: 0 }), TARGET, { hp: targetHp });

    /* Mark every fully-in-bounds grid SEEN so the cleared set is unambiguous --
     * whatever level setup did beforehand is overwritten. */
    for (let y = 0; y < state.chunk.height; y++) {
      for (let x = 0; x < state.chunk.width; x++) {
        const g = loc(x, y);
        if (state.chunk.inBoundsFully(g)) state.chunk.sqinfoOn(g, SQUARE.SEEN);
      }
    }

    monsterAttackMonster(state, mon, target, deps(state));

    let quakeExtent = -1;
    for (let y = 0; y < state.chunk.height; y++) {
      for (let x = 0; x < state.chunk.width; x++) {
        const g = loc(x, y);
        if (!state.chunk.inBoundsFully(g)) continue;
        if (state.chunk.sqinfoHas(g, SQUARE.SEEN)) continue;
        const d = distance(CENTRE, g);
        if (d > quakeExtent) quakeExtent = d;
      }
    }

    return {
      state,
      mon,
      target,
      quakeExtent,
      targetAlive: state.monsters[target.midx] !== null,
      rngAfter: state.rng.getState(),
    };
  }

  it("does not quake at damage 23 and quakes to radius 2 at 24 (L1097)", () => {
    /* The gate is strictly greater, so 23 is the last quiet value. */
    const quiet = shatter({ damage: 23, seed: 7, depth: 5, targetHp: 5000 });
    expect(quiet.target.hp, "the blow must have landed to test the gate").toBeLessThan(5000);
    expect(quiet.quakeExtent, "damage 23 must not shake the ground at all").toBe(-1);

    const shaken = shatter({ damage: 24, seed: 7, depth: 5, targetHp: 5000 });
    expect(shaken.target.hp).toBeLessThan(5000);
    expect(shaken.quakeExtent, "damage 24 -> radius 24/12 = 2").toBe(2);
  });

  it("radius is damage/12 truncated, not rounded (L1098)", () => {
    /* 47/12 = 3.9 and 48/12 = 4.0: a rounding implementation gives 4 for both. */
    for (const [damage, radius] of [
      [24, 2],
      [47, 3],
      [48, 4],
      [60, 5],
      [120, 10],
    ] as const) {
      const r = shatter({ damage, seed: 11, depth: 5, targetHp: 20_000 });
      expect(r.target.hp, `damage ${damage}: the blow must land`).toBeLessThan(20_000);
      expect(r.quakeExtent, `damage ${damage} -> radius ${radius}`).toBe(radius);
    }
  });

  it("a target killed by the blow gets neither quake nor knockback draw (L1095)", () => {
    /* monster_damage_target returning true returns from the handler, so the C
     * makes NO further draws. A HURT blow at the same damage and seed returns at
     * exactly the same point, so the two RNG states must be identical -- which is
     * a stronger statement than "no quake happened": it also proves the
     * randint1(value) knockback roll was never taken. */
    const killed = shatter({ damage: 200, seed: 3, depth: 5, targetHp: 1 });
    expect(killed.targetAlive, "damage 200 vs 1 hp must kill the target").toBe(false);
    expect(killed.quakeExtent, "a dead target means no earthquake").toBe(-1);

    const control = shatter({
      damage: 200,
      seed: 3,
      depth: 5,
      targetHp: 1,
      effect: "HURT",
    });
    expect(control.targetAlive).toBe(false);
    expect(
      killed.rngAfter,
      "a fatal SHATTER must draw exactly what a fatal HURT draws",
    ).toEqual(control.rngAfter);
  });

  it("knockback cannot fire at or below damage 140 (L1107, > not >=)", () => {
    /* value = damage - 100 = 40, and randint1(40) tops out at 40, so
     * `randint1(value) > 40` is unsatisfiable. Town depth so the earthquake
     * short-circuits (effect-handler-attack.c L1319-1326) and thrust_away is the
     * only thing that could move the target. */
    let landed = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = shatter({ damage: 140, seed, depth: 0, targetHp: 20_000 });
      if (r.target.hp === 20_000) continue; /* blow missed; not a knockback case */
      landed++;
      expect(
        r.target.grid,
        `seed ${seed}: randint1(40) can never exceed 40, so the target must not move`,
      ).toEqual(TARGET);
    }
    /* Without this the whole loop could `continue` and assert nothing. */
    expect(landed, "some seed must actually land the blow").toBeGreaterThan(0);
  });

  it("knockback fires above damage 140 and moves the target away (L1108-1112)", () => {
    /* value = 100 -> randint1(100) > 40 about 60% of the time, dist = 1 + 100/40
     * = 3. Sweep seeds and require BOTH outcomes: if every seed moved, the roll
     * is not being consulted; if none did, thrust_away is not wired. */
    let moved = 0;
    let stayed = 0;
    let maxPush = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const r = shatter({ damage: 200, seed, depth: 0, targetHp: 20_000 });
      if (r.target.hp === 20_000) continue;
      if (locEq(r.target.grid, TARGET)) {
        stayed++;
      } else {
        moved++;
        /* thrust_away pushes AWAY from the epicentre, never toward it. */
        const away = distance(CENTRE, r.target.grid);
        expect(away, `seed ${seed}: knockback must increase the distance`).toBeGreaterThan(
          distance(CENTRE, TARGET),
        );
        if (away > maxPush) maxPush = away;
      }
    }
    expect(moved, "some seed must roll randint1(100) > 40").toBeGreaterThan(0);
    expect(stayed, "some seed must roll randint1(100) <= 40").toBeGreaterThan(0);
    /* dist = 1 + trunc(100/40) = 3 grids requested; thrust_away stops early when
     * blocked, so 3 is the ceiling, not the guarantee. */
    expect(maxPush, "1 + 100/40 = 3 grids from a start distance of 1").toBeLessThanOrEqual(4);
  });

  it("the knockback roll is taken above 100 and skipped at 100 (L1105)", () => {
    /* Town depth throughout, so the quake contributes no draws and the knockback
     * roll is the only thing that can move the RNG.
     *
     * ON THE BOUNDARY, stated because it limits what this can prove: `damage >
     * 100` and `damage >= 100` are BEHAVIOURALLY IDENTICAL here, and no test can
     * separate them. At exactly 100 value is 0, and randint1(0) returns 1 without
     * drawing in both implementations -- Rand_div returns 0 for m <= 1 with no
     * draw (z-rand.c:176, rng.ts:187) -- and 1 > 40 is false either way. So the
     * `>` is pinned by reading, not by measurement. Same for 101: randint1(1) also
     * takes the m <= 1 short circuit.
     *
     * What IS measurable is that the roll happens once the gate opens for real.
     * At damage 102 value is 2, randint1(2) draws, and the draw must show up as a
     * divergence from the HURT control while still never exceeding 40. */
    const at100 = shatter({ damage: 100, seed: 5, depth: 0, targetHp: 20_000 });
    const hurt100 = shatter({
      damage: 100,
      seed: 5,
      depth: 0,
      targetHp: 20_000,
      effect: "HURT",
    });
    expect(at100.target.hp, "the blow must land for the comparison to mean anything").toBeLessThan(
      20_000,
    );
    expect(at100.target.grid).toEqual(TARGET);
    expect(at100.rngAfter, "damage 100 must draw no knockback roll").toEqual(hurt100.rngAfter);

    const at102 = shatter({ damage: 102, seed: 5, depth: 0, targetHp: 20_000 });
    const hurt102 = shatter({
      damage: 102,
      seed: 5,
      depth: 0,
      targetHp: 20_000,
      effect: "HURT",
    });
    expect(at102.target.hp).toBeLessThan(20_000);
    expect(
      at102.rngAfter,
      "damage 102 -> value 2 -> randint1(2) must consume a draw the HURT control does not",
    ).not.toEqual(hurt102.rngAfter);
    expect(at102.target.grid, "randint1(2) can never exceed 40").toEqual(TARGET);
  });
});

/**
 * The commanded drop (cmd-cave.c CMD_DROP, L1854-1868), PORT_TODO 2.18.
 *
 * The branch used to be a `break` under the note "monster-held objects are not
 * modelled". Every fixture below fills mon.heldObj with monsterCarry - the same
 * call a generated monster's treasure, a TAKE_ITEM pickup and an EAT_ITEM theft
 * all make - which is the measurement that the note was describing a state that
 * had ended.
 */
describe("do_cmd_mon_command CMD_DROP (cmd-cave.c L1854)", () => {
  /** A commanded monster holding `n` distinct wands, and the message sink. */
  function holding(n: number) {
    const state = makeState({ playerGrid: loc(10, 10), seed: 7 });
    const msgs: string[] = [];
    state.msg = (t) => msgs.push(t);
    const mon = commandable(state, loc(14, 10));
    mon.mTimed[MON_TMD.COMMAND] = 10;
    const carried: GameObject[] = [];
    for (let i = 0; i < n; i++) {
      const obj = makeObj(TV.WAND);
      monsterCarry(mon.heldObj, obj, mon.midx);
      carried.push(obj);
    }
    return { state, mon, msgs, carried };
  }

  it("moves one held item onto the monster's own grid and says so", () => {
    const { state, mon, msgs, carried } = holding(1);
    const only = carried[0]!;

    const energy = doCmdMonCommand(state, { code: "drop" }, deps(state));

    expect(energy).toBe(state.z.moveEnergy);
    expect(mon.heldObj).toHaveLength(0);
    expect(floorPile(state, loc(14, 10))).toContain(only);
    /* drop_near(..., mon->grid, ...) - the monster's grid, not the player's. */
    expect(floorPile(state, loc(10, 10))).toHaveLength(0);
    /* "%s drops %s." with m_name = MDESC_CAPITAL|IND_HID|COMMA. */
    expect(msgs.some((m) => / drops .*\.$/u.test(m))).toBe(true);
  });

  it("clears held_m_idx even when the drop finds nowhere to land", () => {
    const { state, mon, carried } = holding(1);
    const only = carried[0]!;
    expect(only.heldMIdx).toBeGreaterThan(0);

    /*
     * WHY THE OBJECT MUST FAIL TO LAND. `obj->held_m_idx = 0` is L1858, BEFORE
     * drop_near - and on the success path floorCarry sets the same field itself
     * (floor.ts:364), so an assertion after an ordinary drop passes whether the
     * line is there or not. It did: the mutation that deleted L1858 survived
     * the first version of this test. drop_find_grid needs a floor grid within
     * its 7x7 window, so walling the window off is what makes floor_carry fail
     * and leaves the object with nobody to clear it but L1858.
     */
    for (let dy = -3; dy <= 3; dy++) {
      for (let dx = -3; dx <= 3; dx++) {
        state.chunk.setFeat(loc(14 + dx, 10 + dy), GRANITE);
      }
    }

    doCmdMonCommand(state, { code: "drop" }, deps(state));

    expect(mon.heldObj).toHaveLength(0);
    expect(floorPile(state, loc(14, 10))).toHaveLength(0);
    expect(only.heldMIdx).toBe(0);
  });

  it("drops exactly one PILE ENTRY of two, and keeps the other held", () => {
    const { state, mon } = holding(0);
    /* Two different tvals: monsterCarry stacks mergeable objects into ONE
     * entry, and upstream excises a whole entry - so two wands would be one
     * drop and prove nothing about the choice. */
    monsterCarry(mon.heldObj, makeObj(TV.WAND), mon.midx);
    monsterCarry(mon.heldObj, makeObj(TV.SWORD), mon.midx);
    expect(mon.heldObj).toHaveLength(2);

    doCmdMonCommand(state, { code: "drop" }, deps(state));

    expect(mon.heldObj).toHaveLength(1);
    expect(floorPile(state, loc(14, 10))).toHaveLength(1);
  });

  it("an empty pile still spends the turn and says nothing", () => {
    const { state, msgs } = holding(0);

    const energy = doCmdMonCommand(state, { code: "drop" }, deps(state));

    /* Upstream `break`s out of the switch rather than returning, so the
     * monster still loses its turn standing there (L1857). */
    expect(energy).toBe(state.z.moveEnergy);
    expect(msgs).toHaveLength(0);
  });

  it("an ignored item lands silently", () => {
    const { state, mon, msgs, carried } = holding(1);
    const only = carried[0]!;
    /* ignore_item_ok(player, obj) (L1863): the drop happens either way, only
     * the message is suppressed. */
    state.isIgnored = (o) => o === only;

    doCmdMonCommand(state, { code: "drop" }, deps(state));

    expect(mon.heldObj).toHaveLength(0);
    expect(floorPile(state, loc(14, 10))).toContain(only);
    expect(msgs.some((m) => m.includes("drops"))).toBe(false);
  });
});

/**
 * The commanded walk's terrain branch (cmd-cave.c L1900-1968), PORT_TODO 2.19.
 *
 * Upstream calls the same five cave-square.c mutators here that it calls from
 * monster_turn_can_move. The port had two sets: a correct one private to
 * monster-turn.ts and a degraded one open-coded here, which folded SMASH_WALL
 * into KILL_WALL and set the door feature without removing the door's lock.
 * Both sets are now one module (game/cave-square.ts), so these tests are
 * about the CALL, not about the bodies - which monster-turn.test.ts already
 * covers.
 */
describe("commanded walk terrain (cmd-cave.c L1900), PORT_TODO 2.19", () => {
  /** A commanded monster at (14,10) with granite everywhere it could reach. */
  function inTheRock(flags: number[], seed = 11) {
    const state = makeState({ playerGrid: loc(10, 10), seed });
    const msgs: string[] = [];
    state.msg = (t) => msgs.push(t);
    const mon = commandable(state, loc(14, 10));
    mon.race.flags = new FlagSet(mon.race.flags.size);
    for (const f of flags) mon.race.flags.on(f);
    mon.mTimed[MON_TMD.COMMAND] = 10;
    /* A 5x5 block of granite around the target, so the survival rolls have
     * neighbours to roll for. */
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        const g = loc(15 + dx, 10 + dy);
        if (!locEq(g, mon.grid)) state.chunk.setFeat(g, GRANITE);
      }
    }
    return { state, mon, msgs, target: loc(15, 10) };
  }

  /** Every grid within 1 of the target that is no longer rock. */
  function clearedNeighbours(state: GameState, target: { x: number; y: number }) {
    let n = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (dx === 0 && dy === 0) continue;
        if (state.chunk.feat(loc(target.x + dx, target.y + dy)) === FEAT.FLOOR) n++;
      }
    }
    return n;
  }

  it("SMASH_WALL scours the neighbours; KILL_WALL bores one hole", () => {
    const smash = inTheRock([RF.SMASH_WALL]);
    doCmdMonCommand(smash.state, { code: "walk", dir: 6 }, deps(smash.state));

    const kill = inTheRock([RF.KILL_WALL]);
    doCmdMonCommand(kill.state, { code: "walk", dir: 6 }, deps(kill.state));

    /* Both clear the wall itself and step in. */
    expect(smash.state.chunk.feat(smash.target)).toBe(FEAT.FLOOR);
    expect(kill.state.chunk.feat(kill.target)).toBe(FEAT.FLOOR);
    expect(smash.mon.grid).toEqual(smash.target);
    expect(kill.mon.grid).toEqual(kill.target);

    /* square_destroy_wall touches exactly one grid; square_smash_wall keeps
     * only the neighbours that survive one_in_(4). Seed 11 is fixed, so the
     * count is deterministic - the point is that it is not zero. */
    expect(clearedNeighbours(kill.state, kill.target)).toBe(
      /* only the grid the monster vacated, which was floor already */ 1,
    );
    expect(clearedNeighbours(smash.state, smash.target)).toBeGreaterThan(1);
  });

  it("SMASH_WALL draws the survival rolls the RNG stream expects", () => {
    const smash = inTheRock([RF.SMASH_WALL]);
    const before = smash.state.rng.getState();
    doCmdMonCommand(smash.state, { code: "walk", dir: 6 }, deps(smash.state));
    const after = smash.state.rng.getState();

    /* The old body was a bare setFeat: no draws at all, so a commanded smash
     * and a self-directed one desynchronised from each other. */
    expect(after).not.toEqual(before);

    const kill = inTheRock([RF.KILL_WALL]);
    const killBefore = kill.state.rng.getState();
    doCmdMonCommand(kill.state, { code: "walk", dir: 6 }, deps(kill.state));
    expect(
      kill.state.rng.getState(),
      "square_destroy_wall draws nothing - the control",
    ).toEqual(killBefore);
  });

  it("bashing a door removes its lock, not just its feature", () => {
    const { state, target } = inTheRock([RF.BASH_DOOR]);
    state.chunk.setFeat(target, FEAT.CLOSED);
    const unlocked: (typeof target)[] = [];
    state.removeDoorLock = (g) => unlocked.push(g);

    doCmdMonCommand(state, { code: "walk", dir: 6 }, deps(state));

    expect(state.chunk.feat(target)).toBe(FEAT.BROKEN);
    /* square_smash_door (cave-square.c L1367) removes every "door lock" trap
     * first. Without it the burst-open door keeps a lock nothing can pick. */
    expect(unlocked).toHaveLength(1);
    expect(unlocked[0]).toEqual(target);
  });

  it("opening a door removes its lock too", () => {
    const { state, target } = inTheRock([RF.OPEN_DOOR]);
    state.chunk.setFeat(target, FEAT.CLOSED);
    const unlocked: (typeof target)[] = [];
    state.removeDoorLock = (g) => unlocked.push(g);

    doCmdMonCommand(state, { code: "walk", dir: 6 }, deps(state));

    expect(state.chunk.feat(target)).toBe(FEAT.OPEN);
    expect(unlocked).toHaveLength(1);
  });

  it("a locked door is worked on through the state's own door seams", () => {
    const { state, msgs, target } = inTheRock([RF.BASH_DOOR]);
    state.chunk.setFeat(target, FEAT.CLOSED);
    /* The two seams monster_turn_can_move already used. The commanded walk
     * used to reach the same trap by a second route (squareDoorPower with a
     * threaded TrapDeps), so a caller could supply one and not the other. */
    state.doorLockPower = () => 1;
    const set: number[] = [];
    state.setDoorLock = (_g, power) => set.push(power);

    doCmdMonCommand(state, { code: "walk", dir: 6 }, deps(state));

    /* hp 100 -> randint0(10) > 1 usually succeeds; on this seed it does. */
    expect(msgs.some((m) => m.includes("slams against the door"))).toBe(true);
    expect(set).toEqual([0]);
    /* A locked door is never opened by the attempt, only weakened. */
    expect(state.chunk.feat(target)).toBe(FEAT.CLOSED);
  });
});
