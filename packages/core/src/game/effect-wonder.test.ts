import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EF, MFLAG } from "../generated";
import { loc } from "../loc";
import { Rng } from "../rng";
import { EffectRegistry, sourcePlayer } from "../effects/interpreter";
import type { EffectContext, EffectPlayer } from "../effects/interpreter";
import { registerCoreHandlers } from "../effects/handlers";
import { bindProjections } from "../world/projection";
import type { ProjectionRecordJson } from "../world/projection";
import { addMon, makeRace, makeState } from "./harness";
import type { GameState } from "./context";
import { basicPlayerActor } from "./project-cast";
import { attachGameEnv } from "./effect-game-env";
import type { GameEffectEnv } from "./effect-game-env";
import { registerAttackHandlers } from "./effect-attack";
import { registerGeneralHandlers } from "./effect-general";

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
  registerAttackHandlers(r);
  registerGeneralHandlers(r);
  return r;
}

function playerEnv(state: GameState): EffectPlayer {
  const p = state.actor.player;
  return {
    hp: p,
    mana: p,
    applyDamageReduction: (dam) => dam,
    takeHit: (dam) => {
      p.chp -= dam;
    },
  };
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
  return attachGameEnv(base, {
    state,
    cast: { projections, maxRange: 20, playerActor: basicPlayerActor(state) },
    ...game,
  });
}

describe("EF_WONDER (effect-handler-attack.c L1988)", () => {
  it("a mid die dispatches a poison ball at the target", () => {
    const state = makeState({ playerGrid: loc(10, 10), seed: 5 });
    const mon = addMon(state, makeRace(), loc(14, 10), { hp: 200 });
    mon.mflag.on(MFLAG.VISIBLE);

    /* die 45: PROJ_POIS ball, base 20 + plev/2, radius 3. */
    const used = registry().effectSimple(
      EF.WONDER,
      env(state, undefined, { aimed: mon.grid }),
      { origin: sourcePlayer(), diceString: "45" },
    );

    expect(used).toBe(true);
    expect(mon.hp).toBeLessThan(200);
  });

  it("a very rare die surges power and heals the player", () => {
    const state = makeState({ playerGrid: loc(10, 10), seed: 5 });
    const p = state.actor.player;
    p.chp = 100; /* hurt: the tail's EF_HEAL_HP 300 is observable */

    const msgs: string[] = [];
    const used = registry().effectSimple(EF.WONDER, env(state, msgs), {
      origin: sourcePlayer(),
      diceString: "110",
    });

    expect(used).toBe(true);
    expect(msgs).toContain("You feel a surge of power!");
    expect(p.chp).toBeGreaterThan(100);
  });
});

describe("EF_BIZARRE (effect-handler-general.c L3516)", () => {
  /** First seeds whose opening randint1(10) picks the wanted case. */
  function seedFor(pred: (roll: number) => boolean): number {
    for (let s = 1; s < 1000; s++) {
      if (pred(new Rng(s).randint1(10))) return s;
    }
    throw new Error("no seed found");
  }

  it("the malignant aura drains all stats and experience", () => {
    const seed = seedFor((r) => r <= 2);
    const state = makeState({ playerGrid: loc(10, 10), seed });
    const p = state.actor.player;
    p.exp = 400;
    p.maxExp = 400;
    for (let stat = 0; stat < 5; stat++) {
      p.statCur[stat] = 10;
      p.statMax[stat] = 10;
    }
    const strBefore = p.statCur[0]!;

    const msgs: string[] = [];
    const used = registry().effectSimple(EF.BIZARRE, env(state, msgs), {
      origin: sourcePlayer(),
    });

    expect(used).toBe(true);
    expect(msgs).toContain("You are surrounded by a malignant aura.");
    expect(p.statCur[0]!).toBeLessThan(strBefore);
    expect(p.exp).toBe(300); /* a quarter lost */
    expect(p.maxExp).toBe(300); /* permanently */
  });

  it("the mana ball blasts the targeted monster", () => {
    const seed = seedFor((r) => r >= 4 && r <= 6);
    const state = makeState({ playerGrid: loc(10, 10), seed });
    const mon = addMon(state, makeRace(), loc(14, 10), { hp: 1000 });
    mon.mflag.on(MFLAG.VISIBLE);

    const used = registry().effectSimple(
      EF.BIZARRE,
      env(state, undefined, { aimed: mon.grid }),
      { origin: sourcePlayer() },
    );

    expect(used).toBe(true);
    expect(mon.hp).toBeLessThan(1000); /* 300 mana damage */
  });
});
