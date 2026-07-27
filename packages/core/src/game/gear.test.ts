import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants";
import { OBJ_MOD, TV } from "../generated";
import { ObjRegistry } from "../obj/bind";
import { objectPrep } from "../obj/make";
import type { GameObject, StackLimits } from "../obj/object";
import { bindPlayer } from "../player/bind";
import { blankPlayer } from "../player/player";
import { makeRuneEnv, OBJ_NOTICE } from "../obj/knowledge";
import { objectFullyKnown, objectKnownShadow } from "../obj/known-object";
import type { KnownDesc } from "../obj/known-object";
import { Rng } from "../rng";
import { startGame } from "../session/game";
import type { GamePack } from "../session/game";
import {
  calcInventory,
  gearGet,
  invenCarry,
  newGear,
  outfitPlayer,
  wieldAll,
  wieldObject,
  wieldSlot,
} from "./gear";

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

// A full game pack: core content plus the player-domain records (mirrors
// session/game.test.ts).
const pack: GamePack = {
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

const players = bindPlayer(pack.player);
const humanWarrior = () => {
  const race = players.raceByName("Human")!;
  const cls = players.classByName("Warrior")!;
  const body = players.bodies[race.body]!;
  return { race, cls, body };
};

const constants = bindConstants(pack.constants);
const limits: StackLimits = {
  quiverSlotSize: constants.quiverSlotSize,
  thrownQuiverMult: constants.thrownQuiverMult,
};

/** First ordinary (non-artifact-dummy) kind of a tval. */
function firstOrdinaryKind(reg: ObjRegistry, tval: number) {
  const k = reg.kinds.find(
    (kk) => kk.tval === tval && kk.kidx < reg.ordinaryKindCount,
  );
  if (!k) throw new Error(`no ordinary kind for tval ${tval}`);
  return k;
}

describe("wieldSlot (obj-gear.c wield_slot)", () => {
  const { body } = humanWarrior();
  const slotType = (tval: number) => body.slots[wieldSlot(body, tval)]?.type;

  it("maps each wearable tval to the correct slot type", () => {
    expect(slotType(TV.SWORD)).toBe("WEAPON");
    expect(slotType(TV.HAFTED)).toBe("WEAPON");
    expect(slotType(TV.POLEARM)).toBe("WEAPON");
    expect(slotType(TV.DIGGING)).toBe("WEAPON");
    expect(slotType(TV.BOW)).toBe("BOW");
    expect(slotType(TV.RING)).toBe("RING");
    expect(slotType(TV.AMULET)).toBe("AMULET");
    expect(slotType(TV.LIGHT)).toBe("LIGHT");
    expect(slotType(TV.SOFT_ARMOR)).toBe("BODY_ARMOR");
    expect(slotType(TV.HARD_ARMOR)).toBe("BODY_ARMOR");
    expect(slotType(TV.DRAG_ARMOR)).toBe("BODY_ARMOR");
    expect(slotType(TV.HELM)).toBe("HAT");
    expect(slotType(TV.CROWN)).toBe("HAT");
    expect(slotType(TV.CLOAK)).toBe("CLOAK");
    expect(slotType(TV.SHIELD)).toBe("SHIELD");
    expect(slotType(TV.GLOVES)).toBe("GLOVES");
    expect(slotType(TV.BOOTS)).toBe("BOOTS");
  });

  it("returns -1 for a non-wearable tval", () => {
    expect(wieldSlot(body, TV.POTION)).toBe(-1);
    expect(wieldSlot(body, TV.FOOD)).toBe(-1);
    expect(wieldSlot(body, TV.SCROLL)).toBe(-1);
  });

  it("prefers an empty slot: a second ring lands in the free hand", () => {
    const eq = new Array<number>(body.count).fill(0);
    const first = wieldSlot(body, TV.RING, eq);
    expect(body.slots[first]?.type).toBe("RING");
    eq[first] = 99; // occupy the first ring slot
    const second = wieldSlot(body, TV.RING, eq);
    expect(body.slots[second]?.type).toBe("RING");
    expect(second).not.toBe(first);
  });
});

describe("invenCarry (obj-gear.c inven_carry)", () => {
  it("merges stackable potions into one pack stack", () => {
    const reg = new ObjRegistry(pack.obj);
    const rng = new Rng(1);
    const gear = newGear();
    const potion = firstOrdinaryKind(reg, TV.POTION);

    const p1 = objectPrep(rng, reg, constants, potion, 0, "minimise");
    p1.number = 2;
    const p2 = objectPrep(rng, reg, constants, potion, 0, "minimise");
    p2.number = 3;

    const h1 = invenCarry(gear, p1, limits);
    const h2 = invenCarry(gear, p2, limits);

    // The second stack merged into the first: same handle, one pack slot.
    expect(h2).toBe(h1);
    expect(gear.pack.length).toBe(1);
    expect(gearGet(gear, h1)!.number).toBe(5);
  });

  it("adds a distinct handle for a non-mergeable kind", () => {
    const reg = new ObjRegistry(pack.obj);
    const rng = new Rng(1);
    const gear = newGear();

    const potion = objectPrep(
      rng,
      reg,
      constants,
      firstOrdinaryKind(reg, TV.POTION),
      0,
      "minimise",
    );
    const food = objectPrep(
      rng,
      reg,
      constants,
      firstOrdinaryKind(reg, TV.FOOD),
      0,
      "minimise",
    );

    const hp = invenCarry(gear, potion, limits);
    const hf = invenCarry(gear, food, limits);
    expect(hf).not.toBe(hp);
    expect(gear.pack.length).toBe(2);
  });
});

describe("wieldAll (player-birth.c wield_all split)", () => {
  it("wields one from a stack and leaves the remainder in the pack", () => {
    const reg = new ObjRegistry(pack.obj);
    const rng = new Rng(1);
    const gear = newGear();
    const { race, cls, body } = humanWarrior();
    const player = blankPlayer(race, cls, body);

    const torches = objectPrep(
      rng,
      reg,
      constants,
      firstOrdinaryKind(reg, TV.LIGHT),
      0,
      "minimise",
    );
    torches.number = 3;
    invenCarry(gear, torches, limits);

    wieldAll(gear, player);

    const lightSlot = wieldSlot(body, TV.LIGHT);
    const wornHandle = player.equipment[lightSlot]!;
    expect(wornHandle).not.toBe(0);
    // Exactly one worn, two left behind in a single pack stack.
    expect(gearGet(gear, wornHandle)!.number).toBe(1);
    expect(gear.pack.length).toBe(1);
    expect(gearGet(gear, gear.pack[0]!)!.number).toBe(2);
  });
});

describe("outfitPlayer (player-birth.c player_outfit)", () => {
  it("outfits and equips a born Human Warrior", () => {
    const reg = new ObjRegistry(pack.obj);
    const rng = new Rng(42);
    const gear = newGear();
    const { race, cls, body } = humanWarrior();
    const player = blankPlayer(race, cls, body);

    outfitPlayer(gear, player, reg, rng, constants);

    const slotOf = (type: string) =>
      body.slots.findIndex((s) => s.type === type);

    const weapon = gearGet(gear, player.equipment[slotOf("WEAPON")]!);
    const armor = gearGet(gear, player.equipment[slotOf("BODY_ARMOR")]!);
    const light = gearGet(gear, player.equipment[slotOf("LIGHT")]!);

    // Dagger in the weapon slot, Soft Leather Armour in the body slot,
    // Wooden Torch lighting the way.
    expect(weapon?.tval).toBe(TV.SWORD);
    expect(armor?.tval).toBe(TV.SOFT_ARMOR);
    expect(light?.tval).toBe(TV.LIGHT);

    // The consumables stay in the pack.
    const packTvals = gear.pack.map((h) => gearGet(gear, h)!.tval);
    expect(packTvals).toContain(TV.FOOD);
    expect(packTvals).toContain(TV.POTION);
    expect(packTvals).toContain(TV.SCROLL);
  });

  it("marks every start item OBJ_NOTICE_ASSESSED (player-birth.c L652)", () => {
    const reg = new ObjRegistry(pack.obj);
    const rng = new Rng(42);
    const gear = newGear();
    const { race, cls, body } = humanWarrior();
    const player = blankPlayer(race, cls, body);

    outfitPlayer(gear, player, reg, rng, constants);

    /* Upstream sets obj->known->notice |= OBJ_NOTICE_ASSESSED on each item it
     * hands out. The port keeps that bit on the live object, and the known
     * shadow bails out before the flag/element intersection without it - which
     * is what made a Wooden Torch's own known-from-birth flags read UNKNOWN and
     * printed '?' down its whole character-sheet column. */
    const all = [...gear.store.values()];
    expect(all.length).toBeGreaterThan(0);
    for (const obj of all) {
      expect(obj.notice & OBJ_NOTICE.ASSESSED).not.toBe(0);
    }

    /* The consequence, end to end: the torch reads fully known. */
    const light = gearGet(gear, player.equipment[body.slots.findIndex((sl) => sl.type === "LIGHT")]!)!;
    expect(light.flags.isEmpty()).toBe(false); // BURNS_OUT / LIGHT_2
    const env = makeRuneEnv(
      (slot: number) => gearGet(gear, player.equipment[slot] ?? 0),
      () => false,
      { properties: reg.properties, brands: reg.brands, slays: reg.slays, curses: reg.curses },
    );
    const known: KnownDesc = { isAware: () => false, isTried: () => false };
    const shadow = objectKnownShadow(light, player, env, known);
    expect(objectFullyKnown(light, shadow, player, env)).toBe(true);
  });

  it("deducts the outfit cost from starting gold (player-birth.c L654)", () => {
    const reg = new ObjRegistry(pack.obj);
    const rng = new Rng(42);
    const gear = newGear();
    const { race, cls, body } = humanWarrior();
    const player = blankPlayer(race, cls, body);
    player.au = 600;

    outfitPlayer(gear, player, reg, rng, constants);

    // The free kit has real value, so gold drops below the 600 roll but is
    // never driven negative (the L662 sanity clamp).
    expect(player.au).toBeLessThan(600);
    expect(player.au).toBeGreaterThanOrEqual(0);
  });

  it("clamps starting gold to zero when the kit outvalues it", () => {
    const reg = new ObjRegistry(pack.obj);
    const rng = new Rng(42);
    const gear = newGear();
    const { race, cls, body } = humanWarrior();
    const player = blankPlayer(race, cls, body);
    player.au = 1;

    outfitPlayer(gear, player, reg, rng, constants);

    expect(player.au).toBe(0);
  });

  it("with start_kit off gives only one food and one light", () => {
    const reg = new ObjRegistry(pack.obj);
    const rng = new Rng(7);
    const gear = newGear();
    const { race, cls, body } = humanWarrior();
    const player = blankPlayer(race, cls, body);

    outfitPlayer(gear, player, reg, rng, constants, { startKit: false });

    const lightSlot = body.slots.findIndex((s) => s.type === "LIGHT");
    // Light is wielded (1), the single food is the only pack item.
    expect(player.equipment[lightSlot]).not.toBe(0);
    expect(gearGet(gear, player.equipment[lightSlot]!)!.number).toBe(1);
    expect(gear.pack.length).toBe(1);
    const food = gearGet(gear, gear.pack[0]!)!;
    expect(food.tval).toBe(TV.FOOD);
    expect(food.number).toBe(1);
    // No weapon or armour without the full kit.
    const weaponSlot = body.slots.findIndex((s) => s.type === "WEAPON");
    const armorSlot = body.slots.findIndex((s) => s.type === "BODY_ARMOR");
    expect(player.equipment[weaponSlot]).toBe(0);
    expect(player.equipment[armorSlot]).toBe(0);
  });
});

describe("object_learn_on_wield learns modifier runes (obj-knowledge.c)", () => {
  it("wielding a +3 STR ring learns the STR rune so the bonus goes live", () => {
    const reg = new ObjRegistry(pack.obj);
    const rng = new Rng(1);
    const gear = newGear();
    const { race, cls, body } = humanWarrior();
    const player = blankPlayer(race, cls, body);

    // A ring carrying a +3 STR modifier (as an ego/artifact rune would).
    const ring = objectPrep(
      rng,
      reg,
      constants,
      firstOrdinaryKind(reg, TV.RING),
      0,
      "minimise",
    );
    ring.modifiers[OBJ_MOD.STR] = 3;
    const handle = invenCarry(gear, ring, limits);

    // Rune unknown until worn (born unknown, exactly as upstream).
    expect(player.objKnown.modifiers[OBJ_MOD.STR]).toBe(0);

    const slot = wieldObject(gear, player, handle);
    expect(slot).toBeGreaterThanOrEqual(0);

    // Wearing it taught the STR rune; calc_bonuses will now apply the +3.
    expect(player.objKnown.modifiers[OBJ_MOD.STR]).toBe(1);
  });

  it("wielding a plain item teaches no modifier runes", () => {
    const reg = new ObjRegistry(pack.obj);
    const rng = new Rng(1);
    const gear = newGear();
    const { race, cls, body } = humanWarrior();
    const player = blankPlayer(race, cls, body);

    const torch = objectPrep(
      rng,
      reg,
      constants,
      firstOrdinaryKind(reg, TV.LIGHT),
      0,
      "minimise",
    );
    // A plain wooden torch has a LIGHT modifier; it should learn that one and
    // nothing else, leaving every stat rune unknown.
    const hadLight = (torch.modifiers[OBJ_MOD.LIGHT] ?? 0) !== 0;
    invenCarry(gear, torch, limits);
    wieldAll(gear, player);

    expect(player.objKnown.modifiers[OBJ_MOD.STR]).toBe(0);
    expect(player.objKnown.modifiers[OBJ_MOD.DEX]).toBe(0);
    expect(player.objKnown.modifiers[OBJ_MOD.LIGHT]).toBe(hadLight ? 1 : 0);
  });
});

describe("startGame wires the gear at birth", () => {
  it("a born character carries and wears its starting kit", () => {
    const { state } = startGame(pack, { seed: 123, depth: 1 });
    const player = state.actor.player;
    const body = player.body;

    const weaponSlot = body.slots.findIndex((s) => s.type === "WEAPON");
    const armorSlot = body.slots.findIndex((s) => s.type === "BODY_ARMOR");
    const lightSlot = body.slots.findIndex((s) => s.type === "LIGHT");

    expect(player.equipment[weaponSlot]).not.toBe(0);
    expect(player.equipment[armorSlot]).not.toBe(0);
    expect(player.equipment[lightSlot]).not.toBe(0);

    const weapon = gearGet(state.gear, player.equipment[weaponSlot]!);
    const armor = gearGet(state.gear, player.equipment[armorSlot]!);
    expect(weapon?.tval).toBe(TV.SWORD);
    expect(armor?.tval).toBe(TV.SOFT_ARMOR);

    // The store holds every object; the pack holds the non-equipped ones.
    expect(state.gear.store.size).toBeGreaterThan(0);
    expect(state.gear.pack.length).toBeGreaterThan(0);
  });
});

/**
 * calc_inventory's pack half of the reorder notice (player-calcs.c:1224-1233).
 * Found absent by the upstream text census: the quiver half was ported and the
 * pack half was not, so a pack that shuffled under the player said nothing.
 */
describe("calcInventory re-arrange notice (player-calcs.c:1224-1233)", () => {
  /**
   * Two potions of different kinds. Both aware, earlier_object sorts them by
   * increasing sval (:972-974); make the low-sval one UNAWARE and it drops to
   * the back instead (:966-969). That is the ordinary in-play trigger for this
   * message - you identify a potion and the pack re-sorts around it.
   */
  function twoItemGear(): {
    gear: ReturnType<typeof newGear>;
    handles: number[];
    lowSval: number;
  } {
    const reg = new ObjRegistry(pack.obj);
    const rng = new Rng(1);
    const gear = newGear();
    const kinds = reg.kinds
      .filter((k) => k.tval === TV.POTION && k.kidx < reg.ordinaryKindCount)
      .sort((x, y) => x.sval - y.sval);
    const a = objectPrep(rng, reg, constants, kinds[0]!, 0, "minimise");
    const b = objectPrep(rng, reg, constants, kinds[1]!, 0, "minimise");
    const ha = invenCarry(gear, a, limits);
    return { gear, handles: [ha, invenCarry(gear, b, limits)], lowSval: ha };
  }

  it("says nothing the first time it runs - there is no old pack to differ from", () => {
    const { gear } = twoItemGear();
    const said: string[] = [];
    calcInventory(gear, constants, { characterDungeon: true, msg: (t) => void said.push(t) });
    expect(said).toEqual([]);
    expect(gear.inven?.length).toBe(2);
  });

  it("says nothing when the same pack sorts to the same order", () => {
    const { gear } = twoItemGear();
    calcInventory(gear, constants, { characterDungeon: true });
    const said: string[] = [];
    calcInventory(gear, constants, { characterDungeon: true, msg: (t) => void said.push(t) });
    expect(said).toEqual([]);
  });

  it("announces a re-arrangement when a slot's occupant changes", () => {
    const { gear, handles, lowSval } = twoItemGear();
    /* Start from the unaware ordering, so the low-sval potion is at the back. */
    const unaware = { isAware: (o: GameObject): boolean => o.sval !== gearGet(gear, lowSval)!.sval };
    calcInventory(gear, constants, { characterDungeon: true, ...unaware });
    const before = [...gear.inven!];

    /* Now the player identifies it: it sorts to the front and the pack shifts. */
    const said: string[] = [];
    calcInventory(gear, constants, {
      characterDungeon: true,
      msg: (t) => void said.push(t),
    });

    expect(gear.inven).not.toEqual(before);
    expect(gear.inven!.length).toBe(handles.length);
    expect(said).toEqual(["You re-arrange your pack."]);
  });

  it("stays silent outside the dungeon (character_dungeon, :1225)", () => {
    const { gear, lowSval } = twoItemGear();
    const unaware = { isAware: (o: GameObject): boolean => o.sval !== gearGet(gear, lowSval)!.sval };
    calcInventory(gear, constants, { characterDungeon: true, ...unaware });
    const said: string[] = [];
    calcInventory(gear, constants, { msg: (t) => void said.push(t) });
    expect(said).toEqual([]);
  });

  it("does not blame a re-arrangement for an item that was equipped (:1227)", () => {
    const { gear, handles } = twoItemGear();
    calcInventory(gear, constants, { characterDungeon: true });
    const worn = handles[0]!;

    /* Wear the first item and pick up a replacement in the same breath, so the
     * pack count is unchanged and only the equipped handle moved. */
    gear.pack = gear.pack.filter((h) => h !== worn);
    const reg = new ObjRegistry(pack.obj);
    const extra = objectPrep(new Rng(2), reg, constants, firstOrdinaryKind(reg, TV.POTION), 0, "minimise");
    invenCarry(gear, extra, limits);

    const said: string[] = [];
    calcInventory(gear, constants, {
      characterDungeon: true,
      isEquipped: (h) => h === worn,
      msg: (t) => void said.push(t),
    });
    expect(said).toEqual([]);
  });
});
