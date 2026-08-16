/**
 * notice_stuff (player-calcs.c L2536) and the PN_* queue: PORT_TODO 1.1.
 *
 * WHAT THESE TESTS ARE FOR. The old state of this code was not "a wrong
 * notice_stuff" - there was no notice mask at all, so nothing about the pipeline
 * could be asserted and its absence read as a design choice. So the tests here
 * are deliberately of two kinds:
 *
 *  1. mechanics of the drain (which bit, cleared when, in what order), and
 *  2. END-TO-END, through the real processPlayer: two pack stacks that only
 *     BECAME mergeable are actually merged by the time the player is asked for
 *     input again. That second kind is the one that would have failed before,
 *     and it does not care how the bit got raised.
 *
 * Each assertion below was checked by breaking the line it covers; the two that
 * a mutation does NOT kill on their own are called out where they sit.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bindConstants } from "../constants.js";
import { ITYPE, TV } from "../generated/index.js";
import { loc } from "../loc.js";
import { Rng } from "../rng.js";
import { ObjRegistry } from "../obj/bind.js";
import type { ObjPackJson } from "../obj/types.js";
import { objectPrep } from "../obj/make.js";
import { OBJ_NOTICE } from "../obj/knowledge.js";
import type { GameObject } from "../obj/object.js";
import { IGNORE, IgnoreSettings, ignoreItemOk } from "../obj/ignore.js";
import { PN } from "../player/types.js";
import { combinePack, gearGet, invenCarry, gearObjectForUse } from "./gear.js";
import { objectKnownView } from "./describe.js";
import { makeState } from "./harness.js";
import type { GameState } from "./context.js";
import { ignoreDrop } from "./ignore-cmd.js";
import { noticeNewLevel, noticeStuff } from "./notice.js";
import { ActionRegistry, processPlayer } from "./player-turn.js";

function loadJson<T>(name: string): T {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  ) as T;
}

const reg = new ObjRegistry({
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
} as ObjPackJson);
const constants = bindConstants(loadJson("constants"));

function kindByName(name: string, tval: number) {
  const k = reg.kinds.find((kk) => kk.name === name && kk.tval === tval);
  if (!k) throw new Error(`no kind named ${name} of tval ${tval}`);
  return k;
}

function makeSword(rng: Rng, kindName: string, toD: number): GameObject {
  const obj = objectPrep(rng, reg, constants, kindByName(kindName, TV.SWORD), 0, "minimise");
  obj.toD = toD;
  return obj;
}

/**
 * Learn everything about `obj`, so ignore_level_of grades it by its combat
 * bonuses rather than returning IGNORE_MAX (obj-ignore.c:489 - the good / bad /
 * average tiers are behind object_fully_known).
 *
 * Not decoration: a Dagger carries OF_THROWING, whose id-type is "on wield"
 * (object_property.txt:740-744), so an un-wielded one is not fully known and
 * upstream will not quality-ignore it below IGNORE_ALL. These tests are about
 * the drop pass, not the knowledge gate.
 */
function identify(state: GameState, obj: GameObject): GameObject {
  obj.notice |= OBJ_NOTICE.ASSESSED;
  for (const flag of obj.flags) state.actor.player.objKnown.flags.on(flag);
  return obj;
}

function carry(state: GameState, obj: GameObject): number {
  return invenCarry(state.gear, state.actor.player, obj, {
    quiverSlotSize: constants.quiverSlotSize,
    thrownQuiverMult: constants.thrownQuiverMult,
  });
}

/**
 * The session's combinePack seam (session/game.ts wireGame), reduced to what it
 * has to be: combine_pack with the bound constants. Tests that omit it are
 * testing the unbound case on purpose.
 */
function bindCombine(state: GameState): { calls: number } {
  const counter = { calls: 0 };
  state.combinePack = (): void => {
    counter.calls++;
    combinePack(state.gear, constants);
  };
  return counter;
}

/** A state whose pack holds two same-kind Daggers that cannot merge (toD differs). */
function twoUnmergeableDaggers(state: GameState): { a: number; b: number } {
  const rng = new Rng(11);
  const a = carry(state, makeSword(rng, "& Dagger~", 0));
  const b = carry(state, makeSword(rng, "& Dagger~", 3));
  /* The fixture must actually start as two slots, or every merge assertion
   * below would pass against a pack that was never split. */
  expect(state.gear.pack, "fixture: two separate pack slots").toHaveLength(2);
  expect(a).not.toBe(b);
  return { a, b };
}

describe("noticeStuff: draining player->upkeep->notice", () => {
  it("does nothing at all on an empty mask (L2537's early return)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const combine = bindCombine(state);
    state.actor.player.upkeep.notice = 0;

    noticeStuff(state);

    expect(combine.calls).toBe(0);
  });

  it("clears PN_COMBINE and runs the bound combine (L2546-2549)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const combine = bindCombine(state);
    const { b } = twoUnmergeableDaggers(state);

    /* Make them mergeable AFTER both are carried - the only situation
     * combine_pack exists for, since inven_carry absorbs on the way in. */
    gearGet(state.gear, b)!.toD = 0;
    state.actor.player.upkeep.notice |= PN.COMBINE;

    noticeStuff(state);

    expect(combine.calls).toBe(1);
    expect(state.actor.player.upkeep.notice & PN.COMBINE).toBe(0);
    expect(state.gear.pack, "the two stacks merged").toHaveLength(1);
    expect(gearGet(state.gear, state.gear.pack[0]!)!.number).toBe(2);
  });

  it("LEAVES PN_COMBINE raised when no combiner is bound", () => {
    /* The deliberate rule, not an accident: an unwired harness still OWES the
     * combine. Clearing the bit here would make an unwired build
     * indistinguishable from a wired one, which is the failure mode of every
     * other optional seam on GameState. */
    const state = makeState({ playerGrid: loc(5, 5) });
    const { b } = twoUnmergeableDaggers(state);
    gearGet(state.gear, b)!.toD = 0;
    state.actor.player.upkeep.notice |= PN.COMBINE;
    expect(state.combinePack, "no seam bound").toBeUndefined();

    noticeStuff(state);

    expect(state.actor.player.upkeep.notice & PN.COMBINE).toBe(PN.COMBINE);
    expect(state.gear.pack, "and nothing was combined").toHaveLength(2);

    /* Binding it later still gets the work done, because the bit survived. */
    const combine = bindCombine(state);
    noticeStuff(state);
    expect(combine.calls).toBe(1);
    expect(state.gear.pack).toHaveLength(1);
  });

  it("runs ignore BEFORE combine, so ignore_drop's own PN_COMBINE lands in the SAME pass", () => {
    /* The order in notice_stuff is load-bearing and invisible: ignore_drop ends
     * by raising PN_COMBINE (obj-ignore.c L710), and because the ignore branch
     * runs first, the combine branch below it sees that bit. Swap the two
     * branches and the combine slips to the next turn with nothing failing -
     * except this test. */
    const state = makeState({ playerGrid: loc(5, 5) });
    const combine = bindCombine(state);
    state.ignore = new IgnoreSettings();
    state.isIgnored = () => false; /* nothing to drop; only the tail matters */
    state.actor.player.upkeep.notice |= PN.IGNORE;

    noticeStuff(state);

    expect(combine.calls, "the ignore pass's combine ran in this pass").toBe(1);
    expect(state.actor.player.upkeep.notice).toBe(0);
  });

  it("noticeNewLevel raises PN_COMBINE and drains it (on_new_level, L1034-1035)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const combine = bindCombine(state);
    const { b } = twoUnmergeableDaggers(state);
    gearGet(state.gear, b)!.toD = 0;

    noticeNewLevel(state);

    expect(combine.calls).toBe(1);
    expect(state.gear.pack, "arriving on a level combines the pack").toHaveLength(1);
  });
});

describe("the choke points that raise PN_COMBINE", () => {
  it("inven_carry raises it for a NEW slot and not for an absorbed one (L877)", () => {
    /* Upstream's placement is inside the non-combining branch, and that is a
     * decision rather than an oversight: a pickup that merged into an existing
     * stack cannot have made any other pair mergeable. */
    const state = makeState({ playerGrid: loc(5, 5) });
    const rng = new Rng(21);

    state.actor.player.upkeep.notice = 0;
    carry(state, makeSword(rng, "& Dagger~", 0));
    expect(
      state.actor.player.upkeep.notice & PN.COMBINE,
      "a new pack slot asks for a combine",
    ).toBe(PN.COMBINE);
    expect(state.gear.pack).toHaveLength(1);

    state.actor.player.upkeep.notice = 0;
    carry(state, makeSword(rng, "& Dagger~", 0));
    expect(state.gear.pack, "the second one absorbed").toHaveLength(1);
    expect(
      state.actor.player.upkeep.notice & PN.COMBINE,
      "an absorbed pickup does not",
    ).toBe(0);
  });

  it("gear_object_for_use raises it on a partial take (L618)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const rng = new Rng(22);
    const h = carry(state, makeSword(rng, "& Dagger~", 0));
    carry(state, makeSword(rng, "& Dagger~", 0)); /* absorbs: number is 2 */
    expect(gearGet(state.gear, h)!.number).toBe(2);

    state.actor.player.upkeep.notice = 0;
    gearObjectForUse(state.gear, state.actor.player, h, 1);

    expect(state.actor.player.upkeep.notice & PN.COMBINE).toBe(PN.COMBINE);
  });
});

describe("ignoreDrop: the pass, not just the scan (obj-ignore.c L651)", () => {
  /** A state where a Dagger with toD -3 is ignorable and one with +4 is not. */
  function ignoringState(): GameState {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.ignore = new IgnoreSettings();
    state.ignore.level[ITYPE.SHARP] = IGNORE.BAD;
    state.isIgnored = (obj) =>
      ignoreItemOk(obj, objectKnownView(state, obj), state.ignore, true);
    return state;
  }

  it("queues a background drop for each unequipped target, and raises PN_COMBINE", () => {
    const state = ignoringState();
    const rng = new Rng(4);
    const bad = carry(state, identify(state, makeSword(rng, "& Dagger~", -3)));
    const good = carry(state, identify(state, makeSword(rng, "& Tulwar~", 4)));

    const { needConfirm, queued } = ignoreDrop(state);

    expect(queued).toBe(1);
    expect(needConfirm).toHaveLength(0);
    expect(state.cmdQueue).toHaveLength(1);
    const cmd = state.cmdQueue![0]!;
    expect(cmd.code).toBe("drop");
    expect(cmd.args?.["handle"]).toBe(bad);
    expect(cmd.args?.["handle"]).not.toBe(good);
    /* background_command = 2 (L695-702). Not decoration: processPlayer reads it
     * to skip the bloodlust roll, which is an RNG fact - see the draw-count
     * test below. */
    expect(cmd.background).toBe(2);
    expect(state.actor.player.upkeep.notice & PN.COMBINE).toBe(PN.COMBINE);
  });

  it("hands an EQUIPPED target back instead of dropping or inscribing it", () => {
    /* Upstream asks verify_object inline (L666); core cannot ask. What it must
     * NOT do is write "!d" on the player's behalf - upstream only does that
     * after a real refusal. */
    const state = ignoringState();
    const worn = carry(state, identify(state, makeSword(new Rng(5), "& Dagger~", -3)));
    state.actor.player.equipment[0] = worn;
    state.gear.pack.splice(state.gear.pack.indexOf(worn), 1);

    const { needConfirm, queued } = ignoreDrop(state);

    expect(queued).toBe(0);
    expect(needConfirm.map((t) => t.handle)).toEqual([worn]);
    expect(needConfirm[0]!.equipped).toBe(true);
    expect(state.cmdQueue ?? []).toHaveLength(0);
    expect(gearGet(state.gear, worn)!.note, "no unasked-for !d").toBeFalsy();
  });

  it("queues nothing while standing in a shop, but still asks for a combine", () => {
    const state = ignoringState();
    carry(state, identify(state, makeSword(new Rng(6), "& Dagger~", -3)));
    /* square_isshop (L683). Assert the fixture really is a shop first, or this
     * test passes for the wrong reason on any grid. */
    state.chunk.isShop = () => true;
    expect(state.chunk.isShop(state.actor.grid)).toBe(true);

    const { queued } = ignoreDrop(state);

    expect(queued).toBe(0);
    expect(state.cmdQueue ?? []).toHaveLength(0);
    expect(state.actor.player.upkeep.notice & PN.COMBINE).toBe(PN.COMBINE);
  });
});

describe("the pipeline end to end, through the real turn loop", () => {
  /**
   * The test that would have failed before PORT_TODO 1.1, and the only one here
   * that does not name a single line: a real action raises the bit, and by the
   * time processPlayer hands control back the pack is combined. It does not
   * matter WHICH choke point raised it.
   */
  it("combines a pack made mergeable by a real gear change, within the turn", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const combine = bindCombine(state);
    const { a, b } = twoUnmergeableDaggers(state);
    /* A third, distinct stack to consume, so the action under test is an
     * ordinary gear_object_for_use and not the merge itself. */
    const spare = carry(state, makeSword(new Rng(12), "& Rapier~", 0));
    expect(state.gear.pack).toHaveLength(3);
    state.actor.player.upkeep.notice = 0;

    /* Make the daggers mergeable, then take a real turn. */
    gearGet(state.gear, b)!.toD = gearGet(state.gear, a)!.toD;

    const registry = new ActionRegistry();
    registry.register("use-spare", (s) => {
      gearObjectForUse(s.gear, s.actor.player, spare, 1);
      return s.z.moveEnergy;
    });
    state.cmdQueue = [{ code: "use-spare" }];
    state.nextCommand = () => null;

    const result = processPlayer(state, registry);

    expect(result.energyUsed).toBe(state.z.moveEnergy);
    expect(combine.calls, "notice_stuff ran inside the turn").toBeGreaterThan(0);
    expect(state.actor.player.upkeep.notice).toBe(0);
    expect(state.gear.pack, "spare gone, daggers merged").toHaveLength(1);
    expect(gearGet(state.gear, state.gear.pack[0]!)!.number).toBe(2);
  });

  it("drains the queue BEFORE pack_overflow, not after (game-world.c:942 vs :947)", () => {
    /* The two notice_stuff calls in process_player are not redundant. The one at
     * the TOP of the do-loop exists so pack_overflow picks its victim from a
     * COMBINED pack; the one after the loop only tidies up what the turn raised.
     * Deleting the top one leaves the end-to-end test above green - it is the
     * ordering, not the drain, that only this test sees. */
    const state = makeState({ playerGrid: loc(5, 5) });
    bindCombine(state);
    const { b } = twoUnmergeableDaggers(state);
    gearGet(state.gear, b)!.toD = 0;
    state.actor.player.upkeep.notice = PN.COMBINE;

    let packSlotsSeenByOverflow = -1;
    state.overflowPack = (): void => {
      packSlotsSeenByOverflow = state.gear.pack.length;
    };

    const registry = new ActionRegistry();
    registry.register("noop", (s) => s.z.moveEnergy);
    state.cmdQueue = [{ code: "noop" }];
    state.nextCommand = () => null;

    processPlayer(state, registry);

    expect(packSlotsSeenByOverflow, "overflow ran at all").toBeGreaterThan(0);
    expect(packSlotsSeenByOverflow, "and it saw a combined pack").toBe(1);
  });

  it("a background auto-drop draws no bloodlust coercion roll", () => {
    /* processPlayer draws randint0(200) before every energy-capable command
     * (cmd-core.c:373) unless background_command > 1 (L360). An unflagged
     * auto-drop would therefore move every later draw in the turn. Measured as a
     * draw COUNT rather than asserted about the flag, because the flag is only
     * interesting through its effect on the stream. */
    const registry = new ActionRegistry();
    registry.register("noop", (s) => s.z.moveEnergy);

    const drawsFor = (background: number | undefined): number => {
      const state = makeState({ playerGrid: loc(5, 5), seed: 77 });
      state.nextCommand = () => null;
      state.cmdQueue = [
        background === undefined
          ? { code: "noop" }
          : { code: "noop", background },
      ];
      /* Counted at the source rather than inferred from the rng state, so the
       * number is the number of draws and not "something moved". */
      let draws = 0;
      const real = state.rng.randint0.bind(state.rng);
      state.rng.randint0 = (m: number): number => {
        draws++;
        return real(m);
      };
      processPlayer(state, registry);
      return draws;
    };

    expect(drawsFor(undefined), "an ordinary command draws the roll").toBe(1);
    expect(drawsFor(2), "a background command does not").toBe(0);
    /* background_command 1 is "not a repeat target" only: it still draws. */
    expect(drawsFor(1)).toBe(1);
  });
});
