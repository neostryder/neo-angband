/**
 * Upstream unit tests from reference/src/tests/player/timed.c
 *
 * Mapping:
 *   timed_name_to_idx      -> timedNameToIdx (effects/effect.ts)
 *   player_timed_grade_eq  -> playerTimedGradeEq
 *   player_set_timed       -> playerSetTimed
 *   player_inc_check       -> playerIncCheck
 *   player_inc_timed       -> playerIncTimed
 *   player_dec_timed       -> playerDecTimed
 *   player_clear_timed     -> playerClearTimed
 *
 * Event tracking (EVENT_MESSAGE / EVENT_INPUT_FLUSH) is reproduced via
 * PlayerTimedHooks: onMessage classifies by msgt ("RECOVER" vs effect.msgt),
 * onNotify records disturb. No angband init is required.
 */

import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EF, OF, TMD } from "../generated";
import { timedNameToIdx } from "../effects/effect";
import { Rng } from "../rng";
import { bindPlayer } from "./bind";
import type { PlayerPackRecords } from "./bind";
import type { TimedEffect } from "./types";
import { TMD_MAX } from "./types";
import type {
  PlayerIncCheckHooks,
  PlayerIncCheckQueries,
  PlayerTimedHooks,
  PlayerTimedTarget,
} from "./timed";
import {
  playerClearTimed,
  playerDecTimed,
  playerIncCheck,
  playerIncTimed,
  playerSetTimed,
  playerTimedGradeEq,
} from "./timed";

function packJson<T>(name: string): T[] {
  return (
    JSON.parse(
      readFileSync(
        new URL(`../../../content/pack/${name}.json`, import.meta.url),
        "utf8",
      ),
    ) as { records: T[] }
  ).records;
}

const reg = bindPlayer({
  races: packJson("p_race"),
  classes: packJson("class"),
  properties: packJson("player_property"),
  timed: packJson("player_timed"),
  shapes: packJson("shape"),
  bodies: packJson("body"),
  history: packJson("history"),
  realms: packJson("realm"),
} as PlayerPackRecords);

function effect(name: keyof typeof TMD): TimedEffect {
  const e = reg.timed.find((t) => t.name === name);
  if (!e) throw new Error(`no timed effect ${name}`);
  return e;
}

function player(): PlayerTimedTarget {
  return { timed: new Int16Array(TMD_MAX) };
}

/** First non-off grade (C: timed_effects[idx].grade->next). */
function firstGrade(e: TimedEffect) {
  return e.grades[1]!;
}

interface EventState {
  lastTracked: string | null;
  lastRecover: string | null;
  nTracked: number;
  nRecover: number;
  nUntracked: number;
  inputFlushed: boolean;
  notified: boolean;
  /**
   * onTransition calls, standing in for the on_begin_effect / on_end_effect
   * chains player_set_timed dispatches (player-timed.c:873-891). Only
   * set_timed6 asserts on these.
   */
  transitions: Array<{ idx: number; begin: boolean; canDisturb: boolean }>;
}

function tracker(trackedMsgt: string): PlayerTimedHooks & { st: EventState } {
  const st: EventState = {
    lastTracked: null,
    lastRecover: null,
    nTracked: 0,
    nRecover: 0,
    nUntracked: 0,
    inputFlushed: false,
    notified: false,
    transitions: [],
  };
  return {
    st,
    onMessage(text, msgt) {
      if (msgt === trackedMsgt) {
        st.lastTracked = text;
        st.nTracked++;
      } else if (msgt === "RECOVER") {
        st.lastRecover = text;
        st.nRecover++;
      } else {
        st.nUntracked++;
      }
    },
    onNotify(_idx, canDisturb) {
      st.notified = true;
      if (canDisturb) st.inputFlushed = true;
    },
    onTransition(idx, begin, canDisturb) {
      st.transitions.push({ idx, begin, canDisturb });
    },
  };
}

/**
 * The per-row assertion tail every table-driven upstream case shares
 * (timed.c:339-357 and its clones in set_timed1/4/5, inc_timed0/1, dec_timed0,
 * clear_timed0): the tracked message is emitted exactly once with the expected
 * text or not at all, likewise the MSG_RECOVER message, no message of any other
 * type is emitted, and disturb() ran iff the call notified and can_disturb.
 */
function expectTail(
  st: EventState,
  changeMsg: string | null,
  recoverMsg: string | null,
  notified: boolean,
  disturb: boolean,
): void {
  if (changeMsg) {
    expect(st.nTracked).toBe(1);
    expect(st.lastTracked).toBe(changeMsg);
  } else {
    expect(st.nTracked).toBe(0);
  }
  if (recoverMsg) {
    expect(st.nRecover).toBe(1);
    expect(st.lastRecover).toBe(recoverMsg);
  } else {
    expect(st.nRecover).toBe(0);
  }
  expect(st.nUntracked).toBe(0);
  expect(st.inputFlushed).toBe(notified && disturb);
}

/* TMD_FAIL_ codes (player-timed.h:40-44), mirroring the module-private
   constants in player/timed.ts. inc_check0 selects fail entries by code. */
const TMD_FAIL_FLAG_OBJECT = 1;
const TMD_FAIL_FLAG_RESIST = 2;
const TMD_FAIL_FLAG_VULN = 3;
const TMD_FAIL_FLAG_PLAYER = 4;
const TMD_FAIL_FLAG_TIMED_EFFECT = 5;

/** The C tables' `true` / `false` literals, kept terse so rows stay one line. */
const T = true;
const F = false;

describe("player/timed (reference/src/tests/player/timed.c)", () => {
  // upstream: test_name2idx0
  it("name2idx0", () => {
    expect(timedNameToIdx("FAST")).toBe(TMD.FAST);
    expect(timedNameToIdx("FOOD")).toBe(TMD.FOOD);
    expect(timedNameToIdx("XYZZY")).toBeLessThan(0);
  });

  // upstream: test_timed_grade_eq0
  it("timed_grade_eq0", () => {
    const p = player();
    const slow = effect("SLOW");
    const cut = effect("CUT");

    p.timed[TMD.SLOW] = 0;
    expect(playerTimedGradeEq(p, slow, firstGrade(slow).name!)).toBe(false);
    p.timed[TMD.SLOW] = 500;
    expect(playerTimedGradeEq(p, slow, firstGrade(slow).name!)).toBe(true);

    p.timed[TMD.CUT] = 0;
    for (const g of cut.grades.slice(1)) {
      expect(playerTimedGradeEq(p, cut, g.name!)).toBe(false);
    }

    const rng = new Rng(42);
    for (let i = 1; i < cut.grades.length; i++) {
      const last = cut.grades[i - 1]!;
      const tgt = cut.grades[i]!;
      expect(last.max + 1).toBeLessThanOrEqual(tgt.max);
      p.timed[TMD.CUT] = rng.randRange(last.max + 1, tgt.max);
      for (const g of cut.grades.slice(1)) {
        expect(playerTimedGradeEq(p, cut, g.name!)).toBe(g === tgt);
      }
      p.timed[TMD.CUT] = tgt.max;
      for (const g of cut.grades.slice(1)) {
        expect(playerTimedGradeEq(p, cut, g.name!)).toBe(g === tgt);
      }
    }
  });

  // upstream: test_set_timed0 — SLOW on/off, up/end messages, no inc/dec msgs
  it("set_timed0", () => {
    const slow = effect("SLOW");
    const max = firstGrade(slow).max;
    const up = firstGrade(slow).upMsg!;
    const onEnd = slow.onEnd;

    type Case = {
      inn: number;
      neu: number;
      notify: boolean;
      disturb: boolean;
      out: number;
      notified: boolean;
      changeMsg: string | null;
      recoverMsg: string | null;
    };
    const cases: Case[] = [
      { inn: 0, neu: 0, notify: true, disturb: true, out: 0, notified: false, changeMsg: null, recoverMsg: null },
      { inn: 0, neu: 0, notify: true, disturb: false, out: 0, notified: false, changeMsg: null, recoverMsg: null },
      { inn: 0, neu: 0, notify: false, disturb: true, out: 0, notified: false, changeMsg: null, recoverMsg: null },
      { inn: 0, neu: 0, notify: false, disturb: false, out: 0, notified: false, changeMsg: null, recoverMsg: null },
      { inn: 0, neu: -1, notify: true, disturb: true, out: 0, notified: false, changeMsg: null, recoverMsg: null },
      { inn: 0, neu: -83, notify: false, disturb: true, out: 0, notified: false, changeMsg: null, recoverMsg: null },
      { inn: 0, neu: -519, notify: true, disturb: false, out: 0, notified: false, changeMsg: null, recoverMsg: null },
      { inn: 0, neu: -1478, notify: false, disturb: false, out: 0, notified: false, changeMsg: null, recoverMsg: null },
      { inn: 1, neu: 1, notify: true, disturb: true, out: 1, notified: false, changeMsg: null, recoverMsg: null },
      { inn: 31, neu: 31, notify: true, disturb: false, out: 31, notified: false, changeMsg: null, recoverMsg: null },
      { inn: 198, neu: 198, notify: false, disturb: true, out: 198, notified: false, changeMsg: null, recoverMsg: null },
      { inn: 1024, neu: 1024, notify: false, disturb: false, out: 1024, notified: false, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max, notify: true, disturb: true, out: max, notified: false, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max, notify: true, disturb: false, out: max, notified: false, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max, notify: false, disturb: true, out: max, notified: false, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max, notify: false, disturb: false, out: max, notified: false, changeMsg: null, recoverMsg: null },
      { inn: 0, neu: 1, notify: true, disturb: true, out: 1, notified: true, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: 53, notify: true, disturb: false, out: 53, notified: true, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: 100, notify: false, disturb: true, out: 100, notified: true, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: 5131, notify: false, disturb: false, out: 5131, notified: true, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max, notify: true, disturb: true, out: max, notified: true, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max, notify: false, disturb: true, out: max, notified: true, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max, notify: true, disturb: false, out: max, notified: true, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max, notify: false, disturb: false, out: max, notified: true, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max + 1, notify: true, disturb: true, out: max, notified: true, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max + 15, notify: true, disturb: true, out: max, notified: true, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max + 307, notify: true, disturb: true, out: max, notified: true, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max + 1008, notify: true, disturb: true, out: max, notified: true, changeMsg: up, recoverMsg: null },
      { inn: 1, neu: 0, notify: true, disturb: true, out: 0, notified: true, changeMsg: null, recoverMsg: onEnd },
      { inn: 90, neu: 0, notify: false, disturb: true, out: 0, notified: false, changeMsg: null, recoverMsg: null },
      { inn: 458, neu: 0, notify: true, disturb: false, out: 0, notified: true, changeMsg: null, recoverMsg: onEnd },
      { inn: 8192, neu: 0, notify: false, disturb: false, out: 0, notified: false, changeMsg: null, recoverMsg: null },
      { inn: max, neu: 0, notify: true, disturb: true, out: 0, notified: true, changeMsg: null, recoverMsg: onEnd },
      { inn: max, neu: 0, notify: false, disturb: true, out: 0, notified: false, changeMsg: null, recoverMsg: null },
      { inn: max, neu: 0, notify: true, disturb: false, out: 0, notified: true, changeMsg: null, recoverMsg: onEnd },
      { inn: max, neu: 0, notify: false, disturb: false, out: 0, notified: false, changeMsg: null, recoverMsg: null },
      { inn: 7, neu: -1, notify: true, disturb: true, out: 0, notified: true, changeMsg: null, recoverMsg: onEnd },
      { inn: 38, neu: -125, notify: false, disturb: true, out: 0, notified: false, changeMsg: null, recoverMsg: null },
      { inn: 428, neu: -96, notify: true, disturb: false, out: 0, notified: true, changeMsg: null, recoverMsg: onEnd },
      { inn: 2197, neu: -1364, notify: false, disturb: false, out: 0, notified: false, changeMsg: null, recoverMsg: null },
      { inn: 1, neu: 2, notify: true, disturb: true, out: 2, notified: true, changeMsg: null, recoverMsg: null },
      { inn: 10, neu: 30, notify: false, disturb: true, out: 30, notified: false, changeMsg: null, recoverMsg: null },
      { inn: 853, neu: 901, notify: true, disturb: false, out: 901, notified: true, changeMsg: null, recoverMsg: null },
      { inn: 2412, neu: 2300, notify: false, disturb: false, out: 2300, notified: false, changeMsg: null, recoverMsg: null },
      { inn: 2, neu: 1, notify: true, disturb: true, out: 1, notified: true, changeMsg: null, recoverMsg: null },
      { inn: 73, neu: 60, notify: false, disturb: true, out: 60, notified: false, changeMsg: null, recoverMsg: null },
      { inn: 345, neu: 121, notify: true, disturb: false, out: 121, notified: true, changeMsg: null, recoverMsg: null },
      { inn: 3890, neu: 3883, notify: false, disturb: false, out: 3883, notified: false, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max + 1, notify: true, disturb: true, out: max, notified: false, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max + 81, notify: false, disturb: true, out: max, notified: false, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max + 673, notify: true, disturb: false, out: max, notified: false, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max + 2738, notify: false, disturb: false, out: max, notified: false, changeMsg: null, recoverMsg: null },
    ];

    const p = player();
    for (const c of cases) {
      const hooks = tracker(slow.msgt);
      p.timed[TMD.SLOW] = c.inn;
      const result = playerSetTimed(p, slow, c.neu, c.notify, c.disturb, hooks);
      expect(result).toBe(c.notified);
      expect(p.timed[TMD.SLOW]).toBe(c.out);
      if (c.changeMsg) {
        expect(hooks.st.nTracked).toBe(1);
        expect(hooks.st.lastTracked).toBe(c.changeMsg);
      } else {
        expect(hooks.st.nTracked).toBe(0);
      }
      if (c.recoverMsg) {
        expect(hooks.st.nRecover).toBe(1);
        expect(hooks.st.lastRecover).toBe(c.recoverMsg);
      } else {
        expect(hooks.st.nRecover).toBe(0);
      }
      expect(hooks.st.nUntracked).toBe(0);
      expect(hooks.st.inputFlushed).toBe(c.notified && c.disturb);
    }
  });

  // upstream: test_set_timed1 — POISONED with on-increase/decrease
  it("set_timed1", () => {
    const pois = effect("POISONED");
    const max = firstGrade(pois).max;
    const up = firstGrade(pois).upMsg!;
    const onEnd = pois.onEnd;
    const onInc = pois.onIncrease;
    const onDec = pois.onDecrease;

    type Case = {
      inn: number;
      neu: number;
      notify: boolean;
      disturb: boolean;
      out: number;
      notified: boolean;
      changeMsg: string | null;
      recoverMsg: string | null;
    };
    const cases: Case[] = [
      /* No change from zero: never notifies or messages (timed.c:371-375). */
      { inn: 0, neu: 0, notify: T, disturb: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, neu: 0, notify: T, disturb: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, neu: 0, notify: F, disturb: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, neu: 0, notify: F, disturb: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      /* Zero to a negative value is coerced to no change (timed.c:376-381). */
      { inn: 0, neu: -1, notify: T, disturb: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, neu: -62, notify: F, disturb: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, neu: -397, notify: T, disturb: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, neu: -1008, notify: F, disturb: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      /* No change from the current nonzero value never notifies (timed.c:382-395). */
      { inn: 1, neu: 1, notify: T, disturb: T, out: 1, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 23, neu: 23, notify: T, disturb: F, out: 23, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 417, neu: 417, notify: F, disturb: T, out: 417, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 3693, neu: 3693, notify: F, disturb: F, out: 3693, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max, notify: T, disturb: T, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max, notify: T, disturb: F, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max, notify: F, disturb: T, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max, notify: F, disturb: F, out: max, notified: F, changeMsg: null, recoverMsg: null },
      /* Going up a grade always notifies: the new grade has an up_msg
         (player-timed.c:842-845). */
      { inn: 0, neu: 1, notify: T, disturb: T, out: 1, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: 49, notify: T, disturb: F, out: 49, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: 175, notify: F, disturb: T, out: 175, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: 1467, notify: F, disturb: F, out: 1467, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max, notify: T, disturb: T, out: max, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max, notify: F, disturb: T, out: max, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max, notify: T, disturb: F, out: max, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max, notify: F, disturb: F, out: max, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max + 1, notify: T, disturb: T, out: max, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max + 15, notify: T, disturb: T, out: max, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max + 307, notify: T, disturb: T, out: max, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max + 1008, notify: T, disturb: T, out: max, notified: T, changeMsg: up, recoverMsg: null },
      /* Going down a grade: POISONED's grade 0 has no down_msg, so this
         notifies only on request, and when notifying issues the MSG_RECOVER
         on_end message (player-timed.c:846-856). */
      { inn: 1, neu: 0, notify: T, disturb: T, out: 0, notified: T, changeMsg: null, recoverMsg: onEnd },
      { inn: 52, neu: 0, notify: F, disturb: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 327, neu: 0, notify: T, disturb: F, out: 0, notified: T, changeMsg: null, recoverMsg: onEnd },
      { inn: 6718, neu: 0, notify: F, disturb: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: 0, notify: T, disturb: T, out: 0, notified: T, changeMsg: null, recoverMsg: onEnd },
      { inn: max, neu: 0, notify: F, disturb: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: 0, notify: T, disturb: F, out: 0, notified: T, changeMsg: null, recoverMsg: onEnd },
      { inn: max, neu: 0, notify: F, disturb: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 5, neu: -1, notify: T, disturb: T, out: 0, notified: T, changeMsg: null, recoverMsg: onEnd },
      { inn: 66, neu: -138, notify: F, disturb: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 274, neu: -87, notify: T, disturb: F, out: 0, notified: T, changeMsg: null, recoverMsg: onEnd },
      { inn: 1056, neu: -1258, notify: F, disturb: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      /* Increasing within one grade notifies only on request; POISONED has an
         on_increase message, so notifying also emits it (player-timed.c:860-863). */
      { inn: 1, neu: 3, notify: T, disturb: T, out: 3, notified: T, changeMsg: onInc, recoverMsg: null },
      { inn: 12, neu: 14, notify: F, disturb: T, out: 14, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 628, neu: 671, notify: T, disturb: F, out: 671, notified: T, changeMsg: onInc, recoverMsg: null },
      { inn: 1005, neu: 1011, notify: F, disturb: F, out: 1011, notified: F, changeMsg: null, recoverMsg: null },
      /* Decreasing within one grade: likewise via on_decrease
         (player-timed.c:856-859). */
      { inn: 4, neu: 1, notify: T, disturb: T, out: 1, notified: T, changeMsg: onDec, recoverMsg: null },
      { inn: 58, neu: 43, notify: F, disturb: T, out: 43, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 271, neu: 248, notify: T, disturb: F, out: 248, notified: T, changeMsg: onDec, recoverMsg: null },
      { inn: 1315, neu: 1280, notify: F, disturb: F, out: 1280, notified: F, changeMsg: null, recoverMsg: null },
      /* Increasing past the maximum while already there never notifies
         (player-timed.c:817-824; behaviour changed between 4.2.4 and 4.2.5). */
      { inn: max, neu: max + 1, notify: T, disturb: T, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max + 67, notify: F, disturb: T, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max + 323, notify: T, disturb: F, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max + 1141, notify: F, disturb: F, out: max, notified: F, changeMsg: null, recoverMsg: null },
    ];

    const p = player();
    for (const c of cases) {
      const hooks = tracker(pois.msgt);
      p.timed[TMD.POISONED] = c.inn;
      const result = playerSetTimed(p, pois, c.neu, c.notify, c.disturb, hooks);
      expect(result).toBe(c.notified);
      expect(p.timed[TMD.POISONED]).toBe(c.out);
      if (c.changeMsg) {
        expect(hooks.st.nTracked).toBe(1);
        expect(hooks.st.lastTracked).toBe(c.changeMsg);
      } else {
        expect(hooks.st.nTracked).toBe(0);
      }
      if (c.recoverMsg) {
        expect(hooks.st.nRecover).toBe(1);
        expect(hooks.st.lastRecover).toBe(c.recoverMsg);
      } else {
        expect(hooks.st.nRecover).toBe(0);
      }
      expect(hooks.st.inputFlushed).toBe(c.notified && c.disturb);
    }
  });

  /*
   * upstream: test_set_timed2 (timed.c:497-869) — player_set_timed over every
   * ordered pair of CUT grades. Each grade has an up_msg and no down_msg; there
   * is an overall on_end but no on_increase / on_decrease. The C walks the grade
   * list from the implicit "off" grade, so the off grade participates as both
   * start and end.
   */
  it("set_timed2", () => {
    const cut = effect("CUT");
    const p = player();
    const rng = new Rng(7);

    /* Preconditions from the C's header comment (timed.c:497-501). Without
       these the silent-move expectations below would pass vacuously. */
    expect(cut.onIncrease).toBe("");
    expect(cut.onDecrease).toBe("");
    expect(cut.onEnd).not.toBe("");
    for (const g of cut.grades) expect(g.downMsg).toBe(null);
    for (const g of cut.grades.slice(1)) expect(g.upMsg).not.toBe(null);

    const last = cut.grades.length - 1;
    for (let si = 0; si < cut.grades.length; si++) {
      const s = cut.grades[si]!;
      /* s_l, the lower limit of the starting grade (timed.c:505-508): the
         previous grade's max + 1, or the grade's own max for the off grade. */
      const sL = si === 0 ? s.max : cut.grades[si - 1]!.max + 1;
      expect(sL).toBeLessThanOrEqual(s.max);

      for (let ei = 0; ei < cut.grades.length; ei++) {
        const e = cut.grades[ei]!;
        const eL = ei === 0 ? e.max : cut.grades[ei - 1]!.max + 1;
        expect(eL).toBeLessThanOrEqual(e.max);

        if (s.grade === e.grade) {
          /* No change of duration: never notifies, never messages
             (player-timed.c:801-804). */
          const oldv = rng.randRange(sL, s.max);
          for (let i = 0; i < 4; i++) {
            const notify = i < 2;
            const disturb = !(i % 2);
            const h = tracker(cut.msgt);
            p.timed[TMD.CUT] = oldv;
            expect(playerSetTimed(p, cut, oldv, notify, disturb, h)).toBe(false);
            expect(p.timed[TMD.CUT]).toBe(oldv);
            expectTail(h.st, null, null, false, disturb);
          }

          if (si === last) {
            /* Exceeding the maximum while already at it behaves as no change
               (player-timed.c:817-824; it notified if asked before 4.2.5). */
            for (let i = 0; i < 4; i++) {
              const notify = i < 2;
              const disturb = !(i % 2);
              const h = tracker(cut.msgt);
              p.timed[TMD.CUT] = s.max;
              const newv = rng.randRange(
                Math.min(s.max + 1, 32767),
                Math.min(s.max + 10, 32767),
              );
              expect(playerSetTimed(p, cut, newv, notify, disturb, h)).toBe(false);
              expect(p.timed[TMD.CUT]).toBe(s.max);
              expectTail(h.st, null, null, false, disturb);
            }
          } else if (!s.grade) {
            /* Going below the minimum while already at it: the lower_bound
               clamp (player-timed.c:799) makes it a no-change too. */
            for (let i = 0; i < 4; i++) {
              const notify = i < 2;
              const disturb = !(i % 2);
              const h = tracker(cut.msgt);
              p.timed[TMD.CUT] = sL;
              const newv = rng.randRange(sL - 30, sL - 1);
              expect(playerSetTimed(p, cut, newv, notify, disturb, h)).toBe(false);
              expect(p.timed[TMD.CUT]).toBe(sL);
              expectTail(h.st, null, null, false, disturb);
            }
          }

          if (sL < s.max) {
            /* Increase inside one grade: no on_increase message, so this
               notifies only on request and stays silent. */
            for (let i = 0; i < 4; i++) {
              const notify = i < 2;
              const disturb = !(i % 2);
              const h = tracker(cut.msgt);
              const from = rng.randRange(sL, s.max - 1);
              const newv = rng.randRange(from + 1, s.max);
              p.timed[TMD.CUT] = from;
              expect(playerSetTimed(p, cut, newv, notify, disturb, h)).toBe(notify);
              expect(p.timed[TMD.CUT]).toBe(newv);
              expectTail(h.st, null, null, notify, disturb);
            }
            /* Decrease inside one grade: likewise, no on_decrease message. */
            for (let i = 0; i < 4; i++) {
              const notify = i < 2;
              const disturb = !(i % 2);
              const h = tracker(cut.msgt);
              const from = rng.randRange(sL + 1, s.max);
              const newv = rng.randRange(sL, from - 1);
              p.timed[TMD.CUT] = from;
              expect(playerSetTimed(p, cut, newv, notify, disturb, h)).toBe(notify);
              expect(p.timed[TMD.CUT]).toBe(newv);
              expectTail(h.st, null, null, notify, disturb);
            }

            if (si === last) {
              /* Above the maximum from below it: a within-grade increase plus
                 the coercion to the maximum (player-timed.c:825). */
              for (let i = 0; i < 4; i++) {
                const notify = i < 2;
                const disturb = !(i % 2);
                const h = tracker(cut.msgt);
                const from = rng.randRange(sL, s.max - 1);
                const newv = rng.randRange(
                  Math.min(s.max + 1, 32767),
                  Math.min(s.max + 20, 32767),
                );
                p.timed[TMD.CUT] = from;
                expect(playerSetTimed(p, cut, newv, notify, disturb, h)).toBe(notify);
                expect(p.timed[TMD.CUT]).toBe(s.max);
                expectTail(h.st, null, null, notify, disturb);
              }
            }
            /* Upstream's `else if (!s->grade)` sibling here (timed.c:713-751)
               is unreachable for any effect: the off grade always has
               s_l == s->max == 0, so `s_l < s->max` is false. Not ported
               rather than shipped as dead code (see the findings doc). */
          }
        } else {
          const oldv = rng.randRange(sL, s.max);
          const newv = rng.randRange(eL, e.max);
          /* Up a grade always notifies because the new grade has an up_msg;
             down a grade notifies only on request, and only messages -- via
             the overall on_end -- when the effect actually lapses
             (player-timed.c:841-856). */
          for (let i = 0; i < 4; i++) {
            const notify = i < 2;
            const disturb = !(i % 2);
            const notified = e.grade > s.grade ? true : notify;
            const h = tracker(cut.msgt);
            p.timed[TMD.CUT] = oldv;
            expect(playerSetTimed(p, cut, newv, notify, disturb, h)).toBe(notified);
            expect(p.timed[TMD.CUT]).toBe(newv);
            if (e.grade > s.grade) {
              expectTail(h.st, e.upMsg, null, notified, disturb);
            } else if (e.grade || !notified) {
              expectTail(h.st, null, null, notified, disturb);
            } else {
              expectTail(h.st, null, cut.onEnd, notified, disturb);
            }
          }

          if (ei === last) {
            /* Above the maximum. e is the top grade, so this is always an
               increase in grade: it always notifies with e's up_msg. */
            const overv = rng.randRange(
              Math.min(e.max + 1, 32767),
              Math.min(e.max + 10, 32767),
            );
            for (let i = 0; i < 4; i++) {
              const notify = i < 2;
              const disturb = !(i % 2);
              const h = tracker(cut.msgt);
              p.timed[TMD.CUT] = oldv;
              expect(playerSetTimed(p, cut, overv, notify, disturb, h)).toBe(true);
              expect(p.timed[TMD.CUT]).toBe(e.max);
              expectTail(h.st, e.upMsg, null, true, disturb);
            }
          } else if (!e.grade) {
            /* Below the minimum. e is the off grade, so the value is coerced
               to e_l == 0 and the effect lapses: notify only on request, with
               the on_end MSG_RECOVER message when notifying. */
            const underv = rng.randRange(eL - 1000, eL - 1);
            for (let i = 0; i < 4; i++) {
              const notify = i < 2;
              const disturb = !(i % 2);
              const h = tracker(cut.msgt);
              p.timed[TMD.CUT] = oldv;
              expect(playerSetTimed(p, cut, underv, notify, disturb, h)).toBe(notify);
              expect(p.timed[TMD.CUT]).toBe(eL);
              expectTail(h.st, null, notify ? cut.onEnd : null, notify, disturb);
            }
          }
        }
      }
    }
  });

  /*
   * upstream: test_set_timed3 (timed.c:864-1224) — player_set_timed over every
   * ordered pair of FOOD grades. Intermediate grades carry BOTH an up_msg and a
   * down_msg, the lowest ("Starving") only a down_msg, the highest ("Full") only
   * an up_msg, and there are no overall on_end / on_increase / on_decrease
   * messages. Because every reachable grade transition has a message, a change
   * of grade ALWAYS notifies here, in either direction — the property that
   * distinguishes this case from set_timed2.
   *
   * The C walks from grade->next, i.e. it skips the implicit "off" grade,
   * because FOOD has lower-bound 1 and can never be zero.
   */
  it("set_timed3", () => {
    const food = effect("FOOD");
    const p = player();
    const rng = new Rng(11);

    /* Preconditions from the C's header comment (timed.c:858-863). */
    expect(food.lowerBound).toBe(1);
    expect(food.onEnd).toBe("");
    expect(food.onIncrease).toBe("");
    expect(food.onDecrease).toBe("");
    /* Lowest grade: down_msg only. Highest: up_msg only. Middle: both. */
    const g = food.grades;
    expect(g[1]!.upMsg).toBe(null);
    expect(g[1]!.downMsg).not.toBe(null);
    expect(g[g.length - 1]!.upMsg).not.toBe(null);
    expect(g[g.length - 1]!.downMsg).toBe(null);
    for (const mid of g.slice(2, -1)) {
      expect(mid.upMsg).not.toBe(null);
      expect(mid.downMsg).not.toBe(null);
    }

    const last = food.grades.length - 1;
    for (let si = 1; si < food.grades.length; si++) {
      const s = food.grades[si]!;
      /* s_l (timed.c:869-872): previous grade's max + 1, or 1 for the lowest
         iterated grade — FOOD's lower_bound, since the off grade is skipped. */
      const sL = si === 1 ? 1 : food.grades[si - 1]!.max + 1;
      expect(sL).toBeLessThanOrEqual(s.max);

      for (let ei = 1; ei < food.grades.length; ei++) {
        const e = food.grades[ei]!;
        const eL = ei === 1 ? 1 : food.grades[ei - 1]!.max + 1;
        expect(eL).toBeLessThanOrEqual(e.max);

        if (s.grade === e.grade) {
          /* No change of duration: never notifies, never messages. */
          const oldv = rng.randRange(sL, s.max);
          for (let i = 0; i < 4; i++) {
            const notify = i < 2;
            const disturb = !(i % 2);
            const h = tracker(food.msgt);
            p.timed[TMD.FOOD] = oldv;
            expect(playerSetTimed(p, food, oldv, notify, disturb, h)).toBe(false);
            expect(p.timed[TMD.FOOD]).toBe(oldv);
            expectTail(h.st, null, null, false, disturb);
          }

          if (si === last) {
            /* Exceeding the maximum while already at it behaves as no change
               (player-timed.c:817-824). */
            for (let i = 0; i < 4; i++) {
              const notify = i < 2;
              const disturb = !(i % 2);
              const h = tracker(food.msgt);
              p.timed[TMD.FOOD] = s.max;
              const newv = rng.randRange(
                Math.min(s.max + 1, 32767),
                Math.min(s.max + 10, 32767),
              );
              expect(playerSetTimed(p, food, newv, notify, disturb, h)).toBe(false);
              expect(p.timed[TMD.FOOD]).toBe(s.max);
              expectTail(h.st, null, null, false, disturb);
            }
          }
          /* Upstream's `else if (!s->grade)` sibling (timed.c:960-990) cannot
             run for FOOD: the loop starts at grade->next, so s->grade >= 1. */

          if (sL < s.max) {
            /* Increase inside one grade: FOOD has no on_increase message, so
               this notifies only on request and stays silent. */
            for (let i = 0; i < 4; i++) {
              const notify = i < 2;
              const disturb = !(i % 2);
              const h = tracker(food.msgt);
              const from = rng.randRange(sL, s.max - 1);
              const newv = rng.randRange(from + 1, s.max);
              p.timed[TMD.FOOD] = from;
              expect(playerSetTimed(p, food, newv, notify, disturb, h)).toBe(notify);
              expect(p.timed[TMD.FOOD]).toBe(newv);
              expectTail(h.st, null, null, notify, disturb);
            }
            /* Decrease inside one grade: likewise, no on_decrease message. */
            for (let i = 0; i < 4; i++) {
              const notify = i < 2;
              const disturb = !(i % 2);
              const h = tracker(food.msgt);
              const from = rng.randRange(sL + 1, s.max);
              const newv = rng.randRange(sL, from - 1);
              p.timed[TMD.FOOD] = from;
              expect(playerSetTimed(p, food, newv, notify, disturb, h)).toBe(notify);
              expect(p.timed[TMD.FOOD]).toBe(newv);
              expectTail(h.st, null, null, notify, disturb);
            }

            if (si === last) {
              /* Above the maximum from below it: a within-grade increase plus
                 the coercion to the maximum. */
              for (let i = 0; i < 4; i++) {
                const notify = i < 2;
                const disturb = !(i % 2);
                const h = tracker(food.msgt);
                const from = rng.randRange(sL, s.max - 1);
                const newv = rng.randRange(
                  Math.min(s.max + 1, 32767),
                  Math.min(s.max + 20, 32767),
                );
                p.timed[TMD.FOOD] = from;
                expect(playerSetTimed(p, food, newv, notify, disturb, h)).toBe(notify);
                expect(p.timed[TMD.FOOD]).toBe(s.max);
                expectTail(h.st, null, null, notify, disturb);
              }
            }
          }
        } else {
          const oldv = rng.randRange(sL, s.max);
          const newv = rng.randRange(eL, e.max);
          /* A grade change in EITHER direction notifies, because the target
             grade always has the corresponding message (player-timed.c:841-849).
             Reachability makes this total: e == "Starving" is only ever entered
             going down (it is the lowest) and it has a down_msg; e == "Full" is
             only ever entered going up and it has an up_msg. */
          for (let i = 0; i < 4; i++) {
            const notify = i < 2;
            const disturb = !(i % 2);
            const h = tracker(food.msgt);
            p.timed[TMD.FOOD] = oldv;
            expect(playerSetTimed(p, food, newv, notify, disturb, h)).toBe(true);
            expect(p.timed[TMD.FOOD]).toBe(newv);
            expectTail(h.st, e.grade > s.grade ? e.upMsg : e.downMsg, null, true, disturb);
          }

          if (ei === last) {
            /* Above the maximum: coerced to e->max. e is the top grade, so this
               is always an increase in grade and always notifies with up_msg. */
            const overv = rng.randRange(
              Math.min(e.max + 1, 32767),
              Math.min(e.max + 10, 32767),
            );
            for (let i = 0; i < 4; i++) {
              const notify = i < 2;
              const disturb = !(i % 2);
              const h = tracker(food.msgt);
              p.timed[TMD.FOOD] = oldv;
              expect(playerSetTimed(p, food, overv, notify, disturb, h)).toBe(true);
              expect(p.timed[TMD.FOOD]).toBe(e.max);
              expectTail(h.st, e.upMsg, null, true, disturb);
            }
          }
          /* Upstream's `else if (!e->grade)` sibling (timed.c:1188-1213) cannot
             run for FOOD either, for the same reason as above. */
        }
      }
    }
  });

  /*
   * upstream: test_set_timed4 (timed.c:1226-1458) — player_set_timed on the
   * on/off effect OPP_ACID, whose temp_resist OVERLAPS a known elemental
   * immunity. Messages: grade up_msg, overall on_end and on_increase, but no
   * on_decrease. The `immune` column drives the notify suppression at
   * player-timed.c:828-833 (obj_k knows the resist AND the player is immune).
   */
  it("set_timed4", () => {
    const opp = effect("OPP_ACID");
    const max = firstGrade(opp).max;
    const up = firstGrade(opp).upMsg!;
    const onEnd = opp.onEnd;
    const onInc = opp.onIncrease;
    const onDec = opp.onDecrease;

    /* require(timed_effects[TMD_OPP_ACID].temp_resist != -1) (timed.c:1391):
       without a temp_resist the whole `immune` column would be inert. */
    expect(opp.tempResist).not.toBe(-1);
    /* OPP_ACID has an on_increase but no on_decrease (player_timed.txt), so the
       decrease rows below legitimately expect no message. */
    expect(onInc).not.toBe("");
    expect(onDec).toBe("");
    expect(onEnd).not.toBe("");

    type Case = {
      inn: number;
      neu: number;
      notify: boolean;
      disturb: boolean;
      /** obj_k knows the ACID resist AND player_is_immune(p, ACID). */
      immune: boolean;
      out: number;
      notified: boolean;
      changeMsg: string | null;
      recoverMsg: string | null;
    };
    const cases: Case[] = [
      /* No change from zero: never notifies, whatever notify/disturb/immune. */
      { inn: 0, neu: 0, notify: T, disturb: T, immune: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, neu: 0, notify: T, disturb: F, immune: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, neu: 0, notify: F, disturb: T, immune: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, neu: 0, notify: F, disturb: F, immune: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, neu: 0, notify: T, disturb: T, immune: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, neu: 0, notify: T, disturb: F, immune: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, neu: 0, notify: F, disturb: T, immune: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, neu: 0, notify: F, disturb: F, immune: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      /* Zero to a negative value is coerced to no change (lower_bound 0). */
      { inn: 0, neu: -1, notify: T, disturb: T, immune: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, neu: -26, notify: F, disturb: T, immune: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, neu: -301, notify: T, disturb: F, immune: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, neu: -1518, notify: F, disturb: F, immune: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, neu: -1, notify: T, disturb: T, immune: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, neu: -74, notify: F, disturb: T, immune: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, neu: -100, notify: T, disturb: F, immune: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, neu: -1011, notify: F, disturb: F, immune: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      /* No change from the current nonzero value never notifies. */
      { inn: 1, neu: 1, notify: T, disturb: T, immune: F, out: 1, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 30, neu: 30, notify: T, disturb: F, immune: F, out: 30, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 144, neu: 144, notify: F, disturb: T, immune: F, out: 144, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 1188, neu: 1188, notify: F, disturb: F, immune: F, out: 1188, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 1, neu: 1, notify: T, disturb: T, immune: T, out: 1, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 67, neu: 67, notify: T, disturb: F, immune: T, out: 67, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 225, neu: 225, notify: F, disturb: T, immune: T, out: 225, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 1007, neu: 1007, notify: F, disturb: F, immune: T, out: 1007, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max, notify: T, disturb: T, immune: F, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max, notify: T, disturb: F, immune: F, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max, notify: F, disturb: T, immune: F, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max, notify: F, disturb: F, immune: F, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max, notify: T, disturb: T, immune: T, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max, notify: T, disturb: F, immune: T, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max, notify: F, disturb: T, immune: T, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max, notify: F, disturb: F, immune: T, out: max, notified: F, changeMsg: null, recoverMsg: null },
      /* Going UP a grade always notifies: the new grade has an up_msg, and
         that forces notify even when the immunity is known (player-timed.c:842-845
         runs after the suppression at 828-832). */
      { inn: 0, neu: 1, notify: T, disturb: T, immune: F, out: 1, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: 14, notify: T, disturb: F, immune: F, out: 14, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: 163, notify: F, disturb: T, immune: F, out: 163, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: 1083, notify: F, disturb: F, immune: F, out: 1083, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: 1, notify: T, disturb: T, immune: T, out: 1, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: 28, notify: T, disturb: F, immune: T, out: 28, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: 233, notify: F, disturb: T, immune: T, out: 233, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: 1058, notify: F, disturb: F, immune: T, out: 1058, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max, notify: T, disturb: T, immune: F, out: max, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max, notify: F, disturb: T, immune: F, out: max, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max, notify: T, disturb: F, immune: F, out: max, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max, notify: F, disturb: F, immune: F, out: max, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max, notify: T, disturb: T, immune: T, out: max, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max, notify: F, disturb: T, immune: T, out: max, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max, notify: T, disturb: F, immune: T, out: max, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max, notify: F, disturb: F, immune: T, out: max, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max + 1, notify: T, disturb: T, immune: F, out: max, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max + 21, notify: T, disturb: T, immune: F, out: max, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max + 154, notify: T, disturb: T, immune: F, out: max, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max + 1183, notify: T, disturb: T, immune: F, out: max, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max + 1, notify: T, disturb: T, immune: T, out: max, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max + 55, notify: T, disturb: T, immune: T, out: max, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max + 222, notify: T, disturb: T, immune: T, out: max, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max + 1221, notify: T, disturb: T, immune: T, out: max, notified: T, changeMsg: up, recoverMsg: null },
      /* Going DOWN a grade has no down_msg, so it notifies only when requested
         AND the known immunity does not suppress it. This is the case the
         suppression exists for: immune=true silences it entirely. */
      { inn: 1, neu: 0, notify: T, disturb: T, immune: F, out: 0, notified: T, changeMsg: null, recoverMsg: onEnd },
      { inn: 82, neu: 0, notify: F, disturb: T, immune: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 110, neu: 0, notify: T, disturb: F, immune: F, out: 0, notified: T, changeMsg: null, recoverMsg: onEnd },
      { inn: 2452, neu: 0, notify: F, disturb: F, immune: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 1, neu: 0, notify: T, disturb: T, immune: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 91, neu: 0, notify: F, disturb: T, immune: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 168, neu: 0, notify: T, disturb: F, immune: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 1004, neu: 0, notify: F, disturb: F, immune: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: 0, notify: T, disturb: T, immune: F, out: 0, notified: T, changeMsg: null, recoverMsg: onEnd },
      { inn: max, neu: 0, notify: F, disturb: T, immune: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: 0, notify: T, disturb: F, immune: F, out: 0, notified: T, changeMsg: null, recoverMsg: onEnd },
      { inn: max, neu: 0, notify: F, disturb: F, immune: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: 0, notify: T, disturb: T, immune: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: 0, notify: F, disturb: T, immune: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: 0, notify: T, disturb: F, immune: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: 0, notify: F, disturb: F, immune: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 7, neu: -1, notify: T, disturb: T, immune: F, out: 0, notified: T, changeMsg: null, recoverMsg: onEnd },
      { inn: 29, neu: -116, notify: F, disturb: T, immune: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 118, neu: -64, notify: T, disturb: F, immune: F, out: 0, notified: T, changeMsg: null, recoverMsg: onEnd },
      { inn: 1319, neu: -1062, notify: F, disturb: F, immune: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 9, neu: -1, notify: T, disturb: T, immune: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 31, neu: -205, notify: F, disturb: T, immune: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 263, neu: -98, notify: T, disturb: F, immune: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 1203, neu: -1011, notify: F, disturb: F, immune: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      /* Increasing within one grade: notify only if requested and not
         suppressed; OPP_ACID has an on_increase message, so notifying emits it. */
      { inn: 1, neu: 4, notify: T, disturb: T, immune: F, out: 4, notified: T, changeMsg: onInc, recoverMsg: null },
      { inn: 17, neu: 22, notify: F, disturb: T, immune: F, out: 22, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 713, neu: 728, notify: T, disturb: F, immune: F, out: 728, notified: T, changeMsg: onInc, recoverMsg: null },
      { inn: 1001, neu: 1002, notify: F, disturb: F, immune: F, out: 1002, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 1, neu: 9, notify: T, disturb: T, immune: T, out: 9, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 11, neu: 16, notify: F, disturb: T, immune: T, out: 16, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 205, neu: 213, notify: T, disturb: F, immune: T, out: 213, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 1173, neu: 1180, notify: F, disturb: F, immune: T, out: 1180, notified: F, changeMsg: null, recoverMsg: null },
      /* Decreasing within one grade: same gating. OPP_ACID has NO on_decrease
         message, so `onDec` is "" and no message is expected -- exactly what
         upstream's NULL on_decrease means at player-timed.c:856-859. */
      { inn: 6, neu: 1, notify: T, disturb: T, immune: F, out: 1, notified: T, changeMsg: onDec, recoverMsg: null },
      { inn: 41, neu: 38, notify: F, disturb: T, immune: F, out: 38, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 124, neu: 121, notify: T, disturb: F, immune: F, out: 121, notified: T, changeMsg: onDec, recoverMsg: null },
      { inn: 1164, neu: 1160, notify: F, disturb: F, immune: F, out: 1160, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 6, neu: 1, notify: T, disturb: T, immune: T, out: 1, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 41, neu: 33, notify: F, disturb: T, immune: T, out: 33, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 111, neu: 103, notify: T, disturb: F, immune: T, out: 103, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 1711, neu: 1699, notify: F, disturb: F, immune: T, out: 1699, notified: F, changeMsg: null, recoverMsg: null },
      /* Increasing past the maximum while already there never notifies
         (player-timed.c:817-824; changed between 4.2.4 and 4.2.5). */
      { inn: max, neu: max + 1, notify: T, disturb: T, immune: F, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max + 51, notify: F, disturb: T, immune: F, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max + 209, notify: T, disturb: F, immune: F, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max + 1007, notify: F, disturb: F, immune: F, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max + 1, notify: T, disturb: T, immune: T, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max + 24, notify: F, disturb: T, immune: T, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max + 113, notify: T, disturb: F, immune: T, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max + 1033, notify: F, disturb: F, immune: T, out: max, notified: F, changeMsg: null, recoverMsg: null },
    ];

    const p = player();
    let variant = 0;
    for (const c of cases) {
      const hooks = tracker(opp.msgt);
      /* immune == true: obj_k->el_info[ACID].res_level != 0 AND
         p->state.el_info[ACID].res_level == 3, so both halves of the
         suppression predicate hold (timed.c:1392-1397). immune == false:
         upstream picks one of three ways for the predicate to fail
         (timed.c:1398-1420); all three are covered deterministically by
         cycling instead of randint0(3). */
      const knownResist = c.immune || variant === 2;
      const isImmune = c.immune || variant === 1;
      if (!c.immune) variant = (variant + 1) % 3;
      p.timed[TMD.OPP_ACID] = c.inn;
      const result = playerSetTimed(p, opp, c.neu, c.notify, c.disturb, {
        ...hooks,
        notifyQueries: {
          knownResist: (elem: number): boolean =>
            knownResist && elem === opp.tempResist,
          isImmune: (elem: number): boolean => isImmune && elem === opp.tempResist,
          /* OPP_ACID has no flag synonym, so the oflag half of the predicate is
             short-circuited by oflagDup === 0 (player-timed.c:834-838). */
          knownFlag: (): boolean => false,
          hasFlagNotTimed: (): boolean => false,
        },
      });
      expect(result).toBe(c.notified);
      expect(p.timed[TMD.OPP_ACID]).toBe(c.out);
      expectTail(hooks.st, c.changeMsg, c.recoverMsg, c.notified, c.disturb);
    }
  });

  // upstream: test_set_timed5 — oflag synonym notify suppression (SINVIS)
  it("set_timed5", () => {
    const sinvis = effect("SINVIS");
    const max = firstGrade(sinvis).max;
    const up = firstGrade(sinvis).upMsg!;
    const onEnd = sinvis.onEnd;
    const onInc = sinvis.onIncrease;
    const onDec = sinvis.onDecrease;

    /* require(oflag_syn && oflag_dup != OF_NONE) (timed.c:1620-1621): without
     * the synonym there is nothing to suppress and the whole table is vacuous. */
    expect(sinvis.oflagSyn).toBe(true);
    expect(sinvis.oflagDup).not.toBe(0);

    type Case = {
      inn: number;
      neu: number;
      notify: boolean;
      disturb: boolean;
      /** has_known_flag: obj_k knows the synonym AND worn gear supplies it. */
      known: boolean;
      out: number;
      notified: boolean;
      changeMsg: string | null;
      recoverMsg: string | null;
    };
    const cases: Case[] = [
      /* No change from zero never notifies, whatever notify/disturb/known. */
      { inn: 0, neu: 0, notify: T, disturb: T, known: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, neu: 0, notify: T, disturb: F, known: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, neu: 0, notify: F, disturb: T, known: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, neu: 0, notify: F, disturb: F, known: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, neu: 0, notify: T, disturb: T, known: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, neu: 0, notify: T, disturb: F, known: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, neu: 0, notify: F, disturb: T, known: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, neu: 0, notify: F, disturb: F, known: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      /* Zero to a negative value is coerced to no change. */
      { inn: 0, neu: -1, notify: T, disturb: T, known: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, neu: -44, notify: F, disturb: T, known: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, neu: -136, notify: T, disturb: F, known: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, neu: -1122, notify: F, disturb: F, known: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, neu: -1, notify: T, disturb: T, known: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, neu: -86, notify: F, disturb: T, known: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, neu: -101, notify: T, disturb: F, known: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, neu: -1039, notify: F, disturb: F, known: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      /* No change from a nonzero value never notifies either. */
      { inn: 1, neu: 1, notify: T, disturb: T, known: F, out: 1, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 21, neu: 21, notify: T, disturb: F, known: F, out: 21, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 173, neu: 173, notify: F, disturb: T, known: F, out: 173, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 1011, neu: 1011, notify: F, disturb: F, known: F, out: 1011, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 1, neu: 1, notify: T, disturb: T, known: T, out: 1, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 46, neu: 46, notify: T, disturb: F, known: T, out: 46, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 304, neu: 304, notify: F, disturb: T, known: T, out: 304, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 2014, neu: 2014, notify: F, disturb: F, known: T, out: 2014, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max, notify: T, disturb: T, known: F, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max, notify: T, disturb: F, known: F, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max, notify: F, disturb: T, known: F, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max, notify: F, disturb: F, known: F, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max, notify: T, disturb: T, known: T, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max, notify: T, disturb: F, known: T, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max, notify: F, disturb: T, known: T, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max, notify: F, disturb: F, known: T, out: max, notified: F, changeMsg: null, recoverMsg: null },
      /* Going UP a grade always notifies: the new grade has an up message, and
       * that forces notify even when the synonym is known. */
      { inn: 0, neu: 1, notify: T, disturb: T, known: F, out: 1, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: 11, notify: T, disturb: F, known: F, out: 11, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: 109, notify: F, disturb: T, known: F, out: 109, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: 1148, notify: F, disturb: F, known: F, out: 1148, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: 1, notify: T, disturb: T, known: T, out: 1, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: 27, notify: T, disturb: F, known: T, out: 27, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: 302, notify: F, disturb: T, known: T, out: 302, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: 1101, notify: F, disturb: F, known: T, out: 1101, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max, notify: T, disturb: T, known: F, out: max, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max, notify: F, disturb: T, known: F, out: max, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max, notify: T, disturb: F, known: F, out: max, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max, notify: F, disturb: F, known: F, out: max, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max, notify: T, disturb: T, known: T, out: max, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max, notify: F, disturb: T, known: T, out: max, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max, notify: T, disturb: F, known: T, out: max, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max, notify: F, disturb: F, known: T, out: max, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max + 1, notify: T, disturb: T, known: F, out: max, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max + 40, notify: T, disturb: T, known: F, out: max, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max + 142, notify: T, disturb: T, known: F, out: max, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max + 1006, notify: T, disturb: T, known: F, out: max, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max + 1, notify: T, disturb: T, known: T, out: max, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max + 67, notify: T, disturb: T, known: T, out: max, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max + 217, notify: T, disturb: T, known: T, out: max, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max + 1367, notify: T, disturb: T, known: T, out: max, notified: T, changeMsg: up, recoverMsg: null },
      /* Going DOWN a grade has no down message, so it notifies only when
       * requested AND the synonym is not known-from-gear. THIS is the case the
       * suppression exists for: known=true silences it entirely. */
      { inn: 1, neu: 0, notify: T, disturb: T, known: F, out: 0, notified: T, changeMsg: null, recoverMsg: onEnd },
      { inn: 43, neu: 0, notify: F, disturb: T, known: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 102, neu: 0, notify: T, disturb: F, known: F, out: 0, notified: T, changeMsg: null, recoverMsg: onEnd },
      { inn: 1199, neu: 0, notify: F, disturb: F, known: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 1, neu: 0, notify: T, disturb: T, known: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 83, neu: 0, notify: F, disturb: T, known: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 151, neu: 0, notify: T, disturb: F, known: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 1012, neu: 0, notify: F, disturb: F, known: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: 0, notify: T, disturb: T, known: F, out: 0, notified: T, changeMsg: null, recoverMsg: onEnd },
      { inn: max, neu: 0, notify: F, disturb: T, known: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: 0, notify: T, disturb: F, known: F, out: 0, notified: T, changeMsg: null, recoverMsg: onEnd },
      { inn: max, neu: 0, notify: F, disturb: F, known: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: 0, notify: T, disturb: T, known: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: 0, notify: F, disturb: T, known: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: 0, notify: T, disturb: F, known: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: 0, notify: F, disturb: F, known: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 8, neu: -1, notify: T, disturb: T, known: F, out: 0, notified: T, changeMsg: null, recoverMsg: onEnd },
      { inn: 19, neu: -139, notify: F, disturb: T, known: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 127, neu: -32, notify: T, disturb: F, known: F, out: 0, notified: T, changeMsg: null, recoverMsg: onEnd },
      { inn: 1180, neu: -1193, notify: F, disturb: F, known: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 7, neu: -1, notify: T, disturb: T, known: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 26, neu: -201, notify: F, disturb: T, known: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 357, neu: -78, notify: T, disturb: F, known: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 1357, neu: -1289, notify: F, disturb: F, known: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      /* Increasing within one grade: notify only if requested and not
       * suppressed; an on_increase message accompanies it. */
      { inn: 1, neu: 6, notify: T, disturb: T, known: F, out: 6, notified: T, changeMsg: onInc, recoverMsg: null },
      { inn: 13, neu: 24, notify: F, disturb: T, known: F, out: 24, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 728, neu: 729, notify: T, disturb: F, known: F, out: 729, notified: T, changeMsg: onInc, recoverMsg: null },
      { inn: 1048, neu: 1050, notify: F, disturb: F, known: F, out: 1050, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 1, neu: 8, notify: T, disturb: T, known: T, out: 8, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 19, neu: 21, notify: F, disturb: T, known: T, out: 21, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 202, neu: 204, notify: T, disturb: F, known: T, out: 204, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 1308, neu: 1310, notify: F, disturb: F, known: T, out: 1310, notified: F, changeMsg: null, recoverMsg: null },
      /* Decreasing within one grade: same gating. SINVIS has no on_decrease
       * message, so changeMsg resolves to "" and no message is expected --
       * exactly what upstream's NULL on_decrease means here. */
      { inn: 9, neu: 1, notify: T, disturb: T, known: F, out: 1, notified: T, changeMsg: onDec, recoverMsg: null },
      { inn: 53, neu: 49, notify: F, disturb: T, known: F, out: 49, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 317, neu: 314, notify: T, disturb: F, known: F, out: 314, notified: T, changeMsg: onDec, recoverMsg: null },
      { inn: 2107, neu: 2099, notify: F, disturb: F, known: F, out: 2099, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 8, neu: 1, notify: T, disturb: T, known: T, out: 1, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 39, neu: 35, notify: F, disturb: T, known: T, out: 35, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 137, neu: 131, notify: T, disturb: F, known: T, out: 131, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 1059, neu: 1058, notify: F, disturb: F, known: T, out: 1058, notified: F, changeMsg: null, recoverMsg: null },
      /* Trying to increase past the maximum while already there never notifies
       * (changed between 4.2.4 and 4.2.5). */
      { inn: max, neu: max + 1, notify: T, disturb: T, known: F, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max + 36, notify: F, disturb: T, known: F, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max + 183, notify: T, disturb: F, known: F, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max + 1109, notify: F, disturb: F, known: F, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max + 1, notify: T, disturb: T, known: T, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max + 22, notify: F, disturb: T, known: T, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max + 216, notify: T, disturb: F, known: T, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max + 1217, notify: F, disturb: F, known: T, out: max, notified: F, changeMsg: null, recoverMsg: null },
    ];

    const p = player();
    let variant = 0;
    for (const c of cases) {
      const hooks = tracker(sinvis.msgt);
      /* has_known_flag == true: obj_k knows the synonym AND non-timed gear
       * supplies it, so both halves of the suppression predicate hold
       * (player-timed.c:838-843). has_known_flag == false: upstream picks one
       * of three ways for the predicate to fail (timed.c:1627-1652); all three
       * are covered deterministically by cycling instead of randint0(3). */
      const knownFlag = c.known || variant === 2;
      const hasFlagNotTimed = c.known || variant === 1;
      if (!c.known) variant = (variant + 1) % 3;
      const queries = {
        knownResist: (): boolean => false,
        isImmune: (): boolean => false,
        knownFlag: (f: number): boolean => knownFlag && f === sinvis.oflagDup,
        hasFlagNotTimed: (f: number): boolean =>
          hasFlagNotTimed && f === sinvis.oflagDup,
      };
      p.timed[TMD.SINVIS] = c.inn;
      const result = playerSetTimed(p, sinvis, c.neu, c.notify, c.disturb, {
        ...hooks,
        notifyQueries: queries,
      });
      expect(result).toBe(c.notified);
      expect(p.timed[TMD.SINVIS]).toBe(c.out);
      if (c.changeMsg) {
        expect(hooks.st.nTracked).toBe(1);
        expect(hooks.st.lastTracked).toBe(c.changeMsg);
      } else {
        expect(hooks.st.nTracked).toBe(0);
      }
      if (c.recoverMsg) {
        expect(hooks.st.nRecover).toBe(1);
        expect(hooks.st.lastRecover).toBe(c.recoverMsg);
      } else {
        expect(hooks.st.nRecover).toBe(0);
      }
      expect(hooks.st.nUntracked).toBe(0);
      expect(hooks.st.inputFlushed).toBe(c.notified && c.disturb);
    }
  });

  /*
   * upstream: test_set_timed6 (timed.c:1687-1847) — player_set_timed's special
   * cases: the lapsing of SPRINT triggers SLOW, the onset of SCRAMBLE scrambles
   * the statistics, and the lapsing of SCRAMBLE unscrambles them.
   *
   * Upstream drives all three through effect->on_begin_effect /
   * on_end_effect, which player_set_timed dispatches via effect_do
   * (player-timed.c:873-891). The port routes that same dispatch through the
   * documented `onTransition` hook (player/timed.ts:159-168) so this module
   * stays free of the effect interpreter, so at THIS layer the assertions are:
   *   - the result / message / disturb behaviour of each transition, and
   *   - that onTransition fires exactly on a 0 <-> positive transition and not
   *     on a within-grade change, with the right (idx, begin, canDisturb).
   * The downstream consequences upstream asserts on (player->timed[TMD_SLOW] > 0
   * and the player->stat_map permutation) live behind that hook and are covered
   * against the REAL wired game in game/timed-transition.test.ts. Recorded as a
   * partial port in the findings doc.
   */
  it("set_timed6", () => {
    const sprint = effect("SPRINT");
    const scramble = effect("SCRAMBLE");
    const p = player();

    /*
     * Data guards: the chains upstream relies on must actually be bound, else
     * every onTransition assertion below would be about a hook that has nothing
     * to dispatch. SPRINT's on-end chain is the TIMED_INC_NO_RES:SLOW that
     * produces upstream's `require(player->timed[TMD_SLOW] > 0)`.
     */
    expect(sprint.onEndEffect).toEqual([
      { effect: EF.TIMED_INC_NO_RES, subtype: TMD.SLOW, dice: "100" },
    ]);
    expect(sprint.onBeginEffect).toBeUndefined();
    expect(scramble.onBeginEffect).toEqual([
      { effect: EF.SCRAMBLE_STATS, subtype: 0 },
    ]);
    expect(scramble.onEndEffect).toEqual([
      { effect: EF.UNSCRAMBLE_STATS, subtype: 0 },
    ]);

    /* ---- SPRINT: no change and within-grade change leave SLOW alone ---- */

    /* 0 -> 0 (timed.c:1699-1711). */
    p.timed[TMD.SPRINT] = 0;
    p.timed[TMD.SLOW] = 0;
    let h = tracker(sprint.msgt);
    expect(playerSetTimed(p, sprint, 0, true, true, h)).toBe(false);
    expect(p.timed[TMD.SPRINT]).toBe(0);
    expect(p.timed[TMD.SLOW]).toBe(0);
    expectTail(h.st, null, null, false, true);
    expect(h.st.transitions).toEqual([]);

    /* 10 -> 10 (timed.c:1712-1721). */
    p.timed[TMD.SPRINT] = 10;
    h = tracker(sprint.msgt);
    expect(playerSetTimed(p, sprint, 10, true, true, h)).toBe(false);
    expect(p.timed[TMD.SPRINT]).toBe(10);
    expect(p.timed[TMD.SLOW]).toBe(0);
    expectTail(h.st, null, null, false, true);
    expect(h.st.transitions).toEqual([]);

    /* 50 -> 68: a within-grade increase. SPRINT has no on_increase message, so
       it notifies (as asked) without any message (timed.c:1722-1732), and no
       0 <-> positive transition happens. */
    expect(sprint.onIncrease).toBe("");
    p.timed[TMD.SPRINT] = 50;
    h = tracker(sprint.msgt);
    expect(playerSetTimed(p, sprint, 68, true, true, h)).toBe(true);
    expect(p.timed[TMD.SPRINT]).toBe(68);
    expect(p.timed[TMD.SLOW]).toBe(0);
    expectTail(h.st, null, null, true, true);
    expect(h.st.transitions).toEqual([]);

    /* 0 -> 35: the onset. Grade up_msg, and a begin transition (timed.c:1733-1745). */
    p.timed[TMD.SPRINT] = 0;
    h = tracker(sprint.msgt);
    expect(playerSetTimed(p, sprint, 35, true, true, h)).toBe(true);
    expect(p.timed[TMD.SPRINT]).toBe(35);
    expect(p.timed[TMD.SLOW]).toBe(0);
    expectTail(h.st, firstGrade(sprint).upMsg, null, true, true);
    expect(h.st.transitions).toEqual([
      { idx: TMD.SPRINT, begin: true, canDisturb: true },
    ]);

    /* ---- SPRINT lapse: the on_end chain fires (timed.c:1746-1761) ---- */
    p.timed[TMD.SPRINT] = 75;
    p.timed[TMD.SLOW] = 0;
    h = tracker(sprint.msgt);
    expect(playerSetTimed(p, sprint, 0, true, true, h)).toBe(true);
    expect(p.timed[TMD.SPRINT]).toBe(0);
    /* on_end -> MSG_RECOVER (player-timed.c:853-855). */
    expectTail(h.st, null, sprint.onEnd, true, true);
    /* The end transition is dispatched, carrying can_disturb as upstream's
       source_none() / source_player() choice does (player-timed.c:878-889). */
    expect(h.st.transitions).toEqual([
      { idx: TMD.SPRINT, begin: false, canDisturb: true },
    ]);
    /* timed.ts alone does NOT apply SLOW -- that is the chain's job, and with no
       chain runner supplied it must stay untouched. Upstream's
       `require(player->timed[TMD_SLOW] > 0)` and the SLOW up_msg are asserted
       against the wired game in game/timed-transition.test.ts. */
    expect(p.timed[TMD.SLOW]).toBe(0);

    /* ---- SCRAMBLE: no change / within-grade change dispatch nothing ---- */

    /* 0 -> 0 (timed.c:1767-1783). */
    p.timed[TMD.SCRAMBLE] = 0;
    h = tracker(scramble.msgt);
    expect(playerSetTimed(p, scramble, 0, true, true, h)).toBe(false);
    expect(p.timed[TMD.SCRAMBLE]).toBe(0);
    expectTail(h.st, null, null, false, true);
    expect(h.st.transitions).toEqual([]);

    /* 18 -> 18 (timed.c:1784-1795). */
    p.timed[TMD.SCRAMBLE] = 18;
    h = tracker(scramble.msgt);
    expect(playerSetTimed(p, scramble, 18, true, true, h)).toBe(false);
    expect(p.timed[TMD.SCRAMBLE]).toBe(18);
    expectTail(h.st, null, null, false, true);
    expect(h.st.transitions).toEqual([]);

    /* 80 -> 85: within-grade increase emits SCRAMBLE's on_increase and does NOT
       re-scramble, i.e. no begin transition (timed.c:1796-1811). */
    expect(scramble.onIncrease).not.toBe("");
    p.timed[TMD.SCRAMBLE] = 80;
    h = tracker(scramble.msgt);
    expect(playerSetTimed(p, scramble, 85, true, true, h)).toBe(true);
    expect(p.timed[TMD.SCRAMBLE]).toBe(85);
    expectTail(h.st, scramble.onIncrease, null, true, true);
    expect(h.st.transitions).toEqual([]);

    /* 0 -> 9: the onset. Grade up_msg plus the begin transition that carries
       SCRAMBLE_STATS (timed.c:1813-1836). */
    p.timed[TMD.SCRAMBLE] = 0;
    h = tracker(scramble.msgt);
    expect(playerSetTimed(p, scramble, 9, true, true, h)).toBe(true);
    expect(p.timed[TMD.SCRAMBLE]).toBe(9);
    expectTail(h.st, firstGrade(scramble).upMsg, null, true, true);
    expect(h.st.transitions).toEqual([
      { idx: TMD.SCRAMBLE, begin: true, canDisturb: true },
    ]);

    /* 8 -> 0: the lapse. on_end as MSG_RECOVER, no tracked message, and the end
       transition that carries UNSCRAMBLE_STATS (timed.c:1838-1851). */
    p.timed[TMD.SCRAMBLE] = 8;
    h = tracker(scramble.msgt);
    expect(playerSetTimed(p, scramble, 0, true, true, h)).toBe(true);
    expect(p.timed[TMD.SCRAMBLE]).toBe(0);
    expectTail(h.st, null, scramble.onEnd, true, true);
    expect(h.st.transitions).toEqual([
      { idx: TMD.SCRAMBLE, begin: false, canDisturb: true },
    ]);

    /* can_disturb == false must reach the chain too (player-timed.c:878-889 uses
       it to pick source_none() vs source_player()). */
    p.timed[TMD.SCRAMBLE] = 0;
    h = tracker(scramble.msgt);
    expect(playerSetTimed(p, scramble, 9, true, false, h)).toBe(true);
    expect(h.st.transitions).toEqual([
      { idx: TMD.SCRAMBLE, begin: true, canDisturb: false },
    ]);
  });

  /*
   * upstream: test_inc_check0 (timed.c:1848-2092) — player_inc_check across all
   * five TMD_FAIL_ codes (player-timed.c:923-1029): no protection, an object
   * flag, an elemental resist, an elemental vulnerability, a player flag, and
   * another timed effect.
   *
   * PARTIAL PORT. Upstream interleaves each non-lore check with the matching
   * `lore` check, which reads p->known_state instead of p->state and must not
   * cause learning. The port has no known_state twin (deferred; see
   * player/player.ts:43) and playerIncCheck takes a single query set, so the
   * lore/non-lore split is not representable here. Every lore assertion is
   * recorded as deferred in the findings doc; the non-lore half below is ported
   * in full. The TMD_FAIL_FLAG_TIMED_EFFECT block is the exception: upstream
   * notes there is no lore/non-lore difference for it (player-timed.c:1005-1010),
   * so that block IS complete.
   */
  it("inc_check0", () => {
    const food = effect("FOOD");
    const sinvis = effect("SINVIS");
    const slow = effect("SLOW");
    const pois = effect("POISONED");
    const opp = effect("OPP_ACID");
    const cut = effect("CUT");

    /** Recorder for the non-lore learning side effects (player-timed.c:936-953). */
    function learner(): PlayerIncCheckHooks & {
      flags: string[];
      elems: string[];
      smart: string[];
      resisted: () => number;
    } {
      const flags: string[] = [];
      const elems: string[] = [];
      const smart: string[] = [];
      let nResisted = 0;
      return {
        flags,
        elems,
        smart,
        resisted: (): number => nResisted,
        equipLearnFlag: (n: string): void => {
          flags.push(n);
        },
        equipLearnElement: (n: string): void => {
          elems.push(n);
        },
        updateSmartLearn: (n: string): void => {
          smart.push(n);
        },
        resistMessage: (): void => {
          nResisted++;
        },
      };
    }

    /* ---- Effects with no protection at all (timed.c:1857-1868) ---- */
    /* null(timed_effects[TMD_FOOD].fail) / null(timed_effects[TMD_SINVIS].fail) */
    expect(food.fail).toEqual([]);
    expect(playerIncCheck(food, queriesNone())).toBe(true);
    expect(sinvis.fail).toEqual([]);
    expect(playerIncCheck(sinvis, queriesNone())).toBe(true);
    /* With an empty fail list nothing can inhibit the effect, so the lore form
       is the same call and the same answer. */
    expect(playerIncCheck(food, queriesNone(), learner())).toBe(true);
    expect(playerIncCheck(sinvis, queriesNone(), learner())).toBe(true);

    /* ---- TMD_FAIL_FLAG_OBJECT: SLOW / FREE_ACT (timed.c:1870-1912) ---- */
    /* Upstream searches the fail chain for the OBJECT entry and notnull()s it;
       without this the flag assertions below would be vacuous. */
    const objFail = slow.fail.find((f) => f.code === TMD_FAIL_FLAG_OBJECT);
    expect(objFail).toBeDefined();
    expect(objFail!.flag).toBe("FREE_ACT");

    /* Flag absent -> the increase is allowed, and the flag is still learned from
       worn gear (equip_learn_flag runs before the test, player-timed.c:945). */
    let lrn = learner();
    expect(playerIncCheck(slow, queriesNone(), lrn)).toBe(true);
    expect(lrn.flags).toEqual(["FREE_ACT"]);
    expect(lrn.smart).toEqual([]);
    expect(lrn.resisted()).toBe(0);

    /* Flag present -> inhibited, and still learned. */
    lrn = learner();
    expect(
      playerIncCheck(slow, queriesNone({ objectFlag: (n) => n === "FREE_ACT" }), lrn),
    ).toBe(false);
    expect(lrn.flags).toEqual(["FREE_ACT"]);

    /* From a monster action the flag is taught to the monster and the resist
       message is shown (player-timed.c:945-953). */
    lrn = learner();
    expect(
      playerIncCheck(slow, queriesNone({ objectFlag: () => true }), {
        ...lrn,
        monsterSource: true,
      }),
    ).toBe(false);
    expect(lrn.smart).toEqual(["FREE_ACT"]);
    expect(lrn.resisted()).toBe(1);

    /* No monster source -> no smart-learn, no message, even when inhibited. */
    lrn = learner();
    expect(
      playerIncCheck(slow, queriesNone({ objectFlag: () => true }), {
        ...lrn,
        monsterSource: false,
      }),
    ).toBe(false);
    expect(lrn.smart).toEqual([]);
    expect(lrn.resisted()).toBe(0);

    /* ---- TMD_FAIL_FLAG_RESIST: POISONED / POIS (timed.c:1914-1962) ---- */
    const resFail = pois.fail.find((f) => f.code === TMD_FAIL_FLAG_RESIST);
    expect(resFail).toBeDefined();
    expect(resFail!.flag).toBe("POIS");

    /* res_level 0 -> allowed; the element is learned from worn gear regardless
       (equip_learn_element, player-timed.c:967). */
    lrn = learner();
    expect(playerIncCheck(pois, queriesNone(), lrn)).toBe(true);
    expect(lrn.elems).toEqual(["POIS"]);

    /* Any positive res_level inhibits (upstream tests 1 and 3). */
    for (const level of [1, 3]) {
      lrn = learner();
      expect(
        playerIncCheck(
          pois,
          queriesNone({ resistLevel: (n) => (n === "POIS" ? level : 0) }),
          lrn,
        ),
      ).toBe(false);
      expect(lrn.elems).toEqual(["POIS"]);
    }

    /* ---- TMD_FAIL_FLAG_VULN: OPP_ACID / ACID (timed.c:1964-2000) ---- */
    const vulnFail = opp.fail.find((f) => f.code === TMD_FAIL_FLAG_VULN);
    expect(vulnFail).toBeDefined();
    expect(vulnFail!.flag).toBe("ACID");

    lrn = learner();
    expect(playerIncCheck(opp, queriesNone(), lrn)).toBe(true);
    expect(lrn.elems).toEqual(["ACID"]);

    /* A negative res_level (vulnerability) inhibits. */
    lrn = learner();
    expect(
      playerIncCheck(
        opp,
        queriesNone({ resistLevel: (n) => (n === "ACID" ? -1 : 0) }),
        lrn,
      ),
    ).toBe(false);
    expect(lrn.elems).toEqual(["ACID"]);

    /* Beyond upstream, guarding the resist/vuln asymmetry player-timed.c:974-977
       comments on: a POSITIVE res_level must NOT inhibit a VULN fail. */
    expect(
      playerIncCheck(opp, queriesNone({ resistLevel: (n) => (n === "ACID" ? 3 : 0) })),
    ).toBe(true);

    /* ---- TMD_FAIL_FLAG_PLAYER: CUT / ROCK (timed.c:2002-2029) ---- */
    const pfFail = cut.fail.find((f) => f.code === TMD_FAIL_FLAG_PLAYER);
    expect(pfFail).toBeDefined();
    expect(pfFail!.flag).toBe("ROCK");

    expect(playerIncCheck(cut, queriesNone())).toBe(true);
    expect(
      playerIncCheck(cut, queriesNone({ playerFlag: (n) => n === "ROCK" })),
    ).toBe(false);
    /* The PLAYER branch has no learning side effects (player-timed.c:996-1003). */
    lrn = learner();
    expect(
      playerIncCheck(cut, queriesNone({ playerFlag: () => true }), lrn),
    ).toBe(false);
    expect(lrn.flags).toEqual([]);
    expect(lrn.elems).toEqual([]);

    /* ---- TMD_FAIL_FLAG_TIMED_EFFECT: POISONED / OPP_POIS (timed.c:2031-2089) --
     * Complete, not partial: upstream states there is no lore/non-lore
     * difference here because an active timed effect is always known to the
     * player (player-timed.c:1005-1010). */
    const tmdFail = pois.fail.find((f) => f.code === TMD_FAIL_FLAG_TIMED_EFFECT);
    expect(tmdFail).toBeDefined();
    expect(tmdFail!.flag).toBe("OPP_POIS");

    /* res_level must stay 0 so the earlier RESIST entry does not short-circuit
       the chain before the TIMED_EFFECT entry is reached (upstream clears
       el_info[ELEM_POIS] for exactly this reason, timed.c:2043-2044). */
    expect(playerIncCheck(pois, queriesNone())).toBe(true);
    expect(playerIncCheck(pois, queriesNone(), learner())).toBe(true);
    const oppPoisActive = queriesNone({ timedActive: (n) => n === "OPP_POIS" });
    expect(playerIncCheck(pois, oppPoisActive)).toBe(false);
    expect(playerIncCheck(pois, oppPoisActive, learner())).toBe(false);
  });

  /*
   * upstream: test_inc_timed0 (timed.c:2093-2256) — player_inc_timed on the
   * on/off effect SLOW, which is protected by the object flag FREE_ACT via a
   * TMD_FAIL_FLAG_OBJECT fail entry. Messages: grade up_msg and an overall
   * on_end, but no on_increase / on_decrease. SLOW stacks, so an increase inside
   * the grade adds to the duration (contrast inc_timed1).
   */
  it("inc_timed0", () => {
    const slow = effect("SLOW");
    const max = firstGrade(slow).max;
    const up = firstGrade(slow).upMsg!;

    /* Preconditions: SLOW stacks, and FREE_ACT really is its object-flag fail,
       else the `prot` and within-grade columns would be inert. */
    expect(slow.nonStacking).toBe(false);
    expect(slow.fail).toEqual([{ code: TMD_FAIL_FLAG_OBJECT, flag: "FREE_ACT" }]);
    expect(slow.onIncrease).toBe("");
    expect(slow.onDecrease).toBe("");

    type Case = {
      inn: number;
      inc: number;
      notify: boolean;
      disturb: boolean;
      /** player_inc_timed's `check`: may the increase be resisted at all. */
      check: boolean;
      /** OF_FREE_ACT present in p->state.flags, so player_inc_check inhibits. */
      prot: boolean;
      out: number;
      notified: boolean;
      changeMsg: string | null;
      recoverMsg: string | null;
    };
    const cases: Case[] = [
      /* No change from zero: never notifies, whatever notify/disturb/check. */
      { inn: 0, inc: 0, notify: T, disturb: T, check: F, prot: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, inc: 0, notify: T, disturb: F, check: F, prot: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, inc: 0, notify: F, disturb: T, check: F, prot: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, inc: 0, notify: F, disturb: F, check: F, prot: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, inc: 0, notify: T, disturb: T, check: T, prot: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, inc: 0, notify: T, disturb: T, check: F, prot: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, inc: 0, notify: T, disturb: T, check: T, prot: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, inc: 0, notify: T, disturb: F, check: T, prot: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, inc: 0, notify: T, disturb: F, check: F, prot: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, inc: 0, notify: T, disturb: F, check: T, prot: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, inc: 0, notify: F, disturb: T, check: T, prot: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, inc: 0, notify: F, disturb: T, check: F, prot: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, inc: 0, notify: F, disturb: T, check: T, prot: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, inc: 0, notify: F, disturb: F, check: T, prot: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, inc: 0, notify: F, disturb: F, check: F, prot: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, inc: 0, notify: F, disturb: F, check: T, prot: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      /* No change from the current nonzero value never notifies. */
      { inn: 1, inc: 0, notify: T, disturb: T, check: F, prot: F, out: 1, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 3, inc: 0, notify: T, disturb: F, check: F, prot: F, out: 3, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 12, inc: 0, notify: F, disturb: T, check: F, prot: F, out: 12, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 107, inc: 0, notify: F, disturb: F, check: F, prot: F, out: 107, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 1, inc: 0, notify: T, disturb: T, check: T, prot: F, out: 1, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 8, inc: 0, notify: T, disturb: T, check: F, prot: T, out: 8, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 234, inc: 0, notify: T, disturb: T, check: T, prot: T, out: 234, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, inc: 0, notify: T, disturb: F, check: T, prot: F, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 1, inc: 0, notify: T, disturb: F, check: F, prot: T, out: 1, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 6, inc: 0, notify: T, disturb: F, check: T, prot: T, out: 6, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 1317, inc: 0, notify: F, disturb: T, check: T, prot: F, out: 1317, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, inc: 0, notify: F, disturb: T, check: F, prot: T, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 1, inc: 0, notify: F, disturb: T, check: T, prot: T, out: 1, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 25, inc: 0, notify: F, disturb: F, check: T, prot: F, out: 25, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 176, inc: 0, notify: F, disturb: F, check: F, prot: T, out: 176, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 1864, inc: 0, notify: F, disturb: F, check: T, prot: T, out: 1864, notified: F, changeMsg: null, recoverMsg: null },
      /* Going up a grade notifies (the new grade has an up_msg) UNLESS the
         increase is checked and FREE_ACT inhibits it, in which case nothing
         happens at all (player-timed.c:1056). */
      { inn: 0, inc: 1, notify: T, disturb: T, check: F, prot: F, out: 1, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, inc: 5, notify: T, disturb: F, check: F, prot: F, out: 5, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, inc: 13, notify: F, disturb: T, check: F, prot: F, out: 13, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, inc: 147, notify: F, disturb: F, check: F, prot: F, out: 147, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, inc: max, notify: T, disturb: T, check: T, prot: F, out: max, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, inc: 1, notify: T, disturb: T, check: F, prot: T, out: 1, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, inc: 93, notify: T, disturb: T, check: T, prot: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, inc: 1, notify: T, disturb: F, check: T, prot: F, out: 1, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, inc: 134, notify: T, disturb: F, check: F, prot: T, out: 134, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, inc: 1419, notify: T, disturb: F, check: T, prot: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, inc: 10, notify: F, disturb: T, check: F, prot: T, out: 10, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, inc: 57, notify: F, disturb: T, check: T, prot: F, out: 57, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, inc: 1, notify: F, disturb: T, check: T, prot: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, inc: max, notify: F, disturb: F, check: F, prot: T, out: max, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, inc: 8, notify: F, disturb: F, check: T, prot: F, out: 8, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, inc: 1, notify: F, disturb: F, check: T, prot: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      /* Increasing within one grade notifies only on request, and never
         messages; checking while protected blocks it outright. */
      { inn: 1, inc: 35, notify: T, disturb: T, check: F, prot: F, out: 36, notified: T, changeMsg: null, recoverMsg: null },
      { inn: 10, inc: 1, notify: T, disturb: F, check: F, prot: F, out: 11, notified: T, changeMsg: null, recoverMsg: null },
      { inn: 123, inc: 8, notify: F, disturb: T, check: F, prot: F, out: 131, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 1095, inc: 10, notify: F, disturb: F, check: F, prot: F, out: 1105, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 8, inc: 9, notify: T, disturb: T, check: T, prot: F, out: 17, notified: T, changeMsg: null, recoverMsg: null },
      { inn: 17, inc: 1, notify: T, disturb: T, check: F, prot: T, out: 18, notified: T, changeMsg: null, recoverMsg: null },
      { inn: 37, inc: 6, notify: T, disturb: T, check: T, prot: T, out: 37, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 133, inc: 21, notify: T, disturb: F, check: T, prot: F, out: 154, notified: T, changeMsg: null, recoverMsg: null },
      { inn: 1067, inc: 5, notify: T, disturb: F, check: F, prot: T, out: 1072, notified: T, changeMsg: null, recoverMsg: null },
      { inn: 2345, inc: 2, notify: T, disturb: F, check: T, prot: T, out: 2345, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 1, inc: 18, notify: F, disturb: T, check: T, prot: F, out: 19, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 184, inc: 3, notify: F, disturb: T, check: F, prot: T, out: 187, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 1137, inc: 10, notify: F, disturb: T, check: T, prot: T, out: 1137, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 5, inc: 1, notify: F, disturb: F, check: T, prot: F, out: 6, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 74, inc: 3, notify: F, disturb: F, check: F, prot: T, out: 77, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 153, inc: 9, notify: F, disturb: F, check: T, prot: T, out: 153, notified: F, changeMsg: null, recoverMsg: null },
      /* Increasing past the maximum while already there never notifies
         (player-timed.c:817-824; changed between 4.2.4 and 4.2.5). */
      { inn: max, inc: 1, notify: T, disturb: T, check: F, prot: F, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, inc: 11, notify: T, disturb: F, check: F, prot: F, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, inc: 129, notify: F, disturb: T, check: F, prot: F, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, inc: 1070, notify: F, disturb: F, check: F, prot: F, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, inc: 1, notify: T, disturb: T, check: T, prot: F, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, inc: 18, notify: T, disturb: T, check: F, prot: T, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, inc: 264, notify: T, disturb: T, check: T, prot: T, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, inc: 1, notify: T, disturb: F, check: T, prot: F, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, inc: 33, notify: T, disturb: F, check: F, prot: T, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, inc: 198, notify: T, disturb: F, check: T, prot: T, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, inc: 1, notify: F, disturb: T, check: T, prot: F, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, inc: 53, notify: F, disturb: T, check: F, prot: T, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, inc: 206, notify: F, disturb: T, check: T, prot: T, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, inc: 1, notify: F, disturb: F, check: T, prot: F, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, inc: 12, notify: F, disturb: F, check: F, prot: T, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, inc: 1032, notify: F, disturb: F, check: T, prot: T, out: max, notified: F, changeMsg: null, recoverMsg: null },
    ];

    const p = player();
    for (const c of cases) {
      const hooks = tracker(slow.msgt);
      /* The C pokes OF_FREE_ACT into p->state.flags (timed.c:2229-2235); here the
         same state reaches player_inc_check through its real query set, so
         playerIncTimed -> playerIncCheck runs exactly as upstream chains them. */
      p.timed[TMD.SLOW] = c.inn;
      const result = playerIncTimed(p, slow, c.inc, c.notify, c.disturb, c.check, {
        ...hooks,
        incCheck: (): boolean =>
          playerIncCheck(
            slow,
            queriesNone({ objectFlag: (n) => c.prot && n === "FREE_ACT" }),
          ),
      });
      expect(result).toBe(c.notified);
      expect(p.timed[TMD.SLOW]).toBe(c.out);
      expectTail(hooks.st, c.changeMsg, c.recoverMsg, c.notified, c.disturb);
    }
  });

  /*
   * upstream: test_inc_timed1 (timed.c:2257-2420) — player_inc_timed on
   * PARALYZED, which carries TMD_FLAG_NONSTACKING. The table is inc_timed0's
   * with one difference that runs through two whole groups: once the effect is
   * active, ANY further increase is blocked outright and the duration is left
   * exactly where it was (player-timed.c:1057-1063).
   */
  it("inc_timed1", () => {
    const para = effect("PARALYZED");
    const max = firstGrade(para).max;
    const up = firstGrade(para).upMsg!;

    /* The precondition the whole nonstacking half of this table rests on. */
    expect(para.nonStacking).toBe(true);
    expect(para.fail).toEqual([{ code: TMD_FAIL_FLAG_OBJECT, flag: "FREE_ACT" }]);

    type Case = {
      inn: number;
      inc: number;
      notify: boolean;
      disturb: boolean;
      /** player_inc_timed's `check`: may the increase be resisted at all. */
      check: boolean;
      /** OF_FREE_ACT present in p->state.flags, so player_inc_check inhibits. */
      prot: boolean;
      out: number;
      notified: boolean;
      changeMsg: string | null;
      recoverMsg: string | null;
    };
    const cases: Case[] = [
      /* No change from zero: never notifies, whatever notify/disturb/check. */
      { inn: 0, inc: 0, notify: T, disturb: T, check: F, prot: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, inc: 0, notify: T, disturb: F, check: F, prot: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, inc: 0, notify: F, disturb: T, check: F, prot: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, inc: 0, notify: F, disturb: F, check: F, prot: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, inc: 0, notify: T, disturb: T, check: T, prot: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, inc: 0, notify: T, disturb: T, check: F, prot: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, inc: 0, notify: T, disturb: T, check: T, prot: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, inc: 0, notify: T, disturb: F, check: T, prot: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, inc: 0, notify: T, disturb: F, check: F, prot: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, inc: 0, notify: T, disturb: F, check: T, prot: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, inc: 0, notify: F, disturb: T, check: T, prot: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, inc: 0, notify: F, disturb: T, check: F, prot: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, inc: 0, notify: F, disturb: T, check: T, prot: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, inc: 0, notify: F, disturb: F, check: T, prot: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, inc: 0, notify: F, disturb: F, check: F, prot: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, inc: 0, notify: F, disturb: F, check: T, prot: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      /* No change from the current nonzero value never notifies. These rows
         pass inc == 0, so the NONSTACKING guard and the no-change path agree;
         the group below separates them. */
      { inn: 1, inc: 0, notify: T, disturb: T, check: F, prot: F, out: 1, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 3, inc: 0, notify: T, disturb: F, check: F, prot: F, out: 3, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 12, inc: 0, notify: F, disturb: T, check: F, prot: F, out: 12, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 107, inc: 0, notify: F, disturb: F, check: F, prot: F, out: 107, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 1, inc: 0, notify: T, disturb: T, check: T, prot: F, out: 1, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 8, inc: 0, notify: T, disturb: T, check: F, prot: T, out: 8, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 234, inc: 0, notify: T, disturb: T, check: T, prot: T, out: 234, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, inc: 0, notify: T, disturb: F, check: T, prot: F, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 1, inc: 0, notify: T, disturb: F, check: F, prot: T, out: 1, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 6, inc: 0, notify: T, disturb: F, check: T, prot: T, out: 6, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 1317, inc: 0, notify: F, disturb: T, check: T, prot: F, out: 1317, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, inc: 0, notify: F, disturb: T, check: F, prot: T, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 1, inc: 0, notify: F, disturb: T, check: T, prot: T, out: 1, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 25, inc: 0, notify: F, disturb: F, check: T, prot: F, out: 25, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 176, inc: 0, notify: F, disturb: F, check: F, prot: T, out: 176, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 1864, inc: 0, notify: F, disturb: F, check: T, prot: T, out: 1864, notified: F, changeMsg: null, recoverMsg: null },
      /* Going up a grade from zero: not yet active, so NONSTACKING does not
         apply and this behaves exactly as inc_timed0. */
      { inn: 0, inc: 1, notify: T, disturb: T, check: F, prot: F, out: 1, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, inc: 5, notify: T, disturb: F, check: F, prot: F, out: 5, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, inc: 13, notify: F, disturb: T, check: F, prot: F, out: 13, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, inc: 147, notify: F, disturb: F, check: F, prot: F, out: 147, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, inc: max, notify: T, disturb: T, check: T, prot: F, out: max, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, inc: 1, notify: T, disturb: T, check: F, prot: T, out: 1, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, inc: 93, notify: T, disturb: T, check: T, prot: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, inc: 1, notify: T, disturb: F, check: T, prot: F, out: 1, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, inc: 134, notify: T, disturb: F, check: F, prot: T, out: 134, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, inc: 1419, notify: T, disturb: F, check: T, prot: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, inc: 10, notify: F, disturb: T, check: F, prot: T, out: 10, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, inc: 57, notify: F, disturb: T, check: T, prot: F, out: 57, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, inc: 1, notify: F, disturb: T, check: T, prot: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, inc: max, notify: F, disturb: F, check: F, prot: T, out: max, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, inc: 8, notify: F, disturb: F, check: T, prot: F, out: 8, notified: T, changeMsg: up, recoverMsg: null },
      { inn: 0, inc: 1, notify: F, disturb: F, check: T, prot: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      /* Already active: NONSTACKING blocks every increase, so the duration is
         UNCHANGED (out == inn, not inn + inc) and nothing notifies -- the one
         group where this table diverges from inc_timed0. */
      { inn: 1, inc: 35, notify: T, disturb: T, check: F, prot: F, out: 1, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 10, inc: 1, notify: T, disturb: F, check: F, prot: F, out: 10, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 123, inc: 8, notify: F, disturb: T, check: F, prot: F, out: 123, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 1095, inc: 10, notify: F, disturb: F, check: F, prot: F, out: 1095, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 8, inc: 9, notify: T, disturb: T, check: T, prot: F, out: 8, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 17, inc: 1, notify: T, disturb: T, check: F, prot: T, out: 17, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 37, inc: 6, notify: T, disturb: T, check: T, prot: T, out: 37, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 133, inc: 21, notify: T, disturb: F, check: T, prot: F, out: 133, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 1067, inc: 5, notify: T, disturb: F, check: F, prot: T, out: 1067, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 2345, inc: 2, notify: T, disturb: F, check: T, prot: T, out: 2345, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 1, inc: 18, notify: F, disturb: T, check: T, prot: F, out: 1, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 184, inc: 3, notify: F, disturb: T, check: F, prot: T, out: 184, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 1137, inc: 10, notify: F, disturb: T, check: T, prot: T, out: 1137, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 5, inc: 1, notify: F, disturb: F, check: T, prot: F, out: 5, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 74, inc: 3, notify: F, disturb: F, check: F, prot: T, out: 74, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 153, inc: 9, notify: F, disturb: F, check: T, prot: T, out: 153, notified: F, changeMsg: null, recoverMsg: null },
      /* At the maximum and already active: blocked by NONSTACKING rather than
         by the at-maximum test. */
      { inn: max, inc: 1, notify: T, disturb: T, check: F, prot: F, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, inc: 11, notify: T, disturb: F, check: F, prot: F, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, inc: 129, notify: F, disturb: T, check: F, prot: F, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, inc: 1070, notify: F, disturb: F, check: F, prot: F, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, inc: 1, notify: T, disturb: T, check: T, prot: F, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, inc: 18, notify: T, disturb: T, check: F, prot: T, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, inc: 264, notify: T, disturb: T, check: T, prot: T, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, inc: 1, notify: T, disturb: F, check: T, prot: F, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, inc: 33, notify: T, disturb: F, check: F, prot: T, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, inc: 198, notify: T, disturb: F, check: T, prot: T, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, inc: 1, notify: F, disturb: T, check: T, prot: F, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, inc: 53, notify: F, disturb: T, check: F, prot: T, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, inc: 206, notify: F, disturb: T, check: T, prot: T, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, inc: 1, notify: F, disturb: F, check: T, prot: F, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, inc: 12, notify: F, disturb: F, check: F, prot: T, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, inc: 1032, notify: F, disturb: F, check: T, prot: T, out: max, notified: F, changeMsg: null, recoverMsg: null },
    ];

    const p = player();
    for (const c of cases) {
      const hooks = tracker(para.msgt);
      /* The C pokes OF_FREE_ACT into p->state.flags (timed.c:2229-2235); here the
         same state reaches player_inc_check through its real query set, so
         playerIncTimed -> playerIncCheck runs exactly as upstream chains them. */
      p.timed[TMD.PARALYZED] = c.inn;
      const result = playerIncTimed(p, para, c.inc, c.notify, c.disturb, c.check, {
        ...hooks,
        incCheck: (): boolean =>
          playerIncCheck(
            para,
            queriesNone({ objectFlag: (n) => c.prot && n === "FREE_ACT" }),
          ),
      });
      expect(result).toBe(c.notified);
      expect(p.timed[TMD.PARALYZED]).toBe(c.out);
      expectTail(hooks.st, c.changeMsg, c.recoverMsg, c.notified, c.disturb);
    }
  });

  /*
   * upstream: test_dec_timed0 (timed.c:2421-2522) — player_dec_timed on SLOW.
   * The behaviour that distinguishes it from player_set_timed: when the decrease
   * takes the duration to zero or below, `notify` is FORCED true, so the lapse
   * always notifies and always emits the on_end MSG_RECOVER message
   * (player-timed.c:1101-1105).
   */
  it("dec_timed0", () => {
    const slow = effect("SLOW");
    const max = firstGrade(slow).max;
    const onEnd = slow.onEnd;

    expect(onEnd).not.toBe("");
    expect(slow.onIncrease).toBe("");
    expect(slow.onDecrease).toBe("");

    type Case = {
      inn: number;
      dec: number;
      notify: boolean;
      disturb: boolean;
      out: number;
      notified: boolean;
      changeMsg: string | null;
      recoverMsg: string | null;
    };
    const cases: Case[] = [
      /* No change from zero: never notifies. */
      { inn: 0, dec: 0, notify: T, disturb: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, dec: 0, notify: T, disturb: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, dec: 0, notify: F, disturb: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, dec: 0, notify: F, disturb: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      /* Zero minus a positive amount is coerced back to zero by lower_bound,
         so it is a no-change and does not notify despite the forced notify. */
      { inn: 0, dec: 1, notify: T, disturb: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, dec: 62, notify: F, disturb: T, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, dec: 351, notify: T, disturb: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 0, dec: 1388, notify: F, disturb: F, out: 0, notified: F, changeMsg: null, recoverMsg: null },
      /* dec == 0 from a nonzero value: no change, never notifies. */
      { inn: 1, dec: 0, notify: T, disturb: T, out: 1, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 54, dec: 0, notify: T, disturb: F, out: 54, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 227, dec: 0, notify: F, disturb: T, out: 227, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 1401, dec: 0, notify: F, disturb: F, out: 1401, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, dec: 0, notify: T, disturb: T, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, dec: 0, notify: T, disturb: F, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, dec: 0, notify: F, disturb: T, out: max, notified: F, changeMsg: null, recoverMsg: null },
      { inn: max, dec: 0, notify: F, disturb: F, out: max, notified: F, changeMsg: null, recoverMsg: null },
      /* The effect lapses. notify is forced true (player-timed.c:1117-1118), so
         EVERY row here notifies and emits on_end -- including the notify: F rows,
         which is exactly what player_set_timed would NOT have done. */
      { inn: 1, dec: 3, notify: T, disturb: T, out: 0, notified: T, changeMsg: null, recoverMsg: onEnd },
      { inn: 90, dec: 90, notify: F, disturb: T, out: 0, notified: T, changeMsg: null, recoverMsg: onEnd },
      { inn: 411, dec: 500, notify: T, disturb: F, out: 0, notified: T, changeMsg: null, recoverMsg: onEnd },
      { inn: 4086, dec: 4086, notify: F, disturb: F, out: 0, notified: T, changeMsg: null, recoverMsg: onEnd },
      { inn: max, dec: max, notify: T, disturb: T, out: 0, notified: T, changeMsg: null, recoverMsg: onEnd },
      { inn: max, dec: max + 167, notify: F, disturb: T, out: 0, notified: T, changeMsg: null, recoverMsg: onEnd },
      { inn: max, dec: max, notify: T, disturb: F, out: 0, notified: T, changeMsg: null, recoverMsg: onEnd },
      { inn: max, dec: max + 2143, notify: F, disturb: F, out: 0, notified: T, changeMsg: null, recoverMsg: onEnd },
      /* Decreasing within the grade: ordinary player_set_timed behaviour again,
         so notify is honoured and there is no on_decrease message. */
      { inn: 2, dec: 1, notify: T, disturb: T, out: 1, notified: T, changeMsg: null, recoverMsg: null },
      { inn: 92, dec: 38, notify: F, disturb: T, out: 54, notified: F, changeMsg: null, recoverMsg: null },
      { inn: 705, dec: 700, notify: T, disturb: F, out: 5, notified: T, changeMsg: null, recoverMsg: null },
      { inn: 4286, dec: 7, notify: F, disturb: F, out: 4279, notified: F, changeMsg: null, recoverMsg: null },
    ];

    const p = player();
    for (const c of cases) {
      const hooks = tracker(slow.msgt);
      p.timed[TMD.SLOW] = c.inn;
      const result = playerDecTimed(p, slow, c.dec, c.notify, c.disturb, hooks);
      expect(result).toBe(c.notified);
      expect(p.timed[TMD.SLOW]).toBe(c.out);
      expectTail(hooks.st, c.changeMsg, c.recoverMsg, c.notified, c.disturb);
    }
  });

  // upstream: test_clear_timed0
  it("clear_timed0", () => {
    const slow = effect("SLOW");
    const max = firstGrade(slow).max;
    const onEnd = slow.onEnd;
    type Case = {
      inn: number;
      notify: boolean;
      disturb: boolean;
      notified: boolean;
      recoverMsg: string | null;
    };
    const cases: Case[] = [
      { inn: 0, notify: true, disturb: true, notified: false, recoverMsg: null },
      { inn: 0, notify: true, disturb: false, notified: false, recoverMsg: null },
      { inn: 0, notify: false, disturb: true, notified: false, recoverMsg: null },
      { inn: 0, notify: false, disturb: false, notified: false, recoverMsg: null },
      { inn: 1, notify: true, disturb: true, notified: true, recoverMsg: onEnd },
      { inn: 90, notify: false, disturb: true, notified: false, recoverMsg: null },
      { inn: 458, notify: true, disturb: false, notified: true, recoverMsg: onEnd },
      { inn: 8192, notify: false, disturb: false, notified: false, recoverMsg: null },
      { inn: max, notify: true, disturb: true, notified: true, recoverMsg: onEnd },
      { inn: max, notify: false, disturb: true, notified: false, recoverMsg: null },
      { inn: max, notify: true, disturb: false, notified: true, recoverMsg: onEnd },
      { inn: max, notify: false, disturb: false, notified: false, recoverMsg: null },
    ];
    const p = player();
    for (const c of cases) {
      const hooks = tracker(slow.msgt);
      p.timed[TMD.SLOW] = c.inn;
      const result = playerClearTimed(p, slow, c.notify, c.disturb, hooks);
      expect(result).toBe(c.notified);
      expect(p.timed[TMD.SLOW]).toBe(0);
      if (c.recoverMsg) {
        expect(hooks.st.nRecover).toBe(1);
        expect(hooks.st.lastRecover).toBe(c.recoverMsg);
      } else {
        expect(hooks.st.nRecover).toBe(0);
      }
      expect(hooks.st.inputFlushed).toBe(c.notified && c.disturb);
    }
  });
});

/**
 * A resistance-less, flagless player: every player_inc_check fail condition
 * passes. `over` replaces individual resolvers, standing in for the C's direct
 * pokes at p->state.flags / el_info / pflags / timed.
 */
function queriesNone(
  over: Partial<PlayerIncCheckQueries> = {},
): PlayerIncCheckQueries {
  return {
    objectFlag: () => false,
    resistLevel: () => 0,
    playerFlag: () => false,
    timedActive: () => false,
    ...over,
  };
}
