import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants.js";
import { EF, OF, TMD, TV } from "../generated/index.js";
import { loc } from "../loc.js";
import { Rng } from "../rng.js";
import { ENCH_TOAC, ENCH_TOBOTH, ENCH_TOHIT } from "../effects/effect.js";
import {
  EffectRegistry,
  sourceMonster,
  sourcePlayer,
} from "../effects/interpreter.js";
import type { EffectContext, EffectPlayer } from "../effects/interpreter.js";
import { registerCoreHandlers } from "../effects/handlers.js";
import { ObjRegistry } from "../obj/bind.js";
import type { ObjPackJson } from "../obj/types.js";
import { ArtifactState, ObjAllocState, objectPrep } from "../obj/make.js";
import type { MakeDeps } from "../obj/make.js";
import { appendObjectCurse } from "../obj/object.js";
import type { GameObject } from "../obj/object.js";
import { makeRuneEnv } from "../obj/knowledge.js";
import { OBJ_NOTICE } from "../obj/knowledge.js";
import { requestForEffect } from "./effect-item.js";
import { makeState } from "./harness.js";
import type { GameState } from "./context.js";
import { basicPlayerActor } from "./project-cast.js";
import { attachGameEnv } from "./effect-game-env.js";
import type { GameEffectEnv } from "./effect-game-env.js";
import { gearAdd } from "./gear.js";
import type { Gear } from "./gear.js";
import { floorPile } from "./floor.js";
import {
  enchant,
  rechargeFailureChance,
  registerItemHandlers,
  removeCurseDiceString,
} from "./effect-item.js";
import { Dice } from "../dice.js";
import { effectNew } from "../effects/effect.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as T;
}

const objPack: ObjPackJson = {
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
} as ObjPackJson;

const objReg = new ObjRegistry(objPack);
const constants = bindConstants(loadJson("constants"));
const makeDeps: MakeDeps = {
  reg: objReg,
  alloc: new ObjAllocState(objReg, constants),
  constants,
  artifacts: new ArtifactState(objReg.artifacts.length),
  noArtifacts: false,
};

function registry(): EffectRegistry {
  const r = new EffectRegistry();
  registerCoreHandlers(r);
  registerItemHandlers(r);
  return r;
}

/** A minimal player env backing the timed / damage sinks. */
function playerEnv(state: GameState): EffectPlayer {
  const p = state.actor.player;
  return {
    timed: {
      timed: (i) => p.timed[i] ?? 0,
      setTimed: (i, v) => {
        p.timed[i] = v;
        return true;
      },
      incTimed: (i, v) => {
        p.timed[i] = (p.timed[i] ?? 0) + v;
        return true;
      },
      decTimed: (i, v) => {
        p.timed[i] = Math.max(0, (p.timed[i] ?? 0) - v);
        return true;
      },
      clearTimed: (i) => {
        p.timed[i] = 0;
        return true;
      },
    },
    applyDamageReduction: (dam) => dam,
    takeHit: (dam) => {
      p.chp -= dam;
    },
  };
}

function env(
  state: GameState,
  pick: GameObject | null,
  msgs?: string[],
  game: Partial<GameEffectEnv> = {},
): EffectContext {
  const base: EffectContext = {
    rng: state.rng,
    player: playerEnv(state),
    ...(msgs ? { messages: { msg: (t: string) => msgs.push(t) } } : {}),
  };
  return attachGameEnv(base, {
    state,
    cast: {
      projections: [],
      maxRange: 20,
      playerActor: basicPlayerActor(state),
    },
    item: { getItem: () => pick, reg: objReg, makeDeps },
    ...game,
  });
}

/** A fresh plain object of the first ordinary kind of a tval. */
/** Carry an object properly: in the store AND the pack list. */
function carry(gear: Gear, obj: GameObject): number {
  const handle = gearAdd(gear, obj);
  gear.pack.push(handle);
  return handle;
}

function makeObj(tval: number, nth = 0): GameObject {
  const kinds = objReg.kinds.filter(
    (k) => k.tval === tval && k.kidx < objReg.ordinaryKindCount,
  );
  const kind = kinds[nth];
  if (!kind) throw new Error(`no ordinary kind #${nth} for tval ${tval}`);
  return objectPrep(new Rng(9), objReg, constants, kind, 0, "average");
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

describe("enchant (effect-handler-general.c L319)", () => {
  it("raises a +0 score reliably and refreshes bonuses", () => {
    const state = makeState({ seed: 5 });
    const sword = makeObj(TV.SWORD);
    let refreshes = 0;
    state.updateBonuses = (): void => {
      refreshes++;
    };
    expect(enchant(state, sword, 1, ENCH_TOHIT)).toBe(true);
    expect(sword.toH).toBe(1);
    expect(refreshes).toBe(1);
  });

  it("cannot push a score past +15", () => {
    const state = makeState({ seed: 5 });
    const sword = makeObj(TV.SWORD);
    sword.toH = 15;
    /* enchant_table[15] = 1000: randint1(1000) <= 1000 always fails. */
    expect(enchant(state, sword, 20, ENCH_TOHIT)).toBe(false);
    expect(sword.toH).toBe(15);
  });
});

describe("EF_ENCHANT (effect-handler-general.c L2095)", () => {
  it("enchants a chosen carried weapon with the glow message", () => {
    const state = makeState({ seed: 5 });
    const sword = makeObj(TV.SWORD);
    carry(state.gear, sword);
    const msgs: string[] = [];
    const used = registry().effectSimple(
      EF.ENCHANT,
      env(state, sword, msgs),
      { origin: sourcePlayer(), subtype: ENCH_TOBOTH, diceString: "1" },
    );
    expect(used).toBe(true);
    expect(msgs.some((m) => m.startsWith("Your ") && m.includes("glow"))).toBe(
      true,
    );
    expect(sword.toH + sword.toD).toBeGreaterThan(0);
  });

  it("armour enchantment raises to-ac", () => {
    const state = makeState({ seed: 5 });
    const armor = makeObj(TV.SOFT_ARMOR);
    const used = registry().effectSimple(EF.ENCHANT, env(state, armor), {
      origin: sourcePlayer(),
      subtype: ENCH_TOAC,
      diceString: "1",
    });
    expect(used).toBe(true);
    expect(armor.toA).toBeGreaterThan(0);
  });

  it("a cancelled pick leaves the effect unused", () => {
    const state = makeState({ seed: 5 });
    const used = registry().effectSimple(EF.ENCHANT, env(state, null), {
      origin: sourcePlayer(),
      subtype: ENCH_TOHIT,
      diceString: "1",
    });
    expect(used).toBe(false);
  });
});

describe("EF_RECHARGE (effect-handler-general.c L2127)", () => {
  it("recharges a drained wand", () => {
    const state = makeState({ seed: 5 });
    const wand = makeObj(TV.WAND);
    wand.pval = 0;
    registry().effectSimple(EF.RECHARGE, env(state, wand), {
      origin: sourcePlayer(),
      diceString: "60",
    });
    expect(wand.pval).toBeGreaterThan(0);
  });

  it("a weak recharge of a full wand backfires and destroys it", () => {
    const state = makeState({ seed: 5 });
    const wand = makeObj(TV.WAND);
    wand.pval = 40;
    const handle = carry(state.gear, wand);
    const msgs: string[] = [];
    const used = registry().effectSimple(EF.RECHARGE, env(state, wand, msgs), {
      origin: sourcePlayer(),
      diceString: "0",
    });
    expect(used).toBe(true);
    expect(msgs).toContain("The recharge backfires!");
    expect(state.gear.store.get(handle)).toBeUndefined();
  });

  it("high charges raise the failure chance", () => {
    const wand = makeObj(TV.WAND);
    wand.pval = 0;
    const fresh = rechargeFailureChance(wand, 30);
    wand.pval = 20;
    const full = rechargeFailureChance(wand, 30);
    expect(full).toBeLessThan(fresh);
  });
});

describe("EF_REMOVE_CURSE (effect-handler-general.c L1051)", () => {
  /**
   * A sword with one appendable curse the player has LEARNED; returns
   * [state, sword, pick].
   *
   * The learning is not decoration. item_tester_uncursable reads
   * obj->known->curses (effect-handler-general.c:162-165) and the picker adds
   * player_knows_curse (ui-curse.c:105-107), so Remove Curse cannot be aimed
   * at a curse the player has never seen. An un-learned fixture would exercise
   * only the refusal.
   */
  function cursedSword(seed: number): [GameState, GameObject, number] {
    const state = makeState({ seed });
    const sword = makeObj(TV.SWORD);
    const pick = objReg.curses.findIndex((c) => c && c.poss[TV.SWORD]);
    expect(pick).toBeGreaterThan(0);
    expect(appendObjectCurse(state.rng, sword, pick, 30, objReg.curses)).toBe(
      true,
    );
    /* Two conditions, both upstream's: the object must be ASSESSED (handled -
     * obj-knowledge.c:1033-1035 returns base properties only before that) AND
     * the curse rune must be learned (:1131-1153 gates each entry on
     * p->obj_k->curses[i], which is player_knows_curse). */
    sword.notice |= OBJ_NOTICE.ASSESSED;
    state.actor.player.objKnown.curses[pick] = 1;
    /* And the rune env has to KNOW about curses: objectKnownShadow walks
     * env.curses to build the twin's list, and the harness default is [null] -
     * length 1 - so the loop never runs and the twin reports no curse whatever
     * the player has learned. Back it with the real table. */
    state.runeEnv = makeRuneEnv(
      () => null,
      (v) => state.rng.randcalcVaries(v),
      { curses: objReg.curses },
    );
    return [state, sword, pick];
  }

  it("the item TESTER gates on the known twin (effect-handler-general.c:162)", () => {
    /* The env's getItem stub hands the object over without consulting the
     * tester, so the refusal test below exercises only the picker. This asks
     * requestForEffect's predicate directly - the one the real item prompt
     * uses to decide what may even be offered. */
    const [state, sword, pick] = cursedSword(5);
    const tester = requestForEffect(EF.REMOVE_CURSE, 0, state)!.tester!;
    expect(tester(sword), "a learned curse is offerable").toBe(true);

    state.actor.player.objKnown.curses[pick] = 0;
    expect(tester(sword), "an unlearned one is not").toBe(false);
    /* Ground truth: the curse is still on the object either way, so the false
     * above is the KNOWLEDGE gate and not a vanished curse. */
    expect(sword.curses![pick]!.power).toBeGreaterThan(0);
  });

  it("refuses a curse the player has NOT learned (ui-curse.c:105-107)", () => {
    /* The same sword with the knowledge withheld: upstream neither offers it
     * nor lets the acceptance reveal that the item is cursed. */
    const [state, sword, pick] = cursedSword(5);
    state.actor.player.objKnown.curses[pick] = 0;
    const msgs: string[] = [];

    const used = registry().effectSimple(
      EF.REMOVE_CURSE,
      env(state, sword, msgs),
      { origin: sourcePlayer(), diceString: "50" },
    );

    expect(used).toBe(false);
    /* Ground truth: the curse is still there, so this is a refusal and not a
     * fixture that never had one. */
    expect(sword.curses).not.toBeNull();
    expect(sword.curses![pick]!.power).toBeGreaterThan(0);
  });

  it("removes a curse the spell is strong enough for", () => {
    const [state, sword, pick] = cursedSword(5);
    const msgs: string[] = [];
    const used = registry().effectSimple(
      EF.REMOVE_CURSE,
      env(state, sword, msgs),
      { origin: sourcePlayer(), diceString: "50" },
    );
    expect(used).toBe(true);
    expect(sword.curses).toBeNull();
    /* Success names the curse it removed: uncurse_object's SECOND
       remove_object_curse call passes message = true
       (effect-handler-general.c:195 -> obj-curse.c:231). */
    void pick;
    expect(msgs).toEqual(["The air swing curse is removed!"]);
  });

  it("a weak attempt makes the item fragile", () => {
    const [state, sword] = cursedSword(5);
    const msgs: string[] = [];
    registry().effectSimple(EF.REMOVE_CURSE, env(state, sword, msgs), {
      origin: sourcePlayer(),
      diceString: "10",
    });
    expect(sword.curses).not.toBeNull();
    expect(sword.flags.has(OF.FRAGILE)).toBe(true);
    expect(msgs.some((m) => m.includes("is now fragile"))).toBe(true);
  });

  it("a fragile item can be destroyed by a failed attempt (seed sweep)", () => {
    let destroyed = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const [state, sword] = cursedSword(seed);
      sword.flags.on(OF.FRAGILE);
      const handle = carry(state.gear, sword);
      registry().effectSimple(EF.REMOVE_CURSE, env(state, sword), {
        origin: sourcePlayer(),
        diceString: "10",
      });
      if (!state.gear.store.get(handle)) {
        destroyed++;
        expect(state.actor.player.chp).toBeLessThan(state.actor.player.mhp);
      }
    }
    expect(destroyed).toBeGreaterThan(0);
  });
});

describe("removeCurseDiceString (effect-handler-general.c L1071-1085)", () => {
  /** A REMOVE_CURSE effect node carrying the given un-rolled dice spec. */
  function chainWith(diceString: string): ReturnType<typeof effectNew> {
    const effect = effectNew(EF.REMOVE_CURSE);
    const dice = new Dice();
    dice.parseString(diceString);
    effect.dice = dice;
    return effect;
  }

  it("formats base+d(sides) for a single die with a base", () => {
    expect(removeCurseDiceString(chainWith("2+d10"))).toBe("2+d10");
  });

  it("formats base+dice*d(sides) for multiple dice with a base", () => {
    expect(removeCurseDiceString(chainWith("2+3d10"))).toBe("2+3d10");
  });

  it("formats d(sides) for a single die with no base", () => {
    expect(removeCurseDiceString(chainWith("d10"))).toBe("d10");
  });

  it("formats dice*d(sides) for multiple dice with no base", () => {
    expect(removeCurseDiceString(chainWith("3d10"))).toBe("3d10");
  });

  it("formats a bare base with no dice", () => {
    expect(removeCurseDiceString(chainWith("50"))).toBe("50");
  });

  it("walks the chain to find the REMOVE_CURSE node, skipping others", () => {
    const first = effectNew(EF.CLEAR_VALUE);
    first.next = chainWith("2+3d10");
    expect(removeCurseDiceString(first)).toBe("2+3d10");
  });

  it("returns null for a chain with no REMOVE_CURSE effect", () => {
    expect(removeCurseDiceString(effectNew(EF.CLEAR_VALUE))).toBeNull();
    expect(removeCurseDiceString(null)).toBeNull();
  });

  it("draws no RNG (pure read of the dice spec, not a roll - takes no Rng at all)", () => {
    // removeCurseDiceString's signature has no rng parameter; this is a static
    // proof it cannot draw, backed by the repeatable-result check below.
    const effect = chainWith("2+3d10");
    expect(removeCurseDiceString(effect)).toBe("2+3d10");
    expect(removeCurseDiceString(effect)).toBe("2+3d10"); // stable across repeated calls
  });
});

describe("EF_BRAND_WEAPON / AMMO / BOLTS (effect-handler-general.c L3233)", () => {
  it("brands the wielded weapon into a Flame or Frost ego", () => {
    const state = makeState({ seed: 5 });
    const eq = equipArray(state);
    const sword = makeObj(TV.SWORD);
    eq[slotOf(state, "WEAPON")] = sword;
    const msgs: string[] = [];
    registry().effectSimple(EF.BRAND_WEAPON, env(state, null, msgs), {
      origin: sourcePlayer(),
    });
    expect(sword.ego).not.toBeNull();
    expect(["of Flame", "of Frost"]).toContain(sword.ego?.name);
    expect(msgs.some((m) => m.includes("surrounded with an aura of"))).toBe(
      true,
    );
    /* brand_object finishes with a 4-6 round hit/dam enchant. */
    expect(sword.toH + sword.toD).toBeGreaterThan(0);
  });

  it("brands chosen ammo but never an ego item twice", () => {
    const state = makeState({ seed: 5 });
    const arrows = makeObj(TV.ARROW);
    registry().effectSimple(EF.BRAND_AMMO, env(state, arrows), {
      origin: sourcePlayer(),
    });
    expect(arrows.ego).not.toBeNull();

    /* A second branding fails: the item is already an ego. */
    const msgs: string[] = [];
    registry().effectSimple(EF.BRAND_AMMO, env(state, arrows, msgs), {
      origin: sourcePlayer(),
    });
    expect(msgs).toContain("The branding failed.");
  });

  it("BRAND_BOLTS flames a chosen stack of bolts", () => {
    const state = makeState({ seed: 5 });
    const bolts = makeObj(TV.BOLT);
    registry().effectSimple(EF.BRAND_BOLTS, env(state, bolts), {
      origin: sourcePlayer(),
    });
    expect(bolts.ego?.name).toBe("of Flame");
  });
});

describe("EF_CURSE_ARMOR / EF_CURSE_WEAPON (effect-handler-general.c L3103)", () => {
  it("blasts the worn body armour with curses", () => {
    const state = makeState({ seed: 5 });
    const eq = equipArray(state);
    const armor = makeObj(TV.SOFT_ARMOR);
    armor.toA = 5;
    eq[slotOf(state, "BODY_ARMOR")] = armor;
    const msgs: string[] = [];
    registry().effectSimple(EF.CURSE_ARMOR, env(state, null, msgs), {
      origin: sourceMonster(1),
    });
    expect(msgs.some((m) => m.includes("terrible black aura blasts"))).toBe(
      true,
    );
    expect(armor.toA).toBeLessThan(5);
  });

  it("curses the wielded weapon, ruining its bonuses", () => {
    const state = makeState({ seed: 5 });
    const eq = equipArray(state);
    const sword = makeObj(TV.SWORD);
    sword.toH = 5;
    sword.toD = 5;
    eq[slotOf(state, "WEAPON")] = sword;
    registry().effectSimple(EF.CURSE_WEAPON, env(state, null), {
      origin: sourceMonster(1),
    });
    expect(sword.toH).toBeLessThan(0);
    expect(sword.toD).toBeLessThan(0);
  });

  it("does nothing with no armour worn", () => {
    const state = makeState({ seed: 5 });
    equipArray(state);
    const msgs: string[] = [];
    const ran = registry().effectSimple(EF.CURSE_ARMOR, env(state, null, msgs), {
      origin: sourceMonster(1),
    });
    expect(ran).toBe(true);
    expect(msgs).toHaveLength(0);
  });
});

describe("EF_CREATE_ARROWS (effect-handler-general.c L3315)", () => {
  it("turns a carried staff into arrows on the floor", () => {
    const state = makeState({ playerGrid: loc(10, 10), seed: 5 });
    /* Arrows only generate from creation level ~5 up (alloc minima). */
    state.actor.player.lev = 10;
    const staff = makeObj(TV.STAFF);
    const handle = carry(state.gear, staff);
    const used = registry().effectSimple(EF.CREATE_ARROWS, env(state, staff), {
      origin: sourcePlayer(),
    });
    expect(used).toBe(true);
    /* The staff is consumed... */
    expect(state.gear.store.get(handle)).toBeUndefined();
    /* ...and arrows land near the player. */
    let arrows = 0;
    for (let y = 8; y <= 12; y++) {
      for (let x = 8; x <= 12; x++) {
        for (const o of floorPile(state, loc(x, y))) {
          if (o.tval === TV.ARROW) arrows += o.number;
        }
      }
    }
    expect(arrows).toBeGreaterThan(0);
  });
});

describe("EF_ACQUIRE (obj-make.c L1240)", () => {
  it("conjures great objects onto the floor near the player", () => {
    const state = makeState({ playerGrid: loc(10, 10), seed: 5 });
    state.chunk.depth = 20;
    const used = registry().effectSimple(EF.ACQUIRE, env(state, null), {
      origin: sourcePlayer(),
      diceString: "3",
    });
    expect(used).toBe(true);
    let dropped = 0;
    for (let y = 7; y <= 13; y++) {
      for (let x = 7; x <= 13; x++) {
        dropped += floorPile(state, loc(x, y)).length;
      }
    }
    expect(dropped).toBeGreaterThan(0);
  });
});

describe("EF_TAP_DEVICE (effect-handler-general.c L3370)", () => {
  it("drains a charged staff into mana, stunning slightly", () => {
    const state = makeState({ seed: 5 });
    const p = state.actor.player;
    p.msp = 50;
    p.csp = 0;
    const staff = makeObj(TV.STAFF);
    staff.pval = 10;
    const msgs: string[] = [];
    const used = registry().effectSimple(EF.TAP_DEVICE, env(state, staff, msgs), {
      origin: sourcePlayer(),
    });
    expect(used).toBe(true);
    expect(staff.pval).toBe(0);
    expect(p.csp).toBeGreaterThan(0);
    expect(msgs).toContain("You feel your head clear.");
    expect(p.timed[TMD.STUN]).toBeGreaterThanOrEqual(1);
  });

  it("refuses a device with too little energy", () => {
    const state = makeState({ seed: 5 });
    state.actor.player.msp = 50;
    state.actor.player.csp = 0;
    const staff = makeObj(TV.STAFF);
    staff.pval = 0;
    const msgs: string[] = [];
    const used = registry().effectSimple(EF.TAP_DEVICE, env(state, staff, msgs), {
      origin: sourcePlayer(),
    });
    expect(used).toBe(false);
    expect(msgs).toContain("That staff had no useable energy");
  });

  it("does not drain when mana is already full", () => {
    const state = makeState({ seed: 5 });
    const p = state.actor.player;
    p.msp = 50;
    p.csp = 50;
    const staff = makeObj(TV.STAFF);
    staff.pval = 10;
    const msgs: string[] = [];
    const used = registry().effectSimple(EF.TAP_DEVICE, env(state, staff, msgs), {
      origin: sourcePlayer(),
    });
    expect(used).toBe(false);
    expect(staff.pval).toBe(10);
    expect(
      msgs.some((m) => m.includes("mana was already at its maximum")),
    ).toBe(true);
  });
});
