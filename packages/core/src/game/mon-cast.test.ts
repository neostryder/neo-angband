import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EF, PROJ, RF, RSF, TMD } from "../generated";
import { EffectRegistry } from "../effects/interpreter";
import { registerCoreHandlers } from "../effects/handlers";
import { loc } from "../loc";
import { Rng } from "../rng";
import { bindProjections } from "../world/projection";
import type { ProjectionRecordJson } from "../world/projection";
import { addMon, makeState, makeRace, monReg, plReg } from "./harness";
import type { GameState } from "./context";
import { basicPlayerActor } from "./project-cast";
import type { CastContext } from "./project-cast";
import { registerAttackHandlers } from "./effect-attack";
import { registerMonsterHandlers } from "./effect-monster";
import { registerTeleportHandlers } from "./effect-teleport";
import { buildSpellEffectChain, doMonSpell } from "./mon-cast";
import type { DoMonSpellDeps } from "./mon-cast";

const projections = bindProjections(
  JSON.parse(
    readFileSync(
      new URL("../../../content/pack/projection.json", import.meta.url),
      "utf8",
    ),
  ).records as ProjectionRecordJson[],
);

function registry(): EffectRegistry {
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

function deps(
  state: GameState,
  over: Partial<DoMonSpellDeps> = {},
): DoMonSpellDeps {
  return {
    registry: registry(),
    cast: castContext(state),
    spells: monReg.spells,
    envDeps: { timedTable: plReg.timed },
    saveSkill: 0,
    ...over,
  };
}

/** A plain, non-unique caster with no fire resistance/immunity. */
function caster(state: GameState, grid = loc(5, 6), hp = 300) {
  const race = makeRace({ flags: [] });
  race.spellPower = 0;
  return addMon(state, race, grid, { hp });
}

describe("doMonSpell - casting through the effect stack", () => {
  it("a breath spell damages the player (breath_dam-scaled)", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.actor.player.chp = 200;
    const mon = caster(state);
    const ran = doMonSpell(state, mon.midx, RSF.BR_FIRE, true, deps(state));
    expect(ran).toBe(true);
    expect(state.actor.player.chp).toBeLessThan(200);
  });

  it("a status spell afflicts the player", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const mon = caster(state);
    doMonSpell(state, mon.midx, RSF.CONF, true, deps(state));
    expect(state.actor.player.timed[TMD.CONFUSED]!).toBeGreaterThan(0);
  });

  it("a spell with a save message is prevented by a save", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.actor.player.chp = 100;
    const mon = caster(state);
    let saved = "";
    let learnedRune = false;
    doMonSpell(
      state,
      mon.midx,
      RSF.MIND_BLAST,
      true,
      deps(state, {
        saveSkill: 100,
        hooks: {
          saveMessage: (t) => (saved = t),
          failRune: () => (learnedRune = true),
        },
      }),
    );
    expect(saved).not.toBe("");
    expect(learnedRune).toBe(true);
    expect(state.actor.player.chp).toBe(100); // no damage
    expect(state.actor.player.timed[TMD.CONFUSED]!).toBe(0); // no confusion
  });

  it("the same spell lands when the save fails", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    state.actor.player.chp = 100;
    const mon = caster(state);
    doMonSpell(state, mon.midx, RSF.MIND_BLAST, true, deps(state, { saveSkill: 0 }));
    expect(state.actor.player.chp).toBeLessThan(100); // 8d8 damage landed
  });

  it("calls the message and disturb hooks with the hit result", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const mon = caster(state);
    let disturbed = false;
    let sawHit: boolean | null = null;
    doMonSpell(
      state,
      mon.midx,
      RSF.BR_FIRE,
      true,
      deps(state, {
        hooks: {
          disturb: () => (disturbed = true),
          message: (_m, _s, _seen, hits) => (sawHit = hits),
        },
      }),
    );
    expect(disturbed).toBe(true);
    expect(sawHit).toBe(true); // BR_FIRE always hits (hit == 100)
  });

  it("returns false for an unknown spell or a missing caster", () => {
    const state = makeState({ playerGrid: loc(5, 5) });
    const mon = caster(state);
    expect(doMonSpell(state, mon.midx, 9999, true, deps(state))).toBe(false);
    expect(doMonSpell(state, 999, RSF.CONF, true, deps(state))).toBe(false);
  });
});

describe("buildSpellEffectChain", () => {
  it("binds SPELL_POWER into a spell's dice expression", () => {
    const spell = monReg.spells.get(RSF.BOLT)!; // BOLT: $Dd7, D = SPELL_POWER/8 + 1
    const chain = buildSpellEffectChain(spell, {
      baseValues: { SPELL_POWER: () => 80 },
    });
    expect(chain).not.toBeNull();
    expect(chain!.index).toBe(EF.BOLT);
    expect(chain!.subtype).toBe(PROJ.ARROW);
    // D = 80 / 8 + 1 = 11, so 11d7; maximised = 77.
    expect(chain!.dice!.evaluate(new Rng(1), 0, "maximise")).toBe(77);
  });
});
