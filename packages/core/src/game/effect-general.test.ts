import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EF, MFLAG, MON_TMD, MSG, OF, RF, TMD, TV } from "../generated/index.js";
import { loc, locEq } from "../loc.js";
import {
  EffectRegistry,
  sourceMonster,
  sourcePlayer,
} from "../effects/interpreter.js";
import type { EffectContext } from "../effects/interpreter.js";
import { registerCoreHandlers } from "../effects/handlers.js";
import { GLYPH_DECOY, GLYPH_WARDING } from "../effects/effect.js";
import { bindTraps } from "../world/trap.js";
import type { TrapRecordJson } from "../world/trap.js";
import { OBJ_PROPERTY } from "../obj/types.js";
import type { ObjectKind, ObjectProperty } from "../obj/types.js";
import { objectNew } from "../obj/object.js";
import type { GameObject } from "../obj/object.js";
import { makeRuneEnv } from "../obj/knowledge.js";
import { addMon, makeRace, makeState, monReg } from "./harness.js";
import type { GameState } from "./context.js";
import { basicPlayerActor } from "./project-cast.js";
import { attachGameEnv } from "./effect-game-env.js";
import type { GameEffectEnv } from "./effect-game-env.js";
import { squareIsWarded, squareIsWebbed } from "./trap.js";
import type { TrapDeps } from "./trap.js";
import {
  disenchantEquipment,
  playerGetRecallDepth,
  registerGeneralHandlers,
} from "./effect-general.js";
import { processWorld } from "./loop.js";
import { OptionState } from "../player/options.js";
import type { StoredLevel } from "./context.js";

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

    const msgs: string[] = [];
    r.effectSimple(EF.DRAIN_MANA, env(state, {}, msgs), {
      origin: sourceMonster(mon.midx),
      diceString: "4",
    });
    expect(p.csp).toBe(10); /* untouched */
    expect(state.decoy).toBeNull();
    /*
     * PORT_TODO 7.2. square_destroy_decoy always announces (cave-square.c:
     * 1409-1411) and destroyDecoy does too - but this handler open-coded the
     * function's body MINUS the message, so a decoy soaking a mana drain in
     * full view died in silence while the TIMED_INC path below, which calls
     * the shared function, announced. The two now agree.
     */
    expect(msgs).toContain("The decoy is destroyed!");
  });

  it("EF_TIMED_INC from a monster destroys the player's decoy (5.2)", () => {
    const state = makeState({ playerGrid: loc(5, 5), seed: 61 });
    const r = registry();
    r.effectSimple(EF.GLYPH, env(state), {
      origin: sourcePlayer(),
      subtype: GLYPH_DECOY,
    });
    expect(state.decoy).toBeTruthy();
    const race = monReg.races.find((rr) => rr.rarity > 0)!;
    const mon = addMon(state, race, loc(3, 3), { hp: 50 });

    r.effectSimple(EF.TIMED_INC, env(state, { monCurrent: mon.midx }), {
      origin: sourceMonster(mon.midx),
      subtype: TMD.CONFUSED,
      diceString: "10",
    });
    expect(state.decoy).toBeNull();
    /* The player is not confused: the decoy soaked it. */
    expect(state.actor.player.timed[TMD.CONFUSED]!).toBe(0);
  });

  it("EF_TIMED_INC maps a monster-vs-monster effect to MON_TMD (5.2)", () => {
    const state = makeState({ playerGrid: loc(20, 20), seed: 62 });
    const race = monReg.races.find((rr) => rr.rarity > 0)!;
    const caster = addMon(state, race, loc(5, 5), { hp: 50 });
    const victim = addMon(state, race, loc(6, 6), { hp: 50 });
    caster.target.midx = victim.midx;

    registry().effectSimple(
      EF.TIMED_INC,
      env(state, { monCurrent: caster.midx }),
      {
        origin: sourceMonster(caster.midx),
        subtype: TMD.CONFUSED,
        diceString: "10",
      },
    );
    /* TMD_CONFUSED -> MON_TMD_CONF on the target monster; the player is spared. */
    expect(victim.mTimed[MON_TMD.CONF]!).toBeGreaterThan(0);
    expect(state.actor.player.timed[TMD.CONFUSED]!).toBe(0);
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
    /* on_new_level (game-world.c:1023-1024) sets max_depth AND recall_depth
     * together, so a character who has been to 12 has both. Setting only
     * max_depth is a state play cannot produce, and the countdown reads
     * recall_depth - it does not re-derive it from max_depth. */
    p.maxDepth = 12;
    p.recallDepth = 12;
    p.wordRecall = 1;
    processWorld(state);
    expect(state.targetDepth).toBe(12);
    expect(state.generateLevel).toBe(true);
  });

  it("in town, recall honours a persistent-levels player's CHOSEN depth", () => {
    /* The concrete failure the player_set_recall_depth port fixes: the town
     * prompt asked which frozen level to return to, and the countdown then
     * overwrote the answer with max_depth. */
    const state = makeState({ seed: 62 });
    const p = state.actor.player;
    state.chunk.depth = 0;
    p.maxDepth = 12;
    p.recallDepth = 12;
    state.levelCache = new Map([[5, {} as StoredLevel]]);
    state.options = new OptionState({
      overrides: { birth_levels_persist: true },
    });
    registry().effectSimple(
      EF.RECALL,
      env(state, { general: { trapDeps, chooseDepth: () => 5 } }, []),
      { origin: sourcePlayer() },
    );
    expect(p.recallDepth).toBe(5);

    p.wordRecall = 1;
    processWorld(state);
    expect(state.targetDepth).toBe(5);
  });

  it("in town, a character who never descended is yanked to 1, not the town", () => {
    /* MAX(recall_depth, 1) (player-util.c:92). Word of Recall bought and read
     * before the first descent has to go somewhere; upstream sends it to level
     * 1. targetDepth 0 would have regenerated the town under the player. */
    const state = makeState({ seed: 62 });
    const p = state.actor.player;
    state.chunk.depth = 0;
    p.maxDepth = 0;
    p.recallDepth = 0;
    p.wordRecall = 1;
    processWorld(state);
    expect(state.targetDepth).toBe(1);
    expect(state.generateLevel).toBe(true);
  });

  it("in town under force_descend, recall lands one level BELOW max_depth", () => {
    const state = makeState({ seed: 62 });
    const p = state.actor.player;
    state.chunk.depth = 0;
    p.maxDepth = 12;
    p.recallDepth = 12;
    state.options = new OptionState({
      overrides: { birth_force_descend: true },
    });
    p.wordRecall = 1;
    processWorld(state);
    expect(state.targetDepth).toBe(13);
  });

  it("RECALL does nothing at all under birth_no_recall, until the game is won", () => {
    /* effect-handler-general.c L1098-1102. The option ("Word of Recall has no
     * effect", #34) was in the table and read by nothing, so the scroll worked
     * exactly as normal for a player who had chosen to give it up. */
    const state = makeState({ seed: 62 });
    const p = state.actor.player;
    state.chunk.depth = 7;
    p.maxDepth = 7;
    p.recallDepth = 7;
    state.options = new OptionState({
      overrides: { birth_no_recall: true },
    });
    const r = registry();
    const msgs: string[] = [];
    r.effectSimple(EF.RECALL, env(state, {}, msgs), { origin: sourcePlayer() });
    expect(p.wordRecall).toBe(0);
    expect(msgs).toContain("Nothing happens.");
    expect(msgs).not.toContain("The air about you becomes charged...");

    /* !player->total_winner: a winner gets the scroll back, which is how they
     * return to town to retire. */
    p.totalWinner = true;
    const msgs2: string[] = [];
    r.effectSimple(EF.RECALL, env(state, {}, msgs2), { origin: sourcePlayer() });
    expect(p.wordRecall).toBeGreaterThanOrEqual(15);
    expect(msgs2).toContain("The air about you becomes charged...");
  });

  describe("player_get_recall_depth (player-util.c L100)", () => {
    it("no prompt when max_depth <= 0: returns true, recall_depth untouched", () => {
      const state = makeState({ seed: 64 });
      const p = state.actor.player;
      p.maxDepth = 0;
      p.recallDepth = 99;
      const chooseDepth = (): number => {
        throw new Error("must not be called");
      };
      expect(playerGetRecallDepth(state, chooseDepth)).toBe(true);
      expect(p.recallDepth).toBe(99);
    });

    it("no prompt under birth_force_descend, regardless of max_depth", () => {
      const state = makeState({ seed: 65 });
      const p = state.actor.player;
      p.maxDepth = 10;
      p.recallDepth = 3;
      state.options = new OptionState({
        overrides: { birth_force_descend: true },
      });
      const chooseDepth = (): number => {
        throw new Error("must not be called");
      };
      expect(playerGetRecallDepth(state, chooseDepth)).toBe(true);
      expect(p.recallDepth).toBe(3);
    });

    it("0 cancels the whole scroll (returns false)", () => {
      const state = makeState({ seed: 66 });
      const p = state.actor.player;
      p.maxDepth = 10;
      state.levelCache = new Map([[7, {} as StoredLevel]]);
      expect(playerGetRecallDepth(state, () => 0)).toBe(false);
    });

    it("re-prompts on a depth with no chunk_list entry, then accepts a valid one", () => {
      const state = makeState({ seed: 67 });
      const p = state.actor.player;
      p.maxDepth = 10;
      state.levelCache = new Map([[7, {} as StoredLevel]]);
      const asked: number[] = [];
      let calls = 0;
      const chooseDepth = (_prompt: string, max: number): number => {
        asked.push(max);
        calls += 1;
        return calls === 1 ? 4 : 7; // 4 has no cache entry, 7 does
      };
      const said: string[] = [];
      expect(
        playerGetRecallDepth(state, chooseDepth, (t) => said.push(t)),
      ).toBe(true);
      expect(p.recallDepth).toBe(7);
      expect(asked).toEqual([10, 10]);
      expect(said).toContain(
        "You must choose a level you have previously visited.",
      );
    });

    it("max_depth === 1 never prompts (get_quantity's own clamp, ui-input.c:1211)", () => {
      const state = makeState({ seed: 68 });
      const p = state.actor.player;
      p.maxDepth = 1;
      state.levelCache = new Map([[1, {} as StoredLevel]]);
      const chooseDepth = (): number => {
        throw new Error("must not be called");
      };
      expect(playerGetRecallDepth(state, chooseDepth)).toBe(true);
      expect(p.recallDepth).toBe(1);
    });
  });

  it("in town with birth_levels_persist, RECALL prompts for the persistent depth", () => {
    const state = makeState({ seed: 69 });
    const p = state.actor.player;
    state.chunk.depth = 0;
    p.maxDepth = 12;
    state.levelCache = new Map([[5, {} as StoredLevel]]);
    state.options = new OptionState({
      overrides: { birth_levels_persist: true },
    });
    const r = registry();
    const msgs: string[] = [];
    r.effectSimple(
      EF.RECALL,
      env(state, { general: { trapDeps, chooseDepth: () => 5 } }, msgs),
      { origin: sourcePlayer() },
    );
    expect(p.recallDepth).toBe(5);
    expect(p.wordRecall).toBeGreaterThanOrEqual(15);
    expect(msgs).toContain("The air about you becomes charged...");
  });

  it("in town with birth_levels_persist, cancelling the depth choice aborts (no charge)", () => {
    const state = makeState({ seed: 70 });
    const p = state.actor.player;
    state.chunk.depth = 0;
    p.maxDepth = 12;
    state.levelCache = new Map([[5, {} as StoredLevel]]);
    state.options = new OptionState({
      overrides: { birth_levels_persist: true },
    });
    const r = registry();
    const msgs: string[] = [];
    const result = r.effectSimple(
      EF.RECALL,
      env(state, { general: { trapDeps, chooseDepth: () => 0 } }, msgs),
      { origin: sourcePlayer() },
    );
    expect(result).toBe(false);
    expect(p.wordRecall).toBe(0);
    expect(msgs).not.toContain("The air about you becomes charged...");
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

/*
 * PORT_TODO 3.26. Every one of these is msgt(MSG_TPLEVEL, ...) upstream -
 * message AND sound - and the port had only the message. The existing tests
 * above reach the same lines and assert only the text, which is exactly how
 * the missing half stayed invisible.
 */
describe("the level-change messages carry MSG_TPLEVEL (PORT_TODO 3.26)", () => {
  function typedSink(state: GameState): {
    heard: number[];
    said: [string, unknown][];
  } {
    const heard: number[] = [];
    const said: [string, unknown][] = [];
    state.sound = (t: number): void => void heard.push(t);
    state.msg = (t: string, type?: unknown): void => void said.push([t, type]);
    return { heard, said };
  }

  it("DEEP_DESCENT types and sounds both of its arms", () => {
    const state = makeState({ seed: 63 });
    state.chunk.depth = 10;
    state.actor.player.maxDepth = 10;
    const heard: number[] = [];
    state.sound = (t: number): void => void heard.push(t);
    const typed: (string | undefined)[] = [];
    const base: EffectContext = {
      rng: state.rng,
      messages: { msg: (_t, msgt) => void typed.push(msgt) },
    };
    registry().effectSimple(
      EF.DEEP_DESCENT,
      attachGameEnv(base, {
        state,
        cast: { projections: [], maxRange: 20, playerActor: basicPlayerActor(state) },
      }),
      { origin: sourcePlayer() },
    );
    expect(typed).toEqual(["TPLEVEL"]);
    expect(heard).toEqual([MSG.TPLEVEL]);

    /* The blocked arm at the dungeon bottom is msgt too (:1178). */
    const bottom = makeState({ seed: 63 });
    bottom.chunk.depth = 127;
    bottom.actor.player.maxDepth = 127;
    const heard2: number[] = [];
    bottom.sound = (t: number): void => void heard2.push(t);
    const typed2: (string | undefined)[] = [];
    registry().effectSimple(
      EF.DEEP_DESCENT,
      attachGameEnv(
        { rng: bottom.rng, messages: { msg: (_t, m) => void typed2.push(m) } },
        {
          state: bottom,
          cast: {
            projections: [],
            maxRange: 20,
            playerActor: basicPlayerActor(bottom),
          },
        },
      ),
      { origin: sourcePlayer() },
    );
    expect(typed2).toEqual(["TPLEVEL"]);
    expect(heard2).toEqual([MSG.TPLEVEL]);
  });

  it("the word-of-recall yank types and sounds, upwards and downwards", () => {
    const up = makeState({ seed: 61 });
    up.chunk.depth = 7;
    up.actor.player.wordRecall = 1;
    const u = typedSink(up);
    processWorld(up);
    expect(u.said).toContainEqual(["You feel yourself yanked upwards!", "TPLEVEL"]);
    expect(u.heard).toContain(MSG.TPLEVEL);

    const down = makeState({ seed: 61 });
    down.chunk.depth = 0; /* in town: recall pulls you back under */
    down.actor.player.maxDepth = 9;
    down.actor.player.wordRecall = 1;
    const d = typedSink(down);
    processWorld(down);
    expect(d.said).toContainEqual([
      "You feel yourself yanked downwards!",
      "TPLEVEL",
    ]);
    expect(d.heard).toContain(MSG.TPLEVEL);
  });

  it("the delayed deep descent types and sounds, arriving or thrown back", () => {
    const drop = makeState({ seed: 63 });
    drop.chunk.depth = 10;
    drop.actor.player.maxDepth = 10;
    drop.actor.player.deepDescent = 1;
    const a = typedSink(drop);
    processWorld(drop);
    expect(a.said).toContainEqual(["The floor opens beneath you!", "TPLEVEL"]);
    expect(a.heard).toContain(MSG.TPLEVEL);

    const stuck = makeState({ seed: 63 });
    stuck.chunk.depth = 127;
    stuck.actor.player.maxDepth = 127;
    stuck.actor.player.deepDescent = 1;
    const b = typedSink(stuck);
    processWorld(stuck);
    expect(b.said).toContainEqual([
      "You are thrown back in an explosion!",
      "TPLEVEL",
    ]);
    expect(b.heard).toContain(MSG.TPLEVEL);
  });
});
