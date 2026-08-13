/**
 * repeat_prev_allowed and its two disablers, on the path the game runs.
 * PORT_TODO 2.12.
 *
 * WHY THERE WAS NOTHING TO TEST BEFORE. `cmd.ts`'s CommandQueue already had the
 * whole mechanism and a passing test file to go with it - and nothing drives that
 * class (`mod/registry-join.ts`'s sibling note, `mod/registry-host.ts:15`, says so
 * outright). So the green tests were about a class the player never touches, while
 * the repeat the player gets had no gate at all. These tests drive `processPlayer`
 * and the real gear/floor functions instead.
 *
 * THE DISCRIMINATOR IS THE FLOOR INDEX. Upstream's `cmd_disable_repeat_floor_item`
 * exists to avoid dereferencing a freed object pointer. This port addresses a
 * floor object as `args.floor`, an INDEX into the pile, and an index does not
 * dangle: it re-binds to whatever occupies that position now. So the test that
 * matters is not "the repeat was refused" but "the repeat would otherwise have hit
 * a DIFFERENT object", and it is written that way below.
 */

import { describe, expect, it } from "vitest";
import { FEAT } from "../generated/index.js";
import { loc } from "../loc.js";
import { objectNew } from "../obj/object.js";
import type { GameObject } from "../obj/object.js";
import type { ObjectKind } from "../obj/types.js";
import { floorCarry, floorObjectForUse, floorPile } from "./floor.js";
import { gearAdd, gearObjectForUse } from "./gear.js";
import { makeState, makeRace, addMon } from "./harness.js";
import { monsterSwap } from "./context.js";
import type { GameState, PlayerCommand } from "./context.js";
import { ActionRegistry, processPlayer } from "./player-turn.js";
import {
  cmdDisableRepeat,
  cmdDisableRepeatFloorItem,
  repeatDirSlots,
  repeatPrevAllowed,
  withRepeatDir,
} from "./repeat.js";

/** A minimal distinguishable object; the tests only ever compare identity. */
function thing(name: string): GameObject {
  const kind = {
    name,
    tval: 26 /* TV_POTION */,
    sval: 1,
    weight: 4,
    base: { maxStack: 40, name: "potion" },
    level: 1,
    cost: 20,
    allocMin: 1,
    allocMax: 100,
    flags: { has: () => false },
    genMultProb: 0,
    stackSize: { base: 1, dice: 0, sides: 0, mBonus: 0 },
  } as unknown as ObjectKind;
  const obj = objectNew(kind);
  obj.tval = kind.tval;
  obj.sval = kind.sval;
  obj.number = 1;
  obj.weight = kind.weight;
  return obj;
}

function runOne(
  state: GameState,
  registry: ActionRegistry,
  cmd: PlayerCommand,
): void {
  state.cmdQueue = [cmd];
  state.nextCommand = (): PlayerCommand | null => null;
  processPlayer(state, registry);
}

describe("repeat_prev_allowed (cmd-core.c:260, :353)", () => {
  it("every command starts repeatable again (process_command, L353)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const registry = new ActionRegistry();
    registry.register("noop", (s) => s.z.moveEnergy);

    /* Whatever the last command left behind must not carry over. */
    cmdDisableRepeat(state.actor.player);
    expect(repeatPrevAllowed(state.actor.player)).toBe(false);

    runOne(state, registry, { code: "noop" });

    expect(repeatPrevAllowed(state.actor.player)).toBe(true);
  });

  it("a handler that disables repeat is still disabled when the turn ends", () => {
    /* The reset is at the START of the command, not the end - so a handler's
     * decision survives to the point the repeat key is read. Moving the reset
     * after the handler would make every disable a no-op and break nothing else. */
    const state = makeState({ playerGrid: loc(5, 5) });
    const registry = new ActionRegistry();
    registry.register("nope", (s) => {
      cmdDisableRepeat(s.actor.player);
      return s.z.moveEnergy;
    });

    runOne(state, registry, { code: "nope" });

    expect(repeatPrevAllowed(state.actor.player)).toBe(false);
  });
});

describe("cmd_disable_repeat's owed sites", () => {
  it("taking the last of a gear stack disables repeat (obj-gear.c:613)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const h = gearAdd(state.gear, thing("Potion of Nothing"));
    state.gear.pack.push(h);
    state.actor.player.upkeep.repeatPrevAllowed = true;

    /* A PARTIAL take leaves the handle resolving, so upstream does not disable. */
    const two = gearAdd(state.gear, (() => {
      const o = thing("Potion of Two");
      o.number = 2;
      return o;
    })());
    state.gear.pack.push(two);
    gearObjectForUse(state.gear, state.actor.player, two, 1);
    expect(
      repeatPrevAllowed(state.actor.player),
      "a partial take leaves it alone",
    ).toBe(true);

    /* The whole stack: the handle stops resolving. */
    gearObjectForUse(state.gear, state.actor.player, h, 1);
    expect(repeatPrevAllowed(state.actor.player)).toBe(false);
  });

  it("taking the last of a floor pile disables repeat (obj-pile.c:856)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const obj = thing("Potion of Gone");
    floorCarry(state, state.actor.grid, obj);
    state.actor.player.upkeep.repeatPrevAllowed = true;

    floorObjectForUse(state, obj, 1);

    expect(repeatPrevAllowed(state.actor.player)).toBe(false);
  });
});

describe("cmd_disable_repeat_floor_item, and the wrong object it prevents", () => {
  /**
   * THE TEST THIS ITEM IS FOR. Two objects on the player's grid; a command that
   * addressed `floor: 0`; then the first one is consumed. Index 0 now names the
   * SECOND object - so a repeat is not a no-op, it acts on something else.
   *
   * Asserted as "the index re-binds" first, because if that were false the whole
   * justification for the guard in this port would be wrong, and only then as
   * "and the guard refuses".
   */
  it("index 0 re-binds when the pile shifts, which is why the guard is needed", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const first = thing("Potion of First");
    const second = thing("Potion of Second");
    floorCarry(state, state.actor.grid, first);
    floorCarry(state, state.actor.grid, second);
    expect(floorPile(state, state.actor.grid)).toHaveLength(2);
    const at0 = (): GameObject | undefined =>
      floorPile(state, state.actor.grid)[0];
    const before = at0();

    floorObjectForUse(state, before!, 1);

    const after = at0();
    expect(after, "the pile still has an index 0").toBeDefined();
    expect(after, "and it is a DIFFERENT object").not.toBe(before);
  });

  it("only fires when the remembered command used a floor item", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const registry = new ActionRegistry();
    registry.register("noop", (s) => s.z.moveEnergy);

    /* A pack command: args.handle, not args.floor. */
    runOne(state, registry, { code: "noop", args: { handle: 1 } });
    cmdDisableRepeatFloorItem(state.actor.player);
    expect(
      repeatPrevAllowed(state.actor.player),
      "a pack command is unaffected",
    ).toBe(true);

    /* A floor command. */
    runOne(state, registry, { code: "noop", args: { floor: 0 } });
    cmdDisableRepeatFloorItem(state.actor.player);
    expect(repeatPrevAllowed(state.actor.player)).toBe(false);
  });

  it("the player changing grid disables it (monster_swap, mon-util.c:624)", () => {
    /* "Don't allow command repeat if moved away from item used." Walk one step
     * after using something off the floor and the remembered index points into a
     * pile the player is no longer standing on. */
    const state = makeState({ playerGrid: loc(5, 5) });
    const registry = new ActionRegistry();
    registry.register("noop", (s) => s.z.moveEnergy);
    runOne(state, registry, { code: "noop", args: { floor: 0 } });
    expect(repeatPrevAllowed(state.actor.player)).toBe(true);

    /* A swap with an adjacent monster moves the player. */
    const mon = addMon(state, makeRace(), loc(6, 5));
    monsterSwap(state, state.actor.grid, mon.grid);
    expect(state.actor.grid, "the fixture really moved the player").toEqual(
      loc(6, 5),
    );

    expect(repeatPrevAllowed(state.actor.player)).toBe(false);
  });

  it("disables it on the OTHER swap branch too (mon-util.c:671)", () => {
    /* monster_swap has two mirrored player branches - player at grid1 and player
     * at grid2 - and each has its own cmd_disable_repeat_floor_item. Deleting the
     * second one killed no test until this existed, because every other test here
     * enters through the first. Same shape as the two-copies-of-a-check trap: the
     * arguments decide which branch runs, so the branch has to be chosen on
     * purpose. */
    const state = makeState({ playerGrid: loc(5, 5) });
    const registry = new ActionRegistry();
    registry.register("noop", (s) => s.z.moveEnergy);
    runOne(state, registry, { code: "noop", args: { floor: 0 } });
    const mon = addMon(state, makeRace(), loc(6, 5));

    /* Arguments reversed relative to the test above, so the PLAYER is grid2. */
    monsterSwap(state, mon.grid, state.actor.grid);
    expect(state.actor.grid, "the fixture really moved the player").toEqual(
      loc(6, 5),
    );

    expect(repeatPrevAllowed(state.actor.player)).toBe(false);
  });
});

describe("cmd_get_target's re-validation, which a repeat has to run again", () => {
  /*
   * Reported from play: "Firing an arrow when my target leaves my view should
   * ask for another target or a direction, but instead, it just fires and
   * misses." Upstream never stores an answer to that question - cmd_get_target
   * re-asks it every execution (cmd-core.c:955-969) - so a repeat of an aimed
   * command re-prompts once the target stops validating. The port replayed the
   * stored 5, and rangedHelper's non-target branch aims at DDX[5]/DDY[5], which
   * are both 0: an arrow into the player's own grid.
   *
   * The prompt is the shell's, so what is testable here is which slots a repeat
   * would have to ask about, and that the answer is written back without
   * touching the remembered command.
   */
  it("finds a stored DIR_TARGET wherever the three command shapes keep it", () => {
    /* cmd.dir: the plain aimed commands. */
    expect(repeatDirSlots({ code: "fire", dir: 5 })).toEqual(["dir"]);
    /* args.dir: the item verbs (dispatchItemVerb). */
    expect(repeatDirSlots({ code: "aim-wand", args: { handle: 3, dir: 5 } })).toEqual([
      "args.dir",
    ]);
    /* args.tgtdir: a get_aim_dir a HANDLER asks inside an effect. */
    expect(repeatDirSlots({ code: "cast", args: { tgtdir: 5 } })).toEqual([
      "args.tgtdir",
    ]);
    /* All at once - a command may carry more than one, and upstream re-asks
     * about each argument separately. */
    expect(
      repeatDirSlots({ code: "cast", dir: 5, args: { dir: 5, tgtdir: 5 } }),
    ).toEqual(["dir", "args.dir", "args.tgtdir"]);
  });

  it("says nothing about a compass direction, which never needed a target", () => {
    /* `if (dir != DIR_TARGET || target_okay())` - a real direction short-circuits
     * before target_okay is ever consulted, so repeating a throw to the north
     * must not open a prompt. */
    for (const dir of [1, 2, 3, 4, 6, 7, 8, 9]) {
      expect(repeatDirSlots({ code: "fire", dir })).toEqual([]);
      expect(repeatDirSlots({ code: "fire", args: { dir } })).toEqual([]);
    }
    expect(repeatDirSlots({ code: "walk", dir: 5 })).toEqual(["dir"]);
    expect(repeatDirSlots({ code: "quaff", args: { handle: 1 } })).toEqual([]);
    expect(repeatDirSlots({ code: "hold" })).toEqual([]);
  });

  it("writes the new direction back WITHOUT editing the remembered command", () => {
    /* The remembered command outlives the prompt. Editing it in place would mean
     * a re-prompt the player escaped had still changed what 'n' does next time -
     * upstream's cmd_set_arg_target writes to the queued COPY. */
    const remembered = Object.freeze({
      code: "fire",
      dir: 5,
      args: Object.freeze({ handle: 7, dir: 5, tgtdir: 5 }),
    });

    const byDir = withRepeatDir(remembered, "dir", 4);
    expect(byDir.dir).toBe(4);
    expect(byDir.args).toEqual({ handle: 7, dir: 5, tgtdir: 5 });

    const byArg = withRepeatDir(remembered, "args.dir", 6);
    expect(byArg.dir).toBe(5);
    expect(byArg.args).toEqual({ handle: 7, dir: 6, tgtdir: 5 });

    const byTgt = withRepeatDir(remembered, "args.tgtdir", 2);
    expect(byTgt.args).toEqual({ handle: 7, dir: 5, tgtdir: 2 });

    /* The original is untouched by all three. */
    expect(remembered.dir).toBe(5);
    expect(remembered.args).toEqual({ handle: 7, dir: 5, tgtdir: 5 });
  });

  it("gives an args-less command an args bag rather than dropping the answer", () => {
    const filled = withRepeatDir({ code: "aim-wand", dir: 5 }, "args.dir", 8);
    expect(filled.args).toEqual({ dir: 8 });
  });
});

describe("what is NOT wired, stated rather than implied", () => {
  it("a fresh state starts with repeat disallowed (cmd-core.c:260)", () => {
    /* The static's initialiser. It matters on load too: save.ts resets it, so a
     * loaded character cannot repeat a command from a previous session. */
    const state = makeState({ playerGrid: loc(5, 5) });
    expect(repeatPrevAllowed(state.actor.player)).toBe(false);
  });

  it("keeps the transients OUT of the savefile", () => {
    /* save.ts used to spread the whole upkeep, so notice / dropping /
     * repeatPrevAllowed / lastCmdUsedFloorItem all leaked into the save format
     * while the declared type said three fields. The type never objected: a
     * spread satisfies a narrower type by supplying MORE. Guarded in
     * session/save-fields.test.ts (the round-trip), noted here because this is
     * the change that exposed it. */
    const state = makeState({ playerGrid: loc(5, 5) });
    state.chunk.setFeat(loc(5, 5), FEAT.FLOOR);
    expect(Object.keys(state.actor.player.upkeep).sort()).toEqual([
      "dropping",
      "lastCmdUsedFloorItem",
      "newSpells",
      "notice",
      "playing",
      "repeatPrevAllowed",
      "totalWeight",
    ]);
  });
});
