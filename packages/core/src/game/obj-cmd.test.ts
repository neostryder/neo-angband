import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants.js";
import { OF, SQUARE, TMD, TV } from "../generated/index.js";
import { loc } from "../loc.js";
import { Rng } from "../rng.js";
import { EffectRegistry } from "../effects/interpreter.js";
import { registerCoreHandlers } from "../effects/handlers.js";
import { ObjRegistry } from "../obj/bind.js";
import type { EffectRecordJson, ObjPackJson } from "../obj/types.js";
import { objectPrep } from "../obj/make.js";
import type { GameObject } from "../obj/object.js";
import {
  AutoinscriptionRegistry,
  FlavorKnowledge,
  getAutoinscription,
  NOOP_FLAVOR_AWARE_DEPS,
  RuneNoteRegistry,
  setAutoinscription,
} from "../obj/knowledge.js";
import type { FlavorAwareDeps } from "../obj/knowledge.js";
import { bindProjections } from "../world/projection.js";
import type { ProjectionRecordJson } from "../world/projection.js";
import { floorCarry, floorPile } from "./floor.js";
import {
  gearAdd,
  gearGet,
  calcInventory,
  invenCarry,
  packIsOverfull,
  packSlotsUsed,
  wieldSlot,
} from "./gear.js";
import { basicPlayerActor } from "./project-cast.js";
import type { CastContext } from "./project-cast.js";
import { registerAttackHandlers } from "./effect-attack.js";
import { registerMonsterHandlers } from "./effect-monster.js";
import { registerTeleportHandlers } from "./effect-teleport.js";
import {
  applyAutoinscription,
  autoinscribeGround,
  autoinscribePack,
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
  runeAutoinscribe,
  packOverflow,
  useAux,
  USE,
  wieldRingChoice,
  wieldTakeoffConfirm,
} from "./obj-cmd.js";
import type { ObjCmdDeps } from "./obj-cmd.js";
import { describeObject } from "./describe.js";
import { ODESC } from "../obj/desc.js";
import { createDefaultRegistry, processPlayer } from "./player-turn.js";
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
  const handle = invenCarry(state.gear, state.actor.player, obj, {
    quiverSlotSize: constants.quiverSlotSize,
    thrownQuiverMult: constants.thrownQuiverMult,
  });
  /* inven_carry ends with PU_INVEN + update_stuff (obj-gear.c L889-891), so the
   * derived upkeep->inven[] listing exists by the time anything reads a slot
   * letter off it. A test that skips this is testing a state the game never
   * reaches, and it is what hid the wrong-letter defect. */
  calcInventory(state.gear, constants);
  return handle;
}

describe("inventory verbs (obj-gear.c)", () => {
  it("process_player sheds the last sorted inven item for catch-all overflow", () => {
    const state = makeState({ playerGrid: loc(5, 5), commands: [] });
    /* sword is inserted first but sorts LAST behind potions by tval. */
    const sword = carry(state, makeNamed("& Dagger~", TV.SWORD));
    for (let i = 0; i < constants.packSize; i++) {
      const potion = makeNamed("Cure Light Wounds", TV.POTION);
      potion.note = `catch-all-${i}`;
      carry(state, potion);
    }
    expect(packIsOverfull(state.gear, constants)).toBe(true);
    state.overflowPack = (): void => {
      calcInventory(state.gear, constants);
      packOverflow(state, 0, constants);
    };

    expect(processPlayer(state, createDefaultRegistry()).needsInput).toBe(true);

    expect(gearGet(state.gear, sword)).toBeNull();
    expect(floorPile(state, state.actor.grid)).toHaveLength(1);
  });

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
    const result = invenDrop(state, h, potion.number);
    expect(result).not.toBeNull();
    expect(state.gear.pack).not.toContain(h);
    expect(floorPile(state, loc(5, 5))).toContain(result!.dropped);
    /* The whole stack went, and it was never equipped (inven_drop's two
     * message-shaping flags). */
    expect(result!.noneLeft).toBe(true);
    expect(result!.wasEquipped).toBe(false);
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

  /**
   * effect-yx carries the AREA of every detection and mapping effect
   * (`effect_handler_MAP_AREA` reads context->y/x, effect-handler-general.c:1236),
   * and grab_effect_data applies the directive to the effect it follows
   * (init.c:225). The builder here is the only producer of a live chain for
   * objects, activations, class spells, chest traps and curses, so an effect-yx
   * it drops is an effect that maps a zero-size box - silently, with no error
   * and no message, which is exactly what a player sees as "the scroll did
   * nothing".
   *
   * This asserts on the REAL record rather than a hand-built one on purpose.
   * effect-detect.test.ts passes {y: 22, x: 40} to effectSimple directly, which
   * makes it an assertion about the handler and an unchecked assumption about
   * the producer - and the producer was wrong for as long as that was the only
   * coverage.
   */
  /**
   * The class, not the instance. Three directives had been dropped by this
   * builder - `effect-yx` (every detection and mapping effect mapped a
   * zero-size box), `dice-xtra` (a spiked pit printed "You are impaled!" and
   * dealt none of its 2d6) and `effect-msg` (the Necromancer's self-damage
   * killed you with "yourself") - and every one of them was silent. An effect
   * directive the builder does not know is not an error; it is an effect that
   * quietly does less.
   *
   * So instead of a test per directive, this asserts the builder's vocabulary
   * covers every key the shipped packs actually put on an effect record. A new
   * directive in the data fails HERE, at the producer, instead of somewhere in
   * play months later.
   */
  it("consumes every key the packs put on an effect record", () => {
    const handled = new Set([
      "eff",
      "type",
      "radius",
      "other",
      "dice",
      "expr",
      "effect-yx",
      "effect-msg",
      "dice-xtra",
      "effect-yx-xtra",
      "expr-xtra",
    ]);
    /**
     * Keys a DIFFERENT producer consumes before a chain is ever built, listed
     * with the line that does it so an exemption cannot be granted by silence.
     *
     * `effect-dice` is player_timed.txt's own directive (SPRINT's on-begin
     * chain); player/bind.ts:809 folds it into the step's `dice` field, so it
     * never reaches this builder under that name.
     */
    const boundElsewhere = new Set(["effect-dice"]);
    const seen = new Set<string>();
    const walk = (node: unknown): void => {
      if (!node || typeof node !== "object") return;
      if (Array.isArray(node)) {
        for (const v of node) walk(v);
        return;
      }
      const rec = node as Record<string, unknown>;
      if (typeof rec["eff"] === "string") {
        for (const k of Object.keys(rec)) seen.add(k);
      }
      for (const v of Object.values(rec)) walk(v);
    };
    const dir = new URL("../../../content/pack/", import.meta.url);
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      walk(
        (
          JSON.parse(readFileSync(new URL(file, dir), "utf8")) as {
            records?: unknown;
          }
        ).records,
      );
    }
    /* Non-empty, or the walk found nothing and the assertion is vacuous. */
    expect(seen.size).toBeGreaterThan(5);
    expect(
      [...seen].filter((k) => !handled.has(k) && !boundElsewhere.has(k)).sort(),
    ).toEqual([]);
    /* And the exemption list is not allowed to rot into a way of ignoring
     * keys that stopped appearing: every entry must still be in the data. */
    expect([...boundElsewhere].filter((k) => !seen.has(k))).toEqual([]);
  });

  /**
   * A trap's effect-xtra chain spells its dice `dice-xtra`, because that is the
   * directive's name and the compiler keeps it (init.c parse_trap_dice_xtra
   * sets effect->dice on the last effect-xtra, exactly as `dice` does on an
   * effect). Reading only `dice` rolled 0 for every extra effect: the spiked
   * pit printed "You are impaled!" and dealt none of its 2d6, and neither pit
   * ever cut or poisoned.
   */
  it("carries dice-xtra, so a spiked pit's extra damage has dice", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const traps = (
      JSON.parse(
        readFileSync(
          new URL("../../../content/pack/trap.json", import.meta.url),
          "utf8",
        ),
      ) as { records: Array<{ name: { desc: string }; "effect-xtra"?: unknown }> }
    ).records;
    const pit = traps.find((t) => t.name.desc === "spiked pit");
    if (!pit?.["effect-xtra"]) throw new Error("no spiked pit effect-xtra");

    const chain = buildObjectEffectChain(
      pit["effect-xtra"] as EffectRecordJson[],
      state,
    );
    /* trap.txt: effect-xtra:DAMAGE / dice-xtra:2d6. */
    expect(chain?.dice).not.toBeNull();
    expect(chain!.dice!.roll(new Rng(1), {
      base: 0,
      dice: 0,
      sides: 0,
      mBonus: 0,
    })).toBeGreaterThan(0);
  });

  it("carries effect-yx from the record onto the built effect", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const scroll = makeNamed("Magic Mapping", TV.SCROLL);
    const chain = buildObjectEffectChain(scroll.effect ?? [], state);
    expect(chain).not.toBeNull();
    /* scroll.txt: effect:MAP_AREA / effect-yx:22:40. */
    expect({ y: chain!.y, x: chain!.x }).toEqual({ y: 22, x: 40 });
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
    /* Clearing SQUARE_SEEN is now the whole of it: noLight reads the flag for every
     * caller. The `state.updateFov = () => {}` that used to be needed here was
     * satisfying a seam guard inside noLight, not modelling anything about the
     * game, and that guard is gone. */
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

describe("rune autoinscriptions (obj-ignore.c:172-225)", () => {
  /** A state with a rune-note registry and rune 0 (+AC) known to the player. */
  function runeState(): GameState {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.runeNotes = new RuneNoteRegistry();
    state.actor.player.objKnown.toA = 1; // player_knows_rune(p, 0)
    return state;
  }
  /** A dagger carrying the +AC rune (object_has_rune(obj, 0) == obj->to_a != 0). */
  function acDagger(): GameObject {
    const obj = makeNamed("& Dagger~", TV.SWORD);
    obj.toA = 2;
    obj.note = null;
    return obj;
  }

  it("stamps a known rune's note through apply_autoinscription, kind note or not", () => {
    const state = runeState();
    const dagger = acDagger();
    carry(state, dagger);
    state.runeNotes!.set(0, "{ac}");
    /* No per-kind note at all: runes_autoinscribe runs BEFORE the `if (!note)`
     * early return (obj-ignore.c:258-262), so the rune note still lands. */
    const deps = makeDeps(state, { autoNote: () => null });
    expect(applyAutoinscription(state, dagger, deps)).toBe(0);
    expect(dagger.note).toBe("{ac}");
  });

  it("does not stamp a rune the player does not know (obj-ignore.c:224)", () => {
    const state = runeState();
    state.actor.player.objKnown.toA = 0;
    const dagger = acDagger();
    carry(state, dagger);
    state.runeNotes!.set(0, "{ac}");
    applyAutoinscription(state, dagger, makeDeps(state, { autoNote: () => null }));
    expect(dagger.note).toBeNull();
  });

  it("does not stamp a rune the object does not carry", () => {
    const state = runeState();
    const plain = makeNamed("& Dagger~", TV.SWORD);
    plain.toA = 0;
    plain.note = null;
    carry(state, plain);
    state.runeNotes!.set(0, "{ac}");
    applyAutoinscription(state, plain, makeDeps(state, { autoNote: () => null }));
    expect(plain.note).toBeNull();
  });

  it("APPENDS to an existing inscription, and is idempotent (strstr, :176-182)", () => {
    const state = runeState();
    const dagger = acDagger();
    dagger.note = "@w1";
    carry(state, dagger);
    state.runeNotes!.set(0, "{ac}");
    const deps = makeDeps(state, { autoNote: () => null });
    applyAutoinscription(state, dagger, deps);
    expect(dagger.note).toBe("@w1{ac}");
    /* strstr(obj->note, rune_note(i)) now hits: no second append. */
    applyAutoinscription(state, dagger, deps);
    expect(dagger.note).toBe("@w1{ac}");
  });

  it("truncates the combined inscription at 79 chars (char current_note[80])", () => {
    const state = runeState();
    const dagger = acDagger();
    dagger.note = "x".repeat(70);
    carry(state, dagger);
    state.runeNotes!.set(0, "y".repeat(20));
    applyAutoinscription(state, dagger, makeDeps(state, { autoNote: () => null }));
    expect(dagger.note).toHaveLength(79);
    expect(dagger.note).toBe("x".repeat(70) + "y".repeat(9));
  });

  it("rune_autoinscribe stamps the floor pile AND the gear (:200-211)", () => {
    const state = runeState();
    const carried = acDagger();
    carry(state, carried);
    const onFloor = acDagger();
    floorCarry(state, state.actor.grid, onFloor);
    const elsewhere = acDagger();
    floorCarry(state, loc(8, 8), elsewhere);
    state.runeNotes!.set(0, "{ac}");

    runeAutoinscribe(state, 0);
    expect(carried.note).toBe("{ac}");
    expect(onFloor.note).toBe("{ac}"); // the pile beneath the player
    expect(elsewhere.note).toBeNull(); // any other grid is untouched
  });

  it("autoinscribe_ground / autoinscribe_pack cover both lists (:340-359)", () => {
    const state = runeState();
    const carried = acDagger();
    carry(state, carried);
    const onFloor = acDagger();
    floorCarry(state, state.actor.grid, onFloor);
    state.runeNotes!.set(0, "{ac}");
    const deps = makeDeps(state, { autoNote: () => null });

    autoinscribeGround(state, deps);
    expect(onFloor.note).toBe("{ac}");
    expect(carried.note).toBeNull();
    autoinscribePack(state, deps);
    expect(carried.note).toBe("{ac}");
  });

  it("the use command autoinscribes the stack it did not consume (cmd-obj.c:717-719)", () => {
    /*
     * "Autoinscribe if we are guaranteed to still have any":
     * `if (!none_left && !from_floor) apply_autoinscription(player, obj)`. A
     * stack of two potions leaves one behind, so the remainder gets the note; a
     * single potion is consumed whole (none_left) and nothing is inscribed.
     */
    const state = makeState({ playerGrid: loc(5, 5) });
    const potion = makeNamed("Cure Light Wounds", TV.POTION);
    potion.number = 2;
    const h = carry(state, potion);
    const registry = createDefaultRegistry();
    installObjCommands(registry, makeDeps(state, { autoNote: () => "@q1" }));
    state.nextCommand = () => ({ code: "quaff", args: { handle: h } });
    processPlayer(state, registry);
    const left = gearGet(state.gear, h);
    expect(left?.number).toBe(1);
    expect(left?.note).toBe("@q1");
  });

  it("the use command inscribes nothing when the last of the stack is used", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const potion = makeNamed("Cure Light Wounds", TV.POTION);
    potion.number = 1;
    const h = carry(state, potion);
    const registry = createDefaultRegistry();
    installObjCommands(registry, makeDeps(state, { autoNote: () => "@q1" }));
    state.nextCommand = () => ({ code: "quaff", args: { handle: h } });
    processPlayer(state, registry);
    expect(gearGet(state.gear, h)).toBeFalsy();
    expect(potion.note).toBeNull();
  });

  it("draws no RNG", () => {
    const state = runeState();
    const dagger = acDagger();
    carry(state, dagger);
    state.runeNotes!.set(0, "{ac}");
    const before = state.rng.getState();
    autoinscribeGround(state, makeDeps(state, { autoNote: () => null }));
    autoinscribePack(state, makeDeps(state, { autoNote: () => null }));
    runeAutoinscribe(state, 0);
    expect(state.rng.getState()).toEqual(before);
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

  it("no_light fires on an unlit grid whether or not a seam is installed", () => {
    /**
     * The inverse of what this asserted. noLight used to open with `if
     * (state.updateFov === undefined) return false`, so a harness state - which
     * installs no seam, and whose openField leaves SEEN clear - could read scrolls
     * in the dark. The guard existed because core supplied no default updateFov, so
     * "no seam" and "unlit" were indistinguishable; core now installs one in
     * wireGame, every real game maintains SEEN, and the guard is deleted.
     *
     * A harness state still installs nothing, which is the point of testing it here:
     * the rule is now about the FLAG, so an unlit grid refuses and costs no energy
     * even for a fixture that never had a host.
     */
    const state = makeState({ playerGrid: loc(5, 5) });
    expect(state.updateFov).toBeUndefined();
    const msgs: string[] = [];
    expect(readScroll(state, msgs).energyUsed).toBe(0);
    expect(msgs).toContain("You have no light to read by.");
  });
});

describe("object_effect / obj_is_activatable / obj_can_activate (obj-util.c L886/721/730)", () => {
  it("objectEffect prefers the activation's effect over the kind's own effect", () => {
    makeState({ playerGrid: loc(5, 5) });
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
    makeState({ playerGrid: loc(5, 5) });
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

/**
 * do_cmd_wield's second question and its two aborts (cmd-obj.c:265-353).
 *
 * The port silently took one hand when a third ring was worn, never asked the
 * "!t" confirmation, and carried a floor item into the pack BEFORE any of the
 * abort points - so escaping a prompt (or hitting a stuck slot) left the item in
 * your pack for free.
 */
describe("registered command: wield (cmd-obj.c do_cmd_wield)", () => {
  /** The body's RING slot indices, in order. */
  function ringSlots(state: GameState): number[] {
    const body = state.actor.player.body;
    const out: number[] = [];
    for (let i = 0; i < body.count; i++) {
      if (body.slots[i]?.type === "RING") out.push(i);
    }
    return out;
  }

  /** Two named rings worn, one in each hand. Returns the two slot indices. */
  function bothHandsFull(state: GameState): { left: number; right: number } {
    const slots = ringSlots(state);
    const a = slots[0]!;
    const b = slots[1]!;
    expect(slots.length).toBeGreaterThanOrEqual(2);
    const r1 = carry(state, makeNamed("Strength", TV.RING));
    const r2 = carry(state, makeNamed("Protection", TV.RING));
    invenWield(state, r1, constants, {}, a);
    invenWield(state, r2, constants, {}, b);
    expect(state.actor.player.equipment[a]).toBe(r1);
    expect(state.actor.player.equipment[b]).toBe(r2);
    return { left: a, right: b };
  }

  it("wield_slot prefers the FREE hand, so a SECOND ring asks nothing", () => {
    /* slot_by_type(p, EQUIP_RING, false) (obj-gear.c:357 -> :71-93) prefers an
     * empty slot, and cmd-obj.c:291-295 wields straight into it. */
    const state = makeState({ playerGrid: loc(5, 5) });
    const slots = ringSlots(state);
    const r1 = carry(state, makeNamed("Strength", TV.RING));
    invenWield(state, r1, constants, {}, slots[0]!);
    const second = makeNamed("Protection", TV.RING);
    expect(wieldRingChoice(state, second)).toBeNull();
    const h = carry(state, second);
    const registry = createDefaultRegistry();
    installObjCommands(registry, makeDeps(state));
    registry.get("wield")!(state, { code: "wield", args: { handle: h } });
    expect(state.actor.player.equipment[slots[1]!]).toBe(h);
  });

  it("a THIRD ring owes the 'Replace which ring? ' question over both worn rings", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const { left, right } = bothHandsFull(state);
    const third = makeNamed("Speed", TV.RING);
    const choice = wieldRingChoice(state, third);
    expect(choice).not.toBeNull();
    /* cmd-obj.c:300-301, verbatim. */
    expect(choice!.prompt).toBe("Replace which ring? ");
    expect(choice!.error).toBe("Error in do_cmd_wield(), please report.");
    /* USE_EQUIP filtered by tval_is_ring: both hands, nothing else. */
    expect([...choice!.slots]).toEqual([left, right]);
  });

  it("the chosen hand is the hand that is freed (args.slot, not wield_slot)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const { left, right } = bothHandsFull(state);
    const worn = state.actor.player.equipment[right]!;
    const h = carry(state, makeNamed("Speed", TV.RING));
    const registry = createDefaultRegistry();
    installObjCommands(registry, makeDeps(state));
    /* equipped_item_slot(player->body, equip_obj) (cmd-obj.c:309) - the SECOND
     * hand, which is NOT the one wield_slot's full-slot fallback returns. */
    expect(
      wieldSlot(state.actor.player.body, TV.RING, state.actor.player.equipment),
    ).toBe(left);
    registry.get("wield")!(state, { code: "wield", args: { handle: h, slot: right } });
    expect(state.actor.player.equipment[right]).toBe(h);
    /* The other hand is untouched, and the displaced ring went to the pack. */
    expect(state.actor.player.equipment[left]).not.toBe(0);
    expect(state.gear.pack).toContain(worn);
  });

  it("a non-ring answer is ignored rather than obeyed (the tval_is_ring filter)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const { left } = bothHandsFull(state);
    const sword = carry(state, makeNamed("& Dagger~", TV.SWORD));
    const weaponSlot = wieldSlot(
      state.actor.player.body,
      TV.SWORD,
      state.actor.player.equipment,
    );
    invenWield(state, sword, constants, {}, weaponSlot);
    const h = carry(state, makeNamed("Speed", TV.RING));
    const registry = createDefaultRegistry();
    installObjCommands(registry, makeDeps(state));
    registry.get("wield")!(state, {
      code: "wield",
      args: { handle: h, slot: weaponSlot },
    });
    /* The weapon is still worn; the ring went to the wield_slot default hand. */
    expect(state.actor.player.equipment[weaponSlot]).toBe(sword);
    expect(state.actor.player.equipment[left]).toBe(h);
  });

  it("'!t' on the displaced item asks 'Really take off %s? ' and a refusal aborts", () => {
    /* cmd-obj.c:321-330: check_for_inscrip(equip_obj, "!t"), then get_check with
     * ODESC_PREFIX | ODESC_FULL. */
    const state = makeState({ playerGrid: loc(5, 5) });
    /* Both hands full, so the third ring really does displace one - with a free
     * hand upstream wields into it and never touches the inscribed ring. */
    const { left: slot } = bothHandsFull(state);
    const wornHandle = state.actor.player.equipment[slot]!;
    const worn = gearGet(state.gear, wornHandle)!;
    worn.note = "!t";

    const ask = wieldTakeoffConfirm(state, slot);
    expect(ask).not.toBeNull();
    expect(ask!.count).toBe(1);
    expect(ask!.prompt).toBe(
      `Really take off ${describeObject(state, worn, ODESC.PREFIX | ODESC.FULL)}? `,
    );

    const h = carry(state, makeNamed("Speed", TV.RING));
    const registry = createDefaultRegistry();
    const asked: string[] = [];
    installObjCommands(
      registry,
      makeDeps(state, {
        env: {
          confirm: (p: string) => {
            asked.push(p);
            return false;
          },
        },
      }),
    );
    const energy = registry.get("wield")!(state, {
      code: "wield",
      args: { handle: h, slot },
    });
    expect(asked).toEqual([ask!.prompt]);
    /* "Forget it" (cmd-obj.c:329): no turn, and the ring is still in the pack. */
    expect(energy).toBe(0);
    expect(state.actor.player.equipment[slot]).toBe(wornHandle);
    expect(state.gear.pack).toContain(h);
  });

  it("each occurrence of '!t' asks again (the `while (n--)` loop)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const { left: slot } = bothHandsFull(state);
    gearGet(state.gear, state.actor.player.equipment[slot]!)!.note = "!t!t!t";
    expect(wieldTakeoffConfirm(state, slot)!.count).toBe(3);
  });

  it("aborting the '!t' confirm does NOT leak a FLOOR item into the pack", () => {
    /* inven_wield carries the floor item itself (obj-gear.c:973-976), i.e. past
     * every abort in do_cmd_wield. The port carried it up front, so escaping the
     * prompt left the ring in the pack for free. */
    const state = makeState({ playerGrid: loc(5, 5) });
    const { left: slot } = bothHandsFull(state);
    gearGet(state.gear, state.actor.player.equipment[slot]!)!.note = "!t";

    const onFloor = makeNamed("Speed", TV.RING);
    floorCarry(state, loc(5, 5), onFloor);
    const packBefore = [...state.gear.pack];

    const registry = createDefaultRegistry();
    installObjCommands(registry, makeDeps(state, { env: { confirm: () => false } }));
    const energy = registry.get("wield")!(state, {
      code: "wield",
      args: { floor: 0, slot },
    });
    expect(energy).toBe(0);
    expect(state.gear.pack).toEqual(packBefore);
    /* Still on the floor, where the player left it. */
    expect(floorPile(state, loc(5, 5))).toContain(onFloor);
  });

  it("a stuck slot does NOT leak a FLOOR item into the pack either", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const { left: slot } = bothHandsFull(state);
    gearGet(state.gear, state.actor.player.equipment[slot]!)!.flags.on(OF.STICKY);

    const onFloor = makeNamed("Speed", TV.RING);
    floorCarry(state, loc(5, 5), onFloor);
    const packBefore = [...state.gear.pack];

    const registry = createDefaultRegistry();
    const msgs: string[] = [];
    installObjCommands(registry, makeDeps(state, { env: { msg: (t) => msgs.push(t) } }));
    const energy = registry.get("wield")!(state, {
      code: "wield",
      args: { floor: 0, slot },
    });
    expect(energy).toBe(0);
    expect(msgs.some((m) => m.startsWith("You cannot remove the"))).toBe(true);
    expect(state.gear.pack).toEqual(packBefore);
    expect(floorPile(state, loc(5, 5))).toContain(onFloor);
  });

  it("the 'You were ...' wording comes from the SLOT type (cmd-obj.c:337-347)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const old = makeNamed("& Dagger~", TV.SWORD);
    const oldHandle = carry(state, old);
    const slot = wieldSlot(
      state.actor.player.body,
      TV.SWORD,
      state.actor.player.equipment,
    );
    invenWield(state, oldHandle, constants, {}, slot);
    const h = carry(state, makeNamed("& Main~ Gauche~", TV.SWORD));
    const registry = createDefaultRegistry();
    const msgs: string[] = [];
    installObjCommands(registry, makeDeps(state, { env: { msg: (t) => msgs.push(t) } }));
    registry.get("wield")!(state, { code: "wield", args: { handle: h } });
    /* EQUIP_WEAPON -> "You were wielding" (cmd-obj.c:338-339). */
    expect(msgs.some((m) => m.startsWith("You were wielding "))).toBe(true);
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

/**
 * obj->known->effect / obj->known->activation: the two PER-OBJECT knowledge
 * fields (#126 / DIVERGENCES C1).
 *
 * The port synthesises the known twin on demand from what the player knows
 * about the KIND (known-object.ts objectKnownShadow). That reproduces every
 * awareness-driven write upstream makes - but upstream also writes the twin per
 * OBJECT, and the loudest of those is check_devices' "Notice activations"
 * (cmd-obj.c L97-103): activating an item teaches THAT item's effect without
 * making its kind aware.
 *
 * The one thing that reads it back is use_aux's known_aim (cmd-obj.c L424-429),
 * whose last two disjuncts the port did not have. Without them an item whose
 * kind is still unaware is aimed with DDD[randint0(8)] every single time, no
 * matter how often it has been used - so a Ring of Flames you have fired twenty
 * times still throws its ball in a random direction. WHICH items: flavor_init
 * (obj-util.c L243-245) leaves every flavoured kind unaware, and also the 14
 * special-artifact kinds, which it skips by kidx.
 */
describe("per-object effect knowledge (cmd-obj.c L97-103, L424-429)", () => {
  /** A real FlavorKnowledge, which starts with nothing aware. */
  function unawareFlavor(): FlavorKnowledge {
    return new FlavorKnowledge(reg.ordinaryKindCount);
  }

  it("a first activation teaches this object, and the SECOND one aims", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    maxDeviceSkill(state);
    /* Flames' kind effect is a FIRE ball, so obj_needs_aim is true and the
     * known_aim branch is live. Its kind is flavoured, so it is unaware. */
    const ring = makeNamed("Flames", TV.RING);
    expect(objNeedsAim(ring, { flavor: unawareFlavor() })).toBe(true);
    const h = carry(state, ring);

    let asked = 0;
    const deps = makeDeps(state, {
      flavor: unawareFlavor(),
      env: { msg: () => {}, chooseDir: () => { asked++; return 4; } },
    });

    /* First use: nothing known about this object, so use_aux rolls a direction
     * instead of asking (cmd-obj.c L430-433). */
    useAux(state, ring, USE.TIMEOUT, deps, { handle: h });
    expect(asked, "an unaware item must not ask for a direction").toBe(0);

    /* ...but check_devices recorded what it just did (cmd-obj.c L98-101). */
    expect(ring.knownEffect).toBe(ring.effect);

    /* Second use: the kind is STILL unaware - nothing about the player's
     * knowledge changed - yet known_aim is now true off the per-object bit. */
    ring.timeout = 0;
    useAux(state, ring, USE.TIMEOUT, deps, { handle: h });
    expect(asked, "a previously-used item aims where the player says").toBe(1);
  });

  it("an activation with no kind effect records the ACTIVATION instead", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    maxDeviceSkill(state);
    /* cmd-obj.c L99-102 is an if/else: obj->effect wins, and only an item with
     * no effect of its own falls through to obj->activation. A Phial has no
     * kind effect; give it the activation an artifact would carry. */
    const light = makeNamed("& Wooden Torch~", TV.LIGHT);
    light.effect = null;
    const activation = { effect: makeNamed("Cure Light Wounds", TV.POTION).effect };
    light.activation = activation as never;
    const h = carry(state, light);
    useAux(state, light, USE.TIMEOUT, makeDeps(state, { flavor: unawareFlavor() }), {
      handle: h,
    });
    expect(light.knownActivation).toBe(activation);
    expect(light.knownEffect).toBeUndefined();
  });

  it("a wand aims without any of this, as it always did", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    maxDeviceSkill(state);
    /* tval_is_wand short-circuits known_aim before the new disjuncts are
     * reached, so an unaware wand has always asked for a direction - and no
     * "Notice activations" bit is written, because a wand is not an
     * activation (cmd-obj.c L67-78 leaves `activated` false). */
    const wand = makeNamed("Magic Missile", TV.WAND);
    wand.pval = 5;
    const h = carry(state, wand);
    let asked = 0;
    const deps = makeDeps(state, {
      flavor: unawareFlavor(),
      env: { msg: () => {}, chooseDir: () => { asked++; return 4; } },
    });
    expect(objNeedsAim(wand, deps)).toBe(true);
    useAux(state, wand, USE.CHARGE, deps, { handle: h });
    expect(asked).toBe(1);
    expect(wand.knownEffect, "a wand is not an activation").toBeUndefined();
    expect(wand.knownActivation).toBeUndefined();
  });
});
