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
    invenWield(state, h);
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
