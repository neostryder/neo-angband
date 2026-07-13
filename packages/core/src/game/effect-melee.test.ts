import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EF, MFLAG, PROJ, RF, TMD } from "../generated";
import { loc, locEq } from "../loc";
import { distance } from "../loc";
import {
  EffectRegistry,
  sourcePlayer,
} from "../effects/interpreter";
import type { EffectContext, EffectPlayer } from "../effects/interpreter";
import { registerCoreHandlers } from "../effects/handlers";
import { bindProjections } from "../world/projection";
import type { ProjectionRecordJson } from "../world/projection";
import type { Monster } from "../mon/monster";
import { addMon, makeRace, makeState } from "./harness";
import type { GameState } from "./context";
import { basicPlayerActor } from "./project-cast";
import type { CastContext } from "./project-cast";
import { attachGameEnv } from "./effect-game-env";
import type { GameEffectEnv } from "./effect-game-env";
import { closestTarget, registerMeleeHandlers } from "./effect-melee";
import { monsterIsUndead } from "../mon/predicate";

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
  registerMeleeHandlers(r);
  return r;
}

/** A minimal player env backing the hp / mana / timed sinks. */
function playerEnv(state: GameState): EffectPlayer {
  const p = state.actor.player;
  return {
    hp: p,
    mana: p,
    timed: {
      timed: (i) => p.timed[i] ?? 0,
      setTimed: (i, v) => {
        p.timed[i] = v;
        return true;
      },
      incTimed: (i, v) => {
        p.timed[i] = (p.timed[i] ?? 0) + v;
        return true;
      },
      decTimed: (i, v) => {
        p.timed[i] = Math.max(0, (p.timed[i] ?? 0) - v);
        return true;
      },
      clearTimed: (i) => {
        p.timed[i] = 0;
        return true;
      },
    },
    applyDamageReduction: (dam) => dam,
    takeHit: (dam) => {
      p.chp -= dam;
    },
  };
}

function castContext(state: GameState): CastContext {
  return { projections, maxRange: 20, playerActor: basicPlayerActor(state) };
}

function env(
  state: GameState,
  msgs?: string[],
  game: Partial<GameEffectEnv> = {},
): EffectContext {
  const base: EffectContext = {
    rng: state.rng,
    player: playerEnv(state),
    ...(msgs ? { messages: { msg: (t: string) => msgs.push(t) } } : {}),
  };
  return attachGameEnv(base, { state, cast: castContext(state), ...game });
}

/** A visible monster of the given race flags. */
function addVisible(
  state: GameState,
  at: ReturnType<typeof loc>,
  flags: number[] = [],
  hp = 60,
): Monster {
  const mon = addMon(state, makeRace({ flags }), at, { hp });
  mon.mflag.on(MFLAG.VISIBLE);
  return mon;
}

describe("closestTarget (target_set_closest reduced)", () => {
  it("finds the closest visible monster matching the predicate", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    addVisible(state, loc(20, 10), [RF.UNDEAD]);
    const near = addVisible(state, loc(13, 10), [RF.UNDEAD]);
    addVisible(state, loc(12, 10)); /* closer but living */
    expect(closestTarget(state, monsterIsUndead)).toBe(near);
  });

  it("ignores invisible monsters", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    addMon(state, makeRace({ flags: [RF.UNDEAD] }), loc(13, 10), { hp: 30 });
    expect(closestTarget(state, monsterIsUndead)).toBeNull();
  });
});

describe("EF_TAP_UNLIFE (effect-handler-attack.c L1615)", () => {
  it("drains the closest undead into mana", () => {
    const state = makeState({ playerGrid: loc(10, 10), seed: 3 });
    const p = state.actor.player;
    p.msp = 50;
    p.csp = 0;
    const mon = addVisible(state, loc(13, 10), [RF.UNDEAD], 100);
    const msgs: string[] = [];
    const used = registry().effectSimple(EF.TAP_UNLIFE, env(state, msgs), {
      origin: sourcePlayer(),
      diceString: "40",
    });
    expect(used).toBe(true);
    expect(mon.hp).toBe(60);
    /* drain = min(100, 40) / 4 = 10 mana. */
    expect(p.csp).toBe(10);
    expect(msgs.some((m) => m.startsWith("You draw power from"))).toBe(true);
  });

  it("fails without an undead in sight", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    addVisible(state, loc(13, 10)); /* living */
    const used = registry().effectSimple(EF.TAP_UNLIFE, env(state), {
      origin: sourcePlayer(),
      diceString: "40",
    });
    expect(used).toBe(false);
  });
});

describe("EF_CURSE (effect-handler-attack.c L1665)", () => {
  it("damages the targeted monster directly", () => {
    const state = makeState({ playerGrid: loc(10, 10), seed: 3 });
    const mon = addVisible(state, loc(14, 10), [], 50);
    registry().effectSimple(
      EF.CURSE,
      env(state, undefined, { aimed: loc(14, 10) }),
      { origin: sourcePlayer(), diceString: "20" },
    );
    expect(mon.hp).toBe(30);
  });

  it("kills outright and rewards the player", () => {
    const state = makeState({ playerGrid: loc(10, 10), seed: 3 });
    const mon = addVisible(state, loc(14, 10), [], 20);
    let kills = 0;
    state.onPlayerKill = (): void => {
      kills++;
    };
    const msgs: string[] = [];
    registry().effectSimple(
      EF.CURSE,
      env(state, msgs, { aimed: loc(14, 10) }),
      { origin: sourcePlayer(), diceString: "50" },
    );
    expect(state.monsters[mon.midx]).toBeNull();
    expect(kills).toBe(1);
    expect(msgs.some((m) => m.endsWith(" dies!"))).toBe(true);
  });

  it("needs a chosen monster", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const msgs: string[] = [];
    const used = registry().effectSimple(EF.CURSE, env(state, msgs), {
      origin: sourcePlayer(),
      diceString: "20",
    });
    expect(used).toBe(false);
    expect(msgs).toContain("No monster selected!");
  });

  it("reveals a camouflaged monster hit directly (aimed grid) via mon_take_hit's becomeAware hook", () => {
    const state = makeState({ playerGrid: loc(10, 10), seed: 3 });
    const mon = addVisible(state, loc(14, 10), [], 50);
    mon.mflag.on(MFLAG.CAMOUFLAGE);
    let revealed: number | null = null;
    state.becomeAware = (m) => {
      revealed = m.midx;
    };
    registry().effectSimple(
      EF.CURSE,
      env(state, undefined, { aimed: loc(14, 10) }),
      { origin: sourcePlayer(), diceString: "20" },
    );
    expect(revealed).toBe(mon.midx);
    expect(mon.hp).toBe(30);
  });
});

describe("EF_JUMP_AND_BITE (effect-handler-attack.c L1710)", () => {
  it("jumps adjacent to the closest living monster and drains it", () => {
    const state = makeState({ playerGrid: loc(10, 10), seed: 3 });
    const p = state.actor.player;
    p.chp = 500; /* hurt, so the bite heals */
    const mon = addVisible(state, loc(16, 10), [], 80);
    const msgs: string[] = [];
    const used = registry().effectSimple(EF.JUMP_AND_BITE, env(state, msgs), {
      origin: sourcePlayer(),
      diceString: "30",
    });
    expect(used).toBe(true);
    /* The player landed next to the victim... */
    expect(distance(state.actor.grid, loc(16, 10))).toBe(1);
    /* ...bit it for the full amount... */
    expect(mon.hp).toBe(50);
    expect(msgs.some((m) => m.startsWith("You bite"))).toBe(true);
    /* ...and healed and fed on the drain (min(hp+1, 30) = 30). */
    expect(p.chp).toBe(530);
    expect(p.timed[TMD.FOOD]).toBe(30);
  });

  it("fails with no living monster in sight", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const used = registry().effectSimple(EF.JUMP_AND_BITE, env(state), {
      origin: sourcePlayer(),
      diceString: "30",
    });
    expect(used).toBe(false);
    expect(locEq(state.actor.grid, loc(10, 10))).toBe(true);
  });
});

describe("EF_MELEE_BLOWS (effect-handler-attack.c L1907)", () => {
  it("lands blows on an adjacent monster with elemental side effects", () => {
    const state = makeState({ playerGrid: loc(10, 10), seed: 3 });
    const mon = addVisible(state, loc(11, 10), [], 200);
    const used = registry().effectSimple(
      EF.MELEE_BLOWS,
      env(state, undefined, { aimed: loc(11, 10) }),
      {
        origin: sourcePlayer(),
        diceString: "3",
        radius: 5,
        subtype: PROJ.FIRE,
      },
    );
    expect(used).toBe(true);
    /* Unarmed blows at +10 to-dam land reliably with the harness combat. */
    expect(mon.hp).toBeLessThan(200);
  });

  it("refuses a distant target with its message", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    addVisible(state, loc(15, 10));
    const msgs: string[] = [];
    const used = registry().effectSimple(
      EF.MELEE_BLOWS,
      env(state, msgs, { aimed: loc(15, 10) }),
      { origin: sourcePlayer(), diceString: "3", subtype: PROJ.FIRE },
    );
    expect(used).toBe(false);
    expect(msgs).toContain("Target too far away (5).");
  });

  it("must attack a monster", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const msgs: string[] = [];
    const used = registry().effectSimple(
      EF.MELEE_BLOWS,
      env(state, msgs, { aimed: loc(11, 10) }),
      { origin: sourcePlayer(), diceString: "3", subtype: PROJ.FIRE },
    );
    expect(used).toBe(false);
    expect(msgs).toContain("You must attack a monster.");
  });
});

describe("EF_SWEEP (effect-handler-attack.c L1955)", () => {
  it("strikes every adjacent monster", () => {
    const state = makeState({ playerGrid: loc(10, 10), seed: 3 });
    const a = addVisible(state, loc(11, 10), [], 200);
    const b = addVisible(state, loc(9, 9), [], 200);
    const far = addVisible(state, loc(14, 10), [], 200);
    registry().effectSimple(EF.SWEEP, env(state), {
      origin: sourcePlayer(),
      diceString: "2",
    });
    expect(a.hp).toBeLessThan(200);
    expect(b.hp).toBeLessThan(200);
    expect(far.hp).toBe(200);
  });
});

describe("EF_MOVE_ATTACK (effect-handler-attack.c L1785)", () => {
  it("closes the distance and unloads blows (seed sweep)", () => {
    let hurt = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const state = makeState({ playerGrid: loc(10, 10), seed });
      const mon = addVisible(state, loc(13, 10), [], 400);
      const used = registry().effectSimple(
        EF.MOVE_ATTACK,
        env(state, undefined, { aimed: loc(13, 10) }),
        { origin: sourcePlayer(), diceString: "4" },
      );
      expect(used).toBe(true);
      /* Two steps in: adjacent to the target, every seed. */
      expect(distance(state.actor.grid, loc(13, 10))).toBe(1);
      /* Blows scaled by remaining moves: (4 * 2 + 2) / 4 = 2 blows. */
      if (mon.hp < 400) hurt++;
    }
    expect(hurt).toBeGreaterThan(0);
  });

  it("must target a monster", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const msgs: string[] = [];
    const used = registry().effectSimple(
      EF.MOVE_ATTACK,
      env(state, msgs, { aimed: loc(13, 10) }),
      { origin: sourcePlayer(), diceString: "4" },
    );
    expect(used).toBe(false);
    expect(msgs).toContain("This spell must target a monster.");
  });
});
