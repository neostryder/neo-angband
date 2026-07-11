import { describe, expect, it } from "vitest";
import type { Player } from "../player/player";
import {
  buildScore,
  totalPoints,
  highscoreWhere,
  highscoreAdd,
  highscoreCount,
  highscoreRegularize,
  highscoreValid,
  highscoreCmp,
  enterScore,
  predictScore,
} from "./score";
import { MAX_HISCORES, WINNING_HOW } from "./types";
import type { HighScore, ScoreStore } from "./types";
import { OptionState } from "../player/options";

/**
 * A minimal Player stub carrying only the fields the score code reads
 * (total_points, build_score). The rest of struct player is irrelevant here.
 */
function stubPlayer(over: Partial<Player> = {}): Player {
  return {
    race: { ridx: 3, name: "Half-Troll" },
    cls: { cidx: 0, name: "Warrior" },
    au: 1234,
    lev: 20,
    maxLev: 22,
    maxExp: 5000,
    maxDepth: 12,
    ...over,
  } as unknown as Player;
}

/** A HighScore with sensible defaults, overridable per field. */
function score(over: Partial<HighScore> = {}): HighScore {
  return {
    what: "0.1.0",
    pts: 1000,
    gold: 0,
    turns: 0,
    day: "TODAY",
    who: "Aragorn",
    uid: 0,
    pRace: 0,
    pClass: 0,
    curLev: 1,
    curDun: 1,
    maxLev: 1,
    maxDun: 1,
    how: "a giant rat",
    ...over,
  };
}

/** An in-memory ScoreStore for enterScore tests. */
function memStore(initial: HighScore[] = []): ScoreStore & { data: HighScore[] } {
  const data = initial;
  return {
    data,
    read: () => data.map((s) => ({ ...s })),
    write: (s) => {
      data.length = 0;
      data.push(...s);
    },
  };
}

describe("totalPoints (score.c L28)", () => {
  it("is max_exp + 100 * max_depth", () => {
    expect(totalPoints(stubPlayer({ maxExp: 5000, maxDepth: 12 }))).toBe(6200);
    expect(totalPoints(stubPlayer({ maxExp: 0, maxDepth: 0 }))).toBe(0);
    expect(totalPoints(stubPlayer({ maxExp: 42, maxDepth: 1 }))).toBe(142);
    expect(totalPoints(stubPlayer({ maxExp: 999999, maxDepth: 98 }))).toBe(
      999999 + 9800,
    );
  });
});

describe("buildScore (score.c build_score, L216)", () => {
  it("captures the player fields, truncating who/how, day = TODAY when alive", () => {
    const p = stubPlayer({
      au: 777,
      lev: 30,
      maxLev: 31,
      maxExp: 12000,
      maxDepth: 40,
    });
    const e = buildScore(p, {
      diedFrom: "a giant rat",
      turn: 54321,
      depth: 38,
      fullName: "Aragorn son of Arathorn the Second",
      uid: 501,
      buildid: "4.2.6-neo",
    });
    expect(e.pts).toBe(12000 + 4000); // 16000
    expect(e.gold).toBe(777);
    expect(e.turns).toBe(54321);
    expect(e.curLev).toBe(30);
    expect(e.maxLev).toBe(31);
    expect(e.curDun).toBe(38); // live depth, not max_depth
    expect(e.maxDun).toBe(40);
    expect(e.pRace).toBe(3);
    expect(e.pClass).toBe(0);
    expect(e.uid).toBe(501);
    expect(e.how).toBe("a giant rat");
    expect(e.day).toBe("TODAY"); // no deathTime
    // who is capped at 15 chars ("%-.15s").
    expect(e.who).toBe("Aragorn son of ");
    expect(e.who.length).toBe(15);
    // what is capped at 7 chars (what[8]).
    expect(e.what).toBe("4.2.6-n");
  });

  it("formats a death-time day stamp as @YYYYMMDD in local time", () => {
    const e = buildScore(stubPlayer(), {
      diedFrom: "a kobold",
      turn: 1,
      depth: 5,
      deathTime: new Date(2026, 6, 11, 9, 30), // 2026-07-11 local
    });
    expect(e.day).toBe("@20260711");
  });

  it("truncates a very long death cause to 31 chars (how[32])", () => {
    const long = "the Everliving Doom of a Thousand Ages of Night";
    const e = buildScore(stubPlayer(), { diedFrom: long, turn: 1, depth: 1 });
    expect(e.how.length).toBe(31);
    expect(e.how).toBe(long.slice(0, 31));
  });
});

describe("highscoreWhere (score-util.c L276): insert slot, points desc", () => {
  it("orders by points descending", () => {
    const scores = [score({ pts: 3000 }), score({ pts: 2000 }), score({ pts: 1000 })];
    expect(highscoreWhere(score({ pts: 3500 }), scores)).toBe(0);
    expect(highscoreWhere(score({ pts: 2500 }), scores)).toBe(1);
    expect(highscoreWhere(score({ pts: 1500 }), scores)).toBe(2);
    expect(highscoreWhere(score({ pts: 500 }), scores)).toBe(3); // append slot
  });

  it("prefers the new entry on a points tie (entry_pts >= score_pts)", () => {
    const scores = [score({ pts: 3000 }), score({ pts: 2000 })];
    expect(highscoreWhere(score({ pts: 3000 }), scores)).toBe(0);
    expect(highscoreWhere(score({ pts: 2000 }), scores)).toBe(1);
  });

  it("sorts a winner ahead of higher-scoring non-winners", () => {
    const scores = [score({ pts: 9000, how: "a dragon" })];
    const winner = score({ pts: 10, how: WINNING_HOW });
    expect(highscoreWhere(winner, scores)).toBe(0);
  });

  it("keeps a non-winner behind an existing winner regardless of points", () => {
    const scores = [score({ pts: 5, how: WINNING_HOW }), score({ pts: 9000, how: "orc" })];
    // A huge non-winner still cannot pass the winner, but beats the non-winner.
    expect(highscoreWhere(score({ pts: 99999, how: "a lich" }), scores)).toBe(1);
  });

  it("replaces the last record when the table is full", () => {
    const scores: HighScore[] = [];
    for (let i = 0; i < MAX_HISCORES; i++) scores.push(score({ pts: 10000 - i }));
    // A worst-of-all entry cannot fit before any -> replaces index MAX-1.
    expect(highscoreWhere(score({ pts: -1 }), scores)).toBe(MAX_HISCORES - 1);
  });
});

describe("highscoreAdd (score.c L72): shift + truncate", () => {
  it("inserts at the slot and shifts lower records down", () => {
    const scores = [score({ pts: 3000, who: "A" }), score({ pts: 1000, who: "C" })];
    const slot = highscoreAdd(score({ pts: 2000, who: "B" }), scores);
    expect(slot).toBe(1);
    expect(scores.map((s) => s.who)).toEqual(["A", "B", "C"]);
  });

  it("truncates the list at MAX_HISCORES, dropping the worst", () => {
    const scores: HighScore[] = [];
    for (let i = 0; i < MAX_HISCORES; i++) scores.push(score({ pts: 10000 - i }));
    // Insert a mid-table score; the list must stay MAX_HISCORES long.
    const slot = highscoreAdd(score({ pts: 9950 }), scores);
    expect(slot).toBe(50);
    expect(scores.length).toBe(MAX_HISCORES);
    // The old last record (pts 10000 - 99 = 9901) is gone.
    expect(scores[scores.length - 1]!.pts).toBe(9902);
  });

  it("replaces the last record when full and the entry is the worst", () => {
    const scores: HighScore[] = [];
    for (let i = 0; i < MAX_HISCORES; i++) scores.push(score({ pts: 10000 - i }));
    const slot = highscoreAdd(score({ pts: -5, who: "LAST" }), scores);
    expect(slot).toBe(MAX_HISCORES - 1);
    expect(scores.length).toBe(MAX_HISCORES);
    expect(scores[MAX_HISCORES - 1]!.who).toBe("LAST");
  });
});

describe("highscoreCount (score.c L84)", () => {
  it("counts real records, stopping at the first empty (blank what)", () => {
    const scores = [score(), score(), { ...score(), what: "" }, score()];
    expect(highscoreCount(scores)).toBe(2);
    expect(highscoreCount([])).toBe(0);
    expect(highscoreCount([score(), score(), score()])).toBe(3);
  });
});

describe("highscoreValid / highscoreCmp (score-util.c)", () => {
  it("rejects non-finite numeric fields", () => {
    expect(highscoreValid(score())).toBe(true);
    expect(highscoreValid(score({ pts: NaN }))).toBe(false);
    expect(highscoreValid(score({ gold: Infinity }))).toBe(false);
    expect(highscoreValid({ ...score(), what: "" })).toBe(true); // empty is valid
  });

  it("orders winners first, then points desc, ties stable (0)", () => {
    const w = score({ how: WINNING_HOW, pts: 1 });
    const a = score({ how: "orc", pts: 5000 });
    const b = score({ how: "orc", pts: 5000 });
    expect(highscoreCmp(w, a)).toBe(-1);
    expect(highscoreCmp(a, w)).toBe(1);
    expect(highscoreCmp(score({ pts: 9 }), score({ pts: 8 }))).toBe(-1);
    expect(highscoreCmp(a, b)).toBe(0); // true tie
  });
});

describe("highscoreRegularize (score-util.c L199)", () => {
  it("drops invalid/empty records and stable-sorts best-first", () => {
    const scores = [
      score({ pts: 1000, who: "low" }),
      { ...score(), what: "" }, // empty
      score({ pts: 3000, who: "high" }),
      score({ pts: NaN, who: "bad" }), // invalid
      score({ pts: 2000, who: "mid" }),
    ];
    const { scores: out, irregular } = highscoreRegularize(scores);
    expect(irregular).toBe(true);
    expect(out.map((s) => s.who)).toEqual(["high", "mid", "low"]);
  });

  it("reports irregular=false for an already-ordered clean list", () => {
    const scores = [score({ pts: 3000 }), score({ pts: 2000 }), score({ pts: 1000 })];
    const { irregular } = highscoreRegularize(scores);
    expect(irregular).toBe(false);
  });

  it("keeps a winner ahead of a higher-scoring non-winner", () => {
    const scores = [
      score({ pts: 9000, how: "orc", who: "loser" }),
      score({ pts: 10, how: WINNING_HOW, who: "champ" }),
    ];
    const { scores: out, irregular } = highscoreRegularize(scores);
    expect(irregular).toBe(true);
    expect(out.map((s) => s.who)).toEqual(["champ", "loser"]);
  });
});

describe("enterScore (score.c L272): gating", () => {
  it("does NOT enter a cheater", () => {
    const store = memStore();
    const r = enterScore(store, stubPlayer(), { diedFrom: "orc", turn: 1, depth: 1 }, {
      cheated: true,
      diedFrom: "orc",
    });
    expect(r).toEqual({ entered: false, reason: "cheater" });
    expect(store.data.length).toBe(0);
  });

  it("the option store's anyScoreSet() feeds the cheated gate (score.c L277)", () => {
    /* A game that never cheated is scored; one that tripped a score_* option
     * (via the cheat->score coupling) is gated out - the wired seam. */
    const clean = new OptionState();
    const cheated = new OptionState({ overrides: { cheat_room: true } });
    expect(clean.anyScoreSet()).toBe(false);
    expect(cheated.anyScoreSet()).toBe(true);

    const store = memStore();
    expect(
      enterScore(store, stubPlayer(), { diedFrom: "orc", turn: 1, depth: 1 }, {
        cheated: cheated.anyScoreSet(),
        diedFrom: "orc",
      }),
    ).toEqual({ entered: false, reason: "cheater" });
    expect(
      enterScore(store, stubPlayer(), { diedFrom: "orc", turn: 1, depth: 1 }, {
        cheated: clean.anyScoreSet(),
        diedFrom: "orc",
      }).entered,
    ).toBe(true);
  });

  it("does NOT enter a wizard/debug character", () => {
    const store = memStore();
    const r = enterScore(store, stubPlayer(), { diedFrom: "orc", turn: 1, depth: 1 }, {
      noscore: true,
      diedFrom: "orc",
    });
    expect(r).toEqual({ entered: false, reason: "wizard" });
    expect(store.data.length).toBe(0);
  });

  it("does NOT enter an interrupted or retiring non-winner", () => {
    const store = memStore();
    expect(
      enterScore(store, stubPlayer(), { diedFrom: "Interrupting", turn: 1, depth: 1 }, {
        diedFrom: "Interrupting",
      }),
    ).toEqual({ entered: false, reason: "interrupted" });
    expect(
      enterScore(store, stubPlayer(), { diedFrom: "Retiring", turn: 1, depth: 1 }, {
        diedFrom: "Retiring",
      }),
    ).toEqual({ entered: false, reason: "retired" });
    expect(store.data.length).toBe(0);
  });

  it("DOES enter an interrupted winner (total_winner bypasses the gate)", () => {
    const store = memStore();
    const r = enterScore(
      store,
      stubPlayer(),
      { diedFrom: "Interrupting", turn: 1, depth: 1 },
      { diedFrom: "Interrupting", totalWinner: true },
    );
    expect(r.entered).toBe(true);
    expect(store.data.length).toBe(1);
  });

  it("enters a normal death and returns its slot", () => {
    const store = memStore([score({ pts: 5000, who: "top" })]);
    const r = enterScore(
      store,
      stubPlayer({ maxExp: 1000, maxDepth: 10 }), // pts 2000
      { diedFrom: "a giant rat", turn: 100, depth: 5, fullName: "Newbie" },
      { diedFrom: "a giant rat" },
    );
    expect(r).toEqual({ entered: true, slot: 1 });
    expect(store.data.map((s) => s.who)).toEqual(["top", "Newbie"]);
  });
});

describe("predictScore (ui-score.c L193)", () => {
  it("inserts a live character provisionally and shows the top 15", () => {
    const scores = [score({ pts: 9000 }), score({ pts: 1000 })];
    const entry = score({ pts: 5000, who: "me" });
    const p = predictScore(scores, entry, false);
    expect(p.highlight).toBe(1); // slotted between 9000 and 1000
    expect(p.from).toBe(0);
    expect(p.to).toBe(15);
    expect(p.scores.map((s) => s.pts)).toEqual([9000, 5000, 1000]);
  });

  it("only locates a dead character (already entered) without inserting", () => {
    const scores = [score({ pts: 9000 }), score({ pts: 5000, who: "me" }), score({ pts: 1000 })];
    const entry = score({ pts: 5000, who: "me" });
    const p = predictScore(scores, entry, true);
    expect(p.highlight).toBe(1);
    expect(p.scores.length).toBe(3); // not inserted again
  });

  it("windows around a deep entry (rank >= 10)", () => {
    const scores: HighScore[] = [];
    for (let i = 0; i < 30; i++) scores.push(score({ pts: 10000 - i * 10 }));
    const entry = score({ pts: 10000 - 15 * 10 }); // ties index 15, entry wins
    const p = predictScore(scores, entry, true);
    expect(p.highlight).toBe(15);
    expect(p.from).toBe(13);
    expect(p.to).toBe(22);
  });
});
