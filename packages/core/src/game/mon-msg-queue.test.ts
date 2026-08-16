/**
 * The mon_msg[] queue (reference/src/mon-msg.c L200-311, L505-525) and its
 * drain through notice_stuff (player-calcs.c:2552), PORT_TODO 3.1.
 *
 * WHAT THIS IS FOR. Every one of these behaviours was absent before: the port
 * formatted one sentence per event and printed it where it happened, so a
 * fireball over a kobold pit produced eight identical lines in projection
 * order, a monster hit twice by one splash was described twice, and a death
 * could be reported before the pain that preceded it. The grammar was already
 * right; the BATCHING is what "3 kobolds die." needs, and none of it existed.
 *
 * Fixtures use the real bound races (harness monReg) so `race` identity is the
 * pointer comparison upstream does - two makeRace() calls are two races and
 * must NOT stack, which is half of what makes the stacking test meaningful.
 */

import { describe, expect, it } from "vitest";
import { MFLAG, MON_MSG } from "../generated/index.js";
import { loc } from "../loc.js";
import type { Loc } from "../loc.js";
import type { Monster } from "../mon/monster.js";
import type { MonsterRace } from "../mon/types.js";
import { PN } from "../player/types.js";
import type { GameState } from "./context.js";
import { addMon, makeRace, makeState } from "./harness.js";
import {
  addMonsterMessage,
  addMonsterMessageShowDamage,
  messagePain,
  messagePainShowDamage,
  pendingMonsterMessages,
  showMonsterMessages,
} from "./mon-message.js";
import { noticeStuff } from "./notice.js";

/** A state whose message sink is a list, as every shell's really is. */
function harness(): { state: GameState; lines: string[] } {
  const state = makeState({ playerGrid: loc(10, 10) });
  const lines: string[] = [];
  state.msg = (text: string): void => void lines.push(text);
  return { state, lines };
}

/** A monster of `race`, obvious (visible and not camouflaged) by default. */
let nextX = 0;
function put(
  state: GameState,
  race: MonsterRace,
  opts: { obvious?: boolean; at?: Loc } = {},
): Monster {
  const grid = opts.at ?? loc(2 + (nextX++ % 30), 2);
  const mon = addMon(state, race, grid, { hp: 30 });
  if (opts.obvious ?? true) mon.mflag.on(MFLAG.VISIBLE);
  return mon;
}

describe("stack_message (mon-msg.c L200): repeats of one race become one line", () => {
  it("three kobolds dying is one counted, pluralised line", () => {
    const { state, lines } = harness();
    const race = makeRace();
    for (let i = 0; i < 3; i++) {
      addMonsterMessage(state, put(state, race), MON_MSG.DIE, false);
    }
    expect(pendingMonsterMessages(state)).toHaveLength(1);
    showMonsterMessages(state);
    /* get_subject's count branch + get_message_text's plural branch: the
     * template is "die[s].", so N > 1 takes the empty singular arm. */
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^3 .* die\.$/);
    expect(lines[0]).not.toMatch(/^The /);
  });

  it("two different races never stack, however alike", () => {
    const { state, lines } = harness();
    /* Two calls, two race objects: upstream compares mon_msg[i].race ==
     * mon->race, a POINTER test, so identical stats are still two lines. */
    addMonsterMessage(state, put(state, makeRace()), MON_MSG.DIE, false);
    addMonsterMessage(state, put(state, makeRace()), MON_MSG.DIE, false);
    expect(pendingMonsterMessages(state)).toHaveLength(2);
    showMonsterMessages(state);
    expect(lines).toHaveLength(2);
    for (const line of lines) expect(line).toMatch(/^The /);
  });

  it("one race with two different codes stays two lines", () => {
    const { state } = harness();
    const race = makeRace();
    addMonsterMessage(state, put(state, race), MON_MSG.DIE, false);
    addMonsterMessage(state, put(state, race), MON_MSG.WAKES_UP, false);
    expect(pendingMonsterMessages(state)).toHaveLength(2);
  });

  it("the flags are part of the key: an unseen kobold does not join a seen one", () => {
    const { state, lines } = harness();
    const race = makeRace();
    addMonsterMessage(state, put(state, race), MON_MSG.DIE, false);
    addMonsterMessage(
      state,
      put(state, race, { obvious: false }),
      MON_MSG.DIE,
      false,
    );
    expect(pendingMonsterMessages(state)).toHaveLength(2);
    showMonsterMessages(state);
    /* message_flags' MON_MSG_FLAG_INVISIBLE reaches get_subject, which says
     * "It" rather than naming a race the player has not seen. */
    expect(lines).toContain("It dies.");
    expect(lines.some((l) => l.startsWith("The "))).toBe(true);
  });
});

describe("redundant_monster_message (mon-msg.c L147)", () => {
  it("the same monster cannot say the same thing twice before a flush", () => {
    const { state, lines } = harness();
    const mon = put(state, makeRace());
    /* Upstream's reason: monster-versus-monster splash can hit one monster
     * twice inside a single projection. */
    expect(addMonsterMessage(state, mon, MON_MSG.DIE, false)).toBe(true);
    expect(addMonsterMessage(state, mon, MON_MSG.DIE, false)).toBe(false);
    showMonsterMessages(state);
    expect(lines).toEqual(["The " + mon.race.name + " dies."]);
  });

  it("but it can say a DIFFERENT thing, and can repeat after a flush", () => {
    const { state } = harness();
    const mon = put(state, makeRace());
    addMonsterMessage(state, mon, MON_MSG.DIE, false);
    expect(addMonsterMessage(state, mon, MON_MSG.WAKES_UP, false)).toBe(true);
    showMonsterMessages(state);
    /* show_monster_messages clears size_mon_hist as well as size_mon_msg. */
    expect(addMonsterMessage(state, mon, MON_MSG.DIE, false)).toBe(true);
  });

  it("a duplicate is not counted, so the line does not say 2", () => {
    const { state, lines } = harness();
    const mon = put(state, makeRace());
    addMonsterMessage(state, mon, MON_MSG.DIE, false);
    addMonsterMessage(state, mon, MON_MSG.DIE, false);
    showMonsterMessages(state);
    expect(lines[0]).not.toMatch(/^2 /);
  });
});

describe("what_delay (mon-msg.c L238): three passes, deaths last", () => {
  it("a death queued FIRST is still shown LAST", () => {
    const { state, lines } = harness();
    const dying = makeRace();
    const hurt = makeRace();
    addMonsterMessage(state, put(state, dying), MON_MSG.DIE, false);
    addMonsterMessage(state, put(state, hurt), MON_MSG.WAKES_UP, false);
    showMonsterMessages(state);
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/ dies\.$/);
  });

  it("MON_MSG_DESTROYED is a death too", () => {
    const { state, lines } = harness();
    addMonsterMessage(state, put(state, makeRace()), MON_MSG.DESTROYED, false);
    addMonsterMessage(state, put(state, makeRace()), MON_MSG.WAKES_UP, false);
    showMonsterMessages(state);
    expect(lines[1]).toMatch(/ is destroyed\.$/);
  });

  it("delay = true is the MIDDLE pass, after the immediate lines", () => {
    const { state, lines } = harness();
    const fleeing = makeRace();
    const waking = makeRace();
    /* Queued in the wrong order on purpose: the flee line goes in first. */
    addMonsterMessage(state, put(state, fleeing), MON_MSG.FLEE_IN_TERROR, true);
    addMonsterMessage(state, put(state, waking), MON_MSG.WAKES_UP, false);
    showMonsterMessages(state);
    expect(lines[0]).toMatch(/ wakes up\.$/);
    expect(lines[1]).toMatch(/ flees in terror!$/);
  });

  it("the delay flag cannot move a death out of the last pass", () => {
    const { state, lines } = harness();
    /* what_delay short-circuits on DIE/DESTROYED before it looks at `delay`. */
    addMonsterMessage(state, put(state, makeRace()), MON_MSG.DIE, true);
    addMonsterMessage(
      state,
      put(state, makeRace()),
      MON_MSG.FLEE_IN_TERROR,
      true,
    );
    showMonsterMessages(state);
    expect(lines[1]).toMatch(/ dies\.$/);
  });

  it("a race that both dies and flees is ordered by pass, not by queueing", () => {
    const { state, lines } = harness();
    const race = makeRace();
    addMonsterMessage(state, put(state, race), MON_MSG.DIE, false);
    addMonsterMessage(state, put(state, race), MON_MSG.FLEE_IN_TERROR, true);
    addMonsterMessage(state, put(state, race), MON_MSG.WAKES_UP, false);
    showMonsterMessages(state);
    const name = race.name;
    expect(lines).toEqual([
      `The ${name} wakes up.`,
      `The ${name} flees in terror!`,
      `The ${name} dies.`,
    ]);
  });
});

describe("PN_MON_MESSAGE (player-calcs.c:2552)", () => {
  it("queueing raises the bit and noticeStuff is what shows the line", () => {
    const { state, lines } = harness();
    const up = state.actor.player.upkeep;
    expect(up.notice & PN.MON_MESSAGE).toBe(0);

    addMonsterMessage(state, put(state, makeRace()), MON_MSG.DIE, false);
    expect(up.notice & PN.MON_MESSAGE).toBe(PN.MON_MESSAGE);
    /* Nothing is said until the drain: this is the whole behaviour change. */
    expect(lines).toEqual([]);

    noticeStuff(state);
    expect(lines).toHaveLength(1);
    expect(up.notice & PN.MON_MESSAGE).toBe(0);
  });

  it("a second drain says nothing - the queue and the history are cleared", () => {
    const { state, lines } = harness();
    addMonsterMessage(state, put(state, makeRace()), MON_MSG.DIE, false);
    noticeStuff(state);
    noticeStuff(state);
    expect(lines).toHaveLength(1);
    expect(pendingMonsterMessages(state)).toEqual([]);
  });

  it("a redundant or stacked message does not re-raise a cleared bit", () => {
    const { state } = harness();
    const race = makeRace();
    const mon = put(state, race);
    addMonsterMessage(state, mon, MON_MSG.DIE, false);
    const up = state.actor.player.upkeep;
    up.notice &= ~PN.MON_MESSAGE;
    /* Both of these return false, and upstream only raises on a NEW entry. */
    expect(addMonsterMessage(state, mon, MON_MSG.DIE, false)).toBe(false);
    expect(addMonsterMessage(state, put(state, race), MON_MSG.DIE, false)).toBe(
      false,
    );
    expect(up.notice & PN.MON_MESSAGE).toBe(0);
  });

  it("two games do not share a queue", () => {
    const a = harness();
    const b = harness();
    addMonsterMessage(a.state, put(a.state, makeRace()), MON_MSG.DIE, false);
    showMonsterMessages(b.state);
    expect(b.lines).toEqual([]);
    expect(pendingMonsterMessages(a.state)).toHaveLength(1);
  });
});

describe("MON_MSG_FLAG_DAMAGE (mon-msg.c L494-501)", () => {
  it("one monster shows the exact damage", () => {
    const { state, lines } = harness();
    addMonsterMessageShowDamage(
      state,
      put(state, makeRace()),
      MON_MSG.DIE,
      false,
      17,
    );
    showMonsterMessages(state);
    expect(lines[0]).toMatch(/ dies\. \(17\)$/);
  });

  it("several stacked monsters show the ROUNDED MEAN, not the total", () => {
    const { state, lines } = harness();
    const race = makeRace();
    /* 10 + 20 + 31 = 61 over 3: 20 remainder 1, and half a share is 2, so
     * the remainder does NOT round up. */
    for (const dam of [10, 20, 31]) {
      addMonsterMessageShowDamage(state, put(state, race), MON_MSG.DIE, false, dam);
    }
    showMonsterMessages(state);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/ \(average 20\)$/);
  });

  it("a remainder of at least half a share rounds up", () => {
    const { state, lines } = harness();
    const race = makeRace();
    /* 10 + 20 + 32 = 62 over 3: 20 remainder 2, half a share is 2. */
    for (const dam of [10, 20, 32]) {
      addMonsterMessageShowDamage(state, put(state, race), MON_MSG.DIE, false, dam);
    }
    showMonsterMessages(state);
    expect(lines[0]).toMatch(/ \(average 21\)$/);
  });

  it("a damage line never stacks onto a plain one of the same code", () => {
    const { state, lines } = harness();
    const race = makeRace();
    addMonsterMessage(state, put(state, race), MON_MSG.DIE, false);
    addMonsterMessageShowDamage(state, put(state, race), MON_MSG.DIE, false, 9);
    /* MON_MSG_FLAG_DAMAGE is in the flags, and the flags are the key. */
    expect(pendingMonsterMessages(state)).toHaveLength(2);
    showMonsterMessages(state);
    expect(lines.filter((l) => l.endsWith("(9)"))).toHaveLength(1);
  });

  it("message_pain_show_damage leaves an unharmed monster without a ' (0)'", () => {
    const { state, lines } = harness();
    const mon = put(state, makeRace());
    mon.maxhp = 100;
    mon.hp = 100;
    messagePainShowDamage(state, mon, 0);
    showMonsterMessages(state);
    expect(lines[0]).not.toMatch(/\(/);
  });

  it("message_pain grades by the damage against the pre-hit hp", () => {
    const { state, lines } = harness();
    const race = makeRace();
    const light = put(state, race);
    light.maxhp = 100;
    light.hp = 96; /* 96/100 -> MON_MSG_95, the mildest grade */
    const heavy = put(state, race);
    heavy.maxhp = 100;
    heavy.hp = 5; /* 5/100 -> MON_MSG_10 or worse */
    messagePain(state, light, 4);
    messagePain(state, heavy, 95);
    showMonsterMessages(state);
    /* Two grades means two codes means two lines, from one race. */
    expect(lines).toHaveLength(2);
    expect(lines[0]).not.toBe(lines[1]);
  });
});

describe("panel_contains / MON_MSG_FLAG_OFFSCREEN (mon-msg.c L167)", () => {
  it("unbound, nothing is offscreen - core has no camera of its own", () => {
    const { state, lines } = harness();
    addMonsterMessage(state, put(state, makeRace()), MON_MSG.DIE, false);
    showMonsterMessages(state);
    expect(lines[0]).not.toContain("offscreen");
  });

  it("bound, the tag appears and splits the stack", () => {
    const { state, lines } = harness();
    const race = makeRace();
    const onscreen = put(state, race, { at: loc(10, 10) });
    const offscreen = put(state, race, { at: loc(30, 20) });
    state.panelContains = (grid): boolean => grid.x < 20;

    addMonsterMessage(state, onscreen, MON_MSG.DIE, false);
    addMonsterMessage(state, offscreen, MON_MSG.DIE, false);
    /* Same race, same code, different flags: two lines. */
    expect(pendingMonsterMessages(state)).toHaveLength(2);
    showMonsterMessages(state);
    expect(lines.filter((l) => l.includes("(offscreen)"))).toHaveLength(1);
  });
});

describe("MAX_STORED_MON_MSG (mon-msg.c L30)", () => {
  it("the 201st distinct line is dropped rather than growing without bound", () => {
    const { state } = harness();
    const codes = [
      MON_MSG.WAKES_UP,
      MON_MSG.MORE_DAZED,
      MON_MSG.UNHARMED,
      MON_MSG.FLEE_IN_TERROR,
    ];
    let made = 0;
    outer: for (let r = 0; r < 60; r++) {
      const race = makeRace();
      for (const code of codes) {
        if (!addMonsterMessage(state, put(state, race), code, false)) break outer;
        made++;
        if (made > 220) break outer;
      }
    }
    expect(pendingMonsterMessages(state)).toHaveLength(200);
  });
});
