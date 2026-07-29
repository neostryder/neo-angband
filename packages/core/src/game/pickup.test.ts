import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants";
import { TV } from "../generated";
import { loc } from "../loc";
import { Rng } from "../rng";
import { ObjRegistry } from "../obj/bind";
import type { ObjPackJson } from "../obj/types";
import { objectPrep } from "../obj/make";
import type { GameObject } from "../obj/object";
import { floorCarry, floorPile } from "./floor";
import { calcInventory, gearAdd, gearGet, invenCarry, invenCarryNum } from "./gear";
import type { GameState } from "./context";
import {
  autoPickupOkay,
  checkForInscrip,
  checkForInscripWithInt,
  doAutopickup,
  installPickup,
  playerPickupGold,
  playerPickupItem,
} from "./pickup";
import type { PickupDeps } from "./pickup";
import { createDefaultRegistry, processPlayer } from "./player-turn";
import { makeState } from "./harness";
import { OptionState } from "../player/options";

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

const reg = new ObjRegistry(objPack);
const constants = bindConstants(loadJson("constants"));
const deps: PickupDeps = { constants };

/**
 * Deps with the PU_INVEN refresh wired, exactly as the session binder wires it
 * (session/game.ts installPickup). Any test that asserts a SLOT LETTER must use
 * these: the letter is gear_to_label of the derived upkeep->inven[] listing, so a
 * test that never rebuilds the listing is not testing what the player sees. The
 * absence of this was how the wrong-letter defect stayed invisible.
 */
function labelDeps(state: GameState, env?: PickupDeps["env"]): PickupDeps {
  return {
    constants,
    refreshInventory: () => calcInventory(state.gear, constants),
    ...(env ? { env } : {}),
  };
}

function makeObj(tval: number, nth = 0): GameObject {
  const kinds = reg.kinds.filter(
    (k) => k.tval === tval && k.kidx < reg.ordinaryKindCount,
  );
  const kind = kinds[nth];
  if (!kind) throw new Error(`no ordinary kind #${nth} for tval ${tval}`);
  return objectPrep(new Rng(9), reg, constants, kind, 0, "average");
}

function makeGold(pval: number): GameObject {
  const g = makeObj(TV.GOLD);
  g.pval = pval;
  return g;
}

/** Put an object on the player's grid. */
function underfoot(state: GameState, obj: GameObject): GameObject {
  expect(floorCarry(state, state.actor.grid, obj)).toBe(true);
  return obj;
}

/** Put an object straight into the pack (a pre-existing carried stack). */
function carryObj(state: GameState, obj: GameObject): GameObject {
  const handle = gearAdd(state.gear, obj);
  state.gear.pack.push(handle);
  return obj;
}

describe("inscription checks (obj-util.c)", () => {
  it("counts occurrences and parses =g<n>", () => {
    const obj = makeObj(TV.POTION);
    obj.note = "=g5!g=g";
    expect(checkForInscrip(obj, "=g")).toBe(2);
    expect(checkForInscrip(obj, "!g")).toBe(1);
    const withInt = checkForInscripWithInt(obj, "=g");
    expect(withInt.count).toBe(1);
    expect(withInt.value).toBe(5);
  });
});

describe("playerPickupGold (cmd-pickup.c player_pickup_gold)", () => {
  it("collects all gold underfoot into the purse", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    underfoot(state, makeGold(120));
    underfoot(state, makeObj(TV.POTION));
    const before = state.actor.player.au;

    let reported = 0;
    const total = playerPickupGold(state, {
      onGold: (t): void => {
        reported = t;
      },
    });
    expect(total).toBe(120);
    expect(reported).toBe(120);
    expect(state.actor.player.au).toBe(before + 120);
    /* The potion stays; the gold is gone. */
    expect(floorPile(state, loc(5, 5)).length).toBe(1);
  });
});

describe("autoPickupOkay (cmd-pickup.c auto_pickup_okay)", () => {
  it("does not auto-pick a plain object by default", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const obj = underfoot(state, makeObj(TV.POTION));
    expect(autoPickupOkay(state, obj, deps)).toBe(0);
  });

  it("pickup_always picks anything carryable", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const obj = underfoot(state, makeObj(TV.POTION));
    expect(
      autoPickupOkay(state, obj, { constants, env: { pickupAlways: true } }),
    ).toBe(obj.number);
  });

  it("reads pickup_always from the wired option store when env omits it", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const obj = underfoot(state, makeObj(TV.POTION));
    /* No env override: without a store, the shipped default (off) refuses. */
    expect(autoPickupOkay(state, obj, deps)).toBe(0);
    /* Install an option store with pickup_always on: the seam consults it. */
    state.options = new OptionState({ overrides: { pickup_always: true } });
    expect(autoPickupOkay(state, obj, deps)).toBe(obj.number);
  });

  it("!g always refuses, even with pickup inscriptions", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const obj = underfoot(state, makeObj(TV.POTION));
    obj.note = "=g!g";
    expect(autoPickupOkay(state, obj, deps)).toBe(0);
  });

  it("=g forces pickup", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const obj = underfoot(state, makeObj(TV.POTION));
    obj.note = "=g";
    expect(autoPickupOkay(state, obj, deps)).toBe(obj.number);
  });

  it("pickup_inven picks an object matching a pack stack", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const inPack = makeObj(TV.POTION);
    invenCarry(state.gear, inPack, {
      quiverSlotSize: constants.quiverSlotSize,
      thrownQuiverMult: constants.thrownQuiverMult,
    });
    const obj = underfoot(state, makeObj(TV.POTION));
    expect(autoPickupOkay(state, obj, deps)).toBe(obj.number);
  });

  it("=g<n> caps pickup by the count already in the pack", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const inPack = makeObj(TV.POTION);
    inPack.number = 3;
    inPack.note = "=g4";
    invenCarry(state.gear, inPack, {
      quiverSlotSize: constants.quiverSlotSize,
      thrownQuiverMult: constants.thrownQuiverMult,
    });
    const obj = underfoot(state, makeObj(TV.POTION));
    obj.number = 5;
    /* 4 wanted, 3 held -> only 1 more. */
    expect(autoPickupOkay(state, obj, deps)).toBe(1);
    inPack.number = 4;
    expect(autoPickupOkay(state, obj, deps)).toBe(0);
  });
});

describe("doAutopickup / playerPickupItem", () => {
  it("autopickup takes gold and =g items, leaves the rest", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    underfoot(state, makeGold(50));
    const wanted = underfoot(state, makeObj(TV.POTION, 0));
    wanted.note = "=g";
    underfoot(state, makeObj(TV.POTION, 1));

    const picked = doAutopickup(state, deps);
    expect(picked).toBe(1);
    expect(state.actor.player.au).toBeGreaterThan(0);
    const left = floorPile(state, loc(5, 5));
    expect(left.length).toBe(1);
    expect(left[0]!.note).toBeNull();
    /* The wanted potion is now a pack stack. */
    const inPack = state.gear.pack
      .map((h) => gearGet(state.gear, h))
      .find((o) => o === wanted);
    expect(inPack).toBe(wanted);
  });

  it("'g' picks up the single object underfoot", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const obj = underfoot(state, makeObj(TV.POTION));
    const picked = playerPickupItem(state, null, deps);
    expect(picked).toBe(1);
    expect(floorPile(state, loc(5, 5)).length).toBe(0);
    expect(obj.grid).toBeNull();
  });

  it("the pickup message reports the merged stack count and slot (inven_carry)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const stack = makeObj(TV.POTION, 0);
    stack.number = 5;
    underfoot(state, stack);
    let msg = "";
    playerPickupItem(state, null, labelDeps(state, { onPickup: (m) => (msg = m) }));
    /* "You have 5 <potions> (a)." - the count and pack slot, not "You have a". */
    expect(msg).toMatch(/^You have 5 .+ \(a\)\.$/);
  });

  /**
   * player_pickup_aux L253-274: when only PART of a floor stack can be carried,
   * upstream asks how much with get_quantity(NULL, max) - and the port took the
   * whole carryable amount silently. Same class as the drop-a-stack report: the
   * amount prompt existed for the store and nowhere else.
   */
  describe("partial pickup asks how much (cmd-pickup.c L270)", () => {
    /**
     * The only way inven_carry_num returns a number strictly between 0 and
     * obj.number: every pack slot is taken, and the one matching stack has room
     * for just a few more. Room for exactly PART_ROOM, offered PART_ROOM + 7.
     */
    const PART_ROOM = 3;
    function overfullStack(state: GameState): GameObject {
      const potion = makeObj(TV.POTION, 0);
      const cap = potion.kind.base.maxStack;
      /* Fill every pack slot but one with singletons. */
      for (let i = 0; i < constants.packSize - 1; i++) {
        const filler = makeObj(TV.SWORD, i % 3);
        filler.number = 1;
        carryObj(state, filler);
      }
      /* The last slot: a matching stack with room for PART_ROOM more. */
      const held = makeObj(TV.POTION, 0);
      held.number = cap - PART_ROOM;
      carryObj(state, held);
      calcInventory(state.gear, constants, {});
      const stack = makeObj(TV.POTION, 0);
      stack.number = PART_ROOM + 7;
      underfoot(state, stack);
      /* Guard the premise: a partial pickup, not a whole one and not a refusal. */
      expect(invenCarryNum(state.gear, stack, constants)).toBe(PART_ROOM);
      return stack;
    }

    it("asks with the carryable maximum, not the whole stack", () => {
      const state = makeState({ playerGrid: loc(5, 5) });
      const stack = overfullStack(state);
      const offered = stack.number;
      const asked: number[] = [];
      playerPickupItem(state, stack, {
        constants,
        env: {
          getQuantity: (max) => {
            asked.push(max);
            return 2;
          },
        },
      });
      /* The prompt's ceiling is what FITS, not what is lying there. */
      expect(asked).toEqual([PART_ROOM]);
      /* Two moved, so the floor keeps the rest. */
      expect(floorPile(state, loc(5, 5))[0]?.number).toBe(offered - 2);
    });

    it("a 0 answer picks nothing up, and the object stays whole", () => {
      const state = makeState({ playerGrid: loc(5, 5) });
      const stack = overfullStack(state);
      const before = stack.number;
      /* Upstream still counts the object (player_pickup_item L389), so the turn
       * is spent - the return value is 1 even though nothing moved. */
      const picked = playerPickupItem(state, stack, {
        constants,
        env: { getQuantity: () => 0 },
      });
      expect(picked).toBe(1);
      expect(floorPile(state, loc(5, 5))[0]?.number).toBe(before);
    });

    it("a whole stack that fits never asks (max == obj.number)", () => {
      const state = makeState({ playerGrid: loc(5, 5) });
      const stack = makeObj(TV.POTION, 0);
      stack.number = 5;
      underfoot(state, stack);
      let asked = false;
      playerPickupItem(state, stack, {
        constants,
        env: {
          getQuantity: () => {
            asked = true;
            return 1;
          },
        },
      });
      expect(asked).toBe(false);
      expect(gearGet(state.gear, state.gear.pack[0]!)?.number).toBe(5);
    });

    it("autopickup answers for itself and never asks", () => {
      const state = makeState({ playerGrid: loc(5, 5) });
      state.options = new OptionState();
      state.options.set("pickup_always", true);
      const stack = overfullStack(state);
      const before = stack.number;
      let asked = false;
      doAutopickup(state, {
        constants,
        env: {
          getQuantity: () => {
            asked = true;
            return 0;
          },
        },
      });
      /* auto_max short-circuits the prompt (cmd-pickup.c L267-268), and taking
       * PART_ROOM anyway proves the hook's 0 was never consulted. */
      expect(asked).toBe(false);
      expect(floorPile(state, loc(5, 5))[0]?.number).toBe(before - PART_ROOM);
    });

    it("with no hook at all the whole carryable amount is taken", () => {
      const state = makeState({ playerGrid: loc(5, 5) });
      const stack = overfullStack(state);
      const before = stack.number;
      playerPickupItem(state, stack, { constants });
      expect(floorPile(state, loc(5, 5))[0]?.number).toBe(before - PART_ROOM);
    });
  });

  it("the chooseItem menu seam selects among several objects", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    underfoot(state, makeObj(TV.POTION, 0));
    const sword = underfoot(state, makeObj(TV.SWORD));
    const picked = playerPickupItem(state, null, {
      constants,
      env: { chooseItem: (list) => list.find((o) => o.tval === TV.SWORD) ?? null },
    });
    expect(picked).toBe(1);
    expect(floorPile(state, loc(5, 5)).some((o) => o === sword)).toBe(false);
  });

  it("the registered pickup command charges move_energy / 10 per object", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    underfoot(state, makeObj(TV.POTION));
    const registry = createDefaultRegistry();
    installPickup(state, registry, deps);

    state.nextCommand = (): { code: string } | null => ({ code: "pickup" });
    const startEnergy = state.actor.energy;
    const result = processPlayer(state, registry);
    expect(result.energyUsed).toBe(Math.trunc(state.z.moveEnergy / 10));
    expect(state.actor.energy).toBe(startEnergy - result.energyUsed);
  });

  it("stepping onto a pile auto-collects gold (walk wiring)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    floorCarry(state, loc(6, 5), makeGold(75));
    const registry = createDefaultRegistry();
    installPickup(state, registry, deps);

    const commands = [{ code: "walk", dir: 6 }];
    state.nextCommand = (): { code: string; dir?: number } | null =>
      commands.shift() ?? null;
    processPlayer(state, registry);
    expect(state.actor.grid).toEqual(loc(6, 5));
    expect(state.actor.player.au).toBe(75);
    expect(floorPile(state, loc(6, 5)).length).toBe(0);
  });

  it("picking up an artifact fires state.onArtifactFound (object_touch)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const art = reg.artifacts.find((a) => a?.name === "of Galadriel")!;
    const obj = underfoot(state, makeObj(TV.LIGHT, 0));
    obj.artifact = art;

    let seen: typeof art | null = null;
    state.onArtifactFound = (a): void => {
      seen = a;
    };
    const picked = playerPickupItem(state, null, deps);
    expect(picked).toBe(1);
    expect(seen).toBe(art);
  });

  it("picking up a non-artifact does NOT fire onArtifactFound", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    underfoot(state, makeObj(TV.POTION));
    let fired = false;
    state.onArtifactFound = (): void => {
      fired = true;
    };
    playerPickupItem(state, null, deps);
    expect(fired).toBe(false);
  });

  it("routes picked-up ammo into the quiver (refreshInventory / PU_INVEN)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    underfoot(state, makeObj(TV.SHOT));
    const registry = createDefaultRegistry();
    /* Mirror the session wiring: the pickup command runs a PU_INVEN rebuild. */
    installPickup(state, registry, {
      constants,
      refreshInventory: (): void => {
        calcInventory(state.gear, constants);
      },
    });

    state.nextCommand = (): { code: string } | null => ({ code: "pickup" });
    processPlayer(state, registry);

    /* The computed quiver now indexes the shot, so the inventory view shows it
     * in the quiver rather than the pack (gear.quiver is an index into pack). */
    const inQuiver = (state.gear.quiver ?? []).some((h) => {
      const o = h ? state.gear.store.get(h) : null;
      return o?.tval === TV.SHOT;
    });
    expect(inQuiver).toBe(true);
  });

  it("without a PU_INVEN rebuild the ammo is not yet in the quiver (bug repro)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    underfoot(state, makeObj(TV.SHOT));
    /* inven_carry alone (no refreshInventory) leaves the quiver index empty, so
     * the shot shows in the main inventory - exactly the reported bug. */
    playerPickupItem(state, null, deps);
    const inQuiver = (state.gear.quiver ?? []).some((h) => {
      const o = h ? state.gear.store.get(h) : null;
      return o?.tval === TV.SHOT;
    });
    expect(inQuiver).toBe(false);
    /* It was carried (it is in the pack backing store). */
    const carried = state.gear.pack.some(
      (h) => state.gear.store.get(h)?.tval === TV.SHOT,
    );
    expect(carried).toBe(true);
  });
});

describe("inven_carry autoinscribes on pickup (obj-gear.c:864-868)", () => {
  /*
   * inven_carry calls apply_autoinscription in its NON-combining branch only
   * (obj-gear.c:867-868): an object absorbed into an existing stack keeps that
   * stack's inscription instead. The port routes it through the
   * state.autoinscribeObject seam, which the session wires.
   */
  function withSeam(state: GameState, seen: GameObject[]): void {
    state.autoinscribeObject = (obj: GameObject): void => {
      seen.push(obj);
      if (!obj.note) obj.note = "@w1";
    };
  }

  it("autoinscribes a newly-inserted object", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const seen: GameObject[] = [];
    withSeam(state, seen);
    const potion = makeObj(TV.POTION);
    underfoot(state, potion);
    expect(playerPickupItem(state, potion, deps)).toBe(1);
    expect(seen).toHaveLength(1);
    expect(seen[0]!.note).toBe("@w1");
  });

  it("does NOT autoinscribe an object absorbed into an existing stack", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const first = makeObj(TV.POTION);
    const held = invenCarry(state.gear, first, {
      quiverSlotSize: constants.quiverSlotSize,
      thrownQuiverMult: constants.thrownQuiverMult,
    });
    expect(gearGet(state.gear, held)).toBeTruthy();
    const seen: GameObject[] = [];
    withSeam(state, seen);
    /* A second potion of the same kind combines with the held stack. */
    const second = makeObj(TV.POTION);
    underfoot(state, second);
    expect(playerPickupItem(state, second, deps)).toBe(1);
    expect(seen).toEqual([]);
  });
});

describe("object_pack_total in inven_carry's message (obj-gear.c L905-921)", () => {
  it("reports the AGGREGATE over split stacks and names the first one", () => {
    /* The pack holds two MERGEABLE stacks of the same potion. That is a real
     * state, and the reason object_pack_total exists: nothing merges them until
     * combine_pack runs on the PN_COMBINE notice, and a stack over the per-slot
     * limit stays split regardless. object_pack_total is called with
     * ignore_inscrip = false, so it aggregates over object_stackable - two
     * DIFFERENTLY inscribed stacks would (correctly) not combine into one total.
     *
     * Upstream aggregates across both slots and labels the earlier one "1st";
     * the port used to report only the stack the pickup landed in. */
    const state = makeState({ playerGrid: loc(5, 5) });
    const first = makeObj(TV.POTION, 0);
    first.number = 2;
    carryObj(state, first);
    const second = makeObj(TV.POTION, 0);
    second.number = 3;
    carryObj(state, second);

    const floorStack = makeObj(TV.POTION, 0);
    floorStack.number = 1;
    underfoot(state, floorStack);

    let msg = "";
    playerPickupItem(state, null, labelDeps(state, { onPickup: (m) => (msg = m) }));
    /* The floor potion merges into slot a (3), and the total spans both slots:
     * 3 + 3 = 6, reported against the first stack's letter. */
    expect(msg).toMatch(/^You have 6 .+ \(1st a\)\.$/);
  });

  it("keeps a single stack's own count and plain label", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const stack = makeObj(TV.POTION, 0);
    stack.number = 4;
    underfoot(state, stack);
    let msg = "";
    playerPickupItem(state, null, labelDeps(state, { onPickup: (m) => (msg = m) }));
    expect(msg).toMatch(/^You have 4 .+ \(a\)\.$/);
  });

  it("does not aggregate a wand, whose charge count belongs to one stack", () => {
    /* obj-gear.c L899-901: tval_can_have_charges suppresses the aggregate,
     * because the "(N charges)" notice beside it is this stack's own. */
    const state = makeState({ playerGrid: loc(5, 5) });
    const held = makeObj(TV.WAND, 0);
    held.number = 1;
    held.pval = 7;
    held.note = "keep";
    carryObj(state, held);

    const floorWand = makeObj(TV.WAND, 0);
    floorWand.number = 1;
    floorWand.pval = 3;
    underfoot(state, floorWand);

    let msg = "";
    playerPickupItem(state, null, {
      constants,
      env: { onPickup: (m) => (msg = m) },
    });
    expect(msg).not.toMatch(/1st/);
  });
});
