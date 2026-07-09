import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EF, PROJ, RF } from "../generated";
import {
  EffectRegistry,
  sourceMonster,
  sourcePlayer,
} from "../effects/interpreter";
import type { EffectContext } from "../effects/interpreter";
import { registerCoreHandlers } from "../effects/handlers";
import { loc } from "../loc";
import { bindProjections } from "../world/projection";
import type { ProjectionRecordJson } from "../world/projection";
import { addMon, makeState, monReg } from "./harness";
import type { GameState } from "./context";
import { basicPlayerActor } from "./project-cast";
import type { CastContext } from "./project-cast";
import { attachAttackEnv, registerAttackHandlers } from "./effect-attack";
import type { AttackEffectEnv } from "./effect-attack";

const projections = bindProjections(
  JSON.parse(
    readFileSync(
      new URL("../../../content/pack/projection.json", import.meta.url),
      "utf8",
    ),
  ).records as ProjectionRecordJson[],
);

const plainRace = monReg.races.find(
  (r) =>
    r.rarity > 0 &&
    !r.flags.has(RF.UNIQUE) &&
    !r.flags.has(RF.IM_FIRE) &&
    !r.flags.has(RF.HURT_FIRE),
)!;

function registry(): EffectRegistry {
  const r = new EffectRegistry();
  registerCoreHandlers(r);
  registerAttackHandlers(r);
  return r;
}

function castContext(state: GameState): CastContext {
  return { projections, maxRange: 20, playerActor: basicPlayerActor(state) };
}

function env(state: GameState, attack: Partial<AttackEffectEnv> = {}): EffectContext {
  return attachAttackEnv(
    { rng: state.rng },
    { state, cast: castContext(state), ...attack },
  );
}

describe("attack effect handlers - dispatch through the registry", () => {
  it("EF_BOLT damages the aimed monster and sets ident", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const mon = addMon(state, plainRace, loc(5, 8), { hp: 50 });
    const ident = { value: false };
    registry().effectSimple(EF.BOLT, env(state, { aimed: mon.grid }), {
      origin: sourcePlayer(),
      diceString: "20",
      subtype: PROJ.FIRE,
      ident,
    });
    expect(mon.hp).toBe(30);
    expect(ident.value).toBe(true);
  });

  it("EF_BEAM passes through several monsters in line", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const near = addMon(state, plainRace, loc(5, 7), { hp: 50 });
    const far = addMon(state, plainRace, loc(5, 9), { hp: 50 });
    registry().effectSimple(EF.BEAM, env(state, { aimed: loc(5, 9) }), {
      origin: sourcePlayer(),
      diceString: "20",
      subtype: PROJ.FIRE,
    });
    expect(near.hp).toBe(30);
    expect(far.hp).toBe(30);
  });

  it("EF_BALL from a monster detonates on the player", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.actor.player.chp = 100;
    const mon = addMon(state, plainRace, loc(5, 8), { hp: 50 });
    registry().effectSimple(EF.BALL, env(state), {
      origin: sourceMonster(mon.midx),
      diceString: "30",
      subtype: PROJ.FIRE,
    });
    expect(state.actor.player.chp).toBe(70);
  });

  it("EF_PROJECT_LOS hits every monster in line of sight", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const a = addMon(state, plainRace, loc(5, 8), { hp: 50 });
    const b = addMon(state, plainRace, loc(8, 5), { hp: 50 });
    registry().effectSimple(EF.PROJECT_LOS, env(state), {
      origin: sourcePlayer(),
      diceString: "15",
      subtype: PROJ.FIRE,
    });
    expect(a.hp).toBe(35);
    expect(b.hp).toBe(35);
  });

  it("no-ops without an attack environment (worldless rule)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const mon = addMon(state, plainRace, loc(5, 8), { hp: 50 });
    const worldless: EffectContext = { rng: state.rng };
    const ran = registry().effectSimple(EF.BOLT, worldless, {
      origin: sourcePlayer(),
      diceString: "20",
      subtype: PROJ.FIRE,
    });
    expect(ran).toBe(true);
    expect(mon.hp).toBe(50);
  });
});
