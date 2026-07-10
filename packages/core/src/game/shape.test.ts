import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EF, ELEM, MON_TMD, OF, PF } from "../generated";
import { OBJ_MOD } from "../generated";
import { loc } from "../loc";
import { Rng } from "../rng";
import { EffectRegistry, sourcePlayer } from "../effects/interpreter";
import type { EffectContext } from "../effects/interpreter";
import { registerCoreHandlers } from "../effects/handlers";
import { bindProjections } from "../world/projection";
import type { ProjectionRecordJson } from "../world/projection";
import { SKILL } from "../player/types";
import { calcBonuses } from "../player/calcs";
import { blankMonster } from "../mon/monster";
import { monIncTimed, monSetTimed } from "../mon/timed";
import type { MonShapeHooks } from "../mon/timed";
import { addMon, makeRace, makeState, plReg } from "./harness";
import type { GameState } from "./context";
import { basicPlayerActor } from "./project-cast";
import { attachGameEnv } from "./effect-game-env";
import { registerGeneralHandlers } from "./effect-general";
import {
  playerGetResumeNormalShape,
  playerIsShapechanged,
  playerResumeNormalShape,
} from "./obj-cmd";
import { monsterChangeShape, monsterRevertShape } from "./mon-shape";

const projections = bindProjections(
  (
    JSON.parse(
      readFileSync(
        new URL("../../../content/pack/projection.json", import.meta.url),
        "utf8",
      ),
    ) as { records: ProjectionRecordJson[] }
  ).records,
);

function registry(): EffectRegistry {
  const r = new EffectRegistry();
  registerCoreHandlers(r);
  registerGeneralHandlers(r);
  return r;
}

function env(state: GameState, msgs?: string[]): EffectContext {
  return attachGameEnv(
    {
      rng: state.rng,
      ...(msgs ? { messages: { msg: (t: string) => msgs.push(t) } } : {}),
    },
    {
      state,
      cast: { projections, maxRange: 20, playerActor: basicPlayerActor(state) },
      general: { shapes: plReg.shapes },
    },
  );
}

const fox = plReg.shapes.find((s) => s.name === "fox")!;
const pukel = plReg.shapes.find((s) => s.name === "Pukel-man")!;

describe("shape binding (init.c parse_shape_*)", () => {
  it("binds the fox's combat, flags and modifiers", () => {
    expect(fox.toH).toBe(-3);
    expect(fox.toA).toBe(3);
    expect(fox.flags.has(OF.FEATHER)).toBe(true);
    expect(fox.flags.has(OF.FREE_ACT)).toBe(true);
    expect(fox.modifiers[0]).toBe(-3); /* STR[-3] */
    expect(fox.modifiers[OBJ_MOD.STEALTH]).toBe(5);
    expect(fox.blows).toContain("bite");
  });

  it("binds the Pukel-man's skills, player flags, resists and effect", () => {
    expect(pukel.skills[SKILL.SAVE]).toBe(20);
    expect(pukel.pflags.has(PF.ROCK)).toBe(true);
    expect(pukel.elInfo[ELEM.POIS]?.resLevel).toBe(3);
    expect(pukel.modifiers[OBJ_MOD.DAM_RED]).toBe(10);
    expect(pukel.effects.some((e) => e.eff === "CURE")).toBe(true);
  });
});

describe("calc_shapechange (player-calcs.c L1798)", () => {
  it("a fox form stacks its package onto the state", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const p = state.actor.player;
    const normal = calcBonuses(p, {});
    p.shape = fox;
    const shaped = calcBonuses(p, {});

    expect(shaped.toH).toBe(normal.toH - 3);
    expect(shaped.toA).toBe(normal.toA + 3);
    expect(shaped.skills[SKILL.STEALTH]).toBe(
      (normal.skills[SKILL.STEALTH] ?? 0) + 5,
    );
    expect(shaped.statAdd[0]).toBe((normal.statAdd[0] ?? 0) - 3);
    expect(shaped.flags.has(OF.FREE_ACT)).toBe(true);
  });

  it("a Pukel-man resists poison and reduces damage", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const p = state.actor.player;
    p.shape = pukel;
    const shaped = calcBonuses(p, {});
    expect(shaped.elInfo[ELEM.POIS]?.resLevel).toBe(3);
    expect(shaped.damRed).toBe(10);
    expect(shaped.pflags.has(PF.ROCK)).toBe(true);
  });
});

describe("EF_SHAPECHANGE (effect-handler-general.c L3449)", () => {
  it("assumes the shape, runs its effect and refreshes bonuses", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const p = state.actor.player;
    let refreshed = false;
    state.updateBonuses = () => {
      refreshed = true;
    };
    const msgs: string[] = [];
    const used = registry().effectSimple(EF.SHAPECHANGE, env(state, msgs), {
      origin: sourcePlayer(),
      subtype: fox.sidx,
    });
    expect(used).toBe(true);
    expect(p.shape).toBe(fox);
    expect(msgs).toContain("You assume the shape of a fox!");
    expect(msgs).toContain("Your gear merges into your body.");
    expect(refreshed).toBe(true);
  });
});

describe("resume normal shape (player-util.c L1022)", () => {
  it("a gated action returns the player to normal form first", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const p = state.actor.player;
    p.shape = fox;
    expect(playerIsShapechanged(state)).toBe(true);

    const msgs: string[] = [];
    const ok = playerGetResumeNormalShape(state, { msg: (t) => msgs.push(t) });
    expect(ok).toBe(true);
    expect(p.shape).toBeNull();
    expect(msgs).toContain("You cannot do this while in fox form.");
    expect(msgs).toContain("You resume your usual shape.");
  });

  it("a declined prompt blocks the action and keeps the form", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    state.actor.player.shape = fox;
    const ok = playerGetResumeNormalShape(state, { confirm: () => false });
    expect(ok).toBe(false);
    expect(playerIsShapechanged(state)).toBe(true);
  });

  it("resume is a no-op gate for a normal player", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    expect(playerGetResumeNormalShape(state)).toBe(true);
    playerResumeNormalShape(state);
    expect(state.actor.player.shape).toBeNull();
  });
});

describe("monster_change_shape / monster_revert_shape (mon-util.c L1590)", () => {
  it("a preferred-shape monster swaps race, speed and back", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const wolfish = makeRace({ level: 5, speed: 120 });
    const race = makeRace({ level: 5, speed: 110 });
    race.shapes = [{ name: wolfish.name, race: wolfish, base: null }];
    const mon = addMon(state, race, loc(14, 10), { hp: 50 });

    expect(monsterChangeShape(state, mon)).toBe(true);
    expect(mon.race).toBe(wolfish);
    expect(mon.originalRace).toBe(race);
    expect(mon.mspeed).toBe(120);

    expect(monsterRevertShape(state, mon)).toBe(true);
    expect(mon.race).toBe(race);
    expect(mon.originalRace).toBeNull();
    expect(mon.mspeed).toBe(110);
  });

  it("reverting an unshaped monster is a no-op", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const mon = addMon(state, makeRace(), loc(14, 10), { hp: 50 });
    expect(monsterRevertShape(state, mon)).toBe(false);
  });
});

describe("the MON_TMD_CHANGED timer (mon-timed.c L195)", () => {
  it("raising the timer changes shape; a failure restores it", () => {
    const rng = new Rng(5);
    const mon = blankMonster(makeRace());
    mon.midx = 1;
    let changed = 0;
    const hooks: MonShapeHooks = {
      change: () => {
        changed++;
        return true;
      },
      revert: () => true,
    };
    monIncTimed(rng, mon, MON_TMD.CHANGED, 8, 0, undefined, hooks);
    expect(changed).toBe(1);
    expect(mon.mTimed[MON_TMD.CHANGED]).toBeGreaterThan(0);

    /* A failed change restores the old timer. */
    const failMon = blankMonster(makeRace());
    failMon.midx = 2;
    monSetTimed(rng, failMon, MON_TMD.CHANGED, 8, 0, undefined, {
      change: () => false,
      revert: () => true,
    });
    expect(failMon.mTimed[MON_TMD.CHANGED]).toBe(0);
  });

  it("the timer running out reverts the shape", () => {
    const rng = new Rng(5);
    const mon = blankMonster(makeRace());
    mon.midx = 1;
    mon.mTimed[MON_TMD.CHANGED] = 3;
    let reverted = false;
    monSetTimed(rng, mon, MON_TMD.CHANGED, 0, 0, undefined, {
      change: () => true,
      revert: () => {
        reverted = true;
        return true;
      },
    });
    expect(reverted).toBe(true);
    expect(mon.mTimed[MON_TMD.CHANGED]).toBe(0);
  });
});
