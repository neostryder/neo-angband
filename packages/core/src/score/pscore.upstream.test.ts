/**
 * Upstream unit tests from reference/src/tests/player/pscore.c
 *
 * Mapping (score.ts / types.ts):
 *   highscore_valid      -> highscoreValid
 *   highscore_where      -> highscoreWhere
 *   highscore_add        -> highscoreAdd
 *   highscore_regularize -> highscoreRegularize
 *   build_score          -> buildScore
 *
 * Representation note: C stores every field as a fixed-width null-terminated
 * string; the port uses typed JSON numbers/strings (parity/ledger/high-scores.yaml).
 * Tests that only exercise string null-termination / space-padding (most of
 * highscore_valid1 and regularize string-corruption cases) have no port
 * counterpart for those exact bytes; the typed validity / ordering / insert
 * logic is exercised instead. Array capacity in C is the caller's N_ELEMENTS;
 * the port always caps at MAX_HISCORES (100) on a compact list.
 */

import { describe, expect, it } from "vitest";
import type { Player } from "../player/player.js";
import {
  buildScore,
  highscoreAdd,
  highscoreCmp,
  highscoreRegularize,
  highscoreValid,
  highscoreWhere,
} from "./score.js";
import { MAX_HISCORES, WINNING_HOW } from "./types.js";
import type { HighScore } from "./types.js";

function stubPlayer(over: Partial<Player> = {}): Player {
  return {
    race: { ridx: 0, name: "TestRace" },
    cls: { cidx: 0, name: "TestClass" },
    au: 567,
    lev: 4,
    maxLev: 6,
    maxExp: 1234,
    maxDepth: 5,
    ...over,
  } as unknown as Player;
}

function deps(diedFrom: string, deathTime?: Date | null) {
  return {
    diedFrom,
    turn: 890,
    depth: 3,
    fullName: "Tester",
    uid: 10,
    buildid: "4.2.6",
    deathTime: deathTime ?? null,
  };
}

function emptyScore(): HighScore {
  return {
    what: "",
    pts: 0,
    gold: 0,
    turns: 0,
    day: "",
    who: "",
    uid: 0,
    pRace: 0,
    pClass: 0,
    curLev: 0,
    curDun: 0,
    maxLev: 0,
    maxDun: 0,
    how: "",
  };
}

describe("player/pscore (reference/src/tests/player/pscore.c)", () => {
  // upstream: test_highscore_valid0
  it("highscore_valid0", () => {
    const p = stubPlayer();
    /* An empty score record should be valid. */
    expect(highscoreValid(emptyScore())).toBe(true);

    /* The result of build_score() should be valid. */
    expect(highscoreValid(buildScore(p, deps("a grue")))).toBe(true);
    expect(highscoreValid(buildScore(p, deps("nobody (yet)")))).toBe(true);
    expect(highscoreValid(buildScore(p, deps("a grue", new Date())))).toBe(true);
  });

  // upstream: test_highscore_valid1
  // Most C cases probe fixed-width string encoding. Typed equivalent: NaN /
  // Infinity numeric fields are invalid; empty what remains valid.
  it("highscore_valid1", () => {
    /* Empty with a non-empty pts-equivalent is invalid when what is non-empty
     * but a numeric field is non-finite (port typed invalidity). */
    const partial = { ...emptyScore(), what: "x", pts: NaN };
    expect(highscoreValid(partial)).toBe(false);
    expect(highscoreValid({ ...emptyScore(), what: "x", gold: Infinity })).toBe(
      false,
    );
    expect(highscoreValid({ ...emptyScore(), what: "x", turns: -Infinity })).toBe(
      false,
    );

    /* A complete build_score result is valid. */
    const good = buildScore(stubPlayer(), deps("a grue"));
    expect(highscoreValid(good)).toBe(true);

    /* Corrupting a numeric field to NaN is invalid. */
    expect(highscoreValid({ ...good, pts: Number.NaN })).toBe(false);
    expect(highscoreValid({ ...good, gold: Number.NaN })).toBe(false);
    expect(highscoreValid({ ...good, turns: Number.NaN })).toBe(false);
    expect(highscoreValid({ ...good, uid: Number.NaN })).toBe(false);
    expect(highscoreValid({ ...good, pRace: Number.NaN })).toBe(false);
    expect(highscoreValid({ ...good, pClass: Number.NaN })).toBe(false);
    expect(highscoreValid({ ...good, curLev: Number.NaN })).toBe(false);
    expect(highscoreValid({ ...good, curDun: Number.NaN })).toBe(false);
    expect(highscoreValid({ ...good, maxLev: Number.NaN })).toBe(false);
    expect(highscoreValid({ ...good, maxDun: Number.NaN })).toBe(false);
  });

  // upstream: test_highscore_where0
  it("highscore_where0", () => {
    const scores: HighScore[] = [];
    let p = stubPlayer();

    /* Empty list: new score goes in first slot. */
    let score = buildScore(p, deps("a grue", new Date()));
    expect(highscoreWhere(score, scores)).toBe(0);
    scores.push(score);

    /* Fewer points, same winning status -> after. */
    p = stubPlayer({ maxExp: 1233 });
    score = buildScore(p, deps("a grue", new Date()));
    expect(highscoreWhere(score, scores)).toBe(1);
    scores.push(score);

    /* Winning score goes first. */
    p = stubPlayer();
    score = buildScore(p, deps(WINNING_HOW, new Date()));
    expect(highscoreWhere(score, scores)).toBe(0);
    scores.splice(0, 0, score);

    /* More points, same winning status -> before lower. */
    p = stubPlayer({ maxExp: 1235 });
    score = buildScore(p, deps("a grue", new Date()));
    expect(highscoreWhere(score, scores)).toBe(1);
    scores.splice(1, 0, score);

    /* Same points and status: new entry goes first among ties. */
    p = stubPlayer();
    score = buildScore(p, deps("a grue", new Date()));
    expect(highscoreWhere(score, scores)).toBe(2);
    scores.splice(2, 0, score);

    /* Full list of MAX_HISCORES: a worse score takes the last slot. */
    const full: HighScore[] = [];
    for (let i = 0; i < MAX_HISCORES; i++) {
      full.push(
        buildScore(stubPlayer({ maxExp: 10000 - i }), deps("a grue", new Date())),
      );
    }
    const worst = buildScore(stubPlayer({ maxExp: 0, maxDepth: 0 }), deps("a grue", new Date()));
    expect(highscoreWhere(worst, full)).toBe(MAX_HISCORES - 1);
  });

  // upstream: test_highscore_add0
  it("highscore_add0", () => {
    const scurr: HighScore[] = [];
    let p = stubPlayer();

    const s0 = buildScore(p, deps(WINNING_HOW, new Date()));
    expect(highscoreAdd(s0, scurr)).toBe(0);
    expect(scurr[0]).toEqual(s0);

    p = stubPlayer({ maxExp: 1235 });
    const s1 = buildScore(p, deps(WINNING_HOW, new Date()));
    expect(highscoreAdd(s1, scurr)).toBe(0);
    expect(scurr[0]).toEqual(s1);
    expect(scurr[1]).toEqual(s0);

    p = stubPlayer({ maxExp: 1233 });
    const s2 = buildScore(p, deps(WINNING_HOW, new Date()));
    expect(highscoreAdd(s2, scurr)).toBe(2);
    expect(scurr[2]).toEqual(s2);

    p = stubPlayer();
    const s3 = buildScore(p, deps("a grue", new Date()));
    expect(highscoreAdd(s3, scurr)).toBe(3);

    p = stubPlayer({ maxExp: 2000 });
    const s4 = buildScore(p, deps("a grue", new Date()));
    expect(highscoreAdd(s4, scurr)).toBe(3);

    /* Fill to MAX_HISCORES and ensure a worse entry lands last and truncates. */
    while (scurr.length < MAX_HISCORES) {
      highscoreAdd(
        buildScore(
          stubPlayer({ maxExp: 100 - scurr.length }),
          deps("a grue", new Date()),
        ),
        scurr,
      );
    }
    expect(scurr.length).toBe(MAX_HISCORES);
    const lastBefore = scurr[MAX_HISCORES - 1]!;
    const worse = buildScore(
      stubPlayer({ maxExp: 0, maxDepth: 0 }),
      deps("a grue", new Date()),
    );
    expect(highscoreAdd(worse, scurr)).toBe(MAX_HISCORES - 1);
    expect(scurr.length).toBe(MAX_HISCORES);
    expect(scurr[MAX_HISCORES - 1]).toEqual(worse);
    expect(scurr[MAX_HISCORES - 1]).not.toEqual(lastBefore);
  });

  // upstream: test_highscore_regularize0
  it("highscore_regularize0", () => {
    /* Empty list: no change. */
    let { scores, irregular } = highscoreRegularize([]);
    expect(irregular).toBe(false);
    expect(scores).toEqual([]);

    /* Well-ordered build_score + highscore_add sequence: no change. */
    const good: HighScore[] = [];
    let p = stubPlayer();
    highscoreAdd(buildScore(p, deps("a grue", new Date())), good);
    ({ scores, irregular } = highscoreRegularize(good));
    expect(irregular).toBe(false);
    expect(scores).toEqual(good);

    p = stubPlayer({ maxExp: 1244 });
    highscoreAdd(buildScore(p, deps("a grue", new Date())), good);
    ({ scores, irregular } = highscoreRegularize(good));
    expect(irregular).toBe(false);

    p = stubPlayer({ maxExp: 1239 });
    highscoreAdd(buildScore(p, deps("a grue", new Date())), good);
    ({ scores, irregular } = highscoreRegularize(good));
    expect(irregular).toBe(false);

    highscoreAdd(buildScore(stubPlayer(), deps(WINNING_HOW, new Date())), good);
    ({ scores, irregular } = highscoreRegularize(good));
    expect(irregular).toBe(false);

    p = stubPlayer({ maxExp: 1254 });
    highscoreAdd(buildScore(p, deps(WINNING_HOW, new Date())), good);
    ({ scores, irregular } = highscoreRegularize(good));
    expect(irregular).toBe(false);
  });

  // upstream: test_highscore_regularize1
  it("highscore_regularize1", () => {
    /* Invalid (NaN) entry is dropped. */
    const scores = [
      buildScore(stubPlayer(), deps("a grue")),
      { ...buildScore(stubPlayer({ maxExp: 100 }), deps("a grue")), pts: NaN },
      buildScore(stubPlayer({ maxExp: 50 }), deps("a grue")),
    ];
    const { scores: out, irregular } = highscoreRegularize(scores);
    expect(irregular).toBe(true);
    expect(out).toHaveLength(2);
    expect(out.every((s) => highscoreValid(s))).toBe(true);

    /* Out-of-order list is reordered. */
    const disordered = [
      buildScore(stubPlayer({ maxExp: 100 }), deps("a grue")),
      buildScore(stubPlayer({ maxExp: 500 }), deps("a grue")),
      buildScore(stubPlayer({ maxExp: 200 }), deps(WINNING_HOW)),
    ];
    const r2 = highscoreRegularize(disordered);
    expect(r2.irregular).toBe(true);
    /* Winner first, then strictly best-first by points: assert the WHOLE list
     * is ordered by highscore_cmp, not just one adjacent pair. */
    expect(r2.scores).toHaveLength(3);
    expect(r2.scores[0]!.how).toBe(WINNING_HOW);
    expect(r2.scores.map((sc) => sc.pts)).toEqual([
      200 + 100 * 5,
      500 + 100 * 5,
      100 + 100 * 5,
    ]);
    for (let i = 1; i < r2.scores.length; i++) {
      expect(highscoreCmp(r2.scores[i - 1]!, r2.scores[i]!)).toBeLessThanOrEqual(0);
    }

    /* Empty (blank what) mid-list is dropped. */
    const withEmpty = [
      buildScore(stubPlayer({ maxExp: 300 }), deps("a grue")),
      emptyScore(),
      buildScore(stubPlayer({ maxExp: 100 }), deps("a grue")),
    ];
    const r3 = highscoreRegularize(withEmpty);
    expect(r3.irregular).toBe(true);
    expect(r3.scores).toHaveLength(2);
  });
});
