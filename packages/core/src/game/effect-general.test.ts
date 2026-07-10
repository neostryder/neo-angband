import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EF, MFLAG, MON_TMD, OF, RF, TV } from "../generated";
import { loc, locEq } from "../loc";
import {
  EffectRegistry,
  sourceMonster,
  sourcePlayer,
} from "../effects/interpreter";
import type { EffectContext } from "../effects/interpreter";
import { registerCoreHandlers } from "../effects/handlers";
import { GLYPH_DECOY, GLYPH_WARDING } from "../effects/effect";
import { bindTraps } from "../world/trap";
import type { TrapRecordJson } from "../world/trap";
import { OBJ_PROPERTY } from "../obj/types";
import type { ObjectKind, ObjectProperty } from "../obj/types";
import { objectNew } from "../obj/object";
import type { GameObject } from "../obj/object";
import { makeRuneEnv } from "../obj/knowledge";
import { addMon, makeRace, makeState, monReg } from "./harness";
import type { GameState } from "./context";
import { basicPlayerActor } from "./project-cast";
import { attachGameEnv } from "./effect-game-env";
import type { GameEffectEnv } from "./effect-game-env";
import { squareIsWarded, squareIsWebbed } from "./trap";
import type { TrapDeps } from "./trap";
import { disenchantEquipment, registerGeneralHandlers } from "./effect-general";
import { processWorld } from "./loop";

const trapKinds = bindTraps(
  (
    JSON.parse(
      readFileSync(
        new URL("../../../content/pack/trap.json", import.meta.url),
        "utf8",
      ),
    ) as { records: TrapRecordJson[] }
  ).records,
);
const trapDeps: TrapDeps = { kinds: trapKinds };

function registry(): EffectRegistry {
  const r = new EffectRegistry();
  registerCoreHandlers(r);
  registerGeneralHandlers(r);
  return r;
}

function env(
  state: GameState,
  game: Partial<GameEffectEnv> = {},
  msgs?: string[],
): EffectContext {
  const base: EffectContext = msgs
    ? { rng: state.rng, messages: { msg: (t) => msgs.push(t) } }
    : { rng: state.rng };
  return attachGameEnv(base, {
    state,
    cast: { projections: [], maxRange: 20, playerActor: basicPlayerActor(state) },
    general: { trapDeps },
    ...game,
  });
}

/** A synthetic enchantable item of the given tval. */
let nextKidx = 700;
function makeItem(tval: number, name = "Widget"): GameObject {
  const kind = {
    kidx: nextKidx++,
    tval,
    name,
    toH: { base: 0, dice: 0, sides: 0, mBonus: 0 },
    base: { maxStack: 40 },
  } as unknown as ObjectKind;
  const obj = objectNew(kind);
  obj.tval = tval;
  obj.number = 1;
  return obj;
}

/** Back the state's rune env with a plain per-slot equipment array. */
function equipArray(state: GameState): (GameObject | null)[] {
  const eq: (GameObject | null)[] = new Array(
    state.actor.player.body.count,
  ).fill(null);
  state.runeEnv = makeRuneEnv(
    (slot) => eq[slot] ?? null,
    (v) => state.rng.randcalcVaries(v),
  );
  return eq;
}

/** The first slot index of the given EQUIP_ type. */
function slotOf(state: GameState, type: string): number {
  const at = state.actor.player.body.slots.findIndex((s) => s.type === type);
  expect(at).toBeGreaterThanOrEqual(0);
  return at;
}

describe("EF_GLYPH (effect-handler-general.c L700)", () => {
  it("places a glyph of warding under the player", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    registry().effectSimple(EF.GLYPH, env(state), {
      origin: sourcePlayer(),
      subtype: GLYPH_WARDING,
    });
    expect(squareIsWarded(state, loc(10, 10))).toBe(true);
  });

  it("deploys a decoy and refuses a second one", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const r = registry();
    r.effectSimple(EF.GLYPH, env(state), {
      origin: sourcePlayer(),
      subtype: GLYPH_DECOY,
    });
    expect(state.decoy && locEq(state.decoy, loc(10, 10))).toBe(true);

    const msgs: string[] = [];
    const ran = r.effectSimple(EF.GLYPH, env(state, {}, msgs), {
      origin: sourcePlayer(),
      subtype: GLYPH_DECOY,
    });
    expect(ran).toBe(false);
    expect(msgs).toContain("You can only deploy one decoy at a time.");
  });

  it("no-ops without a game env (worldless)", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    registry().effectSimple(
      EF.GLYPH,
      { rng: state.rng },
      { origin: sourcePlayer(), subtype: GLYPH_WARDING },
    );
    expect(squareIsWarded(state, loc(10, 10))).toBe(false);
  });
});

describe("EF_WEB (effect-handler-general.c L732)", () => {
  it("webs the floor around the casting monster", () => {
    const state = makeState({ playerGrid: loc(30, 5), seed: 2 });
    const race = { ...makeRace(), spellPower: 10 };
    const mon = addMon(state, race, loc(10, 10), { hp: 30 });

    registry().effectSimple(
      EF.WEB,
      env(state, { monCurrent: mon.midx }),
      { origin: sourceMonster(mon.midx) },
    );

    /* Radius 1 at spell power 10: the whole 3x3 block is webbed. */
    let webbed = 0;
    for (let y = 9; y <= 11; y++)
      for (let x = 9; x <= 11; x++)
        if (squareIsWebbed(state, loc(x, y))) webbed++;
    expect(webbed).toBe(9);
    /* And nothing beyond the radius. */
    expect(squareIsWebbed(state, loc(12, 10))).toBe(false);
  });

  it("a stronger spinner webs a wider area", () => {
    const state = makeState({ playerGrid: loc(30, 5), seed: 2 });
    const race = { ...makeRace(), spellPower: 50 };
    const mon = addMon(state, race, loc(10, 10), { hp: 30 });
    registry().effectSimple(
      EF.WEB,
      env(state, { monCurrent: mon.midx }),
      { origin: sourceMonster(mon.midx) },
    );
    expect(squareIsWebbed(state, loc(12, 10))).toBe(true);
  });

  it("fails for a player source (no acting monster)", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const ran = registry().effectSimple(EF.WEB, env(state), {
      origin: sourcePlayer(),
    });
    expect(ran).toBe(false);
    expect(squareIsWebbed(state, loc(10, 10))).toBe(false);
  });
});

describe("EF_DISENCHANT (effect-handler-general.c L2003)", () => {
  it("disenchants a worn weapon's to-hit and to-dam and refreshes bonuses", () => {
    const state = makeState({ seed: 31 });
    const eq = equipArray(state);
    const sword = makeItem(TV.SWORD, "Test Sword");
    sword.toH = 8;
    sword.toD = 8;
    eq[slotOf(state, "WEAPON")] = sword;
    let refreshes = 0;
    state.updateBonuses = (): void => {
      refreshes++;
    };

    const msgs: string[] = [];
    /* The slot pick is random over all eligible slots; repeat until it
     * lands (deterministic under the fixed seed). */
    for (let i = 0; i < 30; i++) {
      disenchantEquipment(state, { msg: (t) => msgs.push(t) });
    }
    expect(sword.toH).toBeLessThan(8);
    expect(sword.toD).toBeLessThan(8);
    expect(refreshes).toBeGreaterThan(0);
    expect(msgs.some((m) => m.includes("disenchanted!"))).toBe(true);
  });

  it("disenchants armour's to-ac; artifacts can resist", () => {
    const state = makeState({ seed: 32 });
    const eq = equipArray(state);
    const mail = makeItem(TV.HARD_ARMOR, "Test Mail");
    mail.toA = 10;
    mail.artifact = { aidx: 1 } as GameObject["artifact"];
    eq[slotOf(state, "BODY_ARMOR")] = mail;

    const msgs: string[] = [];
    for (let i = 0; i < 40; i++) {
      disenchantEquipment(state, { msg: (t) => msgs.push(t) });
    }
    /* Under the fixed seed both branches fire: some resists, some hits. */
    expect(msgs.some((m) => m.includes("resists disenchantment!"))).toBe(true);
    expect(mail.toA).toBeLessThan(10);
  });

  it("never touches rings, amulets or lights", () => {
    const state = makeState({ seed: 33 });
    const eq = equipArray(state);
    const ring = makeItem(TV.RING, "Test Ring");
    ring.toA = 6;
    eq[slotOf(state, "RING")] = ring;

    for (let i = 0; i < 40; i++) disenchantEquipment(state, {});
    expect(ring.toA).toBe(6);
  });

  it("runs through the effect stack with a game env", () => {
    const state = makeState({ seed: 34 });
    const eq = equipArray(state);
    const sword = makeItem(TV.SWORD);
    sword.toH = 9;
    eq[slotOf(state, "WEAPON")] = sword;

    const r = registry();
    for (let i = 0; i < 30; i++) {
      r.effectSimple(EF.DISENCHANT, env(state), { origin: sourcePlayer() });
    }
    expect(sword.toH).toBeLessThan(9);
  });
});

/** desc_stat backing: a synthetic STR property. */
const statProps = [
  {
    type: OBJ_PROPERTY.STAT,
    propIndex: 0,
    adjective: "strong",
    negAdj: "weak",
  } as ObjectProperty,
];

describe("stat / exp / mana handlers (effect-handler-general.c)", () => {
  it("RESTORE_STAT restores a drained stat with its message", () => {
    const state = makeState({ seed: 51 });
    const p = state.actor.player;
    p.statCur[0] = 10;
    p.statMax[0] = 15;
    const msgs: string[] = [];
    registry().effectSimple(
      EF.RESTORE_STAT,
      env(state, { general: { properties: statProps } }, msgs),
      { origin: sourcePlayer(), subtype: 0 },
    );
    expect(p.statCur[0]).toBe(15);
    expect(msgs).toContain("You feel less weak.");
  });

  it("DRAIN_STAT drains unless the sustain saves it (learning the rune)", () => {
    const state = makeState({ seed: 52 });
    const p = state.actor.player;
    p.statCur[0] = 15;
    p.statMax[0] = 15;
    const msgs: string[] = [];
    registry().effectSimple(
      EF.DRAIN_STAT,
      env(state, { general: { properties: statProps } }, msgs),
      { origin: sourcePlayer(), subtype: 0, diceString: "5" },
    );
    expect(p.statCur[0]).toBe(14);
    expect(msgs).toContain("You feel very weak.");

    /* Sustained: the stat holds and the sustain rune is learned. */
    const held = makeState({ seed: 52 });
    const hp = held.actor.player;
    hp.statCur[0] = 15;
    hp.statMax[0] = 15;
    const vest = makeItem(TV.SOFT_ARMOR, "Vest");
    vest.flags.on(OF.SUST_STR);
    held.gear.store.set(93, vest);
    hp.equipment[0] = 93;
    registry().effectSimple(
      EF.DRAIN_STAT,
      env(held, { general: { properties: statProps } }),
      { origin: sourcePlayer(), subtype: 0, diceString: "5" },
    );
    expect(hp.statCur[0]).toBe(15);
    expect(hp.objKnown.flags.has(OF.SUST_STR)).toBe(true);
  });

  it("GAIN_STAT raises the stat; LOSE_RANDOM_STAT spares the safe one", () => {
    const state = makeState({ seed: 53 });
    const p = state.actor.player;
    p.statCur[0] = 10;
    p.statMax[0] = 10;
    registry().effectSimple(
      EF.GAIN_STAT,
      env(state, { general: { properties: statProps } }),
      { origin: sourcePlayer(), subtype: 0 },
    );
    expect(p.statCur[0]).toBe(11);

    for (let i = 0; i < 5; i++) {
      p.statCur[i] = 12;
      p.statMax[i] = 12;
    }
    registry().effectSimple(EF.LOSE_RANDOM_STAT, env(state), {
      origin: sourcePlayer(),
      subtype: 0,
    });
    expect(p.statMax[0]).toBe(12); /* the safe stat is untouched */
    const dropped = [1, 2, 3, 4].filter((i) => p.statMax[i]! < 12);
    expect(dropped.length).toBe(1);
  });

  it("GAIN_EXP grants half the rolled amount; RESTORE_EXP heals drains", () => {
    const state = makeState({ seed: 54 });
    const p = state.actor.player;
    registry().effectSimple(EF.GAIN_EXP, env(state), {
      origin: sourcePlayer(),
      diceString: "100",
    });
    expect(p.exp).toBe(50);

    p.exp = 40; /* drained below max */
    const msgs: string[] = [];
    registry().effectSimple(EF.RESTORE_EXP, env(state, {}, msgs), {
      origin: sourcePlayer(),
    });
    expect(p.exp).toBe(p.maxExp);
    expect(msgs).toContain("You feel your life energies returning.");
  });

  it("DRAIN_MANA drains the player and heals a monster caster", () => {
    const state = makeState({ seed: 55 });
    const p = state.actor.player;
    p.msp = 10;
    p.csp = 10;
    const race = monReg.races.find((r) => r.rarity > 0 && !r.flags.has(RF.UNIQUE))!;
    const mon = addMon(state, race, loc(10, 10), { hp: 50 });
    mon.hp = 20;
    mon.mflag.on(MFLAG.VISIBLE);

    const msgs: string[] = [];
    registry().effectSimple(EF.DRAIN_MANA, env(state, {}, msgs), {
      origin: sourceMonster(mon.midx),
      diceString: "4",
    });
    expect(p.csp).toBe(6);
    expect(mon.hp).toBe(20 + 6 * 4);
    expect(msgs.some((m) => m.includes("appears healthier."))).toBe(true);

    /* No mana: the draining fails. */
    p.csp = 0;
    const msgs2: string[] = [];
    registry().effectSimple(EF.DRAIN_MANA, env(state, {}, msgs2), {
      origin: sourceMonster(mon.midx),
      diceString: "4",
    });
    expect(msgs2).toContain("The draining fails.");
  });

  it("a decoy soaks DRAIN_MANA and is destroyed", () => {
    const state = makeState({ seed: 56 });
    const p = state.actor.player;
    p.msp = 10;
    p.csp = 10;
    const r = registry();
    r.effectSimple(EF.GLYPH, env(state), {
      origin: sourcePlayer(),
      subtype: GLYPH_DECOY,
    });
    expect(state.decoy).toBeTruthy();
    const race = monReg.races.find((rr) => rr.rarity > 0)!;
    const mon = addMon(state, race, loc(3, 3), { hp: 50 });

    r.effectSimple(EF.DRAIN_MANA, env(state), {
      origin: sourceMonster(mon.midx),
      diceString: "4",
    });
    expect(p.csp).toBe(10); /* untouched */
    expect(state.decoy).toBeNull();
  });

  it("SCRAMBLE_STATS permutes the stats and UNSCRAMBLE_STATS restores them", () => {
    const state = makeState({ seed: 57 });
    const p = state.actor.player;
    const original = [10, 11, 12, 13, 14];
    for (let i = 0; i < 5; i++) {
      p.statCur[i] = original[i]!;
      p.statMax[i] = original[i]!;
      p.statMap[i] = i;
    }
    const r = registry();
    r.effectSimple(EF.SCRAMBLE_STATS, env(state), { origin: sourcePlayer() });
    /* Same multiset of values, tracked by statMap. */
    expect([...p.statCur].sort()).toEqual([...original].sort());

    r.effectSimple(EF.UNSCRAMBLE_STATS, env(state), { origin: sourcePlayer() });
    expect([...p.statCur]).toEqual(original);
    expect([...p.statMap]).toEqual([0, 1, 2, 3, 4]);
  });

  it("RECALL charges the air, cancels on recast, and yanks via processWorld", () => {
    const state = makeState({ seed: 61 });
    const p = state.actor.player;
    state.chunk.depth = 7;
    p.maxDepth = 7;
    const msgs: string[] = [];
    const r = registry();
    r.effectSimple(EF.RECALL, env(state, {}, msgs), { origin: sourcePlayer() });
    expect(p.wordRecall).toBeGreaterThanOrEqual(15);
    expect(p.recallDepth).toBe(7);
    expect(msgs).toContain("The air about you becomes charged...");

    /* Count it down: the yank fires the level-change signal. */
    p.wordRecall = 1;
    const yanks: string[] = [];
    state.msg = (t): void => {
      yanks.push(t);
    };
    processWorld(state);
    expect(p.wordRecall).toBe(0);
    expect(state.generateLevel).toBe(true);
    expect(state.targetDepth).toBe(0);
    expect(yanks).toContain("You feel yourself yanked upwards!");

    /* Recasting an active recall cancels it (default-yes confirm). */
    state.generateLevel = false;
    p.wordRecall = 10;
    const msgs2: string[] = [];
    r.effectSimple(EF.RECALL, env(state, {}, msgs2), { origin: sourcePlayer() });
    expect(p.wordRecall).toBe(0);
    expect(msgs2).toContain("A tension leaves the air around you...");
  });

  it("in town, recall yanks down to the recall depth", () => {
    const state = makeState({ seed: 62 });
    const p = state.actor.player;
    state.chunk.depth = 0;
    p.maxDepth = 12;
    p.wordRecall = 1;
    processWorld(state);
    expect(state.targetDepth).toBe(12);
    expect(state.generateLevel).toBe(true);
  });

  it("DEEP_DESCENT schedules a multi-level drop, or is blocked at depth", () => {
    const state = makeState({ seed: 63 });
    const p = state.actor.player;
    state.chunk.depth = 10;
    p.maxDepth = 10;
    const msgs: string[] = [];
    registry().effectSimple(EF.DEEP_DESCENT, env(state, {}, msgs), {
      origin: sourcePlayer(),
    });
    expect(p.deepDescent).toBeGreaterThan(0);
    expect(msgs).toContain("The air around you starts to swirl...");

    /* Count it down: stair_skip 1 makes the increment 5. */
    p.deepDescent = 1;
    processWorld(state);
    expect(state.targetDepth).toBe(15);
    expect(state.generateLevel).toBe(true);

    /* At the dungeon bottom nothing deeper exists. */
    const bottom = makeState({ seed: 63 });
    bottom.chunk.depth = 127;
    bottom.actor.player.maxDepth = 127;
    const msgs2: string[] = [];
    registry().effectSimple(EF.DEEP_DESCENT, env(bottom, {}, msgs2), {
      origin: sourcePlayer(),
    });
    expect(bottom.actor.player.deepDescent).toBe(0);
    expect(
      msgs2.some((m) => m.includes("malevolent presence")),
    ).toBe(true);
  });

  it("MON_TIMED_INC extends a condition on the casting monster", () => {
    const state = makeState({ seed: 58 });
    const mon = addMon(state, makeRace(), loc(10, 10), { hp: 30 });
    registry().effectSimple(EF.MON_TIMED_INC, env(state), {
      origin: sourceMonster(mon.midx),
      subtype: MON_TMD.FAST,
      diceString: "10",
    });
    expect(mon.mTimed[MON_TMD.FAST]!).toBeGreaterThan(0);
  });
});
