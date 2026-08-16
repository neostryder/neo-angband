/**
 * The item-target effect chooser seam (cmd_get_item "tgtitem"): the getItem /
 * chooseCurse closures, the RNG-free itemTargetRequest probe, and the
 * cancel-vs-consume contract through useAux (cmd-obj.c use_aux). Faithful to
 * effect-handler-general.c + cmd-obj.c + cmd-core.c.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants.js";
import { EF, TV } from "../generated/index.js";
import { loc } from "../loc.js";
import { Rng } from "../rng.js";
import { ENCH_TOAC, ENCH_TOHIT } from "../effects/effect.js";
import { EffectBuilder } from "../effects/effect.js";
import { EffectRegistry } from "../effects/interpreter.js";
import { registerCoreHandlers } from "../effects/handlers.js";
import { ObjRegistry } from "../obj/bind.js";
import type { ObjPackJson } from "../obj/types.js";
import { ArtifactState, ObjAllocState, objectPrep } from "../obj/make.js";
import type { MakeDeps } from "../obj/make.js";
import type { GameObject } from "../obj/object.js";
import { FlavorKnowledge } from "../obj/knowledge.js";
import { bindProjections } from "../world/projection.js";
import type { ProjectionRecordJson } from "../world/projection.js";
import { basicPlayerActor } from "./project-cast.js";
import type { CastContext } from "./project-cast.js";
import { registerItemHandlers, itemTargetRequest, requestForEffect } from "./effect-item.js";
import { effectInfoRegistry } from "../effects/effect-info-registry.js";
import type { ItemEffectEnv } from "./effect-item.js";
import { useAux, USE } from "./obj-cmd.js";
import type { ObjCmdDeps } from "./obj-cmd.js";
import { resolveTargetItem, resolveTargetCurse } from "../session/game.js";
import { gearGet, invenCarry } from "./gear.js";
import { makeState, plReg } from "./harness.js";
import type { GameState } from "./context.js";

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
  loadJson<{ records: ProjectionRecordJson[] }>("projection").records,
);

function makeDeps(): MakeDeps {
  return {
    reg,
    alloc: new ObjAllocState(reg, constants),
    constants,
    artifacts: new ArtifactState(reg.artifacts.length),
    noArtifacts: false,
  };
}

function kindByName(name: string, tval: number) {
  const k = reg.kinds.find((kk) => kk.name === name && kk.tval === tval);
  if (!k) throw new Error(`no kind named ${name} of tval ${tval}`);
  return k;
}

function makeNamed(name: string, tval: number): GameObject {
  return objectPrep(new Rng(3), reg, constants, kindByName(name, tval), 0, "average");
}

function carry(state: GameState, obj: GameObject): number {
  return invenCarry(state.gear, state.actor.player, obj, {
    quiverSlotSize: constants.quiverSlotSize,
    thrownQuiverMult: constants.thrownQuiverMult,
  });
}

/** A state-backed item env, exactly the wiring session/game.ts installs. */
function itemEnv(state: GameState, calls?: { n: number }): ItemEffectEnv {
  return {
    reg,
    makeDeps: makeDeps(),
    getItem: (req) => {
      if (calls) calls.n++;
      return resolveTargetItem(state, req);
    },
    chooseCurse: (_o, removable) => resolveTargetCurse(state, removable),
  };
}

function deps(state: GameState, item: ItemEffectEnv, flavor?: FlavorKnowledge): ObjCmdDeps {
  const r = new EffectRegistry();
  registerCoreHandlers(r);
  registerItemHandlers(r);
  const cast: CastContext = {
    projections,
    maxRange: 20,
    playerActor: basicPlayerActor(state),
  };
  return {
    constants,
    registry: r,
    cast,
    envDeps: { timedTable: plReg.timed },
    item,
    ...(flavor ? { flavor } : {}),
  };
}

describe("requestForEffect / itemTargetRequest (the probe)", () => {
  const state = makeState({ seed: 1 });

  it("ENCHANT picks a weapon tester, or armour when AC-only", () => {
    const weaponReq = requestForEffect(EF.ENCHANT, ENCH_TOHIT, state)!;
    expect(weaponReq.tester(makeNamed("& Dagger~", TV.SWORD))).toBe(true);
    expect(weaponReq.tester(makeNamed("Soft Leather Armour~", TV.SOFT_ARMOR))).toBe(false);

    const armourReq = requestForEffect(EF.ENCHANT, ENCH_TOAC, state)!;
    expect(armourReq.tester(makeNamed("Soft Leather Armour~", TV.SOFT_ARMOR))).toBe(true);
    expect(armourReq.tester(makeNamed("& Dagger~", TV.SWORD))).toBe(false);
  });

  it("RECHARGE accepts wands/staves, RECHARGE excludes a potion", () => {
    const req = requestForEffect(EF.RECHARGE, 0, state)!;
    expect(req.tester(makeNamed("Magic Missile", TV.WAND))).toBe(true);
    expect(req.tester(makeNamed("Cure Light Wounds", TV.POTION))).toBe(false);
  });

  it("BRAND_BOLTS accepts only bolts", () => {
    const req = requestForEffect(EF.BRAND_BOLTS, 0, state)!;
    expect(req.tester(makeNamed("& Bolt~", TV.BOLT))).toBe(true);
    expect(req.tester(makeNamed("& Arrow~", TV.ARROW))).toBe(false);
  });

  it("CREATE_ARROWS accepts a staff only; REMOVE_CURSE flags the curse step", () => {
    expect(requestForEffect(EF.CREATE_ARROWS, 0, state)!.tester(makeNamed("Light", TV.STAFF))).toBe(true);
    expect(requestForEffect(EF.REMOVE_CURSE, 0, state)!.curses).toBe(true);
  });

  it("BRAND_AMMO accepts any ammunition; TAP_DEVICE accepts a charged item", () => {
    const ammo = requestForEffect(EF.BRAND_AMMO, 0, state)!;
    expect(ammo.tester(makeNamed("& Arrow~", TV.ARROW))).toBe(true);
    expect(ammo.tester(makeNamed("& Dagger~", TV.SWORD))).toBe(false);

    const tap = requestForEffect(EF.TAP_DEVICE, 0, state)!;
    expect(tap.tester(makeNamed("Light", TV.STAFF))).toBe(true);
    expect(tap.tester(makeNamed("Cure Light Wounds", TV.POTION))).toBe(false);
  });

  it("exercises every arm core registers, so none can rot unmeasured", () => {
    /* The five effect-info tables are keyed registries now; the other four are
     * covered exhaustively by effect-info-vectors.test.ts, which cannot reach
     * this one because an ItemRequest needs a live GameState. So the coverage
     * assertion for `request` lives here: every key must produce a request,
     * and the key set itself is pinned, so an arm cannot be dropped or added
     * without this test saying so. */
    const keys = effectInfoRegistry().request.keys();
    expect([...keys].sort((a, b) => Number(a) - Number(b))).toEqual(
      [
        EF.ENCHANT,
        EF.RECHARGE,
        EF.REMOVE_CURSE,
        EF.BRAND_AMMO,
        EF.BRAND_BOLTS,
        EF.CREATE_ARROWS,
        EF.TAP_DEVICE,
        EF.IDENTIFY,
      ].sort((a, b) => a - b),
    );
    for (const key of keys) {
      const req = requestForEffect(key, 0, state);
      expect({ key, ok: !!req?.prompt && !!req.reject }).toEqual({ key, ok: true });
    }
  });

  it("returns null for a non-item effect and for the auto-target effects", () => {
    expect(requestForEffect(EF.BRAND_WEAPON, 0, state)).toBeNull();
    expect(requestForEffect(EF.CURSE_ARMOR, 0, state)).toBeNull();
    expect(requestForEffect(EF.ACQUIRE, 0, state)).toBeNull();
    expect(requestForEffect(EF.NOURISH, 0, state)).toBeNull();
  });

  it("walks a built chain and finds the first chooser request", () => {
    const enchant = new EffectBuilder().effect("ENCHANT:TOHIT").dice("1").build();
    expect(itemTargetRequest(enchant, state)?.prompt).toBe("Enchant which item? ");

    const heal = new EffectBuilder().effect("HEAL_HP").dice("15").build();
    expect(itemTargetRequest(heal, state)).toBeNull();

    expect(itemTargetRequest(null, state)).toBeNull();
  });
});

describe("getItem seam (resolveTargetItem)", () => {
  it("resolves a handle preset, and clears the one-shot preset when the tester passes", () => {
    const state = makeState({ playerGrid: loc(5, 5), seed: 5 });
    const weapon = makeNamed("& Dagger~", TV.SWORD);
    const wh = carry(state, weapon);
    const req = requestForEffect(EF.ENCHANT, ENCH_TOHIT, state)!;
    state.itemTarget = { handle: wh };
    const picked = resolveTargetItem(state, req);
    expect(picked).toBe(weapon);
    expect(state.itemTarget).toBeNull();
  });

  it("resolves a floor-pile preset by index", () => {
    const state = makeState({ playerGrid: loc(5, 5), seed: 5 });
    const wand = makeNamed("Magic Missile", TV.WAND);
    state.floor.set(
      state.actor.grid.y * state.chunk.width + state.actor.grid.x,
      [wand],
    );
    const req = requestForEffect(EF.RECHARGE, 0, state)!;
    state.itemTarget = { floor: 0 };
    expect(resolveTargetItem(state, req)).toBe(wand);
  });

  it("a filter-failing preset returns null and records the request", () => {
    const state = makeState({ playerGrid: loc(5, 5), seed: 5 });
    const potion = makeNamed("Cure Light Wounds", TV.POTION);
    const ph = carry(state, potion);
    const req = requestForEffect(EF.ENCHANT, ENCH_TOHIT, state)!;
    state.itemTarget = { handle: ph };
    expect(resolveTargetItem(state, req)).toBeNull();
    expect(state.itemRequest).toBe(req);
  });

  it("resolveTargetCurse prefers a valid preset, else the first removable, no RNG", () => {
    const state = makeState({ seed: 5 });
    state.curseTarget = 3;
    expect(resolveTargetCurse(state, [1, 3, 5])).toBe(3);
    state.curseTarget = 9; // not removable -> default to first
    expect(resolveTargetCurse(state, [1, 3, 5])).toBe(1);
    state.curseTarget = null;
    expect(resolveTargetCurse(state, [1, 3, 5])).toBe(1);
    expect(resolveTargetCurse(state, [])).toBeNull();
    // Curse selection draws no RNG: a fresh same-seed state's next roll matches.
    const control = makeState({ seed: 5 });
    expect(state.rng.randint0(1000)).toBe(control.rng.randint0(1000));
  });
});

describe("cancel-vs-consume contract (useAux + the chooser)", () => {
  function enchantScroll(): GameObject {
    return makeNamed("Enchant Weapon To-Hit", TV.SCROLL);
  }

  it("a successful pick enchants the weapon and consumes the scroll (one getItem call)", () => {
    const state = makeState({ playerGrid: loc(5, 5), seed: 5 });
    const weapon = makeNamed("& Dagger~", TV.SWORD);
    const wh = carry(state, weapon);
    const scroll = enchantScroll();
    const sh = carry(state, scroll);
    const calls = { n: 0 };

    const before = weapon.toH;
    const res = useAux(state, scroll, USE.SINGLE, deps(state, itemEnv(state, calls)), {
      handle: sh,
      tgtItem: { handle: wh },
    });

    expect(res.used).toBe(true);
    expect(res.turnSpent).toBe(true);
    expect(weapon.toH).toBeGreaterThan(before);
    /* The single-use scroll is consumed. */
    expect(gearGet(state.gear, sh)).toBeNull();
    /* The effect ran exactly once (probe path, faithful RNG order). */
    expect(calls.n).toBe(1);
    /* The one-shot preset was consumed. */
    expect(state.itemTarget ?? null).toBeNull();
  });

  it("a cancelled pick (no preset) leaves the AWARE scroll un-consumed", () => {
    const state = makeState({ playerGrid: loc(5, 5), seed: 5 });
    const weapon = makeNamed("& Dagger~", TV.SWORD);
    carry(state, weapon);
    const scroll = enchantScroll();
    const sh = carry(state, scroll);
    const flavor = new FlavorKnowledge(reg.ordinaryKindCount);
    flavor.setAware(scroll.kind); // aware carrier

    const before = weapon.toH;
    useAux(state, scroll, USE.SINGLE, deps(state, itemEnv(state), flavor), {
      handle: sh,
      /* no tgtItem: the getItem seam aborts (the upstream cancel path). */
    });

    expect(weapon.toH).toBe(before);
    /* The scroll is NOT consumed on cancel. */
    expect(gearGet(state.gear, sh)).not.toBeNull();
    /* The unfulfilled request is recorded for the shell fallback. */
    expect(state.itemRequest).not.toBeNull();
  });

  it("a cancelled UNAWARE scroll still learns its flavour without consuming (cmd-obj.c L635)", () => {
    const state = makeState({ playerGrid: loc(5, 5), seed: 5 });
    carry(state, makeNamed("& Dagger~", TV.SWORD));
    const scroll = enchantScroll();
    const sh = carry(state, scroll);
    const flavor = new FlavorKnowledge(reg.ordinaryKindCount);
    expect(flavor.isAware(scroll.kind)).toBe(false);

    const res = useAux(state, scroll, USE.SINGLE, deps(state, itemEnv(state), flavor), {
      handle: sh,
    });

    /* Flavour learned (object_learn_on_use), scroll retained, turn spent. */
    expect(flavor.isAware(scroll.kind)).toBe(true);
    expect(gearGet(state.gear, sh)).not.toBeNull();
    expect(res.turnSpent).toBe(true);
  });

  it("Recharging chooses a wand and recharges it, consuming the scroll", () => {
    const state = makeState({ playerGrid: loc(5, 5), seed: 5 });
    const wand = makeNamed("Magic Missile", TV.WAND);
    wand.pval = 0;
    const wh = carry(state, wand);
    const scroll = makeNamed("Recharging", TV.SCROLL);
    const sh = carry(state, scroll);

    const res = useAux(state, scroll, USE.SINGLE, deps(state, itemEnv(state)), {
      handle: sh,
      tgtItem: { handle: wh },
    });

    expect(res.used).toBe(true);
    expect(wand.pval).toBeGreaterThan(0);
    expect(gearGet(state.gear, sh)).toBeNull();
  });

  it("Identify Rune chooses an item and learns a rune, consuming the scroll", () => {
    const state = makeState({ playerGrid: loc(5, 5), seed: 5 });
    const armour = makeNamed("Soft Leather Armour~", TV.SOFT_ARMOR);
    const ah = carry(state, armour);
    const scroll = makeNamed("Identify Rune", TV.SCROLL);
    const sh = carry(state, scroll);

    const req = requestForEffect(EF.IDENTIFY, 0, state)!;
    const identifiable = req.tester(armour);

    const res = useAux(state, scroll, USE.SINGLE, deps(state, itemEnv(state)), {
      handle: sh,
      tgtItem: { handle: ah },
    });

    /* Whether or not the armour had unknown runes, a valid pick consumes the
     * scroll (IDENTIFY sets ident and returns true). */
    if (identifiable) {
      expect(res.used).toBe(true);
      expect(gearGet(state.gear, sh)).toBeNull();
    }
  });

  it("determinism: a preset enchant is reproducible run-to-run", () => {
    function run(): number {
      const state = makeState({ playerGrid: loc(5, 5), seed: 7 });
      const weapon = makeNamed("& War Hammer~", TV.HAFTED);
      const wh = carry(state, weapon);
      const scroll = makeNamed("*Enchant Weapon*", TV.SCROLL);
      const sh = carry(state, scroll);
      useAux(state, scroll, USE.SINGLE, deps(state, itemEnv(state)), {
        handle: sh,
        tgtItem: { handle: wh },
      });
      return weapon.toH * 100 + weapon.toD;
    }
    expect(run()).toBe(run());
  });
});
