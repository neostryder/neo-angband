import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants";
import { OF, TMD, TV } from "../generated";
import { loc } from "../loc";
import { Rng } from "../rng";
import { EffectRegistry } from "../effects/interpreter";
import { registerCoreHandlers } from "../effects/handlers";
import { ObjRegistry } from "../obj/bind";
import type { ObjPackJson } from "../obj/types";
import { objectPrep } from "../obj/make";
import type { GameObject } from "../obj/object";
import { FlavorKnowledge } from "../obj/knowledge";
import { bindProjections } from "../world/projection";
import type { ProjectionRecordJson } from "../world/projection";
import { floorPile } from "./floor";
import { gearAdd, gearGet, invenCarry } from "./gear";
import { basicPlayerActor } from "./project-cast";
import type { CastContext } from "./project-cast";
import { registerAttackHandlers } from "./effect-attack";
import { registerMonsterHandlers } from "./effect-monster";
import { registerTeleportHandlers } from "./effect-teleport";
import {
  applyAutoinscription,
  buildObjectEffectChain,
  getUseDeviceChance,
  installObjCommands,
  invenDrop,
  invenTakeoff,
  invenWield,
  numberCharging,
  objCanRefill,
  objHasInscrip,
  objNeedsAim,
  refillLamp,
  useAux,
  USE,
} from "./obj-cmd";
import type { ObjCmdDeps } from "./obj-cmd";
import { createDefaultRegistry, processPlayer } from "./player-turn";
import { makeState, plReg } from "./harness";
import type { GameState } from "./context";

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
const projections = bindProjections(
  (loadJson<{ records: ProjectionRecordJson[] }>("projection")).records,
);

function effectRegistry(): EffectRegistry {
  const r = new EffectRegistry();
  registerCoreHandlers(r);
  registerAttackHandlers(r);
  registerMonsterHandlers(r);
  registerTeleportHandlers(r);
  return r;
}

function castContext(state: GameState): CastContext {
  return { projections, maxRange: 20, playerActor: basicPlayerActor(state) };
}

function makeDeps(state: GameState, over: Partial<ObjCmdDeps> = {}): ObjCmdDeps {
  return {
    constants,
    registry: effectRegistry(),
    cast: castContext(state),
    envDeps: { timedTable: plReg.timed },
    ...over,
  };
}

function kindByName(name: string, tval: number) {
  const k = reg.kinds.find((kk) => kk.name === name && kk.tval === tval);
  if (!k) throw new Error(`no kind named ${name} of tval ${tval}`);
  return k;
}

function makeNamed(name: string, tval: number): GameObject {
  return objectPrep(
    new Rng(3),
    reg,
    constants,
    kindByName(name, tval),
    0,
    "average",
  );
}

/** Max the device skill so check_devices cannot fizzle. */
function maxDeviceSkill(state: GameState): void {
  state.actor.combat = {
    ...state.actor.combat,
    skills: state.actor.combat.skills.map(() => 150),
  };
}

function carry(state: GameState, obj: GameObject): number {
  return invenCarry(state.gear, obj, {
    quiverSlotSize: constants.quiverSlotSize,
    thrownQuiverMult: constants.thrownQuiverMult,
  });
}

describe("inventory verbs (obj-gear.c)", () => {
  it("invenWield wears a pack item; invenTakeoff returns it to the pack", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const sword = makeNamed("& Dagger~", TV.SWORD);
    const h = carry(state, sword);

    const slot = invenWield(state, h);
    expect(slot).toBeGreaterThanOrEqual(0);
    expect(state.actor.player.equipment[slot]).toBe(h);
    expect(state.gear.pack).not.toContain(h);

    expect(invenTakeoff(state, h)).toBe(true);
    expect(state.actor.player.equipment[slot]).toBe(0);
    expect(state.gear.pack).toContain(h);
  });

  it("invenWield replaces an occupied slot, keeping the old item", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const first = carry(state, makeNamed("& Dagger~", TV.SWORD));
    const second = carry(state, makeNamed("& Tulwar~", TV.SWORD));
    const slot = invenWield(state, first);
    expect(invenWield(state, second)).toBe(slot);
    expect(state.actor.player.equipment[slot]).toBe(second);
    expect(state.gear.pack).toContain(first);
  });

  it("invenDrop puts the object on the floor near the player", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const potion = makeNamed("Cure Light Wounds", TV.POTION);
    const h = carry(state, potion);
    const dropped = invenDrop(state, h, potion.number);
    expect(dropped).not.toBeNull();
    expect(state.gear.pack).not.toContain(h);
    expect(floorPile(state, loc(5, 5))).toContain(dropped);
  });
});

describe("useAux (cmd-obj.c use_aux)", () => {
  it("quaffing a Cure Light Wounds potion heals and is consumed", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const p = state.actor.player;
    p.mhp = 30;
    p.chp = 10;
    const potion = makeNamed("Cure Light Wounds", TV.POTION);
    const h = carry(state, potion);

    const result = useAux(state, potion, USE.SINGLE, makeDeps(state), {
      handle: h,
    });
    expect(result.turnSpent).toBe(true);
    expect(p.chp).toBeGreaterThan(10);
    /* The single-use potion is gone from the pack. */
    expect(gearGet(state.gear, h)).toBeNull();
  });

  it("an unaware flavored single-use item becomes aware on use", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.actor.player.mhp = 30;
    state.actor.player.chp = 10;
    const flavor = new FlavorKnowledge(reg.ordinaryKindCount);
    const potion = makeNamed("Cure Light Wounds", TV.POTION);
    const h = carry(state, potion);
    expect(flavor.isAware(potion.kind)).toBe(false);

    useAux(state, potion, USE.SINGLE, makeDeps(state, { flavor }), { handle: h });
    expect(flavor.isAware(potion.kind)).toBe(true);
  });

  it("a staff use consumes a charge", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    maxDeviceSkill(state);
    const staff = makeNamed("Light", TV.STAFF);
    staff.pval = 5;
    const h = carry(state, staff);
    useAux(state, staff, USE.CHARGE, makeDeps(state), { handle: h });
    expect(staff.pval).toBe(4);
  });

  it("a rod use starts its recharge timeout", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    maxDeviceSkill(state);
    const rod = makeNamed("Treasure Location", TV.ROD);
    const h = carry(state, rod);
    expect(rod.timeout).toBe(0);
    useAux(state, rod, USE.TIMEOUT, makeDeps(state), { handle: h });
    expect(rod.timeout).toBeGreaterThan(0);
    expect(numberCharging(rod)).toBe(1);
  });

  it("device failure spends the turn but no charge", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    /* Device skill 0 vs a deep item: fail rate is high; force a fail
     * by trying seeds until the roll fails (deterministic per seed). */
    /* Device skill stays at the harness default (20). */
    const staff = makeNamed("Light", TV.STAFF);
    staff.pval = 5;
    const h = carry(state, staff);
    expect(getUseDeviceChance(state, staff)).toBeGreaterThan(0);
    let failed = false;
    for (let i = 0; i < 200 && !failed; i++) {
      const before = staff.pval;
      const result = useAux(state, staff, USE.CHARGE, makeDeps(state), {
        handle: h,
      });
      expect(result.turnSpent).toBe(true);
      if (!result.used) {
        failed = true;
        expect(staff.pval).toBe(before);
      }
    }
    expect(failed).toBe(true);
  });
});

describe("objNeedsAim / buildObjectEffectChain", () => {
  it("wands need aim; potions do not", () => {
    const wand = makeNamed("Stinking Cloud", TV.WAND);
    const potion = makeNamed("Cure Light Wounds", TV.POTION);
    expect(objNeedsAim(wand, {})).toBe(true);
    expect(objNeedsAim(potion, {})).toBe(false);
  });

  it("builds a chain from raw kind records", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const potion = makeNamed("Cure Light Wounds", TV.POTION);
    const chain = buildObjectEffectChain(potion.effect ?? [], state);
    expect(chain).not.toBeNull();
  });
});

describe("registered commands", () => {
  it("quaff through processPlayer heals and spends a turn", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const p = state.actor.player;
    p.mhp = 30;
    p.chp = 10;
    const potion = makeNamed("Cure Light Wounds", TV.POTION);
    const h = carry(state, potion);

    const registry = createDefaultRegistry();
    installObjCommands(registry, makeDeps(state));
    const commands = [{ code: "quaff", args: { handle: h } }];
    state.nextCommand = () => commands.shift() ?? null;

    const result = processPlayer(state, registry);
    expect(result.energyUsed).toBe(state.z.moveEnergy);
    expect(p.chp).toBeGreaterThan(10);
  });

  it("drop and wield commands charge the right energy", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const sword = makeNamed("& Dagger~", TV.SWORD);
    const h = carry(state, sword);

    const registry = createDefaultRegistry();
    installObjCommands(registry, makeDeps(state));

    const commands = [{ code: "wield", args: { handle: h } }];
    state.nextCommand = () => commands.shift() ?? null;
    expect(processPlayer(state, registry).energyUsed).toBe(state.z.moveEnergy);

    const commands2 = [{ code: "takeoff", args: { handle: h } }];
    state.nextCommand = () => commands2.shift() ?? null;
    expect(processPlayer(state, registry).energyUsed).toBe(
      Math.trunc(state.z.moveEnergy / 2),
    );

    const commands3 = [{ code: "drop", args: { handle: h } }];
    state.nextCommand = () => commands3.shift() ?? null;
    expect(processPlayer(state, registry).energyUsed).toBe(
      Math.trunc(state.z.moveEnergy / 2),
    );
    expect(floorPile(state, loc(5, 5)).length).toBe(1);
  });

  it("timed status potions afflict through the live player", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const potion = makeNamed("Sleep", TV.POTION);
    const h = carry(state, potion);
    const registry = createDefaultRegistry();
    installObjCommands(registry, makeDeps(state));
    const commands = [{ code: "quaff", args: { handle: h } }];
    state.nextCommand = () => commands.shift() ?? null;
    processPlayer(state, registry);
    /* Free of protection, the sleep potion paralyses. */
    expect(state.actor.player.timed[TMD.PARALYZED]!).toBeGreaterThan(0);
  });
});

/** Wield `obj` (carrying it first) and return its equipment slot. */
function equip(state: GameState, obj: GameObject): number {
  return invenWield(state, carry(state, obj));
}

describe("inscribe / uninscribe (cmd-obj.c do_cmd_inscribe/do_cmd_uninscribe)", () => {
  it("objHasInscrip reflects obj.note", () => {
    const dagger = makeNamed("& Dagger~", TV.SWORD);
    expect(objHasInscrip(dagger)).toBe(false);
    dagger.note = "@w1";
    expect(objHasInscrip(dagger)).toBe(true);
  });

  it("inscribe sets obj.note; an empty inscription clears it to null", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const dagger = makeNamed("& Dagger~", TV.SWORD);
    const h = carry(state, dagger);
    const registry = createDefaultRegistry();
    installObjCommands(registry, makeDeps(state));

    const commands = [{ code: "inscribe", args: { handle: h, inscription: "@w1" } }];
    state.nextCommand = () => commands.shift() ?? null;
    const result = processPlayer(state, registry);
    expect(result.energyUsed).toBe(0);
    expect(gearGet(state.gear, h)?.note).toBe("@w1");

    const commands2 = [{ code: "inscribe", args: { handle: h, inscription: "" } }];
    state.nextCommand = () => commands2.shift() ?? null;
    processPlayer(state, registry);
    expect(gearGet(state.gear, h)?.note).toBeNull();
  });

  it("uninscribe clears an inscription and messages 'Inscription removed.'", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const dagger = makeNamed("& Dagger~", TV.SWORD);
    dagger.note = "@w1";
    const h = carry(state, dagger);
    const msgs: string[] = [];
    const registry = createDefaultRegistry();
    installObjCommands(registry, makeDeps(state, { env: { msg: (t) => msgs.push(t) } }));

    const commands = [{ code: "uninscribe", args: { handle: h } }];
    state.nextCommand = () => commands.shift() ?? null;
    const result = processPlayer(state, registry);
    expect(result.energyUsed).toBe(0);
    expect(gearGet(state.gear, h)?.note).toBeNull();
    expect(msgs).toContain("Inscription removed.");
  });

  it("uninscribe on an uninscribed item is a no-op (no message, no crash)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const dagger = makeNamed("& Dagger~", TV.SWORD);
    const h = carry(state, dagger);
    const msgs: string[] = [];
    const registry = createDefaultRegistry();
    installObjCommands(registry, makeDeps(state, { env: { msg: (t) => msgs.push(t) } }));

    const commands = [{ code: "uninscribe", args: { handle: h } }];
    state.nextCommand = () => commands.shift() ?? null;
    expect(() => processPlayer(state, registry)).not.toThrow();
    expect(msgs).toHaveLength(0);
    expect(gearGet(state.gear, h)?.note).toBeNull();
  });
});

describe("autoinscribe (cmd-obj.c do_cmd_autoinscribe / obj-ignore.c apply_autoinscription)", () => {
  it("is a structural no-op with no per-kind registry configured (no #24 UI yet)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const dagger = makeNamed("& Dagger~", TV.SWORD);
    const h = carry(state, dagger);
    const registry = createDefaultRegistry();
    installObjCommands(registry, makeDeps(state));

    const commands = [{ code: "autoinscribe", args: {} }];
    state.nextCommand = () => commands.shift() ?? null;
    expect(() => processPlayer(state, registry)).not.toThrow();
    expect(gearGet(state.gear, h)?.note).toBeNull();
  });

  it("shape-guards: does nothing while shapechanged", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const dagger = makeNamed("& Dagger~", TV.SWORD);
    carry(state, dagger);
    state.actor.player.shape = plReg.shapes[0]!;
    const deps = makeDeps(state, { autoNote: () => "@w1" });
    const registry = createDefaultRegistry();
    installObjCommands(registry, deps);
    const commands = [{ code: "autoinscribe", args: {} }];
    state.nextCommand = () => commands.shift() ?? null;
    processPlayer(state, registry);
    expect(dagger.note).toBeNull();
  });

  it("applies a configured per-kind note to a carried, uninscribed item", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const dagger = makeNamed("& Dagger~", TV.SWORD);
    carry(state, dagger);
    const msgs: string[] = [];
    const deps = makeDeps(state, {
      env: { msg: (t) => msgs.push(t) },
      autoNote: (_kind, aware) => (aware ? "@w1" : null),
    });
    const result = applyAutoinscription(state, dagger, deps);
    expect(result).toBe(1);
    expect(dagger.note).toBe("@w1");
    expect(msgs.some((m) => m.startsWith("You autoinscribe"))).toBe(true);
  });

  it("does not re-inscribe an already-inscribed item", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const dagger = makeNamed("& Dagger~", TV.SWORD);
    dagger.note = "@w2";
    carry(state, dagger);
    const deps = makeDeps(state, { autoNote: () => "@w1" });
    const result = applyAutoinscription(state, dagger, deps);
    expect(result).toBe(0);
    expect(dagger.note).toBe("@w2");
  });

  it("skips an object that is not carried (e.g. still on the floor)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const dagger = makeNamed("& Dagger~", TV.SWORD);
    const deps = makeDeps(state, { autoNote: () => "@w1" });
    const result = applyAutoinscription(state, dagger, deps);
    expect(result).toBe(0);
    expect(dagger.note).toBeNull();
  });

  it("clears a stale unaware note once the kind becomes aware", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const flavor = new FlavorKnowledge(reg.ordinaryKindCount);
    const potion = makeNamed("Cure Light Wounds", TV.POTION);
    carry(state, potion);
    potion.note = "@q1";
    flavor.setAware(potion.kind);
    const deps = makeDeps(state, {
      flavor,
      autoNote: (_kind, aware) => (aware ? null : "@q1"),
    });
    const result = applyAutoinscription(state, potion, deps);
    expect(potion.note).toBeNull();
    expect(result).toBe(0);
  });
});

describe("objCanRefill (obj-util.c obj_can_refill)", () => {
  it("true for a flask of oil with an equipped TAKES_FUEL lantern", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    equip(state, makeNamed("& Lantern~", TV.LIGHT));
    const flask = makeNamed("& Flask~ of oil", TV.FLASK);
    expect(objCanRefill(state, flask)).toBe(true);
  });

  it("false when no light is equipped", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const flask = makeNamed("& Flask~ of oil", TV.FLASK);
    expect(objCanRefill(state, flask)).toBe(false);
  });

  it("false when the equipped light does not take fuel (a torch)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    equip(state, makeNamed("& Wooden Torch~", TV.LIGHT));
    const flask = makeNamed("& Flask~ of oil", TV.FLASK);
    expect(objCanRefill(state, flask)).toBe(false);
  });

  it("true for a donor lantern with fuel, false for one that is empty", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    equip(state, makeNamed("& Lantern~", TV.LIGHT));
    const donor = makeNamed("& Lantern~", TV.LIGHT);
    donor.timeout = 1000;
    expect(objCanRefill(state, donor)).toBe(true);
    donor.timeout = 0;
    expect(objCanRefill(state, donor)).toBe(false);
  });

  it("false for a source flagged NO_FUEL", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    equip(state, makeNamed("& Lantern~", TV.LIGHT));
    const flask = makeNamed("& Flask~ of oil", TV.FLASK);
    flask.flags.on(OF.NO_FUEL);
    expect(objCanRefill(state, flask)).toBe(false);
  });
});

describe("refillLamp (cmd-obj.c refill_lamp)", () => {
  it("refuels from a flask, adding its pval and consuming the flask entirely", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const msgs: string[] = [];
    const deps = makeDeps(state, { env: { msg: (t) => msgs.push(t) } });
    const lantern = makeNamed("& Lantern~", TV.LIGHT);
    equip(state, lantern);
    lantern.timeout = 1000;
    const flask = makeNamed("& Flask~ of oil", TV.FLASK);
    const fuelAmt = flask.pval;
    const fh = carry(state, flask);

    refillLamp(state, lantern, flask, { handle: fh }, deps);

    expect(lantern.timeout).toBe(1000 + fuelAmt);
    expect(gearGet(state.gear, fh)).toBeNull();
    expect(msgs).toContain("You fuel your lamp.");
  });

  it("caps at constants.fuelLamp and messages 'Your lamp is full.'", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const msgs: string[] = [];
    const deps = makeDeps(state, { env: { msg: (t) => msgs.push(t) } });
    const lantern = makeNamed("& Lantern~", TV.LIGHT);
    equip(state, lantern);
    lantern.timeout = deps.constants.fuelLamp - 100;
    const flask = makeNamed("& Flask~ of oil", TV.FLASK);
    const fh = carry(state, flask);

    refillLamp(state, lantern, flask, { handle: fh }, deps);

    expect(lantern.timeout).toBe(deps.constants.fuelLamp);
    expect(msgs).toContain("Your lamp is full.");
  });

  it("from a stacked donor lantern: splits one off, empties the split, carries it back", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const deps = makeDeps(state);
    const lantern = makeNamed("& Lantern~", TV.LIGHT);
    equip(state, lantern);
    lantern.timeout = 1000;
    const donor = makeNamed("& Lantern~", TV.LIGHT);
    donor.number = 2;
    donor.timeout = 3000;
    const donorHandle = carry(state, donor);

    refillLamp(state, lantern, donor, { handle: donorHandle }, deps);

    expect(lantern.timeout).toBe(1000 + 3000);
    expect(donor.number).toBe(1);
    expect(donor.timeout).toBe(3000); /* the untouched remainder keeps its own fuel */
    const emptied = state.gear.pack
      .map((h) => gearGet(state.gear, h))
      .find((o) => o && o !== donor && o.tval === TV.LIGHT && o.timeout === 0);
    expect(emptied).toBeDefined();
  });

  it("from a lone donor lantern: empties it in place (no split, stays carried)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const deps = makeDeps(state);
    const lantern = makeNamed("& Lantern~", TV.LIGHT);
    equip(state, lantern);
    lantern.timeout = 1000;
    const donor = makeNamed("& Lantern~", TV.LIGHT);
    donor.number = 1;
    donor.timeout = 2000;
    const donorHandle = carry(state, donor);

    refillLamp(state, lantern, donor, { handle: donorHandle }, deps);

    expect(lantern.timeout).toBe(1000 + 2000);
    expect(donor.timeout).toBe(0);
    expect(gearGet(state.gear, donorHandle)).toBe(donor);
  });

  it("drops the emptied donor split near the player when the pack is full (upstream's own drop_near breakage roll draws RNG here too)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const deps = makeDeps(state);
    const lantern = makeNamed("& Lantern~", TV.LIGHT);
    equip(state, lantern);
    lantern.timeout = 1000;
    const donor = makeNamed("& Lantern~", TV.LIGHT);
    donor.number = 2;
    donor.timeout = 500;
    const donorHandle = carry(state, donor);

    /* Fill every remaining pack slot with unrelated filler so the split-off
     * empty lantern has nowhere to be carried back to. */
    for (let i = state.gear.pack.length; i < constants.packSize; i++) {
      const filler = makeNamed("& Dagger~", TV.SWORD);
      const h = gearAdd(state.gear, filler);
      state.gear.pack.push(h);
    }

    const before = state.rng.getState();
    refillLamp(state, lantern, donor, { handle: donorHandle }, deps);
    const after = state.rng.getState();

    /* drop_near's breakage check (!artifact && randint0(100) < chance) always
     * draws once, even at chance 0 - a faithful, documented exception to the
     * "no RNG" rule for this rare overflow-only branch. */
    expect(after).not.toEqual(before);
    expect(
      floorPile(state, loc(5, 5)).some(
        (o) => o.tval === TV.LIGHT && o.timeout === 0,
      ),
    ).toBe(true);
  });
});

describe("registered command: refill (cmd-obj.c do_cmd_refill)", () => {
  it("no light equipped: message, no energy", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const msgs: string[] = [];
    const registry = createDefaultRegistry();
    installObjCommands(registry, makeDeps(state, { env: { msg: (t) => msgs.push(t) } }));
    const commands = [{ code: "refill", args: {} }];
    state.nextCommand = () => commands.shift() ?? null;
    const result = processPlayer(state, registry);
    expect(result.energyUsed).toBe(0);
    expect(msgs).toContain("You are not wielding a light.");
  });

  it("a worn torch cannot be refilled", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    equip(state, makeNamed("& Wooden Torch~", TV.LIGHT));
    const msgs: string[] = [];
    const registry = createDefaultRegistry();
    installObjCommands(registry, makeDeps(state, { env: { msg: (t) => msgs.push(t) } }));
    const commands = [{ code: "refill", args: {} }];
    state.nextCommand = () => commands.shift() ?? null;
    const result = processPlayer(state, registry);
    expect(result.energyUsed).toBe(0);
    expect(msgs).toContain("Your light cannot be refilled.");
  });

  it("refuels the worn lantern from a flask and spends half a turn", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const lantern = makeNamed("& Lantern~", TV.LIGHT);
    equip(state, lantern);
    lantern.timeout = 1000;
    const flask = makeNamed("& Flask~ of oil", TV.FLASK);
    const fh = carry(state, flask);
    const registry = createDefaultRegistry();
    installObjCommands(registry, makeDeps(state));
    const commands = [{ code: "refill", args: { handle: fh } }];
    state.nextCommand = () => commands.shift() ?? null;
    const result = processPlayer(state, registry);
    expect(result.energyUsed).toBe(Math.trunc(state.z.moveEnergy / 2));
    expect(lantern.timeout).toBeGreaterThan(1000);
    expect(gearGet(state.gear, fh)).toBeNull();
  });
});

describe("RNG invariance (inscribe/uninscribe/autoinscribe/refill draw no RNG)", () => {
  it("the typical (non-overflow) paths advance state.rng not at all", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const registry = createDefaultRegistry();
    const deps = makeDeps(state);
    installObjCommands(registry, deps);

    const lantern = makeNamed("& Lantern~", TV.LIGHT);
    equip(state, lantern);
    lantern.timeout = 1000;
    const flask = makeNamed("& Flask~ of oil", TV.FLASK);
    const fh = carry(state, flask);
    const dagger = makeNamed("& Dagger~", TV.SWORD);
    const dh = carry(state, dagger);

    const before = state.rng.getState();

    registry.get("inscribe")!(state, {
      code: "inscribe",
      args: { handle: dh, inscription: "@w1" },
    });
    registry.get("uninscribe")!(state, { code: "uninscribe", args: { handle: dh } });
    registry.get("autoinscribe")!(state, { code: "autoinscribe", args: {} });
    registry.get("refill")!(state, { code: "refill", args: { handle: fh } });

    const after = state.rng.getState();
    expect(after).toEqual(before);
  });
});
