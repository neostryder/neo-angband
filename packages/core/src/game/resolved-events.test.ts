import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EffectRegistry, sourcePlayer } from "../effects/interpreter.js";
import { registerCoreHandlers } from "../effects/handlers.js";
import { GameEvents } from "../events.js";
import type { CombatOutcomeEventData, HealEventData, MotionEventData } from "../events.js";
import { EF, PROJ, SQUARE } from "../generated/index.js";
import { loc } from "../loc.js";
import { PROJECT } from "../world/project.js";
import { bindProjections } from "../world/projection.js";
import type { ProjectionRecordJson } from "../world/projection.js";
import { buildEffectContext } from "./effect-env.js";
import { teleportPlayer } from "./effect-teleport.js";
import { addMon, makeRace, makeState } from "./harness.js";
import { attackMonster, walkAction } from "./player-turn.js";
import { projectMonster } from "./project-monster.js";
import { thrustAway } from "./thrust.js";

const projections = bindProjections((JSON.parse(readFileSync(
  new URL("../../../content/pack/projection.json", import.meta.url), "utf8",
)) as { records: ProjectionRecordJson[] }).records);

describe("resolved events", () => {
  it("reports forced displacement from the completed swap", () => {
    const state = makeState({ seed: 5, playerGrid: loc(12, 12) });
    const bus = new GameEvents();
    state.events = bus;
    const motions: MotionEventData[] = [];
    bus.on("motion", (_type, data) => motions.push(data));
    thrustAway(state, loc(12, 9), state.actor.grid, 4);
    expect(motions.length).toBeGreaterThan(0);
    expect(motions[0]).toMatchObject({ who: "player", from: loc(12, 12),
      kind: "teleport" });
    expect(motions[motions.length - 1]!.to).toEqual(state.actor.grid);
  });
  it("reports a hit, miss, kill, spell damage, heal, walk, and teleport in order", () => {
    const state = makeState({ seed: 43, playerGrid: loc(10, 10) });
    const bus = new GameEvents();
    state.events = bus;
    const outcomes: CombatOutcomeEventData[] = [];
    const heals: HealEventData[] = [];
    const motions: MotionEventData[] = [];
    const order: string[] = [];
    bus.on("combat-outcome", (_type, data) => {
      outcomes.push(data);
      order.push("combat");
    });
    bus.on("heal", (_type, data) => {
      heals.push(data);
      order.push("heal");
    });
    bus.on("motion", (_type, data) => {
      motions.push(data);
      order.push(data.kind);
    });

    const weak = makeRace({ ac: 0 });
    const hit = addMon(state, weak, loc(11, 10), { hp: 500 });
    state.actor.combat.toH = 10000;
    state.actor.combat.skills = state.actor.combat.skills.map(() => 10000);
    attackMonster(state, hit);
    expect(outcomes).toHaveLength(1);
    expect(outcomes[0]).toMatchObject({ attacker: "player", target: hit.midx,
      kind: "melee", hit: true, died: false, grid: loc(11, 10) });
    expect(outcomes[0]!.damage).toBeGreaterThan(0);

    state.actor.combat.toH = -10000;
    state.actor.combat.skills = state.actor.combat.skills.map(() => -10000);
    state.rng.randFix(0);
    attackMonster(state, hit);
    state.rng.randUnfix();
    expect(outcomes[1]).toMatchObject({ attacker: "player", target: hit.midx,
      kind: "melee", hit: false, damage: 0, died: false });

    state.actor.combat.toH = 10000;
    state.actor.combat.skills = state.actor.combat.skills.map(() => 10000);
    hit.hp = 1;
    const killedIndex = hit.midx;
    let namedBeforeRemoval = false;
    bus.on("combat-outcome", (_type, data) => {
      if (data.died && data.target === killedIndex) {
        namedBeforeRemoval = state.monsters[killedIndex] === hit;
      }
    });
    attackMonster(state, hit);
    expect(outcomes[2]).toMatchObject({ attacker: "player", target: killedIndex,
      kind: "melee", hit: true, died: true });
    expect(namedBeforeRemoval).toBe(true);

    const spellTarget = addMon(state, weak, loc(12, 10), { hp: 500 });
    state.chunk.sqinfoOn(spellTarget.grid, SQUARE.VIEW);
    projectMonster({ state, projections, origin: {
      isPlayer: true, monster: 0, grid: state.actor.grid, charm: false,
    }, hooks: {} }, 0, spellTarget.grid, 20, PROJ.FIRE, PROJECT.KILL);
    expect(outcomes[3]).toMatchObject({ attacker: "player", target: spellTarget.midx,
      kind: "spell", hit: true, damage: 20, died: false, seen: true });

    state.actor.player.chp = 900;
    const effects = new EffectRegistry();
    registerCoreHandlers(effects);
    effects.effectSimple(EF.HEAL_HP, buildEffectContext(state, {
      timedTable: [],
    }), { origin: sourcePlayer(), diceString: "50" });
    expect(heals).toEqual([{ who: "player", amount: 50,
      grid: loc(10, 10), seen: false }]);

    walkAction(state, { code: "walk", dir: 2 });
    expect(motions[0]).toMatchObject({ who: "player", from: loc(10, 10),
      to: loc(10, 11), kind: "walk" });
    const before = state.actor.grid;
    teleportPlayer(state, 10);
    expect(motions[1]).toMatchObject({ who: "player", from: before,
      to: state.actor.grid, kind: "teleport" });
    expect(motions).toHaveLength(2);
    expect(outcomes).toHaveLength(4);
    expect(order).toEqual(["combat", "combat", "combat", "combat",
      "heal", "walk", "teleport"]);
  });
});
