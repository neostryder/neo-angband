/**
 * Every change to a seen monster's timed status queues its line, as
 * mon_set_timed does upstream (mon-timed.c:209-215). The setter picks the line
 * and checks visibility; these tests pin that each game caller hands it the
 * message sink, since a call without one queues nothing.
 */

import { describe, expect, it } from "vitest";
import { MFLAG, MON_MSG, MON_TMD, TMD } from "../generated/index.js";
import { loc } from "../loc.js";
import type { Monster } from "../mon/monster.js";
import { monTakeHit, monsterWake } from "../mon/take-hit.js";
import { gameTakeHitHooks } from "./context.js";
import type { GameState } from "./context.js";
import { addMon, makeRace, makeState } from "./harness.js";
import { monsterTimedMessage, pendingMonsterMessages } from "./mon-message.js";
import { processMonsterTimed } from "./monster-turn.js";
import { attackMonster } from "./player-turn.js";

function seenMonster(): { state: GameState; mon: Monster } {
  const state = makeState({ playerGrid: loc(10, 10) });
  const mon = addMon(state, makeRace({ ac: 0 }), loc(11, 10), { hp: 500 });
  mon.mflag.on(MFLAG.VISIBLE);
  return { state, mon };
}

const queued = (state: GameState): number[] =>
  pendingMonsterMessages(state).map((m) => m.msgCode);

describe("monster status lines reach the message queue", () => {
  it.each([
    [MON_TMD.FAST, MON_MSG.NOT_HASTED],
    [MON_TMD.SLOW, MON_MSG.NOT_SLOWED],
    [MON_TMD.HOLD, MON_MSG.NOT_HELD],
    [MON_TMD.DISEN, MON_MSG.NOT_DISEN],
  ])("timer %i running out on a monster's turn says so", (effect, line) => {
    const { state, mon } = seenMonster();
    mon.mTimed[effect] = 1;
    processMonsterTimed(mon, state);
    expect(mon.mTimed[effect]).toBe(0);
    expect(queued(state)).toContain(line);
  });

  it("an unseen monster's timer runs out silently", () => {
    const { state, mon } = seenMonster();
    mon.mflag.off(MFLAG.VISIBLE);
    mon.mTimed[MON_TMD.HOLD] = 1;
    processMonsterTimed(mon, state);
    expect(queued(state)).toEqual([]);
  });

  it("a hit that frees a held monster says it can move again", () => {
    const { state, mon } = seenMonster();
    mon.mTimed[MON_TMD.HOLD] = 10;
    monTakeHit(state.rng, mon, 1, null, gameTakeHitHooks(state, mon));
    expect(mon.mTimed[MON_TMD.HOLD]).toBe(0);
    expect(queued(state)).toContain(MON_MSG.NOT_HELD);
  });

  it("a noisy wake says the monster wakes up", () => {
    const { state, mon } = seenMonster();
    mon.mTimed[MON_TMD.SLEEP] = 100;
    monsterWake(state.rng, mon, true, 100, monsterTimedMessage(state));
    expect(queued(state)).toContain(MON_MSG.WAKES_UP);
  });

  it("a confusing touch reports what it did to the monster", () => {
    const { state, mon } = seenMonster();
    state.actor.player.timed[TMD.ATT_CONF] = 10;
    for (let i = 0; i < 20 && state.actor.player.timed[TMD.ATT_CONF]; i++) {
      attackMonster(state, mon);
    }
    expect(state.actor.player.timed[TMD.ATT_CONF]).toBe(0);
    const lines = queued(state);
    expect(
      lines.includes(MON_MSG.CONFUSED) || lines.includes(MON_MSG.UNAFFECTED),
    ).toBe(true);
  });
});
