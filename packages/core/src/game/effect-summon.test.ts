import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EF, RF, TMD } from "../generated";
import { loc } from "../loc";
import { distance } from "../loc";
import {
  EffectRegistry,
  sourceMonster,
  sourcePlayer,
} from "../effects/interpreter";
import type { EffectContext, EffectPlayer } from "../effects/interpreter";
import { registerCoreHandlers } from "../effects/handlers";
import { bindProjections } from "../world/projection";
import type { ProjectionRecordJson } from "../world/projection";
import { MonAllocTable } from "../mon/make";
import { SummonTable } from "../mon/summon";
import { GROUP_TYPE } from "../mon/monster";
import { MON_GROUP } from "../mon/types";
import { addMon, makeRace, makeState, monReg } from "./harness";
import type { GameState } from "./context";
import { basicPlayerActor } from "./project-cast";
import type { CastContext } from "./project-cast";
import { attachGameEnv } from "./effect-game-env";
import { registerSummonHandlers } from "./effect-summon";
import type { SummonEffectEnv } from "./effect-summon";
import { summonGroup } from "./mon-group";

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

const summons = new SummonTable(monReg.summons, monReg.bases);

function registry(): EffectRegistry {
  const r = new EffectRegistry();
  registerCoreHandlers(r);
  registerSummonHandlers(r);
  return r;
}

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

function summonEnv(): SummonEffectEnv {
  return {
    summons,
    place: { table: new MonAllocTable(monReg.races, { maxDepth: 128 }) },
  };
}

function env(state: GameState, msgs?: string[]): EffectContext {
  const cast: CastContext = {
    projections,
    maxRange: 20,
    playerActor: basicPlayerActor(state),
  };
  const base: EffectContext = {
    rng: state.rng,
    player: playerEnv(state),
    ...(msgs ? { messages: { msg: (t: string) => msgs.push(t) } } : {}),
  };
  return attachGameEnv(base, { state, cast, summon: summonEnv() });
}

describe("EF_SUMMON (effect-handler-general.c L2241)", () => {
  it("a player summon places delayed monsters of the type nearby", () => {
    const state = makeState({ playerGrid: loc(10, 10), seed: 21 });
    state.chunk.depth = 10;
    const used = registry().effectSimple(EF.SUMMON, env(state), {
      origin: sourcePlayer(),
      diceString: "2",
      subtype: summons.nameToIdx("UNDEAD"),
    });
    expect(used).toBe(true);
    const placed = state.monsters.filter(Boolean);
    expect(placed.length).toBeGreaterThan(0);
    for (const mon of placed) {
      expect(mon!.race.flags.has(RF.UNDEAD)).toBe(true);
      expect(distance(mon!.grid, state.actor.grid)).toBeLessThanOrEqual(4);
      /* The player-origin path delays the summons. */
      expect(mon!.energy).toBe(0);
    }
  });

  it("a blind player hears the arrivals", () => {
    const state = makeState({ playerGrid: loc(10, 10), seed: 23 });
    state.chunk.depth = 10;
    state.actor.player.timed[TMD.BLIND] = 10;
    const msgs: string[] = [];
    const used = registry().effectSimple(EF.SUMMON, env(state, msgs), {
      origin: sourcePlayer(),
      diceString: "3",
      subtype: summons.nameToIdx("MONSTER"),
    });
    expect(used).toBe(true);
    expect(state.monsters.filter(Boolean).length).toBeGreaterThan(0);
    expect(msgs.some((m) => m.startsWith("You hear"))).toBe(true);
  });

  it("a monster summon fills its group with SUMMON-role helpers", () => {
    const state = makeState({ playerGrid: loc(10, 10), seed: 25 });
    state.chunk.depth = 10;
    const summoner = addMon(state, makeRace({ level: 20 }), loc(15, 10));
    const used = registry().effectSimple(EF.SUMMON, env(state), {
      origin: sourceMonster(summoner.midx),
      diceString: "3",
      subtype: summons.nameToIdx("MONSTER"),
    });
    expect(used).toBe(true);
    const summoned = state.monsters.filter((m) => m && m !== summoner);
    expect(summoned.length).toBeGreaterThan(0);
    const group = summonGroup(state, summoner.midx)!;
    for (const mon of summoned) {
      expect(mon!.groupInfo[GROUP_TYPE.PRIMARY]!.index).toBe(group.index);
      expect(mon!.groupInfo[GROUP_TYPE.PRIMARY]!.role).toBe(MON_GROUP.SUMMON);
      expect(distance(mon!.grid, summoner.grid)).toBeLessThanOrEqual(4);
    }
  });

  it("KIN summons share the summoner's base", () => {
    const state = makeState({ playerGrid: loc(10, 10), seed: 27 });
    state.chunk.depth = 20;
    /* A real low-level race whose base has non-unique relatives. */
    const race = monReg.races.find(
      (r, i) =>
        i > 0 &&
        !r.flags.has(RF.UNIQUE) &&
        r.level > 0 &&
        r.level <= 10 &&
        !!r.base &&
        monReg.races.filter(
          (o) => o.base === r.base && !o.flags.has(RF.UNIQUE) && o.rarity > 0,
        ).length > 2,
    )!;
    const summoner = addMon(state, race, loc(15, 10));
    registry().effectSimple(EF.SUMMON, env(state), {
      origin: sourceMonster(summoner.midx),
      diceString: "4",
      subtype: summons.nameToIdx("KIN"),
    });
    const summoned = state.monsters.filter((m) => m && m !== summoner);
    expect(summoned.length).toBeGreaterThan(0);
    for (const mon of summoned) {
      expect(mon!.race.base).toBe(race.base);
      expect(mon!.race.flags.has(RF.UNIQUE)).toBe(false);
    }
  });

  it("says 'But nothing comes.' when a monster summon finds nothing", () => {
    const state = makeState({ playerGrid: loc(10, 10), seed: 29 });
    state.chunk.depth = 5;
    const summoner = addMon(state, makeRace({ level: 5 }), loc(15, 10));
    const msgs: string[] = [];
    registry().effectSimple(EF.SUMMON, env(state, msgs), {
      origin: sourceMonster(summoner.midx),
      diceString: "3",
      /* Ancient dragons cannot allocate this shallow, and HI_DRAGON has
       * no fallback. */
      subtype: summons.nameToIdx("HI_DRAGON"),
    });
    expect(state.monsters.filter((m) => m && m !== summoner).length).toBe(0);
    expect(msgs).toContain("But nothing comes.");
  });

  it("no-ops without the summon seam", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const cast: CastContext = {
      projections,
      maxRange: 20,
      playerActor: basicPlayerActor(state),
    };
    const bare = attachGameEnv(
      { rng: state.rng, player: playerEnv(state) },
      { state, cast },
    );
    const used = registry().effectSimple(EF.SUMMON, bare, {
      origin: sourcePlayer(),
      diceString: "2",
      subtype: summons.nameToIdx("MONSTER"),
    });
    expect(used).toBe(true);
    expect(state.monsters.filter(Boolean).length).toBe(0);
  });
});
