/**
 * Locks gaps 2.4 (ranged), 2.6 and 2.7, ported from
 * reference/src/player-attack.c (Angband 4.2.6):
 * - 2.7: TMD_POWERSHOT piercing (player-attack.c:1092-1095): a sharp missile
 *   pierces ammo_mult monsters (pierce-- / continue at L1198-1201), and the
 *   stance clears after the shot (player-attack.c:1217-1219).
 * - 2.6: the ranged to-hit distance penalty uses the ay + ax/2 metric
 *   (cave-view.c:38-46, distance() at player-attack.c:162), not the Chebyshev
 *   maximum - a marginal diagonal shot that Chebyshev would land misses.
 * - 2.4: a surviving ranged target rolls fear through mon_take_hit and prints
 *   message_pain + the "flees in terror" line (player-attack.c:1191-1195).
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MFLAG, TMD, TV } from "../generated";
import { loc } from "../loc";
import { ObjRegistry } from "../obj/bind";
import type { ObjPackJson, ObjectKind } from "../obj/types";
import { objectNew } from "../obj/object";
import type { GameObject } from "../obj/object";
import { SKILL } from "../player/types";
import { createDefaultRegistry } from "./player-turn";
import { installRangedCommands } from "./ranged-cmd";
import { gearAdd } from "./gear";
import type { GameState } from "./context";
import { addMon, makeRace, makeState } from "./harness";

function load(name: string): unknown {
  return JSON.parse(
    readFileSync(
      new URL(`../../../content/pack/${name}.json`, import.meta.url),
      "utf8",
    ),
  );
}

const objReg = new ObjRegistry({
  objectBase: load("object_base"),
  object: load("object"),
  egoItem: load("ego_item"),
  artifact: load("artifact"),
  curse: load("curse"),
  brand: load("brand"),
  slay: load("slay"),
  activation: load("activation"),
  objectProperty: load("object_property"),
  flavor: load("flavor"),
} as ObjPackJson);

function kindOfTval(tval: number): ObjectKind {
  const k = objReg.kinds.find((kk): kk is ObjectKind => kk !== null && kk.tval === tval);
  if (!k) throw new Error(`no kind for tval ${tval}`);
  return k;
}

/** An object of the kind with its identity fields stamped (objectPrep slice). */
function bareObject(tval: number): GameObject {
  const kind = kindOfTval(tval);
  const o = objectNew(kind);
  o.tval = kind.tval;
  o.sval = kind.sval;
  o.dd = kind.dd;
  o.ds = kind.ds;
  o.weight = kind.weight;
  o.number = 1;
  return o;
}

/** Equip a bow and carry a stack of arrows; returns the ammo gear handle. */
function armArcher(state: GameState): number {
  const p = state.actor.player;
  const bow = bareObject(TV.BOW);
  const bowHandle = gearAdd(state.gear, bow);
  const bowSlot = p.body.slots.findIndex((s) => s.type === "BOW");
  p.equipment[bowSlot] = bowHandle;

  const arrows = bareObject(TV.ARROW);
  arrows.number = 10;
  const handle = gearAdd(state.gear, arrows);

  state.actor.combat.ammoTval = TV.ARROW;
  state.actor.combat.numShots = 20; /* range 6 + 2 * 2 = 10 */
  return handle;
}

function fire(state: GameState, handle: number, dir: number): void {
  const registry = createDefaultRegistry();
  installRangedCommands(registry);
  registry.get("fire")!(state, { code: "fire", args: { handle, dir } });
}

describe("TMD_POWERSHOT piercing (player-attack.c:1092-1095,1198-1201, gap 2.7)", () => {
  it("a sharp missile pierces ammo_mult monsters and the stance clears", () => {
    const state = makeState({ playerGrid: loc(5, 10) });
    const handle = armArcher(state);
    state.actor.combat.ammoMult = 3;
    state.actor.player.timed[TMD.POWERSHOT] = 10;
    const near = addMon(state, makeRace({ ac: 0 }), loc(7, 10), { hp: 5000 });
    const far = addMon(state, makeRace({ ac: 0 }), loc(9, 10), { hp: 5000 });
    state.rng.randFix(100); /* every shot hits */

    fire(state, handle, 6);
    expect(near.hp).toBeLessThan(5000);
    expect(far.hp).toBeLessThan(5000);
    /* Terminate piercing (player-attack.c:1217-1219). */
    expect(state.actor.player.timed[TMD.POWERSHOT]).toBe(0);
  });

  it("without POWERSHOT the missile stops at the first monster", () => {
    const state = makeState({ playerGrid: loc(5, 10) });
    const handle = armArcher(state);
    state.actor.combat.ammoMult = 3;
    const near = addMon(state, makeRace({ ac: 0 }), loc(7, 10), { hp: 5000 });
    const far = addMon(state, makeRace({ ac: 0 }), loc(9, 10), { hp: 5000 });
    state.rng.randFix(100);

    fire(state, handle, 6);
    expect(near.hp).toBeLessThan(5000);
    expect(far.hp).toBe(5000);
  });
});

describe("ranged to-hit distance metric (cave-view.c:38-46, gap 2.6)", () => {
  /**
   * Marginal diagonal shot: base chance = SKILL_TO_HIT_BOW (20), monster at
   * (+6,+6). ay + ax/2 distance = 9 -> chance 11 -> hit needs a 10000-scaled
   * roll >= 6537; the Chebyshev distance (6 -> chance 14) would need only
   * >= 5243. rand_fix 60 rolls 5999: a hit under Chebyshev, a MISS under the
   * faithful metric.
   */
  it("a marginal diagonal shot misses under the ay + ax/2 penalty", () => {
    const msgs: string[] = [];
    const state = makeState({ playerGrid: loc(5, 5), w: 30, h: 30 });
    state.msg = (t): void => {
      msgs.push(t);
    };
    const handle = armArcher(state);
    const skills = new Array<number>(10).fill(0);
    skills[SKILL.TO_HIT_BOW] = 20;
    state.actor.combat.skills = skills;
    state.actor.combat.toH = 0;
    const mon = addMon(state, makeRace({ ac: 12 }), loc(11, 11), { hp: 5000 });
    mon.mflag.on(MFLAG.VISIBLE); /* obvious: no unseen halving */
    state.rng.randFix(60);

    fire(state, handle, 3); /* south-east */
    expect(mon.hp).toBe(5000);
    expect(msgs.some((m) => m.includes("misses"))).toBe(true);
  });
});

describe("ranged fear + pain messages (player-attack.c:1191-1195, gap 2.4)", () => {
  it("a surviving low-hp target takes a pain line and can flee in terror", () => {
    const msgs: string[] = [];
    const state = makeState({ playerGrid: loc(5, 10) });
    state.msg = (t): void => {
      msgs.push(t);
    };
    const handle = armArcher(state);
    const mon = addMon(state, makeRace({ ac: 0 }), loc(7, 10), { hp: 1000 });
    mon.hp = 100; /* low hp: the fear save fails at rand_fix 100 */
    mon.mflag.on(MFLAG.VISIBLE);
    state.rng.randFix(100);

    fire(state, handle, 6);
    expect(mon.hp).toBeLessThan(100);
    expect(mon.hp).toBeGreaterThan(0);
    /* message_pain fired (a line beyond the hit message)... */
    expect(msgs.length).toBeGreaterThan(1);
    /* ...and the new fright printed the flee line. */
    expect(msgs.some((m) => m.includes("flees in terror"))).toBe(true);
  });
});
