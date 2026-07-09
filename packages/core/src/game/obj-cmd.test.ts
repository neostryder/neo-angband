import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants";
import { TMD, TV } from "../generated";
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
import { gearGet, invenCarry } from "./gear";
import { basicPlayerActor } from "./project-cast";
import type { CastContext } from "./project-cast";
import { registerAttackHandlers } from "./effect-attack";
import { registerMonsterHandlers } from "./effect-monster";
import { registerTeleportHandlers } from "./effect-teleport";
import {
  buildObjectEffectChain,
  getUseDeviceChance,
  installObjCommands,
  invenDrop,
  invenTakeoff,
  invenWield,
  numberCharging,
  objNeedsAim,
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
