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
import { OF, TMD } from "../generated";
import { timedNameToIdx } from "../effects/effect";
import { Rng } from "../rng";
import { bindPlayer } from "./bind";
import type { PlayerPackRecords } from "./bind";
import type { TimedEffect } from "./types";
import { TMD_MAX } from "./types";
import type { PlayerTimedHooks, PlayerTimedTarget } from "./timed";
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
  };
}

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
      { inn: 0, neu: 0, notify: true, disturb: true, out: 0, notified: false, changeMsg: null, recoverMsg: null },
      { inn: 0, neu: -1, notify: true, disturb: true, out: 0, notified: false, changeMsg: null, recoverMsg: null },
      { inn: 1, neu: 1, notify: true, disturb: true, out: 1, notified: false, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max, notify: false, disturb: false, out: max, notified: false, changeMsg: null, recoverMsg: null },
      { inn: 0, neu: 1, notify: true, disturb: true, out: 1, notified: true, changeMsg: up, recoverMsg: null },
      { inn: 0, neu: max, notify: false, disturb: false, out: max, notified: true, changeMsg: up, recoverMsg: null },
      { inn: 1, neu: 0, notify: true, disturb: true, out: 0, notified: true, changeMsg: null, recoverMsg: onEnd },
      { inn: 90, neu: 0, notify: false, disturb: true, out: 0, notified: false, changeMsg: null, recoverMsg: null },
      { inn: 1, neu: 2, notify: true, disturb: true, out: 2, notified: true, changeMsg: onInc, recoverMsg: null },
      { inn: 10, neu: 30, notify: false, disturb: true, out: 30, notified: false, changeMsg: null, recoverMsg: null },
      { inn: 2, neu: 1, notify: true, disturb: true, out: 1, notified: true, changeMsg: onDec, recoverMsg: null },
      { inn: 73, neu: 60, notify: false, disturb: true, out: 60, notified: false, changeMsg: null, recoverMsg: null },
      { inn: max, neu: max + 1, notify: true, disturb: true, out: max, notified: false, changeMsg: null, recoverMsg: null },
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

  // upstream: test_set_timed2 — multi-grade CUT, no on-inc/dec messages
  it("set_timed2", () => {
    const cut = effect("CUT");
    const p = player();
    const rng = new Rng(7);

    for (let si = 0; si < cut.grades.length; si++) {
      const s = cut.grades[si]!;
      const sL = si === 0 ? s.max : cut.grades[si - 1]!.max + 1;
      for (let ei = 0; ei < cut.grades.length; ei++) {
        const e = cut.grades[ei]!;
        const eL = ei === 0 ? e.max : cut.grades[ei - 1]!.max + 1;

        if (s.grade === e.grade) {
          const oldv = rng.randRange(sL, s.max);
          for (let i = 0; i < 4; i++) {
            const notify = i < 2;
            const disturb = !(i % 2);
            const hooks = tracker(cut.msgt);
            p.timed[TMD.CUT] = oldv;
            const result = playerSetTimed(p, cut, oldv, notify, disturb, hooks);
            expect(result).toBe(false);
            expect(p.timed[TMD.CUT]).toBe(oldv);
            expect(hooks.st.nTracked).toBe(0);
            expect(hooks.st.nRecover).toBe(0);
            expect(hooks.st.inputFlushed).toBe(false);
          }
          if (!cut.grades[si + 1]) {
            for (let i = 0; i < 4; i++) {
              const notify = i < 2;
              const disturb = !(i % 2);
              const hooks = tracker(cut.msgt);
              p.timed[TMD.CUT] = s.max;
              const newv = rng.randRange(
                Math.min(s.max + 1, 32767),
                Math.min(s.max + 10, 32767),
              );
              const result = playerSetTimed(p, cut, newv, notify, disturb, hooks);
              expect(result).toBe(false);
              expect(p.timed[TMD.CUT]).toBe(s.max);
              expect(hooks.st.nTracked).toBe(0);
              expect(hooks.st.inputFlushed).toBe(false);
            }
          } else if (!s.grade) {
            for (let i = 0; i < 4; i++) {
              const notify = i < 2;
              const disturb = !(i % 2);
              const hooks = tracker(cut.msgt);
              p.timed[TMD.CUT] = sL;
              const newv = rng.randRange(sL - 30, sL - 1);
              const result = playerSetTimed(p, cut, newv, notify, disturb, hooks);
              expect(result).toBe(false);
              expect(p.timed[TMD.CUT]).toBe(sL);
            }
          }
        } else if (s.grade < e.grade) {
          /* Going up grades: always notifies with up_msg. */
          const oldv = s.grade === 0 ? 0 : rng.randRange(sL, s.max);
          const newv = rng.randRange(eL, e.max);
          for (const [notify, disturb] of [
            [true, true],
            [false, false],
          ] as const) {
            const hooks = tracker(cut.msgt);
            p.timed[TMD.CUT] = oldv;
            const result = playerSetTimed(p, cut, newv, notify, disturb, hooks);
            expect(result).toBe(true);
            expect(p.timed[TMD.CUT]).toBe(newv);
            expect(hooks.st.nTracked).toBe(1);
            expect(hooks.st.lastTracked).toBe(e.upMsg);
            expect(hooks.st.inputFlushed).toBe(disturb);
          }
        } else {
          /* Going down grades. */
          const oldv = rng.randRange(sL, s.max);
          const newv = e.grade === 0 ? 0 : rng.randRange(eL, e.max);
          for (const [notify, disturb] of [
            [true, true],
            [false, false],
          ] as const) {
            const hooks = tracker(cut.msgt);
            p.timed[TMD.CUT] = oldv;
            const result = playerSetTimed(p, cut, newv, notify, disturb, hooks);
            if (e.grade === 0) {
              /* Finish: notify only if requested; recover on_end. */
              expect(result).toBe(notify);
              expect(p.timed[TMD.CUT]).toBe(0);
              if (notify) {
                expect(hooks.st.nRecover).toBe(1);
                expect(hooks.st.lastRecover).toBe(cut.onEnd);
              } else {
                expect(hooks.st.nRecover).toBe(0);
              }
            } else {
              /* Intermediate grade without down_msg: notify only if requested. */
              expect(result).toBe(notify);
              expect(p.timed[TMD.CUT]).toBe(newv);
            }
            expect(hooks.st.inputFlushed).toBe(result && disturb);
          }
        }
      }
    }
  });

  // upstream: test_set_timed3 — STUN multi-grade (same structure as CUT)
  it("set_timed3", () => {
    const stun = effect("STUN");
    const p = player();
    /* Climb to Heavy Stun and verify up message, then clear. */
    const hooks = tracker(stun.msgt);
    p.timed[TMD.STUN] = 0;
    const result = playerSetTimed(p, stun, 100, true, true, hooks);
    expect(result).toBe(true);
    expect(p.timed[TMD.STUN]).toBe(100);
    expect(hooks.st.lastTracked).toBe(
      stun.grades.find((g) => g.name === "Heavy Stun")!.upMsg,
    );

    const hooks2 = tracker(stun.msgt);
    const cleared = playerSetTimed(p, stun, 0, true, true, hooks2);
    expect(cleared).toBe(true);
    expect(p.timed[TMD.STUN]).toBe(0);
    expect(hooks2.st.lastRecover).toBe(stun.onEnd);
  });

  // upstream: test_set_timed4 — FOOD with lower-bound and down messages
  it("set_timed4", () => {
    const food = effect("FOOD");
    const p = player();
    const full = food.grades[food.grades.length - 1]!;
    const fed = food.grades[food.grades.length - 2]!;

    /* At lower bound, cannot go below. */
    p.timed[TMD.FOOD] = food.lowerBound;
    const hooks = tracker(food.msgt);
    const r = playerSetTimed(p, food, 0, true, true, hooks);
    expect(r).toBe(false);
    expect(p.timed[TMD.FOOD]).toBe(food.lowerBound);

    /* Going up to Full notifies with up_msg. */
    p.timed[TMD.FOOD] = fed.max;
    const hooks2 = tracker(food.msgt);
    const r2 = playerSetTimed(p, food, full.max, true, true, hooks2);
    expect(r2).toBe(true);
    expect(p.timed[TMD.FOOD]).toBe(full.max);
    expect(hooks2.st.lastTracked).toBe(full.upMsg);

    /* Going down a grade with down_msg. */
    p.timed[TMD.FOOD] = full.max;
    const hooks3 = tracker(food.msgt);
    const r3 = playerSetTimed(p, food, fed.max, true, true, hooks3);
    expect(r3).toBe(true);
    expect(hooks3.st.lastTracked).toBe(fed.downMsg);
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
    const T = true;
    const F = false;
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

  // upstream: test_set_timed6 — temp resist / oflag overlap cases
  it("set_timed6", () => {
    const oppFire = effect("OPP_FIRE");
    const p = player();
    const hooks = tracker(oppFire.msgt);
    p.timed[TMD.OPP_FIRE] = 0;
    const r = playerSetTimed(p, oppFire, 50, true, true, hooks);
    expect(r).toBe(true);
    expect(p.timed[TMD.OPP_FIRE]).toBe(50);
    expect(hooks.st.lastTracked).toBe(firstGrade(oppFire).upMsg);

    const hooks2 = tracker(oppFire.msgt);
    const r2 = playerSetTimed(p, oppFire, 0, true, true, hooks2);
    expect(r2).toBe(true);
    expect(hooks2.st.lastRecover).toBe(oppFire.onEnd);
  });

  // upstream: test_inc_check0
  it("inc_check0", () => {
    const food = effect("FOOD");
    const sinvis = effect("SINVIS");
    const slow = effect("SLOW");
    const pois = effect("POISONED");

    expect(food.fail.length).toBe(0);
    expect(playerIncCheck(food, queriesNone())).toBe(true);
    expect(sinvis.fail.length).toBe(0);
    expect(playerIncCheck(sinvis, queriesNone())).toBe(true);

    /* FREE_ACT protects SLOW. */
    expect(playerIncCheck(slow, queriesNone())).toBe(true);
    expect(
      playerIncCheck(slow, {
        objectFlag: (f) => f === "FREE_ACT",
        resistLevel: () => 0,
        playerFlag: () => false,
        timedActive: () => false,
      }),
    ).toBe(false);

    /* POIS resist protects POISONED. */
    expect(playerIncCheck(pois, queriesNone())).toBe(true);
    expect(
      playerIncCheck(pois, {
        objectFlag: () => false,
        resistLevel: (f) => (f === "POIS" ? 1 : 0),
        playerFlag: () => false,
        timedActive: () => false,
      }),
    ).toBe(false);

    /* OPP_POIS timed protects POISONED. */
    expect(
      playerIncCheck(pois, {
        objectFlag: () => false,
        resistLevel: () => 0,
        playerFlag: () => false,
        timedActive: (f) => f === "OPP_POIS",
      }),
    ).toBe(false);
  });

  // upstream: test_inc_timed0 — basic increase with check
  it("inc_timed0", () => {
    const slow = effect("SLOW");
    const p = player();
    p.timed[TMD.SLOW] = 0;
    const hooks = tracker(slow.msgt);
    const r = playerIncTimed(p, slow, 10, true, true, true, {
      ...hooks,
      incCheck: () => true,
    });
    expect(r).toBe(true);
    expect(p.timed[TMD.SLOW]).toBe(10);

    /* Resisted increase. */
    p.timed[TMD.SLOW] = 5;
    const hooks2 = tracker(slow.msgt);
    const r2 = playerIncTimed(p, slow, 10, true, true, true, {
      ...hooks2,
      incCheck: () => false,
    });
    expect(r2).toBe(false);
    expect(p.timed[TMD.SLOW]).toBe(5);
  });

  // upstream: test_inc_timed1 — NONSTACKING (PARALYZED)
  it("inc_timed1", () => {
    const para = effect("PARALYZED");
    expect(para.nonStacking).toBe(true);
    const p = player();
    p.timed[TMD.PARALYZED] = 0;
    const hooks = tracker(para.msgt);
    expect(
      playerIncTimed(p, para, 5, true, true, false, hooks),
    ).toBe(true);
    expect(p.timed[TMD.PARALYZED]).toBe(5);

    /* Already active: blocked. */
    const hooks2 = tracker(para.msgt);
    expect(
      playerIncTimed(p, para, 5, true, true, false, hooks2),
    ).toBe(false);
    expect(p.timed[TMD.PARALYZED]).toBe(5);
  });

  // upstream: test_dec_timed0
  it("dec_timed0", () => {
    const slow = effect("SLOW");
    const p = player();
    p.timed[TMD.SLOW] = 10;
    const hooks = tracker(slow.msgt);
    const r = playerDecTimed(p, slow, 3, true, true, hooks);
    expect(r).toBe(true);
    expect(p.timed[TMD.SLOW]).toBe(7);

    /* Finishing always notifies. */
    p.timed[TMD.SLOW] = 2;
    const hooks2 = tracker(slow.msgt);
    const r2 = playerDecTimed(p, slow, 5, false, true, hooks2);
    expect(r2).toBe(true);
    expect(p.timed[TMD.SLOW]).toBe(0);
    expect(hooks2.st.lastRecover).toBe(slow.onEnd);
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

function queriesNone() {
  return {
    objectFlag: () => false,
    resistLevel: () => 0,
    playerFlag: () => false,
    timedActive: () => false,
  };
}
