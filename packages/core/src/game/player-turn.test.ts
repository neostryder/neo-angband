import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FlagSet } from "../bitflag";
import { MFLAG, MON_TMD, OF, TMD } from "../generated";
import { OF_SIZE, PF_SIZE } from "../player/types";
import type { PlayerState } from "../player/calcs";
import { MDESC, monsterDesc } from "../mon/desc";
import { loc } from "../loc";
import { Rng } from "../rng";
import { bindProjections } from "../world/projection";
import type { ProjectionRecordJson } from "../world/projection";
import {
  ActionRegistry,
  attackMonster,
  createDefaultRegistry,
  descendAction,
  holdAction,
  processPlayer,
  walkAction,
  walkTerrainPrompt,
} from "./player-turn";
import { playerCheckTerrainDamage } from "./world";
import { GRANITE, addMon, featureReg, makeRace, makeState } from "./harness";
import type { GameState, PlayerCommand } from "./context";

const terrainProjections = bindProjections(
  (
    JSON.parse(
      readFileSync(
        new URL("../../../content/pack/projection.json", import.meta.url),
        "utf8",
      ),
    ) as { records: ProjectionRecordJson[] }
  ).records,
);
const LAVA = featureReg.byCodeName("LAVA").fidx;
const LAVA_WALK_MSG = "The lava will scald you!  Really step in? ";

/** Wire the fire-damage machinery move_player's terrain check needs: neutral
 * fire resistance, no feather fall, no damage reduction, and the projection
 * table, plus the player's current HP. */
function wireFireTerrain(state: GameState, chp: number): void {
  state.playerState = {
    flags: new FlagSet(OF_SIZE),
    pflags: new FlagSet(PF_SIZE),
    elInfo: Array.from({ length: 32 }, () => ({ resLevel: 0 })),
    damRed: 0,
    percDamRed: 0,
    seeInfra: 0,
  } as unknown as PlayerState;
  state.actor.player.chp = chp;
  /* makeState always wires state.world; add the projection table it needs. */
  if (state.world) state.world.projections = terrainProjections;
}

/** Give the player the OF_AFRAID flag, as calc_bonuses would when fear is up. */
function setAfraid(state: GameState): void {
  const flags = new FlagSet(OF_SIZE);
  flags.on(OF.AFRAID);
  state.playerState = {
    flags,
    pflags: new FlagSet(PF_SIZE),
    seeInfra: 0,
  } as unknown as PlayerState;
}

describe("built-in player actions", () => {
  it("walk steps onto a passable grid for move_energy and fires the FOV hook", () => {
    let fovCalls = 0;
    const state = makeState({
      playerGrid: loc(15, 10),
      updateFov: () => {
        fovCalls++;
      },
    });

    const spent = walkAction(state, { code: "walk", dir: 6 });
    expect(spent).toBe(state.z.moveEnergy);
    expect(state.actor.grid).toEqual(loc(16, 10));
    expect(fovCalls).toBe(1);
  });

  it("walk into a wall spends no energy and does not move", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    state.chunk.setFeat(loc(16, 10), GRANITE);

    const spent = walkAction(state, { code: "walk", dir: 6 });
    expect(spent).toBe(0);
    expect(state.actor.grid).toEqual(loc(15, 10));
  });

  it("walk into a monster attacks it (py_attack)", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    state.actor.combat.numBlows = 300; /* land several blows this turn */
    const mon = addMon(state, makeRace({ ac: 0 }), loc(16, 10), { hp: 200 });

    const spent = walkAction(state, { code: "walk", dir: 6 });
    /* py_attack energy (player-attack.c:991,1017-1019): blow_energy =
     * 100 * move_energy / num_blows = 33; three blows fit a turn -> 99,
     * NOT a flat move_energy. */
    expect(spent).toBe(99);
    expect(mon.hp).toBeLessThan(200);
    /* The player did not step onto the monster's grid. */
    expect(state.actor.grid).toEqual(loc(15, 10));
  });

  it("walk into a camouflaged monster reveals it instead of attacking (move_player, cmd-cave.c L1071)", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    const mon = addMon(state, makeRace({ ac: 0 }), loc(16, 10), { hp: 200 });
    mon.mflag.on(MFLAG.CAMOUFLAGE);
    mon.mTimed[MON_TMD.SLEEP] = 20;

    let revealed: number | null = null;
    state.becomeAware = (m) => {
      revealed = m.midx;
    };

    const spent = walkAction(state, { code: "walk", dir: 6 });

    expect(spent).toBe(state.z.moveEnergy);
    expect(revealed).toBe(mon.midx);
    expect(mon.hp).toBe(200); // not attacked
    expect(mon.mTimed[MON_TMD.SLEEP]).toBe(0); // monster_wake(mon, false, 100)
    expect(mon.mflag.has(MFLAG.AWARE)).toBe(true);
    /* The player did not step onto the monster's grid. */
    expect(state.actor.grid).toEqual(loc(15, 10));
  });

  it("afraid: walking into an obvious monster refuses (do_cmd_walk_test, cmd-cave.c L1215)", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    setAfraid(state);
    const mon = addMon(state, makeRace({ ac: 0 }), loc(16, 10), { hp: 30 });
    mon.mflag.on(MFLAG.VISIBLE); /* obvious = visible && !camouflaged */
    const msgs: string[] = [];
    state.msg = (t): void => {
      msgs.push(t);
    };

    const spent = walkAction(state, { code: "walk", dir: 6 });
    /* No attack, no move, no energy (energy is set only after the test passes). */
    expect(spent).toBe(0);
    expect(mon.hp).toBe(30);
    expect(state.actor.grid).toEqual(loc(15, 10));
    expect(msgs).toContain(`You are too afraid to attack ${monsterDesc(mon, MDESC.DEFAULT)}!`);
  });

  it("afraid: an invisible monster falls through to py_attack's own afraid branch", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    setAfraid(state);
    /* Not obvious (VISIBLE unset), so do_cmd_walk_test does not short-circuit. */
    const mon = addMon(state, makeRace({ ac: 0 }), loc(16, 10), { hp: 30 });
    const afraidBlows: boolean[] = [];
    state.onMelee = (_m, result): void => {
      for (const b of result.blows) afraidBlows.push(b.verb === "afraid");
    };

    const spent = walkAction(state, { code: "walk", dir: 6 });
    /* py_attack ran (energy spent per blow) but every blow was refused by fear:
     * no damage, and each blow carries the "afraid" verb the shell renders. */
    expect(spent).toBeGreaterThan(0);
    expect(mon.hp).toBe(30);
    expect(afraidBlows.length).toBeGreaterThan(0);
    expect(afraidBlows.every((v) => v)).toBe(true);
  });

  it("afraid: attackMonster (open/tunnel-into-monster) refuses every blow", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    setAfraid(state);
    const mon = addMon(state, makeRace({ ac: 0 }), loc(16, 10), { hp: 30 });
    mon.mflag.on(MFLAG.VISIBLE);
    let sawAfraid = false;
    state.onMelee = (_m, result): void => {
      if (result.blows.some((b) => b.verb === "afraid")) sawAfraid = true;
    };

    attackMonster(state, mon);
    expect(mon.hp).toBe(30);
    expect(sawAfraid).toBe(true);
  });

  it("not afraid: walking into an obvious monster still attacks normally", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    const mon = addMon(state, makeRace({ ac: 0 }), loc(16, 10), { hp: 200 });
    mon.mflag.on(MFLAG.VISIBLE);

    walkAction(state, { code: "walk", dir: 6 });
    expect(mon.hp).toBeLessThan(200);
  });

  it("hold spends a turn in place; descend signals a level change", () => {
    const state = makeState();
    expect(holdAction(state, { code: "hold" })).toBe(state.z.moveEnergy);

    expect(descendAction(state, { code: "descend" })).toBe(state.z.moveEnergy);
    expect(state.generateLevel).toBe(true);
  });
});

describe("action registry dispatch", () => {
  it("dispatches a mod-added custom action and accounts its energy", () => {
    const reg = createDefaultRegistry();
    reg.register("smite", (s) => {
      s.actor.player.chp -= 7;
      return s.z.moveEnergy;
    });

    const commands: PlayerCommand[] = [{ code: "smite" }];
    const state = makeState({ commands });
    const startHp = state.actor.player.chp;

    const res = processPlayer(state, reg);
    expect(res.energyUsed).toBe(state.z.moveEnergy);
    expect(state.actor.player.chp).toBe(startHp - 7);
    expect(state.actor.totalEnergy).toBe(state.z.moveEnergy);
  });

  it("a mod can replace a built-in action", () => {
    const reg = createDefaultRegistry();
    let custom = 0;
    reg.register("walk", () => {
      custom++;
      return 42;
    });
    const state = makeState({ commands: [{ code: "walk", dir: 6 }] });

    const res = processPlayer(state, reg);
    expect(custom).toBe(1);
    expect(res.energyUsed).toBe(42);
  });

  it("drains free commands and then reports needsInput on an empty queue", () => {
    const reg = createDefaultRegistry();
    /* "look" is a deferred stub (0 energy), then the queue empties. */
    const state = makeState({ commands: [{ code: "look" }] });

    const res = processPlayer(state, reg);
    expect(res.needsInput).toBe(true);
    expect(res.energyUsed).toBe(0);
  });

  it("an empty registry falls back to the no-op stub", () => {
    const reg = new ActionRegistry();
    const state = makeState({ commands: [{ code: "anything" }] });
    const res = processPlayer(state, reg);
    expect(res.needsInput).toBe(true);
  });
});

describe("walkTerrainPrompt (move_player damaging-terrain confirm, cmd-cave.c L1156-1180)", () => {
  it("prompts the lava walk-msg when the step would cost more than a third of HP", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    state.chunk.setFeat(loc(16, 10), LAVA);
    wireFireTerrain(state, 3); // chp/3 = 1; lava is 100+d100, far above

    expect(walkTerrainPrompt(state, 6)).toBe(LAVA_WALK_MSG);
  });

  it("does not prompt when the fiery step costs a third or less of current HP", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    state.chunk.setFeat(loc(16, 10), LAVA);
    wireFireTerrain(state, 900); // chp/3 = 300 >= the 200 max lava damage

    expect(walkTerrainPrompt(state, 6)).toBeNull();
  });

  it("never prompts (and draws no terrain-check RNG) while confused", () => {
    const seed = 42;
    const state = makeState({ playerGrid: loc(15, 10), seed });
    state.chunk.setFeat(loc(16, 10), LAVA);
    wireFireTerrain(state, 3);
    state.actor.player.timed[TMD.CONFUSED] = 20;

    expect(walkTerrainPrompt(state, 6)).toBeNull();
    /* The RNG stream is untouched: the next draw matches a fresh same-seed Rng,
     * proving player_check_terrain_damage was skipped for a confused player. */
    expect(state.rng.randint1(100)).toBe(new Rng(seed).randint1(100));
  });

  it("does not prompt when a monster occupies the target grid (attack, not step)", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    state.chunk.setFeat(loc(16, 10), LAVA);
    wireFireTerrain(state, 3);
    addMon(state, makeRace({ ac: 0 }), loc(16, 10), { hp: 20 });

    expect(walkTerrainPrompt(state, 6)).toBeNull();
  });

  it("does not prompt when the target grid is a wall (bump, not step)", () => {
    const state = makeState({ playerGrid: loc(15, 10) });
    state.chunk.setFeat(loc(16, 10), GRANITE);
    wireFireTerrain(state, 3);

    expect(walkTerrainPrompt(state, 6)).toBeNull();
  });

  it("draws identical RNG for the check and the actual damage (C's faithful double draw)", () => {
    const check = makeState({ playerGrid: loc(15, 10), seed: 7 });
    check.chunk.setFeat(loc(16, 10), LAVA);
    wireFireTerrain(check, 3);

    const actual = makeState({ playerGrid: loc(15, 10), seed: 7 });
    actual.chunk.setFeat(loc(16, 10), LAVA);
    wireFireTerrain(actual, 3);

    const damCheck = playerCheckTerrainDamage(check, loc(16, 10), false);
    const damActual = playerCheckTerrainDamage(actual, loc(16, 10), true);
    expect(damCheck).toBeGreaterThan(0);
    expect(damActual).toBe(damCheck);
  });
});
