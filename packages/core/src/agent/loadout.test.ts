/**
 * simulateLoadout: what the character would be, wearing something else.
 *
 * HOW THIS FILE ESTABLISHES GROUND TRUTH, and it is the whole point of it. A
 * test that wrote down "this sword should give +2 to-dam" would be asserting an
 * arithmetic the test author performed, and the failure it is meant to catch -
 * a simulated derive that has drifted from the real one - is exactly the failure
 * a hand-computed expectation cannot see. So the central claim here is measured
 * against the engine: simulate the swap, then ACTUALLY equip the thing and
 * refresh the live derive, and require the two to agree field for field.
 *
 * That is the same shape upstream's borg uses (wield, recompute, revert), turned
 * into an assertion.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants.js";
import { ELEM, OF, TV } from "../generated/index.js";
import { OBJ_NOTICE, playerLearnCombat, playerLearnFlagRune, playerLearnResist } from "../obj/knowledge.js";
import { ObjRegistry } from "../obj/bind.js";
import { objectPrep } from "../obj/make.js";
import type { GameObject, StackLimits } from "../obj/object.js";
import { startGame } from "../session/game.js";
import type { GamePack } from "../session/game.js";
import { invenCarry, wieldObject, wieldSlot } from "../game/gear.js";
import { invenTakeoff } from "../game/obj-cmd.js";
import type { GameState } from "../game/context.js";
import { derivedStatsView, diffDerivedStats } from "../player/loadout.js";
import { toCombatState, weightLimit } from "../player/calcs.js";
import { maxManaFrom, wornArmorWeight } from "../player/spell.js";
import { Rng } from "../rng.js";
import { objectSeeAt, squareSensePile } from "../game/known.js";
import { createAgentView } from "./perceive.js";
import { simulateLoadout } from "./loadout.js";
import { AgentCapabilityError } from "./types.js";
import type { LoadoutChange, LoadoutItemRef } from "./types.js";

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
  /* store.json is here because one arm of LoadoutItemRef addresses a SHOP's
     stock, and a pack with no shops cannot exercise it. */
  store: loadRecords("store"),
  constants: loadJson("constants"),
  terrain: loadRecords("terrain"),
  roomTemplates: loadRecords("room_template"),
  vaults: loadRecords("vault"),
  dungeonProfiles: loadRecords("dungeon_profile"),
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

const reg = new ObjRegistry(pack.obj);
const constants = bindConstants(pack.constants);
const limits: StackLimits = {
  quiverSlotSize: constants.quiverSlotSize,
  thrownQuiverMult: constants.thrownQuiverMult,
};

/** Every ordinary kind of a tval, heaviest last. */
function kindsByWeight(tval: number) {
  return reg.kinds
    .filter((k) => k.tval === tval && k.kidx < reg.ordinaryKindCount)
    .sort((a, b) => a.weight - b.weight);
}

function make(kindIndex: number, tval: number, seed = 7): GameObject {
  const kinds = kindsByWeight(tval);
  const kind = kinds[kindIndex] ?? kinds[kinds.length - 1];
  if (!kind) throw new Error(`no ordinary kind for tval ${tval}`);
  return objectPrep(new Rng(seed), reg, constants, kind, 0, "minimise");
}

/** The live derived state, projected exactly as a LoadoutView projects one. */
function liveStats(state: GameState) {
  const p = state.actor.player;
  const derived = state.playerState!;
  return derivedStatsView(derived, {
    maxHp: p.mhp,
    maxSp: p.msp,
    cumberArmor: derived.cumberArmor,
    totalWeight: p.upkeep.totalWeight,
    weightLimit: weightLimit(derived),
  });
}

function newGame(depth = 1): GameState {
  return startGame(pack, { seed: 4242, depth }).state;
}

/**
 * Really wield `handle`, the way the game does: inven_wield refuses an occupied
 * slot, so the wield COMMAND takes the current occupant off first (cmd-obj.c
 * do_cmd_wield). Reproducing that here is what makes the comparison against
 * simulateLoadout a comparison with the real path rather than with a shortcut.
 */
function reallyWield(state: GameState, handle: number): void {
  const p = state.actor.player;
  const obj = state.gear.store.get(handle)!;
  const slot = wieldSlot(p.body, obj.tval, p.equipment);
  const occupant = p.equipment[slot] ?? 0;
  if (occupant) expect(invenTakeoff(state, occupant)).toBe(true);
  expect(wieldObject(state.gear, p, handle)).toBeGreaterThanOrEqual(0);
  state.updateBonuses?.();
}

describe("simulateLoadout runs the engine's own derive on gear nobody is wearing", () => {
  it("predicts EXACTLY what equipping a weapon does, measured against equipping it", () => {
    const state = newGame();
    const p = state.actor.player;
    /* The heaviest ordinary sword: a warrior's starting weapon is light, so the
     * blow count and the digging skill both move, and a low-STR character finds
     * it too heavy - which exercises the heavy-wield branch as well. */
    const sword = make(Number.MAX_SAFE_INTEGER, TV.SWORD);
    const handle = invenCarry(state.gear, p, sword, limits);

    const sim = simulateLoadout(state, { wield: [{ from: "gear", handle }] });
    expect(sim).not.toBeNull();
    expect(sim!.unresolved).toEqual([]);
    /* Anti-inert: a simulation that returned the current loadout unchanged
       would satisfy every equality below. */
    expect(sim!.delta.changed).toBe(true);

    /* Now do it for real and compare against the live refresh. */
    reallyWield(state, handle);
    const real = liveStats(state);

    expect(sim!.after.stats).toEqual(real);
  });

  it("predicts EXACTLY what wearing body armour does, AC and all", () => {
    const state = newGame();
    const p = state.actor.player;
    const mail = make(Number.MAX_SAFE_INTEGER, TV.HARD_ARMOR);
    const handle = invenCarry(state.gear, p, mail, limits);

    const sim = simulateLoadout(state, { wield: [{ from: "gear", handle }] });
    expect(sim).not.toBeNull();
    /* Base armour is never rune-gated (player-calcs.c:1995), so this moves. */
    expect(sim!.delta.baseAc).toBeGreaterThan(0);
    expect(sim!.delta.ac).toBeGreaterThan(0);

    reallyWield(state, handle);
    expect(sim!.after.stats).toEqual(liveStats(state));
  });

  it("reports the loadout the character is already in as `before`", () => {
    const state = newGame();
    const sim = simulateLoadout(state, {});
    expect(sim).not.toBeNull();
    /* An empty change derives the live loadout twice, so before == after and
       nothing changed. This is what makes the two sides comparable at all. */
    expect(sim!.before.stats).toEqual(liveStats(state));
    expect(sim!.after.stats).toEqual(sim!.before.stats);
    expect(sim!.delta.changed).toBe(false);
    expect(sim!.placements).toEqual([]);
  });

  it("writes NOTHING - not the gear, not the player, not the derived state", () => {
    const state = newGame();
    const p = state.actor.player;
    const mail = make(Number.MAX_SAFE_INTEGER, TV.SOFT_ARMOR);
    const handle = invenCarry(state.gear, p, mail, limits);

    const equipBefore = [...p.equipment];
    const packBefore = [...state.gear.pack];
    const weightBefore = p.upkeep.totalWeight;
    const mhpBefore = p.mhp;
    const mspBefore = p.msp;
    const stateBefore = state.playerState;
    const statsBefore = liveStats(state);

    simulateLoadout(state, {
      wield: [{ from: "gear", handle }],
      release: [{ handle: p.equipment.find((h) => h) ?? 0 }],
    });

    expect([...p.equipment]).toEqual(equipBefore);
    expect([...state.gear.pack]).toEqual(packBefore);
    expect(p.upkeep.totalWeight).toBe(weightBefore);
    expect(p.mhp).toBe(mhpBefore);
    expect(p.msp).toBe(mspBefore);
    /* The live PlayerState object itself, not merely an equal one: a derive that
       reassigned state.playerState would leave the game reading a hypothetical. */
    expect(state.playerState).toBe(stateBefore);
    expect(liveStats(state)).toEqual(statsBefore);
  });

  it("moves what was in the slot into the pack, and says what it displaced", () => {
    const state = newGame();
    const p = state.actor.player;
    const weaponSlot = p.body.slots.findIndex((s) => s.type === "WEAPON");
    const wornHandle = p.equipment[weaponSlot] ?? 0;
    expect(wornHandle).toBeGreaterThan(0);

    const sword = make(0, TV.SWORD);
    const handle = invenCarry(state.gear, p, sword, limits);
    const sim = simulateLoadout(state, { wield: [{ from: "gear", handle }] })!;

    expect(sim.placements).toHaveLength(1);
    const [placement] = sim.placements;
    expect(placement!.slot).toBe(weaponSlot);
    expect(placement!.worn.handle).toBe(handle);
    expect(placement!.displaced?.handle).toBe(wornHandle);
    /* The displaced weapon is carried, not gone, so the burden is unchanged. */
    expect(sim.after.stats.totalWeight).toBe(sim.before.stats.totalWeight);
    expect(sim.after.inventory.some((i) => i.handle === wornHandle)).toBe(true);
    expect(sim.after.equipment[weaponSlot]?.handle).toBe(handle);
  });

  it("charges the carried weight for gear being ACQUIRED, not for gear moved", () => {
    const state = newGame();
    const p = state.actor.player;
    const mail = make(Number.MAX_SAFE_INTEGER, TV.HARD_ARMOR);

    /* An object in hand (a shop ware, a floor pile) is not carried yet. */
    const buying = simulateLoadout(state, {
      wield: [{ from: "object", object: mail }],
    })!;
    expect(buying.after.stats.totalWeight - buying.before.stats.totalWeight).toBe(
      mail.weight,
    );

    /* The same item, already in the pack: wearing it changes no burden. */
    const handle = invenCarry(state.gear, p, mail, limits);
    const wearing = simulateLoadout(state, {
      wield: [{ from: "gear", handle }],
    })!;
    expect(wearing.after.stats.totalWeight).toBe(wearing.before.stats.totalWeight);
  });

  it("takes a worn item out of its slot and off the books when it is released", () => {
    const state = newGame();
    const p = state.actor.player;
    const weaponSlot = p.body.slots.findIndex((s) => s.type === "WEAPON");
    const wornHandle = p.equipment[weaponSlot]!;
    const worn = state.gear.store.get(wornHandle)!;

    const sim = simulateLoadout(state, { release: [{ handle: wornHandle }] })!;
    expect(sim.after.equipment[weaponSlot]).toBeNull();
    expect(sim.after.inventory.some((i) => i.handle === wornHandle)).toBe(false);
    expect(sim.before.stats.totalWeight - sim.after.stats.totalWeight).toBe(
      worn.number * worn.weight,
    );
    /* Unarmed is a real derive, not a hole: calc_bonuses' unarmed branch runs
       (player-calcs.c:2316-2319), so the blow count is still populated. */
    expect(sim.after.stats.blows).toBeGreaterThan(0);
  });

  it("releases part of a stack and leaves the rest in the pack", () => {
    const state = newGame();
    const p = state.actor.player;
    const arrows = make(0, TV.ARROW);
    arrows.number = 20;
    const handle = invenCarry(state.gear, p, arrows, limits);
    const one = arrows.weight;

    const sim = simulateLoadout(state, {
      release: [{ handle, number: 5 }],
    })!;
    const left = sim.after.inventory.find((i) => i.handle === handle);
    expect(left?.number).toBe(15);
    expect(sim.before.stats.totalWeight - sim.after.stats.totalWeight).toBe(5 * one);
  });

  it("prices a purchase from a shop's own stock, by shop and stock index", () => {
    const state = newGame(0);
    const stores = state.stores ?? [];
    expect(stores.length).toBeGreaterThan(0);
    /* Any ware at all: the claim is that a store reference RESOLVES, which is
       the arm no gear handle can express. */
    const shop = stores.findIndex((s) => s.stock.length > 0);
    expect(shop).toBeGreaterThanOrEqual(0);
    const ware = stores[shop]!.stock[0]!;

    const sim = simulateLoadout(state, {
      carry: [{ item: { from: "store", store: shop, index: 0 }, number: 1 }],
    })!;
    expect(sim.unresolved).toEqual([]);
    expect(sim.after.stats.totalWeight - sim.before.stats.totalWeight).toBe(
      ware.weight,
    );
    expect(sim.after.inventory.length).toBe(sim.before.inventory.length + 1);
  });

  it("skips a reference that names nothing, and reports it", () => {
    const state = newGame();
    const sim = simulateLoadout(state, {
      wield: [{ from: "gear", handle: 999999 }],
      carry: [{ item: { from: "store", store: 99, index: 4 } }],
    })!;
    expect(sim.unresolved).toHaveLength(2);
    expect(sim.delta.changed).toBe(false);
  });

  it("answers null when the session installed no derive, rather than guessing", () => {
    const state = newGame();
    delete state.derivedFor;
    expect(simulateLoadout(state, {})).toBeNull();
  });

  it("reaches an agent through the frozen view, with the view's own deps", () => {
    const state = newGame();
    const p = state.actor.player;
    const mail = make(Number.MAX_SAFE_INTEGER, TV.HARD_ARMOR);
    const handle = invenCarry(state.gear, p, mail, limits);

    const view = createAgentView(state, undefined, { reg });
    expect(typeof view.simulateLoadout).toBe("function");
    const sim = view.simulateLoadout!({ wield: [{ from: "gear", handle }] })!;

    /* The deps the view was built with reach the simulated ItemViews too: an
       object priced in the live pack and unpriced in a simulated one would make
       an agent's decision depend on which read produced it. */
    const live = view.inventory().find((i) => i.handle === handle);
    expect(live?.value).toBeGreaterThan(0);
    const worn = sim.after.equipment.find((i) => i?.handle === handle);
    expect(worn?.value).toBe(live?.value);
    /* And the frozen PlayerView reports the hypothetical numbers. */
    expect(sim.after.player.ac).toBe(sim.after.stats.ac);
    expect(sim.after.player.ac).toBeGreaterThan(sim.before.player.ac);
    expect(sim.before.player.ac).toBe(view.player().ac);
  });

  it("moves max mana when armour weight starts costing a caster", () => {
    /* A mage in plate is the case a scalar comparison gets wrong: the armour is
       an AC gain AND a mana loss, and calc_mana owns the second half. */
    const state = startGame(pack, {
      seed: 909,
      depth: 1,
      raceName: "Human",
      className: "Mage",
    }).state;
    const p = state.actor.player;
    expect(p.msp).toBeGreaterThan(0);

    const plate = make(Number.MAX_SAFE_INTEGER, TV.HARD_ARMOR);
    const handle = invenCarry(state.gear, p, plate, limits);
    const sim = simulateLoadout(state, { wield: [{ from: "gear", handle }] })!;

    const armorWeight = wornArmorWeight(
      p,
      sim.after.equipment.map((i) =>
        i ? (state.gear.store.get(i.handle) ?? null) : null,
      ),
    );
    expect(armorWeight).toBeGreaterThan(p.cls.magic.spellWeight);
    expect(sim.after.stats.cumberArmor).toBe(true);
    expect(sim.after.stats.maxSp).toBe(
      maxManaFrom(p, sim.after.stats.statInd, armorWeight),
    );
    expect(sim.delta.maxSp).toBeLessThan(0);

    /* And the real thing agrees. */
    reallyWield(state, handle);
    expect(sim.after.stats).toEqual(liveStats(state));
  });
});

describe("a floor reference names a remembered object by grid and pile index", () => {
  /** Lay `obj` on the floor beside the character; `seen` makes the player remember it exactly. */
  function onFloor(state: GameState, obj: GameObject, seen: boolean) {
    const grid = { x: state.actor.grid.x + 1, y: state.actor.grid.y };
    obj.grid = { ...grid };
    const key = grid.y * state.chunk.width + grid.x;
    state.floor.set(key, [obj]);
    if (seen) objectSeeAt(state, grid, obj);
    return { grid, key };
  }

  const granted = (...caps: string[]) => ({ has: (cap: string) => caps.includes(cap) });

  it("compares a floor armour against the worn slot exactly as the object itself compares", () => {
    const state = newGame();
    const p = state.actor.player;
    const mail = make(Number.MAX_SAFE_INTEGER, TV.HARD_ARMOR);
    const { grid, key } = onFloor(state, mail, true);
    const ref = { from: "floor", x: grid.x, y: grid.y, index: 0 } as const;
    const view = createAgentView(state, undefined, { reg },
      granted("state:player.read", "state:inventory.read", "state:floor.read"));

    const result = view.compareLoadoutSlots!(ref);
    const bodySlot = p.body.slots.findIndex((s) => s.type === "BODY_ARMOR");
    expect(result.slots.map((s) => s.slot)).toEqual([bodySlot]);
    const comparison = result.slots[0]!.comparison;
    expect(comparison.unresolved).toEqual([]);
    expect(comparison.placements[0]?.slot).toBe(bodySlot);
    expect(comparison.placements[0]?.displaced?.handle).toBe(p.equipment[bodySlot] || undefined);
    /* Wearing it off the floor picks it up, so its weight joins the burden. */
    expect(comparison.after.stats.totalWeight - comparison.before.stats.totalWeight).toBe(mail.weight);

    const truth = simulateLoadout(state, { wieldAt: [{ item: { from: "object", object: mail }, slot: bodySlot }] },
      { viewDeps: { reg } })!;
    expect(comparison.delta).toEqual(truth.delta);
    expect(comparison.after.stats).toEqual(truth.after.stats);
    expect(comparison.delta.ac).toBeGreaterThan(0);

    const sim = view.simulateLoadout!({ wield: [ref] })!;
    expect(sim.unresolved).toEqual([]);
    expect(sim.delta).toEqual(truth.delta);
    /* A read: the pile is where it was. */
    expect(state.floor.get(key)).toEqual([mail]);
  });

  it("resolves nothing for a bad index or a grid off the map", () => {
    const state = newGame();
    const mail = make(Number.MAX_SAFE_INTEGER, TV.HARD_ARMOR);
    const { grid } = onFloor(state, mail, true);
    const view = createAgentView(state, undefined, { reg });
    const bad = [
      { from: "floor", x: grid.x, y: grid.y, index: 1 },
      { from: "floor", x: grid.x, y: grid.y, index: -1 },
      { from: "floor", x: -1, y: grid.y, index: 0 },
      { from: "floor", x: state.chunk.width, y: grid.y, index: 0 },
    ] as const;
    for (const ref of bad) {
      expect(view.compareLoadoutSlots!(ref).slots).toEqual([]);
      const sim = view.simulateLoadout!({ wield: [ref] })!;
      expect(sim.unresolved).toEqual([ref]);
      expect(sim.delta.changed).toBe(false);
    }
  });

  it("does not reach an object the player has never seen or has only sensed", () => {
    const state = newGame();
    const mail = make(Number.MAX_SAFE_INTEGER, TV.HARD_ARMOR);
    const { grid } = onFloor(state, mail, false);
    const ref = { from: "floor", x: grid.x, y: grid.y, index: 0 } as const;
    const view = createAgentView(state, undefined, { reg });
    expect(view.compareLoadoutSlots!(ref).slots).toEqual([]);
    expect(view.simulateLoadout!({ wield: [ref] })!.unresolved).toEqual([ref]);

    squareSensePile(state, grid);
    expect(view.compareLoadoutSlots!(ref).slots).toEqual([]);
    expect(view.simulateLoadout!({ carry: [{ item: ref }] })!.unresolved).toEqual([ref]);

    objectSeeAt(state, grid, mail);
    expect(view.compareLoadoutSlots!(ref).slots).toHaveLength(1);
  });

  it("needs the floor capability on top of the player one", () => {
    const state = newGame();
    const mail = make(Number.MAX_SAFE_INTEGER, TV.HARD_ARMOR);
    const { grid } = onFloor(state, mail, true);
    const ref = { from: "floor", x: grid.x, y: grid.y, index: 0 } as const;
    const handle = invenCarry(state.gear, state.actor.player, make(0, TV.SOFT_ARMOR), limits);
    const view = createAgentView(state, undefined, { reg },
      granted("state:player.read", "state:inventory.read"));
    expect(() => view.compareLoadoutSlots!(ref)).toThrow(AgentCapabilityError);
    expect(() => view.simulateLoadout!({ wield: [ref] })).toThrow(AgentCapabilityError);
    expect(() => view.simulateLoadout!({ wieldAt: [{ item: ref, slot: 0 }] })).toThrow(AgentCapabilityError);
    expect(() => view.simulateLoadout!({ carry: [{ item: ref }] })).toThrow(AgentCapabilityError);
    /* The other arms are unaffected by the floor grant. */
    expect(view.compareLoadoutSlots!({ from: "gear", handle }).slots.length).toBeGreaterThan(0);
    expect(view.simulateLoadout!({ wield: [{ from: "gear", handle }] })).not.toBeNull();
    const floorOnly = createAgentView(state, undefined, { reg }, granted("state:floor.read"));
    expect(() => floorOnly.compareLoadoutSlots!(ref)).toThrow(AgentCapabilityError);
    const wildcard = createAgentView(state, undefined, { reg }, granted("state:*.read"));
    expect(wildcard.compareLoadoutSlots!(ref).slots).toHaveLength(1);
  });
});

describe("a loadout read needs the read for every place it looks", () => {
  const granted = (...caps: string[]) => ({ has: (cap: string) => caps.includes(cap) });

  /** A state with one of each arm: a packed shield, a shop ware and a seen floor armour. */
  function arms() {
    const state = newGame(0);
    const p = state.actor.player;
    const handle = invenCarry(state.gear, p, make(0, TV.SOFT_ARMOR), limits);
    const shop = (state.stores ?? []).findIndex((s) => s.stock.length > 0);
    expect(shop).toBeGreaterThanOrEqual(0);
    const grid = { x: state.actor.grid.x + 1, y: state.actor.grid.y };
    const mail = make(Number.MAX_SAFE_INTEGER, TV.HARD_ARMOR);
    mail.grid = { ...grid };
    state.floor.set(grid.y * state.chunk.width + grid.x, [mail]);
    objectSeeAt(state, grid, mail);
    const refs = {
      gear: { from: "gear", handle },
      store: { from: "store", store: shop, index: 0 },
      floor: { from: "floor", x: grid.x, y: grid.y, index: 0 },
    } as const;
    return { state, refs };
  }

  const domainOf = { gear: "inventory", store: "stores", floor: "floor" } as const;
  const changes = (ref: LoadoutItemRef): LoadoutChange[] => [
    { wield: [ref] },
    { wieldAt: [{ item: ref, slot: 0 }] },
    { carry: [{ item: ref }] },
  ];

  for (const arm of ["gear", "store", "floor"] as const) {
    it(`refuses a ${arm} reference without state:${domainOf[arm]}.read in any entry`, () => {
      const { state, refs } = arms();
      const others = Object.values(domainOf).filter((d) => d !== domainOf[arm] && d !== "inventory");
      /* Everything but the arm's own domain; for gear that domain is the inventory. */
      const view = createAgentView(state, undefined, { reg },
        granted("state:player.read", ...(arm === "gear" ? [] : ["state:inventory.read"]),
          ...others.map((d) => `state:${d}.read`)));
      for (const change of changes(refs[arm])) {
        expect(() => view.simulateLoadout!(change)).toThrow(AgentCapabilityError);
      }
      expect(() => view.compareLoadoutSlots!(refs[arm])).toThrow(AgentCapabilityError);
      /* A refused reference also refuses a change that mixes it with allowed ones. */
      const mixed = { wield: [refs[arm]], carry: [{ item: { from: "object", object: make(0, TV.SOFT_ARMOR) } as const }] };
      expect(() => view.simulateLoadout!(mixed)).toThrow(AgentCapabilityError);
    });

    it(`answers a ${arm} reference once state:${domainOf[arm]}.read is granted`, () => {
      const { state, refs } = arms();
      const view = createAgentView(state, undefined, { reg },
        granted("state:player.read", "state:inventory.read", `state:${domainOf[arm]}.read`));
      for (const change of changes(refs[arm])) {
        expect(view.simulateLoadout!(change)).not.toBeNull();
      }
      expect(view.simulateLoadout!({ carry: [{ item: refs[arm] }] })!.unresolved).toEqual([]);
      expect(view.compareLoadoutSlots!(refs[arm]).slots.length).toBeGreaterThan(0);
    });
  }

  it("needs the inventory read for any change, since the answer lists the pack and the worn set", () => {
    const { state, refs } = arms();
    const view = createAgentView(state, undefined, { reg },
      granted("state:player.read", "state:stores.read", "state:floor.read"));
    expect(() => view.simulateLoadout!({})).toThrow(AgentCapabilityError);
    expect(() => view.simulateLoadout!({ release: [{ handle: refs.gear.handle }] })).toThrow(AgentCapabilityError);
    expect(() => view.compareLoadoutSlots!(refs.store)).toThrow(AgentCapabilityError);
    const playerOnly = createAgentView(state, undefined, { reg }, granted("state:player.read"));
    expect(() => playerOnly.simulateLoadout!({})).toThrow(AgentCapabilityError);
    const withInventory = createAgentView(state, undefined, { reg },
      granted("state:player.read", "state:inventory.read"));
    expect(withInventory.simulateLoadout!({})).not.toBeNull();
  });

  it("lets state:*.read cover every arm, and a trusted view needs no grant", () => {
    const { state, refs } = arms();
    const change: LoadoutChange = {
      wield: [refs.gear],
      wieldAt: [{ item: refs.floor, slot: 0 }],
      carry: [{ item: refs.store }],
    };
    for (const view of [
      createAgentView(state, undefined, { reg }, granted("state:*.read")),
      createAgentView(state, undefined, { reg }),
    ]) {
      expect(view.simulateLoadout!(change)).not.toBeNull();
      for (const ref of Object.values(refs)) expect(view.compareLoadoutSlots!(ref).slots.length).toBeGreaterThan(0);
    }
    /* The wildcard is still a state grant: without the player read nothing answers. */
    const noPlayer = createAgentView(state, undefined, { reg },
      granted("state:inventory.read", "state:stores.read", "state:floor.read"));
    expect(() => noPlayer.simulateLoadout!(change)).toThrow(AgentCapabilityError);
  });
});

describe("a comparison counts only the runes the player knows", () => {
  /** A body armour with a fire resist, +7 to armour and free action; assessed unless told otherwise. */
  function runed(assessed = true): GameObject {
    const obj = make(0, TV.SOFT_ARMOR);
    obj.elInfo[ELEM.FIRE]!.resLevel = 1;
    obj.toA = 7;
    obj.flags.on(OF.FREE_ACT);
    if (assessed) obj.notice |= OBJ_NOTICE.ASSESSED;
    return obj;
  }

  /** The same armour with none of the runes: what the player believes `runed` is. */
  function plain(): GameObject {
    const obj = make(0, TV.SOFT_ARMOR);
    obj.notice |= OBJ_NOTICE.ASSESSED;
    return obj;
  }

  /** A town game whose character has learned none of the three runes. */
  function unlearned(): GameState {
    const state = newGame(0);
    const p = state.actor.player;
    p.objKnown.elInfo[ELEM.FIRE]!.resLevel = 0;
    p.objKnown.toA = 0;
    p.objKnown.flags.off(OF.FREE_ACT);
    return state;
  }

  function learnAll(state: GameState): void {
    const p = state.actor.player;
    playerLearnResist(p, state.runeEnv, ELEM.FIRE, false);
    playerLearnCombat(p, state.runeEnv, "toA", false);
    playerLearnFlagRune(p, state.runeEnv, OF.FREE_ACT, false);
  }

  /** Each arm of LoadoutItemRef naming `obj`, placed where that arm looks. */
  function placed(state: GameState, obj: GameObject, arm: "gear" | "store" | "floor" | "object"): LoadoutItemRef {
    switch (arm) {
      case "gear":
        return { from: "gear", handle: invenCarry(state.gear, state.actor.player, obj, limits) };
      case "store": {
        const shop = (state.stores ?? []).findIndex((s) => s.stock.length > 0);
        state.stores![shop]!.stock.unshift(obj);
        return { from: "store", store: shop, index: 0 };
      }
      case "floor": {
        const grid = { x: state.actor.grid.x + 1, y: state.actor.grid.y };
        obj.grid = { ...grid };
        state.floor.set(grid.y * state.chunk.width + grid.x, [obj]);
        objectSeeAt(state, grid, obj);
        return { from: "floor", x: grid.x, y: grid.y, index: 0 };
      }
      case "object":
        return { from: "object", object: obj };
    }
  }

  for (const arm of ["gear", "store", "floor", "object"] as const) {
    it(`shows none of an unlearned rune through the ${arm} arm until the player learns it`, () => {
      const twinState = unlearned();
      const twin = simulateLoadout(twinState, { wield: [placed(twinState, plain(), arm)] })!;
      expect(twin.unresolved).toEqual([]);
      expect(twin.delta.unknownRunes).toBe(false);

      const state = unlearned();
      const ref = placed(state, runed(), arm);
      const sim = simulateLoadout(state, { wield: [ref] })!;
      expect(sim.unresolved).toEqual([]);
      /* The runed armour derives exactly as its plain twin does. */
      expect(sim.delta).toEqual({ ...twin.delta, unknownRunes: true });
      expect(sim.after.stats.resists[ELEM.FIRE]).toBe(sim.before.stats.resists[ELEM.FIRE]);
      expect(sim.after.player.objectFlags).not.toContain("FREE_ACT");
      expect(sim.after.player.ac).toBe(twin.after.player.ac);

      /* The view and the per-slot read agree with the function. */
      if (ref.from !== "object") {
        const view = createAgentView(state, undefined, {});
        expect(view.simulateLoadout!({ wield: [ref] })!.delta).toEqual(sim.delta);
        const [slot] = view.compareLoadoutSlots!(ref).slots;
        expect(slot!.comparison.delta).toEqual(sim.delta);
      }

      learnAll(state);
      const learned = simulateLoadout(state, { wield: [ref] })!;
      expect(learned.delta.unknownRunes).toBe(false);
      expect(learned.delta.resists[ELEM.FIRE]).toBe(1);
      expect(learned.delta.toA).toBe(twin.delta.toA + 7);
      expect(learned.delta.objectFlagsGained).toContain("FREE_ACT");
    });
  }

  it("keeps a worn item's unlearned rune out of both sides of a swap", () => {
    const state = unlearned();
    const p = state.actor.player;
    const bodySlot = p.body.slots.findIndex((s) => s.type === "BODY_ARMOR");
    const worn = invenCarry(state.gear, p, runed(), limits);
    reallyWield(state, worn);
    expect(p.equipment[bodySlot]).toBe(worn);
    const before = simulateLoadout(state, {})!;
    /* The live known state is what `before` reports; the real state differs. */
    expect(before.before.stats.resists[ELEM.FIRE]).toBe(state.knownPlayerState!.elInfo[ELEM.FIRE]!.resLevel);
    expect(state.playerState!.elInfo[ELEM.FIRE]!.resLevel).toBe(1);
    expect(before.before.stats.resists[ELEM.FIRE]).toBe(0);
    expect(before.delta.unknownRunes).toBe(false);

    /* Taking it off loses nothing the player knew of, and says so. */
    const off = simulateLoadout(state, { remove: [bodySlot] })!;
    expect(off.delta.resists[ELEM.FIRE]).toBe(0);
    expect(off.delta.objectFlagsLost).not.toContain("FREE_ACT");
    expect(off.delta.unknownRunes).toBe(true);
  });

  it("flags an item seen only from a distance, whose bonuses are not known yet", () => {
    const state = unlearned();
    learnAll(state);
    const ref = placed(state, runed(false), "floor");
    const sim = simulateLoadout(state, { wield: [ref] })!;
    expect(sim.unresolved).toEqual([]);
    expect(sim.delta.unknownRunes).toBe(true);
    /* Unassessed, only the base armour counts, even with every rune learned. */
    expect(sim.delta.resists[ELEM.FIRE]).toBe(0);
  });
});

describe("the derived-stat projection and its diff", () => {
  it("keeps a copy, so a later refresh cannot rewrite an answer already given", () => {
    const state = newGame();
    const derived = state.playerState!;
    const view = derivedStatsView(derived, {
      maxHp: 1,
      maxSp: 2,
      cumberArmor: false,
      totalWeight: 3,
      weightLimit: 4,
    });
    const skill0 = view.skills[0]!;
    derived.skills[0] = skill0 + 1000;
    expect(view.skills[0]).toBe(skill0);
  });

  it("says nothing changed when nothing changed, and names what did", () => {
    const state = newGame();
    const a = liveStats(state);
    expect(diffDerivedStats(a, a).changed).toBe(false);

    const b = { ...a, objectFlags: [...a.objectFlags, "FEATHER"], speed: a.speed + 10 };
    const delta = diffDerivedStats(a, b);
    expect(delta.changed).toBe(true);
    expect(delta.speed).toBe(10);
    expect(delta.objectFlagsGained).toEqual(["FEATHER"]);
    expect(delta.objectFlagsLost).toEqual([]);
    /* And the reverse direction reports the loss, not a second gain. */
    expect(diffDerivedStats(b, a).objectFlagsLost).toEqual(["FEATHER"]);
  });

  it("projects the same combat numbers the engine hands the combat code", () => {
    /* toCombatState is what player-attack.c reads; the projection must not
       disagree with it about the same derive. */
    const state = newGame();
    const derived = state.playerState!;
    const combat = toCombatState(derived);
    const view = liveStats(state);
    expect(view.toH).toBe(combat.toH);
    expect(view.toD).toBe(combat.toD);
    expect(view.baseAc).toBe(combat.ac);
    expect(view.toA).toBe(combat.toA);
    expect(view.blows).toBe(combat.numBlows);
    expect(view.shots).toBe(combat.numShots);
  });
});
