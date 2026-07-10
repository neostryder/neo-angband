import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { FlagSet } from "../bitflag";
import { EF, MFLAG, MON_TMD, RF, TMD } from "../generated";
import { loc, locEq } from "../loc";
import { Rng } from "../rng";
import { RSF_SIZE } from "../mon/types";
import { EffectRegistry, sourcePlayer } from "../effects/interpreter";
import type { EffectContext } from "../effects/interpreter";
import { registerCoreHandlers } from "../effects/handlers";
import { bindProjections } from "../world/projection";
import type { ProjectionRecordJson } from "../world/projection";
import { addMon, makeBlow, makeRace, makeState, plReg, GRANITE, monReg } from "./harness";
import type { GameState } from "./context";
import { deleteMonster } from "./context";
import { basicPlayerActor } from "./project-cast";
import { attachGameEnv } from "./effect-game-env";
import { registerGeneralHandlers } from "./effect-general";
import { targetSetMonster } from "./target";
import { decreaseTimeouts } from "./loop";
import type { DoMonSpellDeps } from "./mon-cast";
import {
  doCmdMonCommand,
  getCommandedMonster,
  monsterAttackMonster,
} from "./mon-cmd";

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

function deps(state: GameState): DoMonSpellDeps {
  return {
    registry: registry(),
    cast: { projections, maxRange: 20, playerActor: basicPlayerActor(state) },
    spells: monReg.spells,
    envDeps: { timedTable: plReg.timed },
    saveSkill: 0,
  };
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
    },
  );
}

/** A visible monster the level-50 player always overpowers. */
function commandable(state: GameState, at = loc(14, 10)) {
  state.actor.player.lev = 50;
  const mon = addMon(state, makeRace({ level: 1 }), at, { hp: 100 });
  mon.mflag.on(MFLAG.VISIBLE);
  targetSetMonster(state, mon);
  return mon;
}

describe("EF_COMMAND (effect-handler-general.c L3479)", () => {
  it("binds the targeted monster with paired timers", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const mon = commandable(state);
    const used = registry().effectSimple(EF.COMMAND, env(state), {
      origin: sourcePlayer(),
      diceString: "10",
    });
    expect(used).toBe(true);
    expect(state.actor.player.timed[TMD.COMMAND]).toBe(10);
    expect(mon.mTimed[MON_TMD.COMMAND]).toBe(10);
    expect(getCommandedMonster(state)).toBe(mon);
  });

  it("a mighty monster resists a novice's command", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    state.actor.player.lev = 1;
    const mon = addMon(state, makeRace({ level: 50 }), loc(14, 10), { hp: 100 });
    mon.mflag.on(MFLAG.VISIBLE);
    targetSetMonster(state, mon);
    /* Sweep seeds: at level 1 vs 50 nearly every roll resists. */
    let resisted = false;
    for (let seed = 1; seed <= 5 && !resisted; seed++) {
      state.rng = new Rng(seed);
      const msgs: string[] = [];
      registry().effectSimple(EF.COMMAND, env(state, msgs), {
        origin: sourcePlayer(),
        diceString: "10",
      });
      resisted = msgs.some((m) => m.endsWith("resists your command!"));
    }
    expect(resisted).toBe(true);
  });

  it("refuses without a monster target", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const msgs: string[] = [];
    const used = registry().effectSimple(EF.COMMAND, env(state, msgs), {
      origin: sourcePlayer(),
      diceString: "10",
    });
    expect(used).toBe(false);
    expect(msgs).toContain("No monster selected!");
  });
});

describe("do_cmd_mon_command (cmd-cave.c L1755)", () => {
  it("walks the commanded monster across open floor", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const mon = commandable(state);
    mon.mTimed[MON_TMD.COMMAND] = 10;
    const energy = doCmdMonCommand(state, { code: "walk", dir: 6 }, deps(state));
    expect(energy).toBe(state.z.moveEnergy);
    expect(locEq(mon.grid, loc(15, 10))).toBe(true);
    expect(state.chunk.mon(loc(15, 10))).toBe(mon.midx);
  });

  it("refuses to move an immobile monster", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const msgs: string[] = [];
    state.msg = (t) => msgs.push(t);
    const mon = commandable(state);
    mon.race.flags.on(RF.NEVER_MOVE);
    mon.mTimed[MON_TMD.COMMAND] = 10;
    const energy = doCmdMonCommand(state, { code: "walk", dir: 6 }, deps(state));
    expect(energy).toBe(0);
    expect(msgs).toContain("The monster can not move.");
  });

  it("a wall blocks a normal monster with a message", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const msgs: string[] = [];
    state.msg = (t) => msgs.push(t);
    const mon = commandable(state, loc(14, 10));
    mon.mTimed[MON_TMD.COMMAND] = 10;
    state.chunk.setFeat(loc(15, 10), GRANITE);
    const energy = doCmdMonCommand(state, { code: "walk", dir: 6 }, deps(state));
    expect(energy).toBe(state.z.moveEnergy); /* still a turn */
    expect(msgs).toContain("The way is blocked.");
    expect(locEq(mon.grid, loc(14, 10))).toBe(true);
  });

  it("walking into a monster attacks it", () => {
    const state = makeState({ playerGrid: loc(10, 10), seed: 3 });
    const mon = commandable(state);
    mon.mTimed[MON_TMD.COMMAND] = 10;
    /* A strong attacker guarantees observable damage across blows. */
    const brute = makeRace({
      level: 30,
      blows: [makeBlow("HIT", "HURT", "10d10")],
    });
    state.monsters[mon.midx]!.race = brute;
    const victim = addMon(state, makeRace({ level: 1, ac: 0 }), loc(15, 10), {
      hp: 500,
    });
    victim.mflag.on(MFLAG.VISIBLE);

    let hurt = false;
    for (let seed = 1; seed <= 8 && !hurt; seed++) {
      state.rng = new Rng(seed);
      victim.hp = 500;
      doCmdMonCommand(state, { code: "walk", dir: 6 }, deps(state));
      hurt = victim.hp < 500;
    }
    expect(hurt).toBe(true);
    /* The attacker did not move into the victim's grid. */
    expect(locEq(state.monsters[mon.midx]!.grid, loc(14, 10))).toBe(true);
  });

  it("'read' releases the monster and both timers", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const mon = commandable(state);
    mon.mTimed[MON_TMD.COMMAND] = 10;
    state.actor.player.timed[TMD.COMMAND] = 10;
    const energy = doCmdMonCommand(state, { code: "read" }, deps(state));
    expect(energy).toBe(state.z.moveEnergy);
    expect(mon.mTimed[MON_TMD.COMMAND]).toBe(0);
    expect(state.actor.player.timed[TMD.COMMAND]).toBe(0);
    expect(getCommandedMonster(state)).toBeNull();
  });

  it("a spell-less monster cannot cast", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const msgs: string[] = [];
    state.msg = (t) => msgs.push(t);
    const mon = commandable(state);
    /* A fresh, empty spell set (the harness race shares the registry's). */
    mon.race = { ...mon.race, spellFlags: new FlagSet(RSF_SIZE) };
    mon.mTimed[MON_TMD.COMMAND] = 10;
    /* Another monster to target with the cast. */
    const other = addMon(state, makeRace(), loc(16, 10), { hp: 30 });
    other.mflag.on(MFLAG.VISIBLE);
    targetSetMonster(state, other);
    const energy = doCmdMonCommand(state, { code: "cast" }, deps(state));
    expect(energy).toBe(0);
    expect(msgs).toContain("This monster has no spells!");
  });
});

describe("the TMD_COMMAND lifecycle", () => {
  it("the world tick keeps the timers aligned in sight", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const mon = commandable(state);
    mon.mTimed[MON_TMD.COMMAND] = 10;
    state.actor.player.timed[TMD.COMMAND] = 10;
    decreaseTimeouts(state);
    expect(state.actor.player.timed[TMD.COMMAND]).toBe(9);
    expect(mon.mTimed[MON_TMD.COMMAND]).toBe(9);
  });

  it("out of sight is out of mind", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const mon = commandable(state, loc(16, 10));
    mon.mTimed[MON_TMD.COMMAND] = 10;
    state.actor.player.timed[TMD.COMMAND] = 10;
    /* Wall off the line of sight. */
    for (let y = 1; y < state.chunk.height - 1; y++) {
      state.chunk.setFeat(loc(15, y), GRANITE);
    }
    decreaseTimeouts(state);
    expect(state.actor.player.timed[TMD.COMMAND]).toBe(0);
    expect(mon.mTimed[MON_TMD.COMMAND]).toBe(0);
  });

  it("a commanded monster dying releases the player", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const mon = commandable(state);
    mon.mTimed[MON_TMD.COMMAND] = 10;
    state.actor.player.timed[TMD.COMMAND] = 10;
    deleteMonster(state, mon.midx);
    expect(state.actor.player.timed[TMD.COMMAND]).toBe(0);
  });
});

describe("monster_attack_monster (mon-attack.c L765)", () => {
  it("NEVER_BLOW monsters cannot attack", () => {
    const state = makeState({ playerGrid: loc(10, 10) });
    const mon = addMon(state, makeRace({ flags: [RF.NEVER_BLOW] }), loc(5, 5), {
      hp: 50,
    });
    const target = addMon(state, makeRace(), loc(6, 5), { hp: 50 });
    expect(monsterAttackMonster(state, mon, target)).toBe(false);
    expect(target.hp).toBe(50);
  });
});
