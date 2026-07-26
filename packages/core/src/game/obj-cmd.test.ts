import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants";
import { OF, SQUARE, TMD, TV } from "../generated";
import { loc } from "../loc";
import { Rng } from "../rng";
import { EffectRegistry } from "../effects/interpreter";
import { registerCoreHandlers } from "../effects/handlers";
import { ObjRegistry } from "../obj/bind";
import type { ObjPackJson } from "../obj/types";
import { objectPrep } from "../obj/make";
import type { GameObject } from "../obj/object";
import {
  AutoinscriptionRegistry,
  FlavorKnowledge,
  getAutoinscription,
  NOOP_FLAVOR_AWARE_DEPS,
  setAutoinscription,
} from "../obj/knowledge";
import type { FlavorAwareDeps } from "../obj/knowledge";
import { bindProjections } from "../world/projection";
import type { ProjectionRecordJson } from "../world/projection";
import { floorPile } from "./floor";
import {
  gearAdd,
  gearGet,
  invenCarry,
  packIsOverfull,
  packSlotsUsed,
} from "./gear";
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
  objCanActivate,
  objCanRefill,
  objCanWear,
  objCanZap,
  objHasInscrip,
  objIsActivatable,
  objNeedsAim,
  objectEffect,
  refillLamp,
  useAux,
  USE,
} from "./obj-cmd";
import type { ObjCmdDeps } from "./obj-cmd";
import { describeObject } from "./describe";
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

/** The "fox" shape, for the player_get_resume_normal_shape gates. */
const fox = plReg.shapes.find((s) => s.name === "fox")!;

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

    const slot = invenWield(state, h, constants);
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
    const slot = invenWield(state, first, constants);
    expect(invenWield(state, second, constants)).toBe(slot);
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

  it("first identify-by-use grants object_learn_on_use XP (obj-knowledge.c L1925-1936)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const p = state.actor.player;
    p.mhp = 30;
    p.chp = 10;
    const flavor = new FlavorKnowledge(reg.ordinaryKindCount);
    const potion = makeNamed("Cure Light Wounds", TV.POTION);
    const h = carry(state, potion);
    const gains: number[] = [];
    useAux(
      state,
      potion,
      USE.SINGLE,
      makeDeps(state, { flavor, expGain: (n) => gains.push(n) }),
      { handle: h },
    );
    /* player_exp_gain(p, (lev + p->lev / 2) / p->lev), lev = kind level. */
    const expected = Math.trunc(
      (potion.kind.level + Math.trunc(p.lev / 2)) / p.lev,
    );
    expect(gains).toEqual([expected]);
  });

  it("an already-aware use grants no learn-on-use XP", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const p = state.actor.player;
    p.mhp = 30;
    p.chp = 10;
    const flavor = new FlavorKnowledge(reg.ordinaryKindCount);
    const potion = makeNamed("Cure Light Wounds", TV.POTION);
    flavor.objectFlavorAware(potion.kind, NOOP_FLAVOR_AWARE_DEPS);
    const h = carry(state, potion);
    const gains: number[] = [];
    useAux(
      state,
      potion,
      USE.SINGLE,
      makeDeps(state, { flavor, expGain: (n) => gains.push(n) }),
      { handle: h },
    );
    expect(gains).toEqual([]);
  });

  it("becoming aware on use fires the #89 ignore fix via objectFlavorAware", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.actor.player.mhp = 30;
    state.actor.player.chp = 10;
    const flavor = new FlavorKnowledge(reg.ordinaryKindCount);
    const potion = makeNamed("Cure Light Wounds", TV.POTION);
    const h = carry(state, potion);

    const awareIgnored: number[] = [];
    let noticeRequests = 0;
    const flavorDeps: FlavorAwareDeps = {
      isIgnoredUnaware: (kidx) => kidx === potion.kind.kidx,
      ignoreWhenAware: (kidx) => awareIgnored.push(kidx),
      requestIgnoreNotice: () => {
        noticeRequests++;
      },
    };

    useAux(state, potion, USE.SINGLE, makeDeps(state, { flavor, flavorDeps }), {
      handle: h,
    });

    expect(flavor.isAware(potion.kind)).toBe(true);
    /* kind_ignore_when_aware carried the ignore-while-unaware bit over. */
    expect(awareIgnored).toEqual([potion.kind.kidx]);
    expect(noticeRequests).toBe(1);
  });

  it("is RNG-free: the aware-bit/ignore-fix bookkeeping draws no RNG beyond the effect itself", () => {
    /* Two identically-seeded runs, one with flavor+flavorDeps wired and one
     * with no flavor knowledge at all: the effect's own RNG draws are
     * identical either way, so a mismatch would mean the awareness/ignore
     * bookkeeping itself drew from the shared stream. */
    function run(withFlavor: boolean): ReturnType<Rng["getState"]> {
      const state = makeState({ playerGrid: loc(5, 5), seed: 42 });
      state.actor.player.mhp = 30;
      state.actor.player.chp = 10;
      const potion = makeNamed("Cure Light Wounds", TV.POTION);
      const h = carry(state, potion);
      const over: Partial<ObjCmdDeps> = withFlavor
        ? {
            flavor: new FlavorKnowledge(reg.ordinaryKindCount),
            flavorDeps: {
              isIgnoredUnaware: () => true,
              ignoreWhenAware: () => {},
              requestIgnoreNotice: () => {},
            },
          }
        : {};
      useAux(state, potion, USE.SINGLE, makeDeps(state, over), { handle: h });
      return state.rng.getState();
    }

    expect(run(true)).toEqual(run(false));
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

  it("an activation prints its message with {kind}/{s} tag substitution", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    maxDeviceSkill(state);
    const light = makeNamed("& Wooden Torch~", TV.LIGHT);
    /* An activation carrying a tagged message (activation.txt msg:). */
    light.activation = { message: "Your {kind} glow{s} deep red..." } as never;
    const h = carry(state, light);
    const msgs: string[] = [];
    useAux(state, light, USE.TIMEOUT, makeDeps(state, { env: { msg: (t) => msgs.push(t) } }), {
      handle: h,
    });
    expect(msgs).toContain("You activate it.");
    /* {kind} -> "Wooden Torch", {s} -> "s" (single item): no literal braces. */
    const activationLine = msgs.find((m) => m.includes("glow"));
    expect(activationLine).toBe("Your Wooden Torch glows deep red...");
  });

  it("an artifact's alt_msg overrides the activation message (cmd-obj.c L134)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    maxDeviceSkill(state);
    const light = makeNamed("& Wooden Torch~", TV.LIGHT);
    light.activation = { message: "Your {kind} glows." } as never;
    /* Only the alt_msg field of the artifact record matters here. */
    light.artifact = { name: "of Test", altMsg: "The torch blazes with white fire!" } as never;
    const h = carry(state, light);
    const msgs: string[] = [];
    useAux(state, light, USE.TIMEOUT, makeDeps(state, { env: { msg: (t) => msgs.push(t) } }), {
      handle: h,
    });
    expect(msgs).toContain("The torch blazes with white fire!");
    expect(msgs.some((m) => m.includes("glows"))).toBe(false);
  });

  it("runs the ACTIVATION's effect chain in place of the kind's own effect (cmd-obj.c L410 object_effect)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    maxDeviceSkill(state);
    const p = state.actor.player;
    p.mhp = 30;
    p.chp = 10;
    const healEffect = makeNamed("Cure Light Wounds", TV.POTION).effect;
    /* Flames' own kind effect is a FIRE ball + TIMED_INC (needs a target); if
     * use_aux read obj.effect instead of object_effect(obj), it would run
     * THAT chain instead of the activation's heal, and chp would not rise. */
    const ring = makeNamed("Flames", TV.RING);
    ring.activation = { effect: healEffect } as never;
    const h = carry(state, ring);
    useAux(state, ring, USE.TIMEOUT, makeDeps(state), { handle: h });
    expect(p.chp).toBeGreaterThan(10);
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

/**
 * W1-cmdwiz GAP-1/GAP-2: the two gates do_cmd_quaff_potion (cmd-obj.c L917) and
 * do_cmd_read_scroll (cmd-obj.c L739) run BEFORE cmd_get_item.
 */
describe("quaff / read command gates (cmd-obj.c L739 / L917)", () => {
  /** Light the player's grid so player_can_read's no_light check passes. */
  function lightGrid(state: GameState): void {
    state.chunk.sqinfoOn(state.actor.grid, SQUARE.SEEN);
  }

  function readState(): {
    state: GameState;
    handle: number;
    msgs: string[];
    run: () => number;
  } {
    const state = makeState({ playerGrid: loc(5, 5) });
    lightGrid(state);
    const scroll = makeNamed("Light", TV.SCROLL);
    const handle = carry(state, scroll);
    const msgs: string[] = [];
    const registry = createDefaultRegistry();
    installObjCommands(
      registry,
      makeDeps(state, { env: { msg: (t: string) => msgs.push(t) } }),
    );
    const run = (): number =>
      registry.get("read")!(state, { code: "read", args: { handle } });
    return { state, handle, msgs, run };
  }

  it("do_cmd_quaff_potion is gated by player_get_resume_normal_shape (L923)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const p = state.actor.player;
    p.mhp = 30;
    p.chp = 10;
    p.shape = fox;
    const potion = makeNamed("Cure Light Wounds", TV.POTION);
    const h = carry(state, potion);

    const registry = createDefaultRegistry();
    /* A declined "Change back and continue?" must abort the quaff: no heal, no
     * potion consumed, no energy - upstream returns before cmd_get_item. */
    installObjCommands(registry, makeDeps(state, { env: { confirm: () => false } }));
    expect(registry.get("quaff")!(state, { code: "quaff", args: { handle: h } })).toBe(0);
    expect(p.chp).toBe(10);
    expect(gearGet(state.gear, h)).not.toBeNull();
    expect(p.shape).toBe(fox);
  });

  it("do_cmd_eat_food keeps NO shape gate (cmd-obj.c L899)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.actor.player.shape = fox;
    const food = makeNamed("& Ration~ of Food", TV.FOOD);
    const h = carry(state, food);
    const registry = createDefaultRegistry();
    installObjCommands(registry, makeDeps(state, { env: { confirm: () => false } }));
    /* Eating is possible in any form, so the declined prompt is never asked and
     * the food is consumed while still a fox. */
    expect(registry.get("eat")!(state, { code: "eat", args: { handle: h } })).toBe(
      state.z.moveEnergy,
    );
    expect(state.actor.player.shape).toBe(fox);
  });

  it("player_can_read refuses a blind reader with its own message (L1168)", () => {
    const { state, handle, msgs, run } = readState();
    state.actor.player.timed[TMD.BLIND] = 10;
    expect(run()).toBe(0);
    expect(msgs).toContain("You can't see anything.");
    expect(gearGet(state.gear, handle)).not.toBeNull();
  });

  it("player_can_read refuses reading in the dark (no_light, L1173)", () => {
    const { state, handle, msgs, run } = readState();
    /* noLight only trusts SQUARE_SEEN when a host maintains the view, because a
     * core-only host that never installs the seam leaves SEEN clear on every
     * grid and would read as "no light" everywhere. Clearing the flag by hand
     * therefore only models darkness once the seam is present, so install a
     * no-op one: the flag is set explicitly here, nothing needs recomputing. */
    state.updateFov = () => {};
    state.chunk.sqinfoOff(state.actor.grid, SQUARE.SEEN);
    expect(run()).toBe(0);
    expect(msgs).toContain("You have no light to read by.");
    expect(gearGet(state.gear, handle)).not.toBeNull();
  });

  it("player_can_read refuses a confused reader (L1180)", () => {
    const { state, handle, msgs, run } = readState();
    state.actor.player.timed[TMD.CONFUSED] = 10;
    expect(run()).toBe(0);
    expect(msgs).toContain("You are too confused to read!");
    expect(gearGet(state.gear, handle)).not.toBeNull();
  });

  it("player_can_read refuses an amnesiac reader (L1187)", () => {
    const { state, handle, msgs, run } = readState();
    state.actor.player.timed[TMD.AMNESIA] = 10;
    expect(run()).toBe(0);
    expect(msgs).toContain("You can't remember how to read!");
    expect(gearGet(state.gear, handle)).not.toBeNull();
  });

  it("the read gate fires before the item filter, and a lit reader still reads", () => {
    const { state, handle, msgs, run } = readState();
    expect(run()).toBe(state.z.moveEnergy);
    expect(gearGet(state.gear, handle)).toBeNull();
    expect(msgs).not.toContain("You can't see anything.");
  });

  it("a blind reader is refused even with no scroll at all (order: L748 before L750)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    lightGrid(state);
    state.actor.player.timed[TMD.BLIND] = 10;
    const msgs: string[] = [];
    const registry = createDefaultRegistry();
    installObjCommands(
      registry,
      makeDeps(state, { env: { msg: (t: string) => msgs.push(t) } }),
    );
    expect(registry.get("read")!(state, { code: "read", args: {} })).toBe(0);
    expect(msgs).toEqual(["You can't see anything."]);
  });
});

/** Wield `obj` (carrying it first) and return its equipment slot. */
function equip(state: GameState, obj: GameObject): number {
  return invenWield(state, carry(state, obj), constants);
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

describe("eat food (cmd-obj.c do_cmd_eat / use_aux)", () => {
  it("prints the kind's effect_msg on eating (cmd-obj.c:497 obj->kind->effect_msg)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const food = makeNamed("& Handful~ of Dried Fruits", TV.FOOD);
    const h = carry(state, food);
    const msgs: string[] = [];
    const registry = createDefaultRegistry();
    installObjCommands(
      registry,
      makeDeps(state, { env: { msg: (t) => msgs.push(t) } }),
    );

    const commands = [{ code: "eat", args: { handle: h } }];
    state.nextCommand = () => commands.shift() ?? null;
    processPlayer(state, registry);
    /* Regression: use_aux read the always-empty instance obj.effectMsg instead
     * of obj.kind.effectMsg, so this message was silently dropped. */
    expect(msgs).toContain("That tastes good.");
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

describe("AutoinscriptionRegistry (obj-ignore.c note_aware/note_unaware)", () => {
  it("get_autoinscription returns the aware note when aware, else the unaware note", () => {
    const dagger = kindByName("& Dagger~", TV.SWORD);
    const registry = new AutoinscriptionRegistry();
    registry.set(dagger.kidx, "@w1", true);
    registry.set(dagger.kidx, "@x9", false);
    /* obj-ignore.c L233-236: aware -> note_aware, else note_unaware. */
    expect(registry.get(dagger.kidx, true)).toBe("@w1");
    expect(registry.get(dagger.kidx, false)).toBe("@x9");
    /* The free-function form mirrors the same selection. */
    expect(getAutoinscription(registry, dagger.kidx, true)).toBe("@w1");
    expect(getAutoinscription(registry, dagger.kidx, false)).toBe("@x9");
  });

  it("returns undefined for a kind with no registered note", () => {
    const dagger = kindByName("& Dagger~", TV.SWORD);
    const registry = new AutoinscriptionRegistry();
    expect(registry.get(dagger.kidx, true)).toBeUndefined();
    expect(registry.get(dagger.kidx, false)).toBeUndefined();
  });

  it("an empty note clears only that slot (add_autoinscription null path, L327/L294)", () => {
    const dagger = kindByName("& Dagger~", TV.SWORD);
    const registry = new AutoinscriptionRegistry();
    setAutoinscription(registry, dagger.kidx, "@w1", true);
    setAutoinscription(registry, dagger.kidx, "@x9", false);
    setAutoinscription(registry, dagger.kidx, "", true); // clear aware only
    expect(registry.get(dagger.kidx, true)).toBeUndefined();
    expect(registry.get(dagger.kidx, false)).toBe("@x9");
    /* Clearing the last slot drops the kind from entries entirely. */
    setAutoinscription(registry, dagger.kidx, "", false);
    expect(registry.get(dagger.kidx, false)).toBeUndefined();
    expect(registry.entries()).toEqual([]);
  });

  it("clear() removes both slots for a kind", () => {
    const dagger = kindByName("& Dagger~", TV.SWORD);
    const registry = new AutoinscriptionRegistry();
    registry.set(dagger.kidx, "@w1", true);
    registry.set(dagger.kidx, "@x9", false);
    registry.clear(dagger.kidx);
    expect(registry.get(dagger.kidx, true)).toBeUndefined();
    expect(registry.get(dagger.kidx, false)).toBeUndefined();
  });

  it("entries lists every kind with a note (for the management UI)", () => {
    const dagger = kindByName("& Dagger~", TV.SWORD);
    const tulwar = kindByName("& Tulwar~", TV.SWORD);
    const registry = new AutoinscriptionRegistry();
    registry.set(dagger.kidx, "@w1", true);
    registry.set(tulwar.kidx, "@w2", true);
    const map = new Map(registry.entries());
    expect(map.get(dagger.kidx)?.aware).toBe("@w1");
    expect(map.get(tulwar.kidx)?.aware).toBe("@w2");
    expect(map.size).toBe(2);
  });
});

describe("applyAutoinscription wired to a live AutoinscriptionRegistry", () => {
  /** Wire deps.autoNote to a registry exactly as session/game.ts does. */
  function registryDeps(
    state: GameState,
    registry: AutoinscriptionRegistry,
    over: Partial<ObjCmdDeps> = {},
  ): ObjCmdDeps {
    return makeDeps(state, {
      autoNote: (kind, aware) => registry.get(kind.kidx, aware) ?? null,
      ...over,
    });
  }

  it("applies a registered aware note end-to-end to a carried, uninscribed, non-ignored item", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const dagger = makeNamed("& Dagger~", TV.SWORD);
    carry(state, dagger);
    const registry = new AutoinscriptionRegistry();
    registry.set(dagger.kind.kidx, "@w1", true);
    const msgs: string[] = [];
    const deps = registryDeps(state, registry, { env: { msg: (t) => msgs.push(t) } });
    expect(applyAutoinscription(state, dagger, deps)).toBe(1);
    expect(dagger.note).toBe("@w1");
    expect(msgs.some((m) => m.startsWith("You autoinscribe"))).toBe(true);
  });

  it("does not re-inscribe an already-inscribed item", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const dagger = makeNamed("& Dagger~", TV.SWORD);
    dagger.note = "@keep";
    carry(state, dagger);
    const registry = new AutoinscriptionRegistry();
    registry.set(dagger.kind.kidx, "@w1", true);
    expect(applyAutoinscription(state, dagger, registryDeps(state, registry))).toBe(0);
    expect(dagger.note).toBe("@keep");
  });

  it("skips an item that is not carried", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const dagger = makeNamed("& Dagger~", TV.SWORD);
    const registry = new AutoinscriptionRegistry();
    registry.set(dagger.kind.kidx, "@w1", true);
    expect(applyAutoinscription(state, dagger, registryDeps(state, registry))).toBe(0);
    expect(dagger.note).toBeNull();
  });

  it("skips an ignored item (ignore_item_ok)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const dagger = makeNamed("& Dagger~", TV.SWORD);
    carry(state, dagger);
    /* Mark this individual object ignored (OBJ_NOTICE_IGNORE). */
    dagger.notice |= 0x04;
    const registry = new AutoinscriptionRegistry();
    registry.set(dagger.kind.kidx, "@w1", true);
    expect(applyAutoinscription(state, dagger, registryDeps(state, registry))).toBe(0);
    expect(dagger.note).toBeNull();
  });

  it("clears a stale unaware note once the kind becomes aware (registry-backed)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const flavor = new FlavorKnowledge(reg.ordinaryKindCount);
    const potion = makeNamed("Cure Light Wounds", TV.POTION);
    carry(state, potion);
    const registry = new AutoinscriptionRegistry();
    /* An unaware note was applied earlier; only the unaware slot is set. */
    registry.set(potion.kind.kidx, "@q1", false);
    potion.note = "@q1";
    flavor.setAware(potion.kind); // now aware, and there is no aware note
    const deps = registryDeps(state, registry, { flavor });
    expect(applyAutoinscription(state, potion, deps)).toBe(0);
    /* obj-ignore.c L252-256: the stale unaware note is cleared. */
    expect(potion.note).toBeNull();
  });

  it("applies the aware note through the do_cmd_autoinscribe command over the floor + pack", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const dagger = makeNamed("& Dagger~", TV.SWORD);
    const h = carry(state, dagger);
    const registry = new AutoinscriptionRegistry();
    registry.set(dagger.kind.kidx, "@w1", true);
    const cmdRegistry = createDefaultRegistry();
    installObjCommands(cmdRegistry, registryDeps(state, registry));
    const commands = [{ code: "autoinscribe", args: {} }];
    state.nextCommand = () => commands.shift() ?? null;
    processPlayer(state, cmdRegistry);
    expect(gearGet(state.gear, h)?.note).toBe("@w1");
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

describe("faithful item-use messaging (cmd-obj.c / obj-gear.c)", () => {
  function withMsgs(state: GameState): {
    registry: ReturnType<typeof createDefaultRegistry>;
    msgs: string[];
  } {
    const msgs: string[] = [];
    const registry = createDefaultRegistry();
    installObjCommands(
      registry,
      makeDeps(state, { env: { msg: (t) => msgs.push(t) } }),
    );
    return { registry, msgs };
  }

  it("quaffing prints a describe line, never a fabricated 'You quaff' wrapper", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const p = state.actor.player;
    p.mhp = 30;
    p.chp = 10;
    const potion = makeNamed("Cure Light Wounds", TV.POTION);
    potion.number = 5;
    const h = carry(state, potion);
    const { registry, msgs } = withMsgs(state);

    registry.get("quaff")!(state, { code: "quaff", args: { handle: h } });

    /* No invented "You quaff ..." wrapper - upstream never prints one. */
    expect(msgs.every((m) => !m.startsWith("You quaff"))).toBe(true);
    /* The remaining stack is described: "You have <name> (<label>)." */
    expect(msgs.some((m) => /^You have .+\([a-z0-9]\)\.$/.test(m))).toBe(true);
  });

  it("wielding a weapon prints 'You are wielding X (c).'", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const h = carry(state, makeNamed("& Dagger~", TV.SWORD));
    const { registry, msgs } = withMsgs(state);

    registry.get("wield")!(state, { code: "wield", args: { handle: h } });

    expect(
      msgs.some((m) => /^You are wielding .+\([a-z0-9]\)\.$/.test(m)),
    ).toBe(true);
  });

  it("taking off an item prints 'You were wielding X (c).'", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const h = carry(state, makeNamed("& Dagger~", TV.SWORD));
    invenWield(state, h, constants);
    const { registry, msgs } = withMsgs(state);

    registry.get("takeoff")!(state, { code: "takeoff", args: { handle: h } });

    expect(
      msgs.some((m) => /^You were wielding .+\([a-z0-9]\)\.$/.test(m)),
    ).toBe(true);
  });

  it("dropping prints 'You drop X (c).' plus what's left", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const potion = makeNamed("Cure Light Wounds", TV.POTION);
    potion.number = 5;
    const h = carry(state, potion);
    const { registry, msgs } = withMsgs(state);

    registry.get("drop")!(state, {
      code: "drop",
      args: { handle: h, quantity: 2 },
    });

    expect(msgs.some((m) => /^You drop .+\([a-z0-9]\)\.$/.test(m))).toBe(true);
    expect(msgs.some((m) => /^You have .+\([a-z0-9]\)\.$/.test(m))).toBe(true);
  });

  it("a known charge device reports its remaining charges", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    maxDeviceSkill(state);
    const flavor = new FlavorKnowledge(reg.ordinaryKindCount);
    const wand = makeNamed("Magic Missile", TV.WAND);
    wand.pval = 5;
    flavor.objectFlavorAware(wand.kind, NOOP_FLAVOR_AWARE_DEPS);
    const h = carry(state, wand);
    const msgs: string[] = [];
    const registry = createDefaultRegistry();
    installObjCommands(
      registry,
      makeDeps(state, { flavor, env: { msg: (t) => msgs.push(t) } }),
    );

    registry.get("aim-wand")!(state, {
      code: "aim-wand",
      args: { handle: h, dir: 6 },
    });

    expect(
      msgs.some((m) => /^You have \d+ charges? remaining\.$/.test(m)),
    ).toBe(true);
  });
});

describe("pack_overflow is wired into the commands (obj-gear.c L1345 / cmd-obj.c L255)", () => {
  function wired(state: GameState): {
    registry: ReturnType<typeof createDefaultRegistry>;
    msgs: string[];
  } {
    const msgs: string[] = [];
    const registry = createDefaultRegistry();
    installObjCommands(
      registry,
      makeDeps(state, { env: { msg: (t) => msgs.push(t) } }),
    );
    return { registry, msgs };
  }

  /** Occupy every remaining pack slot with mutually un-mergeable potions. */
  function fillPack(state: GameState): void {
    let slots = packSlotsUsed(state.gear, constants);
    while (slots < constants.packSize) {
      const potion = makeNamed("Cure Light Wounds", TV.POTION);
      potion.note = `filler${slots}`; /* distinct notes: object_stackable fails */
      state.gear.pack.push(gearAdd(state.gear, potion));
      slots++;
    }
    expect(packSlotsUsed(state.gear, constants)).toBe(constants.packSize);
  }

  it("do_cmd_wield sheds the displaced item when the pack is full", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const worn = makeNamed("& Dagger~", TV.SWORD);
    const wornHandle = carry(state, worn);
    const slot = invenWield(state, wornHandle, constants);
    expect(slot).toBeGreaterThanOrEqual(0);
    /* A STACK of two, as upstream's overflow fixture does (inven-wield.c L551
     * uses HELM 2 x3): the wield splits one off, so the remainder still holds
     * the pack slot and the displaced dagger has nowhere to go. */
    const replacement = makeNamed("& Tulwar~", TV.SWORD);
    replacement.number = 2;
    const replacementHandle = carry(state, replacement);
    fillPack(state);
    const oldSlots = packSlotsUsed(state.gear, constants);
    expect(oldSlots).toBe(constants.packSize);
    const { registry, msgs } = wired(state);
    const dropName = describeObject(state, worn);

    const used = registry.get("wield")!(state, {
      code: "wield",
      args: { handle: replacementHandle },
    });

    /* A real turn was spent (z_info->move_energy, obj-gear.c L941). */
    expect(used).toBe(state.z.moveEnergy);
    /* A Tulwar split off the pair is worn; the remainder keeps its slot. */
    const wornNow = gearGet(state.gear, state.actor.player.equipment[slot]!);
    expect(wornNow!.kind).toBe(replacement.kind);
    expect(wornNow!.number).toBe(1);
    expect(wornNow).not.toBe(replacement);
    expect(replacement.number).toBe(1);
    expect(state.gear.pack).toContain(replacementHandle);
    /* The Dagger is on the floor and gone from the gear
     * (obj-gear.c L1379-1380 gear_excise_object + drop_near). */
    expect(gearGet(state.gear, wornHandle)).toBeNull();
    expect(state.gear.pack).not.toContain(wornHandle);
    expect(floorPile(state, state.actor.grid)).toEqual([worn]);
    /* One shed: back to pack_size, not one over (L1337-1340). */
    expect(packSlotsUsed(state.gear, constants)).toBe(oldSlots);
    expect(packIsOverfull(state.gear, constants)).toBe(false);
    /* Upstream order: inven_wield's MSG_WIELD line, then pack_overflow's three
     * (L1005, L1356, L1377, L1383), then do_cmd_wield's take-off line last
     * (cmd-obj.c L350-351). Its %c is gear_to_label of an object that is no
     * longer held, which upstream renders from '\0' - the port's gearLabelFor
     * gives "" for the same reason, hence the empty parentheses. */
    expect(msgs).toEqual([
      `You are wielding ${describeObject(state, wornNow!)} (a).`,
      "Your pack overflows!",
      `You drop ${dropName}.`,
      `You no longer have ${dropName}.`,
      `You were wielding ${dropName} ().`,
    ]);
  });

  it("do_cmd_takeoff sheds the item it just took off when the pack is full", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const worn = makeNamed("& Dagger~", TV.SWORD);
    const wornHandle = carry(state, worn);
    expect(invenWield(state, wornHandle, constants)).toBeGreaterThanOrEqual(0);
    fillPack(state);
    const oldSlots = packSlotsUsed(state.gear, constants);
    const { registry, msgs } = wired(state);
    const dropName = describeObject(state, worn);

    const used = registry.get("takeoff")!(state, {
      code: "takeoff",
      args: { handle: wornHandle },
    });

    expect(used).toBe(Math.trunc(state.z.moveEnergy / 2));
    /* Taking it off would put the pack one over, so pack_overflow drops it
     * again (cmd-obj.c L255-257 inven_takeoff / combine_pack / pack_overflow). */
    expect(gearGet(state.gear, wornHandle)).toBeNull();
    expect(floorPile(state, state.actor.grid)).toEqual([worn]);
    expect(packSlotsUsed(state.gear, constants)).toBe(oldSlots);
    expect(packIsOverfull(state.gear, constants)).toBe(false);
    /* inven_takeoff's own line first, naming the dagger at the pack label it
     * briefly held (whichever letter that is - gear_to_label's alphabet is
     * covered by its own tests), then pack_overflow's three. */
    expect(msgs[0]!.startsWith(`You were wielding ${dropName} (`)).toBe(true);
    expect(msgs[0]!.endsWith(").")).toBe(true);
    expect(msgs.slice(1)).toEqual([
      "Your pack overflows!",
      `You drop ${dropName}.`,
      `You no longer have ${dropName}.`,
    ]);
  });

  it("leaves a pack with room alone", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const worn = makeNamed("& Dagger~", TV.SWORD);
    const wornHandle = carry(state, worn);
    expect(invenWield(state, wornHandle, constants)).toBeGreaterThanOrEqual(0);
    const { registry, msgs } = wired(state);

    registry.get("takeoff")!(state, {
      code: "takeoff",
      args: { handle: wornHandle },
    });

    /* pack_is_overfull is false, so pack_overflow returns at once (L1350). */
    expect(state.gear.pack).toContain(wornHandle);
    expect(floorPile(state, state.actor.grid)).toHaveLength(0);
    expect(msgs.some((m) => m === "Your pack overflows!")).toBe(false);
  });
});

describe("OF_STICKY enforcement (obj-util.c:794 obj_can_takeoff)", () => {
  /*
   * The predicate existed (store/transact.ts, the throw filter, best-digger) but
   * the three paths that matter never used it, so sticky cursed equipment -- The
   * One Ring included -- could be dropped or replaced by wielding over it. The
   * curse mechanic was defeated outright, and the wear-time "It feels deathly
   * cold!" message being present is what made it easy to miss by reading.
   *
   * These go through the registered commands rather than the predicate, because a
   * test that calls the predicate is exactly what let the gap survive.
   */
  const equipArmour = (state: GameState, sticky: boolean): number => {
    const armour = makeNamed("Soft Leather Armour~", TV.SOFT_ARMOR);
    if (sticky) armour.flags.on(OF.STICKY);
    const h = carry(state, armour);
    const registry = createDefaultRegistry();
    installObjCommands(registry, makeDeps(state));
    const commands = [{ code: "wield", args: { handle: h } }];
    state.nextCommand = () => commands.shift() ?? null;
    processPlayer(state, registry);
    expect(state.actor.player.equipment, "fixture failed to equip").toContain(h);
    return h;
  };

  it("refuses to drop stickied equipment and spends no energy (cmd-obj.c:377-381)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const h = equipArmour(state, true);
    const msgs: string[] = [];
    const registry = createDefaultRegistry();
    installObjCommands(registry, makeDeps(state, { env: { msg: (t) => msgs.push(t) } }));
    const commands = [{ code: "drop", args: { handle: h, quantity: 1 } }];
    state.nextCommand = () => commands.shift() ?? null;

    expect(processPlayer(state, registry).energyUsed).toBe(0);
    expect(msgs).toContain("Hmmm, it seems to be stuck.");
    expect(state.actor.player.equipment).toContain(h);
  });

  it("refuses to take off stickied equipment and spends no energy (cmd-obj.c:251)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const h = equipArmour(state, true);
    const registry = createDefaultRegistry();
    installObjCommands(registry, makeDeps(state));
    const commands = [{ code: "takeoff", args: { handle: h } }];
    state.nextCommand = () => commands.shift() ?? null;

    expect(processPlayer(state, registry).energyUsed).toBe(0);
    expect(state.actor.player.equipment).toContain(h);
  });

  it("drops non-sticky equipment normally", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const h = equipArmour(state, false);
    const msgs: string[] = [];
    const registry = createDefaultRegistry();
    installObjCommands(registry, makeDeps(state, { env: { msg: (t) => msgs.push(t) } }));
    const commands = [{ code: "drop", args: { handle: h, quantity: 1 } }];
    state.nextCommand = () => commands.shift() ?? null;

    processPlayer(state, registry);
    expect(msgs.join("|")).not.toContain("stuck");
    expect(state.actor.player.equipment).not.toContain(h);
  });

  it("refuses to wield over a stickied slot (cmd-obj.c:313-320)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    equipArmour(state, true);
    const replacement = carry(state, makeNamed("Soft Leather Armour~", TV.SOFT_ARMOR));
    const msgs: string[] = [];
    const registry = createDefaultRegistry();
    installObjCommands(registry, makeDeps(state, { env: { msg: (t) => msgs.push(t) } }));
    const commands = [{ code: "wield", args: { handle: replacement } }];
    state.nextCommand = () => commands.shift() ?? null;

    expect(processPlayer(state, registry).energyUsed).toBe(0);
    expect(msgs.join("|")).toContain("You cannot remove the");
    expect(state.gear.pack).toContain(replacement);
  });
});

/**
 * player_can_read (player-util.c L1166) on the live read path. Upstream gates
 * do_cmd_read_scroll (cmd-obj.c:748) and the 'r' key's prereq (ui-game.c:131)
 * on it; before this was wired a blind / lightless / confused / amnesiac player
 * could read scrolls freely.
 */
describe("player_can_read gates the read command (player-util.c L1166)", () => {
  /** A state whose host maintains SQUARE_SEEN, so no_light is meaningful. */
  function litState(): GameState {
    const state = makeState({ playerGrid: loc(5, 5) });
    /* Installing the seam is what makes obj-cmd's noLight read the flag. */
    state.updateFov = (): void => {};
    state.chunk.sqinfoOn(state.actor.grid, SQUARE["SEEN"]);
    return state;
  }

  function readScroll(
    state: GameState,
    msgs: string[],
  ): { energyUsed: number; handle: number } {
    const scroll = makeNamed("Word of Recall", TV.SCROLL);
    const handle = carry(state, scroll);
    const registry = createDefaultRegistry();
    installObjCommands(
      registry,
      makeDeps(state, { env: { msg: (t) => msgs.push(t) } }),
    );
    const commands = [{ code: "read", args: { handle } }];
    state.nextCommand = () => commands.shift() ?? null;
    return { energyUsed: processPlayer(state, registry).energyUsed, handle };
  }

  it("blindness blocks it with 'You can't see anything.' and costs no turn", () => {
    const state = litState();
    state.actor.player.timed[TMD.BLIND] = 10;
    const msgs: string[] = [];
    const { energyUsed, handle } = readScroll(state, msgs);
    expect(energyUsed).toBe(0);
    expect(msgs).toContain("You can't see anything.");
    /* The scroll is still in the pack: nothing was consumed. */
    expect(gearGet(state.gear, handle)).not.toBeNull();
  });

  it("no_light reports 'You have no light to read by.', not the blind line", () => {
    const state = litState();
    /* Clear SQUARE_SEEN on the player's grid: no_light, but not blind. */
    state.chunk.sqinfoOff(state.actor.grid, SQUARE["SEEN"]);
    const msgs: string[] = [];
    expect(readScroll(state, msgs).energyUsed).toBe(0);
    expect(msgs).toContain("You have no light to read by.");
    expect(msgs).not.toContain("You can't see anything.");
  });

  it("blindness is reported BEFORE no_light (upstream check order)", () => {
    const state = litState();
    state.chunk.sqinfoOff(state.actor.grid, SQUARE["SEEN"]);
    state.actor.player.timed[TMD.BLIND] = 10;
    const msgs: string[] = [];
    readScroll(state, msgs);
    expect(msgs[0]).toBe("You can't see anything.");
  });

  it("confusion blocks it with reading's own wording, after the sight checks", () => {
    const state = litState();
    state.actor.player.timed[TMD.CONFUSED] = 10;
    const msgs: string[] = [];
    expect(readScroll(state, msgs).energyUsed).toBe(0);
    /* NOT player_can_cast's "You are too confused!" (player-util.c:1105). */
    expect(msgs).toContain("You are too confused to read!");
    expect(msgs).not.toContain("You are too confused!");
  });

  it("TMD_AMNESIA blocks it - a check casting has no equivalent of", () => {
    const state = litState();
    state.actor.player.timed[TMD.AMNESIA] = 10;
    const msgs: string[] = [];
    expect(readScroll(state, msgs).energyUsed).toBe(0);
    expect(msgs).toContain("You can't remember how to read!");
  });

  it("an unafflicted reader on a seen grid still reads normally", () => {
    const state = litState();
    const msgs: string[] = [];
    const { energyUsed, handle } = readScroll(state, msgs);
    expect(energyUsed).toBe(state.z.moveEnergy);
    expect(msgs.join("|")).not.toContain("read");
    /* Single-use: the scroll is gone. */
    expect(gearGet(state.gear, handle)).toBeNull();
  });

  it("without the updateFov seam no_light cannot fire (core-only hosts)", () => {
    /* makeState installs no seam and openField leaves SEEN clear everywhere;
     * reading the flag there would forbid all reading. */
    const state = makeState({ playerGrid: loc(5, 5) });
    const msgs: string[] = [];
    expect(readScroll(state, msgs).energyUsed).toBe(state.z.moveEnergy);
    expect(msgs).not.toContain("You have no light to read by.");
  });
});

describe("object_effect / obj_is_activatable / obj_can_activate (obj-util.c L886/721/730)", () => {
  it("objectEffect prefers the activation's effect over the kind's own effect", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const ring = makeNamed("Flames", TV.RING);
    expect(ring.effect).not.toBeNull();
    expect(ring.activation).toBeNull();
    /* Give it an activation too: objectEffect must return THIS, not ring.effect. */
    const activationEffect = [{ eff: "CURE_LIGHT_WOUNDS" }] as never;
    ring.activation = { effect: activationEffect } as never;
    expect(objectEffect(ring)).toBe(activationEffect);
    expect(objectEffect(ring)).not.toBe(ring.effect);
  });

  it("objectEffect falls back to the kind effect when there is no activation", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const ring = makeNamed("Flames", TV.RING);
    expect(objectEffect(ring)).toBe(ring.effect);
  });

  it("a ring with a kind effect and no activation IS activatable (rings of Flames/Acid/...)", () => {
    const ring = makeNamed("Flames", TV.RING);
    expect(ring.activation).toBeNull();
    expect(ring.effect).not.toBeNull();
    expect(objIsActivatable(ring)).toBe(true);
  });

  it("a non-wearable object with an effect (a potion) is NOT activatable", () => {
    const potion = makeNamed("Cure Light Wounds", TV.POTION);
    expect(potion.effect).not.toBeNull();
    expect(objIsActivatable(potion)).toBe(false);
  });

  it("objCanActivate is gated on the timeout, not on tvalCanHaveTimeout (which is rod-only)", () => {
    const ring = makeNamed("Flames", TV.RING);
    expect(ring.timeout).toBe(0);
    expect(objCanActivate(ring)).toBe(true);
    ring.timeout = 5;
    expect(objCanActivate(ring)).toBe(false);
  });

  it("objCanZap requires a rod tval and cannot stand in for objCanActivate", () => {
    const ring = makeNamed("Flames", TV.RING);
    /* This is the exact bug the WIP fixed: objCanZap always rejects a ring. */
    expect(objCanZap(ring)).toBe(false);
    expect(objCanActivate(ring)).toBe(true);
  });
});

describe("obj_can_wear (obj-util.c L810): wield_slot(obj) >= 0", () => {
  it("matches wieldSlot's own verdict for a wearable and a non-wearable tval", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const sword = makeNamed("& Dagger~", TV.SWORD);
    expect(objCanWear(state, sword)).toBe(true);
    const potion = makeNamed("Cure Light Wounds", TV.POTION);
    expect(objCanWear(state, potion)).toBe(false);
  });
});

describe("registered command: activate (cmd-obj.c do_cmd_activate)", () => {
  it("activates a ring with a kind effect and no `act:` (regression: objCanZap wrongly blocked this)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const ring = makeNamed("Flames", TV.RING);
    const h = carry(state, ring);
    invenWield(state, h, constants);
    const registry = createDefaultRegistry();
    const msgs: string[] = [];
    installObjCommands(registry, makeDeps(state, { env: { msg: (t) => msgs.push(t) } }));
    const commands = [{ code: "activate", args: { handle: h } }];
    state.nextCommand = () => commands.shift() ?? null;
    const result = processPlayer(state, registry);
    expect(result.energyUsed).toBe(state.z.moveEnergy);
    expect(msgs).not.toContain("That item is still charging.");
    expect(ring.timeout).toBeGreaterThan(0);
  });

  it("refuses to re-activate a ring still recharging, with activation's own wording", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const ring = makeNamed("Flames", TV.RING);
    ring.timeout = 50;
    const h = carry(state, ring);
    invenWield(state, h, constants);
    const registry = createDefaultRegistry();
    const msgs: string[] = [];
    installObjCommands(registry, makeDeps(state, { env: { msg: (t) => msgs.push(t) } }));
    const commands = [{ code: "activate", args: { handle: h } }];
    state.nextCommand = () => commands.shift() ?? null;
    const result = processPlayer(state, registry);
    expect(result.energyUsed).toBe(0);
    expect(msgs).toContain("That item is still charging.");
  });
});

describe("registered command: zap-rod (cmd-obj.c do_cmd_zap_rod)", () => {
  it("still uses the rod's own still-charging wording", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    maxDeviceSkill(state);
    const rod = makeNamed("Treasure Location", TV.ROD);
    rod.timeout = 50;
    const h = carry(state, rod);
    const registry = createDefaultRegistry();
    const msgs: string[] = [];
    installObjCommands(registry, makeDeps(state, { env: { msg: (t) => msgs.push(t) } }));
    const commands = [{ code: "zap-rod", args: { handle: h } }];
    state.nextCommand = () => commands.shift() ?? null;
    const result = processPlayer(state, registry);
    expect(result.energyUsed).toBe(0);
    expect(msgs).toContain("That rod is still charging.");
  });
});
